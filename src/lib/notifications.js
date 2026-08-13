const NOTIFIED_KEY = 'boss-timer-notified-v1'

/** @type {Map<string, Set<string>>} */
let notified = new Map()

/** @type {AudioContext | null} */
let audioCtx = null

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

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}

/** Panggil dari gesture user (klik) agar browser mengizinkan audio */
export async function unlockAudio() {
  const ctx = getAudioContext()
  if (!ctx) return false
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return false
    }
  }
  return ctx.state === 'running'
}

/**
 * Mainkan satu beep pendek.
 * @param {number} freq Hz
 * @param {number} startAt detik relatif ke ctx.currentTime
 * @param {number} duration detik
 * @param {number} volume 0-1
 * @param {'sine'|'square'|'sawtooth'|'triangle'} [type]
 */
function beep(freq, startAt, duration, volume = 0.55, type = 'square') {
  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  // Soft-clip: compressor biar keras tapi tidak pecah total
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.setValueAtTime(-18, startAt)
  compressor.knee.setValueAtTime(8, startAt)
  compressor.ratio.setValueAtTime(6, startAt)
  compressor.attack.setValueAtTime(0.003, startAt)
  compressor.release.setValueAtTime(0.12, startAt)

  osc.type = type
  osc.frequency.value = freq
  const peak = Math.min(0.9, Math.max(0.05, volume))
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain)
  gain.connect(compressor)
  compressor.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.03)
}

/** Pola suara berbeda per milestone — volume tinggi + waveform tajam */
function playAlertSound(milestoneId) {
  const ctx = getAudioContext()
  if (!ctx) return
  // Coba resume jika suspended (best-effort)
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => playAlertSound(milestoneId)).catch(() => {})
    return
  }

  const t = ctx.currentTime
  if (milestoneId === '10') {
    // 3 beep keras
    beep(740, t, 0.22, 0.7)
    beep(740, t + 0.3, 0.22, 0.7)
    beep(880, t + 0.6, 0.28, 0.75)
  } else if (milestoneId === '5') {
    // 4 beep lebih agresif
    beep(880, t, 0.2, 0.75)
    beep(880, t + 0.26, 0.2, 0.75)
    beep(988, t + 0.52, 0.22, 0.8)
    beep(1175, t + 0.8, 0.3, 0.85)
  } else if (milestoneId === 'spawn') {
    // Alarm keras: naik-turun cepat + peak tinggi
    beep(523, t, 0.18, 0.8)
    beep(784, t + 0.2, 0.18, 0.8)
    beep(523, t + 0.4, 0.18, 0.85)
    beep(784, t + 0.6, 0.18, 0.85)
    beep(1046, t + 0.8, 0.22, 0.9)
    beep(1319, t + 1.05, 0.22, 0.9)
    beep(1568, t + 1.3, 0.45, 0.9)
  }
}

/** Cek status permission tanpa memicu dialog / audio */
export function isNotificationGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** Request permission + unlock audio — hanya panggil dari klik user */
export async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return false

  let granted = Notification.permission === 'granted'
  if (!granted && Notification.permission !== 'denied') {
    const result = await Notification.requestPermission()
    granted = result === 'granted'
  }

  // Unlock audio hanya setelah gesture (klik tombol)
  await unlockAudio()
  return granted
}

/**
 * Permission + subscribe Web Push (agar notif tetap muncul saat browser minimize).
 * Import dinamis supaya tidak memecah build jika push gagal.
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
 * Cek daftar boss dan kirim notifikasi + suara jika melewati milestone.
 * @param {Array<{id: string, name: string, msLeft: number}>} items
 */
export function checkAndNotify(items) {
  for (const item of items) {
    resetIfFar(item.id, item.msLeft)

    for (const m of MILESTONES) {
      if (m.match(item.msLeft) && !alreadyFired(item.id, m.id)) {
        markFired(item.id, m.id)

        // Suara selalu diputar (tab terbuka)
        playAlertSound(m.id)

        // Desktop notification jika diizinkan
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(m.title, {
              body: m.body(item.name),
              tag: `boss-${item.id}-${m.id}`,
              renotify: true,
              silent: true, // suara custom kita yang dipakai, hindari double OS sound
            })
          } catch (e) {
            console.warn('Gagal kirim notifikasi:', e)
          }
        }
      }
    }
  }
}
