#!/usr/bin/env node
// =============================================================================
//  Fase 9, item 9 — DRILL DE MIGRATION no staging vivo (povoado, na versão N = 72).
//
//    versão N → backup → release (73, 74) → FALHA CONTROLADA → recuperação → release de novo → gates
//
//  Duas falhas, porque elas pedem recuperações diferentes, e o runbook precisa das duas:
//
//    F1  a migration ABORTA no meio (erro de SQL depois de já ter criado coluna e índice).
//        O SQL Editor executa cada migration numa transação só: nada fica pela metade. A prova é o
//        estado — a coluna e o índice não existem, o ledger não andou, o app segue na versão de
//        antes. Recuperação: nenhuma no banco; corrigir o arquivo e aplicar de novo.
//
//    F2  a migration COMMITA e ESTRAGA dado (um WHERE errado: suspende os membros de um clube e
//        apaga o caixa dele). Nada aborta; o SQL Editor diz "Success". É a falha que só a
//        conferência pega, e que só o backup desfaz. Recuperação: restore IN-PLACE do backup
//        feito antes da release, e a release (correta) de novo.
//
//  As migrations de drill (F1, F2) NÃO vivem em supabase/migrations: são geradas aqui, aplicadas no
//  staging e nunca entram no repositório nem no ledger.
//
//  Aplicação fiel à de produção: cada arquivo inteiro numa transação (`--single-transaction`, como
//  o SQL Editor), como o papel `postgres` (o mesmo do SQL Editor; não é superusuário), e o ledger
//  do CLI gravado NA MESMA transação — se a migration cai, o registro dela cai junto.
//
//  Uso:  SERVICE_ROLE_KEY=... node scripts/drill-migration.mjs
// =============================================================================
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { MANIFESTO_SQL } from './lib/manifesto.mjs'

const DB = 'supabase_db_CONQUISTA-STAGING'
const RELEASE = ['20260929000073_o-clube-do-ato-e-a-aba.sql', '20260929000074_mensalidade-unica-por-clube.sql']
const SENHA = 'Multiclube2026'

const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts })
const psql = (sql, { db = 'postgres', user = 'supabase_admin' } = {}) =>
  docker(['exec', '-i', DB, 'psql', '-U', user, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db], { input: sql }).trim()
const seg = (ms) => `${(ms / 1000).toFixed(1)}s`
const espera = (ms) => new Promise((res) => setTimeout(res, ms))
const versao = () => psql('select max(version) from supabase_migrations.schema_migrations;')
// O max() mente: no primeiro ensaio o ledger dizia 74 com a 73 FALTANDO (a 73 falhou, a 74 passou).
// A conferência de uma release é pelo CONJUNTO: todas as versões dela, uma por uma.
const temTodas = (versoes) => Number(psql(`select count(*) from supabase_migrations.schema_migrations where version in (${versoes.map((v) => `'${v}'`).join(',')});`)) === versoes.length
const VERSOES_DA_RELEASE = RELEASE.map((f) => f.split('_')[0])
const manifesto = () => JSON.parse(psql(MANIFESTO_SQL))

let falhas = 0
const ok = (n, c, d = '') => { console.log(c ? `   OK      ${n}` : `   FALHOU  ${n}${d ? `  [${d}]` : ''}`); if (!c) falhas++; return c }
const nota = (n) => console.log(`   ·       ${n}`)
const etapa = (n) => console.log(`\n-- ${n} --`)

// Aplica UM arquivo como o SQL Editor: tudo ou nada, como `postgres`, com o ledger na mesma transação.
function aplicar(nomeArquivo, corpo) {
  const [version, ...resto] = basename(nomeArquivo, '.sql').split('_')
  const sql = `${corpo}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${resto.join('_')}', array[]::text[]);\n`
  const t0 = Date.now()
  try {
    docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], { input: sql })
    return { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, erro: (e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) || e.message }
  }
}

