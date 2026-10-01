// @vitest-environment node
// Privacidade de HEIC: analisador (scripts/lib/analisarHeic.mjs) + saneador SEM recompressão (scripts/lib/sanearHeic.mjs).
// Fixtures SINTÉTICAS (src/lib/heicFixtures.js). Os testes com arquivos reais lêem o backup LOCAL em memória, não gravam,
// não copiam e não imprimem nada; PULAM quando os arquivos não existem na máquina.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { analisarHeic, analisarExif, payloadDoItem } from '../../scripts/lib/analisarHeic.mjs'
import { sanearHeic, exifNeutro, xmpNeutro } from '../../scripts/lib/sanearHeic.mjs'
import { montarHeic, exifPayload, payloadHvc1, intervalosDiferentes, dentroDosExtents, contem, XMP_SENSIVEL, XMP_GPS, XMP_HDR } from './heicFixtures.js'

const EXIF_COMPLETO = { orientacao: 6, fabricante: 'MARCA-SECRETA', modelo: 'MODELO-SECRETO', data: '2026:09:30 10:11:12', dataOriginal: '2026:09:30 10:11:12', makerNote: 'NOTA-DO-FABRICANTE', gps: true }
const iguais = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0
const bytesDe = (b, e) => b.subarray(e.ini, e.ini + e.len)

