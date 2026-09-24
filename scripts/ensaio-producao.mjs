#!/usr/bin/env node
// =============================================================================
//  Fase 9.1, itens 3 e 4 — ENSAIO DE PRODUÇÃO sobre uma CÓPIA, num ambiente DESCARTÁVEL.
//
//    backup de produção → ambiente descartável → restore → pré-voo → migrations do SaaS, uma por vez,
//    como o SQL Editor → verificações pós-upgrade → antes × depois linha a linha → suíte → Tenant 001
//
//  Nunca toca em produção: lê um ARQUIVO de backup que o dono baixou e restaura num terceiro stack
//  local (CONQUISTA-RESTORE, portas 56xxx, chave de assinatura própria), que é apagado no fim.
//
//    node scripts/ensaio-producao.mjs sintetico            # gera um "backup de produção" SINTÉTICO:
//                                                          # schema legado + dados vivos simulados
//                                                          # (supabase/tests/upgrade/pre_dados.sql)
//    node scripts/ensaio-producao.mjs ensaiar <arquivo>    # o ensaio inteiro sobre um backup
//         [--rotulo nome] [--manter] [--seguir]            #   --manter: não derruba o descartável (UAT no navegador)
//                                                          #   --seguir: continua mesmo com PROBLEMA no pré-voo
//                                                          #   --sabotar: PROVA NEGATIVA — estraga dado depois das
//                                                          #     migrations; o ensaio tem de dar NO-GO
//                                                          #   --uat (com --manter e ENSAIO_SENHA_UAT): deixa 4 contas
//                                                          #     reais da cópia com essa senha para a UAT no navegador
//    node scripts/ensaio-producao.mjs descartar
//
//  Formatos aceitos (scripts/lib/descartavel.mjs): .dump (pg_dump -Fc), .sql/.backup (SQL puro, é o
//  "Download" do painel do Supabase) e qualquer um deles em .gz.
//
//  O RELATÓRIO só tem números, nomes de tabela e nomes de verificação — nunca nome, e-mail ou
//  conteúdo de ninguém: o backup real tem dado de criança. Vai para
//  supabase/e2e/evidencias-fase9_1/ensaio-<rotulo>.{md,json}.
//
//  Veredito: ENSAIO OK só se TUDO passar. Diferença antes × depois que nenhuma regra explica
//  (scripts/lib/ensaio-regras.mjs) = NO-GO.
// =============================================================================
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  R_API, r, docker, psql, seg, provisionar, descartar, esperarApi, trocarBanco, conferirQueODeployContinua, restaurarArquivos,
} from './lib/descartavel.mjs'
import { aplicarComoSqlEditor, faltando } from './lib/aplicar.mjs'
import { SAAS, REGRAS, ENTIDADES } from './lib/ensaio-regras.mjs'

const DB = r('db')
const UAT = process.argv.includes('--uat')
if (UAT && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(process.env.ENSAIO_SENHA_UAT || '')) {
  console.log('--uat exige ENSAIO_SENHA_UAT com 8+ caracteres, letras e números'); process.exit(2)
}
const EVID = join('supabase', 'e2e', 'evidencias-fase9_1')
const MIG = join('supabase', 'migrations')