// ---------------------------------------------------------------------------
//  A sonda funcional: o que a release muda, visto pela API, como as pessoas usam.
// ---------------------------------------------------------------------------
const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const pop = JSON.parse(readFileSync('supabase/e2e/populacao.staging.json', 'utf8'))
const C = pop.clubes
const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
async function comoNaAba(email, clube) {
  const { data, error } = await createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, opcoes).auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`${email}: ${error.message}`)
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { ...opcoes, global: { headers: { Authorization: `Bearer ${data.session.access_token}`, 'x-clube-atual': clube } } })
}
// Lia (A+B) publica no mural de B: recusado na 72, aceito depois da 73. É o efeito da release.
async function liaPublicaEmB(legenda) {
  const sb = await comoNaAba(pop.pessoas.ab.email, C.B)
  const { error } = await sb.from('fotos').insert({ url: `mural/${pop.pessoas.ab.id}-drill.jpg`, evento: 'Acampamento', legenda, autor_id: pop.pessoas.ab.id })
  return !error
}
// Bia (só B) ainda entra no clube dela? É o que a F2 quebra.
async function biaEntraEmB() {
  const sb = await comoNaAba(pop.pessoas.so_b.email, C.B)
  const { data } = await sb.rpc('meu_contexto')
  return (data?.vinculos || []).some((v) => v.club_id === C.B && v.status === 'ativo')
}
async function esperarApi() {
  for (let i = 0; i < 60; i++) {
    try {
      const a = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY } })
      const b = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY } })
      if (a.ok && b.ok) return true
    } catch { /* subindo */ }
    await espera(1000)
  }
  return false
}
const contaFotos = (legenda) => Number(psql(`select count(*) from public.fotos where legenda = '${legenda}';`))

// ===========================================================================
console.log('\n=== DRILL DE MIGRATION — staging vivo ===')
const marca = Date.now().toString(36)

etapa('0. versão N')
const N = versao()
ok(`o staging está na versão N = ${N} (a de antes da release)`, N === '20260928000072')
const M0 = manifesto()
nota(`${M0.contas} contas, ${M0.pessoas_multiclube} pessoas multi-clube, mensalidades ${JSON.stringify(M0.mensalidades)}`)
ok('na versão N, Lia (A+B) NÃO publica no mural de B — o defeito que a release corrige', !(await liaPublicaEmB(`drill-n-${marca}`)))

etapa('1. backup antes da release')
const saida = execFileSync('node', ['scripts/restaurar-staging.mjs', 'backup'], { encoding: 'utf8' })
const dirBackup = (saida.match(/→ (staging[\\/]backups[\\/][^ ]+) --/) || [])[1]
ok('backup feito (banco + arquivos do Storage + manifesto)', !!dirBackup, saida.slice(-200))
nota(dirBackup)
// uma escrita real ENTRE o backup e o incidente: é o que o restore vai custar
const sbAna = await comoNaAba(pop.pessoas.so_a.email, C.A)
await sbAna.from('fotos').insert({ url: `mural/${pop.pessoas.so_a.id}-drill.jpg`, evento: 'Acampamento', legenda: `entre-backup-e-incidente-${marca}`, autor_id: pop.pessoas.so_a.id })

etapa('2. a release: 73 e 74, uma por vez, como o SQL Editor')
for (const f of RELEASE) {
  const r = aplicar(f, readFileSync(join('supabase', 'migrations', f), 'utf8'))
  ok(`${f} aplicada (${seg(r.ms)})`, r.ok, r.erro)
}
ok('o ledger tem as DUAS versões da release (conferido por conjunto, não por max)', temTodas(VERSOES_DA_RELEASE))

etapa('3. F1 — uma migration que ABORTA no meio')
{
  const f1 = `-- DRILL F1: cria coluna, preenche, indexa... e erra no último comando
alter table public.fotos add column drill_f1 text;
update public.fotos set drill_f1 = 'x';
create index drill_f1_idx on public.fotos (drill_f1);
update public.unidades set nome_que_nao_existe = nome;`
  const r = aplicar('20260929000075_drill-f1-aborta.sql', f1)
  ok('o SQL Editor recusa a F1', !r.ok)
  nota(`erro: ${r.erro}`)
  const sobrou = psql(`select count(*) from information_schema.columns where table_name = 'fotos' and column_name = 'drill_f1';`)
    + '/' + psql(`select count(*) from pg_indexes where indexname = 'drill_f1_idx';`)
  ok('...e NADA dela ficou: nem a coluna, nem o índice (atomicidade provada pelo estado)', sobrou === '0/0', sobrou)
  ok('...o ledger não andou (a F1 não foi registrada)', versao() === '20260929000074' && temTodas(VERSOES_DA_RELEASE))
  ok('...e o app segue funcionando na versão de antes: Lia publica em B', await liaPublicaEmB(`drill-apos-f1-${marca}`))
  nota('recuperação da F1: nenhuma no banco. Corrige-se o arquivo e aplica-se de novo numa próxima janela.')
}

