// @vitest-environment node
// Saneador de imagens do SERVIDOR (supabase/functions/_compartilhado/sanear-imagem.ts) — núcleo puro.
// As imagens de teste são MONTADAS aqui, byte a byte (nada de arquivo de foto no repositório): um JPEG real de 16x16
// (648 bytes, sem metadados) e um VP8L real de 4x4 servem de "miolo"; em volta entram EXIF + GPS + miniatura, XMP, IPTC,
// comentários, texto de PNG etc. A prova é sobre a SAÍDA: os segredos sumiram, o miolo da imagem ficou idêntico,
// a estrutura continua válida, o tamanho nunca cresce e entrada ruim nunca explode.
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { sanearImagem, detectarFormato, tiffMinimo, orientacaoDeTiff, crc32 } from '../../supabase/functions/_compartilhado/sanear-imagem.ts'

// ---------------------------------------------------------------- miolos reais
const JPEG_BASE = new Uint8Array(Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFhtPatCG09qvw2ntV+G09qqpiAwWL2P/Z',
  'base64'))
const VP8L = new Uint8Array(Buffer.from('LwPAAAB/oJBtBIjjZHaPP9ZBKGjbhk2ZRsl0ZwDnvw3KYAArYAB7HgAQBECsWbBgwaQFCxaMRPQ/EFbzAQ==', 'base64'))

const enc = (s) => new TextEncoder().encode(s)
const cat = (...p) => { const n = p.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); let k = 0; for (const x of p) { o.set(x, k); k += x.length } return o }
const tem = (hay, agulha) => Buffer.from(hay).indexOf(typeof agulha === 'string' ? Buffer.from(agulha) : Buffer.from(agulha)) >= 0
const u16be = (v) => new Uint8Array([(v >> 8) & 255, v & 255])
const u32be = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
const u32le = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255])

const SEGREDO = 'SEGREDO-CAM'
const MINIATURA = 'MINIATURA-SECRETA'

// TIFF little-endian "de celular": Make + Orientation + ponteiro de GPS (latitude) + IFD1 com miniatura.
function tiffComGps(orientacao = 6) {
  const b = new Uint8Array(163)
  const dv = new DataView(b.buffer)
  const le = true
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, le); dv.setUint32(4, 8, le)
  // IFD0 @8: 3 entradas
  dv.setUint16(8, 3, le)
  const ent = (p, tag, tipo, cont, val) => { dv.setUint16(p, tag, le); dv.setUint16(p + 2, tipo, le); dv.setUint32(p + 4, cont, le); if (tipo === 3) dv.setUint16(p + 8, val, le); else dv.setUint32(p + 8, val, le) }
  ent(10, 0x010f, 2, 12, 50)          // Make -> @50
  ent(22, 0x0112, 3, 1, orientacao)   // Orientation
  ent(34, 0x8825, 4, 1, 62)           // GPSInfo -> @62
  dv.setUint32(46, 116, le)           // próximo IFD (miniatura)
  b.set(enc(SEGREDO + '\0'), 50)
  // GPS IFD @62: 2 entradas
  dv.setUint16(62, 2, le)
  dv.setUint16(64, 1, le); dv.setUint16(66, 2, le); dv.setUint32(68, 2, le); b[72] = 0x53; b[73] = 0 // LatRef 'S'
  dv.setUint16(76, 2, le); dv.setUint16(78, 5, le); dv.setUint32(80, 3, le); dv.setUint32(84, 92, le) // Latitude -> @92
  dv.setUint32(88, 0, le)
  const rac = [[23, 1], [32, 1], [7, 1]]
  rac.forEach(([n, d], i) => { dv.setUint32(92 + i * 8, n, le); dv.setUint32(96 + i * 8, d, le) })
  // IFD1 @116: 2 entradas
  dv.setUint16(116, 2, le)
  ent(118, 0x0201, 4, 1, 146); ent(130, 0x0202, 4, 1, MINIATURA.length)
  dv.setUint32(142, 0, le)
  b.set(enc(MINIATURA), 146)
  return b
}

