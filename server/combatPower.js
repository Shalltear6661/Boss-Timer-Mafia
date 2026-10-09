import { getAccessToken } from './googleAuth.js'
import { getSheetsConfig, normalizeTurn } from './sheets.js'
import { isUpdateCpWindowOpen, SOURCE_TZ } from '../src/lib/timezone.js'

const CP_SHEET = 'Update CP'

/** Layout sheet Update CP (sesuai spreadsheet guild):
 * D1 = "Last Update:" | E1 = DD/MM/YY
 * C2 = "Nama" | D2 = "UpdateCP"
 * B3+ = no | C3+ = nama | D3+ = CP
 */

function sheetA1(range) {
  const safe = String(CP_SHEET).replace(/'/g, "''")
  return `'${safe}'!${range}`
}

async function sheetsFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error?.message || `Sheets error ${res.status}`)
    err.code = data.error?.status || res.status
    err.status = res.status
    throw err
  }
  return data
}

function formatLastUpdateDate(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

/** Format CP seperti di sheet: 151165 → "151.165" */
export function formatCpDisplay(cp) {
  const n = Math.round(Number(cp))
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('id-ID')
}

function parseCpCell(raw) {
  const s = String(raw || '').trim()
  if (!s) return 0
  // "151.165" (id) atau "151,165" atau "151165"
  const cleaned = s.replace(/\./g, '').replace(/,/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Pastikan tab "Update CP" ada. Jangan timpa data/header yang sudah ada.
 * Jika sheet kosong, seed layout minimal.
 */
export async function ensureCombatPowerSheet(guild, env = process.env) {
  const turn = normalizeTurn(guild) || guild
  const { spreadsheetId } = getSheetsConfig(turn, env)
  const accessToken = await getAccessToken(env)

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`
  const meta = await sheetsFetch(metaUrl, accessToken)
  const titles = (meta.sheets || []).map((s) => s.properties?.title)
  if (!titles.includes(CP_SHEET)) {
    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`
    await sheetsFetch(batchUrl, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: CP_SHEET } } }],
      }),
    })
  }

  // Cek apakah header Nama sudah ada di C2
  const peekUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('C2:D2'))}`
  const peek = await sheetsFetch(peekUrl, accessToken)
  const c2 = String(peek.values?.[0]?.[0] || '').trim().toLowerCase()
  if (!c2) {
    // Seed layout awal (hanya jika kosong)
    const seedUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values:batchUpdate`
    await sheetsFetch(seedUrl, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          {
            range: sheetA1('D1:E1'),
            values: [['Last Update:', formatLastUpdateDate()]],
          },
          {
            range: sheetA1('C2:D2'),
            values: [['Nama', 'UpdateCP']],
          },
        ],
      }),
    })
  }

  return { spreadsheetId, accessToken, turn }
}

/**
 * Upload screenshot — sementara tidak dipakai di upsert.
 * @returns {{ fileId: string, url: string }}
 */
export async function uploadEquipScreenshot(
  { buffer, mimeType, fileName },
  accessToken
) {
  const meta = {
    name: fileName || `equip-${Date.now()}.jpg`,
    mimeType: mimeType || 'image/jpeg',
  }
  const boundary = `cp_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(meta)}\r\n`
  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Type: ${meta.mimeType}\r\n\r\n`
  const closing = `\r\n--${boundary}--\r\n`

  const body = Buffer.concat([
    Buffer.from(metaPart, 'utf8'),
    Buffer.from(fileHeader, 'utf8'),
    buffer,
    Buffer.from(closing, 'utf8'),
  ])

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(60000),
    }
  )
  const uploaded = await uploadRes.json().catch(() => ({}))
  if (!uploadRes.ok || !uploaded.id) {
    throw new Error(uploaded.error?.message || `Gagal upload screenshot (${uploadRes.status})`)
  }

  await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null)

  const url = `https://drive.google.com/uc?export=view&id=${uploaded.id}`
  return { fileId: uploaded.id, url }
}

/**
 * Upsert ke layout sheet Update CP:
 * - Cari nama di kolom C (mulai baris 3)
 * - Ada → update kolom D (UpdateCP)
 * - Belum → append B=no berikutnya, C=nama, D=CP
 * - Selalu update E1 = Last Update date
 */
export async function upsertCombatPower(
  { guild, ingameName, combatPower /*, screenshotBase64, screenshotMime, submittedBy */ },
  env = process.env
) {
  const turn = normalizeTurn(guild)
  if (turn !== 'MAFIA' && turn !== 'MAFIAx2') {
    throw new Error('Guild harus MAFIA atau MAFIAx2')
  }
  if (!isUpdateCpWindowOpen(new Date(), SOURCE_TZ)) {
    throw new Error('Update CP sedang ditutup')
  }
  const name = String(ingameName || '').trim()
  if (!name) throw new Error('Nama wajib')
  const cp = Number(combatPower)
  if (!Number.isFinite(cp) || cp <= 0) throw new Error('Combat power tidak valid')

  const cpValue = Math.round(cp) // angka murni ke sheet (hindari '89.366 teks)
  const cpDisplay = formatCpDisplay(cpValue)
  const { spreadsheetId, accessToken } = await ensureCombatPowerSheet(turn, env)

  // Baca B3:D (no | nama | CP) — baris 1-2 adalah meta/header
  const readUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('B3:D'))}`
  const existing = await sheetsFetch(readUrl, accessToken)
  const rows = existing.values || []
  const nameKey = name.toLowerCase()

  let foundRow = -1
  let maxNo = 0
  for (let i = 0; i < rows.length; i++) {
    const noRaw = String(rows[i][0] || '').trim()
    const rowName = String(rows[i][1] || '').trim()
    const no = parseInt(noRaw, 10)
    if (Number.isFinite(no) && no > maxNo) maxNo = no
    if (rowName && rowName.toLowerCase() === nameKey) {
      foundRow = i + 3 // sheet row (1-based), data mulai baris 3
      break
    }
  }

  const lastUpdate = formatLastUpdateDate()

  // Update E1 (Last Update date)
  const stampUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('D1:E1'))}?valueInputOption=RAW`
  await sheetsFetch(stampUrl, accessToken, {
    method: 'PUT',
    body: JSON.stringify({
      values: [['Last Update:', lastUpdate]],
    }),
  })

  if (foundRow > 0) {
    // Update hanya kolom UpdateCP (D) — kirim number, bukan string berformat
    const writeUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values/${encodeURIComponent(sheetA1(`D${foundRow}`))}?valueInputOption=USER_ENTERED`
    await sheetsFetch(writeUrl, accessToken, {
      method: 'PUT',
      body: JSON.stringify({ values: [[cpValue]] }),
    })
    return {
      updated: true,
      row: foundRow,
      guild: turn,
      name,
      combatPower: cpDisplay,
      lastUpdate,
    }
  }

  // Append baris baru: B=no, C=nama, D=CP (CP sebagai angka)
  const nextNo = maxNo + 1
  const appendUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('B:D'))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  await sheetsFetch(appendUrl, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      values: [[nextNo, name, cpValue]],
    }),
  })

  return {
    created: true,
    guild: turn,
    name,
    combatPower: cpDisplay,
    no: nextNo,
    lastUpdate,
  }
}

// Helper dipakai di tempat lain jika butuh parse CP dari sheet
export { parseCpCell }
