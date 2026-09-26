// Média das avaliações de visitas por coordenador (visão geral do portal, migration 320).
import { describe, it, expect } from 'vitest'
import { mediasDeAvaliacao, avaliacaoEditavel } from './AvaliacaoVisita.jsx'

const v = (unidade, nome, geral) => ({ agendada_por: { nome, unidade: { id: unidade, nome: unidade } }, avaliacao: geral ? { geral } : null })

describe('mediasDeAvaliacao', () => {
  it('agrupa por quem visitou e ignora visitas sem avaliação', () => {
    const r = mediasDeAvaliacao([v('D1', 'Ana', 5), v('D1', 'Ana', 4), v('D2', 'Beto', 2), v('D2', 'Beto', null)])
    expect(r).toEqual([
      expect.objectContaining({ unidade: 'D1', nome: 'Ana', total: 2, media: 4.5 }),
      expect.objectContaining({ unidade: 'D2', nome: 'Beto', total: 1, media: 2 }),
    ])
  })
  it('lista vazia/nula', () => {
    expect(mediasDeAvaliacao(null)).toEqual([])
  })
})

describe('avaliacaoEditavel', () => {
  it('sem avaliação ainda: pode avaliar; prazo vencido: não', () => {
    expect(avaliacaoEditavel(null)).toBe(true)
    expect(avaliacaoEditavel({ editavel_ate: '2026-01-10T00:00:00Z' }, Date.parse('2026-01-09T00:00:00Z'))).toBe(true)
    expect(avaliacaoEditavel({ editavel_ate: '2026-01-10T00:00:00Z' }, Date.parse('2026-01-11T00:00:00Z'))).toBe(false)
  })
})
