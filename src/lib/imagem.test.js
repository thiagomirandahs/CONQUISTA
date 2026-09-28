// A foto da Comunidade é SEMPRE redesenhada em canvas (o que descarta EXIF/GPS) — nunca o original.
// comprimirImagem, ao contrário, devolve o original em vários casos (por isso não serve para a Comunidade).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { comprimirImagem, limparFotoParaComunidade } from './imagem.js'

const fotoComExif = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x45, 0x78, 0x69, 0x66])], 'IMG_0001.jpg', { type: 'image/jpeg' })

function simularCanvas({ blobMaior = false } = {}) {
  const drawImage = vi.fn()
  const toBlob = vi.fn((cb, tipo) => cb(new Blob([new Uint8Array(blobMaior ? 100 : 4)], { type: tipo })))
  const criar = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob }
    : criar(tag)))
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }))
  return { drawImage, toBlob }
}

afterEach(() => { vi.restoreAllMocks(); delete globalThis.createImageBitmap })

describe('limparFotoParaComunidade', () => {
  it('sempre devolve um JPEG NOVO redesenhado (não o arquivo original com EXIF)', async () => {
    const { drawImage } = simularCanvas({ blobMaior: true })
    const original = fotoComExif()
    const limpa = await limparFotoParaComunidade(original)
    expect(limpa).not.toBe(original)
    expect(limpa.type).toBe('image/jpeg')
    expect(limpa.name).toBe('foto.jpg')          // nem o nome original do aparelho vai junto
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1080, 810)
  })

  it('falha em vez de mandar o original quando não consegue redesenhar', async () => {
    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('formato') })
    await expect(limparFotoParaComunidade(fotoComExif())).rejects.toThrow(/Não consegui preparar/)
  })

  it('recusa o que não é imagem', async () => {
    await expect(limparFotoParaComunidade(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow()
  })
})

describe('comprimirImagem (por que não serve para a Comunidade)', () => {
  it('devolve o ORIGINAL (com EXIF) quando a versão nova não fica menor', async () => {
    simularCanvas({ blobMaior: true })
    const original = fotoComExif()
    expect(await comprimirImagem(original)).toBe(original)
  })
})
