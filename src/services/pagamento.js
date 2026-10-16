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

// Venda de TESTE (migration 551): link de R$ 1,00 para um clube, pelo caminho real da InfinitePay; não ativa licença.
export async function criarVendaTeste(clubId) {
  const { pagamentoLicenca, urlCheckoutLicenca } = await import('./pagamentoLicenca.js')
  const d = await pagamentoLicenca('teste_criar', { club_id: clubId })
  return { ...d, url: urlCheckoutLicenca(d.url) }
}

export async function listarVendasTeste() {
  const { data, error } = await supabase.rpc('admin_licenca_teste_listar')
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

// Volta do checkout com ?order_nsu=…&transaction_nsu=…&slug=… — confirma consultando a InfinitePay (no servidor).
export async function confirmarVendaTeste({ order_nsu, transaction_nsu, slug }) {
  const { pagamentoLicenca } = await import('./pagamentoLicenca.js')
  return pagamentoLicenca('confirmar', { order_nsu, transaction_nsu, slug })
}