const seg = (m, carga) => cat(new Uint8Array([0xff, m]), u16be(carga.length + 2), carga)

// JPEG: SOI + APP0 (JFIF) + [extras] + resto do miolo (DQT em diante).
const FIM_APP0 = 2 + 2 + 16
function jpegCom(extras, { depois = new Uint8Array(0) } = {}) {
  return cat(JPEG_BASE.subarray(0, FIM_APP0), ...extras, JPEG_BASE.subarray(FIM_APP0), depois)
}
const exifSeg = (o) => seg(0xe1, cat(enc('Exif\0\0'), tiffComGps(o)))
const xmpSeg = () => seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>SEGREDO-XMP</x:xmpmeta>'))
const iptcSeg = () => seg(0xed, enc('Photoshop 3.0\u0000' + '8BIM SEGREDO-IPTC'))
const comSeg = () => seg(0xfe, enc('SEGREDO-COMENTARIO'))
const MIOLO_JPEG = JPEG_BASE.subarray(FIM_APP0) // DQT..EOI

// ---------------------------------------------------------------- PNG
function chunk(tipo, dados) {
  const t = enc(tipo)
  return cat(u32be(dados.length), t, dados, u32be(zlib.crc32(cat(t, dados)) >>> 0))
}
const IHDR = chunk('IHDR', cat(u32be(4), u32be(4), new Uint8Array([8, 2, 0, 0, 0])))
const IDAT = chunk('IDAT', new Uint8Array(zlib.deflateSync(Buffer.alloc(4 * (1 + 12), 7))))
const IEND = chunk('IEND', new Uint8Array(0))
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function pngSujo(orientacao = 6) {
  return cat(PNG_SIG, IHDR,
    chunk('gAMA', u32be(45455)), chunk('pHYs', cat(u32be(2835), u32be(2835), new Uint8Array([1]))),
    chunk('tEXt', enc('Author\0' + SEGREDO)), chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x>SEGREDO-XMP</x>')),
    chunk('zTXt', cat(enc('Comment\0\0'), new Uint8Array(zlib.deflateSync(Buffer.from('SEGREDO-ZTXT'))))),
    chunk('tIME', new Uint8Array([7, 234, 9, 30, 12, 0, 0])),
    chunk('eXIf', tiffComGps(orientacao)), chunk('prVT', enc('privado-SEGREDO')),
    IDAT, IEND, enc('TRAILING-SEGREDO'))
}
function chunksPng(b) {
  const out = []
  let p = 8
  while (p + 12 <= b.length) {
    const len = new DataView(b.buffer, b.byteOffset).getUint32(p)
    const tipo = Buffer.from(b.subarray(p + 4, p + 8)).toString('latin1')
    const dados = b.subarray(p + 8, p + 8 + len)
    const crc = new DataView(b.buffer, b.byteOffset).getUint32(p + 8 + len)
    out.push({ tipo, dados, crcOk: crc === (zlib.crc32(b.subarray(p + 4, p + 8 + len)) >>> 0) })
    p += 12 + len
    if (tipo === 'IEND') break
  }
  return { chunks: out, fim: p }
}

// ---------------------------------------------------------------- WebP
function rc(id, dados) { return cat(enc(id), u32le(dados.length), dados, dados.length & 1 ? new Uint8Array(1) : new Uint8Array(0)) }
function riff(...chunks) { const c = cat(...chunks); return cat(enc('RIFF'), u32le(4 + c.length), enc('WEBP'), c) }
const VP8X = (flags) => rc('VP8X', new Uint8Array([flags, 0, 0, 0, 3, 0, 0, 3, 0, 0]))
function webpSujo(orientacao = 6) {
  return riff(VP8X(0x08 | 0x04 | 0x10), rc('VP8L', VP8L), rc('EXIF', cat(enc('Exif\0\0'), tiffComGps(orientacao))),
    rc('XMP ', enc('<x:xmpmeta>SEGREDO-XMP</x:xmpmeta>')), rc('JUNK', enc('SEGREDO-JUNK')))
}
function chunksWebp(b) {
  const dv = new DataView(b.buffer, b.byteOffset)
  const out = []
  let p = 12
  while (p + 8 <= b.length) {
    const id = Buffer.from(b.subarray(p, p + 4)).toString('latin1')
    const sz = dv.getUint32(p + 4, true)
    out.push({ id, dados: b.subarray(p + 8, p + 8 + sz) })
    p += 8 + sz + (sz & 1)
  }
  return { chunks: out, fim: p, riffTamanho: dv.getUint32(4, true) }
}

