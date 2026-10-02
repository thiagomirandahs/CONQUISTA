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

// Licença cortesia (sorteio/promoção, migration 150). Só depois da etapa "clube" (a assinatura já
// existe). Código errado NÃO lança: devolve { ok: false, erro } (o servidor conta a tentativa errada).
export async function resgatarCortesia(codigo) {
  const { data, error } = await supabase.rpc('onboarding_cortesia_resgatar', { p_codigo: codigo })
  if (error) throw new Error(error.message)
  if (!data?.ok) throw new Error(data?.erro || 'Código de cortesia inválido.')
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

// ---------------------------------------------------------------- PAGAMENTO (migration 540; guia: supabase/PAGAMENTOS-COMO-PLUGAR-GATEWAY.md)
// O front NUNCA decide valor nem fala com o gateway: pede à Edge Function `pagamento-checkout`, que abre a fatura no banco (valor do
// catálogo), cria a cobrança no gateway do ambiente e devolve só o link / Pix copia-e-cola.

// O botão "Pagar" só aparece se algum provedor foi habilitado no banco.
export async function pagamentoDisponivel() {
  const { data, error } = await supabase.rpc('pagamento_disponivel')
  if (error) throw new Error(error.message)
  return data === true
}

// Faturas do clube em uso (só a diretoria; os demais recebem "Sem permissão").
export async function faturasDoClube() {
  const { data, error } = await supabase.rpc('faturas_do_clube')
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

// forma: 'pix' | 'cartao'. Devolve { fatura_id, checkout_url, pix_copia_cola, vence_em, valor_centavos }.
export async function iniciarPagamento(forma = 'pix') {
  const { data, error } = await supabase.functions.invoke('pagamento-checkout', { body: { forma } })
  if (error) {
    const corpo = await error.context?.json?.().catch(() => null)
    throw new Error(corpo?.erro || error.message)
  }
  return data
}

export const ROTULO_FATURA = { aberta: 'Aguardando pagamento', paga: 'Paga', vencida: 'Vencida', cancelada: 'Cancelada', reembolsada: 'Reembolsada' }
