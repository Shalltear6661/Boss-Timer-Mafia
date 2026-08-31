import { getAccessToken } from './googleAuth.js'
import { getSheetsConfig, getAllSheetConfigs } from './sheets.js'

/** Format waktu kematian sesuai spreadsheet: DD/MM/YYYY H:mm (WIB) */
export function formatDeathForSheet(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return `${parts.day}/${parts.month}/${parts.year} ${hour}:${parts.minute}`
}

/**
 * Update kolom Time of Death (D) untuk boss interval.
 * Parameter turn menentukan sheet tujuan (MAFIA / MAFIAx2).
 * @returns {{ row: number, deathTime: string, name: string }}
 */
export async function markBossKilledOnSheet(bossName, env = process.env, deathDate = new Date(), turn = '') {
  const name = (bossName || '').trim()
  if (!name) throw new Error('Nama boss wajib')

  const { spreadsheetId, sheetName, turn: resolvedTurn } = getSheetsConfig(turn, env)
  const accessToken = await getAccessToken(env)
  const deathTime = formatDeathForSheet(deathDate)

  const safeSheet = String(sheetName).replace(/'/g, "''")
  const readRange = `'${safeSheet}'!A2:A`
  const readUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(readRange)}`

  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const readData = await readRes.json().catch(() => ({}))
  if (!readRes.ok) {
    throw new Error(readData.error?.message || `Gagal baca sheet (${readRes.status})`)
  }

  const rows = readData.values || []
  let rowIndex = -1
  for (let i = 0; i < rows.length; i++) {
    const cell = (rows[i][0] || '').trim()
    if (!cell) continue
    // Header kedua = mulai section weekly — stop
    if (cell === 'Boss Name') {
      if (i > 0) break
      continue
    }
    if (cell.toLowerCase() === name.toLowerCase()) {
      rowIndex = i
      break
    }
  }
  if (rowIndex < 0) {
    throw new Error(
      `Boss "${name}" tidak ditemukan di sheet ${sheetName} (turn: ${resolvedTurn || turn || 'default'})`
    )
  }

  const sheetRow = rowIndex + 2
  const writeRange = `'${safeSheet}'!D${sheetRow}`
  const writeUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`

  const writeRes = await fetch(writeUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[deathTime]] }),
  })
  const writeData = await writeRes.json().catch(() => ({}))
  if (!writeRes.ok) {
    throw new Error(writeData.error?.message || `Gagal update sheet (${writeRes.status})`)
  }

  return {
    row: sheetRow,
    deathTime,
    name: rows[rowIndex][0].trim(),
    turn: resolvedTurn || turn || '',
    sheetName,
    spreadsheetId,
  }
}

/** Cell maintenance flag */
const MAINTENANCE_CELL = 'Z1'
const MAINTENANCE_ACTIVE = 'MAINTENANCE'

/** Atur status maintenance di SEMUA sheet (MAFIA dan MAFIAx2) */
export async function setMaintenanceMode(active, env = process.env) {
  const configs = getAllSheetConfigs(env)
  const accessToken = await getAccessToken(env)
  const results = []

  for (const { spreadsheetId, sheetName } of configs) {
    const safeSheet = String(sheetName).replace(/'/g, "''")
    const writeRange = `'${safeSheet}'!${MAINTENANCE_CELL}`
    const writeUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`

    const writeRes = await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[active ? MAINTENANCE_ACTIVE : '']] }),
    })

    if (!writeRes.ok) {
      const writeData = await writeRes.json().catch(() => ({}))
      throw new Error(writeData.error?.message || `Gagal set maintenance di ${sheetName} (${writeRes.status})`)
    }
    results.push({ sheetName, ok: true })
  }

  return { ok: true, active, sheets: results }
}
