// Saneador de imagens (núcleo PURO) — usado pela Edge Function `sanear-imagens` e testado pelo vitest.
//
// Compatível com Deno e Node: sem imports, sem APIs de plataforma; só Uint8Array/DataView.
//
// O que faz: remove os METADADOS de uma imagem SEM recodificar os pixels (os bytes da imagem passam intactos),
// então não há perda de qualidade e a evidência/documento continua fiel:
//   * JPEG: fica só o necessário para exibir (SOF/DQT/DHT/SOS..., JFIF sem miniatura, ICC, Adobe APP14). Saem EXIF
//           (inclui GPS e miniatura), XMP, IPTC/Photoshop, MPF, comentários e qualquer APPn desconhecido, e o lixo
//           depois do EOI. Se havia Orientation EXIF (2..8), ela é PRESERVADA num EXIF mínimo (só essa etiqueta):
//           a foto continua aparecendo na posição certa sem recodificar.
//   * PNG : ficam só os chunks de renderização (IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD, pHYs,
//           hIST, APNG, cICP, mDCV, cLLI). Saem tEXt/zTXt/iTXt/tIME/eXIf (Orientation preservada num eXIf mínimo),
//           chunks privados e o que vier depois do IEND.
//   * WebP: ficam VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP. Saem EXIF e XMP (Orientation preservada num EXIF mínimo) e
//           chunks desconhecidos; o cabeçalho VP8X e o tamanho RIFF são ajustados.
//
// Contrato do resultado:
//   estado 'saneada'  -> `bytes` é a imagem nova (NUNCA maior que a entrada); `removidos` diz o que saiu.
//   estado 'limpa'    -> não havia nada a remover; `bytes` é a própria entrada (não regravar: sem recompressão à toa).
//   estado 'ignorado' -> formato não suportado (HEIC/HEIF/AVIF, GIF, desconhecido) ou grande demais; `motivo` explica;
//                        nunca é erro: o objeto só fica como está.
//   estado 'invalida' -> formato conhecido porém truncado/corrompido; nada é devolvido para regravar.
// Nunca lança exceção por entrada ruim.

export type Formato = 'jpeg' | 'png' | 'webp' | 'desconhecido'
export type EstadoSaneamento = 'saneada' | 'limpa' | 'ignorado' | 'invalida'

export interface ResultadoSaneamento {
  estado: EstadoSaneamento
  formato: Formato
  bytes: Uint8Array
  removidos: string[]
  motivo: string | null
  /** Orientation EXIF preservada (2..8); 0 = nenhuma (ou 1, "normal"). */
  orientacao: number
}

export interface OpcoesSaneamento {
  /** Acima disso o objeto é 'ignorado' (motivo 'grande'). Padrão 12 MiB. */
  maxBytes?: number
}

export const MAX_BYTES_PADRAO = 12 * 1024 * 1024

// ------------------------------------------------------------------------------------------------ utilitários
class Invalida extends Error {}

function falhar(m: string): never {
  throw new Invalida(m)
}

function concat(partes: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of partes) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of partes) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function ascii(b: Uint8Array, ini: number, fim: number): string {
  let s = ''
  for (let i = ini; i < fim && i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

function comeca(b: Uint8Array, texto: string, desde = 0): boolean {
  if (desde + texto.length > b.length) return false
  for (let i = 0; i < texto.length; i++) if (b[desde + i] !== texto.charCodeAt(i)) return false
  return true
}

function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function u32be(b: Uint8Array, p: number): number {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
}

function u32le(b: Uint8Array, p: number): number {
  return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
}

function escreveU32be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
}

function escreveU32le(v: number): Uint8Array {
  return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255])
}

let tabelaCrc: Uint32Array | null = null
export function crc32(dados: Uint8Array): number {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      tabelaCrc[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < dados.length; i++) c = tabelaCrc[(c ^ dados[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ------------------------------------------------------------------------------------------------ EXIF mínimo (só Orientation)
/** Lê a Orientation (0x0112) de um bloco TIFF; devolve 2..8, ou 0 se ausente/normal/ilegível. Nunca lança. */
export function orientacaoDeTiff(t: Uint8Array): number {
  try {
    if (t.length < 22) return 0
    const le = t[0] === 0x49 && t[1] === 0x49
    const be = t[0] === 0x4d && t[1] === 0x4d
    if (!le && !be) return 0
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength)
    if (dv.getUint16(2, le) !== 42) return 0
    const off = dv.getUint32(4, le)
    if (off + 2 > t.length) return 0
    const n = Math.min(dv.getUint16(off, le), 512)
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12
      if (e + 12 > t.length) break
      if (dv.getUint16(e, le) === 0x0112) {
        const tipo = dv.getUint16(e + 2, le)
        const cont = dv.getUint32(e + 4, le)
        if (tipo !== 3 || cont !== 1) return 0
        const v = dv.getUint16(e + 8, le)
        return v >= 2 && v <= 8 ? v : 0
      }
    }
  } catch {
    /* ilegível: sem orientação */
  }
  return 0
}

/** TIFF big-endian de 26 bytes com UMA etiqueta (Orientation). Sem GPS, sem miniatura, sem fabricante. */
export function tiffMinimo(orientacao: number): Uint8Array {
  return new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // cabeçalho + offset do IFD0
    0x00, 0x01, // 1 entrada
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientacao & 255, 0x00, 0x00, // Orientation, SHORT, 1 valor
    0x00, 0x00, 0x00, 0x00, // sem próximo IFD
  ])
}

