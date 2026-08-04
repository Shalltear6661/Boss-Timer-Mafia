// Data awal diambil dari spreadsheet.
// lastDeath disimpan dalam ISO string zona waktu WIB (+07:00).
// Setelah boss respawn/di-kill, waktu ini akan di-update otomatis
// lewat tombol "Tandai Mati" dan disimpan ke localStorage.

export const initialBosses = [
  { id: 'venatus', name: 'Venatus', level: 60, spawnIntervalHours: 10, lastDeath: '2026-07-31T21:11:00+07:00' },
  { id: 'viorent', name: 'Viorent', level: 65, spawnIntervalHours: 10, lastDeath: '2026-07-31T21:17:00+07:00' },
  { id: 'ego', name: 'Ego', level: 70, spawnIntervalHours: 21, lastDeath: '2026-07-31T11:25:00+07:00' },
  { id: 'livera', name: 'Livera', level: 75, spawnIntervalHours: 24, lastDeath: '2026-07-31T11:39:00+07:00' },
  { id: 'lady-dalia', name: 'Lady Dalia', level: 85, spawnIntervalHours: 18, lastDeath: '2026-07-31T21:07:00+07:00' },
  { id: 'undomiel', name: 'Undomiel', level: 80, spawnIntervalHours: 24, lastDeath: '2026-07-31T20:33:00+07:00' },
  { id: 'araneo', name: 'Araneo', level: 75, spawnIntervalHours: 24, lastDeath: '2026-07-31T20:47:00+07:00' },
  { id: 'baron', name: 'Baron', level: 88, spawnIntervalHours: 32, lastDeath: '2026-07-31T22:18:00+07:00' },
]
