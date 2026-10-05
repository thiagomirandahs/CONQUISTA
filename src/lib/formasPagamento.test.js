import { describe, it, expect } from 'vitest'
import { lerFormas, serializarFormas, linkHttpsSeguro, dinheiroBR, MAX_FORMAS } from './formasPagamento.js'

describe('formasPagamento', () => {
  it('lê a lista nova e o valor; descarta lixo, tipo desconhecido e link que não é https', () => {
    const r = lerFormas({ mensalidade_valor: '27,5', formas_pagamento: JSON.stringify([
      { tipo: 'pix', detalhe: ' abc ' }, { tipo: 'bitcoin', detalhe: 'x' }, { tipo: 'link', detalhe: 'javascript:alert(1)' },
      { tipo: 'link', detalhe: 'http://inseguro.com' }, { tipo: 'dinheiro', detalhe: '' }, { tipo: 'outro', detalhe: 'na secretaria' },
    ]) })
    expect(r.valor).toBe(27.5)
    expect(r.formas.map((f) => f.tipo)).toEqual(['pix', 'outro'])
    expect(r.formas[0].detalhe).toBe('abc')
  })
  it('clube antigo: só a chave PIX vira uma forma PIX; JSON quebrado não derruba', () => {
    expect(lerFormas({ pix: 'chave@x.com' }).formas).toEqual([{ tipo: 'pix', rotulo: '', detalhe: 'chave@x.com' }])
    expect(lerFormas({ formas_pagamento: '{ruim', pix: '' })).toEqual({ formas: [], valor: null })
    expect(lerFormas({ mensalidade_valor: '-3' }).valor).toBeNull()
  })
  it('serializa: ignora linha em branco, espelha o 1º PIX na chave antiga e valida link e valor', () => {
    const ok = serializarFormas({ valor: '30', formas: [{ tipo: 'dinheiro', detalhe: 'com o tesoureiro' }, { tipo: 'pix', detalhe: '1199' }, { tipo: 'pix', detalhe: '  ' }] })
    const porChave = Object.fromEntries(ok.linhas.map((l) => [l.chave, l.valor]))
    expect(JSON.parse(porChave.formas_pagamento)).toHaveLength(2)
    expect(porChave.pix).toBe('1199')
    expect(porChave.mensalidade_valor).toBe('30')
    expect(serializarFormas({ formas: [{ tipo: 'link', detalhe: 'http://x.com' }] }).erro).toMatch(/https/)
    expect(serializarFormas({ valor: 'abc', formas: [] }).erro).toMatch(/inválido/)
    expect(serializarFormas({ valor: '', formas: [] }).linhas.find((l) => l.chave === 'pix').valor).toBe('')
  })
  it('limites: máximo de formas e link com senha embutida é recusado', () => {
    const muitas = Array.from({ length: MAX_FORMAS + 1 }, (_, i) => ({ tipo: 'outro', detalhe: 'f' + i }))
    expect(serializarFormas({ formas: muitas }).erro).toMatch(/No máximo/)
    expect(linkHttpsSeguro('https://user:pw@x.com')).toBeNull()
    expect(linkHttpsSeguro('https://x.com/p?a=1')).toBe('https://x.com/p?a=1')
  })
  it('dinheiroBR', () => { expect(dinheiroBR(30)).toBe('R$ 30'); expect(dinheiroBR(27.5)).toBe('R$ 27,50') })
})