// ---------------------------------------------------------------- caminhadas de estrutura
function segmentosJpeg(b) {
  const segs = []
  let p = 2
  while (p < b.length) {
    expect(b[p]).toBe(0xff)
    const m = b[p + 1]
    if (m === 0xd9) { segs.push({ m, ini: p, fim: p + 2 }); p += 2; break }
    const len = (b[p + 2] << 8) | b[p + 3]
    segs.push({ m, ini: p, fim: p + 2 + len, carga: b.subarray(p + 4, p + 2 + len) })
    p += 2 + len
    if (m === 0xda) { while (!(b[p] === 0xff && b[p + 1] !== 0 && b[p + 1] !== 0xff && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7))) p++ }
  }
  return { segs, fim: p }
}

// ================================================================ testes
describe('detectarFormato', () => {
  it('reconhece os três formatos e nada mais', () => {
    expect(detectarFormato(JPEG_BASE)).toBe('jpeg')
    expect(detectarFormato(cat(PNG_SIG, IHDR, IDAT, IEND))).toBe('png')
    expect(detectarFormato(riff(rc('VP8L', VP8L)))).toBe('webp')
    expect(detectarFormato(enc('hello world'))).toBe('desconhecido')
  })
})

describe('JPEG', () => {
  it('o miolo de teste é um JPEG sem metadados e já sai "limpa" (sem regravar)', () => {
    const r = sanearImagem(JPEG_BASE)
    expect(r.estado).toBe('limpa')
    expect(r.bytes).toBe(JPEG_BASE)
  })

  it('remove EXIF com GPS, miniatura, XMP, IPTC, comentário e lixo depois do EOI', () => {
    const entrada = jpegCom([exifSeg(1), xmpSeg(), iptcSeg(), comSeg()], { depois: enc('TRAILING-SEGREDO') })
    for (const s of [SEGREDO, MINIATURA, 'SEGREDO-XMP', 'SEGREDO-IPTC', 'SEGREDO-COMENTARIO', 'TRAILING-SEGREDO', 'Exif', 'xap']) expect(tem(entrada, s)).toBe(true)
    const r = sanearImagem(entrada)
    expect(r.estado).toBe('saneada')
    expect(r.formato).toBe('jpeg')
    for (const s of [SEGREDO, MINIATURA, 'SEGREDO', 'Exif', 'xap', 'Photoshop', 'TRAILING']) expect(tem(r.bytes, s)).toBe(false)
    expect(r.removidos).toEqual(expect.arrayContaining(['exif', 'xmp', 'iptc_photoshop', 'comentario']))
    // sem Orientation (valor 1) não sobra nenhum APP1
    const { segs, fim } = segmentosJpeg(r.bytes)
    expect(segs.some((s) => s.m === 0xe1)).toBe(false)
    expect(fim).toBe(r.bytes.length) // termina no EOI
    // o miolo (DQT..EOI) é BYTE A BYTE o original: nenhum pixel foi tocado
    expect(Buffer.from(r.bytes.subarray(r.bytes.length - MIOLO_JPEG.length)).equals(Buffer.from(MIOLO_JPEG))).toBe(true)
    expect(r.bytes.length).toBeLessThan(entrada.length)
  })

  it('mantém SOF, DQT, DHT e SOS (estrutura decodificável) e o JFIF sem miniatura', () => {
    const jfifComMiniatura = cat(new Uint8Array([0xff, 0xe0]), u16be(2 + 14 + 6), enc('JFIF\0'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 2, 1]), enc('THUMBX')) // thumb 2x1 = 6 bytes
    const entrada = cat(JPEG_BASE.subarray(0, 2), jfifComMiniatura, exifSeg(1), JPEG_BASE.subarray(FIM_APP0))
    expect(tem(entrada, 'THUMBX')).toBe(true)
    const r = sanearImagem(entrada)
    expect(r.estado).toBe('saneada')
    expect(tem(r.bytes, 'THUMBX')).toBe(false)
    const { segs } = segmentosJpeg(r.bytes)
    const marcadores = segs.map((s) => s.m)
    expect(marcadores[0]).toBe(0xe0)
    for (const m of [0xdb, 0xc0, 0xc4, 0xda, 0xd9]) expect(marcadores).toContain(m)
    const jfif = segs[0]
    expect(jfif.fim - jfif.ini).toBe(18)
    expect([jfif.carga[12], jfif.carga[13]]).toEqual([0, 0]) // miniatura 0x0
  })

  it('PRESERVA a orientação num EXIF mínimo (só Orientation: sem GPS, sem fabricante, sem miniatura)', () => {
    for (const o of [2, 3, 6, 8]) {
      const r = sanearImagem(jpegCom([exifSeg(o)]))
      expect(r.estado).toBe('saneada')
      expect(r.orientacao).toBe(o)
      const { segs } = segmentosJpeg(r.bytes)
      const exifs = segs.filter((s) => s.m === 0xe1)
      expect(exifs).toHaveLength(1)
      const tiff = exifs[0].carga.subarray(6)
      expect(Buffer.from(exifs[0].carga.subarray(0, 6)).toString('latin1')).toBe('Exif\0\0')
      expect(orientacaoDeTiff(tiff)).toBe(o)
      expect(new DataView(tiff.buffer, tiff.byteOffset).getUint16(8)).toBe(1) // uma única entrada no IFD0
      expect(tem(r.bytes, SEGREDO) || tem(r.bytes, MINIATURA)).toBe(false)
      // tag de GPS (0x8825) inexistente
      expect(Buffer.from(tiff).includes(Buffer.from([0x88, 0x25])) || Buffer.from(tiff).includes(Buffer.from([0x25, 0x88]))).toBe(false)
    }
  })

  it('mantém o perfil ICC (cor correta) e descarta APP2 desconhecido (MPF)', () => {
    const icc = seg(0xe2, cat(enc('ICC_PROFILE\0'), new Uint8Array([1, 1, 9, 9, 9, 9])))
    const mpf = seg(0xe2, cat(enc('MPF\0'), enc('SEGREDO-MPF')))
    const r = sanearImagem(jpegCom([icc, mpf, exifSeg(1)]))
    expect(r.estado).toBe('saneada')
    expect(tem(r.bytes, 'ICC_PROFILE')).toBe(true)
    expect(tem(r.bytes, 'SEGREDO-MPF')).toBe(false)
  })

  it('é idempotente: sanear a saída devolve "limpa" (nenhuma regravação à toa) e a mesma imagem', () => {
    const r1 = sanearImagem(jpegCom([exifSeg(6), xmpSeg(), comSeg()], { depois: enc('XX') }))
    const r2 = sanearImagem(r1.bytes)
    expect(r2.estado).toBe('limpa')
    expect(r2.bytes).toBe(r1.bytes)
    expect(r2.orientacao).toBe(6)
  })

  it('nunca cresce, mesmo com um EXIF de Orientation menor que o mínimo', () => {
    // IFD0 com 1 entrada e SEM ponteiro de próximo IFD: 22 bytes (menor que os 26 do EXIF mínimo)
    const t = new Uint8Array(22)
    t.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0])
    const entrada = jpegCom([seg(0xe1, cat(enc('Exif\0\0'), t))])
    const r = sanearImagem(entrada)
    expect(r.bytes.length).toBeLessThanOrEqual(entrada.length)
    expect(r.estado).toBe('limpa')
  })

  it('truncada, sem EOI, sem SOS ou com marcador inválido: "invalida" e nunca explode', () => {
    const inteira = jpegCom([exifSeg(6), xmpSeg()])
    const fimEoi = segmentosJpeg(inteira).fim
    for (let n = 0; n < fimEoi; n++) {
      const r = sanearImagem(inteira.subarray(0, n))
      expect(['invalida', 'ignorado']).toContain(r.estado)
    }
    expect(sanearImagem(cat(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).estado).toBe('invalida') // sem SOF/SOS
    expect(sanearImagem(cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01]))).estado).toBe('invalida') // comprimento < 2
    expect(sanearImagem(cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]))).estado).toBe('invalida') // passa do fim
  })

  it('dados entropy-coded com FF00 (stuffing) e RSTn são copiados inteiros', () => {
    // SOS sintético com stuffing, RST0 e preenchimento FF FF antes do EOI: nada pode ser cortado nem reinterpretado
    const scan = new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff])
    const base = cat(JPEG_BASE.subarray(0, JPEG_BASE.length - 2), scan, new Uint8Array([0xff, 0xd9]))
    const entrada = cat(base.subarray(0, FIM_APP0), exifSeg(1), base.subarray(FIM_APP0))
    const r = sanearImagem(entrada)
    expect(r.estado).toBe('saneada')
    expect(Buffer.from(r.bytes.subarray(r.bytes.length - scan.length - 2, r.bytes.length - 2)).equals(Buffer.from(scan))).toBe(true)
    expect(segmentosJpeg(r.bytes).fim).toBe(r.bytes.length)
  })
})

