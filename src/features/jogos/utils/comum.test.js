import { describe, it, expect } from 'vitest'
import { embaralhar } from './comum.js'

describe('embaralhar', () => {
  it('mantém os mesmos elementos (só muda a ordem)', () => {
    const orig = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = embaralhar(orig)
    expect(out).toHaveLength(orig.length)
    expect([...out].sort((a, b) => a - b)).toEqual(orig)
  })
  it('não altera o array original', () => {
    const orig = ['a', 'b', 'c']
    const copia = [...orig]
    embaralhar(orig)
    expect(orig).toEqual(copia)
  })
  it('lida com vazio e um elemento', () => {
    expect(embaralhar([])).toEqual([])
    expect(embaralhar([42])).toEqual([42])
  })
})
