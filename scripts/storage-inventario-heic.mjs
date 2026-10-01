#!/usr/bin/env node
// INVENTÁRIO DE PRIVACIDADE DOS HEIC — SOMENTE LEITURA, 100% LOCAL. Não fala com o Supabase, não grava nada, não imprime
// caminho, nome, id de usuário, coordenadas nem qualquer valor de metadado: só rótulos anônimos (H1..Hn), contagens e classes.
//   node scripts/storage-inventario-heic.mjs --pasta <storage-AAAA-MM-DD> [--atuais <inventario-pos-gc.json>] [--sanear]
//     --atuais  restringe aos HEIC que AINDA existem em produção (itens com formato 'heic' do inventário pós-GC); o
//               restante do backup só é contado ("fora de produção").
//     --sanear  roda o saneador EM MEMÓRIA (nunca grava) e mostra a classe depois + quantos bytes mudariam.
// HEIC é descoberto pela ASSINATURA de bytes (caixa ftyp com marca heic/heix/hevc/hevx/heim/heis/mif1/msf1/heif), nunca pela extensão.
import { readFileSync, readdirSync, openSync, readSync, closeSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { analisarHeic, MARCAS_HEIC } from './lib/analisarHeic.mjs'
import { sanearHeic } from './lib/sanearHeic.mjs'

const args = process.argv.slice(2)
const val = (n) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : undefined
}
const pasta = val('--pasta')
const atuaisArq = val('--atuais')
const sanear = args.includes('--sanear')
if (!pasta || !existsSync(pasta)) {
  console.error('Uso: --pasta <pasta do backup do Storage> [--atuais <inventario-pos-gc.json>] [--sanear]')
  process.exit(2)
}

function* arquivos(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name)
    if (e.isDirectory()) yield* arquivos(f)
    else yield f
  }
}

function ehHeicPorAssinatura(f) {
  const fd = openSync(f, 'r')
  try {
    const b = Buffer.alloc(12)
    const n = readSync(fd, b, 0, 12, 0)
    if (n < 12 || b.toString('latin1', 4, 8) !== 'ftyp') return false
    return MARCAS_HEIC.includes(b.toString('latin1', 8, 12))
  } finally {
    closeSync(fd)
  }
}

const finalidade = (bucket, partes) => {
  if (bucket === 'imagens') return { perfis: 'avatar/perfil', mural: 'mural', atividades: 'atividade', missoes: 'missão', unidades: 'emblema de unidade' }[partes[0]] || 'imagens/outros'
  if (bucket === 'comprovacoes') return 'comprovação'
  return bucket
}

let atuais = null
if (atuaisArq) {
  const j = JSON.parse(readFileSync(atuaisArq, 'utf8'))
  atuais = new Set((j.itens || []).filter((i) => i.formato === 'heic').map((i) => `${i.bucket}/${i.nome}`))
}

const achados = []
for (const bucket of ['imagens', 'comprovacoes']) {
  const raiz = join(pasta, bucket)
  if (!existsSync(raiz)) continue
  for (const f of arquivos(raiz)) {
    if (!ehHeicPorAssinatura(f)) continue
    const rel = relative(raiz, f).split(sep)
    achados.push({ f, bucket, partes: rel, chave: `${bucket}/${rel.join('/')}` })
  }
}
const considerados = atuais ? achados.filter((a) => atuais.has(a.chave)) : achados
const foraDeProducao = achados.length - considerados.length

const classes = {}
const linhas = []
considerados.forEach((a, i) => {
  const bytes = new Uint8Array(readFileSync(a.f))
  const an = analisarHeic(bytes)
  const rotulo = `H${i + 1}`
  const base = { rotulo, bucket: a.bucket, finalidade: finalidade(a.bucket, a.partes), bytes: bytes.length, extensao: /\.heic$/i.test(a.partes.at(-1)) ? '.heic' : 'outra' }
  if (an.estado !== 'ok') {
    classes[an.estado] = (classes[an.estado] || 0) + 1
    linhas.push({ ...base, estado: an.estado, motivo: an.motivo })
    return
  }
  classes[an.classe] = (classes[an.classe] || 0) + 1
  const l = {
    ...base,
    marca: an.marca,
    dimensoes: `${an.largura}x${an.altura}`,
    rotacao: an.rotacao,
    espelho: an.espelho,
    itens: an.tipos,
    exif: an.exif.presente,
    gps: an.exif.gps,
    xmp: an.xmp.presente ? `${an.xmp.itens} (${an.xmp.comDados ? 'com dados' : 'vazio/funcional'}${an.xmp.funcionais ? `, ${an.xmp.funcionais} HDR` : ''})` : false,
    makerNote: an.sinais.includes('makernote'),
    sinais: an.sinais,
    classe: an.classe,
  }
  if (sanear) {
    const r = sanearHeic(bytes)
    l.saneamento = r.estado
    if (r.estado === 'saneada') {
      let mudaram = 0
      for (let k = 0; k < bytes.length; k++) if (bytes[k] !== r.bytes[k]) mudaram++
      l.bytesAlterados = mudaram
      l.classeDepois = analisarHeic(r.bytes).classe
    } else if (r.motivo) l.motivo = r.motivo
  }
  linhas.push(l)
})

console.log(`HEIC por assinatura no backup (imagens + comprovações): ${achados.length}`)
console.log(`HEIC considerados${atuais ? ' (ainda em produção)' : ''}: ${considerados.length}${atuais ? ` | só no backup antigo, fora de produção: ${foraDeProducao}` : ''}`)
console.log('Classes:', JSON.stringify(classes))
const bytesTotal = considerados.reduce((n, a) => n + statSync(a.f).size, 0)
console.log(`Bytes totais: ${bytesTotal}`)
for (const l of linhas) console.log(JSON.stringify(l))
