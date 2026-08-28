import { describe, it, expect } from 'vitest'
import { hojeLocalISO } from './data.js'

describe('hojeLocalISO', () => {
  it('devolve YYYY-MM-DD', () => {
    expect(hojeLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('é uma data real (mês 01-12, dia 01-31)', () => {
    const [, mes, dia] = hojeLocalISO().split('-').map(Number)
    expect(mes).toBeGreaterThanOrEqual(1)
    expect(mes).toBeLessThanOrEqual(12)
    expect(dia).toBeGreaterThanOrEqual(1)
    expect(dia).toBeLessThanOrEqual(31)
  })
})
