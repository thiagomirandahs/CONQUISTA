import { describe, it, expect } from 'vitest'
import { hojeLocalISO, dataLocalISO, hojeMaisDiasLocalISO } from './data.js'

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

describe('dataLocalISO / hojeMaisDiasLocalISO (Brasília, não UTC)', () => {
  it('23h em Brasília (02h UTC do dia seguinte) continua sendo o MESMO dia local', () => {
    expect(dataLocalISO('2026-10-09T02:59:59+00:00')).toBe('2026-10-08')   // o fim de um desafio que termina 23:59:59-03:00 do dia 8
    expect(dataLocalISO('2026-10-08T03:00:00+00:00')).toBe('2026-10-08')   // 00:00 em Brasília
    expect(dataLocalISO('2026-10-08T02:59:59+00:00')).toBe('2026-10-07')
    expect(dataLocalISO('lixo')).toBe('')
  })
  it('ida e volta do desafio: gravar 23:59:59-03:00 e reler não anda um dia', () => {
    const fim = new Date('2026-10-08T23:59:59-03:00').toISOString()
    expect(dataLocalISO(fim)).toBe('2026-10-08')
  })
  it('hoje + n dias em Brasília', () => {
    expect(hojeMaisDiasLocalISO(0)).toBe(hojeLocalISO())
    expect(hojeMaisDiasLocalISO(7)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
