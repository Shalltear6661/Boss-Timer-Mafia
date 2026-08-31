/**
 * Shared Google Sheets fetch — dipakai Vite (dev) & Vercel (production).
 * API key hanya hidup di server / env, tidak pernah dikirim ke browser.
 *
 * Multi-sheet berdasarkan turn:
 * - MAFIA → sheet Boss Timer M1
 * - MAFIAx2 → sheet Boss Timer M2
 */

/** Default hardcode — dipakai jika env turn-specific belum di-set di Vercel */
const DEFAULT_SHEETS = {
  MAFIA: {
    spreadsheetId: '16RuhOUl3XUXtWMkBeRZwgYBYdCoOH4w-zPUVyLqf3hI',
    sheetName: 'Boss Timer M1',
  },
  MAFIAx2: {
    spreadsheetId: '1O0TW2vSGlqN9XkqP312NgzlrUTkLioWGpoHsVywjyHk',
    sheetName: 'Boss Timer M2',
  },
}

const TURN_SHEETS = ['MAFIA', 'MAFIAx2']

function normalizeTurn(turn) {
  const t = String(turn || '').trim().toLowerCase()
  if (t === 'mafia') return 'MAFIA'
  if (t === 'mafiax2' || t === 'mafia x2' || t === 'mafia-x2') return 'MAFIAx2'
  return ''
}

/** Ambil config sheet berdasarkan turn. */
export function getSheetsConfig(turn = '', env = process.env) {
  const apiKey = env['GOOGLE_SHEETS_API_KEY'] || env['GOOGLE_API_KEY'] || ''
  const turnKey = normalizeTurn(turn)

  if (turnKey) {
    const envId = env[`GOOGLE_SHEETS_ID_${turnKey.toUpperCase()}`] || ''
    const envName = env[`GOOGLE_SHEETS_NAME_${turnKey.toUpperCase()}`] || ''
    const defaults = DEFAULT_SHEETS[turnKey]
    return {
      apiKey,
      spreadsheetId: envId || defaults.spreadsheetId,
      sheetName: envName || defaults.sheetName,
      turn: turnKey,
    }
  }

  // Fallback ke config umum / MAFIA
  const spreadsheetId =
    env['GOOGLE_SHEETS_ID'] || DEFAULT_SHEETS.MAFIA.spreadsheetId
  const sheetName = env['GOOGLE_SHEETS_NAME'] || DEFAULT_SHEETS.MAFIA.sheetName
  return { apiKey, spreadsheetId, sheetName, turn: '' }
}

/** Daftar semua konfigurasi sheet yang aktif (selalu 2 sheet berbeda) */
export function getAllSheetConfigs(env = process.env) {
  return TURN_SHEETS.map((turn) => ({
    ...getSheetsConfig(turn, env),
    turn,
  }))
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

/** Cek maintenance: return true jika setidaknya SATU sheet dalam maintenance */
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

  const anyMaintenance = results.some((r) => r.status === 'fulfilled' && r.value === true)
  return { maintenance: anyMaintenance }
}