etapa('4. F2 — uma migration que COMMITA e ESTRAGA dado')
const antesF2 = manifesto()
{
  const f2 = `-- DRILL F2: "padroniza status" e "limpa duplicatas" com o WHERE errado
update public.organization_memberships set status = 'suspenso'
 where organizational_unit_id = '${C.B}' and role = 'desbravador';
delete from public.mensalidades where club_id = '${C.B}';`
  const r = aplicar('20260929000076_drill-f2-estraga.sql', f2)
  ok('o SQL Editor ACEITA a F2 (nada aborta — é isso que a torna perigosa)', r.ok, r.erro)
  // o registro de drill não pode ficar no ledger (a F2 não existe no repositório)
  psql(`delete from supabase_migrations.schema_migrations where version = '20260929000076';`)
}
// uma escrita legítima DEPOIS do incidente, antes de alguém perceber
await sbAna.from('fotos').insert({ url: `mural/${pop.pessoas.so_a.id}-drill.jpg`, evento: 'Acampamento', legenda: `depois-do-incidente-${marca}`, autor_id: pop.pessoas.so_a.id })

etapa('5. detecção — a conferência pega o que o SQL Editor não pegou')
const depoisF2 = manifesto()
const diff = Object.keys(antesF2).filter((k) => JSON.stringify(antesF2[k]) !== JSON.stringify(depoisF2[k]) && k !== 'fotos')
ok('o manifesto acusa a diferença (vínculos e caixa de B)', diff.includes('vinculos_ativos') && diff.includes('mensalidades'), diff.join(','))
nota(`antes: vínculos ${JSON.stringify(antesF2.vinculos_ativos)}  mensalidades ${JSON.stringify(antesF2.mensalidades)}`)
nota(`agora: vínculos ${JSON.stringify(depoisF2.vinculos_ativos)}  mensalidades ${JSON.stringify(depoisF2.mensalidades)}`)
ok('a sonda de uso acusa: Bia (só B) perdeu o acesso ao próprio clube', !(await biaEntraEmB()))
nota('decisão: o caixa de B foi APAGADO — nenhuma migration corretiva traz de volta. Restore do backup de antes da release.')

etapa('6. recuperação — restore IN-PLACE do backup de antes da release')
const T0 = Date.now()
// O MESMO procedimento que o runbook manda executar: um comando, não passos soltos.
let saidaInPlace = ''
try {
  saidaInPlace = execFileSync('node', ['scripts/restaurar-staging.mjs', 'in-place', dirBackup], { encoding: 'utf8' })
} catch (e) { saidaInPlace = `${e.stdout || ''}${e.stderr || ''}` }
console.log(saidaInPlace.trim().split('\n').filter((l) => /OK|FALHOU|·/.test(l)).map((l) => `  ${l}`).join('\n'))
const T2 = Date.now()
ok('o restore in-place terminou sem nenhuma falha na própria conferência', !/FALHOU/.test(saidaInPlace))
ok('a API do staging responde depois do restore', await esperarApi())
ok('o staging voltou à versão N', versao() === N)
const M1 = manifesto()
const diverge = Object.keys(M0).filter((k) => JSON.stringify(M0[k]) !== JSON.stringify(M1[k]))
ok('o manifesto voltou IDÊNTICO ao de antes da release (vínculos, caixa, fotos, classes, documentos, Storage, policies…)', diverge.length === 0, diverge.join(','))
ok('Bia voltou a entrar em B', await biaEntraEmB())

etapa('7. RPO — o que o restore custou')
ok('a escrita ENTRE o backup e o incidente foi perdida', contaFotos(`entre-backup-e-incidente-${marca}`) === 0)
ok('a escrita DEPOIS do incidente foi perdida', contaFotos(`depois-do-incidente-${marca}`) === 0)
nota('as duas eram legítimas. É o custo do restore in-place: TUDO depois do backup. O runbook exige')
nota('backup IMEDIATAMENTE antes da release e janela sem uso — o produto não tem modo manutenção.')

etapa('8. a release de novo, a certa — e o efeito dela')
const T3 = Date.now()
for (const f of RELEASE) {
  const r = aplicar(f, readFileSync(join('supabase', 'migrations', f), 'utf8'))
  ok(`${f} reaplicada (${seg(r.ms)})`, r.ok, r.erro)
}
ok('o ledger tem as DUAS versões da release de novo', temTodas(VERSOES_DA_RELEASE))
ok('e agora Lia (A+B) publica no mural de B — a correção chegou aos dados reais', await liaPublicaEmB(`drill-final-${marca}`))
const T4 = Date.now()

console.log('\n==============================================================')
console.log(' TEMPOS OBSERVADOS (staging, banco de ~2 MB)')
console.log(`   restore in-place (banco + arquivos) ... ${seg(T2 - T0)}`)
console.log(`   release reaplicada + sonda ............ ${seg(T4 - T3)}`)
console.log(`   TOTAL da recuperação da F2 ............ ${seg(T4 - T0)}  (de "decidi restaurar" a "release certa no ar")`)
console.log(`\n RESULTADO: ${falhas === 0 ? 'DRILL OK' : `${falhas} FALHA(S)`}`)
console.log('==============================================================')
process.exit(falhas === 0 ? 0 : 1)