let falhas = 0
const linhas = []            // o relatório em markdown, montado enquanto roda
const checks = []            // { etapa, nome, ok, detalhe }
let etapaAtual = ''
const etapa = (n) => { etapaAtual = n; console.log(`\n-- ${n} --`); linhas.push(`\n### ${n}\n`) }
const nota = (n) => { console.log(`   ·       ${n}`); linhas.push(`- ${n}`) }
const ok = (n, c, d = '') => {
  console.log(c ? `   OK      ${n}` : `   FALHOU  ${n}${d ? `  [${d}]` : ''}`)
  linhas.push(`- ${c ? '✅' : '❌'} ${n}${!c && d ? ` — \`${String(d).slice(0, 200)}\`` : ''}`)
  checks.push({ etapa: etapaAtual, nome: n, ok: !!c, detalhe: c ? '' : String(d).slice(0, 300) })
  if (!c) falhas++
  return c
}

const admin = (sql) => psql(DB, sql)
const umValor = (sql) => admin(sql).split('\n').pop()
// roda um arquivo .sql no container (psql -f), com o papel escolhido; devolve a saída
function rodarArquivo(local, { usuario = 'supabase_admin', antes = '', depois = '', tuplas = true } = {}) {
  const corpo = `${antes}\n${readFileSync(local, 'utf8')}\n${depois}\n`
  return docker(['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', DB, 'psql', '-U', usuario, '-d', 'postgres', '-X', '-q',
    ...(tuplas ? ['-A', '-t', '-F', '\t'] : []), '-v', 'ON_ERROR_STOP=1'], { input: corpo }).trim()
}

// ---------------------------------------------------------------------------
//  sintetico — o "backup de produção" de mentira, para provar o ensaio antes do real chegar
// ---------------------------------------------------------------------------
async function sintetico() {
  const instante = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join('staging', 'backups', `producao-sintetica-${instante}`)
  mkdirSync(dir, { recursive: true })
  console.log(`\n-- BACKUP SINTÉTICO de produção → ${dir} --`)
  descartar()
  const chaves = provisionar()
  await esperarApi(chaves.anon)
  // produção está no estado LEGADO: as migrations 20260701..20260909 (os SQLs antigos, aplicados à
  // mão no SQL Editor, como `postgres`) e nenhuma do SaaS
  const legadas = readdirSorted(MIG).filter((f) => f.split('_')[0] < '20260921000001')
  for (const f of legadas) {
    const res = aplicarSemLedger(f)
    if (!res.ok) throw new Error(`legado ${f}: ${res.erro}`)
  }
  console.log(`   ·       ${legadas.length} migrations legadas aplicadas`)
  // dados vivos simulados — os mesmos do upgrade do run-tests.sh
  rodarArquivo(join('supabase', 'tests', 'upgrade', 'pre_dados.sql'), { usuario: 'postgres', tuplas: false })
  // produção nunca usou o CLI: não há ledger do CLI (supabase_migrations). O pior caso, de propósito.
  admin('drop schema if exists supabase_migrations cascade;')
  docker(['exec', DB, 'sh', '-c', 'pg_dump -U supabase_admin postgres | gzip -c > /tmp/banco.sql.gz'])
  docker(['cp', `${DB}:/tmp/banco.sql.gz`, join(dir, 'banco.sql.gz')])
  docker(['exec', DB, 'rm', '-f', '/tmp/banco.sql.gz'])
  console.log(`   ·       banco.sql.gz ${(statSync(join(dir, 'banco.sql.gz')).size / 1024).toFixed(0)} KB (SQL puro, como o download do painel)`)
  descartar()
  console.log(`\n   próximo passo: node scripts/ensaio-producao.mjs ensaiar ${join(dir, 'banco.sql.gz')} --rotulo sintetico`)
}
const readdirSorted = (d) => readdirSync(d).filter((f) => f.endsWith('.sql')).sort()
function aplicarSemLedger(f) {
  try {
    docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
      { input: readFileSync(join(MIG, f), 'utf8') })
    return { ok: true }
  } catch (e) { return { ok: false, erro: (e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) || e.message } }
}

// ---------------------------------------------------------------------------
//  ensaiar — o pipeline inteiro
// ---------------------------------------------------------------------------
async function ensaiar(arquivo, { rotulo, manter, seguir, arquivos, sabotar }) {
  if (!existsSync(arquivo)) throw new Error(`backup não encontrado: ${arquivo}`)
  const T = { inicio: Date.now() }
  linhas.push(`# Ensaio de produção — ${rotulo}`, '',
    `Backup: \`${basename(arquivo)}\` (${(statSync(arquivo).size / 1024).toFixed(0)} KB). Gerado por \`scripts/ensaio-producao.mjs\` em ${new Date().toISOString()}.`,
    'Só números: nenhum nome, e-mail ou conteúdo de pessoa entra neste relatório.')

  // ---- 1. ambiente descartável + restore ----
  etapa('1. Ambiente descartável e restore')
  descartar()
  const chaves = provisionar()
  T.provisionado = Date.now()
  nota(`stack descartável (CONQUISTA-RESTORE) no ar em ${seg(T.provisionado - T.inicio)}`)
  for (const s of ['auth', 'rest', 'storage']) docker(['stop', r(s)])
  const restore = trocarBanco(DB, arquivo)
  T.restore = Date.now()
  nota(`formato ${restore.formato}; ${restore.benignos.length} aviso(s) benigno(s) de restore (papel/schema da plataforma que o stack já tem)`)
  ok(`restore sem erro (${seg(T.restore - T.provisionado)})`, restore.erros.length === 0, restore.erros.slice(0, 3).join(' | '))
  conferirQueODeployContinua(DB, ok)
  if (arquivos) { docker(['start', r('storage')]); restaurarArquivos(r('storage'), arquivos) }
  for (const s of ['auth', 'rest', 'storage']) docker(['restart', r(s)])
  ok('auth, API e storage sobem sobre o banco restaurado', await esperarApi(chaves.anon))
  // Os jobs do pg_cron voltam com o backup e rodariam NA CÓPIA durante o ensaio (fechar leilão
  // vencido a cada 5 min, alertas...): mudariam dado entre o retrato de antes e o de depois, e a
  // diferença pareceria efeito de migration. Pausa o lançador (os jobs continuam cadastrados, iguais).
  try {
    admin(`alter system set cron.launch_active_jobs = off; select pg_reload_conf();`)
    nota('pg_cron pausado na cópia (cron.launch_active_jobs = off): nenhum job roda durante o ensaio; os cadastros dos jobs ficam intactos')
  } catch { nota('pg_cron ausente na cópia: nada a pausar') }

  // ---- 2. estado da cópia ----
  etapa('2. Em que estado a cópia está')
  const temLedger = umValor(`select to_regclass('supabase_migrations.schema_migrations') is not null;`) === 't'
  const aplicadas = temLedger ? admin(`select version from supabase_migrations.schema_migrations;`).split('\n').filter(Boolean) : []
  const pendentes = SAAS.filter((f) => !aplicadas.includes(f.split('_')[0]))
  const temSaas = umValor(`select to_regclass('public.organizational_units') is not null;`) === 't'
  nota(`ledger do CLI (supabase_migrations): ${temLedger ? `presente, ${aplicadas.length} versão(ões)` : 'AUSENTE'}`)
  nota(`migrations do SaaS pendentes: ${pendentes.length} de ${SAAS.length}`)
  ok('o estado é coerente: sem ledger, também sem nenhuma tabela do SaaS (nada aplicado à mão fora do ledger)',
    temLedger || !temSaas, 'organizational_units existe mas o ledger não: alguém aplicou migration do SaaS sem registrar')
  const contagensAntes = JSON.parse(rodarArquivo(join('supabase', 'infra', 'ensaio', 'retrato-antes.sql')).split('\n').pop())
  nota(`retrato de antes: ${Object.keys(contagensAntes).length} tabelas copiadas linha a linha`)

  // ---- 3. pré-voo (somente leitura, e PROVADO somente leitura) ----
  etapa('3. Pré-voo de produção (supabase/PREFLIGHT-PRODUCAO.sql)')
  let saidaPre = ''
  try {
    saidaPre = rodarArquivo(join('supabase', 'PREFLIGHT-PRODUCAO.sql'), { usuario: 'postgres', antes: 'begin transaction read only;', depois: 'rollback;' })
  } catch (e) { saidaPre = ''; ok('o pré-voo roda numa transação SOMENTE LEITURA', false, (e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l))) }
  const pre = saidaPre.split('\n').filter(Boolean).map((l) => l.split('\t'))
  const resumo = pre.find((c) => c[0] === 'RESUMO')
  if (saidaPre) ok('o pré-voo roda numa transação SOMENTE LEITURA (não escreve nada)', !!resumo)
  const problemas = pre.filter((c) => c[1] === 'PROBLEMA' && c[0] !== 'RESUMO')
  const avisos = pre.filter((c) => c[1] === 'AVISO')
  nota(`RESUMO: ${resumo ? `${resumo[1]} — ${resumo[2]}` : 'ausente'}`)
  for (const c of problemas) nota(`PROBLEMA: ${c[0]}${c[2] ? ` — ${c[2].slice(0, 160)}` : ''}${c[3] ? ` → correção: ${c[3].slice(0, 200)}` : ''}`)
  for (const c of avisos) nota(`AVISO: ${c[0]}${c[2] ? ` — ${c[2].slice(0, 160)}` : ''}`)
  // A ÚNICA correção que o runbook manda aplicar antes da janela e que o ensaio reproduz: criar o
  // ledger do CLI quando o projeto nunca o teve (o pré-voo acusa e dá o SQL). Qualquer outro PROBLEMA
  // para o ensaio — é o que pararia a janela de verdade.
  const soLedger = problemas.length > 0 && problemas.every((c) => /ledger|supabase_migrations/i.test(c[0]))
  if (problemas.length && !soLedger && !seguir) {
    ok('pré-voo sem PROBLEMA (a janela real pararia aqui)', false, problemas.map((c) => c[0]).join(' | '))
    return fim(T, rotulo, manter)
  }
  ok('pré-voo sem PROBLEMA fora a criação do ledger (correção documentada)', problemas.length === 0 || soLedger || seguir,
    problemas.map((c) => c[0]).join(' | '))
  if (!temLedger) {
    execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
      input: `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);`, encoding: 'utf8',
    })
    nota('correção do pré-voo aplicada como `postgres` (o papel do SQL Editor): ledger do CLI criado, vazio')
  }

  // ---- 4. migrations, uma por vez, como o SQL Editor ----
  etapa(`4. Migrations do SaaS (${pendentes.length}), uma execução por arquivo, com o ledger na mesma transação`)
  T.migracoes0 = Date.now()
  let caiu = null
  for (const f of pendentes) {
    const res = aplicarComoSqlEditor(DB, f, readFileSync(join(MIG, f), 'utf8'))
    if (!res.ok) { caiu = { f, erro: res.erro }; break }
  }
  T.migracoes = Date.now()
  ok(`todas as ${pendentes.length} migrations aplicaram (${seg(T.migracoes - T.migracoes0)})`, !caiu, caiu && `${caiu.f}: ${caiu.erro}`)
  if (caiu) return fim(T, rotulo, manter)
  if (sabotar) {
    // PROVA NEGATIVA do próprio ensaio: uma "migration" que commita e estraga (a F2 do runbook) —
    // um caixa que vira pendente, uma foto apagada, um membro suspenso. O SQL Editor diria "Success".
    // O ensaio TEM de terminar em NO-GO apontando as três.
    execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], {
      encoding: 'utf8', input: `
update public.mensalidades set status = 'pendente' where id = (select id from public.mensalidades where status = 'pago' order by id limit 1);
delete from public.fotos where id = (select id from public.fotos order by id limit 1);
update public.organization_memberships set status = 'suspenso' where id = (select id from public.organization_memberships where status = 'ativo' and role = 'desbravador' order by id limit 1);`,
    })
    nota('SABOTAGEM aplicada (prova negativa): 1 mensalidade paga → pendente, 1 foto apagada, 1 desbravador ativo → suspenso')
  }
  const falta = faltando(DB, SAAS.map((f) => f.split('_')[0]))
  ok('ledger conferido pelo CONJUNTO (não pelo max): nenhuma versão faltando', falta.length === 0, falta.join(','))
  conferirQueODeployContinua(DB, ok)

  // ---- 5. antes × depois ----
  etapa('5. Antes × depois — entidades críticas')
  linhas.push('', '| entidade | antes | depois | esperado |', '|---|---:|---:|---|')
  for (const e of ENTIDADES) {
    let a = 'n/d'; let d = 'n/d'
    try { a = umValor(e.antes) } catch { /* tabela não existia antes */ }
    try { d = umValor(e.depois) } catch { /* idem */ }
    const bate = a !== 'n/d' && d !== 'n/d' && Number(a) === Number(d)
    linhas.push(`| ${e.nome} | ${a} | ${d} | ${bate ? '✅ igual' : '❌ DIFERENTE'}${e.porque ? ` — ${e.porque}` : ''} |`)
    console.log(`   ${bate ? 'OK     ' : 'FALHOU '}  ${e.nome.padEnd(48)} antes ${String(a).padStart(8)}  depois ${String(d).padStart(8)}`)
    checks.push({ etapa: etapaAtual, nome: `${e.nome}: antes ${a}, depois ${d}`, ok: bate, detalhe: '' })
    if (!bate) falhas++
  }

  etapa('6. Antes × depois — linha a linha, coluna a coluna')
  const regrasSql = REGRAS.map((g) => `insert into ensaio_antes._regras (copia, tipo, coluna, onde, motivo, migration) values (${[g.copia, g.tipo, g.coluna ?? null, g.onde, g.motivo, g.migration]
    .map((v) => (v === null ? 'null' : `$q$${v}$q$`)).join(', ')});`).join('\n')
  admin(`truncate ensaio_antes._regras; ${regrasSql}`)
  const difs = JSON.parse(rodarArquivo(join('supabase', 'infra', 'ensaio', 'diferencas.sql')).split('\n').pop())
  const inexplicadas = difs.filter((x) => Number(x.explicadas) < Number(x.total))
  linhas.push('', '| tabela | diferença | coluna | linhas | explicadas | por quê |', '|---|---|---|---:|---:|---|')
  for (const x of difs) {
    linhas.push(`| ${x.copia} | ${x.tipo} | ${x.coluna || ''} | ${x.total} | ${x.explicadas} | ${x.motivos || '**sem regra**'} |`)
    console.log(`   ${Number(x.explicadas) === Number(x.total) ? 'explic.' : 'NÃO EXP'}  ${x.copia}.${x.coluna || '*'} ${x.tipo}: ${x.total} (${x.explicadas} explicadas)`)
  }
  if (!difs.length) nota('nenhuma diferença em linha que já existia')
  ok(`toda diferença em dado que já existia tem explicação (${difs.length} grupo(s), ${inexplicadas.length} sem explicação)`, inexplicadas.length === 0,
    inexplicadas.map((x) => `${x.copia}.${x.coluna || '*'} ${x.tipo} ${Number(x.total) - Number(x.explicadas)}`).join(' | '))
  const novas = admin(`select c.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from ensaio_antes._copias x where x.copia = c.relname) order by 1;`).split('\n').filter(Boolean)
  const comLinhas = novas.filter((x) => !x.endsWith('=0'))
  nota(`${novas.length} tabelas novas do SaaS; ${comLinhas.length} nascem com linhas (backfill ou semeadura da plataforma): ${comLinhas.join(', ')}`)

  // ---- 7. invariantes do upgrade ----
  etapa('7. Invariantes do upgrade (fora da RLS)')
  const legado = umValor('select public.clube_legado_id();')
  ok('o Tenant 001 existe (clube legado) e é um clube ativo', !!legado && umValor(`select count(*) from public.organizational_units where id = '${legado}' and type = 'clube' and status = 'ativo';`) === '1')
  const inv = (nome, sql) => { let n = null; try { n = Number(umValor(sql)) } catch (e) { return ok(nome, false, e.message.split('\n')[0]) } return ok(nome, n === 0, `${n} violação(ões)`) }
  inv('cada perfil de antes tem exatamente 1 vínculo de clube, e é no Tenant 001',
    `select count(*) from ensaio_antes.profiles p where (select count(*) from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube' where m.user_id = p.id) <> 1
       or not exists (select 1 from public.organization_memberships m where m.user_id = p.id and m.organizational_unit_id = '${legado}');`)
  inv('papel e situação de cada vínculo = os do perfil de antes (mapa das migrations 2 e 13)',
    `select count(*) from ensaio_antes.profiles p join public.organization_memberships m on m.user_id = p.id and m.organizational_unit_id = '${legado}'
      where m.role <> case when p.papel in ('desbravador','conselheiro','instrutor','diretoria','tesoureiro','pais') then p.papel when p.papel = 'responsavel' then 'pais' else 'desbravador' end
         or m.status <> case p.status when 'ativo' then 'ativo' when 'pendente' then 'pendente' when 'rejeitado' then 'encerrado' else 'suspenso' end;`)
  inv('a unidade de cada vínculo = a unidade do perfil de antes',
    `select count(*) from ensaio_antes.profiles p join public.organization_memberships m on m.user_id = p.id and m.organizational_unit_id = '${legado}'
      where p.unidade_id is not null and m.unidade_id is distinct from p.unidade_id;`)
  const tenantizadas = admin(`select c.copia from ensaio_antes._copias c where c.origem_schema = 'public'
      and exists (select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.origem_tabela and i.column_name = 'club_id')
      and not exists (select 1 from information_schema.columns i where i.table_schema = 'ensaio_antes' and i.table_name = c.copia and i.column_name = 'club_id') order by 1;`).split('\n').filter(Boolean)
  const foraDoLegado = tenantizadas.map((t) => [t, Number(umValor(`select count(*) from public.${t} x where x.club_id is distinct from '${legado}';`))]).filter(([, n]) => n > 0)
  ok(`as ${tenantizadas.length} tabelas antigas que ganharam club_id: toda linha é do Tenant 001`, foraDoLegado.length === 0, foraDoLegado.map(([t, n]) => `${t}:${n}`).join(' '))
  inv('todo objeto do Storage está no controle de uso do Tenant 001',
    `select count(*) from storage.objects o left join public.club_storage_objetos c on c.bucket_id = o.bucket_id and c.name = o.name where c.club_id is distinct from '${legado}';`)
  let reconc = null
  try { reconc = admin('begin; select public.reconciliar_perfis_dos_vinculos(); rollback;').split('\n').filter(Boolean).pop() } catch (e) { reconc = e.message.split('\n')[0] }
  ok('a reconciliação perfil × vínculo não tem nada a ajustar', reconc === '0', reconc)
  const recursos = Object.fromEntries(admin(`select feature || '=' || enabled from public.club_features where club_id = '${legado}';`).split('\n').filter(Boolean).map((l) => l.split('=')))
  nota(`recursos do Tenant 001 depois do upgrade: ${Object.entries(recursos).map(([k, v]) => `${k}${v === 'true' ? '' : ' (desligado)'}`).join(', ')}`)
  const testeNoLegado = Number(umValor(`select count(*) from public.experiences where club_id = '${legado}' and teste;`))
  const expLigado = recursos.experiencias === 'true'
  if (testeNoLegado) {
    ok(`as ${testeNoLegado} experiências [TESTE] que a migration 49 semeia no Tenant 001 NÃO ficam visíveis (recurso experiencias desligado)`, !expLigado)
  }

  // ---- 8. suíte de banco sobre a cópia ----
  etapa('8. Suíte de banco sobre a cópia atualizada (cada teste em transação com ROLLBACK)')
  suiteNaCopia()

  // ---- 9. Tenant 001 pela API ----
  etapa('9. Tenant 001 depois do upgrade — as jornadas do clube, pela API do descartável')
  await esperarApi(chaves.anon)   // a suíte derrubou as conexões do banco por um instante (clone)
  await smokeTenant001(chaves, legado)

  if (manter) {
    writeFileSync('.env.ensaio', `# GERADO por scripts/ensaio-producao.mjs — NÃO VERSIONAR. Aponta o front para o ambiente DESCARTÁVEL do ensaio.\nVITE_SUPABASE_URL=${R_API}\nVITE_SUPABASE_ANON_KEY=${chaves.anon}\n`)
    nota('.env.ensaio gerado: `npm run dev -- --port 4373 --strictPort --mode ensaio` abre o app sobre a cópia (UAT no navegador)')
  }
  return fim(T, rotulo, manter)
}

