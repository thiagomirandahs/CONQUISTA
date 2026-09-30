// Achado da fase 7 (/rede/publicar): sem clube ou perfil o caminho do arquivo virava "undefined/…" e o Storage
// devolvia erro cru. Agora falha antes, com texto humano, e NADA é enviado.
import { describe, it, expect, vi } from 'vitest'

const upload = vi.fn(async () => ({ error: null }))
const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), storage: { from: () => ({ upload: (...a) => upload(...a), remove: async () => ({}) }) } } }))

const { publicarNaRede, publicarStory } = await import('./rede.js')
const foto = { arquivo: new File(['x'], 'a.webp', { type: 'image/webp' }) }

describe('publicar na Rede sem clube/perfil', () => {
  it.each([[null, 'u'], ['c', undefined], [undefined, undefined]])('post com foto (clube=%s, user=%s) falha antes de enviar', async (clubeId, userId) => {
    upload.mockClear(); rpc.mockClear()
    await expect(publicarNaRede({ tipo: 'foto', foto, clubeId, userId })).rejects.toThrow(/identificar seu clube ou seu perfil/)
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('story com foto também', async () => {
    upload.mockClear()
    await expect(publicarStory({ foto, clubeId: null, userId: 'u' })).rejects.toThrow(/identificar seu clube ou seu perfil/)
    expect(upload).not.toHaveBeenCalled()
  })
  it('post só de texto não precisa de clube no caminho (segue normal)', async () => {
    rpc.mockClear()
    const r = await publicarNaRede({ tipo: 'livre', legenda: 'oi', foto: null, clubeId: null, userId: 'u' })
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('rede_publicar', expect.objectContaining({ p_foto_path: null }))
  })
  it('com clube e perfil o caminho é <clube>/<eu>/<id>.webp', async () => {
    upload.mockClear()
    await publicarNaRede({ tipo: 'foto', foto, clubeId: 'c1', userId: 'u1' })
    expect(upload.mock.calls[0][0]).toMatch(/^c1\/u1\/.+\.webp$/)
  })
})
