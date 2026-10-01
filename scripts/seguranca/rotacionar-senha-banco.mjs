#!/usr/bin/env node
// ROTAÇÃO da senha do banco de PRODUÇÃO pela Management API (PATCH /v1/projects/{ref}/database/password). Nunca imprime senha, URL nem token:
// só códigos de resultado. A nova senha é gerada aqui (aleatória), gravada PRIMEIRO num arquivo ao lado do env (`.novo`), só então enviada;
// se o envio falhar o env original não é tocado. Depois prova: nova ACEITA, antiga RECUSADA, e só então troca o arquivo de ambiente.
//   node scripts/seguranca/rotacionar-senha-banco.mjs <project-ref>          (lê ~/.desbravaclube-prod.env: DB_URL_PRODUCAO e SUPABASE_ACCESS_TOKEN)
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ref = process.argv[2]
if (!ref) { console.error('uso: rotacionar-senha-banco.mjs <project-ref>'); process.exit(2) }
const caminho = join(homedir(), '.desbravaclube-prod.env')
const bruto = readFileSync(caminho, 'utf8')
const bom = bruto.startsWith('\uFEFF') ? '\uFEFF' : ''
const texto = bruto.replace(/^\uFEFF/, '')
const m = texto.match(/DB_URL_PRODUCAO=(["']?)([^"'\r\n]+)\1/)
const tk = texto.match(/SUPABASE_ACCESS_TOKEN=(["']?)([^"'\r\n]+)\1/)
if (!m || !tk) { console.error('env sem DB_URL_PRODUCAO/SUPABASE_ACCESS_TOKEN'); process.exit(2) }
const url = new URL(m[2])
const antiga = decodeURIComponent(url.password)
const nova = randomBytes(24).toString('hex') // 48 caracteres hex: sem símbolos que quebrem URL
const urlNova = new URL(m[2]); urlNova.password = nova
const textoNovo = texto.replace(m[0], `DB_URL_PRODUCAO=${m[1]}${urlNova.toString()}${m[1]}`)
const novoPath = caminho + '.novo'
writeFileSync(novoPath, bom + textoNovo, { mode: 0o600 })

const tenta = (pw) => spawnSync('psql', ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1) || 'postgres', '-X', '-A', '-t', '-c', 'select 1'],
  { env: { ...process.env, PGPASSWORD: pw, PGCONNECT_TIMEOUT: '15' }, encoding: 'utf8' }).status === 0
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('antes: antiga aceita =', tenta(antiga))
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/password`, { method: 'PATCH', headers: { Authorization: `Bearer ${tk[2]}`, 'content-type': 'application/json' }, body: JSON.stringify({ password: nova }) })
console.log('PATCH database/password: HTTP', r.status)
if (r.status !== 200) { rmSync(novoPath, { force: true }); console.error('FALHOU: env original intacto'); process.exit(1) }
let ok = false
for (let i = 0; i < 12 && !ok; i++) { await dorme(5000); ok = tenta(nova) }
console.log('nova ACEITA =', ok)
if (!ok) { console.error('ATENÇÃO: a nova não foi aceita ainda; o arquivo .novo foi mantido (não perca). Nada foi apagado.'); process.exit(1) }
await dorme(3000)
console.log('antiga RECUSADA =', !tenta(antiga))
renameSync(novoPath, caminho)
console.log('arquivo de ambiente atualizado =', existsSync(caminho) && !existsSync(novoPath))
