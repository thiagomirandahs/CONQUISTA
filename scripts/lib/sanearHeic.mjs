// PROVA DE CONCEITO: saneamento de HEIC/HEIF SEM recompressão, por NEUTRALIZAÇÃO NO LUGAR.
//
// Ideia: nada é removido nem movido. Os itens `Exif` e `mime` (XMP) continuam existindo, com o MESMO tamanho e no MESMO
// offset, mas o conteúdo vira um EXIF mínimo (no máximo a Orientation) / um XMP vazio preenchido com espaços. Assim
// `iloc`, `iinf`, `mdat`, `meta` e todos os tamanhos de caixa continuam válidos, e os itens de imagem (hvc1, grid, tmap,
// miniaturas) e as propriedades (ispe, irot, imir, colr, hvcC, pixi...) NÃO são tocados: os pixels não são recodificados.
//
// Contrato (nunca lança):
//   { estado: 'saneada', bytes, alterados: [{ item, tipo, ini, len }] }  bytes novos, MESMO tamanho da entrada
//   { estado: 'limpa',   bytes }                                         nada a neutralizar; `bytes` é a própria entrada
//   { estado: 'invalida', bytes: null, motivo }                           truncado/corrompido
//   { estado: 'nao_suportada', bytes: null, motivo }                      marca fora do escopo, AVIF, extent estranho...
// Idempotente: sanear(sanear(x)) devolve 'limpa' com bytes idênticos.
//
// O que EXIGIRIA recompressão/reescrita de offsets (e por isso NÃO é feito aqui): ver HEIC-SANEAMENTO-DESENHO.md
// (remover os itens de verdade encolhe o arquivo e desloca todos os extents do iloc; metadados embutidos DENTRO do
// bitstream HEVC (SEI) ou em itens de imagem auxiliares exigiriam reescrever o bitstream).

import { analisarHeic, payloadDoItem, analisarExif, xmpEhNeutro, xmpEhFuncionalHdr } from './analisarHeic.mjs'

const PREFIXO_EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

// TIFF big-endian com 0 entradas (14 bytes) ou 1 entrada Orientation (26 bytes)
function tiffMinimo(orientacao) {
  const base = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]
  if (!orientacao) return new Uint8Array([...base, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  return new Uint8Array([
    ...base,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientacao & 255, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ])
}

/** Payload neutro do item Exif com exatamente `len` bytes. Determinístico em (len, orientacao). */
export function exifNeutro(len, orientacao) {
  const out = new Uint8Array(len)
  if (len < 4) return out
  for (const o of [orientacao || 0, 0]) {
    const tiff = tiffMinimo(o)
    if (len >= 4 + PREFIXO_EXIF.length + tiff.length) {
      out[3] = PREFIXO_EXIF.length // tiff_header_offset = 6
      out.set(PREFIXO_EXIF, 4)
      out.set(tiff, 4 + PREFIXO_EXIF.length)
      return out
    }
  }
  // pequeno demais para um TIFF: o offset aponta para o fim ("sem EXIF")
  new DataView(out.buffer).setUint32(0, len - 4)
  return out
}

/** Payload neutro do XMP com `len` bytes: pacote vazio + espaços. */
export function xmpNeutro(len) {
  const molde = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'
  const out = new Uint8Array(len).fill(0x20)
  if (len >= molde.length) for (let i = 0; i < molde.length; i++) out[i] = molde.charCodeAt(i)
  return out
}

function espalhar(b, item, novo) {
  let o = 0
  for (const e of item.extents) {
    b.set(novo.subarray(o, o + e.len), e.ini)
    o += e.len
  }
}

function iguais(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function sanearHeic(entrada) {
  try {
    const an = analisarHeic(entrada)
    if (an.estado === 'invalido') return { estado: 'invalida', bytes: null, motivo: an.motivo }
    if (an.estado === 'nao_suportada') return { estado: 'nao_suportada', bytes: null, motivo: an.motivo }

    const alvos = an.itens.filter((i) => i.tipo === 'Exif' || (i.tipo === 'mime' && i.contentType.toLowerCase() === 'application/rdf+xml'))
    if (!alvos.length) return { estado: 'limpa', bytes: entrada }
    if (alvos.some((i) => !i.extents)) return { estado: 'nao_suportada', bytes: null, motivo: 'extent_nao_suportado' }

    // Segurança: o extent de um alvo não pode se sobrepor a nenhum extent de OUTRO item (senão apagaríamos pixels).
    const alvoIds = new Set(alvos.map((a) => a.id))
    const outros = []
    for (const it of an.itens) if (!alvoIds.has(it.id) && it.extents) for (const e of it.extents) outros.push(e)
    for (const a of alvos) {
      for (const e of a.extents) {
        if (outros.some((o) => e.ini < o.ini + o.len && o.ini < e.ini + e.len)) return { estado: 'nao_suportada', bytes: null, motivo: 'extent_compartilhado' }
      }
    }

    const saida = new Uint8Array(entrada) // cópia: a entrada nunca é alterada
    const alterados = []
    for (const it of alvos) {
      const atual = payloadDoItem(entrada, it)
      let novo
      if (it.tipo === 'Exif') novo = exifNeutro(atual.length, analisarExif(atual).orientacao)
      else {
        if (xmpEhNeutro(atual) || xmpEhFuncionalHdr(atual)) continue // vazio, ou só parâmetros do mapa de ganho HDR (preservado)
        novo = xmpNeutro(atual.length)
      }
      if (iguais(atual, novo)) continue
      espalhar(saida, it, novo)
      for (const e of it.extents) alterados.push({ item: it.id, tipo: it.tipo, ini: e.ini, len: e.len })
    }
    if (!alterados.length) return { estado: 'limpa', bytes: entrada }

    // Prova interna: o resultado ainda é um HEIC válido, com os mesmos itens/offsets/dimensões, e sem sinais sensíveis.
    const dep = analisarHeic(saida)
    const mesmo =
      dep.estado === 'ok' &&
      dep.largura === an.largura &&
      dep.altura === an.altura &&
      dep.rotacao === an.rotacao &&
      dep.espelho === an.espelho &&
      dep.itens.length === an.itens.length &&
      dep.itens.every((x, i) => x.id === an.itens[i].id && x.tipo === an.itens[i].tipo && JSON.stringify(x.extents) === JSON.stringify(an.itens[i].extents))
    if (!mesmo) return { estado: 'invalida', bytes: null, motivo: 'verificacao_pos_saneamento_falhou' }
    if (dep.classe !== 'LIMPO') return { estado: 'nao_suportada', bytes: null, motivo: 'metadados_remanescentes' }
    return { estado: 'saneada', bytes: saida, alterados }
  } catch {
    return { estado: 'invalida', bytes: null, motivo: 'erro_inesperado' }
  }
}
