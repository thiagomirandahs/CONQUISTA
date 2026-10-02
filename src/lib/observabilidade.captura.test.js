// Captura ponta a ponta do logger: o que chega na RPC `registrar_erro` para cada forma de erro
// (lançado, rejeitado, fetch, Supabase, boundary, causa aninhada, circular, gigante) e que NENHUM
// segredo atravessa — nem em mensagem, stack, cause, contexto, rota ou URL.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { createElement } from 'react'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const PUB = 'sb_publishable_AbCdEfGhIjKlMnOpQrStUv_0123456789'
const SEC = 'sb_secret_ZyXwVuTsRqPoNmLkJiHgFe_9876543210'
const SEGREDOS = [JWT, 'eyJhbGci', 'SflKxwRJ', PUB, SEC, 'AbCdEfGhIjKl', 'ZyXwVuTs', 'SEGREDOTOKEN', 'SEGREDOAPIKEY', 'minhaSenha!9',
  'maria.silva@exemplo.com', '98765-4321', '123.456.789-09', 'COOKIEVALOR', 'Bearer eyJ']

const chamadas = []
let rpc

async function carregar() {
  vi.resetModules()
  chamadas.length = 0
  rpc = vi.fn(async (nome, args) => { chamadas.push({ nome, args }); return { error: null } })
  vi.doMock('./supabase.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) }, rpc } }))
  return import('./observabilidade.js')
}
const ultima = async () => { await waitFor(() => expect(chamadas.length).toBeGreaterThan(0)); return chamadas[chamadas.length - 1].args }
const semSegredo = (args) => { const j = JSON.stringify(args); SEGREDOS.forEach((s) => expect(j).not.toContain(s)) }

const ouvintes = []
const addOriginal = window.addEventListener.bind(window)
beforeEach(() => {
  window.history.pushState({}, '', '/trilha')
  // handlers globais de módulos anteriores não podem responder aos eventos deste teste
  vi.spyOn(window, 'addEventListener').mockImplementation((t, f, o) => { ouvintes.push([t, f, o]); addOriginal(t, f, o) })
})
afterEach(() => {
  ouvintes.splice(0).forEach(([t, f, o]) => window.removeEventListener(t, f, o))
  vi.restoreAllMocks()
})

describe('captura: cada forma de erro chega à RPC com o que importa', () => {
  it('throw new Error() sem mensagem', async () => {
    const { reportarErro } = await carregar()
    let e; try { throw new Error() } catch (x) { e = x }
    await reportarErro(e, { origem: 'janela', contexto: 'Erro não tratado na tela.' })
    const a = await ultima()
    expect(a.p_origem).toBe('janela')
    expect(a.p_contexto).toMatch(/^Erro não tratado na tela\. \| Error/)
    expect(a.p_codigo).toBe('Desconhecido')
    expect(a.p_rota).toBe('/trilha')
    expect(a.p_correlacao.length).toBeGreaterThanOrEqual(8)
  })

  it('string lançada (throw "texto")', async () => {
    const { reportarErro } = await carregar()
    await reportarErro('algo quebrou feio', { origem: 'ui', contexto: 'Não consegui salvar.' })
    const a = await ultima()
    expect(a.p_contexto).toBe('Não consegui salvar. | algo quebrou feio')
    expect(a.p_codigo).toMatch(/^Texto#[0-9a-f]{6}$/)
  })

  it('objeto lançado ({ message })', async () => {
    const { reportarErro } = await carregar()
    await reportarErro({ message: 'objeto sem classe', extra: 1 }, { origem: 'ui', contexto: 'X.' })
    const a = await ultima()
    expect(a.p_contexto).toContain('objeto sem classe')
  })

  it('objeto lançado sem nada reconhecível não vira lixo nem lança', async () => {
    const { reportarErro } = await carregar()
    await reportarErro({ foo: { bar: 1 } }, { origem: 'promessa', contexto: 'Operação falhou sem tratamento.' })
    const a = await ultima()
    expect(a.p_contexto).toBe('Operação falhou sem tratamento.')
    expect(a.p_codigo).toBe('Desconhecido')
  })

  it('Promise rejection com Error (evento unhandledrejection)', async () => {
    const { ligarObservabilidade } = await carregar()
    ligarObservabilidade()
    const ev = new Event('unhandledrejection'); ev.reason = new RangeError('Invalid array length')
    window.dispatchEvent(ev)
    const a = await ultima()
    expect(a.p_origem).toBe('promessa')
    expect(a.p_contexto).toContain('RangeError: Invalid array length')
    expect(a.p_codigo).toBe('RangeError#' + a.p_codigo.split('#')[1])
  })

  it('Promise rejection com NÃO-Error (string, undefined, objeto)', async () => {
    const { ligarObservabilidade } = await carregar()
    ligarObservabilidade()
    for (const reason of ['recusado', undefined, { code: 'P0001', message: 'Este requisito já foi decidido.' }]) {
      const ev = new Event('unhandledrejection'); ev.reason = reason
      window.dispatchEvent(ev)
    }
    await waitFor(() => expect(chamadas.length).toBe(3))
    expect(chamadas[0].args.p_contexto).toContain('recusado')
    expect(chamadas[1].args.p_codigo).toBe('SemDetalhe')
    expect(chamadas[2].args.p_codigo).toBe('P0001')
    expect(chamadas[2].args.p_contexto).toContain('Este requisito já foi decidido.')
  })

  it('window.onerror: preserva name/message/stack (local) e usa filename:lineno:colno quando não há objeto', async () => {
    const { ligarObservabilidade } = await carregar()
    ligarObservabilidade()
    const err = new TypeError("Cannot read properties of undefined (reading 'map')")
    err.stack = "TypeError: Cannot read properties of undefined (reading 'map')\n    at X (https://app.desbravaclube.com.br/assets/Bichinho-Qw12.js:7:99)"
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }))
    let a = await ultima()
    expect(a.p_contexto).toContain("TypeError: Cannot read properties of undefined (reading 'map')")
    expect(a.p_contexto).toContain('[Bichinho-Qw12.js:7:99]')
    expect(a.p_codigo).toBe('TypeError:leitura:undefined.map')
    chamadas.length = 0
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: 'https://cdn.x.com/lib.js?token=SEGREDOTOKEN', lineno: 1, colno: 2 }))
    a = await ultima()
    expect(a.p_codigo).toBe('ScriptErrorCrossOrigin')
    expect(a.p_contexto).toContain('[lib.js:1:2]')
    semSegredo(a)
  })

  it('TypeError do motor e erro de fetch', async () => {
    const { reportarErro } = await carregar()
    await reportarErro(new TypeError('x.foo is not a function'), { origem: 'boundary', contexto: 'Q.' })
    expect(chamadas[0].args.p_codigo).toBe('TypeError:naofuncao:x.foo')
    const f = new TypeError('Failed to fetch'); f.stack = ''
    await reportarErro(f, { origem: 'ui', contexto: 'Sem rede.' })
    const a = chamadas[1].args
    expect(a.p_codigo).toBe('TypeError:RedeIndisponivel')
    expect(a.p_contexto).toBe('Sem rede. | TypeError: Failed to fetch')
  })

  it('erro Supabase/PostgREST (objeto code/message/details/hint)', async () => {
    const { reportarErro } = await carregar()
    await reportarErro({ code: '23505', message: 'duplicate key value violates unique constraint "membros_email_key"', details: 'Key (email)=(maria.silva@exemplo.com) already exists.', hint: null },
      { origem: 'ui', contexto: 'Não consegui cadastrar.' })
    const a = await ultima()
    expect(a.p_codigo).toBe('23505')
    expect(a.p_contexto).toContain('duplicate key value violates unique constraint')
    semSegredo(a)
  })

  it('cause em várias camadas chega na ordem (topo <- causa <- raiz)', async () => {
    const { reportarErro } = await carregar()
    const e = new Error('topo', { cause: new TypeError('meio', { cause: new Error('raiz') }) })
    e.stack = ''
    await reportarErro(e, { origem: 'ui', contexto: 'F.' })
    const a = await ultima()
    expect(a.p_contexto).toBe('F. | Error: topo <- TypeError: meio <- Error: raiz')
  })

  it('objeto circular (e cause circular) não quebra o envio', async () => {
    const { reportarErro } = await carregar()
    const o = { message: 'circular' }; o.self = o; o.cause = o
    await reportarErro(o, { origem: 'ui', contexto: 'C.' })
    const a = await ultima()
    expect(a.p_contexto).toContain('circular')
    const x = new Error('x'); x.cause = x
    await reportarErro(x, { origem: 'ui', contexto: 'C.' })
    expect(chamadas.length).toBe(2)
  })

  it('mensagem enorme: contexto <= 200, código <= 80, agente <= 120, rota <= 120; local preservado', async () => {
    const { reportarErro } = await carregar()
    const e = new Error('lorem ipsum '.repeat(5000))
    e.stack = 'Error: x\n    at f (https://x.co/assets/Trilha-AbC.js:10:20)'
    window.history.pushState({}, '', '/' + 'ab/'.repeat(100))
    await reportarErro(e, { origem: 'boundary', contexto: 'A tela quebrou e o app precisou se recuperar.' })
    const a = await ultima()
    expect(a.p_contexto.length).toBeLessThanOrEqual(200)
    expect(a.p_codigo.length).toBeLessThanOrEqual(80)
    expect(a.p_agente.length).toBeLessThanOrEqual(120)
    expect(a.p_rota.length).toBeLessThanOrEqual(120)
    expect(a.p_contexto).toContain('[Trilha-AbC.js:10:20]')
  })
})

