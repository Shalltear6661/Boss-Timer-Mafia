// Boss dengan jadwal tetap mingguan (bukan berdasarkan interval/kematian).
// day mengikuti Date.getDay(): 0=Minggu, 1=Senin, ..., 6=Sabtu
// time dalam format 24 jam "HH:mm", diasumsikan zona waktu sama dengan
// browser yang menjalankan app ini (WIB).

export const weeklyBosses = [
  { id: 'clemantis', name: 'Clemantis', schedules: [{ day: 1, time: '11:30' }, { day: 4, time: '19:00' }] },
  { id: 'saphirus', name: 'Saphirus', schedules: [{ day: 0, time: '17:00' }, { day: 2, time: '11:30' }] },
  { id: 'neutro', name: 'Neutro', schedules: [{ day: 2, time: '19:00' }, { day: 4, time: '11:30' }] },
  { id: 'thymele', name: 'Thymele', schedules: [{ day: 1, time: '19:00' }, { day: 3, time: '11:30' }] },
  { id: 'milavy', name: 'Milavy', schedules: [{ day: 6, time: '15:00' }] },
  { id: 'ringor', name: 'Ringor', schedules: [{ day: 6, time: '17:00' }] },
  { id: 'roderick', name: 'Roderick', schedules: [{ day: 5, time: '19:00' }] },
  { id: 'auraq', name: 'Auraq', schedules: [{ day: 3, time: '21:00' }, { day: 5, time: '22:00' }] },
  { id: 'chaiflock', name: 'Chaiflock', schedules: [{ day: 0, time: '15:00' }] },
  { id: 'benji', name: 'Benji', schedules: [{ day: 0, time: '21:00' }] },
  { id: 'libitina', name: 'Libitina', schedules: [{ day: 1, time: '21:00' }, { day: 6, time: '21:00' }] },
  { id: 'rakajeth', name: 'Rakajeth', schedules: [{ day: 2, time: '22:00' }, { day: 0, time: '19:00' }] },
  { id: 'tumier', name: 'Tumier', schedules: [{ day: 0, time: '19:00' }] },
  { id: 'camalia', name: 'Camalia', schedules: [{ day: 4, time: '21:00' }] },
]

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jumat", 'Sabtu']

export function dayName(day) {
  return DAY_NAMES[day]
}

// Cari kemunculan berikutnya (>= now) dari sebuah jadwal {day, time}
function nextOccurrenceFor(schedule, now) {
  const [h, m] = schedule.time.split(':').map(Number)
  const candidate = new Date(now)
  candidate.setHours(h, m, 0, 0)
  const todayDay = now.getDay()
  let diffDays = (schedule.day - todayDay + 7) % 7
  if (diffDays === 0 && candidate.getTime() <= now.getTime()) {
    diffDays = 7
  }
  candidate.setDate(candidate.getDate() + diffDays)
  return candidate
}

// Ambil kemunculan paling dekat dari semua jadwal boss ini
export function nextSpawnFor(boss, now) {
  const times = boss.schedules.map((s) => nextOccurrenceFor(s, now).getTime())
  return new Date(Math.min(...times))
}
