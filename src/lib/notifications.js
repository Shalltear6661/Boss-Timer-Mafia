const NOTIFIED_KEY = 'boss-timer-notified-v1'
const AUDIO_UNLOCK_KEY = 'boss-timer-audio-unlocked-v1'
const ALERT_SOUND_URL = '/alert.mp3'

/** Suara per milestone: notif10 / notif5 / spawn */
const MILESTONE_SOUNDS = {
  '10': {
    soundUrl: '/notif10.wav',
    tones: [
      { freq: 660, dur: 0.18, gap: 0.08 },
      { freq: 880, dur: 0.28, gap: 0 },
    ],
  },
  '5': {
    soundUrl: '/notif5.wav',
    tones: [
      { freq: 740, dur: 0.14, gap: 0.06 },
      { freq: 740, dur: 0.14, gap: 0.06 },
      { freq: 988, dur: 0.32, gap: 0 },
    ],
  },
  spawn: {
    soundUrl: '/spawn.wav',
    tones: [
      { freq: 523, dur: 0.12, gap: 0.05 },
      { freq: 659, dur: 0.12, gap: 0.05 },
      { freq: 784, dur: 0.12, gap: 0.05 },
      { freq: 1046, dur: 0.45, gap: 0 },
    ],
  },
}

/** @type {Map<string, Set<string>>} */
let notified = new Map()

/** @type {Map<string, HTMLAudioElement>} */
const audioCache = new Map()
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

function getAlertAudio(url = ALERT_SOUND_URL) {
  if (typeof Audio === 'undefined') return null
  let audio = audioCache.get(url)
  if (!audio) {
    audio = new Audio(url)
    audio.preload = 'auto'
    audio.volume = 1
    // iOS Safari: wajib agar play() tidak dianggap video fullscreen
    audio.setAttribute('playsinline', 'true')
    audio.playsInline = true
    audioCache.set(url, audio)
  }
  return audio
}

async function resumeAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    if (!audioCtx) audioCtx = new Ctx()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

/** Nada sintetis berbeda per milestone (fallback jika file belum ada) */
async function playToneSequence(tones) {
  const ctx = await resumeAudioContext()
  if (!ctx || !tones?.length) return false
  try {
    let t = ctx.currentTime + 0.02
    for (const tone of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = tone.freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + tone.dur + 0.02)
      t += tone.dur + (tone.gap || 0)
    }
    await new Promise((r) => setTimeout(r, Math.ceil((t - ctx.currentTime) * 1000) + 40))
    return true
  } catch (e) {
    console.warn('Gagal putar tone:', e)
    return false
  }
}

async function playMp3(url) {
  const audio = getAlertAudio(url)
  if (!audio) return false
  try {
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    audio.volume = 1
    await audio.play()
    return true
  } catch {
    return false
  }
}

/** Unlock audio setelah gesture user (klik / tap) — wajib di Chrome/Safari */
export async function unlockAudio() {
  await resumeAudioContext()
  // Unlock pakai notif10 (file utama); fallback alert.mp3
  const unlockUrl = MILESTONE_SOUNDS['10'].soundUrl
  const audio = getAlertAudio(unlockUrl) || getAlertAudio(ALERT_SOUND_URL)
  if (!audio) return false
  try {
    audio.muted = true
    await audio.play()
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
    // Preload semua suara milestone
    for (const cfg of Object.values(MILESTONE_SOUNDS)) {
      getAlertAudio(cfg.soundUrl)
    }
    getAlertAudio(ALERT_SOUND_URL)
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

/** Debounce: cegah suara sama diputar 2x (local timer + push) */
let lastPlayKey = ''
let lastPlayAt = 0
const PLAY_DEDUP_MS = 12_000

/**
 * Claim milestone dari tag push (`boss-{id}-{10|5|spawn}`).
 * Return false jika sudah pernah di-fire (hindari double sound).
 */
export function claimFromPushTag(tag) {
  const raw = String(tag || '')
  const m = raw.match(/^boss-(.+)-(10|5|spawn)$/)
  if (!m) return true
  return tryClaimFire(m[1], m[2])
}

/**
 * Putar suara alert sesuai milestone.
 * @param {string} [milestoneId] '10' | '5' | 'spawn'
 * @param {string} [_bossName] nama boss (opsional)
 * @param {{ force?: boolean }} [opts] force=true lewati dedupe (untuk Tes Suara)
 */
export async function playAlertSound(milestoneId = 'spawn', _bossName = '', opts = {}) {
  await resumeAudioContext()
  try {
    if (!audioUnlocked) {
      const ok = await unlockAudio()
      if (!ok) return false
    }

    const key = String(milestoneId || 'spawn')
    const now = Date.now()
    if (!opts.force && key === lastPlayKey && now - lastPlayAt < PLAY_DEDUP_MS) {
      return true
    }
    lastPlayKey = key
    lastPlayAt = now

    // Stop clip lain supaya tidak overlap
    for (const a of audioCache.values()) {
      try {
        a.pause()
        a.currentTime = 0
      } catch {
        /* ignore */
      }
    }

    const cfg = MILESTONE_SOUNDS[milestoneId] || MILESTONE_SOUNDS.spawn
    let played = await playMp3(cfg.soundUrl)
    if (!played) {
      // Fallback: tone sintetis, lalu alert.mp3 generik
      played = await playToneSequence(cfg.tones)
      if (!played) played = await playMp3(ALERT_SOUND_URL)
    }

    if (played) markAudioUnlocked()
    return played
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
    if (!isPushSupported()) {
      return { granted: true, push: false, sound, pushError: 'browser_unsupported' }
    }
    const { subscription, error } = await subscribeToPush()
    return { granted: true, push: !!subscription, sound, pushError: error || '' }
  } catch (e) {
    console.warn('Push subscribe gagal:', e)
    return { granted: true, push: false, sound, pushError: 'subscribe_failed' }
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
    body: (name) => `${name} akan spawn 10 menit lagi`,
  },
  {
    id: '5',
    match: (ms) => ms <= 5 * 60 * 1000 && ms > 0,
    title: '5 menit lagi',
    body: (name) => `${name} akan spawn 5 menit lagi`,
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
 * Suara berbeda per milestone (nada + ucapan) jika tab terbuka + audio unlocked.
 * @param {Array<{id: string, name: string, msLeft: number}>} items
 */
export function checkAndNotify(items) {
  for (const item of items) {
    resetIfFar(item.id, item.msLeft)

    for (const m of MILESTONES) {
      if (m.match(item.msLeft) && tryClaimFire(item.id, m.id)) {
        playAlertSound(m.id, item.name).then((played) => {
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
