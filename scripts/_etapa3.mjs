// Etapa 3 — ensaio da migração real Conquista -> DesbravaClube, sobre o backup validado na Etapa 2,
// num ambiente descartável. NUNCA toca no Supabase real. Ver ETAPA-3-ENSAIO-MIGRACAO-REAL.md.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { provisionar, descartar, esperarApi, trocarBanco, conferirQueODeployContinua, docker, psql, seg } from './lib/descartavel.mjs'
import { aplicarComoSqlEditor, faltando } from './lib/aplicar.mjs'

const DB = 'supabase_db_CONQUISTA-RESTORE'
const BACKUP = 'backup-conquista-2026-09-24/database/banco-completo.dump'
const MIG = 'supabase/migrations'
const log = []
const say = (s) => { console.log(s); log.push(s) }
let falhas = 0
const ok = (n, c, d = '') => { say(c ? `   OK      ${n}` : `   FALHOU  ${n}${d ? `  [${d}]` : ''}`); if (!c) falhas++; return c }
const val = (sql) => psql(DB, sql).split('\n').pop()
const rodar = (arquivo, { usuario = 'postgres', tuplas = false } = {}) => {
  const corpo = readFileSync(arquivo, 'utf8').replace(/\r\n/g, '\n')
  return docker(['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', DB, 'psql', '-U', usuario, '-d', 'postgres', '-X', '-q',
    ...(tuplas ? ['-A', '-t', '-F', '\t'] : []), '-v', 'ON_ERROR_STOP=1', '--single-transaction'], { input: corpo }).trim()
}
const preflight = () => {
  const corpo = `begin transaction read only;\n${readFileSync('supabase/PREFLIGHT-PRODUCAO.sql', 'utf8')}\ncommit;`
  const saida = docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], { input: corpo }).trim()
  return saida.split('\n').filter(Boolean).map((l) => l.split('\t'))
}

async function restaurar(rotulo) {
  say(`\n== ${rotulo}: restaurando o backup real num ambiente descartável ==`)
  descartar()
  const chaves = provisionar()
  await esperarApi(chaves.anon)
  const T0 = Date.now()
  const { erros, benignos, formato } = trocarBanco(DB, BACKUP)
  ok(`restore do banco (${formato}, ${seg(Date.now() - T0)}, ${benignos.length} aviso(s) benigno(s))`, erros.length === 0, erros.slice(0, 5).join(' | '))
  conferirQueODeployContinua(DB, ok)
  return chaves
}

// =============================================================================
say('# Etapa 3 — RUN 1: reproduzir o defeito (sem a remoção do Cartão de Classe)')
// =============================================================================
await restaurar('RUN 1')
say('\n-- pré-voo ANTES do pré-janela (mesmo do inventário da Etapa 1, agora como postgres de verdade) --')
let pv = preflight()
let resumo = pv.find((l) => l[0] === 'RESUMO')
say(`   RESUMO: ${resumo?.[1]} — ${resumo?.[2]}`)
for (const l of pv.filter((x) => x[1] === 'PROBLEMA')) say(`   PROBLEMA  ${l[0]}: ${(l[2] || '').slice(0, 200)}`)

say('\n-- aplicando o pré-janela: ledger do CLI + os 3 SQLs legados nunca rodados neste projeto (SEM ainda tocar no Cartão de Classe) --')
rodar('scripts/pre-janela-conquista.sql', { usuario: 'postgres' })
say('   ok, sem erro (é o mesmo texto que vai para o SQL Editor de produção)')

pv = preflight()
resumo = pv.find((l) => l[0] === 'RESUMO')
say(`\n-- pré-voo DEPOIS do pré-janela --\n   RESUMO: ${resumo?.[1]} — ${resumo?.[2]}`)
for (const l of pv.filter((x) => x[1] === 'PROBLEMA')) say(`   PROBLEMA  ${l[0]}: ${(l[2] || '').slice(0, 300)}`)
for (const l of pv.filter((x) => x[1] === 'AVISO')) say(`   AVISO     ${l[0]}: ${(l[2] || '').slice(0, 160)}`)

