#!/usr/bin/env node
// RELATÓRIO DE DIVERGÊNCIAS (somente leitura, local): formato REAL (bytes) × extensão do nome × mimetype gravado no Storage, lido do inventário de produção
// gerado por scripts/storage-backfill-saneamento.mjs (--fase inventario). Imprime SÓ contagens; nunca caminhos. Não corrige nada.
//   node scripts/storage-divergencias-formato.mjs --inventario <inventario-*.json>
import { readFileSync } from 'node:fs'
const i = process.argv.indexOf('--inventario'); const arq = i >= 0 ? process.argv[i + 1] : null
if (!arq) { console.error('uso: --inventario <arquivo.json>'); process.exit(2) }
const itens = JSON.parse(readFileSync(arq, 'utf8')).itens
const extDe = (n) => ((n.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase()
const esperadoPorFormato = { jpeg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'], gif: ['gif'], heic: ['heic', 'heif'], video: ['mp4', 'mov', 'm4v', 'webm'] }
const mimePorFormato = { jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], gif: ['image/gif'], heic: ['image/heic', 'image/heif'], video: ['video/mp4', 'video/quicktime', 'video/webm'] }
const cont = { total: itens.length, ext_ok: 0, ext_diverge: 0, mime_ok: 0, mime_diverge: 0, mime_vazio: 0, ambos_ok: 0 }
const dets = {}
for (const it of itens) {
  const f = it.formato; const ext = extDe(it.nome); const mime = (it.mime || '').toLowerCase()
  const extOk = (esperadoPorFormato[f] || []).includes(ext)
  const mimeOk = (mimePorFormato[f] || []).includes(mime)
  if (extOk) cont.ext_ok++; else cont.ext_diverge++
  if (!mime) cont.mime_vazio++; else if (mimeOk) cont.mime_ok++; else cont.mime_diverge++
  if (extOk && mimeOk) cont.ambos_ok++
  if (!extOk || (mime && !mimeOk)) { const k = `${it.bucket} · bytes=${f} · ext=.${ext} · mimetype=${mime || '(vazio)'}`; dets[k] = (dets[k] || 0) + 1 }
}
console.log('=== DIVERGÊNCIAS formato real × extensão × mimetype (somente leitura) ===')
console.log(JSON.stringify(cont))
console.log('\nCasos divergentes (agregados):')
for (const [k, n] of Object.entries(dets).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`)
if (!Object.keys(dets).length) console.log('  nenhum')
