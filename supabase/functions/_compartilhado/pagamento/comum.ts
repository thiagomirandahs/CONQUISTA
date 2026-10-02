// Peças puras e reaproveitáveis por qualquer adaptador e pelas Edge Functions de pagamento (testáveis fora do Deno).
import type { EventoNormalizado, FormaPagamento, TipoEvento } from './tipos.ts'

export const TIPOS_DE_EVENTO: readonly TipoEvento[] = [
  'pagamento_aprovado', 'pagamento_recusado', 'pagamento_atrasado', 'renovacao', 'cancelamento',
]

/** Comparação em tempo constante (segredos de webhook nunca com ===). Segredo vazio = sempre falso (falha fechada). */
export async function igualSeguro(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const x = new Uint8Array(ha), y = new Uint8Array(hb)
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

/** HMAC-SHA256 em hexadecimal — a assinatura de webhook mais comum (Stripe, Mercado Pago, Pagar.me…). */
export async function hmacSha256Hex(segredo: string, mensagem: string): Promise<string> {
  const enc = new TextEncoder()
  const chave = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', chave, enc.encode(mensagem)))
  return Array.from(assinatura).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function formaValida(f: unknown): f is FormaPagamento {
  return f === 'pix' || f === 'cartao'
}

/** Garante que o adaptador só entrega eventos que o motor entende (o resto é ignorado, nunca processado às cegas). */
export function eventoValido(e: EventoNormalizado | null): e is EventoNormalizado {
  return !!e && typeof e.eventoId === 'string' && e.eventoId.length > 0 && e.eventoId.length <= 200
    && (TIPOS_DE_EVENTO as readonly string[]).includes(e.tipo) && !!e.payload && typeof e.payload === 'object'
}

/** Valor em reais para os gateways que pedem decimal (nunca use ponto flutuante para dinheiro fora daqui). */
export function centavosParaReais(centavos: number): string {
  const c = Math.round(centavos)
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
}
