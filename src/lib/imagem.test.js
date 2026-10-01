// A foto da Comunidade é SEMPRE redesenhada em canvas (o que descarta EXIF/GPS) — nunca o original.
// comprimirImagem, ao contrário, devolve o original em vários casos (por isso não serve para a Comunidade).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { comprimirImagem, limparFotoParaComunidade, otimizarFoto, tamanhoLegivel, FOTO_AVATAR } from './imagem.js'

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
  it('sempre devolve um arquivo NOVO redesenhado (não o original com EXIF), em WebP quando o navegador exporta', async () => {
    const { drawImage } = simularCanvas({ blobMaior: true })
    const original = fotoComExif()
    const limpa = await limparFotoParaComunidade(original)
    expect(limpa).not.toBe(original)
    expect(limpa.type).toBe('image/webp')
    expect(limpa.name).toBe('foto.webp')         // nem o nome original do aparelho vai junto
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

// Canvas falso em que o tamanho do arquivo depende do lado e da qualidade (como na vida real).
function canvasRealista({ webp = true, bytesPorPixel = 0.5 } = {}) {
  const chamadas = []
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }) }
  canvas.toBlob = vi.fn((cb, tipo, q) => {
    const tipoFinal = tipo === 'image/webp' && !webp ? 'image/png' : tipo
    const tam = Math.round(canvas.width * canvas.height * bytesPorPixel * q)
    chamadas.push({ tipo: tipoFinal, q, lado: Math.max(canvas.width, canvas.height), tam })
    cb({ size: tam, type: tipoFinal })
  })
  const criar = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : criar(tag)))
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }))
  globalThis.File = class { constructor(partes, nome, { type }) { this.name = nome; this.type = type; this.size = partes[0].size } }
  return chamadas
}

describe('otimizarFoto (armazenamento mínimo da rede)', () => {
  const FileReal = globalThis.File
  afterEach(() => { globalThis.File = FileReal })
  const foto = () => ({ type: 'image/jpeg', size: 3_500_000, name: 'IMG.jpg' })

  it('lado maior nunca passa de 1080 px', async () => {
    const chamadas = canvasRealista({ bytesPorPixel: 0.05 })
    const r = await otimizarFoto(foto())
    expect(Math.max(r.largura, r.altura)).toBe(1080)
    expect(chamadas[0]).toMatchObject({ tipo: 'image/webp', q: 0.7, lado: 1080 })
  })

  it('baixa qualidade e depois o tamanho até chegar em ≤ 150 KB', async () => {
    const chamadas = canvasRealista({ bytesPorPixel: 0.4 })
    const r = await otimizarFoto(foto())
    expect(r.depois).toBeLessThanOrEqual(150 * 1024)
    expect(chamadas.some((c) => c.q === 0.5)).toBe(true)                 // chegou na qualidade mínima
    expect(Math.min(...chamadas.map((c) => c.lado))).toBeGreaterThanOrEqual(720)
    expect(r.antes).toBe(3_500_000)
  })

  it('nunca desce abaixo de 720 px nem de qualidade 0,5 (para mesmo acima do alvo)', async () => {
    const chamadas = canvasRealista({ bytesPorPixel: 5 })
    const r = await otimizarFoto(foto())
    expect(Math.max(r.largura, r.altura)).toBe(720)
    expect(Math.min(...chamadas.map((c) => c.q))).toBe(0.5)
    await expect(limparFotoParaComunidade(foto())).rejects.toThrow(/grande demais/)
  })

  it('sem WebP no navegador: cai para JPEG', async () => {
    canvasRealista({ webp: false, bytesPorPixel: 0.05 })
    const r = await otimizarFoto(foto())
    expect(r.tipo).toBe('image/jpeg')
    expect(r.arquivo.name).toBe('foto.jpg')
  })

  it('avatar: 256 px e ≤ 30 KB', async () => {
    canvasRealista({ bytesPorPixel: 0.6 })
    const r = await otimizarFoto(foto(), FOTO_AVATAR)
    expect(Math.max(r.largura, r.altura)).toBeLessThanOrEqual(256)
    expect(r.depois).toBeLessThanOrEqual(30 * 1024)
  })

  it('tamanho legível para o aviso', () => {
    expect(tamanhoLegivel(3_565_158)).toBe('3,4 MB')
    expect(tamanhoLegivel(112_640)).toBe('110 KB')
  })
})

describe('comprimirImagem (por que não serve para a Comunidade)', () => {
  it('devolve o ORIGINAL (com EXIF) quando a versão nova não fica menor', async () => {
    simularCanvas({ blobMaior: true })
    const original = fotoComExif()
    expect(await comprimirImagem(original)).toBe(original)
  })
})

// Fase 9 — comprimirImagem com `semMetadados`: nunca devolve o original (que carrega EXIF/GPS).
describe('comprimirImagem — modo semMetadados (comprovação, documento, mural, imagens públicas)', () => {
  it('padrão (sem a opção) mantém o comportamento antigo: devolve o ORIGINAL quando o resultado não fica menor', async () => {
    simularCanvas({ blobMaior: true })
    const original = fotoComExif()
    expect(await comprimirImagem(original)).toBe(original)
  })

  it('com semMetadados devolve SEMPRE um arquivo novo, mesmo quando não fica menor, sem o nome do aparelho', async () => {
    simularCanvas({ blobMaior: true })
    const original = fotoComExif()
    const limpa = await comprimirImagem(original, { semMetadados: true })
    expect(limpa).not.toBe(original)
    expect(limpa.type).toBe('image/jpeg')
    expect(limpa.name).toBe('foto.jpg')
  })

  it('com semMetadados FALHA em vez de mandar o original quando não consegue redesenhar', async () => {
    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('formato') })
    await expect(comprimirImagem(fotoComExif(), { semMetadados: true })).rejects.toThrow(/Não consegui preparar/)
  })

  it('GIF (sem EXIF/GPS) e o que não é imagem seguem passando direto', async () => {
    const gif = new File([new Uint8Array(20)], 'a.gif', { type: 'image/gif' })
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(await comprimirImagem(gif, { semMetadados: true })).toBe(gif)
    expect(await comprimirImagem(txt, { semMetadados: true })).toBe(txt)
  })
})
