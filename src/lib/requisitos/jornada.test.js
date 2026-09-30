import { describe, it, expect } from 'vitest'
import { statusDaJornada, contagens, progressoDaSecao, secaoTemPendencia, proximoRequisito } from './jornada.js'

const r = (id, over = {}) => ({ id, status: 'nao_iniciado', bloqueios: [], ...over })

describe('statusDaJornada', () => {
  it('mapeia o status do servidor', () => {
    expect(statusDaJornada(r('a', { status: 'aprovado' }))).toBe('aprovado')
    expect(statusDaJornada(r('a', { status: 'aguardando_avaliacao' }))).toBe('aguardando')
    expect(statusDaJornada(r('a', { status: 'correcao_solicitada', bloqueios: ['x'] }))).toBe('correcao')
    expect(statusDaJornada(r('a', { bloqueios: ['x'] }))).toBe('bloqueado')
    expect(statusDaJornada(r('a'))).toBe('nao_iniciado')
  })
  it('rascunho: em andamento, texto/foto antigos ou rascunho estruturado', () => {
    expect(statusDaJornada(r('a', { status: 'em_andamento' }))).toBe('rascunho')
    expect(statusDaJornada(r('a', { evidencia_texto: 'oi' }))).toBe('rascunho')
    expect(statusDaJornada(r('a', { evidencia_path: 'p/x.jpg' }))).toBe('rascunho')
    expect(statusDaJornada(r('a'), { rascunho: { resumo: 'x' } })).toBe('rascunho')
    expect(statusDaJornada(r('a'), { rascunho: {} })).toBe('nao_iniciado')
    expect(statusDaJornada(r('a'), { rascunho: null })).toBe('nao_iniciado')
  })
  it('nunca devolve "enviado": o servidor não distingue de "aguardando"', () => {
    const todos = ['nao_iniciado', 'em_andamento', 'aguardando_avaliacao', 'aprovado', 'correcao_solicitada'].map((status) => statusDaJornada(r('a', { status })))
    expect(todos).not.toContain('enviado')
  })
})

const SECOES = [
  { id: 's1', requisitos: [r('a', { status: 'aprovado' }), r('b', { status: 'aprovado' })] },
  { id: 's2', requisitos: [r('c', { status: 'aguardando_avaliacao' }), r('d', { status: 'correcao_solicitada' }), r('e')] },
]

describe('contagens / seção', () => {
  it('agrupa o status devolvido pelo servidor', () => {
    expect(contagens(SECOES)).toEqual({ total: 5, aprovados: 2, aguardando: 1, correcao: 1 })
    expect(contagens(null)).toEqual({ total: 0, aprovados: 0, aguardando: 0, correcao: 0 })
  })
  it('progresso e pendência da seção', () => {
    expect(progressoDaSecao(SECOES[0].requisitos)).toEqual({ feitos: 2, total: 2 })
    expect(progressoDaSecao(SECOES[1].requisitos)).toEqual({ feitos: 0, total: 3 })
    expect(secaoTemPendencia(SECOES[0])).toBe(false)
    expect(secaoTemPendencia(SECOES[1])).toBe(true)
    expect(secaoTemPendencia({ requisitos: [r('x', { status: 'aguardando_avaliacao' }), r('y', { status: 'aprovado' })] })).toBe(false)
  })
})

describe('proximoRequisito ([CONTINUAR])', () => {
  it('correção vence rascunho, que vence não iniciado', () => {
    const s = [{ id: 's', requisitos: [r('n1'), r('rasc', { status: 'em_andamento' }), r('corr', { status: 'correcao_solicitada' })] }]
    expect(proximoRequisito(s)).toEqual({ requisitoId: 'corr', secaoId: 's', status: 'correcao' })
    expect(proximoRequisito([{ id: 's', requisitos: [r('n1'), r('rasc', { status: 'em_andamento' })] }]).requisitoId).toBe('rasc')
    expect(proximoRequisito([{ id: 's', requisitos: [r('n1'), r('n2')] }]).requisitoId).toBe('n1')
  })
  it('rascunho estruturado (classe_formularios) conta como rascunho', () => {
    const s = [{ id: 's', requisitos: [r('n1'), r('f')] }]
    expect(proximoRequisito(s, { f: { rascunho: { resumo: 'x' } } }).requisitoId).toBe('f')
  })
  it('bloqueado NUNCA é sugerido; aguardando e aprovado também não', () => {
    const s = [{ id: 's', requisitos: [r('b', { bloqueios: ['x'] }), r('ag', { status: 'aguardando_avaliacao' }), r('ok', { status: 'aprovado' })] }]
    expect(proximoRequisito(s)).toBeNull()
  })
  it('pula o bloqueado e acha o próximo livre, em outra seção', () => {
    const s = [{ id: 'a', requisitos: [r('b', { bloqueios: ['x'] })] }, { id: 'b', requisitos: [r('livre')] }]
    expect(proximoRequisito(s)).toEqual({ requisitoId: 'livre', secaoId: 'b', status: 'nao_iniciado' })
  })
  it('tudo aprovado/enviado: null', () => {
    expect(proximoRequisito([SECOES[0]])).toBeNull()
    expect(proximoRequisito([])).toBeNull()
  })
})
