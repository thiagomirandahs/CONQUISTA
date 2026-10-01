// Regras puras do fluxo "Registrar classe já concluída" (migration 521). O SERVIDOR é a autoridade
// (permissão, duplicidade, data, vínculo); aqui só validação de conveniência, rótulos e mensagens.

export const IMPACTO_REGISTRO =
  'Isto marcará a classe como concluída anteriormente, poderá satisfazer dependências e liberar a avançada correspondente. Não cria aprovações de requisitos nem documento.'

export const MIN_OBSERVACAO = 5
export const MAX_OBSERVACAO = 500
export const MIN_MOTIVO = 5
export const MAX_MOTIVO = 500

// Só quem pode avaliar o currículo (diretoria|instrutor) vê o fluxo; o servidor confere de novo.
export const podeRegistrarClasseAnterior = (papel) => papel === 'diretoria' || papel === 'instrutor'

export const fmtDataBR = (valor) => {
  if (!valor) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor))
  if (so) return `${so[3]}/${so[2]}/${so[1]}`
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}

export const hojeISO = (agora = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`
}

// -> { campo: mensagem } (vazio = ok)
export function validarRegistro({ classId, data, dataDesconhecida, observacao }, hoje = hojeISO()) {
  const erros = {}
  if (!classId) erros.classe = 'Escolha a classe.'
  if (!dataDesconhecida) {
    if (!data) erros.data = 'Informe a data ou marque "Não sei a data".'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < '1950-01-01') erros.data = 'Data inválida.'
    else if (data > hoje) erros.data = 'A data não pode ser no futuro.'
  }
  const obs = String(observacao || '').trim()
  if (obs.length < MIN_OBSERVACAO) erros.observacao = `Conte de onde vem esta informação (mínimo ${MIN_OBSERVACAO} letras).`
  else if (obs.length > MAX_OBSERVACAO) erros.observacao = `No máximo ${MAX_OBSERVACAO} caracteres.`
  return erros
}

export function validarMotivo(motivo) {
  const m = String(motivo || '').trim()
  if (m.length < MIN_MOTIVO) return `Explique o motivo (mínimo ${MIN_MOTIVO} letras).`
  if (m.length > MAX_MOTIVO) return `No máximo ${MAX_MOTIVO} caracteres.`
  return ''
}

// Banco sem a 521 (função inexistente): o fluxo some, sem quebrar nada.
export const rpcAusente = (erro) => {
  const t = String(erro?.message || erro || '')
  return /does not exist|could not find the function|schema cache|PGRST202|42883/i.test(t)
}

const MENSAGENS = [
  [/j[aá] consta como conclu[ií]da/i, 'Esta classe já consta como concluída por esta pessoa.'],
  [/matr[ií]cula|em andamento|j[aá] iniciou|j[aá] est[aá] (iniciada|em)/i, 'Esta pessoa já tem esta classe em andamento. Termine por ela, em vez de registrar como concluída.'],
  [/futuro/i, 'A data da conclusão não pode ser no futuro.'],
  [/anterior ao nascimento/i, 'A data da conclusão não pode ser antes do nascimento da pessoa.'],
  [/data da conclus[aã]o inv[aá]lida/i, 'A data da conclusão é inválida.'],
  [/informe a data|n[aã]o sei a data/i, 'Informe a data ou marque "Não sei a data".'],
  [/n[aã]o informe a data/i, 'Se a data é desconhecida, deixe a data em branco.'],
  [/observa[cç][aã]o/i, 'Conte de onde vem esta informação (mínimo 5 letras).'],
  [/motivo/i, 'Explique o motivo (mínimo 5 letras).'],
  [/Pe[cç]a a outra pessoa/i, 'Ninguém registra a própria classe. Peça a outra pessoa da liderança.'],
  [/sem permiss[aã]o|apenas diretoria/i, 'Só a diretoria e os instrutores do clube podem fazer isto.'],
  [/sem v[ií]nculo ativo/i, 'Esta pessoa não está ativa neste clube.'],
  [/Classe n[aã]o encontrada/i, 'Não encontrei esta classe. Escolha outra.'],
  [/comprovante.*outro registro/i, 'Este comprovante já foi usado em outro registro. Envie de novo.'],
  [/comprovante/i, 'Não consegui validar o comprovante. Envie a foto de novo ou registre sem ele.'],
  [/j[aá] foi corrigido|j[aá] revogad|n[aã]o pode ser corrigido/i, 'Este registro já foi corrigido ou não pode mais ser alterado.'],
  [/Failed to fetch|NetworkError|network/i, 'Parece que a internet caiu. Confira a conexão e tente de novo.'],
  [/JWT|expired|401/i, 'Sua sessão expirou. Entre de novo para continuar.'],
]
export function mensagemRegistro(erro) {
  const bruto = typeof erro === 'string' ? erro : (erro?.message || '')
  for (const [regra, texto] of MENSAGENS) if (regra.test(bruto)) return texto
  return 'Não deu certo agora. Tente de novo em instantes — nada foi registrado.'
}

// Rótulo da origem de uma conclusão (lista da liderança).
export function rotuloOrigem(c) {
  if (!c) return ''
  if (c.origem === 'registro_anterior') {
    const em = fmtDataBR(c.registrado_em)
    const por = c.registrado_por_nome
    return `Concluída anteriormente${em || por ? ' · Registrada' : ''}${em ? ` em ${em}` : ''}${por ? ` por ${por}` : ''}`
  }
  if (c.origem === 'outro_clube' || c.neste_clube === false) return `Concluída em outro clube${c.clube_nome ? ` (${c.clube_nome})` : ''}`
  return 'Concluída no app'
}

export const rotuloData = (c) => {
  const d = fmtDataBR(c?.concluida_em)
  if (d) return `Concluída em ${d}`
  return 'Data da conclusão desconhecida'
}
