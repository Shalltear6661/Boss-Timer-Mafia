const SW_PATH = '/sw.js'
const SUB_KEY = 'boss-timer-push-sub-v1'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** Apakah browser support Web Push + Service Worker */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

/** Daftarkan service worker */
export async function registerServiceWorker() {
  if (!isPushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
    await navigator.serviceWorker.ready
    return reg
  } catch (e) {
    console.warn('Gagal register service worker:', e)
    return null
  }
}

async function getVapidPublicKey() {
  try {
    const res = await fetch('/api/push-vapid')
    const data = await res.json().catch(() => ({}))
    return data.vapidPublicKey || ''
  } catch {
    return ''
  }
}

export function getStoredSubscription() {
  try {
    const raw = localStorage.getItem(SUB_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function isPushSubscribedLocally() {
  return !!getStoredSubscription()
}

/**
 * Subscribe Web Push + simpan ke server (sheet PushSubs).
 * Panggil setelah Notification.permission === 'granted' (dari gesture user).
 */
export async function subscribeToPush() {
  if (!isPushSupported()) return null
  if (Notification.permission !== 'granted') return null

  const reg = await registerServiceWorker()
  if (!reg) return null

  let subscription = await reg.pushManager.getSubscription()

  if (!subscription) {
    const vapidKey = await getVapidPublicKey()
    if (!vapidKey) {
      console.warn('VAPID public key kosong — set VAPID_PUBLIC_KEY di env')
      return null
    }
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })
    } catch (e) {
      console.warn('Gagal subscribe push:', e)
      return null
    }
  }

  const json = subscription.toJSON()
  localStorage.setItem(SUB_KEY, JSON.stringify(json))

  try {
    await fetch('/api/push-subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: json }),
    })
  } catch (e) {
    console.warn('Gagal sync subscription ke server:', e)
  }

  return subscription
}

export async function unsubscribeFromPush() {
  const reg = await registerServiceWorker()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  const json = sub?.toJSON() || getStoredSubscription()
  if (sub) {
    try {
      await sub.unsubscribe()
    } catch {
      /* ignore */
    }
  }
  localStorage.removeItem(SUB_KEY)
  if (json?.endpoint) {
    try {
      await fetch('/api/push-subscribe', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: json }),
      })
    } catch {
      /* ignore */
    }
  }
}