describe('PNG', () => {
  it('remove tEXt/iTXt/zTXt/tIME/eXIf/chunk privado e o lixo depois do IEND; fica só o que renderiza', () => {
    const entrada = pngSujo(1)
    for (const s of [SEGREDO, 'SEGREDO-XMP', MINIATURA, 'privado-SEGREDO', 'TRAILING-SEGREDO']) expect(tem(entrada, s)).toBe(true)
    const r = sanearImagem(entrada)
    expect(r.estado).toBe('saneada')
    expect(r.formato).toBe('png')
    expect(tem(r.bytes, 'SEGREDO')).toBe(false)
    expect(tem(r.bytes, MINIATURA)).toBe(false)
    const { chunks, fim } = chunksPng(r.bytes)
    expect(chunks.map((c) => c.tipo)).toEqual(['IHDR', 'gAMA', 'pHYs', 'IDAT', 'IEND'])
    expect(chunks.every((c) => c.crcOk)).toBe(true)
    expect(fim).toBe(r.bytes.length)
    expect(r.bytes.length).toBeLessThan(entrada.length)
    // decodificável: o IDAT inflado tem 4 linhas de (1 filtro + 12 bytes)
    const idat = chunks.find((c) => c.tipo === 'IDAT').dados
    expect(zlib.inflateSync(Buffer.from(idat)).length).toBe(4 * 13)
    expect(r.removidos).toEqual(expect.arrayContaining(['texto', 'data', 'exif']))
  })

  it('preserva a orientação num eXIf mínimo com CRC válido, antes do primeiro IDAT', () => {
    const r = sanearImagem(pngSujo(8))
    expect(r.orientacao).toBe(8)
    const { chunks } = chunksPng(r.bytes)
    const tipos = chunks.map((c) => c.tipo)
    expect(tipos.indexOf('eXIf')).toBeGreaterThan(0)
    expect(tipos.indexOf('eXIf')).toBeLessThan(tipos.indexOf('IDAT'))
    expect(chunks.every((c) => c.crcOk)).toBe(true)
    const ex = chunks.find((c) => c.tipo === 'eXIf').dados
    expect(ex.length).toBe(26)
    expect(orientacaoDeTiff(ex)).toBe(8)
    expect(tem(r.bytes, SEGREDO)).toBe(false)
  })

  it('idempotente e sem regravar quando já está limpo', () => {
    const limpo = cat(PNG_SIG, IHDR, chunk('gAMA', u32be(45455)), IDAT, IEND)
    const r = sanearImagem(limpo)
    expect(r.estado).toBe('limpa')
    expect(r.bytes).toBe(limpo)
    const r2 = sanearImagem(sanearImagem(pngSujo(6)).bytes)
    expect(r2.estado).toBe('limpa')
  })

  it('truncado, sem IHDR ou sem IEND: "invalida"', () => {
    const inteiro = pngSujo(6)
    const { fim } = chunksPng(inteiro)
    for (let n = 9; n < fim; n += 7) expect(sanearImagem(inteiro.subarray(0, n)).estado).toBe('invalida')
    expect(sanearImagem(cat(PNG_SIG, IDAT, IEND)).estado).toBe('invalida') // IHDR ausente
    expect(sanearImagem(cat(PNG_SIG, IHDR, IDAT)).estado).toBe('invalida') // sem IEND
    expect(sanearImagem(cat(PNG_SIG, IHDR, IEND)).estado).toBe('invalida') // sem IDAT
  })
})

