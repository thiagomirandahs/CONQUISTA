// E2E de CONCORRÊNCIA da conquista de classe (migration 527). O teste SQL (132) roda numa sessão só; aqui há DUAS sessões psql
// de verdade (docker exec em paralelo) disputando a mesma pessoa+classe, com as transações ABERTAS ao mesmo tempo:
//   S1  registro anterior (liderança do clube A)  x  investidura da matrícula do clube B
//   S2  dois registros anteriores ao mesmo tempo (liderança do A x liderança do B)
//   S3  duas investiduras ao mesmo tempo (matrícula do A x matrícula do B)
//   S4  o mesmo registro anterior duas vezes (duplo clique) pelo mesmo clube
// Prova: SEMPRE exatamente 1 conquista ATIVA da pessoa+classe, nunca erro cru do índice, nunca estado parcial; e o perdedor vira
// reconhecimento (investidura) ou recusa amigável ("já consta"), conforme quem chegou primeiro.
//
// Como garantir a sobreposição: as duas sessões esperam o MESMO instante (barreira medida pelo relógio do próprio banco), executam a
// ação e SEGURAM a transação aberta por 1,5 s antes do commit. A que perde a corrida fica bloqueada no advisory lock até o commit da outra.
// O teste confere que a ação mais lenta terminou depois de >= 1,3 s (houve sobreposição de fato).
//
// SEGURANÇA: só roda em banco isolado "replay_*" informado em CONQUISTA_E2E_DB (nunca o 'postgres' de trabalho, nunca produção) e só via
// docker exec no container local. O banco precisa ter TODAS as migrations (até 527). Cria dados novos a cada execução (nomes e-mail e2e-conq-*).
//   bash supabase/tests/run-tests.sh --keep 132_conquista_ativa_unica      # deixa o replay_* pronto (usa REPLAY_DB=replay_conq)
//   CONQUISTA_E2E_DB=replay_conq npm run test:conquista:e2e
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const DB = process.env.CONQUISTA_E2E_DB || ''
const ITER = Math.max(1, Number(process.env.CONQUISTA_E2E_ITER || 3))
const SEGURAR_S = 1.5

if (!/^replay_[a-z0-9_]+$/.test(DB)) {
  console.error('Defina CONQUISTA_E2E_DB com um banco isolado replay_* (ex.: replay_conq). Recusado: nunca roda no banco de trabalho nem em produção.')
  process.exit(2)
}

const PSQL = ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', DB, '-X', '-q', '-A', '-t']
function sql(texto) {
  return execFileSync('docker', [...PSQL, '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
function sessao(texto) {
  return new Promise((resolve) => {
    const p = spawn('docker', [...PSQL, '-v', 'ON_ERROR_STOP=1'])
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err }))
    p.stdin.end(texto)
  })
}

let total = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) falhas.push(`${nome}  [${detalhe}]`)
  console.log(`${cond ? '  ok ' : '  FALHOU'}  ${nome}${cond ? '' : '  [' + detalhe + ']'}`)
}

// ---------- pré-requisitos do banco ----------
const temColuna = sql(`select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'curriculum_achievements' and column_name = 'classe_codigo'`)
if (temColuna !== '1') {
  console.error(`O banco ${DB} não tem a migration 527 (coluna classe_codigo). Aplique todas as migrations antes (run-tests.sh --keep).`)
  process.exit(2)
}

