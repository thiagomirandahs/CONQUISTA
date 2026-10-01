// E2E das EDGE FUNCTIONS usando SOMENTE AS CHAVES NOVAS (sb_secret_ / sb_publishable_) — LOCAL, nunca produção.
//
// O que prova (por função): cada Edge Function roda num container do edge-runtime (a MESMA imagem do `supabase start`, ligado à rede do
// Supabase local) cujo ambiente NÃO tem SUPABASE_SERVICE_ROLE_KEY nem SUPABASE_ANON_KEY (conferido por `printenv`, só os NOMES). O
// container usa o MESMO "main service" do CLI (copiado do container do `supabase start`): é ele quem aplica o verify_jwt do config.toml
// e quem injeta SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS ({"default":"sb_…"}) no worker, exatamente como a plataforma faz.
//
// Perfis de ambiente (cada um num container `kfn_*`, portas 54401–54405):
//   plataforma   só o que a plataforma injeta (SUPABASE_SECRET_KEYS/SUPABASE_PUBLISHABLE_KEYS); sem legacy        <- bateria COMPLETA
//   sb           só SB_SECRET_KEY / SB_PUBLISHABLE_KEY (secrets nossas), nada da plataforma, sem legacy          <- fumaça
//   legacy       só SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (como em produção HOJE)                        <- regressão do fallback
//   semchave     nenhuma chave                                                                                   <- falha fechada
//   modo-nova    só legacy + CHAVES_MODO=nova                                                                    <- falha fechada (legacy ignorada)
//
// As chaves são lidas em tempo de execução do container `supabase_edge_runtime_CONQUISTA` (SUPABASE_INTERNAL_*); nunca vão para arquivo
// versionado, log ou saída. O arquivo de env do container é temporário e apagado no fim. Dados de teste com prefixo "e2e-chv-".
//
//   npm run test:edge:chaves-novas      (Docker + Supabase local no ar, migrations até a 532; baixa pacotes npm na 1ª vez)
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, generateKeyPairSync, createECDH } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '../../..')
const API = process.env.API_URL || 'http://127.0.0.1:54321'
const CONT_DB = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const CONT_FN = process.env.SUPABASE_EDGE_CONTAINER || 'supabase_edge_runtime_CONQUISTA'
const CONT_KONG = process.env.SUPABASE_KONG_CONTAINER || 'supabase_kong_CONQUISTA'
const PREFIXO = 'e2e-chv'
const SENHA = 'senha-e2e-chv-123'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API)) { console.error('ABORTADO: só roda contra o Supabase LOCAL.'); process.exit(2) }

// ---------------------------------------------------------------- utilidades
// KFN_SO=limpar,admin,push,pdf,rpc,sub,smoke,falha (opcional): roda só esses blocos (para depurar); sem isso roda TUDO (o gate usa tudo)
const so = (bloco) => !process.env.KFN_SO || process.env.KFN_SO.split(',').includes(bloco)
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const docker = (...args) => sh('docker', args)
const sql = (texto) => execFileSync('docker', ['exec', '-i', CONT_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
const printenvFn = (nome) => docker('exec', CONT_FN, 'printenv', nome)
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
const b64u = (b) => Buffer.from(b).toString('base64url')

let total = 0
const falhas = []
const porFuncao = {}   // nome -> { checks, ok, falhas[] }
function reg(fn, nome, cond, detalhe = '') {
  total++
  const f = (porFuncao[fn] ??= { checks: 0, ok: 0, falhas: [] })
  f.checks++
  if (cond) { f.ok++; console.log(`   ok     [${fn}] ${nome}`) } else {
    f.falhas.push(`${nome} [${detalhe}]`); falhas.push(`[${fn}] ${nome} [${detalhe}]`)
    console.log(`   FALHOU [${fn}] ${nome}  [${detalhe}]`)
  }
}
const info = (t) => console.log(`   info   ${t}`)

// ---------------------------------------------------------------- chaves LOCAIS (lidas do container; nunca impressas)
const SEC = printenvFn('SUPABASE_INTERNAL_SECRET_KEY')
const PUB = printenvFn('SUPABASE_INTERNAL_PUBLISHABLE_KEY')
if (!SEC.startsWith('sb_secret_') || !PUB.startsWith('sb_publishable_')) { console.error('ABORTADO: o Supabase local não expõe as chaves novas (sb_secret_/sb_publishable_).'); process.exit(2) }
const JWT_SECRET = printenvFn('SUPABASE_INTERNAL_JWT_SECRET')
const JWKS = printenvFn('SUPABASE_JWKS')
const LEG_SERVICE = printenvFn('SUPABASE_SERVICE_ROLE_KEY')   // só para montar o perfil "legacy" (regressão do fallback)
const LEG_ANON = printenvFn('SUPABASE_ANON_KEY')
const VALORES_SECRETOS = [SEC, PUB, LEG_SERVICE, LEG_ANON, JWT_SECRET]   // nenhuma resposta/log pode conter isto

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(API, SEC, semSessao)   // o harness também usa SÓ as chaves novas
const publico = (headers = {}) => createClient(API, PUB, { ...semSessao, global: { headers } })

// ---------------------------------------------------------------- containers kfn_*
// a MESMA imagem do container do `supabase start` (o main service copiado dele só é garantido nessa versão do runtime)
const IMG = docker('inspect', CONT_FN, '--format', '{{.Config.Image}}')
const NET = docker('inspect', CONT_KONG, '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
if (!IMG || !NET) { console.error('ABORTADO: imagem do edge-runtime ou rede do Supabase local não encontradas.'); process.exit(2) }
const TMP = mkdtempSync(join(tmpdir(), 'kfn-'))
const subidos = []          // containers que ESTE script criou
const VOLUME = 'kfn_deno_cache'
const mainWrapper = join(TMP, 'main-index.ts')

const SEG = Object.fromEntries(['SANEAMENTO_SECRET', 'STORAGE_EXCLUIR_SECRET', 'REDE_LIMPEZA_SECRET', 'PUSH_WEBHOOK_SECRET'].map((n) => [n, randomBytes(24).toString('hex')]))
VALORES_SECRETOS.push(...Object.values(SEG))
const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
const VAPID = { pub: b64u(ecdh.getPublicKey()), priv: b64u(ecdh.getPrivateKey()) }
VALORES_SECRETOS.push(VAPID.priv)

const FUNCOES = {
  'enviar-push': { verifyJWT: false, env: { PUSH_WEBHOOK_SECRET: SEG.PUSH_WEBHOOK_SECRET, VAPID_PUBLIC_KEY: VAPID.pub, VAPID_PRIVATE_KEY: VAPID.priv } },
  'sanear-imagens': { verifyJWT: false, env: { SANEAMENTO_SECRET: SEG.SANEAMENTO_SECRET } },
  'storage-excluir': { verifyJWT: false, env: { STORAGE_EXCLUIR_SECRET: SEG.STORAGE_EXCLUIR_SECRET } },
  // limpar-fotos-rede NÃO está no config.toml (o painel/--no-verify-jwt a deixa sem JWT em produção); aqui espelha produção: sem JWT
  'limpar-fotos-rede': { verifyJWT: false, env: { REDE_LIMPEZA_SECRET: SEG.REDE_LIMPEZA_SECRET } },
  'gerar-documento-pdf': { verifyJWT: true, env: {} },
  'gerar-documento-pdf-final': { verifyJWT: true, env: {} },
  'admin-comunidade-foto': { verifyJWT: true, env: {} },
}

function verifyJwtDoConfigToml() {
  // lê o verify_jwt REAL do config.toml (a fonte de verdade) para as funções que ele declara
  const toml = execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(RAIZ, 'supabase/config.toml'))},'utf8'))`], { encoding: 'utf8' })
  const out = {}
  for (const m of toml.matchAll(/\[functions\.([\w-]+)\]\s*\n\s*verify_jwt\s*=\s*(true|false)/g)) out[m[1]] = m[2] === 'true'
  return out
}

function subir({ nome, porta, perfil }) {
  const cfg = {}
  const toml = verifyJwtDoConfigToml()
  for (const [fn, d] of Object.entries(FUNCOES)) {
    const env = { ...d.env }
    if (perfil === 'sb') { env.SB_SECRET_KEY = SEC; env.SB_PUBLISHABLE_KEY = PUB }
    if (perfil === 'modo-nova') env.CHAVES_MODO = 'nova'
    cfg[fn] = { verifyJWT: fn in toml ? toml[fn] : d.verifyJWT, entrypointPath: `supabase/functions/${fn}/index.ts`, env }
  }
  const linhas = [
    // 'indisp': Supabase/Storage INDISPONÍVEL (porta fechada), com as chaves novas válidas — prova a falha limpa de cada função
    'SUPABASE_URL=' + (perfil === 'indisp' ? 'http://127.0.0.1:9' : 'http://' + CONT_KONG + ':8000'),
    `SUPABASE_INTERNAL_HOST_PORT=${porta}`,
    `SUPABASE_INTERNAL_JWT_SECRET=${JWT_SECRET}`,
    `SUPABASE_JWKS=${JWKS}`,
    `SUPABASE_INTERNAL_FUNCTIONS_CONFIG=${JSON.stringify(cfg)}`,
  ]
  if (perfil === 'plataforma' || perfil === 'indisp') linhas.push(`SUPABASE_INTERNAL_PUBLISHABLE_KEY=${PUB}`, `SUPABASE_INTERNAL_SECRET_KEY=${SEC}`)
  if (perfil === 'legacy' || perfil === 'modo-nova') linhas.push(`SUPABASE_SERVICE_ROLE_KEY=${LEG_SERVICE}`, `SUPABASE_ANON_KEY=${LEG_ANON}`)
  const envf = join(TMP, `${nome}.env`)
  writeFileSync(envf, linhas.join('\n') + '\n', { mode: 0o600 })
  try { docker('rm', '-f', nome) } catch { /* não existia */ }
  docker('run', '-d', '--name', nome, '--network', NET, '-p', `${porta}:9000`, '--env-file', envf, '-w', '/app',
    '-v', `${join(RAIZ, 'supabase/functions')}:/app/supabase/functions:ro`, '-v', `${mainWrapper}:/root/index.ts:ro`, '-v', `${VOLUME}:/root/.cache/deno`,
    IMG, 'start', '--main-service=/root', '--port=9000', '--policy=per_worker')
  rmSync(envf, { force: true })
  subidos.push(nome)
  return { nome, base: `http://127.0.0.1:${porta}`, perfil }
}

