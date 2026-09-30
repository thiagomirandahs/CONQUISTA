import { describe, it, expect } from 'vitest'
import { formatarHorario, previaDoConteudo, SEM_HORARIO } from './conflito.js'

const AGORA = new Date(2026, 8, 30, 15, 0) // 30/09/2026 15:00 (local)

describe('formatarHorario', () => {
  it('hoje / ontem / data curta', () => {
    expect(formatarHorario(new Date(2026, 8, 30, 14, 32), AGORA)).toBe('hoje 14:32')
    expect(formatarHorario(new Date(2026, 8, 29, 9, 10), AGORA)).toBe('ontem 09:10')
    expect(formatarHorario(new Date(2026, 8, 28, 16, 5), AGORA)).toBe('28/09 16:05')
  })
  it('aceita ms e ISO', () => {
    expect(formatarHorario(new Date(2026, 8, 30, 8, 1).getTime(), AGORA)).toBe('hoje 08:01')
    expect(formatarHorario(new Date(2026, 8, 29, 23, 59).toISOString(), AGORA)).toBe('ontem 23:59')
  })
  it('sem valor ou inválido: "horário indisponível"', () => {
    expect(formatarHorario(null, AGORA)).toBe(SEM_HORARIO)
    expect(formatarHorario(undefined, AGORA)).toBe('horário indisponível')
    expect(formatarHorario('', AGORA)).toBe(SEM_HORARIO)
    expect(formatarHorario('lixo', AGORA)).toBe(SEM_HORARIO)
  })
})

describe('previaDoConteudo', () => {
  it('junta os primeiros textos e ignora números e marcações', () => {
    expect(previaDoConteudo({ resumo: 'Li o livro', qtd: 3, feito: true, itens: ['a', 'b'] })).toBe('Li o livro · a · b')
  })
  it('entra em listas e objetos aninhados, na ordem', () => {
    expect(previaDoConteudo({ dias: [{ t: 'Dia um' }, { t: 'Dia dois' }], escolha: { opcao: 'x', dados: { nota: 'ok' } } })).toBe('Dia um · Dia dois · x · ok')
  })
  it('corta em ~140 caracteres com reticências', () => {
    const p = previaDoConteudo({ resumo: 'a'.repeat(300) })
    expect(p.length).toBeLessThanOrEqual(141)
    expect(p.endsWith('…')).toBe(true)
  })
  it('texto curto não ganha reticências e espaços são normalizados', () => {
    expect(previaDoConteudo({ r: '  oi   mundo \n ' })).toBe('oi mundo')
  })
  it('sem texto algum: aviso legível', () => {
    expect(previaDoConteudo({})).toBe('(sem texto escrito)')
    expect(previaDoConteudo(null)).toBe('(sem texto escrito)')
    expect(previaDoConteudo({ n: 1, ok: true })).toBe('(sem texto escrito)')
  })
})
