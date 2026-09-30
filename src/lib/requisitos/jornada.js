// Regras PURAS da jornada da Minha Classe. Só APRESENTAM o que o servidor devolveu em `minha_classe`:
// o percentual e o "concluído" são do servidor (nunca calculados aqui); as contagens abaixo apenas
// agrupam o `status` que cada requisito já traz.

const COM_ACAO = ['nao_iniciado', 'em_andamento', 'correcao_solicitada']

const temConteudo = (o) => !!o && typeof o === 'object' && Object.keys(o).length > 0

/**
 * Status de jornada de UM requisito (um dos 7 de <StatusRequisito>).
 * 'enviado' nunca é devolvido: o servidor não distingue "acabou de enviar" de "aguardando avaliação"
 * (os dois são `aguardando_avaliacao`), então o requisito enviado aparece como 'aguardando'.
 * `formulario` = item de classe_formularios (rascunho estruturado), quando existir.
 */
export function statusDaJornada(r, formulario = null) {
  if (r.status === 'aprovado') return 'aprovado'
  if (r.status === 'aguardando_avaliacao') return 'aguardando'
  if (r.status === 'correcao_solicitada') return 'correcao'
  if ((r.bloqueios || []).length > 0) return 'bloqueado'
  if (r.status === 'em_andamento' || !!r.evidencia_texto || !!r.evidencia_path || temConteudo(formulario?.rascunho)) return 'rascunho'
  return 'nao_iniciado'
}

/** { total, aprovados, aguardando, correcao } — contagem por `status` devolvido pelo servidor. */
export function contagens(secoes) {
  const todos = (secoes || []).flatMap((s) => s.requisitos || [])
  return {
    total: todos.length,
    aprovados: todos.filter((r) => r.status === 'aprovado').length,
    aguardando: todos.filter((r) => r.status === 'aguardando_avaliacao').length,
    correcao: todos.filter((r) => r.status === 'correcao_solicitada').length,
  }
}

/** Progresso de uma seção (aprovados/total) para o "8/10" e a mini-barra. */
export function progressoDaSecao(requisitos) {
  const lista = requisitos || []
  return { feitos: lista.filter((r) => r.status === 'aprovado').length, total: lista.length }
}

/** Seção com algo a FAZER pela pessoa (não iniciado, em andamento ou correção). Só-aprovados/aguardando = sem pendência. */
export const secaoTemPendencia = (s) => (s.requisitos || []).some((r) => COM_ACAO.includes(r.status))

/**
 * Para onde o [CONTINUAR] leva: prioridade correção solicitada → rascunho em andamento → não iniciado e
 * não bloqueado (na ordem do cartão dentro de cada prioridade). Bloqueado, aguardando e aprovado nunca.
 * @returns {{ requisitoId: string, secaoId: string, status: string } | null}
 */
export function proximoRequisito(secoes, formularios = {}) {
  const ordem = ['correcao', 'rascunho', 'nao_iniciado']
  const itens = []
  for (const s of secoes || []) {
    for (const r of s.requisitos || []) itens.push({ r, secaoId: s.id, status: statusDaJornada(r, formularios?.[r.id] || null) })
  }
  for (const alvo of ordem) {
    const achou = itens.find((i) => i.status === alvo && COM_ACAO.includes(i.r.status))
    if (achou) return { requisitoId: achou.r.id, secaoId: achou.secaoId, status: alvo }
  }
  return null
}
