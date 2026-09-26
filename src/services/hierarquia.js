// Serviço: hierarquia institucional (migration 130). A árvore é gerida SÓ pelo admin da plataforma;
// o clube só PEDE a região (vira pendência); coordenadores entram por link de convite.
// Todas as RPCs validam permissão no servidor — aqui são só wrappers.
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const TIPO_ROTULO = {
  divisao: 'Divisão', uniao: 'União', campo: 'Associação/Missão', regiao: 'Região', distrito: 'Distrito', clube: 'Clube',
}
// papel → tipo de unidade onde ele vale (espelha _hier_tipo_do_papel)
export const PAPEIS_COORDENACAO = [
  { papel: 'coordenador_distrital', rotulo: 'Coordenador distrital', tipo: 'distrito' },
  { papel: 'coordenador_regional', rotulo: 'Coordenador regional', tipo: 'regiao' },
  { papel: 'coordenador_geral', rotulo: 'Coordenador geral', tipo: 'campo' },
  { papel: 'diretor_mda', rotulo: 'Diretor do Ministério (MDA)', tipo: 'campo' },
  { papel: 'departamental_jovem', rotulo: 'Departamental (Ministério Jovem)', tipo: 'campo' },
  { papel: 'associado_md', rotulo: 'Associado(a) do MD', tipo: 'campo' },
  { papel: 'secretario_md', rotulo: 'Secretário(a) do MD', tipo: 'campo' },
  { papel: 'coordenador_uniao', rotulo: 'Coordenador da união', tipo: 'uniao' },
  { papel: 'diretor_uniao', rotulo: 'Diretor da união', tipo: 'uniao' },
  { papel: 'coordenador_divisao', rotulo: 'Coordenador da divisão', tipo: 'divisao' },
]
export const rotuloPapel = (p) => PAPEIS_COORDENACAO.find((x) => x.papel === p)?.rotulo || p

export function montarLinkCoordenacao(origin, token) {
  return `${origin}/coordenacao?token=${encodeURIComponent(token)}`
}

// ----- admin
export const hierarquiaAdmin = () => rpc('admin_hierarquia')
export const unidadeCriar = (tipo, nome, parentId = null) => rpc('admin_unidade_criar', { p_tipo: tipo, p_nome: nome, p_parent_id: parentId })
export const unidadeEditar = (id, nome, parentId = null) => rpc('admin_unidade_editar', { p_id: id, p_nome: nome, p_parent_id: parentId })
export const unidadeStatus = (id, ativo, motivo = null) => rpc('admin_unidade_status', { p_id: id, p_ativo: ativo, p_motivo: motivo })
export const clubeVincular = (clubId, unidadeId, motivo = null) => rpc('admin_clube_vincular', { p_club_id: clubId, p_unidade_id: unidadeId, p_motivo: motivo })
export const pedidoClubeDecidir = (id, confirmar, unidadeId = null, motivo = null) =>
  rpc('admin_pedido_clube_decidir', { p_pedido_id: id, p_confirmar: confirmar, p_unidade_id: unidadeId, p_motivo: motivo })
export const coordenadorDecidir = (membershipId, confirmar, motivo = null) =>
  rpc('admin_coordenador_decidir', { p_membership_id: membershipId, p_confirmar: confirmar, p_motivo: motivo })
export const coordenadorRemover = (membershipId, motivo = null) => rpc('admin_coordenador_remover', { p_membership_id: membershipId, p_motivo: motivo })
export const conviteGerar = ({ papel, unidadeId = null, dias = 7, maxUsos = 1, rotulo = null }) =>
  rpc('admin_convite_hierarquia_gerar', { p_papel: papel, p_unidade_id: unidadeId, p_dias: dias, p_max_usos: maxUsos, p_rotulo: rotulo })
export const conviteRevogar = (id, motivo = null) => rpc('admin_convite_hierarquia_revogar', { p_id: id, p_motivo: motivo })
// "Apagar" = arquivar (migration 140): some da lista, mas o registro e a trilha de auditoria ficam.
export const conviteApagar = (id, motivo = null) => rpc('admin_convite_hierarquia_apagar', { p_id: id, p_motivo: motivo })
export const convitesLimparInativos = () => rpc('admin_convites_hierarquia_limpar_inativos')

// ----- pessoa convidada
export const conviteAbrir = (token) => rpc('convite_hierarquia_abrir', { p_token: token })
export const conviteAceitar = (token, unidadeId = null) => rpc('convite_hierarquia_aceitar', { p_token: token, p_unidade_id: unidadeId })

// ----- diretoria do clube
export const opcoesParaClube = async () => (await rpc('hierarquia_opcoes_para_clube')) || []
export const clubeSituacao = (clubId) => rpc('clube_hierarquia_situacao', { p_club_id: clubId })
export const clubeSolicitar = (clubId, unidadeId) => rpc('clube_hierarquia_solicitar', { p_club_id: clubId, p_unidade_id: unidadeId })