describe('WebP', () => {
  it('remove EXIF (GPS/miniatura), XMP e chunk desconhecido; ajusta VP8X e o tamanho RIFF', () => {
    const entrada = webpSujo(1)
    expect(tem(entrada, SEGREDO)).toBe(true)
    const r = sanearImagem(entrada)
    expect(r.estado).toBe('saneada')
    expect(r.formato).toBe('webp')
    expect(tem(r.bytes, 'SEGREDO')).toBe(false)
    expect(tem(r.bytes, MINIATURA)).toBe(false)
    const { chunks, fim, riffTamanho } = chunksWebp(r.bytes)
    expect(chunks.map((c) => c.id)).toEqual(['VP8X', 'VP8L'])
    expect(riffTamanho + 8).toBe(r.bytes.length)
    expect(fim).toBe(r.bytes.length)
    expect(chunks[0].dados[0] & 0x0c).toBe(0)       // sem flag de EXIF/XMP
    expect(chunks[0].dados[0] & 0x10).toBe(0x10)    // alfa preservado
    expect(Buffer.from(chunks[1].dados).equals(Buffer.from(VP8L))).toBe(true) // pixels intactos
    expect(r.bytes.length).toBeLessThan(entrada.length)
  })

  it('preserva a orientação num EXIF mínimo e religa a flag', () => {
    const r = sanearImagem(webpSujo(6))
    expect(r.orientacao).toBe(6)
    const { chunks, riffTamanho } = chunksWebp(r.bytes)
    expect(chunks.map((c) => c.id)).toEqual(['VP8X', 'VP8L', 'EXIF'])
    expect(chunks[0].dados[0] & 0x08).toBe(0x08)
    expect(chunks[0].dados[0] & 0x04).toBe(0)
    expect(orientacaoDeTiff(chunks[2].dados)).toBe(6)
    expect(riffTamanho + 8).toBe(r.bytes.length)
    expect(tem(r.bytes, SEGREDO)).toBe(false)
  })

  it('WebP simples (só VP8L) já é limpo; idempotência da saída', () => {
    const simples = riff(rc('VP8L', VP8L))
    const r = sanearImagem(simples)
    expect(r.estado).toBe('limpa')
    expect(sanearImagem(sanearImagem(webpSujo(6)).bytes).estado).toBe('limpa')
  })

  it('RIFF truncado, sem imagem ou com VP8X curto: "invalida"', () => {
    const inteiro = webpSujo(6)
    for (let n = 12; n < inteiro.length; n += 5) expect(sanearImagem(inteiro.subarray(0, n)).estado).toBe('invalida')
    expect(sanearImagem(riff(VP8X(0))).estado).toBe('invalida')
    expect(sanearImagem(riff(rc('VP8X', new Uint8Array(4)), rc('VP8L', VP8L))).estado).toBe('invalida')
  })
})

