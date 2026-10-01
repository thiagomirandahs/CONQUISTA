// ANALISADOR ISO-BMFF / QuickTime (MP4, MOV, M4V, 3GP) em JavaScript puro — SOMENTE LEITURA, sem dependências.
// Objetivo: dizer se um vídeo carrega metadados de privacidade (localização/GPS, aparelho, software, texto livre, XMP)
// SEM decodificar nada e SEM carregar o `mdat`. Só lê cabeçalhos de caixas de topo e a caixa `moov` inteira.
//
// Entrada: Buffer/Uint8Array (arquivo todo em memória) OU "leitor" { tamanho, ler(offset, n) -> Buffer } (leituras posicionadas).
// Saída: objeto simples. NUNCA lança: entrada truncada/ilegível => { estado: 'invalido', motivo }.
// NUNCA devolve valores sensíveis (coordenadas, nome de aparelho, texto): só presença, categoria e intervalos de bytes.

export const CLASSES = {
  LIMPO: 'LIMPO',
  NAO_SENSIVEL: 'METADADOS NÃO SENSÍVEIS',
  SENSIVEL: 'METADADOS SENSÍVEIS',
  LOCALIZACAO: 'LOCALIZAÇÃO/GPS',
  NAO_SUPORTADO: 'FORMATO NÃO SUPORTADO PELO ANALISADOR',
  INVALIDO: 'INVÁLIDO/TRUNCADO',
}

const MAX_CAIXAS = 200000
const MAX_PROFUNDIDADE = 12
const MAX_MOOV = 256 * 1024 * 1024
const MAX_CAIXA_LIDA = 4 * 1024 * 1024 // meta/udta de topo lidos inteiros só até aqui
const UUID_XMP = Buffer.from('BE7ACFCB97A942E89C71999491E3AFAC', 'hex')
const TOPO_VALIDOS = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot', 'junk', 'moof', 'styp', 'sidx', 'mfra', 'meta', 'uuid', 'udta'])
const MARCAS_HEIC = new Set(['heic', 'heix', 'heif', 'hevc', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs', 'avif', 'avis'])

class ErroMp4 extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo }
}
const falha = (c) => { throw new ErroMp4(c) }
const t4 = (b, o) => b.toString('latin1', o, o + 4)

// ---------- leitores ----------
export function leitorDeBuffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
  return { tamanho: b.length, ler: (o, n) => b.subarray(o, Math.min(o + n, b.length)) }
}
const comoLeitor = (e) => (e && typeof e.ler === 'function' ? e : leitorDeBuffer(e))

// ---------- varredura de caixas ----------
function listarCaixas(b, ini, fim, ctx) {
  const out = []
  let o = ini
  while (o < fim) {
    if (fim - o < 8) {
      if (fim - o === 4 && b.readUInt32BE(o) === 0) break // terminador de 4 zeros do `udta` QuickTime
      falha('caixa_truncada')
    }
    let tam = b.readUInt32BE(o)
    let hdr = 8
    const tipo = t4(b, o + 4)
    if (tam === 1) {
      if (fim - o < 16) falha('caixa_truncada')
      const big = b.readBigUInt64BE(o + 8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) falha('caixa_gigante')
      tam = Number(big); hdr = 16
    } else if (tam === 0) tam = fim - o
    if (tam < hdr || o + tam > fim) falha('caixa_fora_do_limite')
    if (++ctx.n > MAX_CAIXAS) falha('caixas_demais')
    out.push({ tipo, ini: o, tam, hdr, fim: o + tam })
    o += tam
  }
  return out
}

