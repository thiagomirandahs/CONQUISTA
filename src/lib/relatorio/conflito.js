// Apresentação do CONFLITO de rascunho (fase 7): horário legível de cada versão e uma prévia curta do texto.
// Funções PURAS — só formatam; quem decide qual versão vale é a pessoa (nada é sobrescrito em silêncio).

export const SEM_HORARIO = 'horário indisponível'
export const LIMITE_PREVIA = 140

const dois = (n) => String(n).padStart(2, '0')
const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Aceita ms (número), ISO (texto) ou Date. Inválido/ausente → null.
function comoData(valor) {
  if (valor == null || valor === '') return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "hoje 14:32" · "ontem 09:10" · "28/09 16:05" · "horário indisponível" (sem valor ou inválido). */
export function formatarHorario(valor, agora = new Date()) {
  const d = comoData(valor)
  if (!d) return SEM_HORARIO
  const hora = `${dois(d.getHours())}:${dois(d.getMinutes())}`
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(d)) / 86400000)
  if (dias === 0) return `hoje ${hora}`
  if (dias === 1) return `ontem ${hora}`
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${hora}`
}

function textos(valor, saida, prof = 0) {
  if (saida.length >= 12 || prof > 6) return
  if (typeof valor === 'string') {
    const t = valor.replace(/\s+/g, ' ').trim()
    if (t) saida.push(t)
  } else if (Array.isArray(valor)) {
    valor.forEach((v) => textos(v, saida, prof + 1))
  } else if (valor && typeof valor === 'object') {
    Object.values(valor).forEach((v) => textos(v, saida, prof + 1))
  }
}

/** Uma linha legível da versão: os primeiros campos de TEXTO do conteúdo (ignora números/marcações), até `max` caracteres. */
export function previaDoConteudo(conteudo, max = LIMITE_PREVIA) {
  const partes = []
  textos(conteudo, partes)
  if (!partes.length) return '(sem texto escrito)'
  const linha = partes.join(' · ')
  return linha.length > max ? `${linha.slice(0, max).trimEnd()}…` : linha
}
