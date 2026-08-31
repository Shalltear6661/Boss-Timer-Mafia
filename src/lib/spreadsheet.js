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
 * Parse tanggal kematian dari spreadsheet.
 * Support: "31/08/2026 16:32", "31-8-2026 0:00", "31-8-2026 16:32"
 */
function parseDeathDate(str) {
  if (!str || !str.trim()) return null
  const clean = str.trim().replace(/[\u00A0\u202F\u2007\u2060]/g, ' ').replace(/\s+/g, ' ')
  const match = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const d = Number(match[1])
  const m = Number(match[2])
  const y = Number(match[3])
  const hh = Number(match[4])
  const mi = Number(match[5])
  if (!d || !m || !y || Number.isNaN(hh) || Number.isNaN(mi)) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mi)}:00+07:00`
}

/**
 * Parse time: "10:30 AM" / "6:00 PM" ATAU format 24 jam "18:00" / "10:30"
 */
function parseTime(str) {
  if (!str || !str.trim()) return null
  const clean = str
    .trim()
    .replace(/[\u00A0\u202F\u2007\u2060]/g, ' ')
    .replace(/\s+/g, ' ')
  const match12 = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let h = parseInt(match12[1], 10)
    const m = match12[2]
    const modifier = match12[3].toUpperCase()
    if (modifier === 'PM' && h !== 12) h += 12
    if (modifier === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${m}`
  }
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    const h = parseInt(match24[1], 10)
    const m = match24[2]
    if (h < 0 || h > 23) return null
    return `${String(h).padStart(2, '0')}:${m}`
  }
  return null
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
  if (deathStr && /^(0?1)[\/\-](0?1)[\/\-]2012/.test(deathStr)) return null
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
  const errors = []
  for (const turn of TURNS) {
    try {
      const rows = await fetchRange('A2:H', turn)
      let count = 0
      for (const row of rows) {
        const parsed = parseIntervalRow(row, turn)
        if (parsed) {
          results.push(parsed)
          count++
        }
      }
      if (count === 0 && rows.length > 1) {
        console.warn(`[sheets] Turn ${turn}: ${rows.length} baris tapi 0 boss ter-parse (cek format tanggal)`)
      }
    } catch (e) {
      console.warn(`Gagal fetch interval boss untuk turn ${turn}:`, e)
      errors.push(`${turn}: ${e.message}`)
    }
  }
  if (results.length === 0 && errors.length) {
    throw new Error(`Gagal load boss: ${errors.join('; ')}`)
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
  const time = parseTime(row[3] || '')
  if (day === undefined || !time) return null
  const id = name.toLowerCase().replace(/\s+/g, '-')
  return { id, name, turn, schedule: { day, time }, _sheetTurn: defaultTurn }
}

/** Fetch weekly bosses dari semua turn sheet (header weekly di baris ~25) */
export async function fetchWeeklyBosses() {
  const bossMap = {}
  for (const turn of TURNS) {
    try {
      const rows = await fetchRange('A17:D', turn)
      for (const row of rows) {
        const parsed = parseWeeklyRow(row, turn)
        if (!parsed) continue
        if (!bossMap[parsed.id]) {
          bossMap[parsed.id] = { id: parsed.id, name: parsed.name, turn: parsed.turn || turn, schedules: [] }
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