describe('analisarHeic — fixtures sintéticas', () => {
  it('lê marca, dimensões, rotação, itens e detecta GPS sem devolver valores', () => {
    const f = montarHeic({ exif: exifPayload(EXIF_COMPLETO), irot: 1, imir: 0, largura: 4000, altura: 3000 })
    const a = analisarHeic(f.bytes)
    expect(a.estado).toBe('ok')
    expect(a.marca).toBe('heic')
    expect(a.largura).toBe(4000)
    expect(a.altura).toBe(3000)
    expect(a.rotacao).toBe(90)
    expect(a.espelho).toBe('eixo_vertical')
    expect(a.tipos).toEqual({ hvc1: 1, Exif: 1 })
    expect(a.exif).toMatchObject({ presente: true, tiffValido: true, orientacao: 6, gps: 'coordenadas' })
    expect(a.sinais).toEqual(expect.arrayContaining(['gps', 'fabricante', 'modelo', 'data_hora', 'data_original', 'makernote']))
    expect(a.classe).toBe('GPS')
    expect(JSON.stringify(a)).not.toMatch(/SECRET|2026:09/) // nenhum valor vaza no resultado
  })

  it('classes: LIMPO, NAO_SENSIVEIS, SENSIVEIS, GPS', () => {
    expect(analisarHeic(montarHeic().bytes).classe).toBe('LIMPO') // sem EXIF
    expect(analisarHeic(montarHeic({ exif: exifPayload({ orientacao: 6 }) }).bytes).classe).toBe('LIMPO') // só Orientation
    expect(analisarHeic(montarHeic({ exif: exifPayload({ orientacao: 6, fabricante: 'X' }) }).bytes).classe).toBe('METADADOS_SENSIVEIS')
    expect(analisarHeic(montarHeic({ exif: exifPayload({ orientacao: 6, gps: true }) }).bytes).classe).toBe('GPS')
    expect(analisarHeic(montarHeic({ exif: exifPayload({ dataOriginal: '2026:01:01 00:00:00' }) }).bytes).classe).toBe('METADADOS_SENSIVEIS')
    expect(analisarHeic(montarHeic({ xmp: XMP_SENSIVEL }).bytes).classe).toBe('METADADOS_SENSIVEIS')
    expect(analisarHeic(montarHeic({ xmp: XMP_GPS }).bytes).classe).toBe('GPS')
    expect(analisarHeic(montarHeic({ xmp: XMP_HDR }).bytes).classe).toBe('LIMPO') // XMP funcional (HDR) não é dado pessoal
  })

  it('TIFF little-endian e big-endian', () => {
    for (const le of [true, false]) {
      const a = analisarHeic(montarHeic({ exif: exifPayload({ le, gps: true, orientacao: 3 }) }).bytes)
      expect(a.exif.gps).toBe('coordenadas')
      expect(a.exif.orientacao).toBe(3)
    }
  })

  it.each([
    ['iloc v0', { versaoIloc: 0 }],
    ['iloc v1', { versaoIloc: 1 }],
    ['iloc v2 (+infe v3)', { versaoIloc: 2 }],
    ['iloc v1 com base_offset', { versaoIloc: 1, usarBase: true }],
    ['iloc com 2 extents (Exif partido)', { versaoIloc: 1, extentsExif: 2 }],
    ['iloc v2 com 2 extents e base_offset', { versaoIloc: 2, extentsExif: 2, usarBase: true }],
    ['construction_method 1 (Exif na idat)', { versaoIloc: 1, exifNoIdat: true }],
    ['ipma com índices de 16 bits', { ipmaFlag1: true }],
  ])('localiza o Exif pelos extents: %s', (_nome, extra) => {
    const f = montarHeic({ exif: exifPayload(EXIF_COMPLETO), irot: 1, ...extra })
    const a = analisarHeic(f.bytes)
    expect(a.estado).toBe('ok')
    const it = a.itens.find((x) => x.tipo === 'Exif')
    expect(it.extents).toEqual(f.extentsExif)
    expect(a.exif.gps).toBe('coordenadas')
    expect(a.rotacao).toBe(90)
  })

  it('localiza itens mime: XMP (rdf+xml) separado de outros mime', () => {
    const f = montarHeic({ xmp: [XMP_SENSIVEL], mimeOutro: 'qualquer-coisa' })
    const a = analisarHeic(f.bytes)
    expect(a.xmp).toMatchObject({ presente: true, itens: 1, comDados: true })
    expect(a.outrosItensDeMetadado).toBe(1)
    expect(a.sinais).toContain('itens_de_metadado_desconhecidos')
  })

  it('marca desconhecida/AVIF/vídeo => nao_suportada; sem exceção', () => {
    expect(analisarHeic(montarHeic({ marca: 'abcd', compat: ['abcd'] }).bytes).estado).toBe('nao_suportada')
    expect(analisarHeic(montarHeic({ marca: 'mp42', compat: ['isom', 'mp42'] }).bytes)).toMatchObject({ estado: 'nao_suportada', motivo: 'marca_desconhecida' })
    expect(analisarHeic(montarHeic({ marca: 'avif', compat: ['mif1', 'avif'] }).bytes)).toMatchObject({ estado: 'nao_suportada', motivo: 'avif' })
    expect(analisarHeic(montarHeic({ marca: 'mif1', compat: ['heic'] }).bytes).estado).toBe('ok') // marca principal genérica, compatível heic
  })

  it('entrada inválida/truncada nunca lança e devolve invalido', () => {
    const f = montarHeic({ exif: exifPayload(EXIF_COMPLETO), irot: 1 }).bytes
    for (let n = 0; n < f.length; n += 1 + (n < 200 ? 0 : 13)) {
      const a = analisarHeic(f.subarray(0, n))
      expect(a.estado).toBe('invalido')
    }
    for (const lixo of [new Uint8Array(0), new Uint8Array(10), new Uint8Array(64).fill(0xff), Buffer.from('não sou imagem nenhuma, só texto comprido o bastante'), null, undefined, 'texto', 42]) {
      expect(analisarHeic(lixo).estado).toBe('invalido')
    }
  })

  it('bytes aleatórios nas caixas (fuzz determinístico) nunca lançam', () => {
    const base = montarHeic({ exif: exifPayload(EXIF_COMPLETO), xmp: XMP_SENSIVEL, irot: 1, versaoIloc: 1 })
    let s = 12345
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff)
    for (let i = 0; i < 400; i++) {
      const b = new Uint8Array(base.bytes)
      for (let k = 0; k < 1 + (i % 4); k++) b[rnd() % base.tamanhoFtypMeta] = rnd() & 255
      const a = analisarHeic(b)
      expect(['ok', 'invalido', 'nao_suportada']).toContain(a.estado)
      const r = sanearHeic(b)
      expect(['saneada', 'limpa', 'invalida', 'nao_suportada']).toContain(r.estado)
      if (r.estado === 'saneada') expect(r.bytes.length).toBe(b.length)
    }
  })
})

