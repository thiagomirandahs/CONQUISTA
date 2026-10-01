// CONTRATO REAL front × banco: quais RPCs cada versão do FRONT chama e se existem em cada versão do BANCO (consulta pg_proc).
//   node supabase/tests/compat/contrato-rpc-front.mjs <pasta-src-do-front> <banco> [<banco> ...]
//   ex.: front novo (src atual) contra o banco de PRODUÇÃO simulado (513) e o final (527); front antigo (eb897ef) contra o final.
// LOCAL apenas (docker exec no container local). Não toca produção. Só olha NOMES de RPC (argumentos conferidos à parte nos E2E de PostgREST).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const [, , pasta, ...bancos] = process.argv
if (!pasta || !bancos.length) { console.error('uso: contrato-rpc-front.mjs <src> <banco> [<banco>...]'); process.exit(2) }
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const arquivos = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? arquivos(p) : /\.(js|jsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [] })
const usados = new Map() // rpc -> arquivos
for (const f of arquivos(pasta)) {
  const t = readFileSync(f, 'utf8')
  for (const m of t.matchAll(/\brpc\(\s*['"`]([a-z0-9_]+)['"`]/g)) { if (!usados.has(m[1])) usados.set(m[1], new Set()); usados.get(m[1]).add(f.split(pasta).join('').split(String.fromCharCode(92)).join('/')) }
  // helpers locais do tipo rpc('nome') já cobertos acima; chamadas do tipo supabase.rpc(`x`) também
}
const psql = (db, q) => execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', db, '-X', '-q', '-A', '-t'], { input: q, encoding: 'utf8' }).trim()
console.log(`${usados.size} RPCs distintas chamadas por ${pasta}`)
for (const db of bancos) {
  const existentes = new Set(psql(db, `select proname from pg_proc where pronamespace = 'public'::regnamespace`).split(/\r?\n/))
  const faltam = [...usados.keys()].filter((r) => !existentes.has(r)).sort()
  console.log(`\n== banco ${db}: ${faltam.length === 0 ? 'TODAS as RPCs existem' : faltam.length + ' RPC(s) AUSENTE(S)'}`)
  for (const r of faltam) console.log(`   ausente: ${r}   (usada em: ${[...usados.get(r)].slice(0, 3).join(', ')})`)
}