// ------------------------------------------------------------------------------------------------ detecção
const BRANDS_HEIF = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif', 'avif', 'avis']

export function detectarFormato(b: Uint8Array): Formato {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && comeca(b, 'PNG', 1) && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 12 && comeca(b, 'RIFF', 0) && comeca(b, 'WEBP', 8)) return 'webp'
  return 'desconhecido'
}

function motivoDeIgnorado(b: Uint8Array): string {
  if (b.length === 0) return 'vazio'
  if (b.length >= 12 && comeca(b, 'ftyp', 4)) {
    const marca = ascii(b, 8, 12).toLowerCase()
    return BRANDS_HEIF.includes(marca) ? 'heic_nao_suportado' : 'formato_desconhecido'
  }
  if (comeca(b, 'GIF8', 0)) return 'gif_nao_suportado'
  return 'formato_desconhecido'
}

// ------------------------------------------------------------------------------------------------ JPEG
interface Saida {
  partes: Uint8Array[]
  removidos: string[]
  orientacao: number
}

function sanearJpeg(b: Uint8Array): Saida {
  const n = b.length
  const partes: Uint8Array[] = [b.subarray(0, 2)] // SOI
  const removidos: string[] = []
  let orientacao = 0
  let posExif = -1 // onde o EXIF mínimo entra (posição original do 1º EXIF)
  let temSof = false
  let temSos = false
  let fim = false
  let pos = 2

  while (pos < n) {
    if (b[pos] !== 0xff) falhar('marcador esperado')
    while (pos < n && b[pos] === 0xff) pos++ // bytes de preenchimento
    if (pos >= n) falhar('truncada')
    const m = b[pos++]
    if (m === 0x00 || m === 0xd8) falhar('marcador inválido')
    if (m === 0xd9) {
      partes.push(new Uint8Array([0xff, 0xd9]))
      fim = true
      break
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      partes.push(new Uint8Array([0xff, m]))
      continue
    }
    if (pos + 2 > n) falhar('truncada')
    const len = (b[pos] << 8) | b[pos + 1]
    if (len < 2 || pos + len > n) falhar('segmento truncado')
    const ini = pos - 2 // começo do marcador (FF xx)
    const carga = b.subarray(pos + 2, pos + len)
    const inteiro = b.subarray(ini, pos + len)
    pos += len

    if (m === 0xe0) {
      if (comeca(carga, 'JFIF\0', 0) && carga.length >= 14) {
        // JFIF sem miniatura embutida (as dimensões da miniatura vão a 0 e os dados saem)
        const novo = new Uint8Array(2 + 2 + 14)
        novo.set([0xff, 0xe0, 0x00, 16])
        novo.set(carga.subarray(0, 14), 4)
        novo[4 + 12] = 0
        novo[4 + 13] = 0
        if (carga.length > 14 || carga[12] !== 0 || carga[13] !== 0) removidos.push('jfif_miniatura')
        partes.push(novo)
      } else {
        removidos.push('app0')
      }
    } else if (m === 0xe1) {
      if (posExif < 0) posExif = partes.length
      if (comeca(carga, 'Exif\0\0', 0)) {
        const o = orientacaoDeTiff(carga.subarray(6))
        if (o) orientacao = o
        removidos.push('exif')
      } else if (comeca(carga, 'http://ns.adobe.com/xap/1.0/', 0)) {
        removidos.push('xmp')
      } else {
        removidos.push('app1')
      }
    } else if (m === 0xe2) {
      if (comeca(carga, 'ICC_PROFILE\0', 0)) partes.push(inteiro)
      else removidos.push(comeca(carga, 'MPF\0', 0) ? 'mpf' : 'app2')
    } else if (m === 0xee) {
      if (comeca(carga, 'Adobe', 0)) partes.push(inteiro)
      else removidos.push('app14')
    } else if ((m >= 0xe3 && m <= 0xef) || m === 0xfe) {
      removidos.push(m === 0xfe ? 'comentario' : m === 0xed ? 'iptc_photoshop' : 'app' + (m - 0xe0))
    } else {
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) temSof = true
      partes.push(inteiro)
      if (m === 0xda) {
        temSos = true
        // dados entropy-coded até o próximo marcador de verdade
        let j = pos
        while (j < n) {
          if (b[j] === 0xff) {
            if (j + 1 >= n) falhar('truncada')
            const nx = b[j + 1]
            if (nx === 0x00 || (nx >= 0xd0 && nx <= 0xd7)) { j += 2; continue }
            if (nx === 0xff) { j += 1; continue }
            break
          }
          j++
        }
        if (j >= n) falhar('sem EOI')
        partes.push(b.subarray(pos, j))
        pos = j
      }
    }
  }
  if (!fim) falhar('sem EOI')
  if (!temSof || !temSos) falhar('estrutura incompleta')

  // O que vier depois do EOI (miniaturas MPF, dados anexados por câmeras/apps) simplesmente não é copiado.

  if (orientacao) {
    const tiff = tiffMinimo(orientacao)
    const carga = concat([new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]), tiff])
    const seg = concat([new Uint8Array([0xff, 0xe1, 0, 2 + carga.length]), carga])
    partes.splice(posExif < 0 ? 1 : posExif, 0, seg)
  }
  return { partes, removidos, orientacao }
}

