import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
const { origemDeUso, ehRobo, caminhoContavel, sessaoDeUso, enviarSinal } = await import('./metricas.js')

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); try { sessionStorage.clear() } catch { /* */ } })
afterEach(() => { delete globalThis.Capacitor })

describe('metricas — o que NÃO identifica ninguém', () => {
  it('origem: site público, app (domínio/PWA/outros) e apk', () => {
    expect(origemDeUso('desbravaclube.com.br')).toBe('site')
    expect(origemDeUso('www.desbravaclube.com.br')).toBe('site')
    expect(origemDeUso('app.desbravaclube.com.br')).toBe('app')
    expect(origemDeUso('localhost')).toBe('app')
    globalThis.Capacitor = { isNativePlatform: () => true }
    expect(origemDeUso('localhost')).toBe('apk')
  })
  it('robôs não contam; a administração não entra na conta', () => {
    expect(ehRobo('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(ehRobo('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36')).toBe(false)
    expect(caminhoContavel('/admin')).toBe(false)
    expect(caminhoContavel('/admin/?aba=clubes')).toBe(false)
    expect(caminhoContavel('/administracao-do-clube')).toBe(true)
    expect(caminhoContavel('/inicio')).toBe(true)
  })
  it('a sessão é um UUID aleatório estável na aba', () => {
    const a = sessaoDeUso()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(sessaoDeUso()).toBe(a)
  })
  it('o sinal leva SÓ sessão, origem, página e logado — nenhum dado pessoal', async () => {
    await enviarSinal({ pagina: true, logado: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    const [nome, args] = rpc.mock.calls[0]
    expect(nome).toBe('metrica_registrar')
    expect(Object.keys(args).sort()).toEqual(['p_logado', 'p_origem', 'p_pagina', 'p_sessao'])
    expect(args.p_pagina).toBe(true)
  })
  it('erro de rede é engolido (medir nunca atrapalha)', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    await expect(enviarSinal()).resolves.toBeUndefined()
  })
})
