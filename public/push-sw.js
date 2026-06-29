/* Handler de push do PWA — importado pelo service worker gerado pelo Workbox.
   Mostra a notificação quando chega um push e abre a tela certa ao tocar. */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { titulo: event.data ? event.data.text() : '' }
  }
  const titulo = data.titulo || 'Filhos da Conquista'
  const opcoes = {
    body: data.corpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
  }
  event.waitUntil(self.registration.showNotification(titulo, opcoes))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const c of janelas) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(link)
          return c.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    })
  )
})
