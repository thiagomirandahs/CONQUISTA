import { describe, it, expect } from 'vitest'
import { VOCABULARIO, palavras } from './vocabulario.js'

describe('vocabulário do clube', () => {
  it('só A–Z maiúsculo, sem repetição', () => {
    expect(VOCABULARIO.every((p) => /^[A-Z]{2,14}$/.test(p))).toBe(true)
    expect(new Set(VOCABULARIO).size).toBe(VOCABULARIO.length)
  })
  it('tem muito mais palavras que antes (centenas) e cobre as faixas de cada jogo', () => {
    expect(VOCABULARIO.length).toBeGreaterThan(300)
    expect(palavras(5, 5).length).toBeGreaterThan(40)   // Termo
    expect(palavras(6, 14).length).toBeGreaterThan(100) // Forca / Anagrama
    expect(palavras(3, 7).length).toBeGreaterThan(100)  // Caça / Morse
  })
  it('respeita o comprimento e aceita extras sem duplicar', () => {
    expect(palavras(5, 5).every((p) => p.length === 5)).toBe(true)
    const com = palavras(5, 5, ['LENCO', 'ZZZZZ'])
    expect(com.filter((p) => p === 'LENCO')).toHaveLength(1)
    expect(com).toContain('ZZZZZ')
  })
  it('as palavras antigas dos jogos continuam disponíveis', () => {
    for (const p of ['ACAMPAMENTO', 'DESBRAVADOR', 'BUSSOLA', 'LANTERNA', 'INVESTIDURA']) expect(VOCABULARIO).toContain(p)
    for (const p of ['TENDA', 'CORDA', 'LENCO', 'AMIGO', 'HONRA']) expect(palavras(5, 5)).toContain(p)
  })
  it('cabem no caça-palavras (8x8): nenhuma passa de 7 letras na faixa 3–7', () => {
    expect(Math.max(...palavras(3, 7).map((p) => p.length))).toBeLessThanOrEqual(7)
  })
})
