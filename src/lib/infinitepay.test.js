import { describe, it, expect } from 'vitest'
import { checkoutSeguro, validarPagamento } from '../../supabase/functions/_compartilhado/infinitepay.ts'
import { urlCheckoutLicenca } from '../services/pagamentoLicenca.js'

const pedido = { cartao_centavos: 25000, pix_centavos: 22000, parcelas: 12 }
const pagamento = { success: true, paid: true, capture_method: 'credit_card', paid_amount: 25000, installments: 12 }
describe('Confirmação da licença InfinitePay', () => {
  it('aceita o cartão pelo total e o Pix pelo desconto contratado', () => {
    expect(validarPagamento(pagamento, pedido)).toEqual({ metodo: 'credit_card', valor: 25000, parcelas: 12 })
    expect(validarPagamento({ ...pagamento, capture_method: 'pix', paid_amount: 22000, installments: 1 }, pedido).valor).toBe(22000)
  })
  it.each([
    { paid: false }, { success: false }, { paid_amount: 22000 }, { paid_amount: 27500 },
    { paid_amount: '25000' }, { installments: 13 }, { installments: 0 }, { installments: 1.5 },
    { capture_method: 'boleto' }, { capture_method: 'pix', installments: 1 },
    { capture_method: 'pix', paid_amount: 22000, installments: 12 },
  ])('recusa confirmação incompatível: %j', mudanca => {
    expect(() => validarPagamento({ ...pagamento, ...mudanca }, pedido)).toThrow()
  })
  it.each([checkoutSeguro, urlCheckoutLicenca])('limita redirecionamento ao checkout oficial', validar => {
    expect(validar('https://checkout.infinitepay.com.br/abc')).toBe('https://checkout.infinitepay.com.br/abc')
    for (const u of ['http://checkout.infinitepay.com.br/abc', 'https://checkout.infinitepay.com.br.evil.test/', 'https://evil.test/', 'javascript:alert(1)', 'https://usuario:senha@checkout.infinitepay.com.br/']) {
      expect(() => validar(u)).toThrow()
    }
  })
})
