// Serviço: motor de Especialidades (fase 2 do motor curricular — mesma filosofia de classes.js).
// Requisitos vêm sempre do currículo versionado (especialidades_disponiveis/minha_especialidade) —
// nada hardcoded aqui nem na tela. Percentual vem pronto do servidor.
import { supabase } from '../lib/supabase.js'
import { subirComprovacao, comComprovacao } from '../lib/upload.js'

export async function carregarEspecialidadesDisponiveis() {
  const { data, error } = await supabase.rpc('especialidades_disponiveis')
  if (error) throw new Error(error.message)
  return data || []
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

export async function avaliarRequisitoEspecialidade(memberSpecialtyRequirementId, decisao, comentario = null) {
  const { error } = await supabase.rpc('especialidade_requisito_avaliar', {
    p_member_specialty_requirement_id: memberSpecialtyRequirementId, p_decisao: decisao, p_comentario: comentario,
  })
  if (error) throw new Error(error.message)
}
