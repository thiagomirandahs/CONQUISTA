// Feed e stories pedidos em paralelo com o status da Rede (4G fraco): usados UMA vez, só pela mesma unidade, só por 15 s.
import { describe, it, expect, vi, beforeEach } from 'vitest'
const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
const { adiantarFeed, usarAdiantado } = await import('./rede.js')

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { itens: [{ id: 'p1' }] }, error: null }); vi.useRealTimers() })

describe('feed adiantado', () => {
  it('pede feed e stories já na entrada e entrega o resultado UMA vez para a mesma unidade', async () => {
    adiantarFeed('clube-a')
    expect(rpc).toHaveBeenCalledWith('rede_feed', expect.objectContaining({ p_filtro: 'meu_clube' }))
    expect(rpc).toHaveBeenCalledWith('rede_stories', undefined)
    expect(usarAdiantado('clube-b', 'feed')).toBeNull()            // outra unidade: não serve
    const p = usarAdiantado('clube-a', 'feed')
    expect((await p).itens[0].id).toBe('p1')
    expect(usarAdiantado('clube-a', 'feed')).toBeNull()            // já usado
  })
  it('depois de 15 s não vale mais (a tela pede de novo)', () => {
    vi.useFakeTimers()
    adiantarFeed('clube-a')
    vi.advanceTimersByTime(16000)
    expect(usarAdiantado('clube-a', 'stories')).toBeNull()
  })
  it('sem unidade não pede nada', () => {
    adiantarFeed(null)
    expect(rpc).not.toHaveBeenCalled()
  })
})