// clubes e lideranças (reaproveitados entre execuções)
function colunasUsuario(id, email) {
  return `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token, email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', '${email}', extensions.crypt('senha-e2e', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);`
}
function pessoaSql({ id, nome, papel, vinculos, nascimento = "date '2013-01-01'" }) {
  // vinculos: [clubeId...]
  return `
    insert into public.profiles (id, nome, papel, status, nascimento) values ('${id}', '${nome}', '${papel}', 'ativo', ${nascimento});
    ${vinculos.map((c) => `insert into public.organization_memberships (user_id, organizational_unit_id, role, status, starts_at, created_at) values ('${id}', '${c}', '${papel}', 'ativo', now() - interval '1 second', now() - interval '1 second');`).join('\n')}`
}
function criarClubesSql() {
  return `
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata)
    select 'clube', 'E2E Conquista ' || x, 'e2e-conquista-' || lower(x), 'BR', 'America/Recife', '{"test_only":true}'
      from (values ('A'), ('B')) v(x)
     where not exists (select 1 from public.organizational_units u where u.slug = 'e2e-conquista-' || lower(v.x));
    insert into public.club_features (club_id, feature, enabled)
    select u.id, 'classes', true from public.organizational_units u where u.slug in ('e2e-conquista-a', 'e2e-conquista-b')
    on conflict (club_id, feature) do update set enabled = true;`
}
sql(criarClubesSql())
const clube = {
  A: sql(`select id from public.organizational_units where slug = 'e2e-conquista-a'`),
  B: sql(`select id from public.organizational_units where slug = 'e2e-conquista-b'`),
}
const classeAmigo = sql(`select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.codigo = 'amigo' and v.origem = 'oficial' and v.status = 'publicado' limit 1`)
if (!classeAmigo) { console.error('Classe oficial "amigo" não encontrada no banco.'); process.exit(2) }

function garantirDiretoria(lado) {
  const email = `e2e-conq-dir-${lado.toLowerCase()}@teste.local`
  const existente = sql(`select id from auth.users where email = '${email}'`)
  if (existente) return existente
  const id = randomUUID()
  sql(`set session_replication_role = replica;
       ${colunasUsuario(id, email)}
       ${pessoaSql({ id, nome: 'E2E Diretoria ' + lado, papel: 'diretoria', vinculos: [clube[lado]], nascimento: "date '1985-01-01'" })}`)
  return id
}
const dir = { A: garantirDiretoria('A'), B: garantirDiretoria('B') }

function novaPessoa(tag, { matriculas = [] } = {}) {
  const id = randomUUID()
  const s = `set session_replication_role = replica;
    ${colunasUsuario(id, `e2e-conq-${tag}-${id.slice(0, 8)}@teste.local`)}
    ${pessoaSql({ id, nome: 'E2E ' + tag, papel: 'desbravador', vinculos: [clube.A, clube.B] })}
    ${matriculas.map((l) => `insert into public.member_classes (usuario_id, club_id, class_id) values ('${id}', '${clube[l]}', '${classeAmigo}');`).join('\n')}`
  sql(s)
  return id
}

// ---------- ações das sessões ----------
const asDir = (lado) => `
  select set_config('request.jwt.claim.sub', '${dir[lado]}', true), set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"${dir[lado]}","role":"authenticated"}', true),
         set_config('request.headers', '{"x-clube-atual":"${clube[lado]}"}', true);
  set local role authenticated;`
const acaoRegistrar = (pessoa) =>
  `perform public.classe_concluida_anteriormente_registrar('${pessoa}', '${classeAmigo}', date '2020-05-10', false, 'Cartão conferido (e2e de concorrência)', null);`
const acaoInvestir = (pessoa, lado) =>
  `update public.member_classes set status = 'investida', concluida_em = now(), investida_em = now() where usuario_id = '${pessoa}' and club_id = '${clube[lado]}' and class_id = '${classeAmigo}';`

