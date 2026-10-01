// BACKUP DOS ARQUIVOS DO STORAGE (produção) — SOMENTE LEITURA (só baixa; nunca apaga nem altera). O pg_dump NÃO inclui estes arquivos.
//   node scripts/janela-fase8/backup-storage.mjs                          # todos os buckets
//   node scripts/janela-fase8/backup-storage.mjs --bucket=publico         # um bucket
//   node scripts/janela-fase8/backup-storage.mjs --so-listar              # só confere contagem/tamanho (não baixa)
// Saída (FORA do Git): ~/.desbravaclube-backups/storage-<data>/<bucket>/<caminho> + MANIFESTO.tsv (caminho, bytes, sha256) + RESUMO.txt.
// Credenciais: SUPABASE_ACCESS_TOKEN e DB_URL_PRODUCAO de ~/.desbravaclube-prod.env (nunca impressas); a chave de serviço é obtida em memória
// pela API de gerenciamento e NÃO é gravada em disco. Compara no fim (contagem e bytes) com storage.objects do banco.
import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const RAIZ = resolve(import.meta.dirname, '..', '..')
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const soListar = process.argv.includes('--so-listar')
const linhas = readFileSync(join(homedir(), '.desbravaclube-prod.env'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)
const env = Object.fromEntries(linhas.map((l) => l.replace(/^export\s+/, '')).filter((l) => /^[A-Z_0-9]+=/.test(l))
  .map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]))
const REF = readFileSync(join(RAIZ, 'supabase', '.temp', 'project-ref'), 'utf8').trim()
const psql = (q) => execFileSync('psql', [env.DB_URL_PRODUCAO, '-X', '-q', '-A', '-t', '-F', '\t', '-c', q], { encoding: 'utf8' }).trim()
const filtro = arg('bucket') ? `where bucket_id = '${arg('bucket').replace(/[^a-z0-9_-]/gi, '')}'` : ''
const objetos = psql(`select bucket_id, name, coalesce((metadata->>'size')::bigint, 0) from storage.objects ${filtro} order by 1, 2`)
  .split('\n').filter(Boolean).map((l) => { const [b, n, s] = l.split('\t'); return { bucket: b, nome: n, bytes: Number(s) } })
const total = objetos.reduce((a, o) => a + o.bytes, 0)
console.log(`${objetos.length} objetos, ${(total / 1048576).toFixed(1)} MB no banco${filtro ? ' (' + arg('bucket') + ')' : ''}`)
if (soListar) process.exit(0)

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })).json()
const chave = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role')?.api_key
if (!chave) { console.error('Não consegui obter a chave de serviço (somente leitura em memória).'); process.exit(2) }
const base = `https://${REF}.supabase.co/storage/v1/object`
const pasta = join(homedir(), '.desbravaclube-backups', `storage-${new Date().toISOString().slice(0, 10)}${filtro ? '-' + arg('bucket') : ''}`)
mkdirSync(pasta, { recursive: true })
const manifesto = join(pasta, 'MANIFESTO.tsv'); writeFileSync(manifesto, 'bucket\tcaminho\tbytes\tsha256\n')
let ok = 0, falhas = 0, bytes = 0
for (const o of objetos) {
  const r = await fetch(`${base}/${encodeURIComponent(o.bucket)}/${o.nome.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${chave}`, apikey: chave } })
  if (!r.ok) { falhas++; console.error(`falhou (${r.status}): ${o.bucket}/${o.nome.slice(0, 24)}…`); continue }
  const buf = Buffer.from(await r.arrayBuffer())
  const destino = join(pasta, o.bucket, ...o.nome.split('/'))
  mkdirSync(dirname(destino), { recursive: true }); writeFileSync(destino, buf)
  appendFileSync(manifesto, `${o.bucket}\t${o.nome}\t${buf.length}\t${createHash('sha256').update(buf).digest('hex')}\n`)
  ok++; bytes += buf.length
}
const resumo = `baixados ${ok}/${objetos.length} objetos, ${(bytes / 1048576).toFixed(1)} MB (banco diz ${(total / 1048576).toFixed(1)} MB); falhas: ${falhas}`
writeFileSync(join(pasta, 'RESUMO.txt'), resumo + '\n')
console.log(resumo, '\npasta:', pasta, existsSync(manifesto) ? '(manifesto com sha256 gravado)' : '')
process.exit(falhas ? 1 : 0)
