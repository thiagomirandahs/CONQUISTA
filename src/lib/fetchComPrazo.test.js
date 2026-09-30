// fetch com prazo do cliente do Supabase (fase 7).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { criarFetchComPrazo, precisaDePrazo } from './fetchComPrazo.js'

afterEach(() => { vi.useRealTimers() })

// fetch de mentira que PENDURA, mas obedece ao cancelamento (como o de verdade)
function fetchPendurado() {
  return vi.fn((url, init) => new Promise((_, rejeitar) => {
    init?.signal?.addEventListener('abort', () => rejeitar(init.signal.reason || new DOMException('aborted', 'AbortError')))
  }))
}

describe('quais pedidos ganham prazo', () => {
  it.each([
    ['https://x.supabase.co/auth/v1/token?grant_type=refresh_token', true],
    ['https://x.supabase.co/rest/v1/rpc/meu_perfil', true],
    ['https://x.supabase.co/storage/v1/object/imagens/perfis/a.jpg', false],
    ['https://x.supabase.co/functions/v1/gerar-documento-pdf', false],
    ['https://x.supabase.co/realtime/v1/websocket', false],
  ])('%s → %s', (url, esperado) => { expect(precisaDePrazo(url)).toBe(esperado) })
})

describe('criarFetchComPrazo', () => {
  it('prazos PADRÃO: login aborta em 12 s; dados em 25 s (login tem payload minúsculo, não precisa esperar mais)', async () => {
    vi.useFakeTimers()
    const base = fetchPendurado()
    const f = criarFetchComPrazo(base)
    const login = f('https://x.supabase.co/auth/v1/token', {}).catch((e) => e)
    const dados = f('https://x.supabase.co/rest/v1/rpc/meu_perfil', {}).catch((e) => e)
    const terminou = { login: false, dados: false }
    login.then(() => { terminou.login = true }); dados.then(() => { terminou.dados = true })
    await vi.advanceTimersByTimeAsync(11999)
    expect(terminou).toEqual({ login: false, dados: false })
    await vi.advanceTimersByTimeAsync(2)
    expect(terminou).toEqual({ login: true, dados: false })
    await vi.advanceTimersByTimeAsync(13000)
    expect(terminou).toEqual({ login: true, dados: true })
  })

  it('pedido de dados PENDURADO é abortado no prazo e vira erro tratável (não fica para sempre)', async () => {
    vi.useFakeTimers()
    const base = fetchPendurado()
    const f = criarFetchComPrazo(base, { ms: 8000 })
    const p = f('https://x.supabase.co/rest/v1/rpc/meu_perfil', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(7999)
    expect(base).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)
    const erro = await p
    expect(erro.name).toBe('TimeoutError')
  })

  it('resposta a tempo passa direto e não deixa timer pendente', async () => {
    vi.useFakeTimers()
    const base = vi.fn(async () => 'ok')
    const f = criarFetchComPrazo(base, { ms: 8000 })
    await expect(f('https://x.supabase.co/auth/v1/token', {})).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Storage e Edge Functions NÃO ganham prazo (upload/PDF podem demorar) — o fetch original é chamado como veio', async () => {
    const base = vi.fn(async () => 'ok')
    const f = criarFetchComPrazo(base, { ms: 10 })
    const init = { method: 'POST', body: 'x' }
    await f('https://x.supabase.co/storage/v1/object/imagens/a.jpg', init)
    expect(base).toHaveBeenCalledWith('https://x.supabase.co/storage/v1/object/imagens/a.jpg', init)
    expect(init.signal).toBeUndefined()
  })

  it('respeita o cancelamento que o chamador já tinha pedido', async () => {
    const base = fetchPendurado()
    const f = criarFetchComPrazo(base, { ms: 60000 })
    const dono = new AbortController()
    const p = f('https://x.supabase.co/rest/v1/tabela', { signal: dono.signal }).catch((e) => e)
    dono.abort(new Error('cancelado pelo chamador'))
    expect((await p).message).toBe('cancelado pelo chamador')
  })
})
