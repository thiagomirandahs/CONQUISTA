// Serviço: motor de EXPERIÊNCIAS do clube (fase 6).
//
// Tudo que a liderança monta aqui é DADO DECLARATIVO validado pelo servidor contra um vocabulário
// fechado. O front nunca monta expressão, nunca avalia regra e nunca decide conclusão: ele envia a
// configuração e mostra o que o servidor respondeu. Se o clube tentar algo fora do vocabulário, o
// erro vem do banco — e é esse erro que a tela mostra.
import { supabase } from '../lib/supabase.js'

const rpc = async (nome, args) => {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const carregarExperiencias = (incluirRascunhos = false) =>
  rpc('experiencias_do_clube', { p_incluir_rascunhos: incluirRascunhos }).then((d) => d || [])

export const carregarExperiencia = (id) => rpc('experiencia_detalhe', { p_experience_id: id })

export const participar = (id) => rpc('experiencia_participar', { p_experience_id: id })

export const enviarEtapa = (stageId, dados = {}) =>
  rpc('experiencia_etapa_enviar', { p_stage_id: stageId, p_dados: dados })

// ---------- liderança ----------
export const salvarExperiencia = (id, dados) => rpc('experiencia_salvar', { p_id: id, p_dados: dados })
export const salvarEtapa = (experienceId, id, dados) =>
  rpc('experiencia_etapa_salvar', { p_experience_id: experienceId, p_id: id, p_dados: dados })
export const definirPublico = (experienceId, publico) =>
  rpc('experiencia_publico_definir', { p_experience_id: experienceId, p_publico: publico })
export const mudarEstado = (id, novo) => rpc('experiencia_estado', { p_experience_id: id, p_novo: novo })
export const novaVersao = (id) => rpc('experiencia_nova_versao', { p_experience_id: id })
export const copiarModelo = (chave, versao = null) =>
  rpc('experiencia_do_template', { p_chave: chave, p_versao: versao })
export const carregarPendentes = () => rpc('experiencias_pendentes_de_validacao').then((d) => d || [])
export const avaliarEnvio = (submissionId, decisao, observacao = null) =>
  rpc('experiencia_avaliar', { p_submission_id: submissionId, p_decisao: decisao, p_observacao: observacao })
export const salvarTemporada = (id, dados) => rpc('temporada_salvar', { p_id: id, p_dados: dados })

export async function carregarModelos() {
  const { data, error } = await supabase
    .from('experience_templates').select('chave, versao, titulo, descricao, tipo, alvo')
    .eq('status', 'publicado').order('chave').order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  // só a versão mais nova de cada modelo
  const vistos = new Set()
  return (data || []).filter((m) => (vistos.has(m.chave) ? false : vistos.add(m.chave)))
}

// ---------- rótulos (o vocabulário do servidor, traduzido pra gente) ----------
export const TIPO_ROTULO = {
  desafio_individual: 'Desafio individual', desafio_equipe: 'Desafio por unidade',
  campanha: 'Campanha', sequencia_missoes: 'Sequência de missões', evento_especial: 'Evento especial',
  quiz: 'Quiz', tarefa_evidencia: 'Tarefa com evidência', meta_quantitativa: 'Meta quantitativa',
  checkin: 'Check-in / participação',
}
export const EVIDENCIA_ROTULO = {
  nenhuma: 'Nada a enviar', confirmacao: 'Só confirmar', texto: 'Escrever um texto',
  foto: 'Enviar uma foto', arquivo: 'Enviar um arquivo', quiz: 'Responder um quiz',
  contagem: 'Informar uma quantidade', checkin: 'Fazer check-in',
}
export const STATUS_ROTULO = {
  rascunho: 'Rascunho', agendada: 'Agendada', publicada: 'Publicada',
  encerrada: 'Encerrada', arquivada: 'Arquivada',
}

export function recompensaTexto(r) {
  if (!r || r.tipo === 'nenhuma') return 'Sem recompensa'
  if (r.tipo === 'pontos') return `${r.valor} pontos`
  if (r.tipo === 'badge') return `Conquista ${r.icone || '🏅'} ${r.nome || r.chave}`
  if (r.tipo === 'item') return `Item ${r.nome || r.chave}`
  return 'Sem recompensa'
}
