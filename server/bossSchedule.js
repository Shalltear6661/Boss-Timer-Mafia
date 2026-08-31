import { fetchSheetValues, getMaintenanceMode, getAllSheetConfigs } from './sheets.js'

const DAY_MAP = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  minggu: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
}

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
  return new Date(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mi)}:00+07:00`)
}

function parseTime12h(str) {
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

function getZonedParts(date, timeZone = 'Asia/Jakarta') {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  )
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY[parts.weekday] ?? 0,
  }
}

function zonedTimeToUtc({ year, month, day, hour, minute, second = 0 }, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(new Date(utc), timeZone)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const want = Date.UTC(year, month - 1, day, hour, minute, second)
    utc += want - asUtc
  }
  return new Date(utc)
}

function nextOccurrence(schedule, now) {
  const [h, m] = schedule.time.split(':').map(Number)
  const nowP = getZonedParts(now, 'Asia/Jakarta')
  let diffDays = (schedule.day - nowP.weekday + 7) % 7
  let y = nowP.year
  let mo = nowP.month
  let d = nowP.day + diffDays
  const base = new Date(Date.UTC(y, mo - 1, d))
  y = base.getUTCFullYear()
  mo = base.getUTCMonth() + 1
  d = base.getUTCDate()
  let candidate = zonedTimeToUtc({ year: y, month: mo, day: d, hour: h, minute: m }, 'Asia/Jakarta')
  if (candidate.getTime() <= now.getTime()) {
    const next = new Date(Date.UTC(y, mo - 1, d + 7))
    candidate = zonedTimeToUtc(
      {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
        hour: h,
        minute: m,
      },
      'Asia/Jakarta'
    )
  }
  return candidate
}

/** Fetch interval bosses dari satu sheet tertentu (berdasarkan config turn) */
async function loadIntervalBosses(config, now, env) {
  const rows = await fetchSheetValues('A2:H', config.turn, env)
  const items = []

  for (const row of rows) {
    const name = (row[0] || '').trim()
    if (!name || name === 'Boss Name') continue
    const interval = Number(row[2]) || 0
    const deathStr = (row[3] || '').trim()
    if (deathStr && /^(0?1)[\/\-](0?1)[\/\-]2012/.test(deathStr)) continue
    const lastDeath = parseDeathDate(deathStr)
    if (!lastDeath || !interval) continue
    const id = 'ib-' + name.toLowerCase().replace(/\s+/g, '-')
    const nextSpawn = lastDeath.getTime() + interval * 3600 * 1000
    items.push({ id, name, msLeft: nextSpawn - now.getTime() })
  }

  return items
}

/** Fetch weekly bosses — MAFIA mulai ~baris 25, MAFIAx2 mulai ~baris 17 */
async function loadWeeklyBosses(config, now, env) {
  const rows = await fetchSheetValues('A17:D', config.turn, env)
  const bossMap = {}

  for (const row of rows) {
    const name = (row[0] || '').trim()
    if (!name || name === 'Boss Name') continue
    const dayName = (row[2] || '').trim()
    const day = DAY_MAP[dayName.toLowerCase()]
    const time = parseTime12h(row[3] || '')
    if (day === undefined || !time) continue
    const id = 'wb-' + name.toLowerCase().replace(/\s+/g, '-')
    if (!bossMap[id]) bossMap[id] = { id, name, schedules: [] }
    bossMap[id].schedules.push({ day, time })
  }

  const items = []
  for (const b of Object.values(bossMap)) {
    let soonest = null
    for (const s of b.schedules) {
      const n = nextOccurrence(s, now)
      if (!soonest || n < soonest) soonest = n
    }
    if (soonest) {
      items.push({ id: b.id, name: b.name, msLeft: soonest.getTime() - now.getTime() })
    }
  }

  return items
}

export async function loadWatchList(env = process.env, now = new Date()) {
  // Cek maintenance — jika aktif, skip semua notifikasi
  const maint = await getMaintenanceMode(env)
  if (maint.maintenance) {
    return []
  }

  const configs = getAllSheetConfigs(env)

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const [intervalItems, weeklyItems] = await Promise.all([
        loadIntervalBosses(config, now, env),
        loadWeeklyBosses(config, now, env),
      ])
      return [...intervalItems, ...weeklyItems]
    })
  )

  const items = []
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value)
  }

  return items
}

/**
 * Window sempit (~1 menit) agar cron eksternal (tiap menit) hanya fire sekali per milestone.
 */
export const PUSH_MILESTONES = [
  {
    id: '10',
    match: (ms) => ms <= 10 * 60 * 1000 && ms > 9 * 60 * 1000,
    title: '10 menit lagi',
    body: (name) => `${name} akan spawn dalam ~10 menit`,
  },
  {
    id: '5',
    match: (ms) => ms <= 5 * 60 * 1000 && ms > 4 * 60 * 1000,
    title: '5 menit lagi',
    body: (name) => `${name} akan spawn dalam ~5 menit`,
  },
  {
    id: 'spawn',
    match: (ms) => ms <= 30 * 1000 && ms > -30 * 1000,
    title: 'SPAWN!',
    body: (name) => `${name} sudah waktunya spawn sekarang!`,
  },
]

export function collectDueNotifications(items) {
  const due = []
  for (const item of items) {
    for (const m of PUSH_MILESTONES) {
      if (m.match(item.msLeft)) {
        due.push({
          title: m.title,
          body: m.body(item.name),
          tag: `boss-${item.id}-${m.id}`,
          vibrate: [300, 100, 300, 100, 500],
        })
      }
    }
  }
  return due
}
