#!/usr/bin/env node
// =============================================================================
//  Fase 9.1, item 2 — o PRÉ-VOO de produção testado pelos DOIS lados.
//
//  Positivo: no estado legado com dados vivos simulados (as migrations 20260701..20260909 +
//  supabase/tests/upgrade/pre_dados.sql — o mesmo "produção de mentira" do upgrade simulado), o
//  PREFLIGHT-PRODUCAO.sql roda numa transação SOMENTE LEITURA, como `postgres`, e dá RESUMO ok.
//
//  Negativo: para cada caso de supabase/tests/upgrade/preflight-casos.mjs, numa transação que termina
//  em ROLLBACK, estraga UMA pré-condição (tira uma tabela/coluna/função/privilégio que as migrations
//  usam, ou injeta o dado que as faria falhar) e exige que a verificação certa diga PROBLEMA (ou
//  AVISO, quando é o que se espera) E que o RESUMO pare a janela. Um pré-voo que nunca fica
//  vermelho não prova nada.
//
//  Também confere que TODA verificação do pré-voo tem pelo menos um caso negativo aqui — exceto as
//  listadas, com o motivo, em SEM_CASO_LOCAL (o mínimo possível) — e prova o BLOCO À PARTE do fim do
//  PREFLIGHT (a colagem do pacote curricular da 40 e da 43): o literal íntegro dá 0 linhas, um
//  caractere trocado dá 1.
//
//    node scripts/testar-preflight.mjs            # container supabase_db_CONQUISTA (ou SUPABASE_DB_CONTAINER)
//    node scripts/testar-preflight.mjs --manter   # mantém o banco preflight_neg para investigar
//
//  Só local: cria e apaga um banco próprio (preflight_neg) no container indicado.
// =============================================================================
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as casos from '../supabase/tests/upgrade/preflight-casos.mjs'

const { CASOS } = casos
const SEM_CASO_LOCAL = casos.SEM_CASO_LOCAL || {}

const C = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const DB = process.env.PREFLIGHT_DB || 'preflight_neg'
const MIG = join('supabase', 'migrations')
const PREFLIGHT = readFileSync(join('supabase', 'PREFLIGHT-PRODUCAO.sql'), 'utf8')

const psql = (sql, { db = DB, usuario = 'supabase_admin', tuplas = true } = {}) =>
  execFileSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', C, 'psql', '-U', usuario, '-d', db, '-X', '-q',
    ...(tuplas ? ['-A', '-t', '-F', '\t'] : []), '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim()

let falhas = 0
const ok = (n, c, d = '') => { console.log(c ? `   OK      ${n}` : `   FALHOU  ${n}${d ? `  [${d}]` : ''}`); if (!c) falhas++; return c }

