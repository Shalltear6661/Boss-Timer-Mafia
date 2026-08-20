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
    icon: '/favicon.ico',
    badge: '/favicon.ico',
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
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'boss-timer',
    renotify: true,
    vibrate: data.vibrate || [300, 100, 300, 100, 500],
    requireInteraction: true,
    data: { url: '/' },
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Mafia Timer', options))
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