// Caixas de topo por leituras posicionadas (só cabeçalhos; NUNCA lê o payload).
function caixasTopo(leitor) {
  const tam = leitor.tamanho
  const out = []
  let o = 0
  let n = 0
  while (o < tam) {
    const rest = tam - o
    if (rest < 8) {
      if (leitor.ler(o, rest).every((x) => x === 0)) break
      falha('lixo_no_fim')
    }
    const h = leitor.ler(o, Math.min(16, rest))
    let t = h.readUInt32BE(0)
    let hdr = 8
    const tipo = t4(h, 4)
    if (t === 1) {
      if (h.length < 16) falha('caixa_truncada')
      const big = h.readBigUInt64BE(8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) falha('caixa_gigante')
      t = Number(big); hdr = 16
    } else if (t === 0) t = rest
    if (t < hdr) falha('caixa_invalida')
    if (o + t > tam) falha('arquivo_truncado')
    if (++n > MAX_CAIXAS) falha('caixas_demais')
    out.push({ tipo, ini: o, tam: t, hdr, fim: o + t })
    o += t
  }
  return out
}

// ---------- classificação de átomos/chaves (sem valores sensíveis na saída) ----------
const TEXTO_LIVRE = new Set(['\xa9cmt', '\xa9nam', '\xa9ART', '\xa9aut', '\xa9cpy', '\xa9des', '\xa9inf', '\xa9alb', '\xa9grp', '\xa9wrt', '\xa9prd', '\xa9dir', '\xa9req', '\xa9fmt', '\xa9prf', '\xa9src', '\xa9lyr', '\xa9gen', '\xa9cak', '\xa9mvn',
  'cprt', 'titl', 'auth', 'dscp', 'perf', 'albm', 'kywd', 'desc', 'cmt\x20', 'name'])
const ENCODER_SENSIVEL = /android|ios|iphone|ipad|ipados|macos|mac os|darwin|windows|harmony|miui|oneui|samsung|xiaomi|huawei|motorola|oppo|vivo|realme|pixel|apple|galaxy|redmi|sm-[a-z0-9]+/i

export const CATEGORIAS_A_NEUTRALIZAR = new Set(['localizacao', 'aparelho', 'texto', 'xmp', 'identificador'])

function categoriaAtomo(tipo, valorTexto) {
  if (tipo === '\xa9xyz' || tipo === 'loci' || tipo === 'gps ' || tipo === 'GPS ' || tipo === '\xa9loc') return 'localizacao'
  if (tipo === '\xa9mak' || tipo === '\xa9mod' || tipo === '\xa9swr' || tipo === '\xa9sft' || tipo === '\xa9hst') return 'aparelho'
  if (TEXTO_LIVRE.has(tipo)) return 'texto'
  if (tipo === '\xa9day') return 'data'
  if (tipo === '\xa9too') return ENCODER_SENSIVEL.test(valorTexto?.() ?? '') ? 'aparelho' : 'encoder'
  if (tipo === 'XMP_') return 'xmp'
  return null
}

function categoriaChave(chave) {
  const k = chave.replace(/\0+$/g, '').toLowerCase()
  if (!k) return 'vazia'
  if (k.includes('location') || k.includes('gps') || k.includes('iso6709')) return 'localizacao'
  if (/(^|\.)(make|model|software|version|manufacturer|device|hardware|build)(\.|$)/.test(k) || k.includes('android.version') || k.includes('lens')) return 'aparelho'
  if (/maker-?note/.test(k)) return 'aparelho'
  if (/(^|\.)(encoder|te_is_reencode|bitrate|maxrate)$/.test(k)) return 'encoder'
  if (/(^|\.)(content\.identifier|identifier|uuid|serial|unique)/.test(k)) return 'identificador'
  if (/(^|\.)(author|artist|comment|description|title|displayname|copyright|information|album)(\.|$)/.test(k)) return 'texto'
  if (k.includes('creationdate') || k.endsWith('.date') || k.includes('creation')) return 'data'
  return 'desconhecida'
}

// ---------- contexto de análise ----------
function novoCtx(base) {
  return {
    base, n: 0, regioes: [], desconhecidos: {}, trilhas: [], filmes: [],
    flags: { localizacao: 0, aparelho: 0, texto: 0, xmp: 0, identificador: 0, data: 0, encoder: 0, creationTime: false, trilhaLocalizacao: 0, trilhaTelemetria: 0, metaItens: 0 },
    mvhd: null, trak: null, comprimido: false, protegidos: [],
  }
}
const contar = (ctx, tipo) => { const t = tipo.replace(/[^\x20-\x7e\xa9]/g, '?'); ctx.desconhecidos[t] = (ctx.desconhecidos[t] || 0) + 1 }

