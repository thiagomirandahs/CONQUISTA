// Fixtures SINTÉTICAS de HEIC, montadas byte a byte (nada de foto real no repositório).
// O "hvc1" é um payload FALSO (padrão repetitivo reconhecível): o saneador nunca decodifica pixel, só mexe nos itens Exif/XMP.
// Usado por heicSaneamento.test.js.

export const enc = (s) => new TextEncoder().encode(s)
const cat = (...p) => {
  const n = p.reduce((a, x) => a + x.length, 0)
  const o = new Uint8Array(n)
  let k = 0
  for (const x of p) {
    o.set(x, k)
    k += x.length
  }
  return o
}
const u8 = (...v) => new Uint8Array(v)
const u16 = (v) => u8((v >> 8) & 255, v & 255)
const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
const nCampo = (v, tam) => (tam === 0 ? new Uint8Array(0) : tam === 4 ? u32(v) : cat(u32(Math.floor(v / 4294967296)), u32(v >>> 0)))

export const caixa = (tipo, ...partes) => {
  const corpo = cat(...partes)
  return cat(u32(8 + corpo.length), enc(tipo), corpo)
}
const cheia = (tipo, versao, flags, ...partes) => caixa(tipo, u8(versao, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...partes)

// ------------------------------------------------------------------------------------------------ TIFF/EXIF
// entrada: { tag, tipo, cont, dados?: Uint8Array (valor com mais de 4 bytes), valor?: number, ptr?: 'exif'|'gps' }
function montarTiff(le, ifd0, exifIfd, gpsIfd) {
  const w16 = (v) => (le ? u8(v & 255, (v >> 8) & 255) : u16(v))
  const w32 = (v) => (le ? u8(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255) : u32(v))
  const ifds = [ifd0, exifIfd, gpsIfd].filter(Boolean)
  const tamIfd = (e) => 2 + e.length * 12 + 4
  const inicio = []
  let pos = 8
  for (const i of ifds) {
    inicio.push(pos)
    pos += tamIfd(i)
  }
  const posDe = { exif: exifIfd ? inicio[ifds.indexOf(exifIfd)] : 0, gps: gpsIfd ? inicio[ifds.indexOf(gpsIfd)] : 0 }
  let dadosPos = pos
  const dados = []
  const partes = [cat(enc(le ? 'II' : 'MM'), w16(42), w32(8))]
  for (const ifd of ifds) {
    const ent = []
    for (const e of ifd) {
      let campo
      if (e.ptr) campo = w32(posDe[e.ptr])
      else if (e.dados) {
        campo = w32(dadosPos)
        dados.push(e.dados)
        dadosPos += e.dados.length
      } else campo = e.tipo === 3 ? cat(w16(e.valor), u8(0, 0)) : w32(e.valor)
      ent.push(cat(w16(e.tag), w16(e.tipo), w32(e.cont), campo))
    }
    partes.push(cat(w16(ifd.length), ...ent, w32(0)))
  }
  return cat(...partes, ...dados)
}

const asc = (s) => cat(enc(s), u8(0))
const racional = (n, d) => cat(u32(n), u32(d))

/** Item Exif completo: [u32 6]["Exif\0\0"][TIFF]. Os textos "secretos" servem para provar que sumiram. */
export function exifPayload({ le = false, orientacao = 0, fabricante = null, modelo = null, data = null, dataOriginal = null, gps = false, makerNote = null } = {}) {
  const ifd0 = []
  if (fabricante) ifd0.push({ tag: 0x010f, tipo: 2, cont: fabricante.length + 1, dados: asc(fabricante) })
  if (modelo) ifd0.push({ tag: 0x0110, tipo: 2, cont: modelo.length + 1, dados: asc(modelo) })
  if (orientacao) ifd0.push({ tag: 0x0112, tipo: 3, cont: 1, valor: orientacao })
  if (data) ifd0.push({ tag: 0x0132, tipo: 2, cont: data.length + 1, dados: asc(data) })
  const exifIfd = []
  if (dataOriginal) exifIfd.push({ tag: 0x9003, tipo: 2, cont: dataOriginal.length + 1, dados: asc(dataOriginal) })
  if (makerNote) exifIfd.push({ tag: 0x927c, tipo: 7, cont: makerNote.length, dados: enc(makerNote) })
  if (exifIfd.length) ifd0.push({ tag: 0x8769, tipo: 4, cont: 1, ptr: 'exif' })
  let gpsIfd = null
  if (gps) {
    gpsIfd = [
      { tag: 0x0001, tipo: 2, cont: 2, valor: 0x4e000000 }, // 'N\0' inline (4 bytes)
      { tag: 0x0002, tipo: 5, cont: 3, dados: cat(racional(23, 1), racional(32, 1), racional(4567, 100)) },
      { tag: 0x0003, tipo: 2, cont: 2, valor: 0x57000000 },
      { tag: 0x0004, tipo: 5, cont: 3, dados: cat(racional(46, 1), racional(38, 1), racional(1234, 100)) },
    ]
    ifd0.push({ tag: 0x8825, tipo: 4, cont: 1, ptr: 'gps' })
  }
  const tiff = montarTiff(le, ifd0, exifIfd.length ? exifIfd : null, gpsIfd)
  return cat(u32(6), enc('Exif\0\0'), tiff)
}

// ------------------------------------------------------------------------------------------------ HEIC
/** Payload FALSO do item hvc1/grid (bytes reconhecíveis). */
export const payloadHvc1 = (n = 200, semente = 0x41) => Uint8Array.from({ length: n }, (_, i) => (semente + ((i * 7) & 0x3f)) & 255)

/**
 * Monta um HEIC mínimo. Opções:
 *   marca ('heic'), compat, largura/altura (ispe), irot (0..3, null = sem), imir (0|1|null), exif (Uint8Array|null),
 *   exifItens (outros alvos), xmp (string|string[]|null), versaoIloc (0/1/2), extentsExif (1|2), usarBase (base_offset=mdat),
 *   exifNoIdat (item Exif na caixa idat, construction_method 1), sobrepor (o extent do Exif invade o hvc1),
 *   mimeOutro (item mime que NÃO é XMP), ipmaFlag1 (ipma com índices de 16 bits).
 * Devolve { bytes, extentsExif: [{ini,len}], extentsXmp: [[...]], extentsHvc1: [{ini,len}] }.
 */
export function montarHeic(op = {}) {
  const o = {
    marca: 'heic', compat: ['mif1', 'heic'], largura: 4032, altura: 3024, irot: null, imir: null, exif: null, xmp: null,
    versaoIloc: 0, extentsExif: 1, usarBase: false, exifNoIdat: false, sobrepor: false, mimeOutro: null, ipmaFlag1: false, ...op,
  }
  const hvc1 = payloadHvc1(200)
  const xmps = o.xmp == null ? [] : (Array.isArray(o.xmp) ? o.xmp : [o.xmp]).map(enc)
  const v = o.versaoIloc
  const tamBase = o.usarBase ? 4 : 0

  // ordem no mdat: [hvc1][exif A][xmp...][outro][exif B]   (Exif em 2 extents => A e B separados por outros bytes)
  const construir = (mdatIni) => {
    let p = mdatIni
    const ext = {}
    ext.hvc1 = [{ ini: p, len: hvc1.length }]
    p += hvc1.length
    let exifA = null
    let exifB = null
    if (o.exif && !o.exifNoIdat) {
      const cortar = o.extentsExif === 2 ? Math.floor(o.exif.length / 2) : o.exif.length
      exifA = o.exif.subarray(0, cortar)
      exifB = o.extentsExif === 2 ? o.exif.subarray(cortar) : null
      ext.exifA = { ini: p, len: exifA.length }
      p += exifA.length
    }
    ext.xmp = xmps.map((x) => {
      const e = { ini: p, len: x.length }
      p += x.length
      return e
    })
    const outro = o.mimeOutro ? enc(o.mimeOutro) : null
    if (outro) {
      ext.outro = { ini: p, len: outro.length }
      p += outro.length
    }
    if (exifB) {
      ext.exifB = { ini: p, len: exifB.length }
      p += exifB.length
    }
    return { ext, exifA, exifB, outro, fim: p }
  }

  const montarMeta = (mdatIni) => {
    const idatPayload = o.exif && o.exifNoIdat ? o.exif : null
    const c = construir(mdatIni)
    let hvcExtent = c.ext.hvc1[0]
    // itens: 1 hvc1, 2 Exif (opcional), 3.. xmp, depois mime não-xmp
    const itens = [{ id: 1, tipo: 'hvc1', extents: [hvcExtent] }]
    let proximo = 2
    const idExif = o.exif ? proximo++ : null
    if (o.exif) {
      if (o.exifNoIdat) itens.push({ id: idExif, tipo: 'Exif', metodo: 1, extents: [{ ini: 0, len: idatPayload.length }] })
      else {
        const ex = [c.ext.exifA]
        if (c.exifB) ex.push(c.ext.exifB)
        if (o.sobrepor) ex[0] = { ini: hvcExtent.ini + 10, len: ex[0].len }
        itens.push({ id: idExif, tipo: 'Exif', metodo: 0, extents: ex })
      }
    }
    const idsXmp = xmps.map((_, i) => ({ id: proximo++, ext: c.ext.xmp[i] }))
    for (const x of idsXmp) itens.push({ id: x.id, tipo: 'mime', ct: 'application/rdf+xml', metodo: 0, extents: [x.ext] })
    if (c.outro) itens.push({ id: proximo++, tipo: 'mime', ct: 'image/jpeg', metodo: 0, extents: [c.ext.outro] })

    // infe v2 (ids 16 bits) ou v3 (32 bits quando iloc v2)
    const infe = (it) => {
      const vi = v === 2 ? 3 : 2
      const id = vi === 3 ? u32(it.id) : u16(it.id)
      return cheia('infe', vi, 0, id, u16(0), enc(it.tipo), asc(''), it.tipo === 'mime' ? asc(it.ct) : new Uint8Array(0))
    }
    const iinf = cheia('iinf', v === 2 ? 1 : 0, 0, v === 2 ? u32(itens.length) : u16(itens.length), ...itens.map(infe))

    const idsLoc = (id) => (v < 2 ? u16(id) : u32(id))
    const loc = itens.map((it) => {
      const metodo = it.metodo ?? 0
      const base = metodo === 0 && o.usarBase ? mdatIni : 0
      const ex = it.extents.map((e) => cat(nCampo(metodo === 0 && o.usarBase ? e.ini - base : e.ini, 4), nCampo(e.len, 4)))
      return cat(idsLoc(it.id), v >= 1 ? u16(metodo) : new Uint8Array(0), u16(0), nCampo(metodo === 0 ? base : 0, tamBase), u16(it.extents.length), ...ex)
    })
    const iloc = cheia('iloc', v, 0, u8((4 << 4) | 4, (tamBase << 4) | 0), v < 2 ? u16(itens.length) : u32(itens.length), ...loc)

    const pitm = cheia('pitm', 0, 0, u16(1))
    const hdlr = cheia('hdlr', 0, 0, u32(0), enc('pict'), new Uint8Array(12), asc(''))
    const iref = idExif ? cheia('iref', 0, 0, caixa('cdsc', u16(idExif), u16(1), u16(1))) : null

    // propriedades: 1 ispe, 2 hvcC (falsa), 3 irot, 4 imir, 5 colr
    const props = [cheia('ispe', 0, 0, u32(o.largura), u32(o.altura)), caixa('hvcC', u8(1, 1, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 0x5a, 0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 0))]
    const idx = [1, 2]
    if (o.irot != null) {
      props.push(caixa('irot', u8(o.irot & 3)))
      idx.push(props.length)
    }
    if (o.imir != null) {
      props.push(caixa('imir', u8(o.imir & 1)))
      idx.push(props.length)
    }
    props.push(caixa('colr', enc('nclx'), u8(0, 1, 0, 13, 0, 1, 0x80)))
    idx.push(props.length)
    const ipma = cheia(
      'ipma',
      0,
      o.ipmaFlag1 ? 1 : 0,
      u32(1),
      u16(1),
      u8(idx.length),
      ...idx.map((i) => (o.ipmaFlag1 ? u16(i | (i === 2 ? 0x8000 : 0)) : u8(i | (i === 2 ? 0x80 : 0)))),
    )
    const iprp = caixa('iprp', caixa('ipco', ...props), ipma)
    const idat = idatPayload ? caixa('idat', idatPayload) : null
    const meta = cheia('meta', 0, 0, hdlr, pitm, iinf, iloc, ...(iref ? [iref] : []), iprp, ...(idat ? [idat] : []))
    return { meta, c, idatPayload, itens }
  }

  const ftyp = caixa('ftyp', enc(o.marca), u32(0), ...o.compat.map(enc))
  const prov = montarMeta(0)
  const mdatIni = ftyp.length + prov.meta.length + 8
  const { meta, c, idatPayload } = montarMeta(mdatIni)
  const partesMdat = [hvc1]
  if (c.exifA) partesMdat.push(c.exifA)
  for (const x of xmps) partesMdat.push(x)
  if (c.outro) partesMdat.push(c.outro)
  if (c.exifB) partesMdat.push(c.exifB)
  const mdat = caixa('mdat', ...partesMdat)
  const bytes = cat(ftyp, meta, mdat)

  const extentsExif = []
  if (o.exif && !o.exifNoIdat) {
    extentsExif.push(c.ext.exifA)
    if (c.exifB) extentsExif.push(c.ext.exifB)
  } else if (idatPayload) {
    // posição absoluta: depois do cabeçalho de 8 bytes da idat, que é a última caixa da meta
    extentsExif.push({ ini: ftyp.length + meta.length - idatPayload.length, len: idatPayload.length })
  }
  return { bytes, extentsExif, extentsXmp: c.ext.xmp, extentsHvc1: c.ext.hvc1, tamanhoFtypMeta: ftyp.length + meta.length }
}

// ------------------------------------------------------------------------------------------------ utilitários de prova
/** Intervalos [ini, fim) em que a e b diferem (mesmo tamanho), fundidos quando adjacentes. */
export function intervalosDiferentes(a, b) {
  const out = []
  let ini = -1
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (ini < 0) ini = i
    } else if (ini >= 0) {
      out.push([ini, i])
      ini = -1
    }
  }
  if (ini >= 0) out.push([ini, a.length])
  return out
}

/** Todos os intervalos estão contidos em algum extent? */
export function dentroDosExtents(intervalos, extents) {
  return intervalos.every(([i, f]) => extents.some((e) => i >= e.ini && f <= e.ini + e.len))
}

export const contem = (bytes, texto) => {
  const a = enc(texto)
  for (let i = 0; i + a.length <= bytes.length; i++) {
    let k = 0
    while (k < a.length && bytes[i + k] === a[k]) k++
    if (k === a.length) return true
  }
  return false
}

export const XMP_SENSIVEL = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>AUTOR-SECRETO</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>'
export const XMP_GPS = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="23,32.45N"/></rdf:RDF></x:xmpmeta>'
export const XMP_HDR =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 5.5.0"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0" hdrgm:GainMapMin="0" hdrgm:GainMapMax="2.5" hdrgm:Gamma="1" hdrgm:BaseRenditionIsHDR="False"/></rdf:RDF></x:xmpmeta>'