async function esperarSaude(c) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(c.base + '/_internal/health', { signal: AbortSignal.timeout(3000) }); if (r.ok) return true } catch { /* ainda subindo */ }
    await dorme(1000)
  }
  return false
}

const corposVistos = []   // tudo o que as funções responderam (para a varredura de vazamento)
async function chamar(c, fn, { metodo = 'POST', headers = {}, corpo, bruto } = {}) {
  const h = { ...headers }
  let body
  if (bruto !== undefined) body = bruto
  else if (corpo !== undefined) { body = JSON.stringify(corpo); h['content-type'] ??= 'application/json' }
  let r, txt = ''
  for (let i = 0; i < 4; i++) {
    try { r = await fetch(`${c.base}/${fn}`, { method: metodo, headers: h, body: metodo === 'GET' ? undefined : (body ?? '{}'), signal: AbortSignal.timeout(170000) }); txt = await r.text(); break } catch (e) { if (i === 3) throw e; await dorme(2000) }
  }
  corposVistos.push(txt)
  let json = null; try { json = JSON.parse(txt) } catch { /* texto puro */ }
  return { status: r.status, txt, json, headers: r.headers }
}

// ---------------------------------------------------------------- fixtures (banco + storage), todas com prefixo e2e-chv
const JPG = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.from([0xff, 0xd9])])
const CHAVES_USR = ['dirA', 'desbA', 'dirB', 'comum', 'adm']
const uid = (k) => sql(`select md5('${PREFIXO}:${k}')::uuid;`)
const objetosStorage = []   // [bucket, caminho]
let pendentesAlheios = '[]'

