/**
 * Client hanya memanggil proxy same-origin.
 * Browser Network tab akan melihat: /api/sheets?range=A2:D
 * (tanpa API key Google)
 */
async function fetchRange(range) {
  const res = await fetch(`/api/sheets?range=${encodeURIComponent(range)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Gagal fetch sheet: ${res.status}`)
  }
  const data = await res.json()
  return data.values || []
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
 * Parse time format "10:30 AM" atau "6:00 PM" jadi "HH:mm" 24 jam
 */
function parseTime12h(str) {
  if (!str || !str.trim()) return null
  const clean = str.trim().replace(/\s+/g, ' ')
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
}

export async function fetchIntervalBosses() {
  const rows = await fetchRange('A2:D')
  const results = []
  for (const row of rows) {
    const name = (row[0] || '').trim()
    if (!name) continue
    const level = Number(row[1]) || 0
    const interval = Number(row[2]) || 0
    const deathStr = (row[3] || '').trim()
    if (deathStr && deathStr.startsWith('01/01/2012')) continue
    const lastDeath = parseDeathDate(deathStr)
    if (!lastDeath) continue
    results.push({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      level,
      spawnIntervalHours: interval,
      lastDeath,
    })
  }
  return results
}

export async function fetchWeeklyBosses() {
  const rows = await fetchRange('A30:D')
  const bossMap = {}
  for (const row of rows) {
    const name = (row[0] || '').trim()
    if (!name || name === 'Boss Name') continue
    const dayName = (row[2] || '').trim()
    const day = DAY_MAP[dayName.toLowerCase()]
    const time = parseTime12h(row[3] || '')
    if (day === undefined || !time) continue
    const id = name.toLowerCase().replace(/\s+/g, '-')
    if (!bossMap[id]) {
      bossMap[id] = { id, name, schedules: [] }
    }
    bossMap[id].schedules.push({ day, time })
  }
  return Object.values(bossMap)
}
