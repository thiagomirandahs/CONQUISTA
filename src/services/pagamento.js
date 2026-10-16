// Interruptor da cobrança online da licença (migration 550) — só o administrador da plataforma (o servidor confere e audita).
import { supabase } from '../lib/supabase.js'

export async function lerCobranca() {
  const { data, error } = await supabase.rpc('admin_pagamento_estado')
  if (error) throw new Error(error.message)
  return { ativo: data?.ativo === true, atualizadoEm: data?.atualizado_em || null }
}

export async function definirCobranca(ativo, motivo = null) {
  const { data, error } = await supabase.rpc('admin_pagamento_definir', { p_ativo: !!ativo, p_motivo: motivo || null })
  if (error) throw new Error(error.message)
  return { ativo: data?.ativo === true, atualizadoEm: data?.atualizado_em || null }
}