describe('sanearHeic — neutralização no lugar (sem recompressão)', () => {
  const casos = [
    ['v0, 1 extent', { versaoIloc: 0 }],
    ['v1', { versaoIloc: 1 }],
    ['v2', { versaoIloc: 2 }],
    ['v1 + base_offset', { versaoIloc: 1, usarBase: true }],
    ['2 extents', { versaoIloc: 1, extentsExif: 2 }],
    ['v2, 2 extents, base_offset', { versaoIloc: 2, extentsExif: 2, usarBase: true }],
    ['Exif na idat (método 1)', { versaoIloc: 1, exifNoIdat: true }],
  ]

  it.each(casos)('GPS e dados sensíveis somem; resto idêntico; mesmo tamanho: %s', (_n, extra) => {
    const f = montarHeic({ exif: exifPayload(EXIF_COMPLETO), irot: 1, imir: 1, largura: 4032, altura: 3024, ...extra })
    const copiaEntrada = new Uint8Array(f.bytes)
    expect(contem(f.bytes, 'MARCA-SECRETA')).toBe(true) // sanidade da fixture

    const r = sanearHeic(f.bytes)
    expect(r.estado).toBe('saneada')
    expect(r.bytes.length).toBe(f.bytes.length)
    expect(iguais(f.bytes, copiaEntrada)).toBe(true) // a entrada não é alterada
    for (const segredo of ['MARCA-SECRETA', 'MODELO-SECRETO', 'NOTA-DO-FABRICANTE', '2026:09:30']) expect(contem(r.bytes, segredo)).toBe(false)

    // só a região do Exif mudou
    const dif = intervalosDiferentes(f.bytes, r.bytes)
    expect(dif.length).toBeGreaterThan(0)
    expect(dentroDosExtents(dif, f.extentsExif)).toBe(true)
    // hvc1 intacto
    for (const e of f.extentsHvc1) expect(iguais(bytesDe(f.bytes, e), bytesDe(r.bytes, e))).toBe(true)
    expect(iguais(bytesDe(r.bytes, f.extentsHvc1[0]), payloadHvc1(200))).toBe(true)
    // cabeçalho (ftyp+meta, com iloc/iinf/ispe/irot/imir/colr) intacto — exceto quando o Exif mora na idat (dentro da meta)
    if (!extra.exifNoIdat) expect(iguais(f.bytes.subarray(0, f.tamanhoFtypMeta), r.bytes.subarray(0, f.tamanhoFtypMeta))).toBe(true)

    // o analisador, aplicado ao resultado
    const a0 = analisarHeic(f.bytes)
    const a1 = analisarHeic(r.bytes)
    expect(a1.estado).toBe('ok')
    expect(a1.classe).toBe('LIMPO')
    expect(a1.exif.gps).toBe('ausente')
    expect(a1.sinais).toEqual([])
    expect([a1.largura, a1.altura, a1.rotacao, a1.espelho, a1.marca]).toEqual([a0.largura, a0.altura, a0.rotacao, a0.espelho, a0.marca])
    expect(a1.tipos).toEqual(a0.tipos)
    expect(JSON.stringify(a1.itens)).toBe(JSON.stringify(a0.itens)) // ids, tipos e extents idênticos
    expect(a1.exif.orientacao).toBe(6) // Orientation preservada

    // idempotência
    const r2 = sanearHeic(r.bytes)
    expect(r2.estado).toBe('limpa')
    expect(iguais(r2.bytes, r.bytes)).toBe(true)
  })

  it('só Orientation (já limpo) => limpa, devolve a própria entrada', () => {
    const f = montarHeic({ exif: exifPayload({ orientacao: 6 }) })
    const r = sanearHeic(f.bytes)
    expect(r.estado).toBe('limpa')
    expect(r.bytes).toBe(f.bytes)
  })

  it('sem Exif nem XMP => limpa', () => {
    const f = montarHeic({ irot: 2 })
    expect(sanearHeic(f.bytes).estado).toBe('limpa')
  })

  it('o EXIF neutro tem o tamanho exato, é um TIFF válido e não carrega nada além da Orientation', () => {
    for (const len of [0, 3, 4, 10, 23, 24, 35, 36, 37, 700]) {
      for (const o of [0, 6]) {
        const n = exifNeutro(len, o)
        expect(n.length).toBe(len)
        const a = analisarExif(n)
        expect(a.sinais).toEqual([])
        expect(a.gps).toBe('ausente')
        expect(a.outrasTags).toBe(false)
        if (len >= 36 && o) expect(a.orientacao).toBe(o)
      }
    }
    expect(xmpNeutro(100).length).toBe(100)
    expect(xmpNeutro(5).length).toBe(5)
  })

  it('Exif minúsculo (menor que um TIFF) é neutralizado com "offset até o fim"', () => {
    const f = montarHeic({ exif: Uint8Array.from([0, 0, 0, 2, 0x41, 0x42, 0x43, 0x44]) }) // 8 bytes qualquer
    const r = sanearHeic(f.bytes)
    expect(r.estado).toBe('saneada')
    expect(r.bytes.length).toBe(f.bytes.length)
    expect(contem(r.bytes, 'ABCD')).toBe(false)
    expect(sanearHeic(r.bytes).estado).toBe('limpa')
  })

  it('XMP com dados vira pacote vazio + espaços, mesmo tamanho; só o XMP muda', () => {
    const f = montarHeic({ exif: exifPayload({ orientacao: 6 }), xmp: [XMP_SENSIVEL, XMP_GPS] })
    const r = sanearHeic(f.bytes)
    expect(r.estado).toBe('saneada')
    expect(contem(r.bytes, 'AUTOR-SECRETO')).toBe(false)
    expect(contem(r.bytes, 'GPSLatitude')).toBe(false)
    expect(dentroDosExtents(intervalosDiferentes(f.bytes, r.bytes), f.extentsXmp)).toBe(true)
    const a = analisarHeic(r.bytes)
    expect(a.xmp.comDados).toBe(false)
    expect(a.classe).toBe('LIMPO')
    expect(sanearHeic(r.bytes).estado).toBe('limpa')
  })

  it('XMP funcional do mapa de ganho HDR é PRESERVADO (byte a byte); outro XMP junto é neutralizado', () => {
    const f = montarHeic({ xmp: [XMP_HDR, XMP_SENSIVEL] })
    const r = sanearHeic(f.bytes)
    expect(r.estado).toBe('saneada')
    expect(iguais(bytesDe(r.bytes, f.extentsXmp[0]), bytesDe(f.bytes, f.extentsXmp[0]))).toBe(true)
    expect(contem(r.bytes, 'hdrgm:GainMapMax')).toBe(true)
    expect(contem(r.bytes, 'AUTOR-SECRETO')).toBe(false)
    expect(dentroDosExtents(intervalosDiferentes(f.bytes, r.bytes), [f.extentsXmp[1]])).toBe(true)
    expect(analisarHeic(r.bytes).classe).toBe('LIMPO')
    // só o XMP HDR => nada a fazer
    expect(sanearHeic(montarHeic({ xmp: XMP_HDR }).bytes).estado).toBe('limpa')
  })

  it('XMP que imita o HDR mas leva texto livre NÃO é funcional', () => {
    const falso = XMP_HDR.replace('hdrgm:Version="1.0"', 'hdrgm:Version="1.0" hdrgm:Nota="FULANO-SECRETO"')
    const f = montarHeic({ xmp: falso })
    expect(analisarHeic(f.bytes).classe).toBe('METADADOS_SENSIVEIS')
    const r = sanearHeic(f.bytes)
    expect(r.estado).toBe('saneada')
    expect(contem(r.bytes, 'FULANO-SECRETO')).toBe(false)
  })

  it('item mime que não é XMP não é tocado, e o resultado admite que sobrou metadado: nao_suportada', () => {
    const f = montarHeic({ exif: exifPayload({ gps: true }), mimeOutro: 'DADO-DESCONHECIDO' })
    const r = sanearHeic(f.bytes)
    expect(r).toMatchObject({ estado: 'nao_suportada', motivo: 'metadados_remanescentes' })
    expect(r.bytes).toBe(null)
  })

  it('extent do Exif sobreposto aos pixels (hvc1) => nao_suportada (nunca apaga pixel)', () => {
    const f = montarHeic({ exif: exifPayload(EXIF_COMPLETO), sobrepor: true })
    expect(sanearHeic(f.bytes)).toMatchObject({ estado: 'nao_suportada', motivo: 'extent_compartilhado' })
  })

  it('brand desconhecida/AVIF/vídeo => nao_suportada; truncado/inválido => invalida (sem exceção)', () => {
    expect(sanearHeic(montarHeic({ marca: 'abcd', compat: ['abcd'] }).bytes).estado).toBe('nao_suportada')
    expect(sanearHeic(montarHeic({ marca: 'avif', compat: ['avif'] }).bytes).estado).toBe('nao_suportada')
    const f = montarHeic({ exif: exifPayload(EXIF_COMPLETO) }).bytes
    for (const n of [0, 5, 40, 100, f.length - 1, f.length - 50]) expect(sanearHeic(f.subarray(0, n))).toMatchObject({ estado: 'invalida', bytes: null })
    expect(sanearHeic(new Uint8Array(100).fill(7)).estado).toBe('invalida')
    expect(sanearHeic(null).estado).toBe('invalida')
  })
})

