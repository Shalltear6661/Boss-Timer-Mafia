/**
 * Shared Google Sheets fetch — dipakai Vite (dev) & Vercel (production).
 * API key hanya hidup di server / env, tidak pernah dikirim ke browser.
 *
 * Mendukung multi-sheet berdasarkan turn:
 * - MAFIA → GOOGLE_SHEETS_ID_MAFIA / GOOGLE_SHEETS_NAME_MAFIA
 * - MAFIAx2 → GOOGLE_SHEETS_ID_MAFIAX2 / GOOGLE_SHEETS_NAME_MAFIAX2
 * - fallback (tanpa turn atau turn lain) → GOOGLE_SHEETS_ID / GOOGLE_SHEETS_NAME
 */

const TURN_SHEETS = ['MAFIA', 'MAFIAx2']

/** Ambil config sheet berdasarkan turn (opsional). */
export function getSheetsConfig(turn = '', env = process.env) {
  const apiKey = env['GOOGLE_SHEETS_API_KEY'] || env['GOOGLE_API_KEY'] || ''
  const turnKey = TURN_SHEETS.find((t) => t.toLowerCase() === String(turn).trim().toLowerCase())

  if (turnKey) {
    const id = env[`GOOGLE_SHEETS_ID_${turnKey.toUpperCase()}`] || ''
    const name = env[`GOOGLE_SHEETS_NAME_${turnKey.toUpperCase()}`] || ''
    if (id && name) {
      return { apiKey, spreadsheetId: id, sheetName: name }
    }
  }

  // Fallback ke config umum
  const spreadsheetId = env['GOOGLE_SHEETS_ID'] || '16RuhOUl3XUXtWMkBeRZwgYBYdCoOH4w-zPUVyLqf3hI'
  const sheetName = env['GOOGLE_SHEETS_NAME'] || 'Boss Timer M1'
  return { apiKey, spreadsheetId, sheetName }
}

/** Daftar semua konfigurasi sheet yang aktif (untuk fetch all) */
export function getAllSheetConfigs(env = process.env) {
  const configs = []
  const seen = new Set()

  for (const turn of TURN_SHEETS) {
    const cfg = getSheetsConfig(turn, env)
    const key = `${cfg.spreadsheetId}:${cfg.sheetName}`
    if (!seen.has(key)) {
      seen.add(key)
      configs.push({ ...cfg, turn })
    }
  }

  // Fallback config jika belum ada turn-specific
  const fallback = getSheetsConfig('', env)
  const fbk = `${fallback.spreadsheetId}:${fallback.sheetName}`
  if (!seen.has(fbk)) {
    seen.add(fbk)
    configs.push({ ...fallback, turn: '' })
  }

  return configs
}

/**
 * Fetch values dari sheet tertentu (berdasarkan turn).
 * @param {string} range contoh: "A2:H"
 * @param {string} [turn] - "MAFIA" | "MAFIAx2" | "" (fallback)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string[][]>}
 */
export async function fetchSheetValues(range, turn = '', env = process.env) {
  const { apiKey, spreadsheetId, sheetName } = getSheetsConfig(turn, env)
  if (!apiKey) {
    throw new Error('GOOGLE_SHEETS_API_KEY belum di-set di environment')
  }
  if (!range || !/^[A-Z0-9:]+$/i.test(range)) {
    throw new Error('Range tidak valid')
  }

  const safeSheet = String(sheetName).replace(/'/g, "''")
  const a1 = `'${safeSheet}'!${range}`
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(a1)}?key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Sheets error ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.values || []
}

/** Cell maintenance flag — dibaca dari semua sheet */
const MAINTENANCE_CELL = 'Z1'
const MAINTENANCE_ACTIVE = 'MAINTENANCE'

/** Cek maintenance: return true jika SEMUA sheet dalam maintenance */
export async function getMaintenanceMode(env = process.env) {
  const configs = getAllSheetConfigs(env)
  const apiKey = configs[0]?.apiKey
  if (!apiKey) return { maintenance: false }

  const results = await Promise.allSettled(
    configs.map(async ({ spreadsheetId, sheetName }) => {
      const safeSheet = String(sheetName).replace(/'/g, "''")
      const a1 = `'${safeSheet}'!${MAINTENANCE_CELL}`
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
        `/values/${encodeURIComponent(a1)}?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url)
      if (!res.ok) return false
      const data = await res.json()
      return (data.values?.[0]?.[0] || '').trim() === MAINTENANCE_ACTIVE
    })
  )

  // Maintenance aktif jika setidaknya SATU sheet dalam maintenance
  const anyMaintenance = results.some((r) => r.status === 'fulfilled' && r.value === true)
  return { maintenance: anyMaintenance }
}
