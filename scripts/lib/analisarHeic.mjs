// Analisador de HEIC/HEIF (ISO-BMFF) em JavaScript PURO, sem dependências: funciona em Node 22, Deno e navegador.
//
// Só LÊ. Nunca lança exceção por entrada ruim: entrada inválida/truncada devolve { estado: 'invalido', motivo }.
// Não devolve VALORES de metadados (nem coordenadas, nem modelo do aparelho): só presença/ausência e classificação.
//
// Resultado:
//   { estado: 'ok' | 'invalido' | 'nao_suportada', motivo?, marca, compativeis,
//     largura, altura, rotacao (0/90/180/270, anti-horário), espelho (null | 'eixo_vertical' | 'eixo_horizontal'),
//     primario (id), itens: [{ id, tipo, contentType, primario, metodo, extents: [{ ini, len }] | null }],
//     tipos: { hvc1: 2, Exif: 1, ... }, exif: {...}, xmp: {...}, outrosItensDeMetadado, classe, sinais: [...] }
//
// classe: 'LIMPO' | 'METADADOS_NAO_SENSIVEIS' | 'METADADOS_SENSIVEIS' | 'GPS' | 'INDETERMINADO'
//   LIMPO = nenhum EXIF (ou só Orientation) e nenhum XMP com dados.

export const MARCAS_HEIC = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif']
export const MARCAS_AVIF = ['avif', 'avis']
export const TIPO_XMP = 'application/rdf+xml'

class Invalida extends Error {}
const falhar = (m) => {
  throw new Invalida(m)
}

// ------------------------------------------------------------------------------------------------ leitura segura
function leitor(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const chk = (p, n, lim) => {
    if (!(p >= 0) || p + n > (lim ?? b.length)) falhar('fora_dos_limites')
  }
  const u64 = (p, lim) => {
    chk(p, 8, lim)
    const v = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4)
    if (!Number.isSafeInteger(v)) falhar('inteiro_grande_demais')
    return v
  }
  const u32 = (p, lim) => {
    chk(p, 4, lim)
    return dv.getUint32(p)
  }
  return {
    b,
    u8: (p, lim) => {
      chk(p, 1, lim)
      return b[p]
    },
    u16: (p, lim) => {
      chk(p, 2, lim)
      return dv.getUint16(p)
    },
    u32,
    u64,
    // inteiro de 0/4/8 bytes (campos do iloc)
    n: (p, tam, lim) => {
      if (tam === 0) return 0
      if (tam === 4) return u32(p, lim)
      if (tam === 8) return u64(p, lim)
      return falhar('tamanho_de_campo_invalido')
    },
    cc: (p, lim) => {
      chk(p, 4, lim)
      return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3])
    },
    // string terminada em NUL dentro de [p, lim); devolve { s, prox }
    cstr: (p, lim) => {
      let q = p
      while (q < lim && b[q] !== 0) q++
      if (q >= lim) falhar('string_sem_fim')
      let s = ''
      for (let i = p; i < q; i++) s += String.fromCharCode(b[i])
      return { s, prox: q + 1 }
    },
  }
}

// Lista as caixas filhas em [ini, fim). `fim` é o limite do pai: caixa que ultrapassa => truncado.
function caixas(L, ini, fim) {
  const out = []
  let p = ini
  while (p < fim) {
    if (fim - p < 8) falhar('caixa_truncada')
    let tam = L.u32(p, fim)
    const tipo = L.cc(p + 4, fim)
    let corpo = p + 8
    if (tam === 1) {
      tam = L.u64(p + 8, fim)
      corpo = p + 16
    } else if (tam === 0) tam = fim - p
    if (tam < corpo - p) falhar('caixa_com_tamanho_invalido')
    if (p + tam > fim) falhar('caixa_truncada')
    out.push({ tipo, ini: p, corpo, fim: p + tam })
    p += tam
  }
  return out
}