say('\n-- auditoria de dependência do Cartão de Classe legado (classe_requisitos/requisito_cumprido), na cópia real --')
const dep1 = psql(DB, `select pg_describe_object(d.classid, d.objid, d.objsubid) as objeto, d.deptype
  from pg_depend d where d.refobjid in ('public.classe_requisitos'::regclass, 'public.requisito_cumprido'::regclass)
    or d.refobjid in (select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('avaliar_requisito','marcar_requisito','desmarcar_requisito'))
  order by 1;`)
say(dep1 ? dep1.split('\n').map((l) => '   ' + l).join('\n') : '   (nenhuma linha)')
const dep2 = psql(DB, `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname not in ('avaliar_requisito','marcar_requisito','desmarcar_requisito')
    and (p.prosrc ~* '\\mclasse_requisitos\\M' or p.prosrc ~* '\\mrequisito_cumprido\\M' or p.prosrc ~* '\\mavaliar_requisito\\M' or p.prosrc ~* '\\mmarcar_requisito\\M' or p.prosrc ~* '\\mdesmarcar_requisito\\M');`)
ok('nenhuma OUTRA função (fora do próprio Cartão de Classe) cita esses objetos no corpo', dep2.trim() === '', dep2)
const dep3 = psql(DB, `select conname, conrelid::regclass, confrelid::regclass from pg_constraint
   where contype = 'f' and (confrelid in ('public.classe_requisitos'::regclass,'public.requisito_cumprido'::regclass))
     and conrelid not in ('public.classe_requisitos'::regclass,'public.requisito_cumprido'::regclass);`)
ok('nenhuma FK de FORA apontando para as duas tabelas (FK delas para profiles é interna e cai junto no DROP TABLE)', dep3.trim() === '', dep3)
const linhas = psql(DB, `select (select count(*) from public.classe_requisitos) + (select count(*) from public.requisito_cumprido);`)
ok('0 linhas de dado nas duas tabelas (confirmado de novo nesta cópia)', linhas.trim() === '0', linhas)
say(`   ·       Dependência real (do pg_depend): só as 2 policies ("gerir classe_requisitos", "ler requisito_cumprido") e as 3 funções do próprio Cartão de Classe. Nada do motor curricular novo aparece — ele usa outras tabelas (class_requirements, member_classes, etc.), que não existem ainda nesta cópia (só entram na migration 36+).`)

say('\n-- tentando aplicar as migrations do SaaS (só as >= 20260921000001; a produção já tem o legado por outro caminho), para REPRODUZIR o abort (sem corrigir o Cartão de Classe) --')
const todas = readdirSync(MIG).filter((f) => f.endsWith('.sql') && f.split('_')[0] >= '20260921000001').sort()
say(`   ·       ${todas.length} migrations do SaaS (de ${todas[0]} a ${todas[todas.length - 1]})`)
let abortouEm = null
for (const f of todas) {
  const r = aplicarComoSqlEditor(DB, f, readFileSync(join(MIG, f), 'utf8'))
  if (!r.ok) { abortouEm = { f, erro: r.erro }; break }
}
ok('o abort aconteceu, e é o esperado (dependência do Cartão de Classe)', !!abortouEm && /pode_gerir|depend|cannot drop/i.test(abortouEm.erro || ''), abortouEm ? `${abortouEm.f}: ${abortouEm.erro}` : 'NADA abortou — inesperado')
say(`   ·       RUN 1 prova o defeito: ${abortouEm ? `${abortouEm.f} aborta com "${abortouEm.erro}"` : 'nenhum abort — o Cartão de Classe pode não ser mesmo um problema'}`)
descartar()