// A suíte SQL inteira (supabase/tests/*.sql) sobre a cópia. Cada teste cria as próprias pessoas e
// clubes e termina em ROLLBACK. Parte deles usa o Tenant 001 como o "clube A" do cenário e conta
// linhas EXATAS nele — numa cópia real o Tenant 001 já tem dado, e a conta não fecha. Esses estão em
// `COLIDE_COM_DADO_REAL`, com a ASSINATURA da colisão: o teste só é dado como "colisão" se TODAS as
// linhas de falha casarem com ela. Qualquer outra falha (ou uma falha nova num desses) = NO-GO.
// Todos eles rodam verdes no replay e no upgrade simulado (`run-tests.sh`), no mesmo commit.
const LEILAO = /leil[aã]o aberto|um_leilao_aberto_por_clube|cancela o leil/i
const CONTA = /obtido=.*esperado=|"Cadastro Pendente"/
const COLIDE_COM_DADO_REAL = {
  '01_leilao_cron_vs_manual.sql': [LEILAO, 'cria leilão no Tenant 001; a cópia já tem um aberto (1 por clube)'],
  '04_lider_tenant001.sql': [LEILAO, 'idem: leilão e temporada nova com leilão aberto no Tenant 001'],
  '05_lider_tenant002.sql': [LEILAO, 'idem'],
  '16_leilao_por_clube.sql': [new RegExp(`${CONTA.source}|${LEILAO.source}`, 'i'), 'cria leilão E conta itens, lances e avisos do Tenant 001'],
  '21_revisao_de_seguranca_rodada2.sql': [LEILAO, 'idem'],
  '24_oraculos_de_uuid.sql': [LEILAO, 'idem'],
  '26_contexto_do_clube.sql': [LEILAO, 'idem'],
  '53_leilao_rateio_conjunto.sql': [LEILAO, 'idem'],
  '55_matriz_multiclube.sql': [LEILAO, 'idem'],
  '56_gate_multiclube_permanente.sql': [LEILAO, 'idem'],
  '07_push_por_clube.sql': [CONTA, 'conta os aparelhos do Tenant 001: a cópia tem aparelhos reais'],
  '11_revisao_independente.sql': [CONTA, 'conta os arquivos do Storage do Tenant 001'],
  '12_regressoes_tenant001.sql': [new RegExp(`${CONTA.source}|${LEILAO.source}`, 'i'), 'conta mensalidades/mensagens do Tenant 001 e abre temporada'],
  '14_duelos_por_clube.sql': [CONTA, 'conta duelos e avisos do Tenant 001'],
  '15_missoes_e_devocional_por_clube.sql': [CONTA, 'conta missões pendentes do Tenant 001'],
  '17_jogos_por_clube.sql': [CONTA, 'conta o ranking/recordes do Tenant 001'],
  '18_jogos_cron_por_clube.sql': [CONTA, 'conta prêmios de rodada do Tenant 001'],
  '19_chat_bichinho_biblia_por_clube.sql': [CONTA, 'conta mensagens e bichinhos do Tenant 001'],
  '23_chat_mensagem_moderada.sql': [CONTA, 'conta mensagens apagadas do Tenant 001'],
  '25_imagens_privadas.sql': [CONTA, 'conta os objetos do Storage do Tenant 001'],
  '47_push_nativo_e_infra.sql': [CONTA, 'conta aparelhos do Tenant 001'],
  '49_armazenamento_por_clube.sql': [CONTA, 'conta objetos do Storage do Tenant 001'],
  '52_paginacao_keyset.sql': [/obtido=.*esperado=|mais RECENTES/, 'pagina o chat geral do Tenant 001, que já tem mensagens'],
  '57_entrada_em_clube.sql': [CONTA, 'a liderança do Tenant 001 vê o cadastro pendente REAL da cópia'],
  'multi_tenant_isolation.sql': [/seed local/, 'exige o seed de desenvolvimento (duas unidades organizacionais)'],
}
function suiteNaCopia() {
  let saida = ''
  try {
    saida = execFileSync('bash', ['supabase/tests/run-tests.sh', '--db', 'postgres', '--no-replay'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, SUPABASE_DB_CONTAINER: DB, MSYS_NO_PATHCONV: '1' },
    })
  } catch (e) { saida = `${e.stdout || ''}${e.stderr || ''}` }
  // blocos: "   FALHOU x.sql" seguido das linhas de detalhe (indentadas) até o próximo OK/FALHOU
  const blocos = []
  for (const l of saida.split('\n')) {
    const m = l.match(/^\s+(OK|FALHOU)\s+(\S+\.sql)/)
    if (m) blocos.push({ ok: m[1] === 'OK', nome: m[2], detalhe: [] })
    else if (blocos.length && /^\s{6,}\S/.test(l)) blocos[blocos.length - 1].detalhe.push(l.trim())
  }
  const colisao = (b) => {
    const c = COLIDE_COM_DADO_REAL[b.nome]
    const linhasDeFalha = b.detalhe.filter((l) => /^- |ERROR/.test(l) && !/FALHOU: \d+ de \d+ asserts/.test(l))
    return c && linhasDeFalha.length > 0 && linhasDeFalha.every((l) => c[0].test(l))
  }
  const verdes = blocos.filter((b) => b.ok)
  let colidem = blocos.filter((b) => !b.ok && colisao(b))
  const falhos = blocos.filter((b) => !b.ok && !colisao(b))
  // Segunda passada para os que só esbarram no leilão aberto (entre eles os gates multi-clube 55 e
  // 56): num CLONE da cópia atualizada, com o leilão aberto do Tenant 001 cancelado — a ação que um
  // operador faria. O resto do dado real fica. Se passarem lá, a colisão era só o leilão.
  const soLeilao = colidem.filter((b) => COLIDE_COM_DADO_REAL[b.nome][0] === LEILAO)
  if (soLeilao.length) {
    try {
      psql(DB, `alter database postgres allow_connections false;
        select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = 'postgres' and pid <> pg_backend_pid();
        drop database if exists ensaio_suite with (force);
        create database ensaio_suite template postgres owner postgres;`, 'template1')
    } finally { psql(DB, 'alter database postgres allow_connections true;', 'template1') }
    psql(DB, `update public.leiloes set status = 'cancelado' where status = 'aberto';`, 'ensaio_suite')
    let s2 = ''
    try {
      s2 = execFileSync('bash', ['supabase/tests/run-tests.sh', '--db', 'ensaio_suite', '--no-replay', ...soLeilao.map((b) => b.nome.replace(/\.sql$/, ''))], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SUPABASE_DB_CONTAINER: DB, MSYS_NO_PATHCONV: '1' },
      })
    } catch (e) { s2 = `${e.stdout || ''}${e.stderr || ''}` }
    psql(DB, 'drop database if exists ensaio_suite with (force);', 'template1')
    const verdesNoClone = new Set(s2.split('\n').map((l) => l.match(/^\s+OK\s+(\S+\.sql)/)?.[1]).filter(Boolean))
    for (const b of soLeilao) {
      if (verdesNoClone.has(b.nome)) { verdes.push({ ...b, ok: true, noClone: true }); colidem = colidem.filter((x) => x !== b) }
      else falhos.push({ ...b, detalhe: ['falhou também no clone com o leilão cancelado'] })
    }
    nota(`${verdesNoClone.size} de ${soLeilao.length} testes que só esbarravam no leilão aberto passam num clone da cópia com esse leilão cancelado (ação de operador): ${[...verdesNoClone].join(', ')}`)
  }
  ok(`suíte de banco na cópia: ${verdes.length} arquivos verdes, ${colidem.length} só colidem com contagem exata no Tenant 001, ${falhos.length} falha(s) de verdade`,
    blocos.length > 0 && falhos.length === 0, falhos.map((b) => b.nome).join(' '))
  for (const b of colidem) nota(`${b.nome}: colide com o dado real (${COLIDE_COM_DADO_REAL[b.nome][1]}) — verde no replay e no upgrade simulado`)
  for (const b of falhos) console.log(`      ${b.nome}\n        ${b.detalhe.slice(0, 5).join('\n        ')}`)
}

