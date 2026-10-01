// PASSO 5-REAL — aplica a janela na PRODUÇÃO REAL. Só roda depois de autorização explícita do dono.
// Cada arquivo é uma transação isolada, papel postgres via pooler, ledger gravado na mesma transação
// (mesmo princípio de scripts/lib/aplicar.mjs, adaptado de docker exec para conexão de rede direta).
// Para no primeiro erro. Nunca tenta corrigir e continuar.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DB_URL = process.env.DB_URL_PRODUCAO
if (!DB_URL) throw new Error('faltou DB_URL_PRODUCAO no ambiente')

const MIG = 'supabase/migrations'
const EVID = 'supabase/e2e/evidencias-migracao-real-producao'
mkdirSync(EVID, { recursive: true })

function psql(sql, { singleTransaction = true } = {}) {
  const args = ['run', '--rm', '-i', 'postgres:17', 'psql', DB_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1']
  if (singleTransaction) args.push('--single-transaction')
  return execFileSync('docker', args, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}
function psqlLer(sql) {
  return execFileSync('docker', ['run', '--rm', '-i', 'postgres:17', 'psql', DB_URL, '-X', '-q', '-A', '-F', '\t'],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function preflight() {
  const sql = `begin transaction read only;\n${readFileSync('supabase/PREFLIGHT-PRODUCAO.sql', 'utf8')}\ncommit;`
  return psqlLer(sql).split('\n').filter(Boolean)
}

console.log('# PASSO 5-REAL — migração da produção real')
console.log(`data/hora: ${new Date().toISOString()}`)

const RETOMAR = process.env.RETOMAR_DE // ex.: 20260921000020 — pula pré-voo/pré-janela, já aplicados

if (!RETOMAR) {
  console.log('\n== pré-voo ANTES (produção real, leitura) ==')
  const pre1 = preflight()
  writeFileSync(join(EVID, 'preflight-antes-producao.txt'), pre1.join('\n'))
  console.log(pre1.filter((l) => /^PROBLEMA|^RESUMO/.test(l)).join('\n'))

  console.log('\n== aplicando o pré-janela na PRODUÇÃO REAL ==')
  psql(readFileSync('scripts/pre-janela-conquista.sql', 'utf8').replace(/\r\n/g, '\n'))
  console.log('   ok, sem erro')

  console.log('\n== aplicando a remoção do Cartão de Classe na PRODUÇÃO REAL ==')
  psql(readFileSync('scripts/remover-cartao-de-classe-legado.sql', 'utf8').replace(/\r\n/g, '\n'))
  console.log('   ok, sem erro')

  console.log('\n== pré-voo DEPOIS do pré-janela (produção real) ==')
  const pre2 = preflight()
  writeFileSync(join(EVID, 'preflight-depois-pre-janela-producao.txt'), pre2.join('\n'))
  console.log(pre2.filter((l) => /^PROBLEMA|^RESUMO/.test(l)).join('\n'))
  const linhasProblema = pre2.filter((l) => /\tPROBLEMA\t/.test(l) && !l.startsWith('RESUMO'))
  const soFalsoPositivoConhecido = linhasProblema.length === 1 && /funcoes-legadas-ausentes-ou-com-assinatura-diferente/.test(linhasProblema[0]) && /listar_usuarios/.test(linhasProblema[0])
  if (linhasProblema.length > 0 && !soFalsoPositivoConhecido) {
    console.error('PROBLEMA NOVO NA PRODUÇÃO REAL — ABORTANDO, NÃO aplico as migrations:')
    console.error(linhasProblema.join('\n'))
    process.exit(1)
  }
  console.log(soFalsoPositivoConhecido ? '   único PROBLEMA é o falso positivo já conhecido (listar_usuarios) — segue' : '   nenhum PROBLEMA — segue')
} else {
  console.log(`\n== RETOMANDO de ${RETOMAR} — pré-voo/pré-janela já aplicados numa rodada anterior, ledger confirma ==`)
}

console.log('\n== aplicando as 86 migrations SaaS NA PRODUÇÃO REAL ==')
let todas = readdirSync(MIG).filter((f) => f.endsWith('.sql') && f.split('_')[0] >= '20260921000001').sort()
if (RETOMAR) todas = todas.filter((f) => f.split('_')[0] >= RETOMAR)
const duracoes = []
let falhou = null
for (const f of todas) {
  const [version, ...resto] = f.replace(/\.sql$/, '').split('_')
  let corpo = readFileSync(join(MIG, f), 'utf8').replace(/\r\n/g, '\n')
  const sql = `${corpo}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${resto.join('_')}', array[]::text[]);\n`
  const t0 = Date.now()
  try {
    psql(sql)
    const ms = Date.now() - t0
    duracoes.push({ f, ok: true, ms })
    console.log(`   OK  ${f}  (${ms}ms)`)
  } catch (e) {
    const ms = Date.now() - t0
    const erro = (e.stderr || e.message || '').toString().split('\n').find((l) => /ERROR/.test(l)) || String(e.message || e)
    duracoes.push({ f, ok: false, ms, erro })
    falhou = { f, erro }
    console.error(`   FALHOU  ${f}  (${ms}ms)\n   ${erro}`)
    break
  }
}
writeFileSync(join(EVID, 'duracoes-migrations-producao.json'), JSON.stringify(duracoes, null, 1))

if (falhou) {
  console.error('\n=== PARADO — migration falhou na PRODUÇÃO REAL ===')
  console.error(`arquivo: ${falhou.f}`)
  console.error(`erro: ${falhou.erro}`)
  console.error('as migrations ANTERIORES a esta já estão aplicadas em produção (transações atômicas: cada uma aplicou tudo ou nada).')
  console.error('NÃO tentei corrigir automaticamente. Aguardando decisão humana.')
  process.exit(1)
}

const totalMs = duracoes.reduce((s, d) => s + d.ms, 0)
console.log(`\n${duracoes.length}/${todas.length} aplicadas na PRODUÇÃO REAL, total ${(totalMs / 1000).toFixed(1)}s`)
console.log('\n== JANELA REAL APLICADA. Prosseguir para verificação pós-migração. ==')