// uma sessão = transação aberta: prepara papel, ESPERA a barreira, executa a ação (erro vira linha E2E_ERRO, sem derrubar a transação),
// SEGURA a transação aberta e só então confirma
function roteiro({ preparo = '', acao, barreira, nome }) {
  return `\\set ON_ERROR_STOP on
begin;
${preparo}
select pg_sleep(greatest(0, ${barreira} - extract(epoch from clock_timestamp())));
do $e2e$
begin
  ${acao.replace(/;\s*$/, '')};
  raise notice 'E2E_OK|${nome}|%', round((extract(epoch from clock_timestamp()) - ${barreira})::numeric, 2);
exception when others then
  raise notice 'E2E_ERRO|${nome}|%|%', round((extract(epoch from clock_timestamp()) - ${barreira})::numeric, 2), sqlerrm;
end
$e2e$;
select pg_sleep(${SEGURAR_S});
commit;
select 'E2E_FIM';`
}
function ler(r) {
  const linha = (r.err.split('\n').find((l) => l.includes('E2E_OK|') || l.includes('E2E_ERRO|')) || '').replace(/^.*?E2E_/, 'E2E_')
  const [tipo, , t, ...resto] = linha.split('|')
  const msg = resto.join('|')
  return { saiu: r.code === 0 && r.out.includes('E2E_FIM'), ok: tipo === 'E2E_OK', erro: msg || '', t: Number(t), bruto: r.err.trim() }
}
async function correr(sessoes) {
  const barreira = Number(sql(`select extract(epoch from clock_timestamp()) + 5`))
  const rs = await Promise.all(sessoes.map((s) => sessao(roteiro({ ...s, barreira }))))
  return rs.map(ler)
}
function estado(pessoa) {
  return JSON.parse(sql(`select json_build_object(
    'total', (select count(*) from public.curriculum_achievements where usuario_id = '${pessoa}' and tipo = 'classe'),
    'ativas', (select count(*) from public.curriculum_achievements where usuario_id = '${pessoa}' and tipo = 'classe' and status = 'ativa'),
    'origem', (select min(origem) from public.curriculum_achievements where usuario_id = '${pessoa}' and tipo = 'classe' and status = 'ativa'),
    'ach_mc', (select min(member_class_id::text) from public.curriculum_achievements where usuario_id = '${pessoa}' and tipo = 'classe' and status = 'ativa'),
    'rec', (select count(*) from public.class_completion_recognitions where usuario_id = '${pessoa}'),
    'rec_mc', (select min(member_class_id::text) from public.class_completion_recognitions where usuario_id = '${pessoa}'),
    'mc_investidas', (select count(*) from public.member_classes where usuario_id = '${pessoa}' and status = 'investida'),
    'mc_a', (select id::text from public.member_classes where usuario_id = '${pessoa}' and club_id = '${clube.A}'),
    'mc_b', (select id::text from public.member_classes where usuario_id = '${pessoa}' and club_id = '${clube.B}'))`))
}
const amigavel = (m) => /já consta como concluída/i.test(m)

const distrib = {}
const conta = (k, v) => { distrib[k] = distrib[k] || {}; distrib[k][v] = (distrib[k][v] || 0) + 1 }

