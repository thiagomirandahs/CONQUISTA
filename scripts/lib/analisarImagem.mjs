// Classifica um arquivo de imagem pelos BYTES (formato real e metadados), sem imprimir coordenadas nem conteúdo.
//   classificar(buffer) -> { formato: 'jpeg'|'png'|'webp'|'gif'|'heic'|'video'|'desconhecido', situacao: 'com_gps'|'com_metadados'|'limpo'|'invalido'|'nao_suportado' }
// A = com_gps · B = com_metadados (EXIF/XMP/IPTC/comentário/texto sem GPS) · C = limpo · D = invalido (truncado/corrompido) · E = nao_suportado (HEIC, GIF, vídeo, outro)
export function formato(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12).toLowerCase()
    return ['heic', 'heix', 'heif', 'hevc', 'mif1', 'msf1'].includes(brand) ? 'heic' : 'video'
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video'
  return 'desconhecido'
}

// Lê o IFD0 do EXIF: { gps, outros } — "outros" = qualquer tag que NÃO seja a Orientação (0x0112) (o saneador deixa só a orientação, 26 bytes)
function exifInfo(app) {
  try {
    const le = app.toString('latin1', 0, 2) === 'II'
    const u16 = (o) => (le ? app.readUInt16LE(o) : app.readUInt16BE(o)); const u32 = (o) => (le ? app.readUInt32LE(o) : app.readUInt32BE(o))
    const off = u32(4); const n = u16(off); let gps = false, outros = false
    for (let i = 0; i < n; i++) { const tag = u16(off + 2 + i * 12); if (tag === 0x8825) gps = true; else if (tag !== 0x0112) outros = true }
    return { gps, outros }
  } catch { return { gps: false, outros: true } }
}

function jpeg(b) {
  let i = 2; let meta = false, gps = false, fim = false
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return 'invalido'
    let m = b[i + 1]
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1] }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
    if (m === 0xd9) { fim = true; break }
    const len = b.readUInt16BE(i + 2)
    if (m === 0xda) { fim = b.includes(Buffer.from([0xff, 0xd9]), i + 2 + len); break }
    if (m === 0xe1) {
      const corpo = b.subarray(i + 4, i + 2 + len)
      if (corpo.toString('latin1', 0, 6) === 'Exif\0\0') { const e = exifInfo(corpo.subarray(6)); if (e.gps) gps = true; if (e.gps || e.outros) meta = true }
      else if (corpo.toString('latin1', 0, 29).startsWith('http://ns.adobe.com/xap')) meta = true
    } else if (m === 0xed || m === 0xfe) meta = true
    i += 2 + len
  }
  return !fim ? 'invalido' : gps ? 'com_gps' : meta ? 'com_metadados' : 'limpo'
}
function png(b) {
  let i = 8; let meta = false, fim = false
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i); const tipo = b.toString('latin1', i + 4, i + 8)
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(tipo)) meta = true
    if (tipo === 'IEND') { fim = true; break }
    i += 12 + len
  }
  return !fim ? 'invalido' : meta ? 'com_metadados' : 'limpo'
}
function webp(b) {
  let i = 12; let meta = false, gps = false
  while (i + 8 <= b.length) {
    const tipo = b.toString('latin1', i, i + 4); const len = b.readUInt32LE(i + 4)
    if (tipo === 'EXIF') { const c = b.subarray(i + 8, i + 8 + len); const e = exifInfo(c.toString('latin1', 0, 6) === 'Exif\0\0' ? c.subarray(6) : c); if (e.gps) gps = true; if (e.gps || e.outros) meta = true }
    if (tipo === 'XMP ') meta = true
    i += 8 + len + (len % 2)
  }
  return gps ? 'com_gps' : meta ? 'com_metadados' : 'limpo'
}

export function classificar(b) {
  const f = formato(b)
  if (f === 'jpeg') return { formato: f, situacao: jpeg(b) }
  if (f === 'png') return { formato: f, situacao: png(b) }
  if (f === 'webp') return { formato: f, situacao: webp(b) }
  return { formato: f, situacao: 'nao_suportado' }
}
export const SUPORTADOS = ['jpeg', 'png', 'webp']
