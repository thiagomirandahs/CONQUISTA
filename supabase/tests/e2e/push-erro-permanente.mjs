// E2E do tratamento de ERRO DE PUSH (migration 534 + Edge Function enviar-push) contra um PROVEDOR FALSO local — nunca produção, nunca provedor real.
//
// Como funciona: a Edge Function roda no edge-runtime de verdade (a MESMA imagem do `supabase start`, containers kpe_*), e o "Google"/"navegador"
// são um container kpe_fake (TLS, CA descartável) com aliases de rede para fcm.googleapis.com, oauth2.googleapis.com e push-fake.test:
// o DNS do Docker resolve esses nomes para o falso (conferido antes de qualquer envio; se não resolver para ele o teste ABORTA). Cada
// dispositivo de teste carrega no endpoint/token o cenário (404, 410, 400 de inscrição inválida, 400 genérico, 401, 403, 408, 413, 429 com
// Retry-After, 5xx, timeout, recusa de conexão, DNS inexistente, corpo vazio, status desconhecido...) e o falso responde exatamente isso.
//
// Prova: (1) tabela status x decisão x registro, por canal (Web Push e FCM); só erro permanente COMPROVADO remove; (2) múltiplos dispositivos
// da MESMA pessoa (uma morta não afeta as outras); (3) tetos de retry: reenviar o MESMO evento 4x nunca passa de 1 tentativa (definitivo)
// ou 3 (temporário) por aparelho, e Retry-After é respeitado; (4) concorrência: dois invokes simultâneos do mesmo evento = 1 envio por aparelho
// e duas reservas simultâneas no banco; (5) resposta ATRASADA (410) depois de a inscrição ser recriada NÃO apaga a nova; poda concorrente com
// re-inscrição não apaga a nova; (6) multiclube: evento de um clube não toca aparelhos de outro; (7) falhas de OAuth do FCM (503/401) e conta de
// serviço ilegível: nada removido, registro sem segredo; (8) infra_falhas, logs e respostas NÃO contêm endpoint/token/chave; (9) limpeza total.
//
//   npm run test:push:e2e      (Docker + Supabase local no ar com a migration 534; baixa pacotes npm na 1ª vez)
// Dados de teste com prefixo "e2e-pep". Nada de dado sintético sobra (conferido no fim).
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID, generateKeyPairSync, createECDH } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '../../..')
const API = process.env.API_URL || 'http://127.0.0.1:54321'
const CONT_DB = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const CONT_FN = process.env.SUPABASE_EDGE_CONTAINER || 'supabase_edge_runtime_CONQUISTA'
const CONT_KONG = process.env.SUPABASE_KONG_CONTAINER || 'supabase_kong_CONQUISTA'
const PREFIXO = 'e2e-pep'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API)) { console.error('ABORTADO: só roda contra o Supabase LOCAL.'); process.exit(2) }

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const docker = (...a) => sh('docker', a)
const psqlArgs = ['exec', '-i', CONT_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
const sql = (texto) => execFileSync('docker', psqlArgs, { input: texto, encoding: 'utf8' }).trim()
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
const b64u = (b) => Buffer.from(b).toString('base64url')
const printenvFn = (n) => docker('exec', CONT_FN, 'printenv', n)

let total = 0
const falhas = []
function reg(nome, cond, detalhe = '') {
  total++
  if (cond) console.log(`   ok     ${nome}`)
  else { falhas.push(`${nome} [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) }
}
const info = (t) => console.log(`   info   ${t}`)

// ---------------------------------------------------------------- pré-requisitos
const SEC = printenvFn('SUPABASE_INTERNAL_SECRET_KEY')
const PUB = printenvFn('SUPABASE_INTERNAL_PUBLISHABLE_KEY')
if (!SEC.startsWith('sb_secret_') || !PUB.startsWith('sb_publishable_')) { console.error('ABORTADO: o Supabase local não expõe as chaves novas.'); process.exit(2) }
const JWT_SECRET = printenvFn('SUPABASE_INTERNAL_JWT_SECRET')
const JWKS = printenvFn('SUPABASE_JWKS')
const temMigration = sql(`select count(*) from pg_proc where proname = 'push_remover_inscricao'`)
if (temMigration !== '1') { console.error('ABORTADO: o banco local não tem a migration 534 (push_remover_inscricao). Aplique-a LOCALMENTE antes.'); process.exit(2) }
const IMG = docker('inspect', CONT_FN, '--format', '{{.Config.Image}}')
const NET = docker('inspect', CONT_KONG, '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
if (!IMG || !NET) { console.error('ABORTADO: imagem do edge-runtime ou rede do Supabase local não encontradas.'); process.exit(2) }

const TMP = mkdtempSync(join(tmpdir(), 'kpe-'))
const VOLUME = 'kpe_deno_cache'
const NOMES = ['kpe_fake', 'kpe_edge', 'kpe_oauth503', 'kpe_oauth401', 'kpe_badjson']
const PORTAS = { kpe_edge: 54411, kpe_oauth503: 54412, kpe_oauth401: 54413, kpe_badjson: 54414, kpe_fake: 54420 }
const mainWrapper = join(TMP, 'main-index.ts')
const SEGREDO_WEBHOOK = randomBytes(24).toString('hex')
const ecdhV = createECDH('prime256v1'); ecdhV.generateKeys()
const VAPID = { pub: b64u(ecdhV.getPublicKey()), priv: b64u(ecdhV.getPrivateKey()) }
const SEGREDO_JSON_RUIM = 'SEGREDO-NAO-VAZAR-' + randomBytes(6).toString('hex')

// conta de serviço FALSA (chave RSA gerada agora; o "Google" falso não valida assinatura)
function contaFalsa(email) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return JSON.stringify({ client_email: email, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'e2e-pep-falso' })
}

// ---------------------------------------------------------------- CA + certificado do provedor falso
function gerarCertificados() {
  const o = (args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  o(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(TMP, 'ca.key'), '-out', join(TMP, 'ca.pem'), '-days', '2', '-subj', '/CN=e2e-pep-ca'])
  o(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(TMP, 'srv.key'), '-out', join(TMP, 'srv.csr'), '-subj', '/CN=e2e-pep-fake'])
  writeFileSync(join(TMP, 'ext.cnf'), 'subjectAltName=DNS:fcm.googleapis.com,DNS:oauth2.googleapis.com,DNS:push-fake.test,DNS:push-recusa.test\n')
  o(['x509', '-req', '-in', join(TMP, 'srv.csr'), '-CA', join(TMP, 'ca.pem'), '-CAkey', join(TMP, 'ca.key'), '-CAcreateserial', '-out', join(TMP, 'srv.pem'), '-days', '2', '-extfile', join(TMP, 'ext.cnf')])
}

function subirFake() {
  copyFileSync(join(AQUI, 'push-provedor-falso.ts'), join(TMP, 'fake.ts'))
  docker('run', '-d', '--name', 'kpe_fake', '--network', NET,
    '--network-alias', 'fcm.googleapis.com', '--network-alias', 'oauth2.googleapis.com', '--network-alias', 'push-fake.test', '--network-alias', 'push-recusa.test',
    '-p', `${PORTAS.kpe_fake}:9000`, '-v', `${join(TMP, 'fake.ts')}:/root/index.ts:ro`, '-v', `${join(TMP, 'srv.pem')}:/certs/srv.pem:ro`, '-v', `${join(TMP, 'srv.key')}:/certs/srv.key:ro`,
    IMG, 'start', '--main-service=/root', '--port=9000', '--tls=443', '--cert=/certs/srv.pem', '--key=/certs/srv.key')
}

function subirEdge({ nome, contaFcm }) {
  const fnEnv = { PUSH_WEBHOOK_SECRET: SEGREDO_WEBHOOK, VAPID_PUBLIC_KEY: VAPID.pub, VAPID_PRIVATE_KEY: VAPID.priv, FCM_SERVICE_ACCOUNT: contaFcm, E2E_CA_PEM: readFileSync(join(TMP, 'ca.pem'), 'utf8') }
  const cfg = { 'enviar-push': { verifyJWT: false, entrypointPath: 'e2e-push/entrada.ts', env: fnEnv } }
  const linhas = [
    'SUPABASE_URL=http://' + CONT_KONG + ':8000',
    `SUPABASE_INTERNAL_HOST_PORT=${PORTAS[nome]}`,
    `SUPABASE_INTERNAL_JWT_SECRET=${JWT_SECRET}`,
    `SUPABASE_JWKS=${JWKS}`,
    `SUPABASE_INTERNAL_FUNCTIONS_CONFIG=${JSON.stringify(cfg)}`,
    `SUPABASE_INTERNAL_PUBLISHABLE_KEY=${PUB}`, `SUPABASE_INTERNAL_SECRET_KEY=${SEC}`,
  ]
  const envf = join(TMP, `${nome}.env`)
  writeFileSync(envf, linhas.join('\n') + '\n', { mode: 0o600 })
  docker('run', '-d', '--name', nome, '--network', NET, '-p', `${PORTAS[nome]}:9000`, '--env-file', envf, '-w', '/app',
    '-v', `${join(RAIZ, 'supabase/functions')}:/app/supabase/functions:ro`, '-v', `${mainWrapper}:/root/index.ts:ro`, '-v', `${join(AQUI, 'push-tls-falso')}:/app/e2e-push:ro`,   // entrada.ts + shim.ts: troca só o transporte TLS (CA descartável do provedor falso) e carrega a função REAL
   
    '-v', `${VOLUME}:/root/.cache/deno`, IMG, 'start', '--main-service=/root', '--port=9000', '--policy=per_worker')
  rmSync(envf, { force: true })
}

async function esperarSaude(nome) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORTAS[nome]}/_internal/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) return true } catch { /* subindo */ }
    await dorme(1000)
  }
  return false
}

const corposVistos = []
async function invocar(nome, record) {
  const r = await fetch(`http://127.0.0.1:${PORTAS[nome]}/enviar-push`, {
    method: 'POST', headers: { 'x-push-webhook-secret': SEGREDO_WEBHOOK, 'content-type': 'application/json' },
    body: JSON.stringify({ record }), signal: AbortSignal.timeout(170000),
  })
  const txt = await r.text(); corposVistos.push(txt)
  let json = null; try { json = JSON.parse(txt) } catch { /* texto */ }
  return { status: r.status, txt, json }
}
const hitsFake = async () => (await (await fetch(`http://127.0.0.1:${PORTAS.kpe_fake}/__hits`)).json())
const contaHits = (hits, caminhoOuToken) => hits.filter((h) => h.caminho === caminhoOuToken).length

// ---------------------------------------------------------------- fixtures
const uid = (k) => sql(`select md5('${PREFIXO}:${k}')::uuid;`)
function limparBanco() {
  sql(`
    set session_replication_role = replica;
    create temp table e2e_u as select id from public.organizational_units where slug like '${PREFIXO}-%';
    create temp table e2e_us as select id from auth.users where email like '${PREFIXO}-%@teste.local';
    delete from public.push_tentativas where club_id in (select id from e2e_u)
       or destinatario_id in (select d.id from public.push_evento_destinatarios d where d.user_id in (select id from e2e_us));
    delete from public.push_evento_destinatarios where evento_id in (select id from public.push_eventos where club_id in (select id from e2e_u)) or user_id in (select id from e2e_us);
    delete from public.push_eventos where club_id in (select id from e2e_u);
    delete from public.push_subscriptions where user_id in (select id from e2e_us);
    delete from public.push_tokens where user_id in (select id from e2e_us);
    delete from public.infra_falhas where club_id in (select id from e2e_u);
    delete from public.profiles where id in (select id from e2e_us);
    delete from auth.users where id in (select id from e2e_us);
    delete from public.organizational_units where id in (select id from e2e_u);
  `)
}
function residuos() {
  return sql(`
    select (select count(*) from public.organizational_units where slug like '${PREFIXO}-%')
         + (select count(*) from auth.users where email like '${PREFIXO}-%@teste.local')
         + (select count(*) from public.profiles where nome like 'E2E Pep %')
         + (select count(*) from public.push_subscriptions where endpoint like 'https://push-fake.test/%' or endpoint like 'https://push-recusa.test%' or endpoint like 'https://push-nao-existe.invalid/%')
         + (select count(*) from public.push_tokens where plataforma = 'e2e-pep')
         + (select count(*) from public.push_eventos where chave_evento like '${PREFIXO}-%')
         + (select count(*) from public.infra_falhas where detalhe ilike '%push-fake%' or detalhe ilike '%e2e-pep%');`)
}
function preparar() {
  limparBanco()
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values
      ('clube', 'E2E Pep Clube A', '${PREFIXO}-clube-a', 'BR', 'America/Recife', '{"test_only":true}'),
      ('clube', 'E2E Pep Clube B', '${PREFIXO}-clube-b', 'BR', 'America/Recife', '{"test_only":true}');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('${PREFIXO}:' || k)::uuid, 'authenticated', 'authenticated', '${PREFIXO}-' || lower(k) || '@teste.local',
      extensions.crypt('x-nao-usado', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
      from (select unnest(array['ua1','ua2','ub1']) as k) t;
    insert into public.profiles (id, nome, papel, status, created_at)
    select md5('${PREFIXO}:' || k)::uuid, 'E2E Pep ' || k, 'desbravador', 'ativo', now() - interval '60 days'
      from (select unnest(array['ua1','ua2','ub1']) as k) t;
  `)
}
const clube = (k) => sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-${k}';`)

function chaveEcdh() { const e = createECDH('prime256v1'); e.generateKeys(); return { p: b64u(e.getPublicKey()), a: b64u(randomBytes(16)) } }
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
function inserirSubs(user, endpoints) {
  const linhas = endpoints.map((ep) => { const k = chaveEcdh(); return `(${q(uid(user))}, ${q(ep)}, ${q(k.p)}, ${q(k.a)})` })
  sql(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ${linhas.join(',')};
       set session_replication_role = replica;
       update public.push_subscriptions set registrada_em = now() - interval '30 days' where user_id = ${q(uid(user))};`)
}
function inserirTokens(user, tokens) {
  sql(`insert into public.push_tokens (token, user_id, plataforma) values ${tokens.map((t) => `(${q(t)}, ${q(uid(user))}, 'e2e-pep')`).join(',')};
       set session_replication_role = replica;
       update public.push_tokens set registrada_em = now() - interval '30 days' where user_id = ${q(uid(user))};`)
}
function novoEvento(clubeId, users) {
  const ev = sql(`insert into public.push_eventos (chave_evento, club_id, destinatarios) values ('${PREFIXO}-${randomUUID()}', '${clubeId}', ${users.length}) returning id;`).split('\n')[0]
  sql(`insert into public.push_evento_destinatarios (evento_id, user_id) values ${users.map((u) => `('${ev}', ${q(uid(u))})`).join(',')};`)
  return ev
}
const subExiste = (ep) => sql(`select count(*) from public.push_subscriptions where endpoint = ${q(ep)};`) === '1'
const tokenExiste = (t) => sql(`select count(*) from public.push_tokens where token = ${q(t)};`) === '1'
const tentativas = (cred, canal, ev) => sql(`select coalesce(json_agg(json_build_object('estado', t.estado, 'codigo', t.codigo, 'retry', t.retry_apos is not null, 'retry_s', extract(epoch from (t.retry_apos - t.quando))::int) order by t.id), '[]')
  from public.push_tentativas t join public.push_evento_destinatarios d on d.id = t.destinatario_id
  where t.dispositivo_id = md5(${q(cred)})::uuid and t.canal = '${canal}'${ev ? ` and d.evento_id = '${ev}'` : ''};`)

// ---------------------------------------------------------------- os cenários
// [cenário, código gravado, removida?, Retry-After esperado (s) | null]
const WEB = [
  ['ok', '200', false, null], ['s404', '404', true, null], ['s410', '410', true, null], ['s400inv', 'sub_invalida', true, null],
  ['s400gen', '400', false, null], ['s400vazio', '400', false, null], ['s401', '401', false, null], ['s403', '403', false, null],
  ['s408', '408', false, null], ['s413', '413', false, null], ['s429', '429', false, 120], ['s500', '500', false, null], ['s502', '502', false, null],
  ['s503', '503', false, 100], ['s504', '504', false, null], ['s418', 'desconhecido', false, null], ['s301', 'desconhecido', false, null],
  ['vazio', 'desconhecido', false, null], ['lento', 'timeout', false, null],
]
const FCM = [
  ['ok', '200', false, null], ['unreg', '404', true, null], ['notfound', '404', false, null], ['invtoken', 'sub_invalida', true, null],
  ['invpayload', '400', false, null], ['vazio400', '400', false, null], ['s401', '401', false, null], ['s403', '403', false, null],
  ['s408', '408', false, null], ['s429', '429', false, 90], ['s500', '500', false, null], ['s502', '502', false, null], ['s503', '503', false, 100],
  ['s504', '504', false, null], ['s418', 'desconhecido', false, null], ['vazio', 'desconhecido', false, null], ['lento', 'timeout', false, null],
]
const ENDPOINTS_EXTRAS = [
  ['rede-recusada', 'rede', `https://push-recusa.test:4443/rede/${randomUUID()}`],
  ['dns-inexistente', 'rede', `https://push-nao-existe.invalid/dns/${randomUUID()}`],
]
const DEFINITIVOS = new Set(['400', '401', '403', '404', '410', '413', 'sub_invalida'])

const todosOsSegredos = []   // fragmentos que NUNCA podem aparecer em infra_falhas/logs/respostas

async function principal() {
  console.log(`== push-erro-permanente · imagem ${IMG} · rede ${NET}`)
  docker('cp', `${CONT_FN}:/root/index.ts`, mainWrapper)
  gerarCertificados()
  try { docker('volume', 'create', VOLUME) } catch { /* existe */ }
  preparar()
  const A = clube('a'), B = clube('b')

  console.log('\n== 0) provedor falso e containers ==')
  subirFake()
  reg('provedor falso responde /__hits', await (async () => { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${PORTAS.kpe_fake}/__hits`); if (r.ok) return true } catch { /* subindo */ } await dorme(500) } return false })())
  // TRAVA DE SEGURANÇA: os nomes dos provedores REAIS têm de resolver para o container falso, senão aborta antes de enviar qualquer coisa
  const ipFake = docker('inspect', 'kpe_fake', '--format', `{{(index .NetworkSettings.Networks "${NET}").IPAddress}}`)
  for (const host of ['fcm.googleapis.com', 'oauth2.googleapis.com', 'push-fake.test']) {
    const out = sh('docker', ['run', '--rm', '--network', NET, 'alpine', 'nslookup', host])
    const resolve = (out.split('Name:')[1] || '').match(/Address:\s*([0-9.]+)/)?.[1]
    if (resolve !== ipFake) { console.error(`ABORTADO: ${host} NÃO resolve para o provedor falso (${resolve} != ${ipFake}). Nada foi enviado.`); throw new Error('alias de rede do provedor falso não funcionou') }
  }
  reg('fcm.googleapis.com, oauth2.googleapis.com e push-fake.test resolvem para o container FALSO (nenhum provedor real é contatado)', true)

  const contaOk = contaFalsa('e2e-ok@e2e-pep.test')
  subirEdge({ nome: 'kpe_edge', contaFcm: contaOk })
  subirEdge({ nome: 'kpe_oauth503', contaFcm: contaFalsa('oauth503@e2e-pep.test') })
  subirEdge({ nome: 'kpe_oauth401', contaFcm: contaFalsa('oauth401@e2e-pep.test') })
  subirEdge({ nome: 'kpe_badjson', contaFcm: `{"private_key":"${SEGREDO_JSON_RUIM}"` })
  for (const n of ['kpe_edge', 'kpe_oauth503', 'kpe_oauth401', 'kpe_badjson']) reg(`[${n}] container sobe e o main service responde`, await esperarSaude(n))
  todosOsSegredos.push(SEGREDO_JSON_RUIM, SEC, PUB, JWT_SECRET, VAPID.priv, SEGREDO_WEBHOOK)

  // ================================================================ 1) tabela status x decisão (uma pessoa, 21 aparelhos web + 17 tokens FCM)
  console.log('\n== 1) cada resposta do provedor, com a MESMA pessoa tendo vários aparelhos (Web Push + FCM) ==')
  const epWeb = Object.fromEntries(WEB.map(([c]) => [c, `https://push-fake.test/${c}/${randomUUID()}`]))
  const tokFcm = Object.fromEntries(FCM.map(([c]) => [c, `${c}-${randomUUID()}`]))
  const extras = ENDPOINTS_EXTRAS.map(([n, , ep]) => [n, ep])
  inserirSubs('ua1', [...Object.values(epWeb), ...extras.map(([, ep]) => ep)])
  inserirTokens('ua1', Object.values(tokFcm))
  inserirSubs('ua2', [`https://push-fake.test/ok/${randomUUID()}`])   // outra pessoa do clube A: tem de receber normalmente
  const ev1 = novoEvento(A, ['ua1', 'ua2'])
  for (const v of [...Object.values(epWeb), ...extras.map(([, ep]) => ep), ...Object.values(tokFcm)]) todosOsSegredos.push(v, v.split('/').pop())
  const r1 = await invocar('kpe_edge', { titulo: 'E2E push erro permanente', corpo: 'x', para: 'todos', club_id: A, push_evento_id: ev1, link: '/avisos' })
  reg('1º invoke: 200 e reservou todos os aparelhos (21 web + 17 FCM + 1 da outra pessoa)', r1.status === 200 && r1.json?.reservadas === WEB.length + extras.length + FCM.length + 1, `${r1.status} ${r1.txt.slice(0, 120)}`)

  const resultadoWeb = [], resultadoFcm = []
  for (const [cen, codigo, removida, retryS] of WEB) {
    const ep = epWeb[cen]
    const t = JSON.parse(tentativas(ep, 'web', ev1))[0] ?? {}
    const existe = subExiste(ep)
    reg(`[web ${cen}] código gravado = ${codigo}; inscrição ${removida ? 'REMOVIDA' : 'MANTIDA'}`, t.codigo === codigo && existe === !removida, `codigo=${t.codigo} existe=${existe}`)
    if (retryS) reg(`[web ${cen}] Retry-After de ${retryS}s guardado (retry_apos ~ ${retryS}s à frente)`, t.retry === true && Math.abs(t.retry_s - retryS) <= 2, JSON.stringify(t))
    else reg(`[web ${cen}] sem Retry-After guardado`, t.retry === false, JSON.stringify(t))
    resultadoWeb.push([cen, t.codigo, existe ? 'mantida' : 'removida'])
  }
  for (const [nome, codigo, ep] of ENDPOINTS_EXTRAS) {
    const t = JSON.parse(tentativas(ep, 'web', ev1))[0] ?? {}
    reg(`[web ${nome}] código = ${codigo} e inscrição MANTIDA (erro de rede nunca remove)`, t.codigo === codigo && subExiste(ep), JSON.stringify(t))
    resultadoWeb.push([nome, t.codigo, subExiste(ep) ? 'mantida' : 'removida'])
  }
  for (const [cen, codigo, removida, retryS] of FCM) {
    const tk = tokFcm[cen]
    const t = JSON.parse(tentativas(tk, 'fcm', ev1))[0] ?? {}
    const existe = tokenExiste(tk)
    reg(`[fcm ${cen}] código gravado = ${codigo}; token ${removida ? 'REMOVIDO' : 'MANTIDO'}`, t.codigo === codigo && existe === !removida, `codigo=${t.codigo} existe=${existe}`)
    if (retryS) reg(`[fcm ${cen}] Retry-After de ${retryS}s guardado`, t.retry === true && Math.abs(t.retry_s - retryS) <= 2, JSON.stringify(t))
    resultadoFcm.push([cen, t.codigo, existe ? 'mantido' : 'removido'])
  }
  const outra = sql(`select count(*) from public.push_tentativas t join public.push_evento_destinatarios d on d.id = t.destinatario_id where d.evento_id = '${ev1}' and d.user_id = ${q(uid('ua2'))} and t.estado = 'entregue'`)
  reg('MÚLTIPLOS DISPOSITIVOS: a outra pessoa do clube recebeu normalmente (entregue) mesmo com dezenas de aparelhos da vizinha falhando', outra === '1', outra)
  const removidasWeb = sql(`select count(*) from public.push_subscriptions where user_id = ${q(uid('ua1'))}`)
  reg(`MÚLTIPLOS DISPOSITIVOS: dos ${WEB.length + extras.length} aparelhos web de ua1 só os 3 permanentes comprovados saíram; ${WEB.length + extras.length - 3} ficaram`, Number(removidasWeb) === WEB.length + extras.length - 3, removidasWeb)
  const removidosFcm = sql(`select count(*) from public.push_tokens where user_id = ${q(uid('ua1'))}`)
  reg(`MÚLTIPLOS DISPOSITIVOS: dos ${FCM.length} tokens FCM de ua1 só 2 saíram (UNREGISTERED e token malformado); ${FCM.length - 2} ficaram`, Number(removidosFcm) === FCM.length - 2, removidosFcm)

  // nada de infra_falhas ruidoso para um 403 isolado no meio de aparelhos que entregaram
  const ruido = sql(`select count(*) from public.infra_falhas where club_id = '${A}' and detalhe ilike '%403%'`)
  reg('401/403 isolados (outros aparelhos entregaram) ficam só em push_tentativas: sem registro em infra_falhas', ruido === '0', ruido)

  // ================================================================ 2) retries: sem repetição infinita
  console.log('\n== 2) reenviar o MESMO evento: tetos por aparelho (1 para definitivo, 3 para temporário) e Retry-After respeitado ==')
  const hits1 = await hitsFake()
  for (const cen of ['s401', 's403', 's400gen', 's413']) reg(`[web ${cen}] 1ª rodada: exatamente 1 requisição ao provedor`, contaHits(hits1, `/${cen}/${epWeb[cen].split('/').pop()}`) === 1)
  for (let i = 2; i <= 4; i++) {
    const r = await invocar('kpe_edge', { titulo: 'E2E push erro permanente', corpo: 'x', para: 'todos', club_id: A, push_evento_id: ev1, link: '/avisos' })
    reg(`re-despacho #${i - 1} do mesmo evento: 200`, r.status === 200, `${r.status} ${r.txt.slice(0, 100)}`)
  }
  const hits4 = await hitsFake()
  const nW = (cen) => contaHits(hits4, `/${cen}/${epWeb[cen].split('/').pop()}`)
  const nF = (cen) => hits4.filter((h) => h.tipo === 'fcm' && h.caminho === tokFcm[cen]).length
  for (const [cen, codigo, removida, retryS] of WEB) {
    const esperado = removida ? 1 : retryS ? 1 : codigo === '200' ? 1 : DEFINITIVOS.has(codigo) ? 1 : 3
    reg(`[web ${cen}] após 4 despachos: ${esperado} tentativa(s) no total (${removida ? 'removida na 1ª' : retryS ? 'Retry-After respeitado' : codigo === '200' ? 'entregue não reenvia' : DEFINITIVOS.has(codigo) ? 'erro definitivo: 1' : 'temporário: teto 3'})`, nW(cen) === esperado, `hits=${nW(cen)}`)
  }
  for (const [cen, codigo, removida, retryS] of FCM) {
    const esperado = removida ? 1 : retryS ? 1 : codigo === '200' ? 1 : DEFINITIVOS.has(codigo) ? 1 : 3
    reg(`[fcm ${cen}] após 4 despachos: ${esperado} tentativa(s) no total`, nF(cen) === esperado, `hits=${nF(cen)}`)
  }
  for (const [nome, , ep] of ENDPOINTS_EXTRAS) {
    const n = sql(`select count(*) from public.push_tentativas t join public.push_evento_destinatarios d on d.id = t.destinatario_id where d.evento_id = '${ev1}' and t.dispositivo_id = md5(${q(ep)})::uuid`)
    reg(`[web ${nome}] erro de rede: 3 tentativas no máximo (teto por evento), inscrição mantida`, n === '3' && subExiste(ep), n)
  }
  const maxPorAparelho = sql(`select coalesce(max(c),0) from (select count(*) c from public.push_tentativas t join public.push_evento_destinatarios d on d.id = t.destinatario_id where d.evento_id = '${ev1}' group by t.dispositivo_id) x`)
  reg('NENHUM aparelho passou de 3 tentativas no evento (sem retry infinito)', Number(maxPorAparelho) <= 3, maxPorAparelho)

  // ================================================================ 3) concorrência
  console.log('\n== 3) concorrência ==')
  sql(`delete from public.push_subscriptions where user_id = ${q(uid('ua2'))}`)   // ua2 só terá os aparelhos deste bloco (ua1/ok segue como prova de saúde do provedor)
  await fetch(`http://127.0.0.1:${PORTAS.kpe_fake}/__reset`, { method: 'POST' })
  const epLento = [1, 2, 3].map(() => `https://push-fake.test/lento/${randomUUID()}`)
  const epOk = [1, 2].map(() => `https://push-fake.test/ok/${randomUUID()}`)
  inserirSubs('ua2', [...epLento, ...epOk])
  const ev2 = novoEvento(A, ['ua2'])
  const corpo2 = { titulo: 'E2E concorrencia', corpo: 'x', para: 'todos', club_id: A, push_evento_id: ev2 }
  const pA = invocar('kpe_edge', corpo2)
  await dorme(300)
  const pB = invocar('kpe_edge', corpo2)
  const [cA, cB] = await Promise.all([pA, pB])
  const hitsC = await hitsFake()
  const porEp = [...epLento, ...epOk].map((ep) => contaHits(hitsC, '/' + ep.split('/').slice(3).join('/')))
  reg('DOIS INVOKES SIMULTÂNEOS do mesmo evento: cada aparelho recebeu EXATAMENTE 1 requisição (nada duplicado)', porEp.every((n) => n === 1), JSON.stringify(porEp))
  reg('...o 2º invoke não reservou nada (jaEntregue) e o 1º reservou os 5', (cA.json?.reservadas === 5 && cB.json?.jaEntregue === true) || (cB.json?.reservadas === 5 && cA.json?.jaEntregue === true), `${cA.txt.slice(0, 60)} | ${cB.txt.slice(0, 60)}`)

  // duas reservas simultâneas no banco (a trava por evento serializa)
  const ev3 = novoEvento(A, ['ua2'])
  const reservar = () => new Promise((res) => {
    const p = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] }); let out = ''
    p.stdout.on('data', (d) => { out += d }); p.on('close', () => res(out.trim()))
    p.stdin.end(`select count(*) from public.push_reservar('${ev3}');`)
  })
  const [rA, rB] = await Promise.all([reservar(), reservar()])
  reg('push_reservar SIMULTÂNEO (2 sessões): a soma das reservas = nº de aparelhos (5 ainda sem tentativa neste evento); nenhuma duplicada', Number(rA) + Number(rB) === 5 && Math.min(Number(rA), Number(rB)) === 0, `${rA}+${rB}`)
  sql(`update public.push_tentativas set estado = 'falhou', codigo = 'timeout' where estado = 'enviando' and club_id = '${A}'`)

  // ================================================================ 4) subscription RECRIADA e poda concorrente
  console.log('\n== 4) inscrição recriada: resposta atrasada e poda concorrente NÃO derrubam a nova ==')
  sql(`delete from public.push_subscriptions where user_id = ${q(uid('ua2'))}`)
  const epAtraso = `https://push-fake.test/lento410/${randomUUID()}`
  inserirSubs('ua2', [epAtraso]); todosOsSegredos.push(epAtraso)
  const ev4 = novoEvento(A, ['ua2'])
  // reserva os demais (ua2 já entregou os outros no ev4? não: evento novo) -> só o epAtraso importa; os outros respondem rápido
  const pAtraso = invocar('kpe_edge', { titulo: 'E2E atraso', corpo: 'x', para: 'todos', club_id: A, push_evento_id: ev4 })
  await dorme(1500)
  const k2 = chaveEcdh()
  sql(`update public.push_subscriptions set p256dh = ${q(k2.p)}, auth = ${q(k2.a)} where endpoint = ${q(epAtraso)};`)   // a pessoa se re-inscreve com o provedor ainda "pensando"
  await pAtraso
  const tAt = JSON.parse(tentativas(epAtraso, 'web', ev4))[0] ?? {}
  reg('RESPOSTA ATRASADA: o provedor respondeu 410 DEPOIS da re-inscrição: tentativa registrada como 410...', tAt.codigo === '410', JSON.stringify(tAt))
  reg('...mas a inscrição NOVA (mesmo endpoint, chaves novas) NÃO foi apagada', subExiste(epAtraso))

  // poda concorrente: candidato "alvo" (3 falhas 403 em 3 dias, nunca entregou) + "controle" idêntico; o host tem prova de saúde (ua2/ok acabou de entregar)
  const epAlvo = `https://push-fake.test/s403/${randomUUID()}`, epControle = `https://push-fake.test/s403/${randomUUID()}`
  inserirSubs('ua2', [epAlvo, epControle]); todosOsSegredos.push(epAlvo, epControle)
  const ev5 = novoEvento(A, ['ua2'])
  const dest5 = sql(`select id from public.push_evento_destinatarios where evento_id = '${ev5}'`)
  for (const ep of [epAlvo, epControle]) {
    sql(`insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, quando, club_id)
         select ${dest5}, md5(${q(ep)})::uuid, 'web', 'falhou', '403', now() - make_interval(days => d), '${A}' from generate_series(0, 2) d;`)
  }
  const lista = sql(`select count(*) from public.push_inscricoes_mortas(3, 2, '${A}')`)
  reg('antes da corrida: alvo e controle são candidatos (2) — e só eles dentro do clube A', lista === '2', lista)
  // sessão 1: re-inscreve o ALVO e segura a transação; sessão 2: poda (bloqueia na linha) -> ao liberar, o DELETE reavalia registrada_em e NÃO apaga
  const k3 = chaveEcdh()
  const sessao1 = new Promise((res) => {
    const p = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] }); p.on('close', () => res())
    p.stdin.end(`begin; update public.push_subscriptions set p256dh = ${q(k3.p)}, auth = ${q(k3.a)} where endpoint = ${q(epAlvo)}; select pg_sleep(4); commit;`)
  })
  for (let i = 0; i < 100; i++) {   // espera a sessão 1 SEGURAR o lock da linha (query ativa em pg_sleep) antes de disparar a poda
    if (sql(`select count(*) from pg_stat_activity where state = 'active' and query like 'select pg_sleep(4)%'`) !== '0') break
    await dorme(100)
  }
  const t0 = Date.now()
  const sessao2 = new Promise((res) => {
    const p = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] }); let out = ''
    p.stdout.on('data', (d) => { out += d }); p.on('close', () => res(out.trim()))
    p.stdin.end(`select canal || ':' || candidatas || ':' || removidas from public.push_podar_inscricoes_mortas(true, 3, 2, '${A}') where canal = 'web';`)
  })
  const saida = await sessao2; await sessao1
  reg('PODA CONCORRENTE: a poda esperou a re-inscrição (bloqueou na linha) e só removeu o CONTROLE (1), nunca o alvo recriado', (Date.now() - t0) > 800 && saida === 'web:2:1', `${saida} em ${Date.now() - t0}ms`)
  reg('...o alvo (re-inscrito durante a poda) continua; o controle saiu', subExiste(epAlvo) && !subExiste(epControle))
  const ens = sql(`select count(*) from public.push_podar_inscricoes_mortas(false, 3, 2, '${A}')`)
  reg('(poda sem p_aplicar é ensaio: nada removido)', subExiste(epAlvo) && ens !== '', ens)

  // ================================================================ 5) multiclube + observabilidade agregada
  console.log('\n== 5) multiclube e registro agregado de credencial ==')
  await fetch(`http://127.0.0.1:${PORTAS.kpe_fake}/__reset`, { method: 'POST' })
  const epB = [1, 2, 3].map(() => `https://push-fake.test/s403/${randomUUID()}`)
  inserirSubs('ub1', epB); todosOsSegredos.push(...epB)
  const evB = novoEvento(B, ['ub1'])
  const rB1 = await invocar('kpe_edge', { titulo: 'E2E clube B', corpo: 'x', para: 'todos', club_id: B, push_evento_id: evB })
  const hitsB = await hitsFake()
  reg('evento do clube B: só os 3 aparelhos do clube B foram tocados (nenhum do clube A)', rB1.json?.reservadas === 3 && hitsB.length === 3 && hitsB.every((h) => epB.some((e) => e.endsWith(h.caminho))), `${rB1.txt.slice(0, 80)} hits=${hitsB.length}`)
  reg('os 3 aparelhos do clube B (todos 403) FORAM mantidos (403 nunca remove)', epB.every(subExiste))
  const agg = sql(`select detalhe from public.infra_falhas where club_id = '${B}'`)
  reg('TODOS os aparelhos do lote com 403 -> UM registro agregado em infra_falhas (código e contagem, sem endpoint)', /^push: web 403 em todos os 3 aparelhos/.test(agg) && !agg.includes('\n'), agg)
  const resumo = sql(`select string_agg(canal || ':' || codigo || ':' || tentativas, ',' order by codigo) from public.push_resumo_erros(1, '${B}')`)
  reg('push_resumo_erros do clube B: só web:403 (3)', resumo === 'web:403:3', resumo)

  // ================================================================ 6) OAuth do FCM e conta de serviço ilegível
  console.log('\n== 6) falhas de OAuth/credencial do FCM: nada é removido, registro sem segredo ==')
  sql(`delete from public.push_subscriptions where user_id = ${q(uid('ub1'))}`)
  const casos = [['kpe_oauth503', 'oauth', /^FCM: oauth 503$/], ['kpe_oauth401', 'oauth', /^FCM: oauth 401$/], ['kpe_badjson', 'oauth', /^FCM: configuração\/credencial$/]]
  const tokOa = {}
  for (const [nome] of casos) {
    const toks = [`ok-${randomUUID()}`, `unreg-${randomUUID()}`]   // até o token "unreg" NÃO pode ser removido: o erro é do OAuth, não do aparelho
    tokOa[nome] = toks; todosOsSegredos.push(...toks)
  }
  for (const [nome, codigo, rx] of casos) {
    sql(`delete from public.push_tokens where user_id = ${q(uid('ub1'))}`)
    inserirTokens('ub1', tokOa[nome])
    sql(`delete from public.infra_falhas where club_id = '${B}'`)
    const ev = novoEvento(B, ['ub1'])
    const r = await invocar(nome, { titulo: 'E2E oauth', corpo: 'x', para: 'todos', club_id: B, push_evento_id: ev })
    const ts = tokOa[nome].map((t) => JSON.parse(tentativas(t, 'fcm', ev))[0] ?? {})
    reg(`[${nome}] 200 e os 2 tokens falharam com "${codigo}" (temporário/credencial do servidor)`, r.status === 200 && ts.every((t) => t.codigo === codigo), `${r.status} ${JSON.stringify(ts)}`)
    reg(`[${nome}] NENHUM token removido (nem o "unreg": o erro é do servidor, não do aparelho)`, tokOa[nome].every(tokenExiste))
    const det = sql(`select string_agg(detalhe, ' | ') from public.infra_falhas where club_id = '${B}'`)
    reg(`[${nome}] infra_falhas registra só o rótulo curto`, rx.test(det.trim()), det)
    reg(`[${nome}] o segredo (conta de serviço ilegível/chaves) não aparece no registro`, !det.includes(SEGREDO_JSON_RUIM) && !/private_key|BEGIN/.test(det), det)
  }

  // ================================================================ 7) vazamento: infra_falhas, logs, respostas
  console.log('\n== 7) varredura de vazamento ==')
  const falhasInfra = sql(`select coalesce(string_agg(detalhe, E'\\n'), '') from public.infra_falhas where club_id in ('${A}', '${B}')`)
  const logs = ['kpe_edge', 'kpe_oauth503', 'kpe_oauth401', 'kpe_badjson'].map((n) => { try { return execFileSync('docker', ['logs', n], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return String(e.stdout ?? '') + String(e.stderr ?? '') } }).join('\n')
  const tudo = falhasInfra + '\n' + logs + '\n' + corposVistos.join('\n')
  const vazou = todosOsSegredos.filter((s) => s && tudo.includes(s))
  reg('infra_falhas + logs das Edge Functions + respostas HTTP não contêm NENHUM endpoint, token, id de aparelho nem chave/segredo', vazou.length === 0, `${vazou.length} ocorrência(s): ${vazou.slice(0, 2).map((s) => s.slice(0, 8) + '…').join(',')}`)
  reg('...nem nomes de host de provedor (push-fake.test/googleapis) em infra_falhas', !/push-fake|googleapis|e2e-pep/.test(falhasInfra), falhasInfra.slice(0, 120))
  reg('as tabelas de push seguem sem coluna de credencial/conteúdo', sql(`select count(*) from information_schema.columns where table_schema='public' and table_name in ('push_tentativas','push_eventos','push_evento_destinatarios') and column_name in ('titulo','corpo','token','endpoint','p256dh','auth','link','payload')`) === '0')

  // ================================================================ tabela final
  console.log('\n== CLASSIFICAÇÃO OBSERVADA (status do provedor -> código gravado / destino da inscrição) ==')
  for (const [c, cod, d] of resultadoWeb) console.log(`   web  ${c.padEnd(16)} ${String(cod).padEnd(14)} ${d}`)
  for (const [c, cod, d] of resultadoFcm) console.log(`   fcm  ${c.padEnd(16)} ${String(cod).padEnd(14)} ${d}`)
}

