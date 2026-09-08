self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {
    title: 'Mafia Timer',
    body: '',
    icon: '/3551739.jpg',
    badge: '/3551739.jpg',
  }
  if (event.data) {
    try {
      const parsed = event.data.json()
      if (parsed && typeof parsed === 'object') {
        data = { ...data, ...parsed }
      }
    } catch {
      data.body = event.data.text()
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/3551739.jpg',
    badge: data.badge || '/3551739.jpg',
    tag: data.tag || 'boss-timer',
    renotify: false, // jangan bunyi ulang jika tag sama
    silent: false,
    vibrate: data.vibrate || [300, 100, 300, 100, 500],
    requireInteraction: true,
    data: { url: '/', playSound: true },
  }

  event.waitUntil(
    (async () => {
      // Jika ada tab terbuka, biarkan client (checkAndNotify) yang handle —
      // hindari notifikasi dobel: local Notification + Web Push.
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      if (windowClients.length > 0) {
        return
      }

      await self.registration.showNotification(data.title || 'Mafia Timer', options)
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate?.(targetUrl)
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl)
    })
  )
})
