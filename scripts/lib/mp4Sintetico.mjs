// GERADOR DE MP4/MOV SINTÉTICO para testes (100% por código; NENHUM byte vem de arquivo real de usuário).
// Monta ftyp + moov{mvhd, trak{tkhd, mdia{mdhd, hdlr, minf{stbl{stsd, stts, stsc, stsz, stco|co64}}}}, udta, meta} + mdat pseudo-aleatório.
// NÃO é decodificável por um player (os "frames" são ruído): serve para provar a ESTRUTURA (offsets, caixas, metadados).
// Valores de localização/aparelho são FALSOS e óbvios.

export const GPS_FALSO = '+10.0000+020.0000/'
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
const zeros = (n) => Buffer.alloc(n)
const str = (s) => Buffer.from(s, 'latin1')

export function caixa(tipo, ...partes) {
  const corpo = Buffer.concat(partes)
  return Buffer.concat([u32(8 + corpo.length), str(tipo), corpo])
}
export function caixa64(tipo, tamanhoPayload, ...partes) { // header com largesize (size=1)
  return Buffer.concat([u32(1), str(tipo), u64(16 + tamanhoPayload), ...partes])
}
const completa = (tipo, ver, flags, ...partes) => caixa(tipo, Buffer.from([ver, 0, 0, flags]), ...partes)

function prng(seed) { // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export function ruido(n, seed = 1) {
  const r = prng(seed); const b = Buffer.alloc(n)
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256)
  return b
}

const matriz = (graus) => {
  const um = 0x10000; const w = 0x40000000
  const [a, b, c, d] = { 0: [um, 0, 0, um], 90: [0, um, -um, 0], 180: [-um, 0, 0, -um], 270: [0, -um, um, 0] }[graus]
  const m = Buffer.alloc(36)
  ;[a, b, 0, c, d, 0, 0, 0, w].forEach((v, i) => m.writeInt32BE(v, i * 4))
  return m
}

