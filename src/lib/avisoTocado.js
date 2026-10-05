// Ponte "tocou na notificação → abre o popup com o aviso inteiro".
// Quem recebe o toque (Capacitor no APK, service worker no PWA) chama `anunciarAvisoTocado`; o
// componente AvisoTocado escuta. Se o toque chegou antes dele montar (app aberto a frio), o aviso
// fica guardado e é entregue assim que ele pedir.
const EVENTO = 'dbv:aviso-tocado'
let pendente = null

export function linkInterno(l) {
  if (typeof l !== 'string') return null
  const s = l.trim()
  if (s.charAt(0) !== '/' || s.startsWith('//') || /[\s\\]/.test(s)) return null
  return s.slice(0, 200)
}

export function anunciarAvisoTocado({ titulo, corpo, link } = {}) {
  const t = typeof titulo === 'string' ? titulo.trim() : ''
  if (!t) return
  const aviso = { titulo: t, corpo: typeof corpo === 'string' ? corpo : '', link: linkInterno(link) }
  pendente = aviso
  try { window.dispatchEvent(new CustomEvent(EVENTO, { detail: aviso })) } catch { /* sem window */ }
}

export function consumirAvisoPendente() {
  const a = pendente
  pendente = null
  return a
}

export function escutarAvisoTocado(fn) {
  const h = (e) => { pendente = null; fn(e.detail) }
  window.addEventListener(EVENTO, h)
  return () => window.removeEventListener(EVENTO, h)
}

// PWA: o service worker manda { tipo: 'aviso-tocado', ... } e responde ao "pronto" (app recém-aberto).
export function ligarMensagensDoServiceWorker() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return () => {}
  const h = (e) => { if (e.data?.tipo === 'aviso-tocado') anunciarAvisoTocado(e.data) }
  navigator.serviceWorker.addEventListener('message', h)
  try { navigator.serviceWorker.controller?.postMessage({ tipo: 'pronto' }) } catch { /* sem SW */ }
  return () => navigator.serviceWorker.removeEventListener('message', h)
}
