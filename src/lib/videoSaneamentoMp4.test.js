// Prova de conceito: ANALISAR e SANEAR metadados de vídeo MP4/MOV sem recodificar (neutraliza no lugar, tamanhos e offsets preservados).
// Fixtures 100% SINTÉTICAS geradas por código (scripts/lib/mp4Sintetico.mjs). A parte dos vídeos reais só roda se a cópia local existir
// (e nunca copia, grava nem imprime conteúdo: só agregados/booleanos).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { analisarMp4, analisarMoov, classificar, CLASSES, leitorDeBuffer } from '../../scripts/lib/analisarMp4.mjs'
import { sanearMp4, planejarSaneamento, provarImutabilidade, aplicarRegioes } from '../../scripts/lib/sanearMp4.mjs'
import { montarMp4, GPS_FALSO } from '../../scripts/lib/mp4Sintetico.mjs'
import { abrirLeitor } from '../../scripts/lib/leitorArquivo.mjs'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const contem = (buf, texto) => buf.includes(Buffer.from(texto, 'latin1')) || buf.includes(Buffer.from(texto, 'utf8'))

describe('analisador: classificação por variante sintética', () => {
  it('sem metadados e sem datas => LIMPO (e átomos de preenchimento não contam)', () => {
    const { bytes } = montarMp4({ semMetadados: true, datas: false })
    const a = analisarMp4(bytes, { conferirOffsets: true })
    expect(a.estado).toBe('ok')
    expect(a.classe).toBe(CLASSES.LIMPO)
    expect(a.codecsVideo).toEqual(['avc1'])
    expect(a.codecsAudio).toEqual(['mp4a'])
    expect([a.largura, a.altura, a.rotacao]).toEqual([640, 360, 0])
    expect(a.offsets.ok).toBe(true)
  })
  it('só creation_time/encoder genérico => METADADOS NÃO SENSÍVEIS', () => {
    const a = analisarMp4(montarMp4({ encoderGenerico: true }).bytes)
    expect(a.classe).toBe(CLASSES.NAO_SENSIVEL)
    expect(a.temCreationTime).toBe(true)
    expect(a.temAparelho || a.temLocalizacao).toBe(false)
  })
  it('©too com SO/aparelho é sensível; ©mak/©mod/©swr => METADADOS SENSÍVEIS', () => {
    const a = analisarMp4(montarMp4({ aparelho: true }).bytes)
    expect(a.classe).toBe(CLASSES.SENSIVEL)
    expect(a.temAparelho).toBe(true)
    expect(a.temLocalizacao).toBe(false)
  })
  it('comentário (©cmt) e XMP no topo => sensível', () => {
    expect(analisarMp4(montarMp4({ comentario: true }).bytes).temTextoLivre).toBe(true)
    const x = analisarMp4(montarMp4({ xmp: true, faststart: false }).bytes)
    expect(x.temXmp).toBe(true)
    expect(x.classe).toBe(CLASSES.SENSIVEL)
  })
  it.each([
    ['©xyz', { gps: true }],
    ['mdta location', { mdtaLocal: true }],
    ['3GPP loci', { loci: true }],
    ['mdta no udta', { mdtaLocal: true, metaEmUdta: true }],
  ])('localização via %s => LOCALIZAÇÃO/GPS', (_n, op) => {
    const a = analisarMp4(montarMp4(op).bytes)
    expect(a.temLocalizacao).toBe(true)
    expect(a.classe).toBe(CLASSES.LOCALIZACAO)
  })
  it('rotação 90/180/270 lida da matriz do tkhd; moov no início e no fim', () => {
    for (const rot of [0, 90, 180, 270]) expect(analisarMp4(montarMp4({ rotacao: rot }).bytes).rotacao).toBe(rot)
    expect(analisarMp4(montarMp4({ faststart: true }).bytes).faststart).toBe(true)
    const fim = analisarMp4(montarMp4({ faststart: false }).bytes)
    expect(fim.faststart).toBe(false)
    expect(fim.moov.posicao).toBe('fim')
  })
  it('marca qt => container mov; isom/mp42 => mp4', () => {
    expect(analisarMp4(montarMp4({ marca: 'qt  ' }).bytes).container).toBe('mov')
    expect(analisarMp4(montarMp4({ marca: 'isom' }).bytes).container).toBe('mp4')
  })
  it('o analisador não devolve valores sensíveis (coordenadas/aparelho) no objeto de saída', () => {
    const a = analisarMp4(montarMp4({ gps: true, aparelho: true, mdtaLocal: true, mdtaAparelho: true }).bytes)
    const json = JSON.stringify(a)
    for (const t of ['10.0000', 'ModeloFalso', 'MarcaFalsa', 'SoFalso']) expect(json.includes(t)).toBe(false)
  })
})

