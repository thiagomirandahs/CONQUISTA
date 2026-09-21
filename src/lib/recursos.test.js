import { describe, it, expect } from 'vitest'
import { tabelaAusente, recursosDaResposta } from './recursos.js'

describe('recursosDaResposta — Leilão com o front publicado antes do SQL', () => {
  it('banco com club_features: usa o que o clube tem ligado', () => {
    expect(recursosDaResposta({ data: [{ feature: 'leilao', enabled: true }], error: null })).toEqual({ leilao: true })
    expect(recursosDaResposta({ data: [{ feature: 'leilao', enabled: false }], error: null })).toEqual({ leilao: false })
    expect(recursosDaResposta({ data: [], error: null })).toEqual({})
  })
  it('tabela inexistente (banco antigo, um clube só): o Leilão segue ligado, como sempre foi', () => {
    expect(recursosDaResposta({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.club_features' in the schema cache" } })).toEqual({ leilao: true })
    expect(recursosDaResposta({ data: null, error: { code: '42P01', message: 'relation "club_features" does not exist' } })).toEqual({ leilao: true })
  })
  it('qualquer OUTRA falha (rede, permissão) NÃO liga nada: falha fechada', () => {
    expect(recursosDaResposta({ data: null, error: { code: '42501', message: 'permission denied' } })).toEqual({})
    expect(recursosDaResposta({ data: null, error: { message: 'Failed to fetch' } })).toEqual({})
  })
  it('tabelaAusente só reconhece tabela inexistente', () => {
    expect(tabelaAusente({ code: 'PGRST205' })).toBe(true)
    expect(tabelaAusente({ message: 'JWT expired' })).toBe(false)
    expect(tabelaAusente(null)).toBe(false)
  })
})
