import { describe, it, expect, beforeEach } from 'vitest'
import { marcarInicioDaNavegacao, voltouAntesDoInicio, carimbarEntradaAtual, esquecerInicioDaNavegacao } from './barreiraDeVoltar.js'

describe('barreira do VOLTAR', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '') })

  it('link novo aberto na mesma aba (sem carimbo) NÃO é tratado como voltar', () => {
    marcarInicioDaNavegacao()
    window.history.pushState({ idx: 0 }, '', '/coordenacao?token=x')
    expect(voltouAntesDoInicio()).toBe(false)
    carimbarEntradaAtual()
    expect(voltouAntesDoInicio()).toBe(false)
  })

  it('tela carimbada na etapa anterior (conta que saiu / clube de antes) é voltar', () => {
    marcarInicioDaNavegacao()
    const antiga = window.history.state
    marcarInicioDaNavegacao() // entrou de novo / trocou de clube
    window.history.replaceState(antiga, '')
    expect(voltouAntesDoInicio()).toBe(true)
  })

  it('sem etapa (deslogado) nunca bloqueia', () => {
    marcarInicioDaNavegacao()
    esquecerInicioDaNavegacao()
    expect(voltouAntesDoInicio()).toBe(false)
  })
})
