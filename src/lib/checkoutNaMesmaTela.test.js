import { describe, it, expect, afterEach, vi } from 'vitest'

const nativo = { valor: false }
vi.mock('./nativo.js', () => ({ ehNativo: () => nativo.valor }))
const { lerRetornoDoCheckout, abrirNaMesmaTela } = await import('./checkoutNaMesmaTela.js')

const original = window.location.href
afterEach(() => { window.history.replaceState(null, '', original); nativo.valor = false })

describe('checkoutNaMesmaTela', () => {
  it('lê o retorno do checkout e LIMPA os parâmetros (recarregar não confirma de novo), mantendo a aba do admin', () => {
    window.history.replaceState(null, '', '/admin?aba=assinaturas&order_nsu=p1&transaction_nsu=tx&slug=s1&capture_method=pix')
    expect(lerRetornoDoCheckout()).toEqual({ order_nsu: 'p1', transaction_nsu: 'tx', slug: 's1' })
    expect(window.location.search).toBe('?aba=assinaturas')
    expect(lerRetornoDoCheckout()).toBeNull()
  })
  it('aceita invoice_slug no lugar de slug; sem pedido não é retorno', () => {
    window.history.replaceState(null, '', '/admin?order_nsu=p1&transaction_nsu=tx&invoice_slug=s2')
    expect(lerRetornoDoCheckout()).toEqual({ order_nsu: 'p1', transaction_nsu: 'tx', slug: 's2' })
    window.history.replaceState(null, '', '/admin?aba=assinaturas')
    expect(lerRetornoDoCheckout()).toBeNull()
  })
  it('web abre na mesma aba; no APK não (lá abre no navegador do sistema)', () => {
    expect(abrirNaMesmaTela()).toBe(true)
    nativo.valor = true
    expect(abrirNaMesmaTela()).toBe(false)
  })
})