// ---------------------------------------------------------------------------------------------- arquivos reais (local)
const RAIZ = join(homedir(), '.desbravaclube-backups', 'storage-2026-10-01')
function acharHeicReais() {
  const out = []
  for (const bucket of ['imagens', 'comprovacoes']) {
    const pasta = join(RAIZ, bucket)
    if (!existsSync(pasta)) continue
    const varrer = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name)
        if (e.isDirectory()) varrer(f)
        else {
          const fd = openSync(f, 'r')
          const h = Buffer.alloc(12)
          readSync(fd, h, 0, 12, 0)
          closeSync(fd)
          if (h.toString('latin1', 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(h.toString('latin1', 8, 12))) out.push(f)
        }
      }
    }
    varrer(pasta)
  }
  return out
}
const reais = acharHeicReais()

describe.skipIf(!reais.length)('HEIC reais (backup local, só leitura em memória)', () => {
  it('saneamento em memória mexe só nos extents Exif/XMP e deixa o arquivo sem metadado sensível', () => {
    for (const f of reais) {
      const original = new Uint8Array(readFileSync(f))
      const a0 = analisarHeic(original)
      expect(a0.estado).toBe('ok')
      const r = sanearHeic(original)
      expect(['saneada', 'limpa']).toContain(r.estado)
      if (r.estado === 'limpa') {
        expect(['LIMPO', 'METADADOS_NAO_SENSIVEIS']).toContain(a0.classe)
        continue
      }
      expect(r.bytes.length).toBe(original.length)
      const alvos = a0.itens.filter((i) => i.tipo === 'Exif' || i.tipo === 'mime').flatMap((i) => i.extents)
      const dif = intervalosDiferentes(original, r.bytes)
      expect(dentroDosExtents(dif, alvos)).toBe(true)
      const a1 = analisarHeic(r.bytes)
      expect(a1.estado).toBe('ok')
      expect(a1.classe).toBe('LIMPO')
      expect(a1.exif.gps).toBe('ausente')
      // dimensões, rotação, itens e extents idênticos; pixels (itens de imagem) byte a byte iguais
      expect([a1.largura, a1.altura, a1.rotacao, a1.espelho]).toEqual([a0.largura, a0.altura, a0.rotacao, a0.espelho])
      expect(JSON.stringify(a1.itens)).toBe(JSON.stringify(a0.itens))
      for (const it of a0.itens.filter((i) => i.tipo !== 'Exif' && i.tipo !== 'mime')) {
        if (it.extents) expect(iguais(payloadDoItem(original, it), payloadDoItem(r.bytes, it))).toBe(true)
      }
      expect(a1.exif.orientacao).toBe(a0.exif.orientacao)
      // idempotência
      const r2 = sanearHeic(r.bytes)
      expect(r2.estado).toBe('limpa')
      expect(iguais(r2.bytes, r.bytes)).toBe(true)
    }
  })
})
