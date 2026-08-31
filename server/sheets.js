/**
 * Shared Google Sheets fetch — dipakai Vite (dev) & Vercel (production).
 *
 * Multi-sheet berdasarkan turn:
 * - MAFIA → sheet Boss Timer M1
 * - MAFIAx2 → sheet Boss Timer M2
 *
 * Baca sheet prioritas: Service Account (bisa akses private) → fallback API Key.
 */

import { getAccessToken } from './googleAuth.js'

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
  const clean = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim()

  if (turnKey) {
    const envId = clean(env[`GOOGLE_SHEETS_ID_${turnKey.toUpperCase()}`])
    const envName = clean(env[`GOOGLE_SHEETS_NAME_${turnKey.toUpperCase()}`])
    const defaults = DEFAULT_SHEETS[turnKey]
    return {
      apiKey,
      spreadsheetId: envId || defaults.spreadsheetId,
      sheetName: envName || defaults.sheetName,
      turn: turnKey,
    }
  }

  const spreadsheetId =
    clean(env['GOOGLE_SHEETS_ID']) || DEFAULT_SHEETS.MAFIA.spreadsheetId
  const sheetName =
    clean(env['GOOGLE_SHEETS_NAME']) || DEFAULT_SHEETS.MAFIA.sheetName
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
 * Fetch values dari sheet tertentu.
 * Prioritas auth: Service Account → API Key (untuk sheet private).
 */
export async function fetchSheetValues(range, turn = '', env = process.env) {
  const { apiKey, spreadsheetId, sheetName } = getSheetsConfig(turn, env)
  if (!range || !/^[A-Z0-9:]+$/i.test(range)) {
    throw new Error('Range tidak valid')
  }

  const safeSheet = String(sheetName).replace(/'/g, "''")
  const a1 = `'${safeSheet}'!${range}`
  const encoded = encodeURIComponent(a1)
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encoded}`

  // 1) Coba Service Account dulu (bisa baca sheet private)
  try {
    const accessToken = await getAccessToken(env)
    const res = await fetch(base, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.ok) {
      const data = await res.json()
      return data.values || []
    }
    const text = await res.text().catch(() => '')
    // Jika SA gagal, coba API key (jangan throw dulu)
    if (!apiKey) {
      throw new Error(`Google Sheets error ${res.status}: ${text.slice(0, 200)}`)
    }
    console.warn(`[sheets] SA read gagal (${res.status}) untuk ${sheetName}, coba API key`)
  } catch (e) {
    if (!apiKey) throw e
    // SA belum dikonfigurasi / gagal — lanjut API key
    if (e?.code !== 'MISSING_WRITE_CREDS' && e?.code !== 'MISSING_SA') {
      console.warn(`[sheets] SA unavailable: ${e.message}`)
    }
  }

  // 2) Fallback API Key (hanya untuk sheet yang publik)
  if (!apiKey) {
    throw new Error('GOOGLE_SHEETS_API_KEY / Service Account belum di-set')
  }
  const res = await fetch(`${base}?key=${encodeURIComponent(apiKey)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Google Sheets error ${res.status} (${sheetName} / ${turn || 'default'}): ${text.slice(0, 200)}`
    )
  }
  const data = await res.json()
  return data.values || []
}

/** Cell maintenance flag */
const MAINTENANCE_CELL = 'Z1'
const MAINTENANCE_ACTIVE = 'MAINTENANCE'

/** Cek maintenance di semua sheet */
export async function getMaintenanceMode(env = process.env) {
  const configs = getAllSheetConfigs(env)

  const results = await Promise.allSettled(
    configs.map(async ({ turn }) => {
      const rows = await fetchSheetValues(MAINTENANCE_CELL, turn, env)
      return (rows?.[0]?.[0] || '').trim() === MAINTENANCE_ACTIVE
    })
  )

  const anyMaintenance = results.some((r) => r.status === 'fulfilled' && r.value === true)
  return { maintenance: anyMaintenance }
}