function regiao(ctx, c, caminho, categoria, extra = {}) {
  ctx.flags[categoria] = (ctx.flags[categoria] || 0) + 1
  ctx.regioes.push({ tipo: c.tipo, categoria, caminho, ini: ctx.base + c.ini, fim: ctx.base + c.fim, hdr: c.hdr, acao: 'free', opcional: categoria === 'data', ...extra })
}
function regiaoDatas(ctx, tipo, caminho, ini, fim) {
  ctx.regioes.push({ tipo, categoria: 'data', caminho, ini: ctx.base + ini, fim: ctx.base + fim, hdr: 0, acao: 'zerar', opcional: true })
}

function lerVersaoTempos(b, p, ctx, tipo, caminho) {
  // mvhd/mdhd: [ver/flags 4][ctime][mtime][timescale 4][duration]; tkhd: [ver/flags 4][ctime][mtime][track id 4]...
  const v = b[p]
  const larg = v === 1 ? 8 : 4
  const ct = v === 1 ? b.readBigUInt64BE(p + 4) : BigInt(b.readUInt32BE(p + 4))
  const mt = v === 1 ? b.readBigUInt64BE(p + 4 + larg) : BigInt(b.readUInt32BE(p + 4 + larg))
  if (ct !== 0n || mt !== 0n) ctx.flags.creationTime = true
  regiaoDatas(ctx, tipo, caminho, p + 4, p + 4 + 2 * larg)
  return { v, larg }
}

// ---------- meta (QuickTime mdta/keys/ilst e ISO mdir) ----------
function tratarMeta(b, c, caminho, ctx, prof) {
  const p = c.ini + c.hdr
  if (c.fim - p < 8) return
  let ini
  if (t4(b, p + 4) === 'hdlr') ini = p // QuickTime: meta é caixa simples
  else ini = p + 4 // ISO: meta é "full box" (versão/flags)
  const filhos = listarCaixas(b, ini, c.fim, ctx)
  let handler = ''
  const chaves = []
  for (const f of filhos) {
    if (f.tipo === 'hdlr' && f.fim - f.ini >= f.hdr + 12) handler = t4(b, f.ini + f.hdr + 8)
    else if (f.tipo === 'keys') {
      let o = f.ini + f.hdr + 8
      const n = b.readUInt32BE(f.ini + f.hdr + 4)
      if (n > 100000) falha('keys_demais')
      for (let i = 0; i < n; i++) {
        if (o + 8 > f.fim) falha('keys_truncada')
        const ks = b.readUInt32BE(o)
        if (ks < 8 || o + ks > f.fim) falha('keys_invalida')
        chaves.push({ ns: t4(b, o + 4), texto: b.toString('utf8', o + 8, o + ks), ini: o + 8, fim: o + ks, zerada: false })
        o += ks
      }
    }
  }
  const chavesSensiveis = new Set()
  for (const f of filhos) {
    if (f.tipo === 'ilst') {
      for (const it of listarCaixas(b, f.ini + f.hdr, f.fim, ctx)) {
        if (it.tipo === 'free' || it.tipo === 'skip' || it.tipo === 'wide') continue
        ctx.flags.metaItens++
        let cat = null
        let idx = -1
        if (handler === 'mdta') {
          idx = b.readUInt32BE(it.ini + 4) - 1
          const k = chaves[idx]
          cat = k ? categoriaChave(k.texto) : 'desconhecida'
        } else {
          const dado = () => {
            const d = listarCaixas(b, it.ini + it.hdr, it.fim, ctx).find((x) => x.tipo === 'data')
            return d ? b.toString('latin1', d.ini + d.hdr + 8, d.fim) : ''
          }
          cat = categoriaAtomo(it.tipo, dado) || 'desconhecida'
        }
        if (cat === 'vazia') continue
        if (cat === 'desconhecida') { contar(ctx, `ilst:${handler === 'mdta' ? 'mdta' : it.tipo}`); continue }
        if (cat === 'encoder') { ctx.flags.encoder++; continue }
        regiao(ctx, it, `${caminho}/ilst`, cat)
        if (handler === 'mdta' && cat !== 'data' && chaves[idx]) chavesSensiveis.add(idx)
      }
    } else if (f.tipo !== 'hdlr' && f.tipo !== 'keys' && f.tipo !== 'free' && f.tipo !== 'skip') contar(ctx, `meta:${f.tipo}`)
  }
  // chaves sensíveis sem item correspondente também são neutralizadas (a chave em si nomeia "location"/"model"…)
  chaves.forEach((k, i) => {
    const cat = categoriaChave(k.texto)
    if (CATEGORIAS_A_NEUTRALIZAR.has(cat)) {
      if (!chavesSensiveis.has(i) && handler === 'mdta') {
        ctx.flags[cat] = (ctx.flags[cat] || 0) + 1
      }
      ctx.regioes.push({ tipo: 'keys', categoria: cat, caminho: `${caminho}/keys`, ini: ctx.base + k.ini, fim: ctx.base + k.fim, hdr: 0, acao: 'zerar', opcional: false })
    }
  })
  void prof
}

