import { describe, it, expect, beforeEach } from 'vitest'
import { ehErroDeVersao, podeRecuperarAgora } from './recuperarVersao.js'

describe('recuperação automática de versão', () => {
  beforeEach(() => sessionStorage.clear())
  it('reconhece erro de pedaço do app que sumiu', () => {
    expect(ehErroDeVersao(new TypeError('Failed to fetch dynamically imported module: /assets/Admin-x.js'))).toBe(true)
    expect(ehErroDeVersao(new Error('Importing a module script failed.'))).toBe(true)
    expect(ehErroDeVersao(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
  })
  it('trava por 1 minuto para não virar laço de recarga', () => {
    const t = 1_000_000
    expect(podeRecuperarAgora(t)).toBe(true)
    sessionStorage.setItem('cq.recuperouVersaoEm', String(t))
    expect(podeRecuperarAgora(t + 30_000)).toBe(false)
    expect(podeRecuperarAgora(t + 61_000)).toBe(true)
  })
})