// ------------------------------------------------------------------------------------------------ meta
function lerInfe(L, c) {
  const v = L.u8(c.corpo)
  let p = c.corpo + 4
  const lim = c.fim
  if (v < 2) {
    // v0/v1: sem item_type
    const id = L.u16(p, lim)
    p += 4
    const nome = L.cstr(p, lim)
    p = nome.prox
    let contentType = ''
    try {
      contentType = L.cstr(p, lim).s
    } catch {
      /* opcional */
    }
    return { id, tipo: '', contentType }
  }
  let id
  if (v === 2) {
    id = L.u16(p, lim)
    p += 2
  } else {
    id = L.u32(p, lim)
    p += 4
  }
  p += 2 // protection_index
  const tipo = L.cc(p, lim)
  p += 4
  let contentType = ''
  const nome = L.cstr(p, lim)
  p = nome.prox
  if (tipo === 'mime') {
    try {
      contentType = L.cstr(p, lim).s
    } catch {
      contentType = ''
    }
  }
  return { id, tipo, contentType }
}

function lerIinf(L, c) {
  const v = L.u8(c.corpo)
  let p = c.corpo + 4
  p += v === 0 ? 2 : 4
  if (p > c.fim) falhar('iinf_truncada')
  return caixas(L, p, c.fim)
    .filter((x) => x.tipo === 'infe')
    .map((x) => lerInfe(L, x))
}

function lerIloc(L, c) {
  const v = L.u8(c.corpo)
  if (v > 2) falhar('iloc_versao_desconhecida')
  let p = c.corpo + 4
  const b1 = L.u8(p, c.fim)
  const b2 = L.u8(p + 1, c.fim)
  p += 2
  const tamOff = b1 >> 4
  const tamLen = b1 & 15
  const tamBase = b2 >> 4
  const tamIdx = v === 1 || v === 2 ? b2 & 15 : 0
  let n
  if (v < 2) {
    n = L.u16(p, c.fim)
    p += 2
  } else {
    n = L.u32(p, c.fim)
    p += 4
  }
  if (n * 6 > c.fim - p) falhar('iloc_contagem_absurda')
  const itens = new Map()
  for (let i = 0; i < n; i++) {
    let id
    if (v < 2) {
      id = L.u16(p, c.fim)
      p += 2
    } else {
      id = L.u32(p, c.fim)
      p += 4
    }
    let metodo = 0
    if (v >= 1) {
      metodo = L.u16(p, c.fim) & 15
      p += 2
    }
    p += 2 // data_reference_index
    const base = L.n(p, tamBase, c.fim)
    p += tamBase
    const ne = L.u16(p, c.fim)
    p += 2
    const extents = []
    for (let e = 0; e < ne; e++) {
      p += tamIdx
      const off = L.n(p, tamOff, c.fim)
      p += tamOff
      const len = L.n(p, tamLen, c.fim)
      p += tamLen
      extents.push({ off: base + off, len })
    }
    itens.set(id, { metodo, extents })
  }
  return itens
}

function lerIref(L, c) {
  const v = L.u8(c.corpo)
  const out = [] // { tipo, de, para: [] }
  for (const r of caixas(L, c.corpo + 4, c.fim)) {
    let p = r.corpo
    let de
    let ct
    if (v === 0) {
      de = L.u16(p, r.fim)
      ct = L.u16(p + 2, r.fim)
      p += 4
    } else {
      de = L.u32(p, r.fim)
      ct = L.u16(p + 4, r.fim)
      p += 6
    }
    const para = []
    for (let i = 0; i < ct; i++) {
      para.push(v === 0 ? L.u16(p, r.fim) : L.u32(p, r.fim))
      p += v === 0 ? 2 : 4
    }
    out.push({ tipo: r.tipo, de, para })
  }
  return out
}

