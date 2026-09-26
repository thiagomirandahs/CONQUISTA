// Serviço: escopo INSTITUCIONAL (distrito/região/campo/união/divisão) — fase 4.3.
// Nada aqui é "clube": são camadas acima na árvore, com contexto próprio. O servidor resolve o escopo
// em uso pelo header x-escopo-atual (sempre validado contra vínculo ativo) e devolve SÓ o que o escopo
// justifica — agregados dos clubes abaixo, nunca dado operacional/pessoal deles.
import { supabase } from '../lib/supabase.js'

// Vínculos institucionais da pessoa + capacidades em cada um. Vem vazio pra quem só tem clube.
export async function carregarContextoInstitucional() {
  const { data, error } = await supabase.rpc('meu_contexto_institucional')
  if (error) throw new Error(error.message)
  return data
}

// Situação geral dos clubes abaixo do escopo em uso — SÓ contagens.
export async function carregarPainelDoEscopo() {
  const { data, error } = await supabase.rpc('escopo_painel')
  if (error) throw new Error(error.message)
  return data || []
}

// Cartões de classe parados numa etapa que EXIGE a atuação desta autoridade (aprovação do distrito ou
// da região — migration 330). Só o resumo: pessoa, classe, clube, conclusão e quem já aprovou.
export async function carregarInvestidurasDoEscopo() {
  const { data, error } = await supabase.rpc('escopo_investiduras_pendentes')
  if (error) throw new Error(error.message)
  return data || []
}

// Cartão completo pra quem aprova (requisitos, respostas, fotos, linha do tempo). O servidor só entrega
// à autoridade da etapa atual (ou a quem já aprovou acima e segue no cargo) e à liderança do clube.
export async function carregarCartaoInvestidura(memberClassId) {
  const { data, error } = await supabase.rpc('investidura_cartao', { p_member_class_id: memberClassId })
  if (error) throw new Error(error.message)
  return data
}

// Aprovar ('aprovado') ou devolver ao clube ('devolvido', motivo obrigatório). `correcoes`:
// [{ member_requirement_id, comentario }] — esses requisitos voltam para "correção solicitada".
export async function decidirCartaoInvestidura(memberClassId, decisao, comentario = null, correcoes = []) {
  const { data, error } = await supabase.rpc('coordenacao_investidura_decidir', {
    p_member_class_id: memberClassId, p_decisao: decisao, p_comentario: comentario, p_correcoes: correcoes,
  })
  if (error) throw new Error(error.message)
  return data
}

// Foto de comprovação na aprovação: URL assinada CURTA (5 min), nada guardado em cache. O Storage só assina
// para quem passa na policy (liderança do clube ou coordenação da etapa atual — migration 330).
export async function urlEvidenciaCurta(caminho) {
  if (!caminho) return null
  if (/^https?:\/\//i.test(caminho)) return caminho
  const { data, error } = await supabase.storage.from('comprovacoes').createSignedUrl(caminho, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

// Painel analítico do escopo (migration 142): números AGREGADOS por clube + totais. `unidadeId` filtra
// por uma região/distrito dentro do escopo (o servidor recusa unidade de fora).
export const carregarPainelAnalitico = (unidadeId = null) => rpc('escopo_painel_analitico', { p_unidade: unidadeId })

// Página do clube na visão da coordenação (migration 300): só agregado. Clube fora do escopo e clube
// inexistente dão o mesmo erro ("Clube não encontrado.").
export const carregarClubeDetalhe = (clubId) => rpc('escopo_clube_detalhe', { p_club_id: clubId })

// Visitas da coordenação (migration 141)
export const carregarVisitasDoEscopo = async (clubId = null) => (await rpc('escopo_visitas', { p_club_id: clubId })) || []
export const agendarVisita = ({ clubId, quando, objetivo, observacao = null }) =>
  rpc('escopo_visita_agendar', { p_club_id: clubId, p_quando: quando, p_objetivo: objetivo, p_observacao: observacao })
export const atualizarVisita = (id, acao, { quando = null, texto = null } = {}) =>
  rpc('escopo_visita_atualizar', { p_id: id, p_acao: acao, p_quando: quando, p_texto: texto })

// lado do clube (diretoria)
export const carregarVisitasDoClube = async (clubId) => (await rpc('clube_visitas', { p_club_id: clubId })) || []
export const responderVisita = (id, confirmar, { sugestao = null, obs = null } = {}) =>
  rpc('clube_visita_responder', { p_id: id, p_confirmar: confirmar, p_sugestao: sugestao, p_obs: obs })
// avaliação da visita pela diretoria (migration 320): nota geral 1–5 obrigatória, aspectos opcionais
export const avaliarVisita = (id, { geral, pontualidade = null, orientacao = null, relacionamento = null, observacao = null }) =>
  rpc('clube_visita_avaliar', {
    p_id: id, p_geral: geral, p_pontualidade: pontualidade, p_orientacao: orientacao,
    p_relacionamento: relacionamento, p_observacao: observacao,
  })
