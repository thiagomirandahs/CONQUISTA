// Serviço do /admin: exclusão de clube em duas fases (migration 280). Todas as RPCs exigem
// `_exigir_admin_plataforma()` no servidor, conferem de novo nome/motivo/APAGAR e auditam.
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const clubeExcluir = (clubId, nomeConfirmacao, motivo) =>
  rpc('admin_clube_excluir', { p_club_id: clubId, p_nome_confirmacao: nomeConfirmacao, p_motivo: motivo })
export const clubeRecuperar = (exclusaoId, motivo = null) =>
  rpc('admin_clube_recuperar', { p_exclusao_id: exclusaoId, p_motivo: motivo })
export const clubeExpurgarAgora = (exclusaoId, confirmacao) =>
  rpc('admin_clube_expurgar_agora', { p_exclusao_id: exclusaoId, p_confirmacao: confirmacao })
export const clubesExcluidosListar = () => rpc('admin_clubes_excluidos_listar')
export const exclusaoConfig = () => rpc('admin_clube_exclusao_config')
export const exclusaoConfigDefinir = ({ diasRetencao = null, permitirFundador = null, motivo = null } = {}) =>
  rpc('admin_clube_exclusao_config_definir', {
    p_dias_retencao: diasRetencao, p_permitir_excluir_fundador: permitirFundador, p_motivo: motivo,
  })