// =============================================================================
say('\n\n# Etapa 3 — RUN 2: correção testada (remove o Cartão de Classe legado) + migração completa, do zero')
// =============================================================================
await restaurar('RUN 2')
rodar('scripts/pre-janela-conquista.sql', { usuario: 'postgres' })
say('\n-- aplicando a remoção do Cartão de Classe (testada acima: só ele depende desses objetos) --')
rodar('scripts/remover-cartao-de-classe-legado.sql', { usuario: 'postgres' })
say('   ok, sem erro')

pv = preflight()
resumo = pv.find((l) => l[0] === 'RESUMO')
say(`\n-- pré-voo final, antes da janela --\n   RESUMO: ${resumo?.[1]} — ${resumo?.[2]}`)
// A ÚNICA exceção aceita: "funcoes-legadas...listar_usuarios assinatura diferente" é falso-positivo
// verificado (a migration 5 faz DROP FUNCTION antes de recriar, então funciona mesmo com a assinatura
// de 7 colunas que a produção real tem — comprovado rodando: RUN 1 aplicou as migrations 1..23 sem
// erro, incluindo a 5 e a 14). Qualquer OUTRO PROBLEMA continua parando a janela.
const problemasRestantes = pv.filter((l) => l[1] === 'PROBLEMA' && l[0] !== 'RESUMO')
const soFalsoPositivoConhecido = problemasRestantes.length === 1 && problemasRestantes[0][0] === 'funcoes-legadas-ausentes-ou-com-assinatura-diferente' && /listar_usuarios/.test(problemasRestantes[0][2] || '')
ok('RESUMO = ok, ou só o falso-positivo verificado de listar_usuarios (DROP+CREATE na migration 5)', resumo?.[1] === 'ok' || soFalsoPositivoConhecido, problemasRestantes.map((l) => l[0]).join(', '))
for (const l of pv.filter((x) => x[1] === 'AVISO')) say(`   AVISO     ${l[0]}: ${(l[2] || '').slice(0, 160)}`)

// ---- ANTES ----
say('\n-- retrato ANTES das migrations do SaaS (schema legado real) --')
const antes = {}
const contarAntes = (chave, sql) => { antes[chave] = val(sql); say(`   ${chave.padEnd(28)} ${antes[chave]}`) }
contarAntes('auth.users', 'select count(*) from auth.users;')
contarAntes('profiles', 'select count(*) from public.profiles;')
contarAntes('unidades', 'select count(*) from public.unidades;')
contarAntes('pontos_linhas', 'select count(*) from public.pontos;')
contarAntes('pontos_soma', 'select coalesce(sum(pontos),0) from public.pontos;')
contarAntes('mensalidades', 'select count(*) from public.mensalidades;')
contarAntes('atividades', 'select count(*) from public.atividades;')
contarAntes('entregas', 'select count(*) from public.entregas;')
contarAntes('eventos', 'select count(*) from public.eventos;')
contarAntes('chat_conversas', 'select count(*) from public.chat_conversas;')
contarAntes('chat_mensagens', 'select count(*) from public.chat_mensagens;')
contarAntes('jogos_trilha_catalogo', 'select count(*) from public.jogos_trilha;')
contarAntes('trilha_jogos', 'select count(*) from public.trilha_jogos;')
contarAntes('partidas', 'select count(*) from public.partidas;')
contarAntes('recordes', 'select count(*) from public.recordes;')
contarAntes('leiloes', 'select count(*) from public.leiloes;')
contarAntes('duelos', 'select count(*) from public.duelos;')
contarAntes('devocional', 'select count(*) from public.devocional;')
contarAntes('missoes_feitas', 'select count(*) from public.missoes_feitas;')
contarAntes('biblia_leituras', 'select count(*) from public.biblia_leituras;')
contarAntes('bichinhos', 'select count(*) from public.bichinhos;')
contarAntes('responsaveis', 'select count(*) from public.responsaveis;')
contarAntes('notificacoes', 'select count(*) from public.notificacoes;')
contarAntes('config_clube', 'select count(*) from public.config_clube;')
contarAntes('storage_objetos', 'select count(*) from storage.objects;')
contarAntes('storage_buckets', 'select count(*) from storage.buckets;')
contarAntes('cron_jobs', 'select count(*) from cron.job;')
contarAntes('funcoes_public', `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';`)
contarAntes('policies_public', `select count(*) from pg_policies where schemaname='public';`)
contarAntes('fks_public', `select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f';`)
contarAntes('ajudas', 'select count(*) from public.ajudas;')
contarAntes('push_tokens', 'select count(*) from public.push_tokens;')
contarAntes('orfaos_auth_sem_profile', `select count(*) from auth.users u left join public.profiles p on p.id=u.id where p.id is null;`)

