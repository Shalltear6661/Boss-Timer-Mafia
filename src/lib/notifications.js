const NOTIFIED_KEY = 'boss-timer-notified-v1'
const AUDIO_UNLOCK_KEY = 'boss-timer-audio-unlocked-v1'
const ALERT_SOUND_URL = '/alert.mp3'

/** @type {Map<string, Set<string>>} */
let notified = new Map()

/** @type {HTMLAudioElement | null} */
let alertAudio = null
/** @type {AudioContext | null} */
let audioCtx = null
let audioUnlocked = false

try {
  audioUnlocked = localStorage.getItem(AUDIO_UNLOCK_KEY) === '1'
} catch {
  /* ignore */
}

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

function markAudioUnlocked() {
  audioUnlocked = true
  try {
    localStorage.setItem(AUDIO_UNLOCK_KEY, '1')
  } catch {
    /* ignore */
  }
}

function getAlertAudio() {
  if (typeof Audio === 'undefined') return null
  if (!alertAudio) {
    alertAudio = new Audio(ALERT_SOUND_URL)
    alertAudio.preload = 'auto'
    alertAudio.volume = 1
    // iOS Safari: wajib agar play() tidak dianggap video fullscreen
    alertAudio.setAttribute('playsinline', 'true')
    alertAudio.playsInline = true
  }
  return alertAudio
}

async function resumeAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    if (!audioCtx) audioCtx = new Ctx()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
  } catch {
    /* ignore */
  }
}

/** Unlock audio setelah gesture user (klik / tap) — wajib di Chrome/Safari */
export async function unlockAudio() {
  await resumeAudioContext()
  const audio = getAlertAudio()
  if (!audio) return false
  try {
    audio.muted = true
    await audio.play()
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    markAudioUnlocked()
    return true
  } catch (e) {
    console.warn('Unlock audio gagal (butuh klik user dulu):', e?.message || e)
    return false
  }
}

export function isAudioUnlocked() {
  return audioUnlocked
}

/** Putar suara alert custom */
export async function playAlertSound() {
  await resumeAudioContext()
  const audio = getAlertAudio()
  if (!audio) return false
  try {
    if (!audioUnlocked) {
      const ok = await unlockAudio()
      if (!ok) return false
    }
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    audio.volume = 1
    await audio.play()
    markAudioUnlocked()
    return true
  } catch (e) {
    console.warn('Gagal putar suara notif:', e)
    audioUnlocked = false
    return false
  }
}

/** Cek status permission tanpa memicu dialog / audio */
export function isNotificationGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export function getNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** Request permission — hanya panggil dari klik user */
export async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return false

  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false

  // Harus dari user gesture; Chrome kadang butuh Promise API
  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

/**
 * Permission + unlock suara + subscribe Web Push.
 */
export async function enableNotificationsWithPush() {
  if (typeof Notification === 'undefined') {
    return { granted: false, push: false, sound: false, reason: 'unsupported' }
  }
  if (Notification.permission === 'denied') {
    return { granted: false, push: false, sound: false, reason: 'denied' }
  }

  const granted = await ensureNotificationPermission()
  if (!granted) {
    return {
      granted: false,
      push: false,
      sound: false,
      reason: Notification.permission === 'denied' ? 'denied' : 'dismissed',
    }
  }

  // Unlock audio SAAT klik — ini satu-satunya “izin suara” yang browser izinkan
  const sound = await unlockAudio()

  try {
    const { subscribeToPush, isPushSupported } = await import('./push.js')
    if (!isPushSupported()) return { granted: true, push: false, sound }
    const sub = await subscribeToPush()
    return { granted: true, push: !!sub, sound }
  } catch (e) {
    console.warn('Push subscribe gagal:', e)
    return { granted: true, push: false, sound }
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

/** Claim sekali per milestone — aman multi-tab via localStorage + BroadcastChannel */
function tryClaimFire(bossId, milestone) {
  loadNotified()
  if (alreadyFired(bossId, milestone)) return false
  markFired(bossId, milestone)
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('boss-timer-notif')
      bc.postMessage({ type: 'fired', bossId, milestone })
      bc.close()
    }
  } catch {
    /* ignore */
  }
  return true
}

try {
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel('boss-timer-notif')
    bc.onmessage = (event) => {
      if (event.data?.type === 'fired' && event.data.bossId && event.data.milestone) {
        markFired(event.data.bossId, event.data.milestone)
      }
    }
  }
} catch {
  /* ignore */
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
    // Window lebih lebar: tab di background sering di-throttle, interval 1s bisa miss 2 detik
    match: (ms) => ms <= 15 * 1000 && ms > -60 * 1000,
    title: 'SPAWN!',
    body: (name) => `${name} sudah waktunya spawn sekarang!`,
  },
]

/**
 * Cek daftar boss dan kirim notifikasi browser jika melewati milestone.
 * Suara custom (alert.mp3) diputar jika tab masih terbuka + audio sudah di-unlock.
 * @param {Array<{id: string, name: string, msLeft: number}>} items
 */
export function checkAndNotify(items) {
  for (const item of items) {
    resetIfFar(item.id, item.msLeft)

    for (const m of MILESTONES) {
      if (m.match(item.msLeft) && tryClaimFire(item.id, m.id)) {
        // Coba suara custom; jika gagal, biarkan notifikasi OS bunyi (silent: false)
        playAlertSound().then((played) => {
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          try {
            new Notification(m.title, {
              body: m.body(item.name),
              tag: `boss-${item.id}-${m.id}`,
              renotify: false,
              icon: '/3551739.jpg',
              silent: played,
            })
          } catch (e) {
            console.warn('Gagal kirim notifikasi:', e)
          }
        })
      }
    }
  }
}