// As jornadas do Tenant 001 (Login → Home → membros → unidades → pontos → jogos → chat →
// mensalidades → Gestão → classes/documentos), com pessoas REAIS da cópia, escolhidas pelo papel.
// A senha delas é trocada SÓ na cópia descartável (e é aleatória); o login é o de verdade, pelo Auth.
async function smokeTenant001(chaves, legado) {
  const escolher = (papel, extra = '') => umValor(`select m.user_id from public.organization_memberships m join auth.users u on u.id = m.user_id
     where m.organizational_unit_id = '${legado}' and m.role = '${papel}' and m.status = 'ativo' and u.email is not null ${extra}
     order by m.created_at, m.user_id limit 1;`)
  const quem = {
    diretoria: escolher('diretoria'),
    membro: escolher('desbravador', 'and m.unidade_id is not null'),
    responsavel: escolher('pais', `and exists (select 1 from public.responsaveis x where x.responsavel_id = m.user_id and x.status = 'aprovado')`),
    tesouraria: escolher('tesoureiro'),
  }
  const sintetico = umValor(`select count(*) from auth.users where id = md5('up:dir')::uuid;`) === '1'
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
  const sessoes = {}
  const contasUat = {}
  for (const [papel, id] of Object.entries(quem)) {
    if (!id) { nota(`${papel}: não há ninguém com esse papel ativo no Tenant 001 — jornada não aplicável`); continue }
    const email = umValor(`select email from auth.users where id = '${id}';`)
    // no sintético a senha de antes é conhecida: prova que o HASH voltou do backup e o Auth o aceita
    if (sintetico && papel === 'diretoria') {
      const { error } = await createClient(R_API, chaves.anon, opcoes).auth.signInWithPassword({ email, password: 'senha-antiga' })
      ok('diretoria entra com a senha de ANTES do upgrade (hash restaurado, Auth aceita)', !error, error?.message)
    }
    // --uat: a senha é a de ENSAIO_SENHA_UAT (quem roda escolhe), para abrir o app no navegador sobre
    // a cópia; as contas escolhidas vão para restore/uat-contas.json (dentro do descartável, apagado
    // com ele). Sem --uat, a senha é aleatória e ninguém a conhece.
    const senha = UAT ? process.env.ENSAIO_SENHA_UAT : `Ensaio-${randomBytes(9).toString('base64url')}9`
    if (UAT) contasUat[papel] = email
    admin(`update auth.users set encrypted_password = extensions.crypt('${senha}', extensions.gen_salt('bf')) where id = '${id}';`)
    const { data, error } = await createClient(R_API, chaves.anon, opcoes).auth.signInWithPassword({ email, password: senha })
    if (!ok(`Login — ${papel} entra pelo Auth do descartável`, !error && data?.user?.id === id, error?.message)) continue
    sessoes[papel] = createClient(R_API, chaves.anon, { ...opcoes, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } })
  }
  if (UAT) writeFileSync(join('restore', 'uat-contas.json'), JSON.stringify(contasUat, null, 2))
  const antes = (sql) => Number(umValor(sql))
  const d = sessoes.diretoria; const m = sessoes.membro; const p = sessoes.responsavel; const t = sessoes.tesouraria
  for (const [papel, sb] of Object.entries(sessoes)) {
    const { data: ctx, error } = await sb.rpc('meu_contexto')
    const v = ctx?.vinculos || []
    ok(`Home — ${papel}: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho`,
      !error && v.length === 1 && v[0].club_id === legado && ctx.clube_atual_id === legado, error?.message || `vinculos=${v.length}`)
  }
  if (d) {
    const { data: ctx } = await d.rpc('meu_contexto')
    const rec = ctx?.vinculos?.[0]?.recursos || {}
    ok('Home — os módulos que o clube usava seguem ligados (chat, jogos, mensalidades)', rec.chat === true && rec.jogos === true && rec.mensalidades === true, JSON.stringify(rec).slice(0, 120))
    const { data: us, error: e1 } = await d.rpc('listar_usuarios')
    ok('Membros — a diretoria lista todas as pessoas de antes (tela Usuários)', !e1 && (us || []).length === antes('select count(*) from ensaio_antes.profiles'), e1?.message || `vê ${(us || []).length}`)
    const { data: un, error: e2 } = await d.from('unidades').select('id')
    ok('Unidades — a diretoria vê as unidades de antes', !e2 && (un || []).length === antes('select count(*) from ensaio_antes.unidades'), e2?.message)
    const { data: pts, error: e3 } = await d.from('pontos').select('pontos')
    ok('Pontos — a diretoria vê a mesma soma de pontos de antes', !e3 && (pts || []).reduce((a, x) => a + x.pontos, 0) === antes('select coalesce(sum(pontos), 0) from ensaio_antes.pontos'), e3?.message)
    const { error: e4 } = await d.rpc('ranking_totais')
    ok('Pontos — o ranking abre', !e4, e4?.message)
    const { data: ms, error: e5 } = await d.from('mensalidades').select('id')
    ok('Mensalidades — a diretoria vê todas as mensalidades de antes', !e5 && (ms || []).length === antes('select count(*) from ensaio_antes.mensalidades'), e5?.message || `vê ${(ms || []).length}`)
    const { error: e6 } = await d.rpc('avaliacoes_pendentes')
    ok('Gestão — o painel de pendências abre', !e6, e6?.message)
    const { data: pend, error: e7 } = await d.rpc('listar_usuarios')
    ok('Gestão — os cadastros pendentes de antes seguem pendentes para a diretoria', !e7 && (pend || []).filter((x) => x.status === 'pendente').length === antes(`select count(*) from ensaio_antes.profiles where status = 'pendente'`), e7?.message)
  }
  if (t) {
    const { data: ms, error } = await t.from('mensalidades').select('valor,status')
    ok('Mensalidades — a tesouraria vê o mesmo caixa de antes', !error && (ms || []).filter((x) => x.status === 'pago').reduce((a, x) => a + Number(x.valor), 0) === antes(`select coalesce(sum(valor), 0) from ensaio_antes.mensalidades where status = 'pago'`), error?.message)
  }
  if (m) {
    const { data: pts, error: e1 } = await m.from('pontos').select('pontos')
    ok('Pontos — o membro vê os pontos do clube, como antes', !e1 && (pts || []).length === antes('select count(*) from ensaio_antes.pontos'), e1?.message || `vê ${(pts || []).length}`)
    const { data: cat, error: e2 } = await m.from('jogos_trilha').select('*')
    ok('Jogos — o catálogo de jogos do clube está lá', !e2 && (cat || []).length === antes('select count(*) from ensaio_antes.jogos_trilha'), e2?.message)
    const { error: e3 } = await m.rpc('meu_progresso_trilha')
    ok('Jogos — o progresso da trilha abre', !e3, e3?.message)
    const { error: e3b } = await m.rpc('ranking_trilha')
    ok('Jogos — o ranking dos jogos abre', !e3b, e3b?.message)
    const { data: geral } = await m.from('chat_conversas').select('id').eq('tipo', 'geral').maybeSingle()
    const { data: msgs, error: e4 } = geral ? await m.from('chat_mensagens_visiveis').select('id').eq('conversa_id', geral.id) : { data: [], error: null }
    const noGeral = antes(`select count(*) from ensaio_antes.chat_mensagens x join ensaio_antes.chat_conversas c on c.id = x.conversa_id where c.tipo = 'geral'`)
    ok('Chat — o membro lê o histórico do chat geral', !e4 && (msgs || []).length === noGeral, e4?.message || `vê ${(msgs || []).length} de ${noGeral}`)
    const { data: ctx } = await m.rpc('meu_contexto')
    const rec = ctx?.vinculos?.[0]?.recursos || {}
    const { data: cls, error: e5 } = await m.rpc('classes_disponiveis')
    if (rec.classes) {
      ok('Classes — a tela de classes abre', !e5, e5?.message)
    } else {
      // desligado: o Tenant 001 não usava classes. O catálogo é da plataforma (ler não expõe nada do
      // clube); o que o recurso desligado tem de barrar no SERVIDOR é começar uma classe.
      nota('Classes — recurso desligado no Tenant 001 (o produto antigo não tinha classes): jornada não aplicável')
      const alvo = (cls || [])[0]?.id || umValor('select id from public.classes order by ordem limit 1;')
      const { error } = await m.rpc('classe_iniciar', { p_class_id: alvo })
      ok('Classes — com o recurso desligado, o servidor RECUSA iniciar uma classe (não é só o menu que some)', !!error, 'classe iniciada com o recurso desligado')
    }
  }
  if (p) {
    const { data: filhos, error } = await p.rpc('meus_filhos')
    const esperado = antes(`select count(*) from ensaio_antes.responsaveis x where x.responsavel_id = '${quem.responsavel}' and x.status = 'aprovado'`)
    ok('Responsável — "Meu filho" traz os filhos aprovados de antes', !error && (filhos || []).length === esperado, error?.message || `vê ${(filhos || []).length} de ${esperado}`)
    const { data: pts } = await p.from('pontos').select('id')
    ok('Responsável — continua sem ver os pontos do clube', (pts || []).length === 0)
  }
  const docs = antes('select count(*) from public.class_documents')
  nota(`Documentos — ${docs === 0 ? 'o produto antigo não emitia documento: nada a abrir (e o upgrade não inventou nenhum)' : `${docs} documento(s)`}`)
}