describe('entradas inválidas nunca lançam', () => {
  const ok = montarMp4({ gps: true }).bytes
  it('vazio, curto, ruído e texto => invalido', () => {
    for (const b of [Buffer.alloc(0), Buffer.from('abc'), Buffer.alloc(64, 0xff), Buffer.from('isto nao e um video mp4, apenas texto qualquer')]) {
      const a = analisarMp4(b)
      expect(a.estado).toBe('invalido')
      expect(classificar(a)).toBe(CLASSES.INVALIDO)
      expect(sanearMp4(b).estado).toBe('invalida')
    }
  })
  it('truncado em vários pontos => invalido, sem exceção (e saneador devolve os mesmos bytes)', () => {
    for (const n of [10, 40, 100, Math.floor(ok.length / 2), ok.length - 1]) {
      const t = ok.subarray(0, n)
      const a = analisarMp4(t)
      expect(a.estado).toBe('invalido')
      const r = sanearMp4(t)
      expect(r.estado).toBe('invalida')
      expect(r.bytes.equals(t)).toBe(true)
    }
  })
  it('WebM/Matroska (EBML) => FORMATO NÃO SUPORTADO; HEIF => não suportado', () => {
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), Buffer.alloc(100)])
    const a = analisarMp4(webm)
    expect(a.estado).toBe('nao_suportado')
    expect(classificar(a)).toBe(CLASSES.NAO_SUPORTADO)
    expect(sanearMp4(webm).estado).toBe('nao_suportada')
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypheic'), Buffer.alloc(4)])
    expect(analisarMp4(heic).estado).toBe('nao_suportado')
  })
  it('caixa com tamanho absurdo / moov corrompido por dentro => invalido', () => {
    const b = Buffer.from(ok)
    const i = b.indexOf('moov', 0, 'latin1')
    b.writeUInt32BE(0xfffffff0, i + 4) // tamanho do mvhd absurdo
    expect(analisarMp4(b).estado).toBe('invalido')
  })
  it('arquivo sem moov (upload cortado antes do moov) => invalido', () => {
    const f = montarMp4({ faststart: false })
    expect(analisarMp4(f.bytes.subarray(0, f.mdat.fim)).estado).toBe('invalido')
  })
})

// Núcleo da prova: saneia, e confere por diff de intervalos + hashes.
function provar(opcoesFixture, opcoesSanear = {}) {
  const f = montarMp4(opcoesFixture)
  const antes = analisarMp4(f.bytes, { conferirOffsets: true })
  const r = sanearMp4(f.bytes, opcoesSanear)
  const depois = analisarMp4(r.bytes, { conferirOffsets: true })
  const prova = provarImutabilidade(f.bytes, r.bytes, r.regioes, antes.protegidos)
  return { f, antes, r, depois, prova }
}

