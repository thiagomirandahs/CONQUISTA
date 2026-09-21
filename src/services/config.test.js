import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const upsert = vi.fn()
vi.mock('../lib/supabase.js', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: () => ({ upsert: (...a) => upsert(...a) }) },
}))

const { gravarConfig, rpcInexistente } = await import('./config.js')

beforeEach(() => { rpc.mockReset(); upsert.mockReset() })

describe('rpcInexistente — só "a função ainda não existe" cai no upsert antigo', () => {
  it('reconhece função ausente (PostgREST e Postgres)', () => {
    expect(rpcInexistente({ code: 'PGRST202', message: 'x' })).toBe(true)
    expect(rpcInexistente({ code: '42883', message: 'x' })).toBe(true)
    expect(rpcInexistente({ message: 'Could not find the function public.config_gravar(p_linhas) in the schema cache' })).toBe(true)
  })
  it('NÃO trata permissão negada, validação ou rede como "função ausente"', () => {
    expect(rpcInexistente({ code: 'P0001', message: 'Sem permissão (apenas a liderança do clube).' })).toBe(false)
    expect(rpcInexistente({ message: 'Chave de configuração inválida.' })).toBe(false)
    expect(rpcInexistente({ message: 'Failed to fetch' })).toBe(false)
    expect(rpcInexistente(null)).toBe(false)
  })
})

describe('gravarConfig — RPC config_gravar (o clube vem de quem chama)', () => {
  const linhas = [{ chave: 'popup_ativo', valor: 'sim' }, { chave: 'popup_titulo', valor: 'Oi' }]

  it('grava pela RPC e NÃO faz upsert por chave', async () => {
    rpc.mockResolvedValue({ error: null })
    await gravarConfig(linhas)
    expect(rpc).toHaveBeenCalledWith('config_gravar', { p_linhas: linhas })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('banco antigo (RPC inexistente): cai no upsert antigo por chave', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function' } })
    upsert.mockResolvedValue({ error: null })
    await gravarConfig(linhas)
    expect(upsert).toHaveBeenCalledWith(linhas, { onConflict: 'chave' })
  })

  it('erro de permissão da RPC aparece para a pessoa (sem fallback silencioso)', async () => {
    rpc.mockResolvedValue({ error: { code: 'P0001', message: 'Sem permissão (apenas a liderança do clube).' } })
    await expect(gravarConfig(linhas)).rejects.toThrow('Sem permissão')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('falha do upsert de fallback também aparece', async () => {
    rpc.mockResolvedValue({ error: { code: '42883', message: 'x' } })
    upsert.mockResolvedValue({ error: { message: 'boom' } })
    await expect(gravarConfig(linhas)).rejects.toThrow('boom')
  })
})
