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
    renotify: true,
    silent: false, // suara sistem OS saat tab tertutup / background
    vibrate: data.vibrate || [300, 100, 300, 100, 500],
    requireInteraction: true,
    // Suara custom (alert.mp3) hanya jika ada tab terbuka
    data: { url: '/', playSound: true },
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Mafia Timer', options),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (const client of windowClients) {
          client.postMessage({ type: 'PLAY_ALERT_SOUND' })
        }
      }),
    ])
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
