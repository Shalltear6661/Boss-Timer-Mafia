// Boss dengan jadwal tetap mingguan (bukan berdasarkan interval/kematian).
// day mengikuti Date.getDay(): 0=Minggu, 1=Senin, ..., 6=Sabtu
// time "HH:mm" di zona sumber spreadsheet: Asia/Jakarta (WIB).
// turn: MAFIA / MAFIAx2 / '' (tanpa turn)

import { nextOccurrenceInZone, SOURCE_TZ, weekdayInZone } from './timezone.js'

export const weeklyBosses = [
  { id: 'clemantis', name: 'Clemantis', turn: 'MAFIAx2', schedules: [{ day: 1, time: '10:30' }, { day: 4, time: '18:00' }] },
  { id: 'saphirus', name: 'Saphirus', turn: 'MAFIA', schedules: [{ day: 0, time: '16:00' }, { day: 2, time: '10:30' }] },
  { id: 'neutro', name: 'Neutro', turn: 'MAFIA', schedules: [{ day: 2, time: '18:00' }, { day: 4, time: '10:30' }] },
  { id: 'thymele', name: 'Thymele', turn: 'MAFIA', schedules: [{ day: 1, time: '18:00' }, { day: 3, time: '10:30' }] },
  { id: 'milavy', name: 'Milavy', turn: 'MAFIA', schedules: [{ day: 6, time: '14:00' }] },
  { id: 'ringor', name: 'Ringor', turn: 'MAFIA', schedules: [{ day: 6, time: '16:00' }] },
  { id: 'roderick', name: 'Roderick', turn: 'MAFIA', schedules: [{ day: 5, time: '18:00' }] },
  { id: 'auraq', name: 'Auraq', turn: 'MAFIA', schedules: [{ day: 3, time: '20:00' }, { day: 5, time: '21:00' }] },
  { id: 'chaiflock', name: 'Chaiflock', turn: '', schedules: [{ day: 0, time: '14:00' }] },
  { id: 'benji', name: 'Benji', turn: '', schedules: [{ day: 0, time: '20:00' }] },
  { id: 'libitina', name: 'Libitina', turn: '', schedules: [{ day: 1, time: '20:00' }, { day: 6, time: '20:00' }] },
  { id: 'rakajeth', name: 'Rakajeth', turn: '', schedules: [{ day: 2, time: '21:00' }, { day: 0, time: '18:00' }] },
  { id: 'icaruthia', name: 'Icaruthia', turn: '', schedules: [{ day: 2, time: '21:00' }, { day: 5, time: '21:00' }] },
  { id: 'motti', name: 'Motti', turn: '', schedules: [{ day: 3, time: '19:00' }, { day: 6, time: '19:00' }] },
  { id: 'nevaeh', name: 'Nevaeh', turn: '', schedules: [{ day: 0, time: '22:00' }] },
  { id: 'tumier', name: 'Tumier', turn: '', schedules: [{ day: 0, time: '18:00' }] },
  { id: 'lucus', name: 'Lucus', turn: '', schedules: [{ day: 6, time: '22:00' }] },
  { id: 'camalia', name: 'Camalia', turn: '', schedules: [{ day: 4, time: '20:00' }] },
]

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

export function dayName(day) {
  return DAY_NAMES[day]
}

export function dayNameInZone(date, timeZone) {
  return DAY_NAMES[weekdayInZone(date, timeZone)]
}

// Cari kemunculan berikutnya (>= now) dari sebuah jadwal {day, time} di WIB
export function nextOccurrenceFor(schedule, now, sourceTz = SOURCE_TZ) {
  return nextOccurrenceInZone(schedule, now, sourceTz)
}

// Ambil kemunculan paling dekat dari semua jadwal boss ini
export function nextSpawnFor(boss, now, sourceTz = SOURCE_TZ) {
  if (!boss?.schedules?.length) return new Date(now.getTime() + 7 * 24 * 3600 * 1000)
  const times = boss.schedules.map((s) => nextOccurrenceFor(s, now, sourceTz).getTime())
  return new Date(Math.min(...times))
}

/** Semua jadwal + next occurrence masing-masing, diurutkan yang paling dekat dulu */
export function upcomingSchedules(boss, now, sourceTz = SOURCE_TZ) {
  return (boss.schedules || [])
    .map((s) => {
      const next = nextOccurrenceFor(s, now, sourceTz)
      return { ...s, next, msLeft: next.getTime() - now.getTime() }
    })
    .sort((a, b) => a.msLeft - b.msLeft)
}
