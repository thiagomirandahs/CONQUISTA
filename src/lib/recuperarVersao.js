// Recuperação AUTOMÁTICA de versão velha. Depois de um deploy, o celular pode continuar com o
// index.html antigo (cache do service worker/navegador), que pede pedaços do app (chunks) que não
// existem mais no servidor → tela branca / "Precisamos atualizar". Visto várias vezes no piloto.
// Aqui: desliga o service worker, apaga os caches e recarrega buscando a página NOVA — sozinho,
// sem a pessoa precisar limpar dados do site. Trava por tempo (não por sessão) para nunca virar
// laço de recarga, mas permitir de novo num próximo deploy.
const CHAVE = 'cq.recuperouVersaoEm'
const INTERVALO_MS = 60_000

export function ehErroDeVersao(erro) {
  const msg = String(erro?.message || erro || '')
  return /dynamically imported module|module script failed|ChunkLoadError|Failed to fetch|Loading chunk|CSS chunk|Importing a module script failed|error loading dynamically/i.test(msg)
}

export function podeRecuperarAgora(agora = Date.now()) {
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem(CHAVE) || 0) } catch { /* sem storage */ }
  return agora - ultima > INTERVALO_MS
}

export async function recuperarVersao({ forcar = false } = {}) {
  if (!forcar && !podeRecuperarAgora()) return false
  try { sessionStorage.setItem(CHAVE, String(Date.now())) } catch { /* sem storage */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    if (regs) await Promise.all(regs.map((r) => r.unregister()))
    const chaves = await globalThis.caches?.keys?.()
    if (chaves) await Promise.all(chaves.map((k) => caches.delete(k)))
  } catch { /* ignora */ }
  // parâmetro novo na URL: o navegador não pode responder com o index.html velho do cache HTTP
  const u = new URL(window.location.href)
  u.searchParams.set('v', String(Date.now()))
  window.location.replace(u.toString())
  return true
}
