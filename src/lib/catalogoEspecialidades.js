// Regras puras do catálogo de especialidades (migration 460): busca sem acento e atalho a partir do
// texto do requisito de classe ("Completar a especialidade de Acampamento I").
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export function filtrar(lista, { busca = '', area = '' } = {}) {
  const b = normalizar(busca)
  return lista.filter((e) => (!area || e.area === area) && (!b || normalizar(`${e.nome} ${e.codigo}`).includes(b)))
}

// Requisito de classe que fala de especialidade → termo para abrir o catálogo já filtrado.
// "Completar a especialidade de X" → "X"; "1 destas especialidades: A, B ou C" → "" (abre o catálogo inteiro).
export function termoDoRequisito(descricao) {
  const d = String(descricao || '')
  if (!/especialidade/i.test(d)) return null
  const m = d.match(/especialidade de ([^.,;:]+?)(?:,|\.|;| se | que |$)/i)
  return m ? m[1].trim() : ''
}

export const rotuloNivel = (n) => (n ? '★'.repeat(n) : '')