describe('formatos fora do escopo e limites', () => {
  it('HEIC/HEIF/AVIF é "ignorado" (nunca erro): o objeto fica como está', () => {
    const heic = cat(u32be(24), enc('ftypheic'), new Uint8Array(12))
    const r = sanearImagem(heic)
    expect(r.estado).toBe('ignorado')
    expect(r.motivo).toBe('heic_nao_suportado')
    expect(r.bytes).toBe(heic)
    expect(sanearImagem(cat(u32be(24), enc('ftypavif'), new Uint8Array(12))).motivo).toBe('heic_nao_suportado')
    expect(sanearImagem(cat(u32be(24), enc('ftypmp42'), new Uint8Array(12))).motivo).toBe('formato_desconhecido')
  })

  it('GIF, texto, vazio e lixo são "ignorado"', () => {
    expect(sanearImagem(enc('GIF89a-qualquer-coisa')).motivo).toBe('gif_nao_suportado')
    expect(sanearImagem(enc('%PDF-1.7')).estado).toBe('ignorado')
    expect(sanearImagem(new Uint8Array(0)).motivo).toBe('vazio')
    expect(sanearImagem(new Uint8Array([1, 2, 3])).estado).toBe('ignorado')
  })

  it('arquivo acima do limite é "ignorado" (motivo grande) sem ser lido', () => {
    const r = sanearImagem(jpegCom([exifSeg(6)]), { maxBytes: 100 })
    expect(r.estado).toBe('ignorado')
    expect(r.motivo).toBe('grande')
  })

  it('entrada que não é Uint8Array não lança', () => {
    expect(sanearImagem(null).estado).toBe('invalida')
    expect(sanearImagem('texto').estado).toBe('invalida')
  })
})

