// Validação de imagem de ENTRADA: tipo REAL por assinatura (magic bytes), nunca por file.type/extensão.
// Aceita só JPEG, PNG e WebP. SVG, GIF, HEIC, HTML, PDF etc. e arquivos disfarçados são recusados.
export const LIMITE_ENTRADA_BYTES = 15 * 1024 * 1024
export const LIMITE_LADO_PX = 12000
export const LIMITE_PIXELS = 100_000_000
const LEITURA_CABECALHO = 1024 * 1024 // procura o tamanho no início do arquivo (EXIF grande fica antes do SOF)

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const extensaoDoMime = (mime) => EXT[mime] || null

const ascii = (b, i, n) => { let s = ''; for (let k = i; k < i + n && k < b.length; k++) s += String.fromCharCode(b[k]); return s }
const u16be = (b, i) => (b[i] << 8) | b[i + 1]
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

export function detectarMime(b) {
  if (!b || b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp'
  return null
}

function dimensoesJpeg(b) {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m === 0xff) { i++; continue }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    if (m === 0xd9 || m === 0xda) return null
    const len = u16be(b, i + 2)
    if (len < 2) return null
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { altura: u16be(b, i + 5), largura: u16be(b, i + 7) }
    }
    i += 2 + len
  }
  return null
}

function dimensoesPng(b) {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null
  return { largura: u32be(b, 16), altura: u32be(b, 20) }
}

function dimensoesWebp(b) {
  const tipo = ascii(b, 12, 4)
  if (tipo === 'VP8X' && b.length >= 30) return { largura: u24le(b, 24) + 1, altura: u24le(b, 27) + 1 }
  if (tipo === 'VP8 ' && b.length >= 30) return { largura: (b[26] | (b[27] << 8)) & 0x3fff, altura: (b[28] | (b[29] << 8)) & 0x3fff }
  if (tipo === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
    return { largura: (v & 0x3fff) + 1, altura: ((v >>> 14) & 0x3fff) + 1 }
  }
  return null
}

export function lerDimensoes(b, mime) {
  if (mime === 'image/jpeg') return dimensoesJpeg(b)
  if (mime === 'image/png') return dimensoesPng(b)
  if (mime === 'image/webp') return dimensoesWebp(b)
  return null
}

const lerBytes = async (file, n) => new Uint8Array(await file.slice(0, n).arrayBuffer())

// Devolve { mime, ext, largura, altura, bytes }; lança Error em pt-BR.
export async function validarImagem(file, { maxBytes = LIMITE_ENTRADA_BYTES, maxLado = LIMITE_LADO_PX, maxPixels = LIMITE_PIXELS } = {}) {
  if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') throw new Error('Escolha uma foto primeiro. 🙂')
  if (file.size <= 0) throw new Error('Esse arquivo está vazio. Escolha outra foto. 🙂')
  if (file.size > maxBytes) {
    throw new Error(`Essa foto é muito pesada (máx. ${Math.round(maxBytes / (1024 * 1024))} MB). Tire de novo em qualidade normal. 🙂`)
  }
  const bytes = await lerBytes(file, LEITURA_CABECALHO)
  const mime = detectarMime(bytes)
  if (!mime) throw new Error('Esse arquivo não é uma foto válida. Use JPG, PNG ou WebP.')
  const dim = lerDimensoes(bytes, mime)
  if (!dim || !(dim.largura > 0) || !(dim.altura > 0)) throw new Error('Não consegui ler essa foto. Ela pode estar corrompida. Tente outra. 🙂')
  if (dim.largura > maxLado || dim.altura > maxLado || dim.largura * dim.altura > maxPixels) {
    throw new Error('Essa foto tem dimensões grandes demais. Tire de novo em qualidade normal. 🙂')
  }
  return { mime, ext: EXT[mime], largura: dim.largura, altura: dim.altura, bytes: file.size }
}
