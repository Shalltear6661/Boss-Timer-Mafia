/** Zona sumber jadwal spreadsheet (WIB). */
export const SOURCE_TZ = 'Asia/Jakarta'

export const TIMEZONE_OPTIONS = [
  {
    id: 'id',
    label: 'Indonesia',
    short: 'WIB',
    tz: 'Asia/Jakarta',
  },
  {
    id: 'my',
    label: 'Malaysia',
    short: 'MYT',
    tz: 'Asia/Kuala_Lumpur',
  },
]

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function getTimezoneOption(id) {
  return TIMEZONE_OPTIONS.find((o) => o.id === id) || TIMEZONE_OPTIONS[0]
}

export function getZonedParts(date, timeZone) {
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
    weekday: WEEKDAY_MAP[parts.weekday] ?? 0,
  }
}

function addDaysYmd(year, month, day, add) {
  const dt = new Date(Date.UTC(year, month - 1, day + add))
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  }
}

/** Konversi tanggal/jam kalender di `timeZone` menjadi Instant UTC. */
export function zonedTimeToUtc({ year, month, day, hour, minute, second = 0 }, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(new Date(utc), timeZone)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const want = Date.UTC(year, month - 1, day, hour, minute, second)
    utc += want - asUtc
  }
  return new Date(utc)
}

/**
 * Kemunculan berikutnya untuk jadwal { day, time } di zona sumber (default WIB).
 */
export function nextOccurrenceInZone(schedule, now, sourceTz = SOURCE_TZ) {
  const [h, m] = schedule.time.split(':').map(Number)
  const nowP = getZonedParts(now, sourceTz)
  let diffDays = (schedule.day - nowP.weekday + 7) % 7
  let ymd = addDaysYmd(nowP.year, nowP.month, nowP.day, diffDays)
  let candidate = zonedTimeToUtc({ ...ymd, hour: h, minute: m }, sourceTz)
  if (candidate.getTime() <= now.getTime()) {
    ymd = addDaysYmd(ymd.year, ymd.month, ymd.day, 7)
    candidate = zonedTimeToUtc({ ...ymd, hour: h, minute: m }, sourceTz)
  }
  return candidate
}

export function formatTimeInZone(date, timeZone, { withSeconds = false } = {}) {
  return new Date(date).toLocaleTimeString('id-ID', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  })
}

export function formatDateInZone(date, timeZone) {
  return new Date(date).toLocaleDateString('id-ID', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function weekdayInZone(date, timeZone) {
  return getZonedParts(new Date(date), timeZone).weekday
}
