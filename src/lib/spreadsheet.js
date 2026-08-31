/**
 * Client hanya memanggil proxy same-origin.
 * Browser Network tab akan melihat: /api/sheets?range=A2:H&turn=MAFIA
 * (tanpa API key Google)
 */
const TURNS = ['MAFIA', 'MAFIAx2']

async function fetchRange(range, turn) {
  const res = await fetch(`/api/sheets?range=${encodeURIComponent(range)}&turn=${encodeURIComponent(turn)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Gagal fetch sheet: ${res.status}`)
  }
  const data = await res.json()
  return data.values || []
}

/** Tandai boss mati → update Time of Death di spreadsheet yang sesuai (berdasarkan turn) */
export async function markBossKilled(name, deathISO, turn) {
  const res = await fetch('/api/kill', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, deathTime: deathISO, turn }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Gagal update kill: ${res.status}`)
  }
  return data
}

/**
 * Parse tanggal format "DD/MM/YYYY HH:mm" (WIB) menjadi ISO string +07:00.
 * Contoh: "03/08/2026 11:56" → "2026-08-03T11:56:00+07:00"
 */
function parseDeathDate(str) {
  if (!str || !str.trim()) return null
  const parts = str.trim().split(/\s+/)
  if (parts.length < 2) return null
  const [d, m, y] = parts[0].split('/').map(Number)
  const [hh, mi] = parts[1].split(':').map(Number)
  if (!d || !m || !y || Number.isNaN(hh) || Number.isNaN(mi)) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mi)}:00+07:00`
}

/**
 * Parse time format "10:30 AM" atau "6:00 PM" jadi "HH:mm" 24 jam.
 * Google Sheets sering pakai NBSP / narrow NBSP di antara jam dan AM/PM.
 */
function parseTime12h(str) {
  if (!str || !str.trim()) return null
  const clean = str
    .trim()
    .replace(/[\u00A0\u202F\u2007\u2060]/g, ' ')
    .replace(/\s+/g, ' ')
  const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return null
  let h = parseInt(match[1], 10)
  const m = match[2]
  const modifier = match[3].toUpperCase()
  if (modifier === 'PM' && h !== 12) h += 12
  if (modifier === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m}`
}

const DAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
  minggu: 0, senin: 1, selasa: 2, rabu: 3,
  kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6,
}

/** Parse baris dari sheet untuk interval boss (kolom A-H) */
function parseIntervalRow(row, defaultTurn) {
  const name = (row[0] || '').trim()
  if (!name || name === 'Boss Name') return null
  const level = Number(row[1]) || 0
  const interval = Number(row[2]) || 0
  const deathStr = (row[3] || '').trim()
  if (deathStr && deathStr.startsWith('01/01/2012')) return null
  const lastDeath = parseDeathDate(deathStr)
  if (!lastDeath) return null
  const turn = (row[7] || '').trim() || defaultTurn
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    level,
    spawnIntervalHours: interval,
    lastDeath,
    turn,
    _sheetTurn: defaultTurn, // internal: untuk routing kill
  }
}

/** Fetch interval bosses dari semua turn sheet */
export async function fetchIntervalBosses() {
  const results = []
  for (const turn of TURNS) {
    try {
      const rows = await fetchRange('A2:H', turn)
      for (const row of rows) {
        const parsed = parseIntervalRow(row, turn)
        if (parsed) results.push(parsed)
      }
    } catch (e) {
      console.warn(`Gagal fetch interval boss untuk turn ${turn}:`, e)
    }
  }
  return results
}

/** Parse baris weekly boss (kolom A-D, baris 25+) */
function parseWeeklyRow(row, defaultTurn) {
  const name = (row[0] || '').trim()
  if (!name || name === 'Boss Name') return null
  const rawTurn = (row[1] || '').trim()
  const turn = !rawTurn || rawTurn === '-' ? '' : rawTurn
  const dayName = (row[2] || '').trim()
  const day = DAY_MAP[dayName.toLowerCase()]
  const time = parseTime12h(row[3] || '')
  if (day === undefined || !time) return null
  const id = name.toLowerCase().replace(/\s+/g, '-')
  return { id, name, turn, schedule: { day, time }, _sheetTurn: defaultTurn }
}

/** Fetch weekly bosses dari semua turn sheet */
export async function fetchWeeklyBosses() {
  const bossMap = {}
  for (const turn of TURNS) {
    try {
      const rows = await fetchRange('A30:D', turn)
      for (const row of rows) {
        const parsed = parseWeeklyRow(row, turn)
        if (!parsed) continue
        if (!bossMap[parsed.id]) {
          bossMap[parsed.id] = { id: parsed.id, name: parsed.name, turn: parsed.turn, schedules: [] }
        } else if (!bossMap[parsed.id].turn && parsed.turn) {
          bossMap[parsed.id].turn = parsed.turn
        }
        bossMap[parsed.id].schedules.push(parsed.schedule)
      }
    } catch (e) {
      console.warn(`Gagal fetch weekly boss untuk turn ${turn}:`, e)
    }
  }
  return Object.values(bossMap)
}

/** Baca status maintenance dari server */
export async function fetchMaintenanceStatus() {
  const res = await fetch('/api/maintenance')
  if (!res.ok) {
    return { maintenance: false }
  }
  const data = await res.json()
  return { maintenance: data.maintenance === true }
}

/** Toggle maintenance mode (editor only) */
export async function toggleMaintenanceActive(active) {
  const res = await fetch('/api/maintenance', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Gagal toggle maintenance: ${res.status}`)
  }
  return data
}
