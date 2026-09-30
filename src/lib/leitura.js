// Regras puras do catálogo de leitura (migration 514). Só apresentação: o currículo é a fonte do requisito.

export const FILTROS = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'minha_classe', rotulo: 'Minha Classe' },
  { chave: 'curso', rotulo: 'Curso de Leitura' },
  { chave: 'com_audio', rotulo: 'Com áudio' },
  { chave: 'concluidos', rotulo: 'Concluídos' },
]

export const SEM_VERSAO_DIGITAL = 'A versão digital não está disponível.'

// "excursionista" -> "Excursionista"; "amigo_avancado" -> "Amigo avancado"
export function rotuloClasse(slug) {
  const s = String(slug || '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

export function subtitulo(m) {
  if (m.tipo === 'curso_leitura') return m.ano ? `Curso de Leitura ${m.ano}` : 'Curso de Leitura'
  const classe = m.classe_manifesto ? `Classe ${rotuloClasse(m.classe_manifesto)}` : ''
  return [classe, m.ano && m.tipo !== 'livro_classe' ? String(m.ano) : ''].filter(Boolean).join(' · ')
}

export function iniciaisDoTitulo(titulo) {
  const partes = String(titulo || '').split(/\s+/).filter((p) => p.length > 2)
  const base = partes.length ? partes : String(titulo || '').split(/\s+/).filter(Boolean)
  return base.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?'
}

// Gradiente estável por título (sem aleatório: a mesma capa-placeholder sempre).
const PAR = [['#0b1f4d', '#1d4ed8'], ['#07122f', '#0f766e'], ['#1e1b4b', '#7c3aed'], ['#0c2a4d', '#b45309'], ['#10233f', '#9a3412']]
export function gradienteDoTitulo(titulo) {
  let h = 0
  for (const c of String(titulo || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const [a, b] = PAR[h % PAR.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

export const temProgresso = (m) => !!m?.progresso && !m.progresso.concluido && ((m.progresso.posicao_seg || 0) > 0 || (m.progresso.capitulo || 1) > 1)
export const estaConcluido = (m) => !!m?.progresso?.concluido
export const temAudio = (m) => m?.tem_audio === true
export const temVersaoDigital = (m) => !!(m?.book_url || m?.pdf_url || temAudio(m))

// Texto do botão do card: CONTINUAR (há progresso) · OUVIR (só áudio) · VER LIVRO
export function acaoDoCard(m) {
  if (temProgresso(m)) return 'CONTINUAR'
  if (temAudio(m) && !m.book_url) return 'OUVIR'
  return 'VER LIVRO'
}

// Só links https (o servidor já recusa http://, mas nunca confiamos na tela para abrir esquema estranho).
export const linkSeguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null)

// Auditoria: campos que mudaram (antes -> depois). `atualizado_em` é ruído e fica de fora.
export function diferencas(antes, depois) {
  const a = antes || {}, d = depois || {}
  const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])].filter((k) => k !== 'atualizado_em' && k !== 'id' && k !== 'criado_em')
  return campos.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(d[k] ?? null)).map((k) => ({ campo: k, antes: a[k] ?? null, depois: d[k] ?? null }))
}
