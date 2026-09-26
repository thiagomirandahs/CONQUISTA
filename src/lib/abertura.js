// Abertura sem JS (index.html #abertura): sai com fade quando o React já pintou por baixo.
// Com movimento reduzido, sai na hora. Chamar duas vezes não faz nada.
export function encerrarAbertura(doc = typeof document !== 'undefined' ? document : null) {
  const el = doc?.getElementById('abertura')
  if (!el || el.dataset.saindo) return
  el.dataset.saindo = '1'
  const reduzido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduzido) { el.remove(); return }
  // dois frames: garante que a primeira tela do React já foi pintada antes do fade começar
  // (com a aba em segundo plano o rAF não roda — o setTimeout garante que ela sai assim mesmo)
  let foi = false
  const sair = () => {
    if (foi) return
    foi = true
    el.classList.add('saindo')
    setTimeout(() => el.remove(), 320)
  }
  const raf = window.requestAnimationFrame || ((f) => setTimeout(f, 16))
  raf(() => raf(sair))
  setTimeout(sair, 150)
}