for (let i = 1; i <= ITER; i++) {
  console.log(`\n=== rodada ${i}/${ITER} ===`)

  // S1: registro anterior (A) x investidura da matrícula do B
  {
    const p = novaPessoa('s1', { matriculas: ['B'] })
    const [r, v] = await correr([
      { nome: 'registro', preparo: asDir('A'), acao: acaoRegistrar(p) },
      { nome: 'investidura', acao: acaoInvestir(p, 'B') },
    ])
    const e = estado(p)
    ok(`S1.${i} sessões terminaram sem erro de conexão`, r.saiu && v.saiu, r.bruto + v.bruto)
    ok(`S1.${i} a investidura NUNCA falha (reconhece ou emite)`, v.ok, v.erro)
    ok(`S1.${i} exatamente 1 conquista ATIVA da pessoa+classe (total de linhas = 1)`, e.ativas === 1 && e.total === 1, JSON.stringify(e))
    ok(`S1.${i} a matrícula do B ficou investida`, e.mc_investidas === 1, JSON.stringify(e))
    if (r.ok) {
      conta('S1', 'registro ganhou -> investidura reconheceu')
      ok(`S1.${i} registro ganhou: a ativa é o registro_anterior e a investidura virou 1 reconhecimento`, e.origem === 'registro_anterior' && e.rec === 1 && e.rec_mc === e.mc_b, JSON.stringify(e))
    } else {
      conta('S1', 'investidura ganhou -> registro recusado')
      ok(`S1.${i} investidura ganhou: a ativa é a conclusão do app e o registro foi RECUSADO com mensagem amigável`, e.origem === 'conclusao_no_app' && e.rec === 0 && amigavel(r.erro), JSON.stringify({ e, erro: r.erro }))
    }
    ok(`S1.${i} houve sobreposição real (a ação mais lenta esperou >= 1,3 s pelo commit da outra)`, Math.max(r.t, v.t) >= 1.3, `t=${r.t}/${v.t}`)
  }

  // S2: dois registros anteriores (A x B)
  {
    const p = novaPessoa('s2')
    const [a, b] = await correr([
      { nome: 'registro_a', preparo: asDir('A'), acao: acaoRegistrar(p) },
      { nome: 'registro_b', preparo: asDir('B'), acao: acaoRegistrar(p) },
    ])
    const e = estado(p)
    ok(`S2.${i} sessões terminaram sem erro de conexão`, a.saiu && b.saiu, a.bruto + b.bruto)
    ok(`S2.${i} exatamente 1 dos dois registros passou`, a.ok !== b.ok, `a=${a.ok} b=${b.ok}`)
    ok(`S2.${i} o perdedor recebeu recusa amigável (nunca erro cru do índice)`, amigavel(a.ok ? b.erro : a.erro), `${a.erro} | ${b.erro}`)
    ok(`S2.${i} exatamente 1 conquista ATIVA e 1 linha no total`, e.ativas === 1 && e.total === 1 && e.origem === 'registro_anterior', JSON.stringify(e))
    conta('S2', a.ok ? 'clube A ganhou' : 'clube B ganhou')
    ok(`S2.${i} houve sobreposição real`, Math.max(a.t, b.t) >= 1.3, `t=${a.t}/${b.t}`)
  }

  // S3: duas investiduras (A x B)
  {
    const p = novaPessoa('s3', { matriculas: ['A', 'B'] })
    const [a, b] = await correr([
      { nome: 'investe_a', acao: acaoInvestir(p, 'A') },
      { nome: 'investe_b', acao: acaoInvestir(p, 'B') },
    ])
    const e = estado(p)
    ok(`S3.${i} sessões terminaram sem erro de conexão`, a.saiu && b.saiu, a.bruto + b.bruto)
    ok(`S3.${i} as duas investiduras passam (uma emite, a outra reconhece)`, a.ok && b.ok, `${a.erro} | ${b.erro}`)
    ok(`S3.${i} exatamente 1 ATIVA, 1 reconhecimento, 2 matrículas investidas`, e.ativas === 1 && e.total === 1 && e.rec === 1 && e.mc_investidas === 2, JSON.stringify(e))
    ok(`S3.${i} a matrícula dona da conquista NÃO é a que reconheceu`, e.ach_mc !== e.rec_mc && [e.mc_a, e.mc_b].includes(e.ach_mc) && [e.mc_a, e.mc_b].includes(e.rec_mc), JSON.stringify(e))
    conta('S3', e.ach_mc === e.mc_a ? 'matrícula do A ganhou' : 'matrícula do B ganhou')
    ok(`S3.${i} houve sobreposição real`, Math.max(a.t, b.t) >= 1.3, `t=${a.t}/${b.t}`)
  }

  // S4: o mesmo registro duas vezes, mesmo clube (duplo clique)
  {
    const p = novaPessoa('s4')
    const [a, b] = await correr([
      { nome: 'clique_1', preparo: asDir('A'), acao: acaoRegistrar(p) },
      { nome: 'clique_2', preparo: asDir('A'), acao: acaoRegistrar(p) },
    ])
    const e = estado(p)
    ok(`S4.${i} exatamente 1 dos dois cliques passou`, a.saiu && b.saiu && a.ok !== b.ok, `a=${a.ok} b=${b.ok}`)
    ok(`S4.${i} o segundo recebeu "já consta ... neste clube"`, /já consta como concluída por esta pessoa neste clube/i.test(a.ok ? b.erro : a.erro), `${a.erro} | ${b.erro}`)
    ok(`S4.${i} exatamente 1 conquista ativa e 1 linha`, e.ativas === 1 && e.total === 1, JSON.stringify(e))
    ok(`S4.${i} houve sobreposição real`, Math.max(a.t, b.t) >= 1.3, `t=${a.t}/${b.t}`)
  }
}

// invariante global do banco inteiro
const dups = sql(`select count(*) from public._conquista_classe_duplicatas_ativas()`)
ok('invariante global: nenhuma pessoa com 2+ ativas equivalentes no banco', dups === '0', `duplicatas=${dups}`)

console.log('\nQuem ganhou a corrida (varia; o resultado é correto nos dois casos):', JSON.stringify(distrib))
console.log(falhas.length ? `\nFALHOU: ${falhas.length} de ${total}\n${falhas.map((f) => '  - ' + f).join('\n')}` : `\nOK: ${total} verificações de concorrência passaram (banco ${DB}).`)
process.exit(falhas.length ? 1 : 0)
