import { describe, it, expect } from 'vitest'
import { validarImagem, validarMidia } from './upload.js'

// Monta um File com bytes de cabeçalho controlados (o detector lê os 1ºs bytes).
function arquivoComBytes(bytes, { nome = 'x', tipo = '', tamanho } = {}) {
  const cab = new Uint8Array(bytes)
  const total = tamanho ?? cab.length
  const corpo = new Uint8Array(Math.max(total, cab.length))
  corpo.set(cab, 0)
  return new File([corpo], nome, { type: tipo })
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0] // GIF89a
// "ftyp....mp4 " -> vídeo ISO-BMFF
const MP4 = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]
// "<svg " (0x3c 0x73 0x76 0x67) — deve ser REJEITADO (pode conter script)
const SVG = [0x3c, 0x73, 0x76, 0x67, 0x20, 0, 0, 0, 0, 0, 0, 0]
// "<!DOCTYPE" — HTML, rejeitado
const HTML = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0, 0, 0]

describe('validarImagem — detecção por bytes (não confia no file.type)', () => {
  it('aceita JPEG mesmo sem type declarado', async () => {
    await expect(validarImagem(arquivoComBytes(JPEG))).resolves.toMatchObject({ midia: 'imagem' })
  })
  it('aceita PNG', async () => {
    await expect(validarImagem(arquivoComBytes(PNG))).resolves.toMatchObject({ midia: 'imagem' })
  })
  it('REJEITA SVG mesmo mentindo o type como image/png', async () => {
    await expect(validarImagem(arquivoComBytes(SVG, { tipo: 'image/png', nome: 'a.png' }))).rejects.toThrow()
  })
  it('REJEITA HTML disfarçado de imagem', async () => {
    await expect(validarImagem(arquivoComBytes(HTML, { tipo: 'image/jpeg' }))).rejects.toThrow()
  })
  it('REJEITA vídeo em campo que só aceita foto', async () => {
    await expect(validarImagem(arquivoComBytes(MP4))).rejects.toThrow()
  })
  it('REJEITA arquivo grande demais', async () => {
    await expect(validarImagem(arquivoComBytes(JPEG, { tamanho: 20 * 1024 * 1024 }))).rejects.toThrow()
  })
})

describe('validarMidia — foto OU vídeo', () => {
  it('aceita vídeo MP4', async () => {
    await expect(validarMidia(arquivoComBytes(MP4))).resolves.toMatchObject({ midia: 'video' })
  })
  it('aceita imagem GIF', async () => {
    await expect(validarMidia(arquivoComBytes(GIF))).resolves.toMatchObject({ midia: 'imagem' })
  })
  it('ainda REJEITA SVG', async () => {
    await expect(validarMidia(arquivoComBytes(SVG))).rejects.toThrow()
  })
})