function tratarUuid(b, c, caminho, ctx) {
  if (c.fim - c.ini >= c.hdr + 16 && b.subarray(c.ini + c.hdr, c.ini + c.hdr + 16).equals(UUID_XMP)) regiao(ctx, c, caminho, 'xmp')
  else contar(ctx, 'uuid')
}

function tratarUdta(b, c, caminho, ctx, prof) {
  for (const f of listarCaixas(b, c.ini + c.hdr, c.fim, ctx)) {
    const p = f.ini + f.hdr
    if (f.tipo === 'meta') { tratarMeta(b, f, `${caminho}/meta`, ctx, prof + 1); continue }
    if (f.tipo === 'uuid') { tratarUuid(b, f, caminho, ctx); continue }
    if (f.tipo === 'free' || f.tipo === 'skip' || f.tipo === 'wide' || f.tipo === '\0\0\0\0') continue // free e preenchimento de zeros
    const cat = categoriaAtomo(f.tipo, () => b.toString('utf8', Math.min(p + 4, f.fim), f.fim))
    if (cat === 'encoder') ctx.flags.encoder++
    else if (cat) regiao(ctx, f, caminho, cat)
    else contar(ctx, `udta:${f.tipo}`)
  }
}

function tratarStsd(b, c, trak, ctx) {
  const p = c.ini + c.hdr
  if (c.fim - p < 8) falha('stsd_curto')
  const n = b.readUInt32BE(p + 4)
  const entradas = n === 0 ? [] : listarCaixas(b, p + 8, c.fim, ctx)
  for (const e of entradas) {
    trak.codecs.push(e.tipo)
    // trilhas de metadados (mebx) declaram as chaves no próprio stsd; dados de localização em trilha ficam no mdat
    const txt = b.toString('latin1', e.ini, e.fim)
    if (/quicktime\.location|iso6709/i.test(txt)) trak.localizacaoEmTrilha = true
    if (['gpmd', 'camm', 'gps '].includes(e.tipo)) trak.telemetria = true
  }
}

function tratarTrak(b, c, caminho, ctx, prof) {
  const trak = { handler: '', codecs: [], largura: 0, altura: 0, rotacao: 0, duracaoTkhd: 0, tabelas: {}, localizacaoEmTrilha: false, telemetria: false }
  const anterior = ctx.trak
  ctx.trak = trak
  visitarFilhos(b, c.ini + c.hdr, c.fim, caminho, ctx, prof + 1)
  ctx.trak = anterior
  if (trak.localizacaoEmTrilha) ctx.flags.trilhaLocalizacao++
  if (trak.telemetria) ctx.flags.trilhaTelemetria++
  ctx.trilhas.push(trak)
}

