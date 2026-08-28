/* Handler de push do PWA — importado pelo service worker gerado pelo Workbox.
   Mostra a notificação quando chega um push e abre a tela certa ao tocar. */

/* Limpeza (hardening 28/08): o cache 'dados-conquista' guardava respostas
   autenticadas do Supabase num cache compartilhado por URL — foi removido do
   vite.config.js, e aqui apagamos o que já existia nos aparelhos. */
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('dados-conquista'))
})

/* O link do push só pode ser caminho INTERNO do app ('/...'). A Edge Function
   já valida no envio; validar de novo aqui protege contra payloads antigos ou
   forjados (nunca abrir http(s)://, javascript:, data: nem //dominio). */
function linkSeguro(l) {
  if (typeof l !== 'string') return '/'
  var s = l.trim()
  if (s.charAt(0) !== '/' || s.slice(0, 2) === '//') return '/'
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c <= 32 || c === 92 || c === 127) return '/'
  }
  return s.slice(0, 200)
}

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
    data: { link: linkSeguro(data.link) },
    // Vibra o aparelho ao chegar (Android; iOS ignora, não tem suporte).
    vibrate: [300, 100, 300, 100, 300],
    // Sem isto o navegador pode empilhar avisos calados — "silent: false"
    // deixa explícito que o som PADRÃO do aparelho toca (não dá pra usar um
    // som customizado em push web; quem manda é o volume/toque do sistema).
    silent: false,
  }
  event.waitUntil(self.registration.showNotification(titulo, opcoes))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = linkSeguro(event.notification.data && event.notification.data.link)
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