describe('captura: segredos embutidos saem mascarados em TODOS os campos enviados', () => {
  it('mensagem, stack, cause, contexto da tela e URL (rota com token de documento)', async () => {
    const { reportarErro } = await carregar()
    window.history.pushState({}, '', '/documento/7V8XC44WJ1NTYHMEK0ER?token=SEGREDOTOKEN')
    const e = new Error(`401 em https://x.supabase.co/rest/v1/t?apikey=SEGREDOAPIKEY&token=SEGREDOTOKEN Authorization: Bearer ${JWT} chave ${PUB} ${SEC}`,
      { cause: new Error('senha=minhaSenha!9 Cookie: sb=COOKIEVALOR; x=1 mail maria.silva@exemplo.com tel (11) 98765-4321 cpf 123.456.789-09') })
    e.stack = `Error: ${e.message}\n    at f (https://x.co/assets/Trilha-AbC.js?token=SEGREDOTOKEN:10:20)`
    await reportarErro(e, { origem: 'boundary', contexto: `Falhou para maria.silva@exemplo.com com ${JWT}` })
    const a = await ultima()
    semSegredo(a)
    expect(a.p_rota).toBe('/documento/:token')
    expect(a.p_contexto).toContain('Trilha-AbC.js:10:20')
  })

  it('código derivado também não vaza (mensagem desconhecida vira hash; nome hostil é descartado)', async () => {
    const { reportarErro } = await carregar()
    const e = new Error(`falha com ${PUB}`); e.name = `Hostil ${JWT}`
    await reportarErro(e, { origem: 'ui', contexto: 'H.' })
    semSegredo(await ultima())
  })

  it('erro com `esperado: true` não é registrado (validação da própria tela)', async () => {
    const { reportarErro } = await carregar()
    await reportarErro(Object.assign(new Error('Explique o que corrigir.'), { esperado: true }), { origem: 'ui', contexto: 'v.' })
    await new Promise((r) => setTimeout(r, 20))
    expect(chamadas.length).toBe(0)
  })

  it('sem sessão não envia; falha da RPC é engolida', async () => {
    vi.resetModules()
    vi.doMock('./supabase.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: vi.fn() } }))
    const m = await import('./observabilidade.js')
    await expect(m.reportarErro(new Error('x'))).resolves.toBeUndefined()
    vi.resetModules()
    vi.doMock('./supabase.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: {} } }) }, rpc: async () => { throw new Error('rede caiu') } } }))
    const m2 = await import('./observabilidade.js')
    await expect(m2.reportarErro(new Error('x'))).resolves.toBeUndefined()
  })
})

describe('captura: error boundary (ErroApp)', () => {
  it('erro de renderização chega com origem boundary, nome, mensagem, local e sem segredo', async () => {
    await carregar()
    const ErroApp = (await import('../components/ErroApp.jsx')).default
    const erro = new TypeError(`Cannot read properties of undefined (reading 'tem') token=SEGREDOTOKEN ${JWT}`)
    erro.stack = `TypeError: ${erro.message}\n    at Bichinho (https://app.desbravaclube.com.br/assets/Bichinho-Zx9.js:55:12)`
    function Quebra() { throw erro }
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.pushState({}, '', '/bichinho')
    const { findByText } = render(createElement(ErroApp, null, createElement(Quebra)))
    expect(await findByText(/Precisamos atualizar o app/)).toBeTruthy()
    const a = await ultima()
    silencio.mockRestore()
    expect(a.p_origem).toBe('boundary')
    expect(a.p_rota).toBe('/bichinho')
    expect(a.p_contexto).toContain('A tela quebrou e o app precisou se recuperar.')
    expect(a.p_contexto).toContain('TypeError: Cannot read properties of undefined (reading')
    expect(a.p_contexto).toContain('[Bichinho-Zx9.js:55:12]')
    semSegredo(a)
  })
})
