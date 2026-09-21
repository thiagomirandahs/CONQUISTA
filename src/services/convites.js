// Serviço: convites de responsável (link de cadastro por clube). As regras de verdade
// (quem cria, expiração, uso único, revogação) moram no banco — aqui só chamamos as RPCs.
import { supabase } from '../lib/supabase.js'

// Cria o convite. O token só é devolvido AQUI, uma vez: no banco fica só o hash.
export async function criarConviteResponsavel() {
  const { data, error } = await supabase.rpc('criar_convite_responsavel')
  if (error) throw new Error(error.message)
  return data // { id, token, expires_at }
}

// Convites do meu clube, sem token: [{ id, criado_em, expira_em, usado_em, revogado_em, criado_por_nome, usado_por_nome, status }]
export async function listarConvitesResponsavel() {
  const { data, error } = await supabase.rpc('listar_convites_responsavel')
  if (error) throw new Error(error.message)
  return data || []
}

export async function revogarConviteResponsavel(id) {
  const { data, error } = await supabase.rpc('revogar_convite_responsavel', { p_id: id })
  if (error) throw new Error(error.message)
  return data
}