const mvhd = (dur, ctime) => completa('mvhd', 0, 0, u32(ctime), u32(ctime), u32(1000), u32(dur), u32(0x10000), u16(0x100), zeros(10), matriz(0), zeros(24), u32(3))
const tkhd = (id, w, h, rot, dur, ctime) => completa('tkhd', 0, 3, u32(ctime), u32(ctime), u32(id), u32(0), u32(dur), zeros(8), u16(0), u16(0), u16(0), u16(0), matriz(rot), u32(w * 65536), u32(h * 65536))
const mdhd = (dur, ctime) => completa('mdhd', 0, 0, u32(ctime), u32(ctime), u32(1000), u32(dur), u16(0x55c4), u16(0))
const hdlr = (tipo) => completa('hdlr', 0, 0, u32(0), str(tipo), zeros(12), Buffer.from('Handler\0'))
const stsd = (codec, extra = Buffer.alloc(0)) => completa('stsd', 0, 0, u32(1), caixa(codec, zeros(6), u16(1), zeros(70), extra))
const stts = (n) => completa('stts', 0, 0, u32(1), u32(n), u32(1000))
const stsc = (spc) => completa('stsc', 0, 0, u32(1), u32(1), u32(spc), u32(1))
const stsz = (sizes) => completa('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32))
const stco = (offs) => completa('stco', 0, 0, u32(offs.length), ...offs.map(u32))
const co64 = (offs) => completa('co64', 0, 0, u32(offs.length), ...offs.map(u64))

function trak(t, id, offs, o) {
  const stbl = caixa('stbl', stsd(t.codec, t.extra), stts(t.samples.length), stsc(t.spc), stsz(t.samples), o.co64 ? co64(offs) : stco(offs))
  const minf = caixa('minf', caixa('dinf', completa('dref', 0, 0, u32(1), completa('url ', 0, 1))), stbl)
  const mdia = caixa('mdia', mdhd(5000, o.ctime), hdlr(t.handler), minf)
  return caixa('trak', tkhd(id, t.w, t.h, t.rot, 5000, o.ctime), mdia)
}

const dado = (tipo, valor) => caixa('data', u32(tipo), u32(0), Buffer.isBuffer(valor) ? valor : Buffer.from(valor, 'utf8'))
function metaMdta(itens) { // itens: [[chave, valor]] — meta QuickTime (caixa simples) com keys/ilst
  const keys = completa('keys', 0, 0, u32(itens.length), ...itens.map(([k]) => caixa('mdta', Buffer.from(k, 'utf8'))))
  // cada entrada de `keys` é [size][namespace 'mdta'][chave]: caixa('mdta', chave) produz exatamente isso
  const ilst = caixa('ilst', ...itens.map(([, v], i) => caixa(u32(i + 1).toString('latin1'), dado(1, v))))
  return caixa('meta', caixa_hdlr_mdta(), keys, ilst)
}
const caixa_hdlr_mdta = () => caixa('hdlr', u32(0), u32(0), str('mdta'), zeros(12), Buffer.from([0]))

const udtaTexto = (tipo, texto) => caixa(tipo, u16(texto.length), u16(0x15c7), Buffer.from(texto, 'latin1'))
const loci = () => completa('loci', 0, 0, u16(0), Buffer.from('Lugar\0'), Buffer.from([1]), u32(0x000a0000), u32(0x00140000), u32(0), Buffer.from('Corpo\0'), Buffer.from('Nota\0'))

export const UUID_XMP = Buffer.from('BE7ACFCB97A942E89C71999491E3AFAC', 'hex')

// opcoes: marca, rotacao, gps (©xyz), mdtaLocal, mdtaAparelho, loci, aparelho (©mak/©mod/©swr), encoderGenerico, comentario, xmp, datas,
//         faststart, co64, mdatBytes, virtual ({ amostras, tamanho } -> mdat gigante sem alocar), semMetadados, mebxLocal, extras (caixas topo)
export function montarMp4(opcoes = {}) {
  const o = { marca: 'mp42', rotacao: 0, faststart: true, datas: true, mdatBytes: 4096, ...opcoes }
  const ctime = o.datas ? 3_700_000_000 : 0
  const co = { ...o, ctime, co64: !!(o.co64 || o.virtual) }
  let amostrasV
  let amostrasA
  if (o.virtual) { amostrasV = Array.from({ length: o.virtual.amostras }, () => o.virtual.tamanho); amostrasA = [] }
  else { amostrasV = [o.mdatBytes / 4, o.mdatBytes / 4, o.mdatBytes / 4, o.mdatBytes / 4].map(Math.floor); amostrasA = [100, 100] }
  const trilhas = [{ handler: 'vide', codec: 'avc1', w: 640, h: 360, rot: o.rotacao, samples: amostrasV, spc: o.virtual ? 1 : 2 }]
  if (amostrasA.length) trilhas.push({ handler: 'soun', codec: 'mp4a', w: 0, h: 0, rot: 0, samples: amostrasA, spc: 1 })
  if (o.mebxLocal) trilhas.push({ handler: 'meta', codec: 'mebx', w: 0, h: 0, rot: 0, samples: [10], spc: 1, extra: Buffer.from('com.apple.quicktime.location.ISO6709') })
  // layout das amostras dentro do payload do mdat
  let rel = 0
  const layout = trilhas.map((t) => { const l = []; for (let i = 0; i < t.samples.length; i += t.spc) { l.push(rel); for (let k = 0; k < t.spc; k++) rel += t.samples[i + k] } return l })
  const payloadTotal = rel

  const udtaPartes = []
  if (!o.semMetadados) {
    if (o.gps) udtaPartes.push(udtaTexto('\xa9xyz', GPS_FALSO))
    if (o.loci) udtaPartes.push(loci())
    if (o.aparelho) udtaPartes.push(udtaTexto('\xa9mak', 'MarcaFalsa'), udtaTexto('\xa9mod', 'ModeloFalso X1'), udtaTexto('\xa9swr', 'SoFalso 9.9'))
    if (o.encoderGenerico) udtaPartes.push(udtaTexto('\xa9too', 'Lavf58.76.100'))
    if (o.comentario) udtaPartes.push(udtaTexto('\xa9cmt', 'comentario falso do usuario'))
    if (o.datas) udtaPartes.push(udtaTexto('\xa9day', '2026-10-01T10:00:00'))
    udtaPartes.push(caixa('smta', zeros(8))) // átomo desconhecido (fornecedor)
  }
  const itensMdta = []
  if (!o.semMetadados) {
    if (o.mdtaLocal) itensMdta.push(['com.apple.quicktime.location.ISO6709', GPS_FALSO])
    if (o.mdtaAparelho) itensMdta.push(['com.apple.quicktime.make', 'MarcaFalsa'], ['com.apple.quicktime.model', 'ModeloFalso X1'], ['com.apple.quicktime.software', 'SoFalso 9.9'])
    if (o.mdtaAparelho || o.mdtaLocal) itensMdta.push(['com.apple.quicktime.creationdate', '2026-10-01T10:00:00-0300'])
  }
  const moovPartes = (offsetsDe) => {
    const t = trilhas.map((tr, i) => trak(tr, i + 1, layout[i].map((r) => r + offsetsDe), co))
    const partes = [mvhd(5000, ctime), ...t]
    if (udtaPartes.length) partes.push(caixa('udta', ...udtaPartes, Buffer.alloc(4)))
    if (itensMdta.length) partes.push(o.metaEmUdta ? caixa('udta', metaMdta(itensMdta)) : metaMdta(itensMdta))
    if (o.xmpNoMoov) partes.push(caixa('uuid', UUID_XMP, Buffer.from('<x:xmpmeta/>')))
    return caixa('moov', ...partes)
  }
  const ftyp = caixa('ftyp', str(o.marca.padEnd(4)), u32(0), str(o.marca.padEnd(4)), str('isom'))
  const mdatHdr = o.virtual || o.mdat64 ? caixa64('mdat', payloadTotal) : null
  const mdatHdrTam = mdatHdr ? 16 : 8
  const xmpTopo = o.xmp ? caixa('uuid', UUID_XMP, Buffer.from('<x:xmpmeta/>')) : Buffer.alloc(0)
  const extras = (o.extras || []).map(([t, n]) => caixa(t, zeros(n)))
  const moov0 = moovPartes(0)
  let ini
  if (o.faststart) ini = ftyp.length + moov0.length + mdatHdrTam
  else ini = ftyp.length + mdatHdrTam
  const moov = moovPartes(ini)
  const payload = o.virtual ? null : ruido(payloadTotal, 7)
  const cab = mdatHdr || Buffer.concat([u32(8 + payloadTotal), str('mdat')])
  const prefixo = o.faststart ? [ftyp, moov, ...extras] : [ftyp]
  const comMoovNoFim = o.faststart ? [] : [moov, xmpTopo, ...extras]
  const antesDoMdat = Buffer.concat(prefixo)
  const resultado = { mdat: { ini: antesDoMdat.length, payloadIni: antesDoMdat.length + cab.length, fim: antesDoMdat.length + cab.length + payloadTotal }, payloadTotal }
  if (o.virtual) {
    const depois = Buffer.concat([xmpTopo, ...comMoovNoFim])
    const segs = [{ b: Buffer.concat([antesDoMdat, cab]) }, { zeros: payloadTotal }, { b: depois }]
    return { ...resultado, leitor: leitorSegmentado(segs), tamanho: resultado.mdat.fim + depois.length }
  }
  const bytes = Buffer.concat([antesDoMdat, cab, payload, xmpTopo, ...comMoovNoFim])
  return { ...resultado, bytes, tamanho: bytes.length }
}

// leitor "virtual": segmentos de buffer real + regiões de zeros (permite arquivos > 4 GB sem alocar memória)
export function leitorSegmentado(segs) {
  const tamanho = segs.reduce((s, x) => s + (x.b ? x.b.length : x.zeros), 0)
  return {
    tamanho,
    ler(offset, n) {
      const q = Math.max(0, Math.min(n, tamanho - offset))
      const out = Buffer.alloc(q)
      let pos = 0
      for (const s of segs) {
        const len = s.b ? s.b.length : s.zeros
        const ini = Math.max(offset, pos); const fim = Math.min(offset + q, pos + len)
        if (fim > ini && s.b) s.b.copy(out, ini - offset, ini - pos, fim - pos)
        pos += len
      }
      return out
    },
  }
}