// o mesmo preparo do run-tests.sh: clona a camada de PLATAFORMA do banco de trabalho e zera o resto
function montarLegado() {
  psql(`alter database postgres allow_connections false;
select count(pg_terminate_backend(pid)) from pg_stat_activity where datname in ('postgres', '${DB}') and pid <> pg_backend_pid();
drop database if exists ${DB} with (force);
create database ${DB} template postgres owner postgres;
alter database postgres allow_connections true;`, { db: 'template1' })
  psql(`drop schema public cascade;
create schema public authorization pg_database_owner;
grant usage on schema public to public, postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant execute on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
truncate auth.users cascade;
truncate storage.objects, storage.buckets cascade;
do $$ begin if to_regclass('supabase_migrations.schema_migrations') is not null then truncate supabase_migrations.schema_migrations; end if; end $$;
do $$ begin if to_regclass('cron.job') is not null then delete from cron.job; end if; end $$;`)
  const legadas = readdirSync(MIG).filter((f) => f.endsWith('.sql') && f.split('_')[0] < '20260921000001').sort()
  for (const f of legadas) {
    execFileSync('docker', ['exec', '-i', C, 'psql', '-U', 'postgres', '-d', DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
      // LF, como o SQL Editor recebe pelo navegador (o checkout Windows tem CRLF no disco; o caso
      // negativo do fim de linha injeta o CR de propósito)
      { input: readFileSync(join(MIG, f), 'utf8').replace(/\r\n/g, '\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  }
  psql(readFileSync(join('supabase', 'tests', 'upgrade', 'pre_dados.sql'), 'utf8'), { usuario: 'postgres', tuplas: false })
  // produção nunca usou o CLI: sem o ledger dele (o pré-voo tem de acusar isso — é um dos casos)
  psql('drop schema if exists supabase_migrations cascade;')
  return legadas.length
}

// roda o pré-voo e devolve as linhas [verificacao, status, detalhe, correcao?]
function preflight({ sabotagem = null } = {}) {
  const corpo = sabotagem
    ? `begin;\n${sabotagem}\n;\nset local role postgres;\n${PREFLIGHT}\n;\nrollback;`
    : `begin transaction read only;\nset local role postgres;\n${PREFLIGHT}\n;\nrollback;`
  return psql(corpo).split('\n').filter(Boolean).map((l) => l.split('\t'))
}

console.log(`\n-- estado legado + dados vivos simulados em ${C}/${DB} --`)
const n = montarLegado()
console.log(`   ·       ${n} migrations legadas + pre_dados.sql`)

console.log('\n-- positivo: o legado limpo (com o ledger do CLI criado, como manda o runbook) --')
psql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
grant usage on schema supabase_migrations to postgres; grant all on supabase_migrations.schema_migrations to postgres;`)
const limpo = preflight()
const resumo = limpo.find((l) => l[0] === 'RESUMO')
ok('o pré-voo roda numa transação SOMENTE LEITURA, como postgres', !!resumo)
ok(`RESUMO ok no legado limpo (${resumo?.[2] || '?'})`, resumo?.[1] === 'ok', limpo.filter((l) => l[1] === 'PROBLEMA').map((l) => l[0]).join(' | '))
const verificacoes = limpo.filter((l) => l[0] !== 'RESUMO').map((l) => l[0])
console.log(`   ·       ${verificacoes.length} verificações`)
for (const l of limpo.filter((x) => x[1] === 'AVISO')) console.log(`   ·       AVISO no legado limpo: ${l[0]} — ${(l[2] || '').slice(0, 110)}`)

console.log(`\n-- negativos: ${CASOS.length} casos, cada um numa transação com ROLLBACK --`)
const cobertas = new Set()
for (const caso of CASOS) {
  let linhas
  try { linhas = preflight({ sabotagem: caso.sabotagem }) } catch (e) {
    ok(`${caso.nome}`, false, `o pré-voo QUEBROU em vez de acusar: ${(e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l))}`); continue
  }
  const alvo = linhas.find((l) => l[0] !== 'RESUMO' && caso.verificacao.test(l[0]))
  const esperado = caso.esperado || 'PROBLEMA'
  const r = linhas.find((l) => l[0] === 'RESUMO')
  const passou = ok(`${caso.nome} → ${esperado}${esperado === 'PROBLEMA' ? ' e RESUMO para a janela' : ''}${caso.detalhe ? ` (detalhe ${caso.detalhe})` : ''}`,
    !!alvo && alvo[1] === esperado && (esperado !== 'PROBLEMA' || r?.[1] === 'PROBLEMA') && (!caso.detalhe || caso.detalhe.test(alvo[2] || '')),
    alvo ? `${alvo[0]} = ${alvo[1]}; RESUMO = ${r?.[1]}; ${(alvo[2] || '').slice(0, 160)}` : 'nenhuma verificação casou')
  // só conta para a cobertura o caso que de fato deixou a verificação vermelha ('ok' prova o caminho de volta)
  if (passou && esperado !== 'ok') cobertas.add(alvo[0])
  if (alvo && esperado !== 'ok') ok(`   ...e a linha diz como corrigir`, (alvo[2] || '').length + (alvo[3] || '').length > 10)
}

console.log('\n-- bloco à parte: a colagem do pacote curricular (40 e 43) --')
const bloco = PREFLIGHT.match(/select 'pacote colado difere[\s\S]*?;/)?.[0]
ok('o PREFLIGHT traz o BLOCO À PARTE, em comentário (fora da consulta única)', !!bloco && /\/\*[\s\S]*select 'pacote colado difere[\s\S]*\*\//.test(PREFLIGHT))
for (const f of readdirSync(MIG).filter((x) => /^20260921000040_|^20260921000043_/.test(x))) {
  const linha9 = readFileSync(join(MIG, f), 'utf8').split('\n')[8]
  const i = linha9.indexOf('$cq_manifesto$'), k = linha9.indexOf('$cq_manifesto$', i + 14)
  const literal = linha9.slice(i + 14, k)
  const rodar = (texto) => psql(bloco.replace('COLE AQUI O JSON DA LINHA 9', () => texto), { usuario: 'postgres' })
  ok(`${f.split('_')[0]}: a colagem íntegra (${literal.length} caracteres) volta 0 linhas`, i >= 0 && k > i && rodar(literal) === '')
  const trocado = literal.replace('"nome":"', () => '"nome":"_')
  ok(`${f.split('_')[0]}: um caractere trocado volta 1 linha (NÃO aplique)`, trocado !== literal && /difere/.test(rodar(trocado)))
}

console.log('\n-- cobertura: toda verificação tem caso negativo --')
for (const [v, motivo] of Object.entries(SEM_CASO_LOCAL)) {
  ok(`sem caso local: ${v} existe no pré-voo`, verificacoes.includes(v))
  console.log(`   ·       sem caso local: ${v} — ${motivo}`)
}
const sem = verificacoes.filter((v) => !cobertas.has(v) && !(v in SEM_CASO_LOCAL))
ok(`${verificacoes.length - sem.length} de ${verificacoes.length} verificações ficam vermelhas em pelo menos um caso (ou têm o motivo em SEM_CASO_LOCAL)`,
  sem.length === 0, sem.join(' | '))

if (!process.argv.includes('--manter')) psql(`drop database if exists ${DB} with (force);`, { db: 'template1' })
console.log(`\n RESULTADO: ${falhas === 0 ? 'PRÉ-VOO PROVADO (positivo e negativos)' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
