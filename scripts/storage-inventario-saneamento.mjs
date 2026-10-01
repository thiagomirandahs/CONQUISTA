#!/usr/bin/env node
// INVENTÁRIO PARA BACKFILL do saneamento de imagens — SOMENTE LEITURA, 100% LOCAL: lê a CÓPIA do Storage que o backup já baixou
// (pasta com MANIFESTO.tsv + arquivos) e classifica cada arquivo. Não fala com o Supabase, não regrava nada, não imprime caminho completo.
//   node scripts/storage-inventario-saneamento.mjs --pasta <storage-AAAA-MM-DD> [--json saida.json]
// Por arquivo: bucket, finalidade (pela pasta), formato REAL (magic bytes), bytes e situação de metadados:
//   'limpo' (sem EXIF/GPS/texto), 'com_metadados' (EXIF/XMP/IPTC/texto) e, dentro dele, 'com_gps' (tag GPS no EXIF), 'invalido' (formato conhecido, truncado)
//   ou 'nao_imagem' / 'heic' / 'gif' / 'desconhecido'.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const pasta = val('--pasta'), saida = val('--json')
if (!pasta || !existsSync(join(pasta, 'MANIFESTO.tsv'))) { console.error('Uso: --pasta <pasta do backup do Storage com MANIFESTO.tsv>'); process.exit(2) }

const linhas = readFileSync(join(pasta, 'MANIFESTO.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => { const [bucket, caminho, bytes] = l.split('\t'); return { bucket, caminho, bytes: Number(bytes) } })

const finalidade = (b, c) => {
  const p = c.split('/')
  if (b === 'imagens') return { perfis: 'avatar/perfil', mural: 'mural (foto/miniatura)', atividades: 'comprovante antigo de atividade', missoes: 'comprovante antigo de missão', unidades: 'emblema/bandeira de unidade' }[p[0]] || 'imagens/outros'
  if (b === 'comprovacoes') { const seg = p.length >= 4 ? p[2] : p[1]; return { requisitos: 'comprovação de requisito', documentos: 'documento da idade', atividades: 'atividade', missoes: 'missão', 'conclusao-anterior': 'conclusão anterior' }[seg] || 'comprovações/outros' }
  if (b === 'comunidade') return 'foto da Rede/Comunidade'
  if (b === 'publico') return 'logo/marca (institucional)'
  return b
}

function formato(b) {
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

function exifTemGps(app) { // app = bytes do APP1 depois de "Exif\0\0": TIFF; procura a tag 0x8825 no IFD0
  try {
    const le = app.toString('latin1', 0, 2) === 'II'
    const u16 = (o) => (le ? app.readUInt16LE(o) : app.readUInt16BE(o)); const u32 = (o) => (le ? app.readUInt32LE(o) : app.readUInt32BE(o))
    const off = u32(4); const n = u16(off)
    for (let i = 0; i < n; i++) if (u16(off + 2 + i * 12) === 0x8825) return true
  } catch { /* EXIF estranho: trata como sem GPS legível */ }
  return false
}

function analisarJpeg(b) {
  let i = 2; let meta = false, gps = false, fim = false
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { situacao: 'invalido' }
    let m = b[i + 1]
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1] }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
    if (m === 0xd9) { fim = true; break }
    const len = b.readUInt16BE(i + 2)
    if (m === 0xda) { fim = b.includes(Buffer.from([0xff, 0xd9]), i + 2 + len); break }
    if (m === 0xe1) {
      const corpo = b.subarray(i + 4, i + 2 + len)
      if (corpo.toString('latin1', 0, 6) === 'Exif\0\0') { meta = true; if (exifTemGps(corpo.subarray(6))) gps = true }
      else if (corpo.toString('latin1', 0, 29).startsWith('http://ns.adobe.com/xap')) meta = true
    } else if (m === 0xed || m === 0xfe) meta = true // IPTC/Photoshop, comentário
    i += 2 + len
  }
  if (!fim) return { situacao: 'invalido' }
  return { situacao: gps ? 'com_gps' : meta ? 'com_metadados' : 'limpo' }
}
function analisarPng(b) {
  let i = 8; let meta = false, fim = false
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i); const tipo = b.toString('latin1', i + 4, i + 8)
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(tipo)) meta = true
    if (tipo === 'IEND') { fim = true; break }
    i += 12 + len
  }
  return { situacao: !fim ? 'invalido' : meta ? 'com_metadados' : 'limpo' }
}
function analisarWebp(b) {
  let i = 12; let meta = false, gps = false
  while (i + 8 <= b.length) {
    const tipo = b.toString('latin1', i, i + 4); const len = b.readUInt32LE(i + 4)
    if (tipo === 'EXIF') { meta = true; const c = b.subarray(i + 8, i + 8 + len); if (exifTemGps(c.toString('latin1', 0, 6) === 'Exif\0\0' ? c.subarray(6) : c)) gps = true }
    if (tipo === 'XMP ') meta = true
    i += 8 + len + (len % 2)
  }
  return { situacao: gps ? 'com_gps' : meta ? 'com_metadados' : 'limpo' }
}

