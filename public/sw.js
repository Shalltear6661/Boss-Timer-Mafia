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
    renotify: false,
    silent: false,
    vibrate: data.vibrate || [300, 100, 300, 100, 500],
    requireInteraction: true,
    data: { url: '/', playSound: true, tag: data.tag || 'boss-timer' },
  }

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Kabari tab terbuka: putar suara / sync state
      for (const client of windowClients) {
        try {
          client.postMessage({ type: 'PUSH_RECEIVED', payload: data })
        } catch {
          /* ignore */
        }
      }

      // Hanya skip notifikasi OS jika ada tab yang sedang DIFOKUSKAN
      // (user sedang lihat app). Tab terbuka tapi di background/minimize
      // tetap harus dapat push — timer di background sering di-throttle browser.
      const hasFocused = windowClients.some((c) => c.focused)
      if (hasFocused) return

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