function fim(T, rotulo, manter) {
  T.fim = Date.now()
  const veredito = falhas === 0 ? 'ENSAIO OK' : `NO-GO — ${falhas} falha(s)`
  linhas.push('', '### Tempo', '', `- total ${seg(T.fim - T.inicio)}${T.migracoes ? ` (migrations ${seg(T.migracoes - T.migracoes0)})` : ''}`,
    '', `## Resultado: **${veredito}**`)
  console.log(`\n RESULTADO: ${veredito}  (${seg(T.fim - T.inicio)})`)
  mkdirSync(EVID, { recursive: true })
  const texto = linhas.join('\n') + '\n'
  // trava de privacidade: o relatório não pode carregar e-mail de ninguém
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(texto.replace(/noreply@anthropic\.com/g, ''))) throw new Error('o relatório tem algo com cara de e-mail — não gravado')
  writeFileSync(join(EVID, `ensaio-${rotulo}.md`), texto)
  writeFileSync(join(EVID, `ensaio-${rotulo}.json`), JSON.stringify({ rotulo, veredito, falhas, checks }, null, 2))
  console.log(` relatório: ${join(EVID, `ensaio-${rotulo}.md`)}`)
  if (!manter) { descartar(); console.log('   ·       ambiente descartável derrubado e apagado') }
  return falhas
}

// ---------------------------------------------------------------------------
const [cmd, ...resto] = process.argv.slice(2)
const opt = (n) => { const i = resto.indexOf(n); return i >= 0 ? resto[i + 1] : null }
if (cmd === 'sintetico') await sintetico()
else if (cmd === 'descartar') { descartar(); console.log('ambiente descartável derrubado') }
else if (cmd === 'ensaiar' && resto[0]) {
  const rotulo = (opt('--rotulo') || basename(resto[0]).replace(/\.(gz|sql|backup|dump)/g, '')).replace(/[^\w.-]+/g, '-')
  await ensaiar(resto[0], { rotulo, manter: resto.includes('--manter'), seguir: resto.includes('--seguir'), arquivos: opt('--arquivos'), sabotar: resto.includes('--sabotar') })
} else {
  console.log('uso: node scripts/ensaio-producao.mjs sintetico | ensaiar <backup> [--rotulo x] [--manter] [--seguir] [--arquivos storage.tgz] | descartar')
  process.exit(2)
}
process.exit(falhas === 0 ? 0 : 1)