function limparTudo() {
  for (const n of NOMES) { try { docker('rm', '-f', n) } catch { /* já foi */ } }
  try { docker('volume', 'rm', '-f', VOLUME) } catch { /* ausente */ }
  rmSync(TMP, { recursive: true, force: true })
}
let saiu = false
async function encerrar(codigo) {
  if (saiu) return
  saiu = true
  try { limparBanco() } catch (e) { console.log('   aviso: limpeza do banco:', String(e.message).slice(0, 120)) }
  limparTudo()
  let sobrou = '?'
  try { sobrou = residuos() } catch { /* banco indisponível */ }
  console.log(`\n   limpeza: containers/volume removidos; resíduos de dados sintéticos no banco = ${sobrou}`)
  if (sobrou !== '0') { falhas.push('sobrou dado sintético no banco: ' + sobrou); codigo = 1 }
  console.log(`\n${total - falhas.length}/${total} checagens ok${falhas.length ? ` — ${falhas.length} FALHA(S):` : ' — TUDO OK'}`)
  for (const f of falhas) console.log('   * ' + f)
  process.exit(codigo)
}
process.on('SIGINT', () => encerrar(130)); process.on('SIGTERM', () => encerrar(143))

try { await principal() } catch (e) {
  console.error('ERRO INESPERADO:', e instanceof Error ? e.message : e)
  falhas.push('erro inesperado: ' + (e instanceof Error ? e.message : String(e)))
}
await encerrar(falhas.length ? 1 : 0)