let T0 = null   // relógio do banco no início: o que a função de limpeza logar depois disso é desfeito no fim
function preparar() {
  limparBanco()
  T0 = sql('select clock_timestamp();')
  pendentesAlheios = sql(`select coalesce(json_agg(json_build_object('id', id, 'tent', tentativas, 'erro', erro)), '[]') from public.rede_fotos_para_apagar where apagada_em is null;`)
  // enquanto o teste roda, os pendentes que JÁ existiam no banco local (de outras rodadas) ficam fora da fila da função (tentativas=5);
  // no fim voltam como estavam. Motivo: um lote com um caminho "estranho" desses faz o remove() em lote falhar inteiro e contaminaria o teste.
  sql(`update public.rede_fotos_para_apagar set tentativas = 5 where apagada_em is null;`)
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values
      ('clube', 'E2E Chv Clube A', '${PREFIXO}-clube-a', 'BR', 'America/Recife', '{"test_only":true}'),
      ('clube', 'E2E Chv Clube B', '${PREFIXO}-clube-b', 'BR', 'America/Recife', '{"test_only":true}');
    insert into public.club_features (club_id, feature, enabled)
    select id, 'comunidade', true from public.organizational_units where slug in ('${PREFIXO}-clube-a', '${PREFIXO}-clube-b');
    create temp table e2e_p (k text, papel text, clube text);
    insert into e2e_p values ('dirA','diretoria','${PREFIXO}-clube-a'), ('desbA','desbravador','${PREFIXO}-clube-a'), ('dirB','diretoria','${PREFIXO}-clube-b');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('${PREFIXO}:' || k)::uuid, 'authenticated', 'authenticated', '${PREFIXO}-' || lower(k) || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
      from (select unnest(array['dirA','desbA','dirB','comum','adm']) as k) t;
    insert into public.profiles (id, nome, papel, status, created_at)
    select md5('${PREFIXO}:' || k)::uuid, 'E2E Chv ' || k, 'desbravador', 'ativo', now() - interval '60 days'
      from (select unnest(array['dirA','desbA','dirB','comum','adm']) as k) t;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select md5('${PREFIXO}:' || p.k)::uuid, (select id from public.organizational_units where slug = p.clube), p.papel, 'ativo' from e2e_p p;
    insert into public.platform_admins (user_id, papel, ativo, motivo) values (md5('${PREFIXO}:adm')::uuid, 'suporte', true, '${PREFIXO}');
  `)
}

function limparBanco() {
  sql(`
    set session_replication_role = replica;
    create temp table e2e_u as select id from public.organizational_units where slug like '${PREFIXO}-%';
    create temp table e2e_us as select id from auth.users where email like '${PREFIXO}-%@teste.local';
    delete from public.rede_fotos_para_apagar where club_id in (select id from e2e_u);
    delete from public.push_tentativas where club_id in (select id from e2e_u);
    delete from public.push_evento_destinatarios where evento_id in (select id from public.push_eventos where club_id in (select id from e2e_u));
    delete from public.push_eventos where club_id in (select id from e2e_u);
    delete from public.push_subscriptions where user_id in (select id from e2e_us);
    delete from public.push_tokens where user_id in (select id from e2e_us);
    delete from public.infra_falhas where club_id in (select id from e2e_u);
    delete from public.plataforma_acesso_log where admin_user_id in (select id from e2e_us) or item_club_id in (select id from e2e_u);
    delete from public.platform_admin_audit where admin_user_id in (select id from e2e_us);
    delete from public.platform_admins where user_id in (select id from e2e_us);
    delete from public.comunidade_curtidas where usuario_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.comunidade_comentarios where autor_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.comunidade_denuncias where club_id in (select id from e2e_u) or denunciante_id in (select id from e2e_us);
    delete from public.comunidade_moderacao_log where club_id in (select id from e2e_u);
    delete from public.comunidade_posts where autor_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.rede_stories where autor_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.rede_autorizacao_imagem where usuario_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.auditoria_operacoes where club_id in (select id from e2e_u) or alvo in (select id from e2e_us) or ator in (select id from e2e_us);
    delete from public.comunidade_avisos where usuario_id in (select id from e2e_us);
    delete from public.comunidade_autorizacoes where desbravador_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.notificacoes where club_id in (select id from e2e_u) or criado_por in (select id from e2e_us) or para_usuario in (select id from e2e_us);
    delete from public.club_features where club_id in (select id from e2e_u);
    delete from public.responsaveis where responsavel_id in (select id from e2e_us) or desbravador_id in (select id from e2e_us);
    delete from public.organization_memberships where user_id in (select id from e2e_us);
    delete from public.unidades where club_id in (select id from e2e_u);
    delete from public.profiles where id in (select id from e2e_us);
    delete from auth.users where id in (select id from e2e_us);
    delete from public.organizational_units where id in (select id from e2e_u);
  `)
}

async function entrar(k, clube) {
  const c = publico(clube ? { 'x-clube-atual': clube } : {})
  const { data, error } = await c.auth.signInWithPassword({ email: `${PREFIXO}-${k.toLowerCase()}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return { cli: c, token: data.session.access_token }
}
const comJwt = (t) => ({ authorization: `Bearer ${t}`, apikey: PUB })
const adulterar = (t) => t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA')

// ---------------------------------------------------------------- 0) o Supabase local aceita as chaves novas? (a premissa de toda a prova)
async function provarAceitacaoLocal() {
  console.log('\n== 0) o Supabase LOCAL aceita as chaves novas como apikey? (premissa da prova) ==')
  const get = async (rota, key, extra = {}) => { const r = await fetch(API + rota, { headers: { apikey: key, authorization: `Bearer ${key}`, ...extra } }); return { st: r.status, tx: await r.text() } }
  const a = await get('/storage/v1/bucket', SEC)
  reg('infra', 'Storage via Kong aceita sb_secret_ como service_role (lista TODOS os buckets)', a.st === 200 && /comprovacoes/.test(a.tx), String(a.st))
  const b = await get('/storage/v1/bucket', PUB)
  reg('infra', 'Storage via Kong trata sb_publishable_ como anon (não lista buckets privados)', b.st === 200 && !/comprovacoes/.test(b.tx), String(b.st))
  const c = await get('/auth/v1/admin/users?per_page=1', SEC)
  reg('infra', 'Auth admin aceita sb_secret_', c.st === 200, String(c.st))
  const d = await get('/auth/v1/admin/users?per_page=1', PUB)
  reg('infra', 'Auth admin RECUSA sb_publishable_', d.st === 401 || d.st === 403, String(d.st))
  const e = await fetch(`${API}/rest/v1/rpc/rede_fotos_pendentes`, { method: 'POST', headers: { apikey: SEC, authorization: `Bearer ${SEC}`, 'content-type': 'application/json' }, body: '{"p_limite":1}' })
  reg('infra', 'PostgREST executa RPC só-service_role com sb_secret_', e.status === 200, String(e.status))
  const f = await fetch(`${API}/rest/v1/rpc/rede_fotos_pendentes`, { method: 'POST', headers: { apikey: PUB, authorization: `Bearer ${PUB}`, 'content-type': 'application/json' }, body: '{"p_limite":1}' })
  reg('infra', 'PostgREST NEGA essa RPC a sb_publishable_ (anon)', f.status === 401 || f.status === 403 || f.status === 404, String(f.status))
  info('LIMITE: no Supabase local quem traduz sb_* em JWT interno é o Kong (request-transformer); em produção é o gateway da plataforma. Mesma semântica, outro componente.')
}

// ---------------------------------------------------------------- 1) ambiente: legacy ausente nas funções
function provarAmbiente(c, esperaLegacyAusente) {
  const nomes = docker('exec', c.nome, 'printenv').split('\n').map((l) => l.split('=')[0]).filter(Boolean)
  const tem = (n) => nomes.includes(n)
  if (esperaLegacyAusente) {
    reg('ambiente', `[${c.perfil}] printenv: SUPABASE_SERVICE_ROLE_KEY NÃO existe`, !tem('SUPABASE_SERVICE_ROLE_KEY'))
    reg('ambiente', `[${c.perfil}] printenv: SUPABASE_ANON_KEY NÃO existe`, !tem('SUPABASE_ANON_KEY'))
  } else {
    reg('ambiente', `[${c.perfil}] printenv: legacy presente (perfil de regressão do fallback)`, tem('SUPABASE_SERVICE_ROLE_KEY') && tem('SUPABASE_ANON_KEY'))
  }
  info(`[${c.perfil}] variáveis SUPABASE_* no container (só nomes): ${nomes.filter((n) => n.startsWith('SUPABASE_') && !n.startsWith('SUPABASE_INTERNAL_')).join(', ') || '(nenhuma além das INTERNAL do main service)'}`)
}