function visitarCaixa(b, c, caminho, ctx, prof) {
  const p = c.ini + c.hdr
  const aqui = `${caminho}/${c.tipo}`
  const trak = ctx.trak
  switch (c.tipo) {
    case 'moov': case 'mdia': case 'minf': case 'stbl':
      if (c.tipo === 'stbl') ctx.protegidos.push({ tipo: 'stbl', ini: ctx.base + c.ini, fim: ctx.base + c.fim })
      visitarFilhos(b, p, c.fim, aqui, ctx, prof + 1); break
    case 'cmov': ctx.comprimido = true; break
    case 'mvhd': {
      const { v, larg } = lerVersaoTempos(b, p, ctx, 'mvhd', aqui)
      const ts = b.readUInt32BE(p + 4 + 2 * larg)
      const dur = v === 1 ? Number(b.readBigUInt64BE(p + 8 + 2 * larg)) : b.readUInt32BE(p + 8 + 2 * larg)
      ctx.mvhd = { timescale: ts, duracao: ts ? dur / ts : 0 }
      break
    }
    case 'trak': tratarTrak(b, c, aqui, ctx, prof); break
    case 'tkhd': {
      if (!trak) break
      const { v } = lerVersaoTempos(b, p, ctx, 'tkhd', aqui)
      const m = p + (v === 1 ? 52 : 40)
      const w = b.readUInt32BE(m + 36) / 65536
      const h = b.readUInt32BE(m + 40) / 65536
      const a = b.readInt32BE(m) / 65536
      const bb = b.readInt32BE(m + 4) / 65536
      trak.largura = Math.round(w); trak.altura = Math.round(h)
      trak.rotacao = (((Math.round((Math.atan2(bb, a) * 180) / Math.PI)) % 360) + 360) % 360
      break
    }
    case 'mdhd': if (trak) lerVersaoTempos(b, p, ctx, 'mdhd', aqui); break
    case 'hdlr': if (trak && caminho.endsWith('/mdia') && c.fim - p >= 12) trak.handler = t4(b, p + 8); break
    case 'stsd': if (trak) tratarStsd(b, c, trak, ctx); break
    case 'stco': case 'co64': case 'stsz': case 'stsc': if (trak) trak.tabelas[c.tipo] = { ini: c.ini, fim: c.fim, hdr: c.hdr }; break
    case 'udta': tratarUdta(b, c, aqui, ctx, prof); break
    case 'meta': tratarMeta(b, c, aqui, ctx, prof); break
    case 'uuid': tratarUuid(b, c, aqui, ctx); break
    case 'XMP_': regiao(ctx, c, aqui, 'xmp'); break
    case 'edts': case 'free': case 'skip': case 'wide': case 'iods': case 'mvex': case 'dinf': case 'stts': case 'stss': case 'ctts': case 'stps':
    case 'sdtp': case 'sgpd': case 'sbgp': case 'smhd': case 'vmhd': case 'gmhd': case 'nmhd': case 'hmhd': case 'sthd': case 'tref': case 'trak\0': case 'sidx': case 'subs':
    case 'senc': case 'saiz': case 'saio': case 'cslg': case 'elst': case 'prft': case 'tapt': case 'load': case 'clef': case 'prof': case 'enof':
      break
    default: contar(ctx, c.tipo)
  }
}

function visitarFilhos(b, ini, fim, caminho, ctx, prof) {
  if (prof > MAX_PROFUNDIDADE) falha('aninhamento_demais')
  for (const c of listarCaixas(b, ini, fim, ctx)) visitarCaixa(b, c, caminho, ctx, prof)
}