describe('robustez (fuzz determinístico)', () => {
  it('bytes corrompidos nunca lançam e a saída, quando existe, nunca é maior', () => {
    let semente = 12345
    const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente }
    const bases = [jpegCom([exifSeg(6), xmpSeg(), comSeg()], { depois: enc('ZZ') }), pngSujo(6), webpSujo(6)]
    let saneadas = 0
    for (const base of bases) {
      for (let i = 0; i < 400; i++) {
        const b = new Uint8Array(base)
        const trocas = 1 + (rnd() % 4)
        for (let k = 0; k < trocas; k++) b[rnd() % b.length] = rnd() & 255
        const corte = rnd() % 5 === 0 ? b.subarray(0, rnd() % b.length) : b
        const r = sanearImagem(corte)
        expect(['saneada', 'limpa', 'ignorado', 'invalida']).toContain(r.estado)
        expect(r.bytes.length).toBeLessThanOrEqual(corte.length)
        if (r.estado === 'saneada') saneadas++
        // o que o saneador entrega, ele próprio reconhece como já limpo
        if (r.estado === 'saneada') expect(['limpa', 'saneada']).toContain(sanearImagem(r.bytes).estado)
      }
    }
    expect(saneadas).toBeGreaterThan(50)
  })
})

describe('utilitários', () => {
  it('tiffMinimo/orientacaoDeTiff fazem ida e volta e ignoram orientação 1/ilegível', () => {
    for (let o = 2; o <= 8; o++) expect(orientacaoDeTiff(tiffMinimo(o))).toBe(o)
    expect(orientacaoDeTiff(tiffMinimo(1))).toBe(0)
    expect(orientacaoDeTiff(new Uint8Array(3))).toBe(0)
    expect(orientacaoDeTiff(enc('não é tiff nenhum, só texto comprido'))).toBe(0)
    expect(orientacaoDeTiff(tiffComGps(6))).toBe(6)
  })
  it('crc32 bate com o do Node', () => {
    const d = enc('IDAT-qualquer-coisa')
    expect(crc32(d)).toBe(zlib.crc32(Buffer.from(d)) >>> 0)
  })
})