// `docker logs` repete o stdout do container no stdout e o stderr no stderr: junta os dois
function logsDe(c) { const r = spawnSync('docker', ['logs', c.nome], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return String(r.stdout || '') + '\n' + String(r.stderr || '') }
function origemNosLogs(c, fn) {
  const m = [...logsDe(c).matchAll(/chaves (\{[^\n]*\})/g)].map((x) => x[1])
  return m
}

// ---------------------------------------------------------------- suíte dos gatilhos (segredo no header)
async function gatilhoBasico(c, fn, header, segredo, { get405 = true } = {}) {
  const r1 = await chamar(c, fn, { headers: {} })
  reg(fn, `[${c.perfil}] sem segredo -> 401, nada tocado`, r1.status === 401, String(r1.status))
  const r2 = await chamar(c, fn, { headers: { [header]: 'segredo-errado' } })
  reg(fn, `[${c.perfil}] segredo errado -> 401`, r2.status === 401, String(r2.status))
  const r3 = await chamar(c, fn, { headers: { [header]: segredo.slice(0, -1) + (segredo.endsWith('0') ? '1' : '0') } })
  reg(fn, `[${c.perfil}] segredo com 1 caractere diferente -> 401`, r3.status === 401, String(r3.status))
  if (get405) {
    const r4 = await chamar(c, fn, { metodo: 'GET', headers: { [header]: segredo } })
    reg(fn, `[${c.perfil}] GET -> 405`, r4.status === 405, String(r4.status))
  }
  const r5 = await chamar(c, fn, { headers: { [header]: segredo, authorization: 'Bearer lixo' } })
  reg(fn, `[${c.perfil}] (verify_jwt=false) segredo certo passa mesmo com Authorization inválido (a fechadura é o segredo, não o JWT)`, r5.status === 200, String(r5.status))
}

// ---------------------------------------------------------------- limpar-fotos-rede
async function suiteLimparFotos(c, completa) {
  const fn = 'limpar-fotos-rede'
  const H = { 'x-rede-limpeza-secret': SEG.REDE_LIMPEZA_SECRET }
  if (completa) await gatilhoBasico(c, fn, 'x-rede-limpeza-secret', SEG.REDE_LIMPEZA_SECRET)
  const clubeA = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-a';`)
  const dono = uid('dirA')
  const pasta = (n) => `${clubeA}/${dono}/${PREFIXO}-limpar-${n}-${randomUUID()}.jpg`
  const [p1, p2] = [pasta(1), pasta(2)]
  const up = await admin.storage.from('comunidade').upload(p1, JPG, { contentType: 'image/jpeg' })
  reg(fn, `[${c.perfil}] (harness) objeto de teste sobe no Storage com a chave nova`, !up.error, up.error?.message)
  objetosStorage.push(['comunidade', p1])
  sql(`insert into public.rede_fotos_para_apagar (club_id, bucket, caminho, motivo, bytes) values
    ('${clubeA}', 'comunidade', '${p1}', 'orfa', ${JPG.length}),
    ('${clubeA}', 'comunidade', '${p2}', 'orfa', 10);`)
  const r = await chamar(c, fn, { headers: H })
  info(`[${c.perfil}] limpar-fotos-rede respondeu: ${r.txt.slice(0, 160)}`)
  reg(fn, `[${c.perfil}] chamada válida -> 200 ok:true (leu a fila com a secret nova)`, r.status === 200 && r.json?.ok === true, `${r.status} ${r.txt.slice(0, 100)}`)
  reg(fn, `[${c.perfil}] apagou do Storage (service remove): objeto sumiu de storage.objects`, sql(`select count(*) from storage.objects where bucket_id='comunidade' and name='${p1}'`) === '0')
  reg(fn, `[${c.perfil}] confirmou no banco (apagada_em preenchida) — escrita via RPC de serviço`, sql(`select count(*) from public.rede_fotos_para_apagar where caminho in ('${p1}','${p2}') and apagada_em is not null`) === '2')
  reg(fn, `[${c.perfil}] arquivo JÁ AUSENTE conta como apagado (fila limpa), não como erro`, sql(`select apagada_em is not null from public.rede_fotos_para_apagar where caminho='${p2}'`) === 't')
  const r2 = await chamar(c, fn, { headers: H })
  const aindaMeus = sql(`select count(*) from public.rede_fotos_para_apagar where caminho in ('${p1}','${p2}') and apagada_em is null`)
  reg(fn, `[${c.perfil}] idempotência: 2ª chamada não reprocessa o que já foi apagado`, r2.status === 200 && aindaMeus === '0')
  if (completa) {
    // privilégio: o usuário comum NÃO consegue o que a função consegue
    const { cli } = await entrar('dirA', clubeA)
    const e1 = await cli.rpc('rede_fotos_pendentes', { p_limite: 1 })
    reg(fn, 'RLS/privilégio: usuário autenticado (publishable + JWT) NÃO executa rede_fotos_pendentes', !!e1.error, e1.error?.message?.slice(0, 60))
    const e2 = await publico().rpc('rede_fotos_confirmar', { p_apagadas: [], p_falhas: [] })
    reg(fn, 'RLS/privilégio: anon (publishable) NÃO executa rede_fotos_confirmar', !!e2.error, e2.error?.message?.slice(0, 60))
    const e3 = await cli.storage.from('comunidade').remove([p1])
    reg(fn, 'RLS/privilégio: usuário comum não remove arquivo de outra pessoa pelo Storage', (e3.data || []).length === 0)
  }
}

// ---------------------------------------------------------------- admin-comunidade-foto
async function suiteAdminFoto(c, completa) {
  const fn = 'admin-comunidade-foto'
  const clubeA = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-a';`)
  const clubeB = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-b';`)
  const dirA = await entrar('dirA', clubeA)
  const adm = await entrar('adm', null)
  const comum = await entrar('comum', null)
  const dirB = await entrar('dirB', clubeB)
  const idDir = uid('dirA'), idAdm = uid('adm')
  async function postar(rotulo) {
    const caminho = `${clubeA}/${idDir}/${randomUUID()}.jpg`
    const up = await dirA.cli.storage.from('comunidade').upload(caminho, JPG, { contentType: 'image/jpeg' })
    if (up.error) throw new Error(`upload ${rotulo}: ${up.error.message}`)
    objetosStorage.push(['comunidade', caminho])
    const r = await dirA.cli.rpc('rede_publicar', { p_tipo: 'foto_clube', p_legenda: `e2e ${rotulo}`, p_foto_path: caminho, p_foto_alt: 'foto e2e', p_alcance: 'comunidade' })
    if (!r.data?.id) throw new Error(`publicar ${rotulo}: ${JSON.stringify(r.data ?? r.error)}`)
    return { id: r.data.id, caminho, status: r.data.status }
  }
  // os posts são criados UMA vez e reaproveitados pelos outros perfis (a publicação tem limite por pessoa/dia)
  if (!fixtureAdminFoto) {
    const emAnalise0 = await postar('analise')
    const aprovado0 = await postar('aprovado')
    const ap = await dirA.cli.rpc('comunidade_moderar', { p_tipo: 'post', p_id: aprovado0.id, p_acao: 'aprovar_foto' })
    reg(fn, '(harness) post em análise e post aprovado criados', emAnalise0.status === 'em_analise' && ap.data?.status === 'publicado', `${emAnalise0.status}/${ap.data?.status}`)
    fixtureAdminFoto = { emAnalise: emAnalise0, aprovado: aprovado0 }
  }
  const { emAnalise, aprovado } = fixtureAdminFoto
  const logN = (id) => Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id='${idAdm}' and o_que='foto_assinada' and item_id='${id}'`))

  const logAntes = logN(emAnalise.id)
  const ok = await chamar(c, fn, { headers: comJwt(adm.token), corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, `[${c.perfil}] admin da plataforma (JWT) -> 200 com URL assinada`, ok.status === 200 && ok.json?.ok && typeof ok.json?.url === 'string', `${ok.status} ${ok.txt.slice(0, 80)}`)
  let abre = false
  if (ok.json?.url) {
    const u = new URL(ok.json.url); const loc = new URL(API)
    u.protocol = loc.protocol; u.host = loc.host
    const img = await fetch(u); const bytes = Buffer.from(await img.arrayBuffer())
    abre = img.status === 200 && bytes.equals(JPG)
  }
  reg(fn, `[${c.perfil}] a URL assinada com a secret nova abre a foto (bytes idênticos)`, abre)
  reg(fn, `[${c.perfil}] a RPC (como o usuário, apikey publishable) gravou exatamente 1 linha de log por chamada`, logN(emAnalise.id) - logAntes === 1, String(logN(emAnalise.id) - logAntes))
  if (!completa) return

  const sem = await chamar(c, fn, { headers: {}, corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'sem Authorization -> 401 (verify_jwt=true, na entrada)', sem.status === 401, String(sem.status))
  const ruim = await chamar(c, fn, { headers: comJwt(adulterar(adm.token)), corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'JWT adulterado -> 401 (verify_jwt=true)', ruim.status === 401, String(ruim.status))
  const lixo = await chamar(c, fn, { headers: { authorization: 'Bearer lixo', apikey: PUB }, corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'Authorization malformado -> 401', lixo.status === 401, String(lixo.status))
  const so = await chamar(c, fn, { headers: { apikey: PUB, authorization: `Bearer ${PUB}` }, corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'só a chave publishable no Authorization (sem sessão de usuário) NÃO passa', so.status === 401 || so.status === 403, String(so.status))
  const antes = logN(emAnalise.id)
  const naoAdm = await chamar(c, fn, { headers: comJwt(dirA.token), corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'diretoria do próprio clube (não é admin da plataforma) -> 403 (a RPC decide; a função não autoriza sozinha)', naoAdm.status === 403, `${naoAdm.status} ${naoAdm.txt.slice(0, 60)}`)
  const outro = await chamar(c, fn, { headers: comJwt(dirB.token), corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'multiclube: diretoria de OUTRO clube -> 403', outro.status === 403, String(outro.status))
  const cm = await chamar(c, fn, { headers: comJwt(comum.token), corpo: { tipo: 'post', id: emAnalise.id } })
  reg(fn, 'usuário comum sem vínculo -> 403', cm.status === 403, String(cm.status))
  reg(fn, 'as negadas NÃO geraram linha de log', logN(emAnalise.id) === antes)
  const pub = await chamar(c, fn, { headers: comJwt(adm.token), corpo: { tipo: 'post', id: aprovado.id } })
  reg(fn, 'admin x post JÁ APROVADO (fora do contexto de análise) -> 403, sem URL', pub.status === 403 && !pub.json?.url, String(pub.status))
  const inex = await chamar(c, fn, { headers: comJwt(adm.token), corpo: { tipo: 'post', id: randomUUID() } })
  reg(fn, 'UUID inexistente -> 403', inex.status === 403, String(inex.status))
  const t = await chamar(c, fn, { headers: comJwt(adm.token), corpo: { tipo: 'foto', id: emAnalise.id } })
  reg(fn, 'tipo inválido -> 400', t.status === 400, String(t.status))
  const i = await chamar(c, fn, { headers: comJwt(adm.token), corpo: { tipo: 'post', id: 'nao-e-uuid' } })
  reg(fn, 'id inválido -> 400', i.status === 400, String(i.status))
  const m = await chamar(c, fn, { metodo: 'GET', headers: comJwt(adm.token) })
  reg(fn, 'GET -> 405', m.status === 405, String(m.status))
  const o = await chamar(c, fn, { metodo: 'OPTIONS', headers: { origin: 'https://app.desbravaclube.com.br' } })
  reg(fn, 'OPTIONS (CORS) responde sem exigir JWT', o.status === 200 && o.headers.get('access-control-allow-origin') === 'https://app.desbravaclube.com.br', String(o.status))
  // por que a função PRECISA do privilégio de serviço: o admin, com o próprio JWT, não assina o bucket
  const direto = await adm.cli.storage.from('comunidade').createSignedUrl(emAnalise.caminho, 60)
  reg(fn, 'privilégio: o MESMO admin, com o próprio JWT (RLS), NÃO assina o arquivo direto no Storage', !!direto.error || !direto.data?.signedUrl, direto.error?.message)
}
let fixtureAdminFoto = null

// Storage ausente: roda por ÚLTIMO (depois dos perfis de fumaça, que reaproveitam a mesma foto)
async function adminFotoArquivoAusente(c) {
  const fn = 'admin-comunidade-foto'
  if (!fixtureAdminFoto) return
  const adm = await entrar('adm', null)
  await admin.storage.from('comunidade').remove([fixtureAdminFoto.emAnalise.caminho])
  const sumiu = await chamar(c, fn, { headers: comJwt(adm.token), corpo: { tipo: 'post', id: fixtureAdminFoto.emAnalise.id } })
  reg(fn, 'arquivo ausente no Storage -> não devolve URL (403 da RPC ou 500 do Storage), nunca 200', sumiu.status !== 200 && !sumiu.json?.url, `${sumiu.status} ${sumiu.txt.slice(0, 80)}`)
}

// ---------------------------------------------------------------- enviar-push
async function suitePush(c, completa) {
  const fn = 'enviar-push'
  const H = { 'x-push-webhook-secret': SEG.PUSH_WEBHOOK_SECRET }
  if (completa) await gatilhoBasico(c, fn, 'x-push-webhook-secret', SEG.PUSH_WEBHOOK_SECRET, { get405: false })
  const clubeA = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-a';`)
  const dirA = uid('dirA'), desbA = uid('desbA'), comumId = uid('comum')
  sql(`delete from public.push_subscriptions where user_id in ('${dirA}', '${desbA}', '${comumId}'); delete from public.push_tokens where user_id in ('${dirA}', '${desbA}', '${comumId}');`)   // cada perfil parte do zero
  const chave =`${PREFIXO}-ev-${randomUUID()}`
  const ev = sql(`insert into public.push_eventos (chave_evento, club_id, destinatarios) values ('${chave}', '${clubeA}', 2) returning id;`).split('\n')[0]
  const epWeb = `https://127.0.0.1:9/${PREFIXO}-sub-${randomUUID()}`   // porta fechada: o envio real é impossível de propósito
  const ecdhSub = createECDH('prime256v1'); ecdhSub.generateKeys()
  sql(`insert into public.push_evento_destinatarios (evento_id, user_id) values ('${ev}', '${dirA}'), ('${ev}', '${desbA}');
       insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${dirA}', '${epWeb}', '${b64u(ecdhSub.getPublicKey())}', '${b64u(randomBytes(16))}');
       insert into public.push_tokens (user_id, token, plataforma) values ('${desbA}', '${PREFIXO}-fcm-${randomUUID()}', 'android');`)
  const antesFalhas = sql(`select count(*) from public.infra_falhas where club_id='${clubeA}'`)
  const r = await chamar(c, fn, { headers: H, corpo: { record: { titulo: 'Teste e2e chaves', corpo: 'x', para: 'todos', club_id: clubeA, push_evento_id: ev, link: '/avisos' } } })
  reg(fn, `[${c.perfil}] chamada válida -> 200 e reservou 2 entregas (RPC push_reservar com a secret nova)`, r.status === 200 && r.json?.reservadas === 2, `${r.status} ${r.txt.slice(0, 100)}`)
  const tent = sql(`select count(*) filter (where estado='falhou') || '/' || count(*) from public.push_tentativas t join public.push_evento_destinatarios d on d.id=t.destinatario_id where d.evento_id='${ev}'`)
  reg(fn, `[${c.perfil}] fechou o ciclo no banco (push_concluir): 2 tentativas gravadas, ambas 'falhou' (provedor real inalcançável de propósito)`, tent === '2/2', tent)
  reg(fn, `[${c.perfil}] escrita em tabela com a secret nova: infra_falhas ganhou o registro "FCM ausente"`, Number(sql(`select count(*) from public.infra_falhas where club_id='${clubeA}'`)) > Number(antesFalhas))
  // idempotência: evento cujo destinatário já tem entrega 'entregue' não reenvia
  const ev2 = sql(`insert into public.push_eventos (chave_evento, club_id, destinatarios) values ('${chave}-2', '${clubeA}', 1) returning id;`).split('\n')[0]
  const ep2 = `https://127.0.0.1:9/${PREFIXO}-sub2-${randomUUID()}`
  sql(`insert into public.push_evento_destinatarios (evento_id, user_id) values ('${ev2}', '${comumId}');
       insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, dispositivo_id) values ('${comumId}', '${ep2}', '${b64u(ecdhSub.getPublicKey())}', '${b64u(randomBytes(16))}', md5('${ep2}')::uuid);
       insert into public.push_tentativas (destinatario_id, dispositivo_id, canal, estado, codigo, club_id)
         select d.id, md5('${ep2}')::uuid, 'web', 'entregue', '200', '${clubeA}' from public.push_evento_destinatarios d where d.evento_id='${ev2}';`)
  const r2 = await chamar(c, fn, { headers: H, corpo: { record: { titulo: 'Teste e2e idempotente', para: 'todos', club_id: clubeA, push_evento_id: ev2 } } })
  reg(fn, `[${c.perfil}] idempotência: entrega já registrada -> jaEntregue:true, nada reenviado`, r2.status === 200 && r2.json?.jaEntregue === true, `${r2.status} ${r2.txt.slice(0, 80)}`)
  if (!completa) return
  const sem = await chamar(c, fn, { headers: H, corpo: { record: { para: 'todos', club_id: clubeA } } })
  reg(fn, 'payload sem título -> 200 "ok (sem notificacao valida)" (o chamador não fica re-tentando)', sem.status === 200 && /sem notificacao valida/.test(sem.txt), sem.txt.slice(0, 60))
  const pess = await chamar(c, fn, { headers: H, corpo: { record: { titulo: 't', para: 'pessoal', club_id: clubeA, push_evento_id: ev } } })
  reg(fn, "multiclube/segurança: 'pessoal' sem destinatário NÃO vira broadcast", pess.status === 200 && /pessoal sem destinatario/.test(pess.txt), pess.txt.slice(0, 60))
  const semClube = await chamar(c, fn, { headers: H, corpo: { record: { titulo: 't', para: 'todos' } } })
  reg(fn, 'notificação sem clube -> ignorada (nunca broadcast)', semClube.status === 200 && /sem clube/.test(semClube.txt), semClube.txt.slice(0, 60))
  const semEv = await chamar(c, fn, { headers: H, corpo: { record: { titulo: 't', para: 'todos', club_id: clubeA } } })
  reg(fn, 'sem evento de push -> não despacha', semEv.status === 200 && /sem evento/.test(semEv.txt), semEv.txt.slice(0, 60))
  // privilégio: o usuário comum não executa a RPC de reserva
  const { cli } = await entrar('dirA', clubeA)
  const e1 = await cli.rpc('push_reservar', { p_evento_id: ev })
  reg(fn, 'RLS/privilégio: usuário autenticado NÃO executa push_reservar', !!e1.error, e1.error?.message?.slice(0, 60))
  const e2 = await cli.from('push_eventos').select('id').limit(1)
  reg(fn, 'RLS: usuário comum não lê push_eventos', (e2.data || []).length === 0)
  const e3 = await cli.from('infra_falhas').insert({ origem: 'x', detalhe: 'y' })
  reg(fn, 'RLS: usuário comum não escreve em infra_falhas', !!e3.error)
}

