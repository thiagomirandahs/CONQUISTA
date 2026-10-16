// Miniaturas da Rede (migration 555): nome derivado da foto; sobe ~30 KB e registra no post; falha nunca derruba a publicação.
import { describe, it, expect, vi, beforeEach } from 'vitest'
const f = { upload: vi.fn(), remove: vi.fn(), rpc: vi.fn(), otimizar: vi.fn() }
vi.mock('../lib/supabase.js', () => ({
  supabase: { rpc: (...a) => f.rpc(...a), storage: { from: () => ({ upload: (...a) => f.upload(...a), remove: (...a) => f.remove(...a) }) } },
}))
vi.mock('../lib/imagem.js', async (orig) => ({ ...(await orig()), otimizarFoto: (...a) => f.otimizar(...a) }))
const { caminhoDaMiniatura, subirMiniatura } = await import('./rede.js')

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.otimizar.mockResolvedValue({ arquivo: { type: 'image/webp', size: 20000 } })
  f.upload.mockResolvedValue({ error: null }); f.remove.mockResolvedValue({ error: null })
  f.rpc.mockResolvedValue({ data: true, error: null })
})

describe('miniatura da Rede', () => {
  it('nome derivado da própria foto', () => {
    expect(caminhoDaMiniatura('c/u/abc.webp')).toBe('c/u/abc-min.webp')
    expect(caminhoDaMiniatura('c/u/abc.jpg')).toBe('c/u/abc-min.webp')
    expect(caminhoDaMiniatura(null)).toBeNull()
  })
  it('sobe a miniatura e registra no post', async () => {
    expect(await subirMiniatura('c/u/abc.webp', { type: 'image/webp' }, 'post-1')).toBe(true)
    expect(f.upload).toHaveBeenCalledWith('c/u/abc-min.webp', expect.anything(), expect.objectContaining({ contentType: 'image/webp' }))
    expect(f.rpc).toHaveBeenCalledWith('rede_post_miniatura', { p_post: 'post-1', p_caminho: 'c/u/abc-min.webp' })
  })
  it('servidor recusou o registro: apaga a miniatura que subiu (não fica órfã)', async () => {
    f.rpc.mockResolvedValue({ data: false, error: null })
    expect(await subirMiniatura('c/u/abc.webp', { type: 'image/webp' }, 'post-1')).toBe(false)
    expect(f.remove).toHaveBeenCalledWith(['c/u/abc-min.webp'])
  })
  it('aparelho sem WebP ou erro ao otimizar: não sobe nada e não quebra', async () => {
    f.otimizar.mockResolvedValueOnce({ arquivo: { type: 'image/jpeg' } })
    expect(await subirMiniatura('c/u/abc.webp', {}, 'p')).toBe(false)
    f.otimizar.mockRejectedValueOnce(new Error('sem canvas'))
    expect(await subirMiniatura('c/u/abc.webp', {}, 'p')).toBe(false)
    expect(f.upload).not.toHaveBeenCalled()
  })
})
