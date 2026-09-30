import { describe, it, expect, vi, beforeEach } from 'vitest'
const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
const { carregarMinhaJornada, carregarPortfolio } = await import('./jornada.js')
beforeEach(() => rpc.mockReset())

describe('jornada service', () => {
  it('minha_jornada normaliza listas e devolve null sem vínculo', async () => {
    rpc.mockResolvedValueOnce({ data: { classes: [{ nome: 'A' }] }, error: null })
    const d = await carregarMinhaJornada()
    expect(rpc).toHaveBeenCalledWith('minha_jornada', undefined)
    expect(d.classes).toHaveLength(1)
    expect(d.leituras).toEqual([])
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await carregarMinhaJornada()).toBeNull()
  })
  it('portfolio limita o tamanho e passa o cursor', async () => {
    rpc.mockResolvedValueOnce({ data: { itens: [{ a: 1 }], proximo: 'x|y' }, error: null })
    const r = await carregarPortfolio({ limite: 999, depois: 'c|i' })
    expect(rpc).toHaveBeenCalledWith('meu_portfolio', { p_limite: 50, p_depois: 'c|i' })
    expect(r).toEqual({ itens: [{ a: 1 }], proximo: 'x|y' })
  })
  it('portfolio com padrão e com erro', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await carregarPortfolio()).toEqual({ itens: [], proximo: null })
    expect(rpc).toHaveBeenLastCalledWith('meu_portfolio', { p_limite: 20, p_depois: null })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'falhou' } })
    await expect(carregarPortfolio()).rejects.toThrow('falhou')
  })
})