// ---------------------------------------------------------------- gerar-documento-pdf(+final) e RPC de sanear/excluir
async function suitePdfLeve(c, completa) {
  for (const fn of ['gerar-documento-pdf', 'gerar-documento-pdf-final']) {
    const clubeA = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-a';`)
    const dirA = await entrar('dirA', clubeA)
    const tokenInexistente = randomBytes(24).toString('hex')
    const r = await chamar(c, fn, { headers: comJwt(dirA.token), corpo: { token: tokenInexistente } })
    reg(fn, `[${c.perfil}] JWT válido + token inexistente -> 403 vindo da RPC "como o usuário" (prova que o cliente com a chave pública funciona)`, r.status === 403 || (r.status === 400 && !/api key|apikey|JWT/i.test(r.txt)), `${r.status} ${r.txt.slice(0, 90)}`)
    if (!completa) continue
    const sem = await chamar(c, fn, { headers: {}, corpo: { token: tokenInexistente } })
    reg(fn, 'sem Authorization -> 401 (verify_jwt=true)', sem.status === 401, String(sem.status))
    const ruim = await chamar(c, fn, { headers: comJwt(adulterar(dirA.token)), corpo: { token: tokenInexistente } })
    reg(fn, 'JWT adulterado -> 401', ruim.status === 401, String(ruim.status))
    const b = await chamar(c, fn, { headers: comJwt(dirA.token), corpo: { token: 'curto' } })
    reg(fn, 'token em formato inválido -> 400', b.status === 400, String(b.status))
    const v = await chamar(c, fn, { headers: comJwt(dirA.token), corpo: {} })
    reg(fn, 'sem token -> 400', v.status === 400, String(v.status))
    const g = await chamar(c, fn, { metodo: 'GET', headers: comJwt(dirA.token) })
    reg(fn, 'GET -> 405', g.status === 405, String(g.status))
  }
}