describe('saneamento in-place (sem recodificar, sem mover bytes)', () => {
  const cenarios = {
    'GPS ©xyz + aparelho': { gps: true, aparelho: true, encoderGenerico: true },
    'mdta location/make/model/software': { mdtaLocal: true, mdtaAparelho: true },
    '3GPP loci': { loci: true },
    'tudo junto, rotação 90, moov no fim': { gps: true, loci: true, aparelho: true, comentario: true, mdtaLocal: true, mdtaAparelho: true, rotacao: 90, faststart: false, xmp: true },
    'faststart com meta em udta': { mdtaLocal: true, mdtaAparelho: true, metaEmUdta: true, faststart: true },
    'mdat com largesize (header de 16 bytes)': { gps: true, mdat64: true },
  }
  for (const [nome, op] of Object.entries(cenarios)) {
    it(`${nome}: localização/aparelho somem, tamanho igual, só regiões neutralizadas mudam`, () => {
      const { f, antes, r, depois, prova } = provar(op)
      expect(antes.classe === CLASSES.LOCALIZACAO || antes.classe === CLASSES.SENSIVEL).toBe(true)
      expect(r.estado).toBe('saneada')
      expect(r.bytes.length).toBe(f.bytes.length) // tamanho de saída = entrada
      expect(prova).toMatchObject({ tamanhoIgual: true, foraDasRegioes: 0, tocaProtegido: 0, protegidosIdenticos: true })
      expect(prova.bytesAlterados).toBeGreaterThan(0)
      // reanálise pelo próprio analisador: moov parseável e sem sinais
      expect(depois.estado).toBe('ok')
      expect(depois.temLocalizacao || depois.temAparelho || depois.temTextoLivre || depois.temXmp || depois.temIdentificador).toBe(false)
      expect(depois.regioes.filter((x) => !x.opcional)).toHaveLength(0)
      // os valores falsos não existem mais nos bytes
      for (const t of [GPS_FALSO, 'ModeloFalso', 'MarcaFalsa', 'SoFalso', 'comentario falso', 'com.apple.quicktime.location', 'com.apple.quicktime.model']) expect(contem(r.bytes, t)).toBe(false)
      // streams: sha256 do mdat inteiro idêntico; stbl idêntico; tkhd (dimensões/rotação/duração) idêntico
      expect(sha(r.bytes.subarray(f.mdat.ini, f.mdat.fim))).toBe(sha(f.bytes.subarray(f.mdat.ini, f.mdat.fim)))
      for (const p of antes.protegidos) expect(sha(r.bytes.subarray(p.ini, p.fim))).toBe(sha(f.bytes.subarray(p.ini, p.fim)))
      expect([depois.largura, depois.altura, depois.rotacao, depois.duracao, depois.nTrilhas]).toEqual([antes.largura, antes.altura, antes.rotacao, antes.duracao, antes.nTrilhas])
      expect(depois.codecsVideo).toEqual(antes.codecsVideo)
      // offsets continuam consistentes com o mdat (stco/co64 x stsz x stsc)
      expect(antes.offsets.ok && depois.offsets.ok).toBe(true)
      expect(depois.moov).toEqual(antes.moov) // moov não se moveu nem mudou de tamanho
    })
  }

  it('idempotente: sanear de novo => limpa, bytes idênticos', () => {
    const { r } = provar({ gps: true, aparelho: true, mdtaLocal: true, mdtaAparelho: true, xmp: true, faststart: false })
    const r2 = sanearMp4(r.bytes)
    expect(r2.estado).toBe('limpa')
    expect(r2.bytes.equals(r.bytes)).toBe(true)
  })

  it('arquivo já limpo => limpa, nada muda', () => {
    const f = montarMp4({ semMetadados: true })
    const r = sanearMp4(f.bytes)
    expect(r.estado).toBe('limpa')
    expect(r.bytes.equals(f.bytes)).toBe(true)
  })

  it('só neutraliza o que é sensível: creation_time, ©too genérico e átomo desconhecido ficam (decisão sobre datas é do dono)', () => {
    const { r, depois } = provar({ gps: true, encoderGenerico: true })
    expect(depois.temEncoder).toBe(true)
    expect(depois.temCreationTime).toBe(true)
    expect(depois.desconhecidos['udta:smta']).toBe(1)
    expect(contem(r.bytes, 'Lavf58')).toBe(true)
  })

  it('opção zerarDatas (OPCIONAL): zera creation/modification em mvhd/tkhd/mdhd e ©day/creationdate; stream e dimensões intactos', () => {
    const { f, antes, r, depois, prova } = provar({ gps: true, mdtaLocal: true, mdtaAparelho: true }, { zerarDatas: true })
    expect(antes.temCreationTime).toBe(true)
    expect(depois.temCreationTime).toBe(false)
    expect(prova).toMatchObject({ foraDasRegioes: 0, tocaProtegido: 0, protegidosIdenticos: true })
    expect([depois.largura, depois.altura, depois.rotacao, depois.duracao]).toEqual([antes.largura, antes.altura, antes.rotacao, antes.duracao])
    expect(sha(r.bytes.subarray(f.mdat.ini, f.mdat.fim))).toBe(sha(f.bytes.subarray(f.mdat.ini, f.mdat.fim)))
    expect(depois.offsets.ok).toBe(true)
  })

  it('localização em TRILHA de metadados (mebx) => exige_reescrita: nada é aplicado', () => {
    const f = montarMp4({ mebxLocal: true, gps: true })
    const a = analisarMp4(f.bytes)
    expect(a.temLocalizacaoEmTrilha).toBe(true)
    const r = sanearMp4(f.bytes)
    expect(r.estado).toBe('exige_reescrita')
    expect(r.bytes.equals(f.bytes)).toBe(true)
  })

  it('tkhd/mvhd/stbl não são alterados mesmo com rotação 270', () => {
    const { prova, depois } = provar({ gps: true, rotacao: 270 })
    expect(prova.tocaProtegido).toBe(0)
    expect(depois.rotacao).toBe(270)
  })
})

