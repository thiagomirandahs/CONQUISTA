// Achado da fase 7 (/rede/publicar): sem clube ou perfil o caminho do arquivo virava "undefined/…" e o Storage
// devolvia erro cru. Agora falha antes, com texto humano, e NADA é enviado.
import { describe, it, expect, vi } from 'vitest'

const upload = vi.fn(async () => ({ error: null }))
const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), storage: { from: () => ({ upload: (...a) => upload(...a), remove: async () => ({}) }) } } }))

const { publicarNaRede, publicarStory, publicarConquista, carregarFeed } = await import('./rede.js')
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

describe('alcance e conquista (515)', () => {
  it('alcance padrão é "clube" e vai no p_alcance; conquista livre não é mais enviada', async () => {
    rpc.mockClear()
    await publicarNaRede({ tipo: 'atividade', legenda: 'x', foto: null, clubeId: 'c', userId: 'u' })
    const args = rpc.mock.calls[0][1]
    expect(args.p_alcance).toBe('clube')
    expect(args).not.toHaveProperty('p_conquista')
  })
  it('alcance inválido falha antes de chamar o servidor', async () => {
    rpc.mockClear()
    await expect(publicarNaRede({ tipo: 'aviso', legenda: 'x', alcance: 'mundo', clubeId: 'c', userId: 'u' })).rejects.toThrow('Alcance inválido.')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('publicarConquista chama a RPC com origem real; recusa origem fora de classe/especialidade', async () => {
    rpc.mockClear()
    await publicarConquista({ origemTipo: 'classe', origemId: 'abc', alcance: 'comunidade' })
    expect(rpc).toHaveBeenCalledWith('rede_publicar_conquista', { p_origem_tipo: 'classe', p_origem_id: 'abc', p_alcance: 'comunidade' })
    expect(() => publicarConquista({ origemTipo: 'livre', origemId: 'abc' })).toThrow()
    expect(() => publicarConquista({ origemTipo: 'classe', origemId: null })).toThrow()
  })
  it('feed padrão pede "meu_clube"', async () => {
    rpc.mockClear()
    await carregarFeed()
    expect(rpc).toHaveBeenCalledWith('rede_feed', expect.objectContaining({ p_filtro: 'meu_clube' }))
  })
})
