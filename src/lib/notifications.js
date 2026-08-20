const NOTIFIED_KEY = 'boss-timer-notified-v1'
const ALERT_SOUND_URL = '/alert.mp3'

/** @type {Map<string, Set<string>>} */
let notified = new Map()

/** @type {HTMLAudioElement | null} */
let alertAudio = null
let audioUnlocked = false

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

function getAlertAudio() {
  if (typeof Audio === 'undefined') return null
  if (!alertAudio) {
    alertAudio = new Audio(ALERT_SOUND_URL)
    alertAudio.preload = 'auto'
    alertAudio.volume = 1
  }
  return alertAudio
}

/** Unlock audio setelah gesture user (klik / tap) — wajib di Chrome */
export async function unlockAudio() {
  const audio = getAlertAudio()
  if (!audio) return false
  try {
    audio.muted = true
    await audio.play()
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    audioUnlocked = true
    return true
  } catch {
    return false
  }
}

/** Putar suara alert custom */
export async function playAlertSound() {
  const audio = getAlertAudio()
  if (!audio) return false
  try {
    if (!audioUnlocked) {
      await unlockAudio()
    }
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    audio.volume = 1
    await audio.play()
    return true
  } catch (e) {
    console.warn('Gagal putar suara notif:', e)
    return false
  }
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
  // Unlock audio saat user klik izinkan notif
  await unlockAudio()
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
 * Suara custom (alert.mp3) diputar jika tab masih terbuka.
 * @param {Array<{id: string, name: string, msLeft: number}>} items
 */
export function checkAndNotify(items) {
  for (const item of items) {
    resetIfFar(item.id, item.msLeft)

    for (const m of MILESTONES) {
      if (m.match(item.msLeft) && !alreadyFired(item.id, m.id)) {
        markFired(item.id, m.id)
        playAlertSound()

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(m.title, {
              body: m.body(item.name),
              tag: `boss-${item.id}-${m.id}`,
              renotify: true,
              silent: true, // suara custom sudah diputar; hindari double sound OS
            })
          } catch (e) {
            console.warn('Gagal kirim notifikasi:', e)
          }
        }
      }
    }
  }
}
