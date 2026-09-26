// Serviço do /admin: limite de membros por clube (migration 220) e lixeira de membros inativos
// (migration 221). Todas as RPCs exigem `_exigir_admin_plataforma()` no servidor e auditam.
import { supabase } from '../lib/supabase.js'

async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}

export const limiteMembros = (clubId) => rpc('admin_clube_limite_membros', { p_club_id: clubId })
// limite = null remove o ajuste (volta ao teto do plano)
export const limiteMembrosDefinir = (clubId, limite, motivo) =>
  rpc('admin_clube_limite_membros_definir', { p_club_id: clubId, p_limite: limite, p_motivo: motivo })

export const lixeiraListar = (clubId) => rpc('admin_lixeira_listar', { p_club_id: clubId })
export const lixeiraSimular = (clubId) => rpc('admin_lixeira_simular', { p_club_id: clubId })
export const lixeiraRecuperar = (pacoteId, motivo = null) => rpc('admin_lixeira_recuperar', { p_pacote_id: pacoteId, p_motivo: motivo })
// modo = null: o clube passa a seguir o modo global
export const lixeiraModoClube = (clubId, modo) => rpc('admin_lixeira_clube_modo', { p_club_id: clubId, p_modo: modo })
export const lixeiraConfig = () => rpc('admin_lixeira_config')
// semLoginDias: 0 desliga a regra; null mantém
export const lixeiraConfigDefinir = ({ modo = null, diasInatividade = null, diasRetencao = null, semLoginDias = null } = {}) =>
  rpc('admin_lixeira_config_definir', {
    p_modo: modo, p_dias_inatividade: diasInatividade, p_dias_retencao: diasRetencao, p_sem_login_dias: semLoginDias,
  })
