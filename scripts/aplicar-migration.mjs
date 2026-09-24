#!/usr/bin/env node
// =============================================================================
//  Aplica migrations PENDENTES no staging, uma por vez, do jeito que o runbook manda aplicar em
//  produção (supabase/infra/DEPLOY-E-RECUPERACAO.md, passo 7): cada arquivo numa transação só, como
//  `postgres`, com o ledger na mesma transação — e confere o ledger pelo CONJUNTO no fim.
//
//    node scripts/aplicar-migration.mjs          # lista o que falta e aplica, parando na primeira falha
//    node scripts/aplicar-migration.mjs --ver    # só lista o que falta
//
//  Só fala com o staging. Produção é pelo SQL Editor, com o mesmo texto (arquivo + linha do ledger).
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aplicarComoSqlEditor, faltando } from './lib/aplicar.mjs'

const DB = 'supabase_db_CONQUISTA-STAGING'
const todas = readdirSync(join('supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
const pendentes = faltando(DB, todas.map((f) => f.split('_')[0]))
const arquivos = todas.filter((f) => pendentes.includes(f.split('_')[0]))
console.log(`\n${arquivos.length} migration(s) pendente(s) no staging${arquivos.length ? ':' : ''}`)
for (const f of arquivos) console.log(`   ·  ${f}`)
if (process.argv.includes('--ver') || arquivos.length === 0) process.exit(0)

for (const f of arquivos) {
  const r = aplicarComoSqlEditor(DB, f, readFileSync(join('supabase', 'migrations', f), 'utf8'))
  console.log(`   ${r.ok ? 'OK    ' : 'FALHOU'}  ${f} (${(r.ms / 1000).toFixed(1)}s)${r.erro ? `  [${r.erro}]` : ''}`)
  if (!r.ok) { console.log('\nParado na primeira falha. Nada desta migration ficou (transação única).'); process.exit(1) }
}
const resto = faltando(DB, todas.map((f) => f.split('_')[0]))
console.log(resto.length === 0 ? '\nLedger conferido pelo conjunto: nada pendente.' : `\nAINDA FALTAM: ${resto.join(', ')}`)
process.exit(resto.length === 0 ? 0 : 1)
