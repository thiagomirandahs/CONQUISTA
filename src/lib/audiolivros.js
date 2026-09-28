// Regras puras dos audiolivros das Classes (migration 370).
// O livro é ligado ao requisito pelo TÍTULO entre aspas no texto ("Ler o livro da classe: \"Vaso de
// Barro\""). É só apoio de apresentação (mostra o botão de ouvir), nunca regra do requisito. Se uma
// OMD trocar o livro, o título novo não casa e o botão some — nunca toca o livro errado.

const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

export function livroDoRequisito(descricao, livros) {
  if (!descricao || !livros?.length) return null
  const titulos = [...String(descricao).matchAll(/["“”]([^"“”]{2,120})["“”]/g)].map((m) => normalizar(m[1]))
  if (!titulos.length) return null
  return livros.find((l) => titulos.includes(normalizar(l.titulo))) || null
}

// Aceita o ID puro ou os formatos de link comuns do YouTube (watch?v=, youtu.be/, shorts/, embed/).
export function idDoVideo(texto) {
  const s = String(texto || '').trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  const m = s.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
  return m ? m[1] : null
}

// Player sem cookie de rastreio (a CSP só libera este domínio em frame-src).
export const urlDoPlayer = (videoId) =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`

// Progresso de escuta: conveniência deste aparelho (localStorage). Nunca é comprovação de nada.
const chave = (userId, livroId) => `audiolivro:${userId || 'anon'}:${livroId}`

export function lerProgresso(userId, livroId) {
  try {
    const p = JSON.parse(localStorage.getItem(chave(userId, livroId)) || 'null')
    return { atual: Number(p?.atual) || 1, ouvidos: Array.isArray(p?.ouvidos) ? p.ouvidos.map(Number) : [] }
  } catch { return { atual: 1, ouvidos: [] } }
}

export function salvarProgresso(userId, livroId, progresso) {
  try { localStorage.setItem(chave(userId, livroId), JSON.stringify(progresso)) } catch { /* modo privado: segue sem lembrar */ }
}

// Marca o capítulo atual como ouvido e avança para o próximo (fica no último se já acabou).
export function concluirCapitulo(progresso, total) {
  const ouvidos = [...new Set([...progresso.ouvidos, progresso.atual])].sort((a, b) => a - b)
  return { atual: Math.min(progresso.atual + 1, total), ouvidos }
}