const tot = { arquivos: 0, bytes: 0 }
const porBucket = {}, porFormato = {}, porFinalidade = {}, porSituacao = {}, tabela = {}
const inc = (o, k, bytes) => { o[k] ??= { arquivos: 0, bytes: 0 }; o[k].arquivos++; o[k].bytes += bytes }
for (const l of linhas) {
  const arq = join(pasta, l.bucket, ...l.caminho.split('/'))
  let b = null; try { b = readFileSync(arq) } catch { /* não está na cópia */ }
  const f = b ? formato(b) : 'ausente'
  let sit = f === 'jpeg' ? analisarJpeg(b).situacao : f === 'png' ? analisarPng(b).situacao : f === 'webp' ? analisarWebp(b).situacao
    : f === 'heic' ? 'heic_nao_suportado' : f === 'gif' ? 'gif_nao_tratado' : f === 'video' ? 'nao_imagem' : f === 'ausente' ? 'ausente' : 'desconhecido'
  const fin = finalidade(l.bucket, l.caminho)
  tot.arquivos++; tot.bytes += l.bytes
  inc(porBucket, l.bucket, l.bytes); inc(porFormato, f, l.bytes); inc(porFinalidade, `${l.bucket} · ${fin}`, l.bytes); inc(porSituacao, sit, l.bytes)
  inc(tabela, `${l.bucket}|${f}|${sit}`, l.bytes)
}
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'
const imprimir = (titulo, o) => { console.log(`\n${titulo}`); for (const [k, v] of Object.entries(o).sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  ${k.padEnd(52)} ${String(v.arquivos).padStart(4)} arq  ${mb(v.bytes).padStart(9)}`) }
console.log(`=== INVENTÁRIO PARA BACKFILL (somente leitura; cópia local; nada foi regravado) ===\nPasta: ${pasta.split(/[\\/]/).pop()} | ${tot.arquivos} arquivos, ${mb(tot.bytes)}`)
imprimir('Por bucket', porBucket); imprimir('Por formato REAL', porFormato); imprimir('Por finalidade', porFinalidade); imprimir('Por situação de metadados', porSituacao)
const candidatos = Object.entries(tabela).filter(([k]) => /\|(com_metadados|com_gps)$/.test(k) && /\|(jpeg|png|webp)\|/.test(k)).reduce((a, [, v]) => ({ arquivos: a.arquivos + v.arquivos, bytes: a.bytes + v.bytes }), { arquivos: 0, bytes: 0 })
console.log(`\nAINDA CANDIDATOS ao backfill (JPEG/PNG/WebP com metadados): ${candidatos.arquivos} arquivos, ${mb(candidatos.bytes)}`)
if (saida) { (await import('node:fs')).writeFileSync(saida, JSON.stringify({ total: tot, porBucket, porFormato, porFinalidade, porSituacao, candidatos }, null, 2)); console.log('JSON:', saida) }