async function suiteRpcDeServico(completa) {
  // O que sanear-imagens/storage-excluir/limpar chamam só funciona com service_role: o usuário comum NÃO tem essas RPCs
  const clubeA = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-a';`)
  const { cli } = await entrar('dirA', clubeA)
  const anon = publico()
  for (const [fn, rpc, args] of [['sanear-imagens', 'imagem_saneamento_pendentes', { p_limite: 1 }], ['storage-excluir', '_storage_exclusao_processar', { p_limite: 1 }]]) {
    const e1 = await cli.rpc(rpc, args)
    reg(fn, `RLS/privilégio: usuário autenticado NÃO executa ${rpc}`, !!e1.error, e1.error?.message?.slice(0, 60))
    const e2 = await anon.rpc(rpc, args)
    reg(fn, `RLS/privilégio: anon NÃO executa ${rpc}`, !!e2.error, e2.error?.message?.slice(0, 60))
  }
  const b = await cli.storage.from('comprovacoes').download(`${uid('desbA')}/x`)
  reg('sanear-imagens', 'privilégio: o usuário não baixa arquivo de OUTRA pessoa (a função baixa qualquer um -> exige serviço)', !!b.error)
}

// ---------------------------------------------------------------- sub-E2Es existentes, apontados para a função nos containers kfn
function rodarSub(fn, script, env) {
  const r = spawnSync('node', [join(AQUI, script)], { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: RAIZ })
  const saida = (r.stdout || '') + (r.stderr || '')
  corposVistos.push(saida)
  const linhas = saida.trim().split(/\r?\n/)
  const falhasSub = linhas.filter((l) => /FALHOU/.test(l))
  info(`${script}: exit=${r.status} · ${linhas.slice(-2).join(' | ')}`)
  reg(fn, `sub-E2E ${script} (cenários completos de Storage/RLS/idempotência) passa com a função só com chaves novas`, r.status === 0 && falhasSub.length === 0, `exit=${r.status} ${falhasSub.slice(0, 2).join(' ; ')}`)
}

