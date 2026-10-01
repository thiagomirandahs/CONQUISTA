// Fase 9 — subirComprovacao (e as outras subidas de foto) NUNCA mandam o arquivo original com EXIF/GPS ao Storage.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upload = vi.fn(async () => ({ error: null }))
vi.mock('./supabase.js', () => ({ supabase: { storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: 'x' } }) }) }, rpc: vi.fn(async () => ({ error: null })), auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } } }))
vi.mock('./saneamentoImagem.js', () => ({ solicitarSaneamento: vi.fn() }))

import { subirComprovacao, subirImagemPublica } from './upload.js'

const jpegComExif = () => {
  const b = new Uint8Array(32); b.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66], 0)
  return new File([b], 'IMG_20261001_GPS.jpg', { type: 'image/jpeg' })
}
function canvasQueNaoEncolhe() {
  const criar = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (cb, tipo) => cb(new Blob([new Uint8Array(500)], { type: tipo })) }
    : criar(tag)))
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() }))
}

beforeEach(() => { upload.mockClear(); vi.restoreAllMocks(); delete globalThis.createImageBitmap })

describe('uploads de foto sem EXIF/GPS', () => {
  it('subirComprovacao sobe o arquivo REDESENHADO (nunca o original), mesmo quando ele não ficou menor', async () => {
    canvasQueNaoEncolhe()
    const original = jpegComExif()
    await subirComprovacao({ file: original, tipo: 'requisitos', userId: 'u1' })
    const enviado = upload.mock.calls[0][1]
    expect(enviado).not.toBe(original)
    expect(enviado.name).toBe('foto.jpg')
  })

  it('subirComprovacao FALHA (e não sobe nada) quando não dá para redesenhar a foto', async () => {
    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('formato') })
    await expect(subirComprovacao({ file: jpegComExif(), tipo: 'requisitos', userId: 'u1' })).rejects.toThrow(/Não consegui preparar/)
    expect(upload).not.toHaveBeenCalled()
  })

  it('subirImagemPublica (avatar/mural/unidades) também nunca sobe o original', async () => {
    canvasQueNaoEncolhe()
    const original = jpegComExif()
    await subirImagemPublica({ file: original, pasta: 'perfis', nomeBase: 'u1' })
    expect(upload.mock.calls[0][1]).not.toBe(original)
  })
})

// Suporte: o anexo do chamado também é redesenhado (nunca o original com EXIF/GPS); PNG continua PNG.
describe('suporte — enviarAnexo', () => {
  it('sobe o arquivo REDESENHADO, não o original', async () => {
    vi.resetModules()
    canvasQueNaoEncolhe()
    const sup = await import('../services/suporte.js')
    const orig = jpegComExif()
    await sup.enviarAnexo(new File([orig], 'IMG_GPS.jpg', { type: 'image/jpeg' }))
    expect(upload.mock.calls.at(-1)[1]).not.toBe(orig)
  })
})
