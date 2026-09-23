import { describe, it, expect } from 'vitest'
import { razaoDeContraste, corDeTextoSobre, corDeMarcaLegivel, variaveisDeContraste } from './contraste.js'

// Fase 7: a cor que o CLUBE escolhe nunca pode quebrar a legibilidade.
// O clube personaliza a marca; ninguém vai pedir que ele entenda de contraste. O app calcula.
describe('contraste da cor do clube', () => {
  it('mede a razão de contraste pela fórmula da WCAG', () => {
    expect(razaoDeContraste('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(razaoDeContraste('#ffffff', '#ffffff')).toBeCloseTo(1, 2)
  })

  it('cor ESCURA do clube: texto branco em cima', () => {
    for (const cor of ['#1e3a8a', '#3b5bfd', '#7c2d12', '#065f46']) {
      expect(corDeTextoSobre(cor), cor).toBe('#ffffff')
    }
  })

  it('cor CLARA do clube (o caso que quebrava tudo): texto escuro em cima', () => {
    for (const cor of ['#ffe066', '#fef08a', '#a7f3d0', '#fde68a']) {
      expect(corDeTextoSobre(cor), cor).toBe('#111a3d')
    }
  })

  // O texto em cima da marca é sempre grande e em negrito (botão, aba, destino ativo): o limiar da
  // WCAG para esse caso é 3:1. Algumas cores — vermelho puro é o exemplo — não chegam a 4.5:1 com
  // NENHUM texto, branco ou preto; o que o app garante é sempre a melhor das duas, e nunca abaixo
  // de 3:1. (A tela de identidade do clube já avisa quem escolhe uma cor de baixo contraste.)
  it('a escolha é sempre a MELHOR das duas e nunca fica abaixo de 3:1 (texto grande/negrito)', () => {
    for (const cor of ['#ffe066', '#1e3a8a', '#888888', '#00d4ff', '#ff0000', '#fef08a']) {
      const escolhido = corDeTextoSobre(cor)
      const outro = escolhido === '#ffffff' ? '#111a3d' : '#ffffff'
      expect(razaoDeContraste(cor, escolhido), `${cor} com ${escolhido}`).toBeGreaterThanOrEqual(3)
      expect(razaoDeContraste(cor, escolhido), `${cor}: escolheu o pior`).toBeGreaterThanOrEqual(razaoDeContraste(cor, outro))
    }
  })

  it('a marca usada como TEXTO é escurecida até dar para ler', () => {
    const amarelo = '#ffe066'
    expect(razaoDeContraste(amarelo, '#ffffff')).toBeLessThan(4.5)   // como veio, é ilegível
    const ajustada = corDeMarcaLegivel(amarelo)
    expect(razaoDeContraste(ajustada, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('cor escura o bastante não é alterada à toa', () => {
    expect(corDeMarcaLegivel('#1e3a8a')).toBe('#1e3a8a')
  })

  it('clube sem cor definida não sobrescreve nada (o tema padrão continua igual)', () => {
    expect(variaveisDeContraste(null)).toEqual({})
    expect(variaveisDeContraste('')).toEqual({})
    expect(variaveisDeContraste('roxo-claro')).toEqual({})
  })

  it('clube com cor definida gera as duas variáveis', () => {
    const v = variaveisDeContraste('#ffe066')
    expect(v['--marca-1-texto']).toBe('#111a3d')
    expect(v['--marca-1-legivel']).toBeTruthy()
  })
})