// ---------------------------------------------------------------- principal
const PORTAS = { plataforma: 54401, sb: 54402, legacy: 54403, semchave: 54404, 'modo-nova': 54405, indisp: 54406 }
async function principal() {
  console.log(`== edge-chaves-novas · imagem ${IMG} · rede ${NET}`)
  docker('cp', `${CONT_FN}:/root/index.ts`, mainWrapper)
  await provarAceitacaoLocal()
  preparar()

  console.log('\n== 1) containers kfn_* (ambiente SÓ com chaves novas) ==')
  const cs = {}
  for (const perfil of ['plataforma', 'sb', 'legacy', 'semchave', 'modo-nova', 'indisp']) cs[perfil] = subir({ nome: `kfn_${perfil.replace('-', '_')}`, porta: PORTAS[perfil], perfil })
  for (const c of Object.values(cs)) reg('ambiente', `[${c.perfil}] container sobe e o main service responde /_internal/health`, await esperarSaude(c))
  provarAmbiente(cs.plataforma, true); provarAmbiente(cs.sb, true); provarAmbiente(cs.legacy, false); provarAmbiente(cs.semchave, true); provarAmbiente(cs['modo-nova'], false)
  const nomesPlat = docker('exec', cs.plataforma.nome, 'printenv').split('\n').map((l) => l.split('=')[0])
  reg('ambiente', '[plataforma] só as INTERNAL do main service existem; as funções recebem SUPABASE_SECRET_KEYS/SUPABASE_PUBLISHABLE_KEYS por injeção do main service (formato {"default":"sb_…"})', nomesPlat.includes('SUPABASE_INTERNAL_SECRET_KEY'))

  console.log('\n== 2) BATERIA COMPLETA — perfil "plataforma" (só SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS) ==')
  const P = cs.plataforma
  if (so('rpc')) await suiteRpcDeServico(true)
  if (so('limpar')) await suiteLimparFotos(P, true)
  if (so('admin')) await suiteAdminFoto(P, true)
  if (so('push')) await suitePush(P, true)
  if (so('pdf')) await suitePdfLeve(P, true)

  if (so('sub')) {
    console.log('\n   -- sub-E2Es existentes contra as funções nos containers kfn --')
    rodarSub('sanear-imagens', 'saneamento-storage-real.mjs', { FUNCAO_URL: `${P.base}/sanear-imagens`, SANEAMENTO_SECRET: SEG.SANEAMENTO_SECRET })
    rodarSub('storage-excluir', 'storage-exclusao-real.mjs', { FUNCAO_URL: `${P.base}/storage-excluir`, STORAGE_EXCLUIR_SECRET: SEG.STORAGE_EXCLUIR_SECRET })
    await gatilhoBasico(P, 'sanear-imagens', 'x-saneamento-secret', SEG.SANEAMENTO_SECRET)
    await gatilhoBasico(P, 'storage-excluir', 'x-storage-excluir-secret', SEG.STORAGE_EXCLUIR_SECRET)
    rodarSub('gerar-documento-pdf', 'pdf-ponta-a-ponta.mjs', { FUNCOES_BASE: P.base })
    porFuncao['gerar-documento-pdf-final'] ??= { checks: 0, ok: 0, falhas: [] }
    info('o fluxo pdf-ponta-a-ponta cobre as duas funções de PDF (H1 e H2 + idempotência + outro clube negado); o resultado vale para ambas')
    if (porFuncao['gerar-documento-pdf'].falhas.length === 0) reg('gerar-documento-pdf-final', 'sub-E2E pdf-ponta-a-ponta (H2, assinatura desenhada via Storage, idempotência) passa com a função só com chaves novas', true)
    else reg('gerar-documento-pdf-final', 'sub-E2E pdf-ponta-a-ponta passa', false, 'ver falhas de gerar-documento-pdf')
  }

  const fumaca = async (c, rotulo) => {
    // sanear-imagens devolve `ok` como CONTAGEM (o espalhamento de ...c sobrescreve ok:true; comportamento antigo, mantido): por isso checa `reservados`
    for (const [fn, header, seg] of [['sanear-imagens', 'x-saneamento-secret', SEG.SANEAMENTO_SECRET], ['storage-excluir', 'x-storage-excluir-secret', SEG.STORAGE_EXCLUIR_SECRET]]) {
      const r = await chamar(c, fn, { headers: { [header]: seg } })
      reg(fn, `[${c.perfil}] chamada válida -> 200 e a RPC só-serviço da fila executou (${rotulo})`, r.status === 200 && typeof r.json?.reservados === 'number', `${r.status} ${r.txt.slice(0, 80)}`)
    }
    await suiteLimparFotos(c, false); await suiteAdminFoto(c, false); await suitePush(c, false); await suitePdfLeve(c, false)
  }
  if (so('smoke')) {
    console.log('\n== 3) FUMAÇA — perfil "sb" (SB_SECRET_KEY / SB_PUBLISHABLE_KEY; plataforma e legacy ausentes) ==')
    await fumaca(cs.sb, 'SB_SECRET_KEY')
    console.log('\n== 4) REGRESSÃO DO FALLBACK — perfil "legacy" (como produção hoje: só service_role/anon) ==')
    await fumaca(cs.legacy, 'fallback legacy preservado')
  }
  if (so('admin')) await adminFotoArquivoAusente(P)

  console.log('\n== 5) FALHA FECHADA — sem chave nenhuma, e CHAVES_MODO=nova só com legacy ==')
  const tokenAdm = (await entrar('adm', null)).token
  for (const perfil of ['semchave', 'modo-nova']) {
    for (const fn of Object.keys(FUNCOES)) {
      const r = await chamar(cs[perfil], fn, { headers: { 'x-rede-limpeza-secret': SEG.REDE_LIMPEZA_SECRET, 'x-saneamento-secret': SEG.SANEAMENTO_SECRET, 'x-storage-excluir-secret': SEG.STORAGE_EXCLUIR_SECRET, 'x-push-webhook-secret': SEG.PUSH_WEBHOOK_SECRET, ...(FUNCOES[fn].verifyJWT ? comJwt(tokenAdm) : {}) }, corpo: {} })
      reg(fn, `[${perfil}] função não opera sem chave utilizável (boot error 5xx, sem vazar chave), nunca 200`, r.status >= 500 && !/sb_secret_|service_role/i.test(r.txt), `${r.status} ${r.txt.slice(0, 80)}`)
    }
  }

  if (so('falha')) {
    console.log('\n== 5b) SUPABASE/STORAGE INDISPONÍVEL (chaves novas válidas, porta fechada): falha limpa, sem 200 e sem vazar nada ==')
    const I = cs.indisp
    const segs = { 'sanear-imagens': 'x-saneamento-secret', 'storage-excluir': 'x-storage-excluir-secret', 'limpar-fotos-rede': 'x-rede-limpeza-secret' }
    const valores = { 'sanear-imagens': SEG.SANEAMENTO_SECRET, 'storage-excluir': SEG.STORAGE_EXCLUIR_SECRET, 'limpar-fotos-rede': SEG.REDE_LIMPEZA_SECRET }
    for (const fn of Object.keys(segs)) {
      const r = await chamar(I, fn, { headers: { [segs[fn]]: valores[fn] } })
      reg(fn, '[indisp] banco/Storage indisponível -> 500 controlado (ok:false/erro), nunca 200 ok:true', r.status === 500 && r.json?.ok !== true, `${r.status} ${r.txt.slice(0, 80)}`)
    }
    const clubeA = sql(`select id from public.organizational_units where slug='${PREFIXO}-clube-a';`)
    const rp = await chamar(I, 'enviar-push', { headers: { 'x-push-webhook-secret': SEG.PUSH_WEBHOOK_SECRET }, corpo: { record: { titulo: 't', para: 'todos', club_id: clubeA, push_evento_id: randomUUID() } } })
    reg('enviar-push', '[indisp] banco indisponível -> 500 "erro interno" (sem detalhe), o chamador pode re-tentar', rp.status === 500 && /erro interno/.test(rp.txt), `${rp.status} ${rp.txt.slice(0, 80)}`)
    const adm = await entrar('adm', null)
    const ra = await chamar(I, 'admin-comunidade-foto', { headers: comJwt(adm.token), corpo: { tipo: 'post', id: randomUUID() } })
    reg('admin-comunidade-foto', '[indisp] RPC indisponível -> não assina nada (403/5xx), nunca devolve URL', ra.status !== 200 && !ra.json?.url, `${ra.status} ${ra.txt.slice(0, 80)}`)
    for (const fn of ['gerar-documento-pdf', 'gerar-documento-pdf-final']) {
      const rd = await chamar(I, fn, { headers: comJwt(adm.token), corpo: { token: randomBytes(24).toString('hex') } })
      reg(fn, '[indisp] RPC indisponível -> erro (4xx/5xx), nunca PDF/200', rd.status !== 200, `${rd.status} ${rd.txt.slice(0, 80)}`)
    }
  }

  console.log('\n== 6) de onde veio cada chave (log de boot das funções; só origem e NOME da variável) ==')
  const origens = { plataforma: origemNosLogs(cs.plataforma), sb: origemNosLogs(cs.sb), legacy: origemNosLogs(cs.legacy) }
  const esperado = { plataforma: [/nova:SUPABASE_SECRET_KEYS/], sb: [/nova:SB_SECRET_KEY/], legacy: [/legacy:SUPABASE_SERVICE_ROLE_KEY/] }
  for (const perfil of Object.keys(origens)) {
    reg('chaves', `[${perfil}] log de boot das funções registra a origem esperada (${esperado[perfil][0].source})`, origens[perfil].length > 0 && origens[perfil].every((l) => esperado[perfil][0].test(l)), origens[perfil].slice(0, 2).join(' '))
    info(`[${perfil}] ${[...new Set(origens[perfil])].join(' | ')}`)
    if (!origens[perfil].length && process.env.KFN_LOGS) console.log(logsDe(cs[perfil]).split('\n').filter((l) => !VALORES_SECRETOS.some((v) => l.includes(v))).slice(-40).join('\n'))
  }
  reg('chaves', '[plataforma] NENHUMA função usou origem legacy', !origens.plataforma.some((l) => /legacy/.test(l)))
  reg('chaves', '[sb] NENHUMA função usou origem legacy', !origens.sb.some((l) => /legacy/.test(l)))

  console.log('\n== 7) varredura de vazamento: respostas HTTP e logs dos containers ==')
  const todosLogs = Object.values(cs).map(logsDe).join('\n')
  const tudo = corposVistos.join('\n') + '\n' + todosLogs
  for (const [rotulo, v] of [['secret nova', SEC], ['publishable', PUB], ['service_role legacy', LEG_SERVICE], ['anon legacy', LEG_ANON], ['segredo JWT', JWT_SECRET], ['VAPID privada', VAPID.priv], ...Object.entries(SEG)]) {
    reg('segredos', `nenhuma resposta/log contém o valor de: ${rotulo}`, !tudo.includes(v))
  }
  reg('segredos', 'nenhum log/resposta contém um literal sb_secret_', !/sb_secret_[A-Za-z0-9_-]{8,}/.test(tudo))
}