// ---------- conferência estrutural de offsets (stco/co64 x stsz x stsc x mdat) ----------
function conferirOffsets(b, trilhas, mdats) {
  let totalChunks = 0
  for (const t of trilhas) {
    const { stco, co64, stsz, stsc } = t.tabelas
    const tabOff = stco || co64
    if (!tabOff || !stsz || !stsc) { if (tabOff || stsz || stsc) return { ok: false, motivo: 'tabelas_incompletas' }; continue }
    const big = !!co64 && !stco
    const po = tabOff.ini + tabOff.hdr
    const nChunks = b.readUInt32BE(po + 4)
    if (po + 8 + nChunks * (big ? 8 : 4) > tabOff.fim) return { ok: false, motivo: 'offsets_truncados' }
    const ps = stsz.ini + stsz.hdr
    const tamConst = b.readUInt32BE(ps + 4)
    const nSamples = b.readUInt32BE(ps + 8)
    if (tamConst === 0 && ps + 12 + nSamples * 4 > stsz.fim) return { ok: false, motivo: 'stsz_truncado' }
    const pc = stsc.ini + stsc.hdr
    const nRuns = b.readUInt32BE(pc + 4)
    if (pc + 8 + nRuns * 12 > stsc.fim) return { ok: false, motivo: 'stsc_truncado' }
    const runs = []
    for (let i = 0; i < nRuns; i++) runs.push({ primeiro: b.readUInt32BE(pc + 8 + i * 12), por: b.readUInt32BE(pc + 12 + i * 12) })
    let amostra = 0
    let r = 0
    for (let ch = 1; ch <= nChunks; ch++) {
      while (r + 1 < runs.length && runs[r + 1].primeiro <= ch) r++
      const por = runs.length ? runs[r].por : 0
      let tam = 0
      for (let k = 0; k < por; k++, amostra++) {
        if (amostra >= nSamples) return { ok: false, motivo: 'amostras_insuficientes' }
        tam += tamConst || b.readUInt32BE(ps + 12 + amostra * 4)
      }
      const off = big ? Number(b.readBigUInt64BE(po + 8 + (ch - 1) * 8)) : b.readUInt32BE(po + 8 + (ch - 1) * 4)
      if (!mdats.some(([i, f]) => off >= i && off + tam <= f)) return { ok: false, motivo: 'chunk_fora_do_mdat' }
    }
    totalChunks += nChunks
  }
  return { ok: true, chunks: totalChunks }
}

// ---------- análise do moov (buffer = bytes da caixa moov; base = posição dela no arquivo) ----------
export function analisarMoov(moovBuf, { base = 0, mdats = null } = {}) {
  try {
    const b = Buffer.isBuffer(moovBuf) ? moovBuf : Buffer.from(moovBuf)
    const ctx = novoCtx(base)
    const caixas = listarCaixas(b, 0, b.length, ctx)
    if (caixas.length !== 1 || caixas[0].tipo !== 'moov') falha('nao_e_moov')
    visitarCaixa(b, caixas[0], '', ctx, 0)
    return finalizar(ctx, b, mdats)
  } catch (e) {
    return { estado: 'invalido', motivo: e instanceof ErroMp4 ? e.codigo : 'erro_inesperado' }
  }
}

function finalizar(ctx, b, mdats) {
  const video = ctx.trilhas.find((t) => t.handler === 'vide' && t.largura > 0) || ctx.trilhas.find((t) => t.handler === 'vide')
  const res = {
    estado: 'ok',
    duracao: ctx.mvhd?.duracao ?? 0,
    largura: video?.largura ?? 0, altura: video?.altura ?? 0, rotacao: video?.rotacao ?? 0,
    codecsVideo: ctx.trilhas.filter((t) => t.handler === 'vide').flatMap((t) => t.codecs),
    codecsAudio: ctx.trilhas.filter((t) => t.handler === 'soun').flatMap((t) => t.codecs),
    outrasTrilhas: ctx.trilhas.filter((t) => t.handler !== 'vide' && t.handler !== 'soun').map((t) => t.handler || '?'),
    nTrilhas: ctx.trilhas.length,
    temCreationTime: ctx.flags.creationTime || ctx.flags.data > 0,
    temLocalizacao: ctx.flags.localizacao > 0 || ctx.flags.trilhaLocalizacao > 0,
    temLocalizacaoEmTrilha: ctx.flags.trilhaLocalizacao > 0,
    temTelemetriaEmTrilha: ctx.flags.trilhaTelemetria > 0,
    temAparelho: ctx.flags.aparelho > 0,
    temTextoLivre: ctx.flags.texto > 0,
    temXmp: ctx.flags.xmp > 0,
    temIdentificador: ctx.flags.identificador > 0,
    temEncoder: ctx.flags.encoder > 0,
    desconhecidos: ctx.desconhecidos,
    comprimido: ctx.comprimido,
    regioes: ctx.regioes,
    protegidos: ctx.protegidos,
  }
  if (mdats) res.offsets = conferirOffsets(b, ctx.trilhas, mdats)
  return res
}