// ------------------------------------------------------------------------------------------------ PNG
const PNG_MANTER = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'hIST',
  'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'mDCv', 'cLLI', 'cLLi',
])

function chunkPng(tipo: string, dados: Uint8Array): Uint8Array {
  const corpo = concat([new Uint8Array([tipo.charCodeAt(0), tipo.charCodeAt(1), tipo.charCodeAt(2), tipo.charCodeAt(3)]), dados])
  return concat([escreveU32be(dados.length), corpo, escreveU32be(crc32(corpo))])
}

function sanearPng(b: Uint8Array): Saida {
  const n = b.length
  const partes: Uint8Array[] = [b.subarray(0, 8)]
  const removidos: string[] = []
  let orientacao = 0
  let posExif = -1
  let temIdat = false
  let fim = false
  let pos = 8
  let primeiro = true

  while (pos + 12 <= n) {
    const len = u32be(b, pos)
    if (len > 0x7fffffff || pos + 12 + len > n) falhar('chunk truncado')
    const tipo = ascii(b, pos + 4, pos + 8)
    if (!/^[A-Za-z]{4}$/.test(tipo)) falhar('tipo de chunk inválido')
    if (primeiro) {
      if (tipo !== 'IHDR' || len !== 13) falhar('IHDR ausente')
      primeiro = false
    }
    const dados = b.subarray(pos + 8, pos + 8 + len)
    const inteiro = b.subarray(pos, pos + 12 + len)
    pos += 12 + len
    if (tipo === 'IDAT') {
      temIdat = true
      if (posExif < 0) posExif = partes.length
    }
    if (tipo === 'eXIf') {
      const o = orientacaoDeTiff(comeca(dados, 'Exif\0\0', 0) ? dados.subarray(6) : dados)
      if (o) orientacao = o
      removidos.push('exif')
      continue
    }
    if (!PNG_MANTER.has(tipo)) {
      removidos.push(tipo === 'tEXt' || tipo === 'zTXt' || tipo === 'iTXt' ? 'texto' : tipo === 'tIME' ? 'data' : 'chunk_' + tipo)
      continue
    }
    partes.push(inteiro)
    if (tipo === 'IEND') { fim = true; break }
  }
  if (!fim || !temIdat) falhar('PNG incompleto')
  if (orientacao) partes.splice(posExif, 0, chunkPng('eXIf', tiffMinimo(orientacao)))
  return { partes, removidos, orientacao }
}

// ------------------------------------------------------------------------------------------------ WebP
const WEBP_MANTER = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP'])

function chunkWebp(fourcc: string, dados: Uint8Array): Uint8Array {
  const cab = new Uint8Array(8)
  for (let i = 0; i < 4; i++) cab[i] = fourcc.charCodeAt(i)
  cab.set(escreveU32le(dados.length), 4)
  return dados.length & 1 ? concat([cab, dados, new Uint8Array(1)]) : concat([cab, dados])
}

