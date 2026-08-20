const NOTIFIED_KEY = 'boss-timer-notified-v1'

/** @type {Map<string, Set<string>>} */
let notified = new Map()

function loadNotified() {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    if (!raw) return
    const obj = JSON.parse(raw)
    notified = new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]))
  } catch {
    notified = new Map()
  }
}

function saveNotified() {
  const obj = {}
  for (const [k, set] of notified) {
    obj[k] = [...set]
  }
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(obj))
}

loadNotified()

/** No-op — suara custom dinonaktifkan; tetap diexport agar App.svelte tidak error */
export async function unlockAudio() {
  return false
}

/** Cek status permission tanpa memicu dialog / audio */
export function isNotificationGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** Request permission — hanya panggil dari klik user */
export async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return false

  let granted = Notification.permission === 'granted'
  if (!granted && Notification.permission !== 'denied') {
    const result = await Notification.requestPermission()
    granted = result === 'granted'
  }

  return granted
}

/**
 * Permission + subscribe Web Push (agar notif tetap muncul saat browser minimize).
 */
export async function enableNotificationsWithPush() {
  const granted = await ensureNotificationPermission()
  if (!granted) return { granted: false, push: false }
  try {
    const { subscribeToPush, isPushSupported } = await import('./push.js')
    if (!isPushSupported()) return { granted: true, push: false }
    const sub = await subscribeToPush()
    return { granted: true, push: !!sub }
  } catch (e) {
    console.warn('Push subscribe gagal:', e)
    return { granted: true, push: false }
  }
}

function markFired(bossId, milestone) {
  if (!notified.has(bossId)) notified.set(bossId, new Set())
  notified.get(bossId).add(milestone)
  saveNotified()
}

function alreadyFired(bossId, milestone) {
  return notified.get(bossId)?.has(milestone) ?? false
}

/** Reset milestone tracking jika boss jauh dari window (cycle baru) */
export function resetIfFar(bossId, msLeft) {
  if (msLeft > 12 * 60 * 1000) {
    if (notified.has(bossId)) {
      notified.delete(bossId)
      saveNotified()
    }
  }
}

const MILESTONES = [
  {
    id: '10',
    match: (ms) => ms <= 10 * 60 * 1000 && ms > 5 * 60 * 1000,
    title: '10 menit lagi',
    body: (name) => `${name} akan spawn dalam 10 menit`,
  },
  {
    id: '5',
    match: (ms) => ms <= 5 * 60 * 1000 && ms > 0,
    title: '5 menit lagi',
    body: (name) => `${name} akan spawn dalam 5 menit`,
  },
  {
    id: 'spawn',
    match: (ms) => ms <= 2000 && ms > -60 * 1000,
    title: 'SPAWN!',
    body: (name) => `${name} sudah waktunya spawn sekarang!`,
  },
]

/**
 * Cek daftar boss dan kirim notifikasi browser jika melewati milestone.
 * Tanpa suara custom (hanya visual / Web Push).
 * @param {Array<{id: string, name: string, msLeft: number}>} items
 */
export function checkAndNotify(items) {
  for (const item of items) {
    resetIfFar(item.id, item.msLeft)

    for (const m of MILESTONES) {
      if (m.match(item.msLeft) && !alreadyFired(item.id, m.id)) {
        markFired(item.id, m.id)

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(m.title, {
              body: m.body(item.name),
              tag: `boss-${item.id}-${m.id}`,
              renotify: true,
            })
          } catch (e) {
            console.warn('Gagal kirim notifikasi:', e)
          }
        }
      }
    }
  }
}
