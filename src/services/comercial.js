// Serviço: camada COMERCIAL do DesbravaClube (fase 5).
//
// Duas regras que este arquivo existe pra garantir:
//   1. PREÇO NÃO MORA NO REACT. Nome, composição e valor de cada plano vêm do catálogo versionado do
//      banco (billing_plans/billing_prices). Aqui só há formatação.
//   2. O CLIENTE NÃO MUDA O PRÓPRIO PLANO pelo app: não existe função de "mudar plano" neste serviço.
//      Isso é ato comercial da conta (RPC plano_mudar, exclusiva da administração da plataforma).
import { supabase } from '../lib/supabase.js'

// Catálogo público de planos, com preços vigentes. Os valores são PROVISÓRIOS nesta fase — o campo
// `provisorio` vem do banco e a tela é obrigada a avisar.
export async function carregarPlanos() {
  const { data, error } = await supabase.rpc('planos_disponiveis')
  if (error) throw new Error(error.message)
  return data || []
}

// Situação comercial do CLUBE EM USO (plano, status, recursos efetivos e limites com o uso atual).
// Não devolve documento, e-mail de cobrança nem nada da conta comercial: isso é do contato da conta.
export async function carregarAssinaturaDoClube() {
  const { data, error } = await supabase.rpc('assinatura_do_clube')
  if (error) throw new Error(error.message)
  return data
}

// Por que não posso? Responde qual das três camadas barrou: plano, clube ou usuário.
export async function verificarOperacao(recurso, acao = 'usar') {
  const { data, error } = await supabase.rpc('operacao_permitida', { p_feature: recurso, p_acao: acao })
  if (error) throw new Error(error.message)
  return data
}

// ---------- onboarding de clube novo (retomável e idempotente; o estado mora no servidor) ----------
export async function carregarOnboarding() {
  const { data, error } = await supabase.rpc('onboarding_estado')
  if (error) throw new Error(error.message)
  return data
}

export async function iniciarOnboarding() {
  const { data, error } = await supabase.rpc('onboarding_iniciar')
  if (error) throw new Error(error.message)
  return data
}

// Uma etapa por vez. Repetir a mesma etapa é seguro: o servidor é idempotente (não cria dois clubes
// nem duas assinaturas) e recusa pular etapa.
export async function salvarEtapaOnboarding(etapa, dados = {}) {
  const { data, error } = await supabase.rpc('onboarding_etapa', { p_etapa: etapa, p_dados: dados })
  if (error) throw new Error(error.message)
  return data
}

// ---------- formatação ----------
export function formatarPreco(centavos, moeda = 'BRL') {
  const v = Number(centavos || 0) / 100
  try {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda })
  } catch {
    return `R$ ${v.toFixed(2).replace('.', ',')}`
  }
}

export const ROTULO_STATUS = {
  trial: 'Período de teste',
  ativa: 'Ativa',
  pagamento_pendente: 'Pagamento pendente',
  inadimplente: 'Pagamento em atraso',
  suspensa: 'Suspensa',
  cancelada: 'Cancelada',
}