// ---- MIGRATIONS ----
say('\n-- aplicando as migrations do SaaS, uma por uma, na ordem, com o ledger na mesma transação --')
const duracoes = []
let abortou = null
const T0 = Date.now()
for (const f of todas) {
  const t0 = Date.now()
  const r = aplicarComoSqlEditor(DB, f, readFileSync(join(MIG, f), 'utf8'))
  const dt = Date.now() - t0
  duracoes.push({ f, ok: r.ok, ms: dt })
  if (!r.ok) { abortou = { f, erro: r.erro }; break }
}
ok(`todas as ${todas.length} migrations aplicaram (${seg(Date.now() - T0)})`, !abortou, abortou ? `${abortou.f}: ${abortou.erro}` : '')
if (abortou) { say('\n PARADO: migration abortou. Nenhuma correção improvisada — encerrando o RUN 2 para investigação.'); writeFileSync('ETAPA-3-log.txt', log.join('\n')); process.exit(1) }
const faltam = faltando(DB, todas.map((f) => f.split('_')[0]))
ok('ledger conferido pelo CONJUNTO: nada faltando', faltam.length === 0, faltam.join(','))
conferirQueODeployContinua(DB, ok)
say(`   ·       as 5 migrations mais lentas: ${duracoes.sort((a, b) => b.ms - a.ms).slice(0, 5).map((d) => `${d.f} (${seg(d.ms)})`).join(', ')}`)

mkdir_etapa3()
function mkdir_etapa3() { try { mkdirSync('supabase/e2e/evidencias-etapa3', { recursive: true }) } catch { /* ok */ } }
writeFileSync('supabase/e2e/evidencias-etapa3/duracoes-migrations.json', JSON.stringify(duracoes, null, 1))