function lerIprp(L, c) {
  const props = [null] // índice 1-based
  const assoc = new Map() // id -> [índices]
  for (const k of caixas(L, c.corpo, c.fim)) {
    if (k.tipo === 'ipco') {
      for (const pr of caixas(L, k.corpo, k.fim)) {
        let d = { tipo: pr.tipo }
        try {
          if (pr.tipo === 'ispe') d = { tipo: 'ispe', largura: L.u32(pr.corpo + 4, pr.fim), altura: L.u32(pr.corpo + 8, pr.fim) }
          else if (pr.tipo === 'irot') d = { tipo: 'irot', graus: (L.u8(pr.corpo, pr.fim) & 3) * 90 }
          else if (pr.tipo === 'imir') d = { tipo: 'imir', eixo: L.u8(pr.corpo, pr.fim) & 1 }
          else if (pr.tipo === 'colr') d = { tipo: 'colr', cor: L.cc(pr.corpo, pr.fim) }
        } catch {
          d = { tipo: pr.tipo, ilegivel: true }
        }
        props.push(d)
      }
    } else if (k.tipo === 'ipma') {
      const v = L.u8(k.corpo)
      const fl = L.u32(k.corpo, k.fim) & 0xffffff
      let p = k.corpo + 4
      const n = L.u32(p, k.fim)
      p += 4
      if (n > k.fim - p) falhar('ipma_contagem_absurda')
      for (let i = 0; i < n; i++) {
        let id
        if (v < 1) {
          id = L.u16(p, k.fim)
          p += 2
        } else {
          id = L.u32(p, k.fim)
          p += 4
        }
        const na = L.u8(p, k.fim)
        p++
        const lista = assoc.get(id) || []
        for (let a = 0; a < na; a++) {
          if (fl & 1) {
            lista.push(L.u16(p, k.fim) & 0x7fff)
            p += 2
          } else {
            lista.push(L.u8(p, k.fim) & 0x7f)
            p++
          }
        }
        assoc.set(id, lista)
      }
    }
  }
  return { props, assoc }
}

// ------------------------------------------------------------------------------------------------ TIFF/EXIF
const TAGS_IFD0_SENSIVEIS = new Map([
  [0x010f, 'fabricante'],
  [0x0110, 'modelo'],
  [0x0131, 'software'],
  [0x0132, 'data_hora'],
  [0x013b, 'artista'],
  [0x8298, 'copyright'],
  [0x010e, 'descricao'],
  [0x013c, 'computador'],
])
const TAGS_EXIFIFD_SENSIVEIS = new Map([
  [0x9003, 'data_original'],
  [0x9004, 'data_digitalizacao'],
  [0x927c, 'makernote'],
  [0xa431, 'serial_corpo'],
  [0xa430, 'dono_camera'],
  [0x9286, 'comentario'],
  [0xa420, 'id_unico_imagem'],
  [0xa434, 'modelo_lente'],
  [0xa435, 'serial_lente'],
  [0x9010, 'fuso'],
  [0x9011, 'fuso'],
  [0x9012, 'fuso'],
  [0x9290, 'subsegundos'],
  [0x9291, 'subsegundos'],
  [0x9292, 'subsegundos'],
])

/** Analisa um payload do item Exif (4 bytes de offset + prefixo + TIFF). Nunca lança. Não devolve valores. */
export function analisarExif(payload) {
  const r = { presente: payload.length > 0, tiffValido: false, orientacao: 0, gps: 'ausente', sinais: [], outrasTags: false, miniatura: false }
  try {
    const L = leitor(payload)
    if (payload.length < 4) return r
    const skip = L.u32(0)
    const t = 4 + skip
    if (skip > payload.length - 4 || payload.length - t < 8) return r // vazio/ilegível => tiffValido=false
    const bo = payload[t] === 0x49 && payload[t + 1] === 0x49 ? 'le' : payload[t] === 0x4d && payload[t + 1] === 0x4d ? 'be' : null
    if (!bo) return r
    const le = bo === 'le'
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const u16 = (p) => {
      if (p + 2 > payload.length) falhar('x')
      return dv.getUint16(p, le)
    }
    const u32 = (p) => {
      if (p + 4 > payload.length) falhar('x')
      return dv.getUint32(p, le)
    }
    if (u16(t + 2) !== 42) return r
    r.tiffValido = true
    const lerIfd = (off, limite) => {
      const p = t + off
      if (off < 8 || p + 2 > payload.length) falhar('ifd_fora')
      const n = Math.min(u16(p), limite)
      const entradas = []
      for (let i = 0; i < n; i++) {
        const e = p + 2 + i * 12
        if (e + 12 > payload.length) break
        entradas.push({ tag: u16(e), tipo: u16(e + 2), cont: u32(e + 4), campo: e + 8 })
      }
      let prox = 0
      try {
        prox = u32(p + 2 + n * 12)
      } catch {
        prox = 0
      }
      return { entradas, prox }
    }
    const ifd0 = lerIfd(u32(t + 4), 256)
    let exifIfdOff = 0
    let gpsOff = 0
    for (const e of ifd0.entradas) {
      if (e.tag === 0x0112) {
        if (e.tipo === 3 && e.cont === 1) {
          const v = u16(e.campo)
          r.orientacao = v >= 2 && v <= 8 ? v : 0
        }
      } else if (TAGS_IFD0_SENSIVEIS.has(e.tag)) r.sinais.push(TAGS_IFD0_SENSIVEIS.get(e.tag))
      else if (e.tag === 0x8769) exifIfdOff = u32(e.campo)
      else if (e.tag === 0x8825) gpsOff = u32(e.campo)
      else r.outrasTags = true
    }
    if (ifd0.prox) {
      r.miniatura = true
      r.sinais.push('miniatura_exif')
    }
    if (exifIfdOff) {
      try {
        const sub = lerIfd(exifIfdOff, 512)
        for (const e of sub.entradas) {
          if (TAGS_EXIFIFD_SENSIVEIS.has(e.tag)) r.sinais.push(TAGS_EXIFIFD_SENSIVEIS.get(e.tag))
          else r.outrasTags = true
        }
      } catch {
        r.sinais.push('exif_ifd_ilegivel')
      }
    }
    if (gpsOff) {
      try {
        const g = lerIfd(gpsOff, 64)
        const tags = g.entradas.map((e) => e.tag)
        if (tags.includes(0x0002) || tags.includes(0x0004)) r.gps = 'coordenadas'
        else if (tags.some((x) => x !== 0x0000)) r.gps = 'outros_campos'
        else r.gps = 'vazio'
      } catch {
        r.gps = 'ilegivel'
      }
    }
  } catch {
    r.tiffValido = false
  }
  return r
}

