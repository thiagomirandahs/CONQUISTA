// Acessibilidade: tamanho de letra (A− / A / A+ / A++) e alto contraste.
//
// Público: crianças, pais e coordenadores idosos, todos no celular. A escolha fica NA CONTA
// (profiles.preferencias, migration 420 — vale em qualquer aparelho) e também numa cópia local,
// que o index.html aplica ANTES do React subir (sem "pulo" de letra pequena → grande).
//
// Como escala o app inteiro: o Tailwind 4 mede tudo em rem, então mudar o font-size do <html>
// (em %, para respeitar a letra que a pessoa já escolheu no celular) aumenta texto, espaçamento
// e alvos de toque juntos. O alto contraste é um atributo no <html> que troca os tokens de cor
// (index.css) — por cima do tema claro/escuro, sem substituí-lo.

export const CHAVE_LOCAL = 'acessibilidade'

// A ordem importa: é a ordem dos botões A− / A / A+ / A++.
export const FONTES = [
  { valor: 'pequena', rotulo: 'A−', nome: 'Letra menor', escala: 0.9 },
  { valor: 'normal', rotulo: 'A', nome: 'Letra normal', escala: 1 },
  { valor: 'grande', rotulo: 'A+', nome: 'Letra grande', escala: 1.15 },
  { valor: 'enorme', rotulo: 'A++', nome: 'Letra muito grande', escala: 1.3 },
]

export const PADRAO = Object.freeze({ fonte: 'normal', alto_contraste: false })

// Qualquer coisa que venha do banco ou do localStorage passa por aqui: valor desconhecido vira o padrão.
export function normalizarPreferencias(p) {
  const fonte = FONTES.some((f) => f.valor === p?.fonte) ? p.fonte : PADRAO.fonte
  return { fonte, alto_contraste: p?.alto_contraste === true }
}

export function escalaDaFonte(fonte) {
  return (FONTES.find((f) => f.valor === fonte) || FONTES[1]).escala
}

// Aplica no <html>. Letra normal = sem estilo inline (volta ao 100% do navegador).
export function aplicarPreferencias(p, raiz = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!raiz) return
  const { fonte, alto_contraste } = normalizarPreferencias(p)
  const escala = escalaDaFonte(fonte)
  raiz.style.fontSize = escala === 1 ? '' : `${Math.round(escala * 100)}%`
  if (alto_contraste) raiz.setAttribute('data-contraste', 'alto')
  else raiz.removeAttribute('data-contraste')
}

export function lerPreferenciasLocais() {
  try {
    const bruto = localStorage.getItem(CHAVE_LOCAL)
    return normalizarPreferencias(bruto ? JSON.parse(bruto) : null)
  } catch {
    return { ...PADRAO }
  }
}

export function guardarPreferenciasLocais(p) {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(normalizarPreferencias(p))) } catch { /* sem storage */ }
}

// A conta manda: quando o perfil chega com preferência gravada, ela vale (e vira a cópia local).
// Perfil sem preferência ({}): mantém o que o aparelho já tinha.
export function sincronizarComPerfil(preferenciasDoPerfil) {
  if (!preferenciasDoPerfil || typeof preferenciasDoPerfil !== 'object' || !('fonte' in preferenciasDoPerfil)) return null
  const p = normalizarPreferencias(preferenciasDoPerfil)
  guardarPreferenciasLocais(p)
  aplicarPreferencias(p)
  return p
}