function sanearWebp(b: Uint8Array): Saida {
  const n = b.length
  if (n < 20) falhar('WebP curto')
  const tamanho = u32le(b, 4)
  if (tamanho + 8 > n) falhar('WebP truncado')
  const fim = tamanho + 8
  if (fim < 20) falhar('WebP curto')
  const removidos: string[] = []
  const chunks: { id: string; dados: Uint8Array; bruto: Uint8Array }[] = []
  let orientacao = 0
  let temImagem = false
  let pos = 12
  while (pos + 8 <= fim) {
    const id = ascii(b, pos, pos + 4)
    const sz = u32le(b, pos + 4)
    if (pos + 8 + sz > fim) falhar('chunk truncado')
    const dados = b.subarray(pos + 8, pos + 8 + sz)
    const total = 8 + sz + (sz & 1)
    const bruto = b.subarray(pos, Math.min(pos + total, fim))
    pos += total
    if (id === 'EXIF') {
      const o = orientacaoDeTiff(comeca(dados, 'Exif\0\0', 0) ? dados.subarray(6) : dados)
      if (o) orientacao = o
      removidos.push('exif')
      continue
    }
    if (id === 'XMP ') { removidos.push('xmp'); continue }
    if (!WEBP_MANTER.has(id)) { removidos.push('chunk_' + id.trim()); continue }
    if (id === 'VP8 ' || id === 'VP8L' || id === 'ANMF') temImagem = true
    chunks.push({ id, dados, bruto })
  }
  if (!temImagem) falhar('WebP sem imagem')

  const saida: Uint8Array[] = []
  for (const c of chunks) {
    if (c.id === 'VP8X') {
      if (c.dados.length < 10) falhar('VP8X curto')
      const novos = new Uint8Array(c.dados)
      novos[0] = (novos[0] & ~0x0c) | (orientacao ? 0x08 : 0) // limpa XMP(0x04)/EXIF(0x08); religa EXIF se mantivemos a orientação
      saida.push(chunkWebp('VP8X', novos))
    } else {
      saida.push(c.bruto.length === 8 + c.dados.length + (c.dados.length & 1) ? c.bruto : chunkWebp(c.id, c.dados))
    }
  }
  const temVp8x = chunks.some((c) => c.id === 'VP8X')
  if (orientacao && temVp8x) saida.push(chunkWebp('EXIF', tiffMinimo(orientacao)))
  else orientacao = 0 // sem VP8X o arquivo nem poderia ter EXIF
  const corpo = concat(saida)
  const cab = concat([new Uint8Array([0x52, 0x49, 0x46, 0x46]), escreveU32le(4 + corpo.length), new Uint8Array([0x57, 0x45, 0x42, 0x50])])
  return { partes: [cab, corpo], removidos, orientacao }
}

// ------------------------------------------------------------------------------------------------ API
export function sanearImagem(entrada: Uint8Array, opcoes: OpcoesSaneamento = {}): ResultadoSaneamento {
  const maxBytes = opcoes.maxBytes ?? MAX_BYTES_PADRAO
  const base = (estado: EstadoSaneamento, formato: Formato, motivo: string | null): ResultadoSaneamento => ({
    estado, formato, bytes: entrada, removidos: [], motivo, orientacao: 0,
  })
  if (!(entrada instanceof Uint8Array)) return base('invalida', 'desconhecido', 'entrada_invalida')
  if (entrada.length === 0) return base('ignorado', 'desconhecido', 'vazio')
  if (entrada.length > maxBytes) return base('ignorado', detectarFormato(entrada), 'grande')
  const formato = detectarFormato(entrada)
  if (formato === 'desconhecido') return base('ignorado', formato, motivoDeIgnorado(entrada))

  let saida: Saida
  try {
    saida = formato === 'jpeg' ? sanearJpeg(entrada) : formato === 'png' ? sanearPng(entrada) : sanearWebp(entrada)
  } catch (e) {
    return base('invalida', formato, e instanceof Invalida ? e.message : 'erro_inesperado')
  }

  const out = concat(saida.partes)
  const aposFim = out.length < entrada.length && saida.removidos.length === 0 ? ['apos_fim'] : []
  // Já limpa: nada saiu e (fora lixo após o fim) os bytes são idênticos. Também vale se o único "ganho" seria crescer
  // (EXIF original menor que o mínimo): nunca devolvemos arquivo maior.
  if (iguais(out, entrada) || out.length > entrada.length) {
    return { ...base('limpa', formato, null), orientacao: saida.orientacao }
  }
  return { estado: 'saneada', formato, bytes: out, removidos: [...saida.removidos, ...aposFim], motivo: null, orientacao: saida.orientacao }
}