describe('mdat > 4 GB simulado (co64, header com largesize) sem alocar memória', () => {
  const f = montarMp4({ virtual: { amostras: 4, tamanho: 1_500_000_000 }, gps: true, aparelho: true, mdtaLocal: true, faststart: true })
  it('analisa só cabeçalhos + moov; reconhece mdat grande e offsets co64 > 4 GB consistentes', () => {
    expect(f.tamanho).toBeGreaterThan(0xffffffff)
    const a = analisarMp4(f.leitor, { conferirOffsets: true })
    expect(a.estado).toBe('ok')
    expect(a.mdat.maiorQue4GB).toBe(true)
    expect(a.offsets.ok).toBe(true)
    expect(a.temLocalizacao).toBe(true)
  })
  it('planeja o saneamento só no moov; regiões não tocam o mdat; moov novo sem localização', () => {
    const plano = planejarSaneamento(f.leitor)
    expect(plano.estado).toBe('saneada')
    expect(plano.regioesForaDoMoov).toHaveLength(0)
    const mdat = plano.analise.protegidos.find((p) => p.tipo === 'mdat')
    expect(plano.regioes.every((r) => r.fim <= mdat.ini || r.ini >= mdat.fim)).toBe(true)
    expect(plano.moov.novo.length).toBe(plano.moov.original.length)
    const depois = analisarMoov(plano.moov.novo, { base: plano.moov.ini, mdats: [[mdat.ini + 16, mdat.fim]] })
    expect(depois.temLocalizacao || depois.temAparelho).toBe(false)
    expect(depois.offsets.ok).toBe(true)
  })
  it('moov no fim (depois de >4 GB de mdat) também funciona', () => {
    const g = montarMp4({ virtual: { amostras: 4, tamanho: 1_500_000_000 }, gps: true, faststart: false })
    const a = analisarMp4(g.leitor, { conferirOffsets: true })
    expect(a.faststart).toBe(false)
    expect(a.offsets.ok).toBe(true)
    expect(planejarSaneamento(g.leitor).estado).toBe('saneada')
  })
})

