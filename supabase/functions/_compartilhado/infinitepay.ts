// Apenas contratos documentados: não inventar parâmetro de desconto/repasse na API.
export const API = 'https://api.checkout.infinitepay.io'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function checkoutSeguro(valor: unknown): string {
  if (typeof valor !== 'string') throw new Error('Checkout inválido.')
  const u = new URL(valor)
  if (u.protocol !== 'https:' || u.username || u.password || !['checkout.infinitepay.com.br', 'checkout.infinitepay.io'].includes(u.hostname)) {
    throw new Error('Checkout inválido.')
  }
  return u.href
}

export function validarPagamento(d: Record<string, unknown>, pedido: { cartao_centavos: number; pix_centavos: number; parcelas: number }) {
  if (d.success !== true || d.paid !== true) throw new Error('Pagamento ainda não confirmado.')
  const metodo = d.capture_method
  const valor = d.paid_amount
  const parcelas = d.installments
  const esperado = metodo === 'pix' ? pedido.pix_centavos : pedido.cartao_centavos
  if (!['pix', 'credit_card'].includes(String(metodo)) || !Number.isSafeInteger(valor) || valor !== esperado
    || !Number.isSafeInteger(parcelas) || Number(parcelas) < 1 || Number(parcelas) > pedido.parcelas
    || (metodo === 'pix' && parcelas !== 1)) throw new Error('Valor ou parcelamento divergente. Procure o suporte antes de pagar novamente.')
  return { metodo: String(metodo), valor: Number(valor), parcelas: Number(parcelas) }
}

export async function chamarInfinitePay(caminho: '/links' | '/payment_check', body: unknown) {
  const r = await fetch(`${API}${caminho}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error' })
  if (!r.ok) throw new Error('Não foi possível consultar a InfinitePay. Tente novamente.')
  return await r.json()
}
