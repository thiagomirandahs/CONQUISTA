// Serviço: painel da OPERAÇÃO SaaS (Fase 5 — motor comercial já existente, NÃO recriado aqui).
// Todas as RPCs abaixo já existiam em supabase/migrations/20260921000048_fundacao-comercial-saas.sql
// e já exigem `eh_admin_plataforma()` no servidor (`_exigir_admin_plataforma()`); este arquivo só
// expõe wrappers — a mesma separação de camada que `comercial.js` já faz para o catálogo público.
import { supabase } from '../lib/supabase.js'

export async function souAdminPlataforma() {
  const { data, error } = await supabase.rpc('eh_admin_plataforma')
  if (error) throw new Error(error.message)
  return !!data
}

export async function contasListar() {
  const { data, error } = await supabase.rpc('admin_contas_listar')
  if (error) throw new Error(error.message)
  return data || []
}

export async function provisionamentoPendencias() {
  const { data, error } = await supabase.rpc('admin_provisionamento_pendencias')
  if (error) throw new Error(error.message)
  return data || []
}

export async function provisionamentoReexecutar(clubId) {
  const { data, error } = await supabase.rpc('admin_provisionamento_reexecutar', { p_club_id: clubId })
  if (error) throw new Error(error.message)
  return data
}

export async function assinaturaTransicionar(subscriptionId, novoStatus, motivo) {
  const { data, error } = await supabase.rpc('admin_assinatura_transicionar', {
    p_subscription_id: subscriptionId, p_novo: novoStatus, p_motivo: motivo,
  })
  if (error) throw new Error(error.message)
  return data
}

// Visão por CLUBE (migration 103): leitura administrativa, só metadado comercial + contagens.
async function rpcAdmin(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data
}
export const visaoGeral = () => rpcAdmin('admin_visao_geral')
export const clubesListar = async () => (await rpcAdmin('admin_clubes_listar')) || []
export const clubeDetalhe = (clubId) => rpcAdmin('admin_clube_detalhe', { p_club_id: clubId })
export const planosAdminListar = async () => (await rpcAdmin('admin_planos_listar')) || []
export const assinaturasListar = async () => (await rpcAdmin('admin_assinaturas_listar')) || []
export const onboardingListar = async () => (await rpcAdmin('admin_onboarding_listar')) || []

// plano_mudar (migration 48) já é exclusiva do admin e devolve o excedente em vez de aplicar
// quando o plano novo fica abaixo do uso — só aplica com confirmação explícita.
export const planoMudar = (subscriptionId, chave, versao = null, confirmarExcedente = false) =>
  rpcAdmin('plano_mudar', { p_subscription_id: subscriptionId, p_plano_chave: chave, p_plano_versao: versao, p_confirmar_excedente: confirmarExcedente })

// support_grants tem select direto liberado por RLS pra admin (mesma policy que libera a
// liderança do clube) — não precisa de RPC de leitura própria.
export async function suporteListar() {
  const { data, error } = await supabase.from('support_grants')
    .select('id, club_id, admin_user_id, motivo, status, criado_em:created_at, expira_em, autorizado_em, revogado_em, revogado_motivo')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function suporteSolicitar(clubId, motivo, horas = 24) {
  const { data, error } = await supabase.rpc('suporte_solicitar', { p_club_id: clubId, p_motivo: motivo, p_horas: horas })
  if (error) throw new Error(error.message)
  return data
}

export async function suporteRevogar(id, motivo) {
  const { data, error } = await supabase.rpc('suporte_revogar', { p_id: id, p_motivo: motivo })
  if (error) throw new Error(error.message)
  return data
}

// platform_admin_audit também tem select direto liberado por RLS só pra admin — trilha imutável.
export async function auditoriaListar(limite = 100) {
  const { data, error } = await supabase.from('platform_admin_audit')
    .select('id, admin_user_id, acao, alvo_tipo, alvo_id, detalhe, created_at')
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)
  return data || []
}