function limparTudo() {
  for (const n of subidos) { try { docker('rm', '-f', n) } catch { /* já foi */ } }
  try { docker('volume', 'rm', '-f', VOLUME) } catch { /* em uso/ausente */ }
  rmSync(TMP, { recursive: true, force: true })
}
async function limparDados() {
  try {
    for (const [b, p] of objetosStorage) { try { await admin.storage.from(b).remove([p]) } catch { /* melhor esforço */ } }
    limparBanco()
    // devolve o estado dos pendentes que já existiam antes (a função de limpeza os processa; aqui voltam como estavam)
    const antes = JSON.parse(pendentesAlheios || '[]')
    if (antes.length) sql(`update public.rede_fotos_para_apagar set apagada_em = null, tentativas = x.tent, erro = x.erro from json_to_recordset('${JSON.stringify(antes).replace(/'/g, "''")}'::json) as x(id uuid, tent int, erro text) where rede_fotos_para_apagar.id = x.id;`)
    if (T0) sql(`delete from public.rede_limpeza_log where created_at >= '${T0}' and origem = 'edge';`)
  } catch (e) { console.log('   aviso: limpeza parcial:', String(e.message).slice(0, 120)) }
}

let saiu = false
async function encerrar(codigo) {
  if (saiu) return
  saiu = true
  await limparDados(); limparTudo()
  process.exit(codigo)
}
process.on('SIGINT', () => encerrar(130)); process.on('SIGTERM', () => encerrar(143))

try {
  await principal()
} catch (e) {
  console.error('ERRO INESPERADO:', e instanceof Error ? e.message : e)
  falhas.push('erro inesperado: ' + (e instanceof Error ? e.message : String(e)))
}

// ---------------------------------------------------------------- relatório
const LIMITES = {
  'sanear-imagens': null, 'storage-excluir': null, 'limpar-fotos-rede': null, 'admin-comunidade-foto': null,
  'gerar-documento-pdf': null, 'gerar-documento-pdf-final': null,
  'enviar-push': 'o envio REAL (Web Push para um endpoint do navegador e FCM do Google) é impossível localmente (sem rede ao provedor, sem FCM_SERVICE_ACCOUNT); provado: autenticação por segredo, reserva/conclusão via RPC de serviço, escrita em infra_falhas, idempotência e falha por provedor inalcançável',
}
console.log('\n== CLASSIFICAÇÃO (só valem as checagens acima; o ambiente das funções não tinha as chaves legacy) ==')
for (const fn of Object.keys(FUNCOES)) {
  const r = porFuncao[fn] || { checks: 0, ok: 0, falhas: [] }
  const classe = r.falhas.length ? 'FALHOU' : r.checks === 0 ? 'NÃO EXECUTADA' : LIMITES[fn] ? 'PROVADA PARCIALMENTE' : 'PROVADA COM CHAVES NOVAS'
  console.log(`   ${classe.padEnd(26)} ${fn.padEnd(28)} ${r.ok}/${r.checks}${LIMITES[fn] ? '  — ' + LIMITES[fn] : ''}`)
}
console.log(`\n${total - falhas.length}/${total} checagens ok${falhas.length ? ` — ${falhas.length} FALHA(S):` : ' — TUDO OK'}`)
for (const f of falhas) console.log('   * ' + f)
await encerrar(falhas.length ? 1 : 0)
