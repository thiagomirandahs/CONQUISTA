// Serviço: motor de Especialidades (fase 2 do motor curricular — mesma filosofia de classes.js).
// Requisitos vêm sempre do currículo versionado (especialidades_disponiveis/minha_especialidade) —
// nada hardcoded aqui nem na tela. Percentual vem pronto do servidor.
import { RelatoIndisponivel, ehRelatoIndisponivel } from '../lib/relatorio/relato.js'
import { supabase } from '../lib/supabase.js'
import { subirComprovacao, comComprovacao } from '../lib/upload.js'

export async function carregarEspecialidadesDisponiveis() {
  const { data, error } = await supabase.rpc('especialidades_disponiveis')
  if (error) throw new Error(error.message)
  return data || []
}

// Catálogo PAGINADO (nunca o catálogo inteiro): busca por nome/código, área, situação e cursor opaco.
// Devolve { itens, proximo, total, areas } — `areas` só vem na 1ª página. O limite é saneado para 1–50.
export async function buscarEspecialidades({ busca = null, area = null, situacao = 'todas', limite = 30, depois = null } = {}) {
  const n = Math.trunc(Number(limite))
  const lim = Number.isFinite(n) ? Math.min(Math.max(n, 1), 50) : 30
  const { data, error } = await supabase.rpc('especialidades_buscar', {
    p_busca: (busca || '').trim() || null, p_area: area || null, p_situacao: situacao || 'todas', p_limite: lim, p_depois: depois || null,
  })
  if (error) throw new Error(error.message)
  return data || { itens: [], proximo: null, total: 0, areas: [] }
}

export async function iniciarEspecialidade(specialtyId, ofertaId = null) {
  const { data, error } = await supabase.rpc('especialidade_iniciar', { p_specialty_id: specialtyId, p_oferta_id: ofertaId })
  if (error) throw new Error(error.message)
  return data
}

export async function atribuirEspecialidade(usuarioId, specialtyId, ofertaId = null) {
  const { data, error } = await supabase.rpc('especialidade_atribuir', { p_usuario_id: usuarioId, p_specialty_id: specialtyId, p_oferta_id: ofertaId })
  if (error) throw new Error(error.message)
  return data
}

// ---- turma/oferta ----
export async function criarOfertaEspecialidade({ specialtyId, titulo, instrutorResponsavelId = null, periodoInicio = null, periodoFim = null }) {
  const { data, error } = await supabase.rpc('oferta_especialidade_criar', {
    p_specialty_id: specialtyId, p_titulo: titulo, p_instrutor_responsavel_id: instrutorResponsavelId,
    p_periodo_inicio: periodoInicio, p_periodo_fim: periodoFim,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function carregarOfertasDoClube() {
  const { data, error } = await supabase.rpc('ofertas_especialidade_do_clube')
  if (error) throw new Error(error.message)
  return data || []
}

// ---- progresso da própria pessoa ----
export async function carregarMinhaEspecialidade(memberSpecialtyId = null) {
  const { data, error } = await supabase.rpc('minha_especialidade', { p_member_specialty_id: memberSpecialtyId })
  if (error) throw new Error(error.message)
  return data
}

// Evidência reaproveita o MESMO bucket privado das missões/classes ('comprovacoes'), pasta 'requisitos'.
export async function salvarRequisitoEspecialidade({ requirementId, texto = null, foto = null, userId }) {
  let evidenciaPath = null
  if (foto) {
    evidenciaPath = await subirComprovacao({ file: foto, tipo: 'requisitos', userId })
  }
  await comComprovacao(evidenciaPath, async () => {
    const { error } = await supabase.rpc('especialidade_requisito_salvar', {
      p_specialty_requirement_id: requirementId, p_texto: texto, p_evidencia_path: evidenciaPath,
    })
    if (error) throw new Error(error.message)
  })
}

export async function enviarRequisitoEspecialidade(requirementId) {
  const { error } = await supabase.rpc('especialidade_requisito_enviar', { p_specialty_requirement_id: requirementId })
  if (error) throw new Error(error.message)
}

// ---- avaliação (liderança do clube em uso, ou instrutor responsável da turma) ----
export async function carregarAvaliacoesPendentesDeEspecialidade() {
  const { data, error } = await supabase.rpc('especialidade_avaliacoes_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}

// submissionId (opcional) = a tentativa que a tela viu; ativa a trava de concorrência no servidor.
export async function avaliarRequisitoEspecialidade(memberSpecialtyRequirementId, decisao, comentario = null, submissionId = null) {
  const { error } = await supabase.rpc('especialidade_requisito_avaliar', {
    p_member_specialty_requirement_id: memberSpecialtyRequirementId, p_decisao: decisao, p_comentario: comentario,
    p_submission_id: submissionId,
  })
  if (error) throw new Error(error.message)
}

// ---- motor de relatório estruturado (fase 7) ----
// Rascunho do formulário de um requisito de especialidade (o envio segue em enviarRequisitoEspecialidade).
export async function salvarRelatorioEspecialidade({ requirementId, conteudo, anexos = [] }) {
  const { error } = await supabase.rpc('especialidade_requisito_relatorio_salvar', {
    p_specialty_requirement_id: requirementId, p_conteudo: conteudo ?? {}, p_anexos: anexos ?? [],
  })
  if (error) throw new Error(error.message)
}

// Histórico de tentativas (dono ou avaliador do clube em uso): `modelo` vem como o schema direto.
export async function carregarHistoricoEspecialidade(memberSpecialtyRequirementId) {
  const { data, error } = await supabase.rpc('especialidade_historico', { p_member_specialty_requirement_id: memberSpecialtyRequirementId })
  if (error) throw new Error(error.message)
  return data
}

// Relato / comprovação complementar (migration 520) — mesmo contrato de Classes.
export async function salvarRelatoEspecialidade({ requirementId, relato }) {
  const { data, error } = await supabase.rpc('especialidade_requisito_relato_salvar', { p_specialty_requirement_id: requirementId, p_relato: relato || null })
  if (error) { if (ehRelatoIndisponivel(error)) throw new RelatoIndisponivel(); throw new Error(error.message) }
  return data
}