export function classificar(a) {
  if (a.estado === 'nao_suportado') return CLASSES.NAO_SUPORTADO
  if (a.estado !== 'ok') return CLASSES.INVALIDO
  if (a.temLocalizacao || a.temTelemetriaEmTrilha) return CLASSES.LOCALIZACAO
  if (a.temAparelho || a.temTextoLivre || a.temXmp || a.temIdentificador) return CLASSES.SENSIVEL
  if (a.temCreationTime || a.temEncoder || Object.keys(a.desconhecidos).length) return CLASSES.NAO_SENSIVEL
  return CLASSES.LIMPO
}

// ---------- análise do arquivo (leitor posicionado; nunca carrega mdat) ----------
export function analisarMp4(entrada, { conferirOffsets: conferir = false } = {}) {
  try {
    const leitor = comoLeitor(entrada)
    if (!leitor || !(leitor.tamanho >= 8)) return { estado: 'invalido', motivo: 'muito_curto', tamanho: leitor?.tamanho ?? 0 }
    const cab = leitor.ler(0, 12)
    if (cab[0] === 0x1a && cab[1] === 0x45 && cab[2] === 0xdf && cab[3] === 0xa3) return { estado: 'nao_suportado', formato: 'matroska/webm', tamanho: leitor.tamanho }
    const primeiro = t4(cab, 4)
    if (!TOPO_VALIDOS.has(primeiro)) return { estado: 'invalido', motivo: 'assinatura_desconhecida', tamanho: leitor.tamanho }
    const topo = caixasTopo(leitor)
    const ftyp = topo.find((c) => c.tipo === 'ftyp')
    let marca = ''
    const compat = []
    if (ftyp) {
      const f = leitor.ler(ftyp.ini + ftyp.hdr, Math.min(ftyp.tam - ftyp.hdr, 256))
      marca = t4(f, 0)
      for (let i = 8; i + 4 <= f.length; i += 4) compat.push(t4(f, i))
      if (MARCAS_HEIC.has(marca.toLowerCase())) return { estado: 'nao_suportado', formato: 'imagem_heif', tamanho: leitor.tamanho }
    }
    const moovs = topo.filter((c) => c.tipo === 'moov')
    if (moovs.length !== 1) return { estado: 'invalido', motivo: moovs.length ? 'varios_moov' : 'sem_moov', tamanho: leitor.tamanho }
    const moov = moovs[0]
    if (moov.tam > MAX_MOOV) return { estado: 'invalido', motivo: 'moov_gigante', tamanho: leitor.tamanho }
    const mdatsCaixas = topo.filter((c) => c.tipo === 'mdat')
    const mdats = mdatsCaixas.map((c) => [c.ini + c.hdr, c.fim])
    const b = leitor.ler(moov.ini, moov.tam)
    if (b.length !== moov.tam) return { estado: 'invalido', motivo: 'moov_ilegivel', tamanho: leitor.tamanho }
    const r = analisarMoov(b, { base: moov.ini, mdats: conferir ? mdats : null })
    if (r.estado !== 'ok') return { ...r, tamanho: leitor.tamanho }
    if (r.comprimido) return { estado: 'nao_suportado', formato: 'moov_comprimido', tamanho: leitor.tamanho }
    // caixas de metadados fora do moov
    const ctxTopo = novoCtx(0)
    const desconhecidosTopo = {}
    for (const c of topo) {
      if (c.tipo === 'uuid' || c.tipo === 'XMP_') {
        const lido = leitor.ler(c.ini, Math.min(c.tam, 32))
        ctxTopo.base = c.ini
        const copia = { ...c, ini: 0, fim: c.tam }
        if (c.tipo === 'XMP_') regiao(ctxTopo, copia, '', 'xmp')
        else if (lido.length >= c.hdr + 16 && lido.subarray(c.hdr, c.hdr + 16).equals(UUID_XMP)) regiao(ctxTopo, copia, '', 'xmp')
        else desconhecidosTopo.uuid = (desconhecidosTopo.uuid || 0) + 1
      } else if (c.tipo === 'meta' || c.tipo === 'udta') {
        if (c.tam <= MAX_CAIXA_LIDA) {
          const bb = leitor.ler(c.ini, c.tam)
          const ctx2 = novoCtx(c.ini)
          visitarCaixa(bb, { ...c, ini: 0, fim: c.tam }, '', ctx2, 0)
          ctxTopo.regioes.push(...ctx2.regioes)
          for (const k of Object.keys(ctx2.flags)) if (typeof ctx2.flags[k] === 'number') ctxTopo.flags[k] += ctx2.flags[k]
          for (const [k, v] of Object.entries(ctx2.desconhecidos)) desconhecidosTopo[k] = (desconhecidosTopo[k] || 0) + v
        } else desconhecidosTopo[`${c.tipo}_grande`] = 1
      } else if (!['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'junk', 'moof', 'styp', 'sidx', 'mfra'].includes(c.tipo)) {
        desconhecidosTopo[c.tipo] = (desconhecidosTopo[c.tipo] || 0) + 1
      }
    }
    for (const c of mdatsCaixas) r.protegidos.push({ tipo: 'mdat', ini: c.ini, fim: c.fim })
    for (const reg of ctxTopo.regioes) r.regioes.push({ ...reg, escopo: 'topo' })
    for (const reg of r.regioes) reg.escopo ??= 'moov'
    for (const [k, v] of Object.entries(desconhecidosTopo)) r.desconhecidos[`topo:${k}`] = v
    if (ctxTopo.flags.localizacao) { r.temLocalizacao = true }
    if (ctxTopo.flags.aparelho) r.temAparelho = true
    if (ctxTopo.flags.texto) r.temTextoLivre = true
    if (ctxTopo.flags.xmp) r.temXmp = true
    if (ctxTopo.flags.identificador) r.temIdentificador = true
    const iMoov = moov.ini
    const primeiroMdat = mdatsCaixas[0]
    const out = {
      ...r,
      tamanho: leitor.tamanho,
      marca,
      marcasCompativeis: compat,
      container: marca === 'qt  ' ? 'mov' : marca ? 'mp4' : 'mov',
      moov: { ini: iMoov, tam: moov.tam, posicao: !primeiroMdat ? 'sem_mdat' : iMoov < primeiroMdat.ini ? 'inicio' : 'fim' },
      faststart: !!primeiroMdat && iMoov < primeiroMdat.ini,
      fragmentado: topo.some((c) => c.tipo === 'moof'),
      mdat: { quantidade: mdatsCaixas.length, bytes: mdatsCaixas.reduce((s, c) => s + c.tam, 0), maiorQue4GB: mdatsCaixas.some((c) => c.tam > 0xffffffff) },
      topo: topo.map((c) => ({ tipo: c.tipo, ini: c.ini, tam: c.tam, hdr: c.hdr })),
    }
    out.classe = classificar(out)
    return out
  } catch (e) {
    return { estado: 'invalido', motivo: e instanceof ErroMp4 ? e.codigo : 'erro_inesperado' }
  }
}
