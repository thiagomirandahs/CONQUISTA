import { supabase } from '../lib/supabase.js'

export async function pagamentoLicenca(acao, dados = {}) {
  const { data, error } = await supabase.functions.invoke('licenca-infinitepay', { body: { ...dados, acao } })
  if (error) {
    const detalhe = await error.context?.json?.().catch(() => null)
    throw new Error(detalhe?.erro || 'Não foi possível consultar o pagamento. Tente novamente.')
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

export function urlCheckoutLicenca(valor) {
  const u = new URL(valor)
  if (u.protocol !== 'https:' || u.username || u.password || !['checkout.infinitepay.com.br', 'checkout.infinitepay.io'].includes(u.hostname)) {
    throw new Error('Link de pagamento inválido. Procure o suporte.')
  }
  return u.href
}