// ---- DEPOIS ----
say('\n-- retrato DEPOIS: o Tenant 001 (Conquista) dentro do DesbravaClube --')
const depois = {}
const contarDepois = (chave, sql) => { depois[chave] = val(sql); say(`   ${chave.padEnd(28)} ${depois[chave]}`) }
const legado = val('select public.clube_legado_id();')
contarDepois('clube_legado_existe', `select count(*) from public.organizational_units where id = '${legado}' and type='clube' and status='ativo';`)
contarDepois('auth.users', 'select count(*) from auth.users;')
contarDepois('organization_memberships_total', 'select count(*) from public.organization_memberships;')
contarDepois('memberships_no_legado', `select count(*) from public.organization_memberships where organizational_unit_id = '${legado}';`)
contarDepois('memberships_fora_do_legado', `select count(*) from public.organization_memberships where organizational_unit_id <> '${legado}';`)
contarDepois('unidades', `select count(*) from public.unidades where club_id = '${legado}';`)
contarDepois('unidades_fora_do_legado', `select count(*) from public.unidades where club_id <> '${legado}';`)
contarDepois('pontos_linhas', `select count(*) from public.pontos where club_id = '${legado}';`)
contarDepois('pontos_soma', `select coalesce(sum(pontos),0) from public.pontos where club_id = '${legado}';`)
contarDepois('pontos_fora_do_legado', `select count(*) from public.pontos where club_id <> '${legado}';`)
contarDepois('mensalidades', `select count(*) from public.mensalidades where club_id = '${legado}';`)
contarDepois('mensalidades_fora', `select count(*) from public.mensalidades where club_id <> '${legado}';`)
contarDepois('atividades', `select count(*) from public.atividades where club_id = '${legado}';`)
contarDepois('entregas', `select count(*) from public.entregas where club_id = '${legado}';`)
contarDepois('eventos', `select count(*) from public.eventos where club_id = '${legado}';`)
contarDepois('chat_mensagens', `select count(*) from public.chat_mensagens where club_id = '${legado}';`)
contarDepois('trilha_jogos', `select count(*) from public.trilha_jogos where club_id = '${legado}';`)
contarDepois('partidas', `select count(*) from public.partidas where club_id = '${legado}';`)
contarDepois('devocional', `select count(*) from public.devocional where club_id = '${legado}';`)
contarDepois('missoes_feitas', `select count(*) from public.missoes_feitas where club_id = '${legado}';`)
contarDepois('biblia_leituras', `select count(*) from public.biblia_leituras where club_id = '${legado}';`)
contarDepois('bichinhos', `select count(*) from public.bichinhos where club_id = '${legado}';`)
contarDepois('responsaveis', `select count(*) from public.responsaveis where club_id = '${legado}';`)
contarDepois('notificacoes', `select count(*) from public.notificacoes where club_id = '${legado}';`)
contarDepois('storage_objetos', 'select count(*) from storage.objects;')
contarDepois('club_storage_objetos', `select count(*) from public.club_storage_objetos where club_id = '${legado}';`)
contarDepois('club_storage_fora', `select count(*) from public.club_storage_objetos where club_id <> '${legado}';`)
contarDepois('cron_jobs', 'select count(*) from cron.job;')
contarDepois('platform_admins', 'select count(*) from public.platform_admins;')
contarDepois('reconciliacao_pendente', `select public.reconciliar_perfis_dos_vinculos();`)

say('\n-- COMPARAÇÃO ANTES × DEPOIS --')
const cmp = (rotulo, a, d, explicacao) => {
  const bate = String(a) === String(d)
  say(`   ${bate ? 'OK    ' : 'DIFERE'}  ${rotulo.padEnd(40)} antes=${String(a).padEnd(8)} depois=${String(d).padEnd(8)} ${explicacao || ''}`)
  if (!bate) falhas++
}
cmp('auth.users', antes['auth.users'], depois['auth.users'], '(nenhuma conta pode sumir nem nascer)')
cmp('vínculos no Tenant 001 = profiles de antes', antes.profiles, depois.memberships_no_legado, '(a migration 2 cria 1 vínculo por perfil)')
cmp('unidades', antes.unidades, depois.unidades)
cmp('pontos (linhas)', antes.pontos_linhas, depois.pontos_linhas)
cmp('pontos (soma)', antes.pontos_soma, depois.pontos_soma)
cmp('mensalidades', antes.mensalidades, depois.mensalidades)
cmp('atividades', antes.atividades, depois.atividades)
cmp('entregas', antes.entregas, depois.entregas)
cmp('eventos', antes.eventos, depois.eventos)
cmp('chat_mensagens', antes.chat_mensagens, depois.chat_mensagens)
cmp('trilha_jogos', antes.trilha_jogos, depois.trilha_jogos)
cmp('partidas', antes.partidas, depois.partidas)
cmp('devocional', antes.devocional, depois.devocional)
cmp('missoes_feitas', antes.missoes_feitas, depois.missoes_feitas)
cmp('biblia_leituras', antes.biblia_leituras, depois.biblia_leituras)
cmp('bichinhos', antes.bichinhos, depois.bichinhos)
cmp('responsaveis', antes.responsaveis, depois.responsaveis)
cmp('notificacoes', antes.notificacoes, depois.notificacoes)
cmp('storage.objects', antes.storage_objetos, depois.storage_objetos, '(metadados, não deve perder nenhum)')
ok('todo objeto do Storage está no controle de uso do Tenant 001', antes.storage_objetos === depois.club_storage_objetos, `antes=${antes.storage_objetos} controle=${depois.club_storage_objetos}`)
ok('nenhum ponto/vínculo/unidade/mensalidade/storage foi parar FORA do Tenant 001', ['memberships_fora_do_legado', 'unidades_fora_do_legado', 'pontos_fora_do_legado', 'mensalidades_fora', 'club_storage_fora'].every((k) => depois[k] === '0'), JSON.stringify(Object.fromEntries(['memberships_fora_do_legado', 'unidades_fora_do_legado', 'pontos_fora_do_legado', 'mensalidades_fora', 'club_storage_fora'].map((k) => [k, depois[k]]))))
ok('reconciliação perfil×vínculo não tem nada a ajustar', depois.reconciliacao_pendente === '0', depois.reconciliacao_pendente)
const orfaosDepois = val(`select count(*) from auth.users u left join public.profiles p on p.id=u.id where p.id is null;`)
ok('3 usuários órfãos de auth.users preservados (mesma quantidade de antes)', orfaosDepois === antes.orfaos_auth_sem_profile, `antes=${antes.orfaos_auth_sem_profile} depois=${orfaosDepois}`)

