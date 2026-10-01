#!/usr/bin/env node
// INVENTÁRIO DE VÍDEOS (privacidade) — SOMENTE LEITURA, 100% LOCAL. Lê a CÓPIA do Storage (pasta com MANIFESTO.tsv + arquivos),
// descobre vídeos por assinatura (caixa ftyp com marca não-HEIF, ou EBML) e analisa cada um por leituras posicionadas
// (cabeçalhos de caixas de topo + `moov` inteiro; o `mdat` NUNCA é lido). Imprime SÓ agregados e um rótulo anônimo V1..Vn por arquivo:
// nada de caminho, owner, coordenada, aparelho ou texto.
//   node scripts/storage-inventario-video.mjs --pasta <storage-AAAA-MM-DD> [--atuais <inventario-pos-gc.json>] [--json saida.json]
// --atuais: restringe aos objetos que AINDA existem em produção (itens[] com bucket/nome); informa quantos do backup não existem mais.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analisarMp4, CLASSES } from './lib/analisarMp4.mjs'
import { abrirLeitor } from './lib/leitorArquivo.mjs'

const args = process.argv.slice(2)
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const pasta = val('--pasta'), atuais = val('--atuais'), saida = val('--json')
if (!pasta || !existsSync(join(pasta, 'MANIFESTO.tsv'))) { console.error('Uso: --pasta <pasta do backup do Storage com MANIFESTO.tsv> [--atuais inventario.json] [--json saida.json]'); process.exit(2) }

const MARCAS_HEIC = new Set(['heic', 'heix', 'heif', 'hevc', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs', 'avif', 'avis'])
const linhas = readFileSync(join(pasta, 'MANIFESTO.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => { const [bucket, caminho, bytes] = l.split('\t'); return { bucket, caminho, bytes: Number(bytes) } })

function finalidade(b, c) {
  const p = c.split('/')
  if (b === 'imagens') return { atividades: 'atividade (legado, bucket imagens)', missoes: 'missão (legado, bucket imagens)', mural: 'mural', perfis: 'perfil' }[p[0]] || 'imagens/outros'
  if (b === 'comprovacoes') { const seg = p.length >= 4 ? p[2] : p[1]; return { requisitos: 'requisito', documentos: 'documento', atividades: 'atividade', missoes: 'missão', 'conclusao-anterior': 'conclusão anterior' }[seg] || 'comprovações/outros' }
  return b
}

let filtro = null
if (atuais) {
  const j = JSON.parse(readFileSync(atuais, 'utf8'))
  filtro = new Set((j.itens || []).filter((i) => i.formato === 'video').map((i) => `${i.bucket}\u0000${i.nome}`))
}

const achados = []
for (const l of linhas) {
  const arq = join(pasta, l.bucket, ...l.caminho.split('/'))
  if (!existsSync(arq)) continue
  const leitor = abrirLeitor(arq)
  try {
    const h = leitor.ler(0, 12)
    const ebml = h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3
    const ftyp = h.length >= 12 && h.toString('latin1', 4, 8) === 'ftyp' && !MARCAS_HEIC.has(h.toString('latin1', 8, 12).toLowerCase())
    if (!ebml && !ftyp) continue
    achados.push({ ...l, analise: analisarMp4(leitor, { conferirOffsets: true }), fin: finalidade(l.bucket, l.caminho), noAr: filtro ? filtro.has(`${l.bucket}\u0000${l.caminho}`) : true })
  } finally { leitor.fechar() }
}
const analisados = achados.filter((a) => a.noAr)
const foraDoAr = achados.length - analisados.length

const mb = (n) => (n / 1048576).toFixed(1) + ' MB'
const agg = {}
const add = (grupo, chave, bytes = 0) => { agg[grupo] ??= {}; agg[grupo][chave] ??= { n: 0, bytes: 0 }; agg[grupo][chave].n++; agg[grupo][chave].bytes += bytes }
let dur = 0, bytes = 0
const rotulos = []
analisados.forEach((a, i) => {
  const x = a.analise
  bytes += a.bytes
  add('classe', x.classe || CLASSES.INVALIDO, a.bytes)
  add('bucket · finalidade', `${a.bucket} · ${a.fin}`, a.bytes)
  if (x.estado === 'ok') {
    dur += x.duracao
    add('container', `${x.container} (marca ${x.marca.trim() || '-'})`, a.bytes)
    for (const c of new Set(x.codecsVideo)) add('codec de vídeo', c)
    for (const c of new Set(x.codecsAudio)) add('codec de áudio', c)
    add('resolução', `${x.largura}x${x.altura}`)
    add('rotação (graus)', String(x.rotacao))
    add('posição do moov', x.faststart ? 'início (faststart)' : 'fim (sem faststart)')
    add('offsets stco/stsz x mdat', x.offsets?.ok ? 'consistentes' : `INCONSISTENTES:${x.offsets?.motivo}`)
    add('nº de trilhas', String(x.nTrilhas))
    if (x.temCreationTime) add('sinais', 'creation_time')
    if (x.temLocalizacao) add('sinais', 'LOCALIZAÇÃO')
    if (x.temAparelho) add('sinais', 'aparelho/modelo/software')
    if (x.temTextoLivre) add('sinais', 'texto livre')
    if (x.temXmp) add('sinais', 'XMP')
    if (x.temIdentificador) add('sinais', 'identificador')
    if (x.temEncoder) add('sinais', 'encoder genérico')
    if (x.temLocalizacaoEmTrilha) add('sinais', 'localização em TRILHA (exige reescrita)')
    if (x.temTelemetriaEmTrilha) add('sinais', 'telemetria em TRILHA (exige reescrita)')
    for (const k of Object.keys(x.desconhecidos)) add('átomos não classificados (tipos)', k)
    add('mdat > 4 GB', x.mdat.maiorQue4GB ? 'sim' : 'não')
  } else add('inválidos/não suportados', x.motivo || x.formato || '?')
  rotulos.push({ rotulo: `V${i + 1}`, classe: x.classe || CLASSES.INVALIDO, container: x.container, mb: +(a.bytes / 1048576).toFixed(1), moov: x.faststart ? 'inicio' : 'fim', rot: x.rotacao })
})
console.log('=== INVENTÁRIO DE VÍDEOS (somente leitura; mdat nunca lido; sem valores sensíveis) ===')
console.log(`Pasta: ${pasta.split(/[\\/]/).pop()} | vídeos no backup: ${achados.length} | ainda em produção (analisados): ${analisados.length} | só no backup (não analisados): ${foraDoAr}`)
console.log(`Total analisado: ${analisados.length} vídeos, ${mb(bytes)}, duração somada ${(dur / 60).toFixed(1)} min`)
for (const [g, o] of Object.entries(agg)) {
  console.log(`\n${g}`)
  for (const [k, v] of Object.entries(o).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(48)} ${String(v.n).padStart(3)}${v.bytes ? '  ' + mb(v.bytes).padStart(10) : ''}`)
}
console.log('\nPor arquivo (rótulo anônimo):')
for (const r of rotulos) console.log(`  ${r.rotulo.padEnd(4)} ${String(r.classe).padEnd(28)} ${String(r.container ?? '-').padEnd(4)} ${String(r.mb).padStart(7)} MB  moov:${r.moov} rot:${r.rot ?? '-'}`)
if (saida) { writeFileSync(saida, JSON.stringify({ total: analisados.length, bytes, agg, rotulos }, null, 2)); console.log('\nJSON:', saida) }
