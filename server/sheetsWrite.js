import { getAccessToken } from './googleAuth.js'
import { getSheetsConfig } from './sheets.js'

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
  // en-GB: day/month/year — hour bisa "24" di beberapa engine untuk midnight; normalisasi
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return `${parts.day}/${parts.month}/${parts.year} ${hour}:${parts.minute}`
}

/**
 * Update kolom Time of Death (D) untuk boss interval berdasarkan nama.
 * @returns {{ row: number, deathTime: string, name: string }}
 */
export async function markBossKilledOnSheet(bossName, env = process.env, deathDate = new Date()) {
  const name = (bossName || '').trim()
  if (!name) throw new Error('Nama boss wajib')

  const { spreadsheetId, sheetName } = getSheetsConfig(env)
  const accessToken = await getAccessToken(env)
  const deathTime = formatDeathForSheet(deathDate)

  // Baca kolom nama untuk cari baris
  const encodedSheet = encodeURIComponent(sheetName)
  const readRange = `'${encodedSheet}'!A2:A`
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
    if (cell.toLowerCase() === name.toLowerCase()) {
      rowIndex = i
      break
    }
  }
  if (rowIndex < 0) {
    throw new Error(`Boss "${name}" tidak ditemukan di spreadsheet`)
  }

  // Baris spreadsheet = index + 2 (header di baris 1)
  const sheetRow = rowIndex + 2
  const writeRange = `'${sheetName}'!D${sheetRow}`
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

  return { row: sheetRow, deathTime, name: rows[rowIndex][0].trim() }
}
