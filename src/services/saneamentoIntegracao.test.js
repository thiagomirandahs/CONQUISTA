// Pontos de envio ligados ao saneamento do servidor (migration 529): DEPOIS do upload, melhor-esforço, nunca bloqueiam.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upload = vi.fn(async () => ({ error: null }))
const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    storage: { from: () => ({ upload: (...a) => upload(...a), remove: async () => ({}) }) },
  },
}))

const { publicarNaRede, publicarStory } = await import('./rede.js')
const { enviarAnexo } = await import('./suporte.js')
const foto = { arquivo: new File(['x'], 'a.webp', { type: 'image/webp' }) }
const chamadasDeSaneamento = () => rpc.mock.calls.filter((c) => c[0] === 'imagem_saneamento_enfileirar')

beforeEach(() => { upload.mockClear(); rpc.mockClear(); rpc.mockImplementation(async () => ({ data: { ok: true }, error: null })) })

describe('Rede: foto de post e de story pedem saneamento do arquivo que subiu', () => {
  it('post com foto: enfileira <clube>/<eu>/<id>.webp no bucket comunidade', async () => {
    await publicarNaRede({ tipo: 'foto', foto, clubeId: 'c1', userId: 'u1' })
    const [c] = chamadasDeSaneamento()
    expect(c[1].p_bucket).toBe('comunidade')
    expect(c[1].p_caminho).toBe(upload.mock.calls[0][0])
    expect(c[1].p_caminho).toMatch(/^c1\/u1\/.+\.webp$/)
  })
  it('story com foto também', async () => {
    await publicarStory({ foto, clubeId: 'c1', userId: 'u1' })
    expect(chamadasDeSaneamento()).toHaveLength(1)
  })
  it('post só de texto não enfileira nada', async () => {
    await publicarNaRede({ tipo: 'livre', legenda: 'oi', foto: null, clubeId: 'c1', userId: 'u1' })
    expect(chamadasDeSaneamento()).toHaveLength(0)
  })
  it('upload que FALHA não enfileira (não há arquivo)', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'x' } })
    await expect(publicarNaRede({ tipo: 'foto', foto, clubeId: 'c1', userId: 'u1' })).rejects.toThrow()
    expect(chamadasDeSaneamento()).toHaveLength(0)
  })
  it('NUNCA bloqueia: se o enfileiramento falha, a publicação segue e devolve o resultado normal', async () => {
    rpc.mockImplementation(async (nome) => {
      if (nome === 'imagem_saneamento_enfileirar') throw new Error('migration 529 ainda não aplicada')
      return { data: { ok: true, id: 'p1' }, error: null }
    })
    const r = await publicarNaRede({ tipo: 'foto', foto, clubeId: 'c1', userId: 'u1' })
    expect(r).toEqual({ ok: true, id: 'p1' })
  })
})

describe('Suporte: anexo', () => {
  // o anexo agora é REDESENHADO antes de subir (nunca o original com EXIF/GPS): jsdom não tem canvas, então simulamos um
  beforeEach(() => {
    const criar = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas'
      ? { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (cb, tipo) => cb(new Blob([new Uint8Array(8)], { type: tipo })) }
      : criar(tag)))
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() }))
  })
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.createImageBitmap })
  it('enfileira <uid>/<uuid>.<ext> no bucket suporte-anexos e devolve o caminho', async () => {
    const caminho = await enviarAnexo(new File([new Uint8Array(20)], 'p.png', { type: 'image/png' }))
    const [c] = chamadasDeSaneamento()
    expect(c[1]).toEqual({ p_bucket: 'suporte-anexos', p_caminho: caminho })
    expect(caminho).toMatch(/^u1\/.+\.png$/)
  })
})