/** Orientation (2..8) do payload do item Exif; 0 se ausente/normal/ilegível. */
export function orientacaoDoPayloadExif(payload) {
  return analisarExif(payload).orientacao
}

/** Diz se o payload XMP está vazio/neutro (nada além do pacote mínimo/espaços/zeros). */
export function xmpEhNeutro(payload) {
  let s = ''
  for (let i = 0; i < payload.length; i++) s += String.fromCharCode(payload[i])
  s = s.replace(/[\s\0]+/g, ' ').trim()
  return s === '' || s === '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'
}

/**
 * XMP FUNCIONAL: pacote que só carrega os parâmetros numéricos do mapa de ganho HDR (namespace hdrgm: — Ultra HDR /
 * Adobe gain map). Sem texto livre, sem datas, sem aparelho, sem GPS. É preservado de propósito: apagá-lo tira o HDR
 * da foto (a imagem passa a ser exibida só na versão SDR). Qualquer outro nome de elemento/atributo => NÃO é funcional.
 */
export function xmpEhFuncionalHdr(payload) {
  let s = ''
  for (let i = 0; i < payload.length; i++) s += String.fromCharCode(payload[i])
  s = s.replace(/\0+$/g, '')
  if (!/hdrgm:/.test(s) || s.length > 8192) return false
  const permitidoNome = /^(x:xmpmeta|rdf:RDF|rdf:Description|rdf:Seq|rdf:li|hdrgm:[A-Za-z]+|\?xpacket)$/
  for (const m of s.matchAll(/<\/?([?A-Za-z][\w:.-]*)/g)) if (!permitidoNome.test(m[1])) return false
  for (const m of s.matchAll(/\s([A-Za-z][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    const [, nome, valor] = m
    if (nome === 'xmlns:x') { if (valor !== 'adobe:ns:meta/') return false }
    else if (nome === 'xmlns:rdf') { if (valor !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#') return false }
    else if (nome === 'xmlns:hdrgm') { if (!/^http:\/\/ns\.adobe\.com\/hdr-gain-map\//.test(valor)) return false }
    else if (nome === 'x:xmptk') { if (!/^[\w .:-]{0,60}$/.test(valor)) return false }
    else if (nome === 'rdf:about') { if (valor !== '') return false }
    else if (nome.startsWith('hdrgm:')) { if (!/^(-?\d+(\.\d+)?([eE][-+]?\d+)?|True|False)$/.test(valor)) return false }
    else if (nome === 'begin' || nome === 'id' || nome === 'end') continue // atributos do cabeçalho <?xpacket ... ?>
    else return false
  }
  // texto entre as tags (ex.: <rdf:li>0.5</rdf:li>) só pode ser número
  const texto = s.replace(/<\?[\s\S]*?\?>/g, '').replace(/<[^>]*>/g, '|').split('|')
  return texto.every((t) => t.trim() === '' || /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t.trim()))
}

/** Une os extents do item numa só leitura lógica (cópia). */
export function payloadDoItem(b, item) {
  const total = item.extents.reduce((n, e) => n + e.len, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const e of item.extents) {
    out.set(b.subarray(e.ini, e.ini + e.len), o)
    o += e.len
  }
  return out
}

// ------------------------------------------------------------------------------------------------ principal
export function analisarHeic(entrada) {
  try {
    if (!(entrada instanceof Uint8Array)) return { estado: 'invalido', motivo: 'entrada_nao_e_bytes' }
    const b = entrada
    if (b.length < 16) return { estado: 'invalido', motivo: 'curto_demais' }
    const L = leitor(b)
    if (L.cc(4) !== 'ftyp') return { estado: 'invalido', motivo: 'sem_ftyp' }
    const topo = caixas(L, 0, b.length)
    const ftyp = topo[0]
    if (ftyp.tipo !== 'ftyp' || ftyp.fim - ftyp.corpo < 8) return { estado: 'invalido', motivo: 'ftyp_invalida' }
    const marca = L.cc(ftyp.corpo)
    const compativeis = []
    for (let p = ftyp.corpo + 8; p + 4 <= ftyp.fim; p += 4) compativeis.push(L.cc(p))
    const todas = [marca, ...compativeis]
    const base = { marca, compativeis }
    if (todas.some((m) => MARCAS_AVIF.includes(m))) return { estado: 'nao_suportada', motivo: 'avif', ...base }
    if (!todas.some((m) => MARCAS_HEIC.includes(m))) return { estado: 'nao_suportada', motivo: 'marca_desconhecida', ...base }

    const metas = topo.filter((c) => c.tipo === 'meta')
    if (metas.length !== 1) return { estado: 'invalido', motivo: metas.length ? 'meta_duplicada' : 'sem_meta', ...base }
    const meta = metas[0]
    let primario = null
    let itensInfe = []
    let iloc = new Map()
    let iref = []
    let iprp = { props: [null], assoc: new Map() }
    let idat = null
    for (const c of caixas(L, meta.corpo + 4, meta.fim)) {
      if (c.tipo === 'pitm') primario = L.u8(c.corpo) === 0 ? L.u16(c.corpo + 4, c.fim) : L.u32(c.corpo + 4, c.fim)
      else if (c.tipo === 'iinf') itensInfe = lerIinf(L, c)
      else if (c.tipo === 'iloc') iloc = lerIloc(L, c)
      else if (c.tipo === 'iref') iref = lerIref(L, c)
      else if (c.tipo === 'iprp') iprp = lerIprp(L, c)
      else if (c.tipo === 'idat') idat = c
    }
    if (primario === null) return { estado: 'invalido', motivo: 'sem_pitm', ...base }
    if (!itensInfe.length) return { estado: 'invalido', motivo: 'sem_itens', ...base }

    const itens = itensInfe.map((it) => {
      const loc = iloc.get(it.id)
      let extents = null
      const metodo = loc ? loc.metodo : null
      if (loc) {
        extents = []
        for (const e of loc.extents) {
          let ini
          if (loc.metodo === 0) ini = e.off
          else if (loc.metodo === 1 && idat) ini = idat.corpo + e.off
          else {
            extents = null // método 2 (item_offset) ou idat ausente: não suportado
            break
          }
          if (e.len === 0) {
            extents = null // "até o fim": não suportado de propósito
            break
          }
          const lim = loc.metodo === 1 ? idat.fim : b.length
          if (ini + e.len > lim) falhar('extent_alem_do_arquivo') // truncado
          extents.push({ ini, len: e.len })
        }
      }
      return { id: it.id, tipo: it.tipo, contentType: it.contentType || '', primario: it.id === primario, metodo, extents }
    })
    for (const [id] of iloc) if (!itensInfe.some((i) => i.id === id)) falhar('iloc_de_item_inexistente')

    const tipos = {}
    for (const it of itens) tipos[it.tipo || '(v0)'] = (tipos[it.tipo || '(v0)'] || 0) + 1

    // propriedades do item primário
    const pp = (iprp.assoc.get(primario) || []).map((i) => iprp.props[i]).filter(Boolean)
    const ispe = pp.find((x) => x.tipo === 'ispe')
    const irot = pp.find((x) => x.tipo === 'irot')
    const imir = pp.find((x) => x.tipo === 'imir')
    const colr = pp.find((x) => x.tipo === 'colr')

    // metadados
    const itensExif = itens.filter((i) => i.tipo === 'Exif')
    const itensXmp = itens.filter((i) => i.tipo === 'mime' && i.contentType.toLowerCase() === TIPO_XMP)
    const outrosMeta = itens.filter((i) => (i.tipo === 'mime' && i.contentType.toLowerCase() !== TIPO_XMP) || i.tipo === 'uri ')

    const exif = { presente: itensExif.length > 0, itens: itensExif.length, tiffValido: false, orientacao: 0, gps: 'ausente', sinais: [], outrasTags: false, miniatura: false, legivel: true }
    for (const it of itensExif) {
      if (!it.extents) {
        exif.legivel = false
        continue
      }
      const pl = payloadDoItem(b, it)
      const a = analisarExif(pl)
      exif.tiffValido ||= a.tiffValido
      if (a.orientacao) exif.orientacao = a.orientacao
      if (a.gps !== 'ausente') exif.gps = a.gps
      exif.sinais.push(...a.sinais)
      exif.outrasTags ||= a.outrasTags
      exif.miniatura ||= a.miniatura
      if (!a.tiffValido && pl.some((x) => x !== 0) && !payloadExifVazioValido(pl)) exif.legivel = false // há bytes mas não é TIFF
    }
    exif.sinais = [...new Set(exif.sinais)]
    const xmp = { presente: itensXmp.length > 0, itens: itensXmp.length, comDados: false, funcionais: 0, gps: false, legivel: true }
    for (const it of itensXmp) {
      if (!it.extents) {
        xmp.legivel = false
        continue
      }
      const p = payloadDoItem(b, it)
      if (xmpEhNeutro(p)) continue
      if (xmpEhFuncionalHdr(p)) {
        xmp.funcionais++
        continue
      }
      xmp.comDados = true
      let s = ''
      for (let i = 0; i < p.length; i++) s += String.fromCharCode(p[i])
      if (/GPS(Latitude|Longitude)/.test(s)) xmp.gps = true
    }

    const sinais = []
    if (exif.gps === 'coordenadas' || exif.gps === 'outros_campos' || xmp.gps) sinais.push('gps')
    sinais.push(...exif.sinais)
    if (xmp.comDados) sinais.push('xmp_com_dados')
    if (outrosMeta.length) sinais.push('itens_de_metadado_desconhecidos')

    let classe
    if (!exif.legivel || !xmp.legivel || exif.gps === 'ilegivel' || sinais.includes('exif_ifd_ilegivel')) classe = 'INDETERMINADO'
    if (sinais.includes('gps')) classe = 'GPS'
    else if (!classe) {
      if (sinais.length) classe = 'METADADOS_SENSIVEIS'
      else if (exif.outrasTags) classe = 'METADADOS_NAO_SENSIVEIS'
      else classe = 'LIMPO'
    }

    return {
      estado: 'ok',
      ...base,
      largura: ispe ? ispe.largura : null,
      altura: ispe ? ispe.altura : null,
      rotacao: irot ? irot.graus : 0,
      espelho: imir ? (imir.eixo === 0 ? 'eixo_vertical' : 'eixo_horizontal') : null,
      cor: colr ? colr.cor : null,
      primario,
      itens,
      tipos,
      exif,
      xmp,
      outrosItensDeMetadado: outrosMeta.length,
      temMoov: topo.some((c) => c.tipo === 'moov'),
      temIref: iref.length > 0,
      classe,
      sinais: [...new Set(sinais)],
    }
  } catch (e) {
    return { estado: 'invalido', motivo: e instanceof Invalida ? e.message : 'erro_de_leitura' }
  }
}

// Payload "pulou tudo" (offset aponta para o fim): é o EXIF neutralizado quando o item é pequeno demais.
function payloadExifVazioValido(pl) {
  if (pl.length < 4) return true
  const skip = ((pl[0] << 24) | (pl[1] << 16) | (pl[2] << 8) | pl[3]) >>> 0
  return skip === pl.length - 4 && pl.subarray(4).every((x) => x === 0)
}