describe('aplicarRegioes', () => {
  it('não altera o buffer original e ignora regiões fora do intervalo', () => {
    const b = Buffer.from('abcdefghij')
    const c = aplicarRegioes(b, 100, [{ ini: 0, fim: 4, hdr: 0, acao: 'zerar' }])
    expect(c.equals(b)).toBe(true)
    expect(b.toString()).toBe('abcdefghij')
    expect(leitorDeBuffer(b).tamanho).toBe(10)
  })
})

// ---------- vídeos REAIS (só se a cópia local existir; somente leitura; só o moov é carregado; nada é impresso/gravado) ----------
const raizBackup = join(homedir(), '.desbravaclube-backups')
const pastaStorage = join(raizBackup, 'storage-2026-10-01')
const inventario = join(raizBackup, 'backfill-2026-10-01', 'inventario-pos-gc.json')
const temReais = existsSync(join(pastaStorage, 'MANIFESTO.tsv')) && existsSync(inventario)

describe.skipIf(!temReais)('vídeos reais (cópia local): prova estrutural sobre o moov em memória', () => {
  const itens = temReais ? JSON.parse(readFileSync(inventario, 'utf8')).itens.filter((i) => i.formato === 'video') : []
  const caminhos = itens.map((i) => join(pastaStorage, i.bucket, ...String(i.nome).split('/'))).filter((p) => existsSync(p))

  it('encontrou os vídeos atuais', () => { expect(caminhos.length).toBeGreaterThan(0) })

  it('para cada vídeo: só os intervalos dos átomos sensíveis seriam alterados; mdat/stbl intocados; reanálise sem localização/aparelho', () => {
    const agregado = { saneada: 0, limpa: 0, exige_reescrita: 0, outros: 0 }
    for (const p of caminhos) {
      const leitor = abrirLeitor(p)
      try {
        const plano = planejarSaneamento(leitor)
        if (plano.estado === 'exige_reescrita') { agregado.exige_reescrita++; continue }
        expect(['saneada', 'limpa']).toContain(plano.estado)
        agregado[plano.estado]++
        const a = plano.analise
        const mdats = a.protegidos.filter((x) => x.tipo === 'mdat')
        // nenhuma região (nem as de fora do moov) encosta no mdat
        for (const r of plano.regioes) expect(mdats.some((m) => r.ini < m.fim && r.fim > m.ini)).toBe(false)
        // dentro do moov: diff de intervalos ⊂ regiões neutralizadas; stbl idêntico
        const prova = provarImutabilidade(plano.moov.original, plano.moov.novo, plano.regioesNoMoov, a.protegidos, plano.moov.ini)
        expect(prova).toMatchObject({ tamanhoIgual: true, foraDasRegioes: 0, tocaProtegido: 0, protegidosIdenticos: true })
        const depois = analisarMoov(plano.moov.novo, { base: plano.moov.ini, mdats: mdats.map((m) => [m.ini + 8, m.fim]) })
        expect(depois.estado).toBe('ok')
        expect(depois.offsets.ok).toBe(true)
        expect([depois.largura, depois.altura, depois.rotacao, depois.duracao, depois.codecsVideo.join()]).toEqual([a.largura, a.altura, a.rotacao, a.duracao, a.codecsVideo.join()])
        // o que está FORA do moov (ex.: uuid XMP) não é reanalisado aqui: só se garante que não toca mdat (acima)
        const restantes = depois.regioes.filter((x) => !x.opcional)
        expect(restantes).toHaveLength(0)
        expect(depois.temLocalizacao || depois.temAparelho || depois.temTextoLivre || depois.temIdentificador).toBe(false)
        // idempotência: a reanálise do moov novo não tem mais nada a neutralizar (restantes = 0 acima)
      } finally { leitor.fechar() }
    }
    expect(agregado.saneada + agregado.limpa + agregado.exige_reescrita).toBe(caminhos.length)
    expect(agregado.outros).toBe(0)
  }, 120000)
})