say('\n-- item 11 do pedido: nenhum fallback de "clube legado/padrão" voltou a existir --')
say(`   ·       migration 72 ("fecha a janela anônima do legado") aplicou sem erro (ver duracoes-migrations.json) — o fallback anônimo para o clube legado foi FECHADO por ela, como já era esperado.`)
try {
  docker(['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: `set local role anon; select public.clube_legado_id();` })
  ok('anon NÃO consegue chamar clube_legado_id() (superfície anônima fechada, migration 76)', false, 'anon conseguiu chamar — deveria ter sido recusado')
} catch (e) { ok('anon NÃO consegue chamar clube_legado_id() (superfície anônima fechada, migration 76)', /permission denied|does not exist/i.test(e.stderr || e.message)) }

say('\n-- suíte de banco (pgTAP), sobre a cópia REAL já migrada --')
let suiteLog = ''
try {
  suiteLog = execFileSync('bash', ['supabase/tests/run-tests.sh', '--db', 'postgres', '--no-replay'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SUPABASE_DB_CONTAINER: DB, MSYS_NO_PATHCONV: '1' },
  })
} catch (e) { suiteLog = `${e.stdout || ''}${e.stderr || ''}` }
writeFileSync('supabase/e2e/evidencias-etapa3/suite-sobre-dado-real.log', suiteLog)
const linhasSuite = suiteLog.split('\n').filter((l) => /^\s+(OK|FALHOU)\s/.test(l))
const verdes = linhasSuite.filter((l) => /^\s+OK/.test(l)).length
const vermelhas = linhasSuite.filter((l) => /^\s+FALHOU/.test(l))
say(`   ${verdes} arquivos ok, ${vermelhas.length} com falha (log completo em supabase/e2e/evidencias-etapa3/suite-sobre-dado-real.log)`)
for (const l of vermelhas) say('   ' + l.trim())

say(`\n RESULTADO GERAL: ${falhas === 0 && vermelhas.length === 0 ? 'ENSAIO OK' : `${falhas + vermelhas.length} FALHA(S)`}`)
writeFileSync('supabase/e2e/evidencias-etapa3/log-completo.txt', log.join('\n'))
writeFileSync('supabase/e2e/evidencias-etapa3/antes.json', JSON.stringify(antes, null, 1))
writeFileSync('supabase/e2e/evidencias-etapa3/depois.json', JSON.stringify(depois, null, 1))

if (!process.argv.includes('--manter')) descartar()
process.exit(falhas === 0 && vermelhas.length === 0 ? 0 : 1)
