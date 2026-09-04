/**
 * Shared Google Sheets fetch — dipakai Vite (dev) & Vercel (production).
 *
 * Multi-sheet berdasarkan turn:
 * - MAFIA → sheet Boss Timer M1
 * - MAFIAx2 → sheet Boss Timer M2
 *
 * Baca sheet prioritas: Service Account (bisa akses private) → fallback API Key.
 * Ada cache singkat agar tidak kena quota Read requests per minute.
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

/** Cache baca sheet (per instance serverless) — kurangi quota Google */
const CACHE_TTL_MS = 25_000
const valuesCache = new Map()
/** Map nama boss → nomor baris sheet (1-based) dari baca terakhir */
const rowIndexCache = new Map()

function normalizeTurn(turn) {
  const t = String(turn || '').trim().toLowerCase()
  if (t === 'mafia') return 'MAFIA'
  if (t === 'mafiax2' || t === 'mafia x2' || t === 'mafia-x2') return 'MAFIAx2'
  return ''
}

function cacheKey(spreadsheetId, sheetName, range) {
  return `${spreadsheetId}|${sheetName}|${range}`
}

function rowIndexKey(spreadsheetId, sheetName) {
  return `${spreadsheetId}|${sheetName}`
}

function getCachedValues(key) {
  const hit = valuesCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    valuesCache.delete(key)
    return null
  }
  return hit.values
}

function setCachedValues(key, values) {
  valuesCache.set(key, { at: Date.now(), values })
}

/** Update index nama→baris dari hasil baca kolom A (A2:…) */
function updateRowIndexFromValues(spreadsheetId, sheetName, range, values) {
  if (!/^A2(:|$)/i.test(String(range || ''))) return
  const map = new Map()
  for (let i = 0; i < (values || []).length; i++) {
    const cell = String(values[i]?.[0] || '').trim()
    if (!cell) continue
    if (cell === 'Boss Name') {
      if (i > 0) break
      continue
    }
    map.set(cell.toLowerCase(), i + 2)
  }
  rowIndexCache.set(rowIndexKey(spreadsheetId, sheetName), { at: Date.now(), map })
}

/** Cari nomor baris boss dari cache (tanpa hit Google). Null jika miss/expired. */
export function lookupBossRow(bossName, turn = '', env = process.env) {
  const { spreadsheetId, sheetName } = getSheetsConfig(turn, env)
  const hit = rowIndexCache.get(rowIndexKey(spreadsheetId, sheetName))
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS * 4) return null
  const row = hit.map.get(String(bossName || '').trim().toLowerCase())
  return row || null
}

/** Invalidate cache setelah write / kill */
export function invalidateSheetsCache(turn = '') {
  const turnKey = normalizeTurn(turn)
  if (!turnKey) {
    valuesCache.clear()
    rowIndexCache.clear()
    return
  }
  const cfg = getSheetsConfig(turnKey)
  const prefix = `${cfg.spreadsheetId}|${cfg.sheetName}|`
  for (const key of [...valuesCache.keys()]) {
    if (key.startsWith(prefix)) valuesCache.delete(key)
  }
  rowIndexCache.delete(rowIndexKey(cfg.spreadsheetId, cfg.sheetName))
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

async function fetchSheetValuesUncached(range, turn, env) {
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
      return { values: data.values || [], spreadsheetId, sheetName }
    }
    const text = await res.text().catch(() => '')
    if (!apiKey) {
      throw new Error(`Google Sheets error ${res.status}: ${text.slice(0, 200)}`)
    }
    console.warn(`[sheets] SA read gagal (${res.status}) untuk ${sheetName}, coba API key`)
  } catch (e) {
    if (!apiKey) throw e
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
  return { values: data.values || [], spreadsheetId, sheetName }
}

/**
 * Fetch values dari sheet tertentu.
 * Prioritas auth: Service Account → API Key (untuk sheet private).
 * skipCache=true untuk baca paksa (jarang dipakai).
 */
export async function fetchSheetValues(range, turn = '', env = process.env, { skipCache = false } = {}) {
  const { spreadsheetId, sheetName } = getSheetsConfig(turn, env)
  const key = cacheKey(spreadsheetId, sheetName, range)

  if (!skipCache) {
    const cached = getCachedValues(key)
    if (cached) return cached
  }

  const { values } = await fetchSheetValuesUncached(range, turn, env)
  setCachedValues(key, values)
  updateRowIndexFromValues(spreadsheetId, sheetName, range, values)
  return values
}
