// Serviço: motor curricular (Classes/Especialidades — fase piloto).
// As seções/requisitos vêm SEMPRE do currículo versionado (minha_classe/classes_disponiveis) — nada
// hardcoded aqui nem na tela. O percentual também vem pronto do servidor (classe_percentual, dentro
// de minha_classe()) — o cliente nunca calcula nem envia "concluído".
import { supabase } from '../lib/supabase.js'
import { subirComprovacao } from '../lib/upload.js'

// Classes publicadas que a pessoa ainda não iniciou no clube em uso.
export async function carregarClassesDisponiveis() {
  const { data, error } = await supabase.rpc('classes_disponiveis')
  if (error) throw new Error(error.message)
  return data || []
}

export async function iniciarClasse(classId) {
  const { data, error } = await supabase.rpc('classe_iniciar', { p_class_id: classId })
  if (error) throw new Error(error.message)
  return data
}

// Liderança inicia a classe em nome de alguém do próprio clube (ex.: criança que ainda não navega sozinha).
export async function atribuirClasse(usuarioId, classId) {
  const { data, error } = await supabase.rpc('classe_atribuir', { p_usuario_id: usuarioId, p_class_id: classId })
  if (error) throw new Error(error.message)
  return data
}

// Progresso da PRÓPRIA pessoa no clube em uso (a mais recente em andamento, ou uma específica por id).
// Cada requisito já vem com `escolha` (regra N-de-M declarativa: opções, n_minimo, sem_repeticao) e
// `conteudo_dinamico` (o valor do ano resolvido pelo servidor) — a tela só apresenta.
export async function carregarMinhaClasse(memberClassId = null) {
  const { data, error } = await supabase.rpc('minha_classe', { p_member_class_id: memberClassId })
  if (error) throw new Error(error.message)
  return data
}

// Todas as classes (não canceladas) da PRÓPRIA pessoa no clube em uso — abas de Minha Classe
// (migration 108). Cada item: member_class_id, class_id, nome, status, percentual.
export async function carregarMinhasClasses() {
  const { data, error } = await supabase.rpc('minhas_classes')
  if (error) throw new Error(error.message)
  return data || []
}

// "Origem do requisito": proveniência até o manifesto/OMD/página oficial (auditoria/administração —
// não aparece em todo card; só quando alguém pede).
export async function carregarOrigemRequisito(requirementId) {
  const { data, error } = await supabase.rpc('requisito_origem', { p_requirement_id: requirementId })
  if (error) throw new Error(error.message)
  return data
}

// Salva rascunho (texto e/ou foto) sem enviar pra avaliação ainda. A foto vai pro MESMO bucket
// privado das missões/atividades ('comprovacoes'), pasta 'requisitos' — mesmo hardening de sempre
// (signed URL só pro dono ou pra liderança do clube em uso, ver urlComprovacao).
export async function salvarRequisito({ requirementId, texto = null, foto = null, userId }) {
  let evidenciaPath = null
  if (foto) {
    evidenciaPath = await subirComprovacao({ file: foto, tipo: 'requisitos', userId })
  }
  const { error } = await supabase.rpc('requisito_salvar', {
    p_requirement_id: requirementId, p_texto: texto, p_evidencia_path: evidenciaPath,
  })
  if (error) throw new Error(error.message)
}

// Escolha N-de-M: registra QUAIS opções a pessoa cumpriu (ids das opções do cartão; texto livre só quando
// o cartão não lista opções). O servidor valida e é ele quem decide se a regra ficou satisfeita.
export async function escolherOpcoesRequisito(requirementId, optionIds = [], rotulosLivres = []) {
  const { data, error } = await supabase.rpc('requisito_escolher', {
    p_requirement_id: requirementId, p_option_ids: optionIds, p_rotulos_livres: rotulosLivres,
  })
  if (error) throw new Error(error.message)
  return data
}

// Envia pra avaliação (o servidor recusa se faltar evidência obrigatória ou se houver bloqueio de regra).
export async function enviarRequisito(requirementId) {
  const { error } = await supabase.rpc('requisito_enviar', { p_requirement_id: requirementId })
  if (error) throw new Error(error.message)
}

// ---- avaliação (liderança do clube em uso) ----
export async function carregarAvaliacoesPendentesDeClasse() {
  const { data, error } = await supabase.rpc('classe_avaliacoes_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}

// submissionId é a tentativa que a tela VIU na fila (classe_avaliacoes_pendentes já devolve
// `submission_id`) — passar ela ativa a trava de concorrência no servidor: se outra pessoa decidiu
// essa mesma tentativa primeiro, ou o membro já reenviou, o servidor recusa com mensagem clara em
// vez de sobrescrever silenciosamente.
export async function avaliarRequisito(memberRequirementId, decisao, comentario = null, submissionId = null) {
  const { error } = await supabase.rpc('requisito_avaliar', {
    p_member_requirement_id: memberRequirementId, p_decisao: decisao, p_comentario: comentario, p_submission_id: submissionId,
  })
  if (error) throw new Error(error.message)
}

// Histórico completo de tentativas de um requisito (dono ou liderança do clube em uso) — "Ver
// histórico" em Minha Classe, e o painel de contexto na fila de avaliação.
export async function carregarHistoricoRequisito(memberRequirementId) {
  const { data, error } = await supabase.rpc('requisito_historico', { p_member_requirement_id: memberRequirementId })
  if (error) throw new Error(error.message)
  return data
}

// Fila unificada (Classes + Especialidades, por ora) — Gestão → Avaliações.
export async function carregarFilaDeAvaliacao(tipo = null, unidadeId = null) {
  const { data, error } = await supabase.rpc('fila_avaliacao_unificada', { p_tipo: tipo, p_unidade_id: unidadeId })
  if (error) throw new Error(error.message)
  return data || []
}

// ---- conclusão / revisão final / investidura (fase 4) — liderança do clube em uso ----
// Conclusões do clube em requisitos_concluidos / aguardando_revisao / apto_investidura, com snapshot, revisão,
// bloqueios atuais e a lista de requisitos (pra pedir correção de um específico).
export async function carregarRevisoesPendentes() {
  const { data, error } = await supabase.rpc('classe_revisoes_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}

// Tenta selar de novo uma conclusão parada em "requisitos concluídos" (ex.: bloqueio resolvido).
export async function solicitarRevisaoFinal(memberClassId) {
  const { data, error } = await supabase.rpc('classe_revisao_solicitar', { p_member_class_id: memberClassId })
  if (error) throw new Error(error.message)
  return data
}

// 'aprovado' → apto para investidura; 'correcao_solicitada' reabre os requisitos indicados (obrigatório indicar).
export async function decidirRevisaoFinal(memberClassId, decisao, observacao = null, requisitosParaCorrigir = []) {
  const { data, error } = await supabase.rpc('revisao_final_decidir', {
    p_member_class_id: memberClassId, p_decisao: decisao, p_observacao: observacao, p_requisitos_para_corrigir: requisitosParaCorrigir,
  })
  if (error) throw new Error(error.message)
  return data
}

// Evento de investidura (data, clube, quem registrou, snapshot). O servidor recusa se algo bloqueia ou se já existe.
export async function registrarInvestidura(memberClassId, data, observacao = null) {
  const { data: r, error } = await supabase.rpc('investidura_registrar', { p_member_class_id: memberClassId, p_data: data, p_observacao: observacao })
  if (error) throw new Error(error.message)
  return r
}

export async function verificarSnapshot(snapshotId) {
  const { data, error } = await supabase.rpc('snapshot_verificar', { p_snapshot_id: snapshotId })
  if (error) throw new Error(error.message)
  return data
}
