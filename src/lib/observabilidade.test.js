import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: vi.fn() } }))

const { codigoDoErro, impressaoDaMensagem, localDoErro, agenteComVersao } = await import('./observabilidade.js')

describe('codigoDoErro: nunca "Desconhecido" por perda de informação', () => {
  it('reconhece SQLSTATE de regra de negócio (P0001), que era a causa dos "Desconhecido"', () => {
    expect(codigoDoErro({ code: 'P0001', message: 'Este requisito já foi decidido por outra pessoa.' })).toBe('P0001')
    expect(codigoDoErro({ code: '22P02', message: 'invalid input syntax' })).toBe('22P02')
    expect(codigoDoErro({ code: '42501', message: 'permission denied' })).toBe('42501')
    expect(codigoDoErro({ code: 'PGRST204', message: 'x' })).toBe('PGRST204')
  })

  it('status HTTP de Edge Function/Storage quando não há code', () => {
    expect(codigoDoErro(Object.assign(new Error('x'), { name: 'FunctionsHttpError', context: { status: 429 } }))).toBe('FunctionsHttpError:HTTP429')
    expect(codigoDoErro({ message: 'x', statusCode: 413 })).toBe('HTTP413')
  })

  it('valores que não são Error viram o TIPO, não "Desconhecido"', () => {
    expect(codigoDoErro(undefined)).toBe('SemDetalhe')
    expect(codigoDoErro(42)).toBe('Rejeicao:number')
    expect(codigoDoErro(true)).toBe('Rejeicao:boolean')
    expect(codigoDoErro({})).toBe('Desconhecido')
    expect(codigoDoErro(new Event('error'))).toBe('Evento:error')
  })

  it('"Script error." e ResizeObserver têm rótulo próprio', () => {
    expect(codigoDoErro('Script error.')).toBe('ScriptErrorCrossOrigin')
    expect(codigoDoErro('ResizeObserver loop completed with undelivered notifications.')).toBe('ResizeObserver')
  })

  it('chunk, rede e timeout seguem rotulados', () => {
    expect(codigoDoErro(new TypeError('Failed to fetch dynamically imported module: /assets/A-x.js'))).toBe('TypeError:ChunkLoad')
    expect(codigoDoErro(new TypeError('Failed to fetch'))).toBe('TypeError:RedeIndisponivel')
    expect(codigoDoErro(new Error('Load failed'))).toBe('RedeIndisponivel')
    expect(codigoDoErro(new Error('request timed out'))).toBe('Timeout')
  })

  it('TypeError do motor mostra só a forma conhecida (variável/propriedade), nunca valor', () => {
    expect(codigoDoErro(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe('TypeError:leitura:undefined.map')
    expect(codigoDoErro(new TypeError('x.foo is not a function'))).toBe('TypeError:naofuncao:x.foo')
    expect(codigoDoErro(new ReferenceError('abc is not defined'))).toBe('ReferenceError:naodefinido:abc')
  })

  it('mensagem fora da lista não vaza: vira impressão digital estável', () => {
    const segredo = 'duplicate key value violates unique constraint (email)=(alguem@x.com)'
    const c = codigoDoErro(new Error(segredo))
    expect(c).toMatch(/^Erro#[0-9a-f]{6}$/)
    expect(c).not.toContain('alguem')
    expect(codigoDoErro(new Error(segredo))).toBe(c) // estável
    const t = codigoDoErro(new TypeError('JSON weird "Maria Silva" token'))
    expect(t).toMatch(/^TypeError#[0-9a-f]{6}$/)
    expect(t).not.toContain('Maria')
  })

  it('impressão ignora números e uuids (mesma frase, ids diferentes = mesmo hash)', () => {
    expect(impressaoDaMensagem('linha 3 do pedido 77')).toBe(impressaoDaMensagem('linha 9 do pedido 12'))
    expect(impressaoDaMensagem('a 11111111-2222-3333-4444-555555555555 b')).toBe(impressaoDaMensagem('a aaaaaaaa-2222-3333-4444-555555555555 b'))
  })

  it('o código cabe no limite do servidor (80)', () => {
    expect(codigoDoErro(new TypeError(`Cannot read properties of undefined (reading '${'a'.repeat(30)}')`)).length).toBeLessThanOrEqual(80)
  })

  it('compatibilidade: padrões antigos por mensagem continuam valendo', () => {
    expect(codigoDoErro(new Error('falhou com 23505 duplicado'))).toBe('23505')
  })
})

describe('localDoErro / agenteComVersao', () => {
  it('extrai arquivo:linha:coluna do bundle, sem URL', () => {
    const e = { stack: 'TypeError: x\n    at f (https://app.desbravaclube.com.br/assets/Trilha-AbC123.js:1:23456)' }
    expect(localDoErro(e)).toBe('Trilha-AbC123.js:1:23456')
    expect(localDoErro({ stack: 'Error: x\n    at <anonymous>' })).toBe('')
    expect(localDoErro('texto')).toBe('')
  })

  it('agente leva a versão do front e nunca passa de 120', () => {
    const a = agenteComVersao('M'.repeat(300), '202610011540-6413af0')
    expect(a.length).toBeLessThanOrEqual(120)
    expect(a.endsWith(' v202610011540-6413af0')).toBe(true)
    expect(agenteComVersao('Mozilla', '')).toBe('Mozilla')
  })
})
