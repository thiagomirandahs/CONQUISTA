// E2E da INSCRIÇÃO COM E-MAIL REAL, confirmação aberta em OUTRO navegador (stack LOCAL; nunca produção).
//
//   node supabase/tests/e2e/_seed_homologacao.mjs        (cria hml-clube-a/b e as personas hml-*)
//   npm run test:inscricao:email:e2e
//
// O que prova, com o e-mail que o GoTrue de verdade manda para a caixa (Mailpit do stack local):
//   link/QR (código) ou clube escolhido na lista -> signUp com entrada_codigo / entrada_clube_slug no user_metadata
//   -> o e-mail de confirmação CHEGA -> o link do e-mail é aberto por um cliente HTTP NOVO, sem nenhum estado
//   (sem cookie, sem sessionStorage, sem ?proximo=, sem header de clube = "outro navegador") -> a sessão
//   obtida só traz o que está na CONTA -> o MESMO serviço do app (src/services/entrada.js:
//   aplicarEntradaDoCadastro / aplicarClubeEscolhidoNoCadastro) cria o vínculo PENDENTE no clube CERTO, papel
//   decidido pelo servidor, nunca ativo -> a diretoria do clube aprova (vinculo_gerir) -> só então há acesso.
//   Também: e-mail de RECUPERAÇÃO (o que o link contém, sem expor token) e a troca de senha com o token.
//
// Como o e-mail é lido: API REST do Mailpit (o container se chama "inbucket" por herança do Supabase CLI, mas a
// imagem é o Mailpit; API em /api/v1). Primeiro pela porta publicada no host (127.0.0.1:54324); se ela não estiver
// publicada, por `docker exec supabase_inbucket_CONQUISTA wget -qO- http://localhost:8025/...` (a imagem tem wget).
// Como o "outro navegador" é simulado: fetch com redirect:'manual' no link de verificação do GoTrue; os tokens
// vêm do fragmento (#access_token=…) do Location (fluxo implícito, o padrão do supabase-js), e a sessão é montada
// num createClient novo (persistSession:false). Tokens NUNCA são impressos (só host/caminho/tipo).
//
// Segurança: aborta se a API/Auth não for local (127.0.0.1) ou se o container do Auth não responder como local.
// Limpa tudo (contas e2e-mail-*@teste.local, vínculos, códigos dos clubes hml-*, mensagens do Mailpit desses
// endereços) no início e no fim, mesmo se falhar. Idempotente.
import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const API_URL = process.env.E2E_API_URL || 'http://127.0.0.1:54321'
const MAIL_HOST = 'http://127.0.0.1:54324'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA_HML = 'senha-homologacao-123'
const SENHA = 'senha-mail-123'
const SENHA_NOVA = 'senha-mail-nova-456'
const DB = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const AUTH = DB.replace('_db_', '_auth_')
const MAILC = DB.replace('_db_', '_inbucket_')
const PREFIXO = 'e2e-mail-'

// ---- trava: só stack local ----
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL)) { console.error(`ABORTADO: API_URL não é local (${API_URL}).`); process.exit(2) }

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
let envAuth = ''
try { envAuth = execFileSync('docker', ['exec', AUTH, 'env'], { encoding: 'utf8' }) } catch { /* tratado abaixo */ }
const siteLocal = (envAuth.match(/^GOTRUE_SITE_URL=(.*)$/m) || [])[1] || ''
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(siteLocal) || /GOTRUE_SMTP_HOST=(?!supabase_inbucket)/.test(envAuth)) {
  console.error(`ABORTADO: o Auth do container ${AUTH} não parece o stack local (site_url="${siteLocal}").`); process.exit(2)
}
const autoconfirm = (envAuth.match(/^GOTRUE_MAILER_AUTOCONFIRM=(.*)$/m) || [])[1]
if (autoconfirm !== 'false') { console.error('ABORTADO: o Auth local está com autoconfirm ligado; este teste exige confirmação de e-mail.'); process.exit(2) }
const allowList = (envAuth.match(/^GOTRUE_URI_ALLOW_LIST=(.*)$/m) || [])[1] || ''

// ---- o serviço REAL do app (src/services/entrada.js) rodando em node: troca só o módulo do cliente ----
// src/lib/supabase.js usa import.meta.env (só existe no Vite); o hook entrega um cliente que delega para
// globalThis.__clienteE2E, que cada cenário aponta para a sessão da pessoa ("o que está logado neste navegador").
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (/\\/lib\\/supabase\\.js$/.test(spec)) return { url: 'data:text/javascript,' + encodeURIComponent("export const supabase = new Proxy({}, { get: (_, k) => globalThis.__clienteE2E[k] })"), shortCircuit: true }
    return next(spec, ctx)
  }
`))
const { aplicarEntradaDoCadastro, aplicarClubeEscolhidoNoCadastro } = await import('../../../src/services/entrada.js')
const { codigoDoMetadado, slugDoMetadado } = await import('../../../src/lib/entradaDoCadastro.js')

let total = 0
let reprovados = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) { reprovados++; falhas.push(`${nome}  [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`)
}
const nota = (t) => console.log(`   nota   ${t}`)
const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }
const novoCliente = () => createClient(API_URL, ANON, semSessao)
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- Mailpit ----
async function mailGet(caminho) {
  try {
    const r = await fetch(`${MAIL_HOST}${caminho}`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) return r.json()
  } catch { /* porta não publicada: cai para o docker exec */ }
  const out = execFileSync('docker', ['exec', MAILC, 'wget', '-qO-', `http://localhost:8025${caminho}`], { encoding: 'utf8' })
  return JSON.parse(out)
}
async function mailDelete(ids) {
  if (!ids.length) return
  const corpo = JSON.stringify({ IDs: ids })
  try {
    const r = await fetch(`${MAIL_HOST}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: corpo, signal: AbortSignal.timeout(4000) })
    if (r.ok) return
  } catch { /* cai para o docker exec */ }
  execFileSync('docker', ['exec', MAILC, 'wget', '-qO-', '--method=DELETE', '--header=Content-Type: application/json', `--body-data=${corpo}`, 'http://localhost:8025/api/v1/messages'], { encoding: 'utf8' })
}
const todasDaCaixa = async () => (await mailGet('/api/v1/messages?limit=500')).messages || []
async function limparCaixa() {
  const ids = (await todasDaCaixa()).filter((m) => (m.To || []).some((t) => t.Address.startsWith(PREFIXO))).map((m) => m.ID)
  await mailDelete(ids)
}
// espera o e-mail do GoTrue para `dest` (assunto opcional); devolve { assunto, de, texto, html, links }
const vistos = []   // todo e-mail lido nesta execução (para a varredura de esquemas proibidos)
async function esperarEmail(dest, { depoisDe = 0, tentativas = 40 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const msg = (await todasDaCaixa()).find((m) => (m.To || []).some((t) => t.Address === dest) && new Date(m.Created).getTime() >= depoisDe)
    if (msg) {
      const c = await mailGet(`/api/v1/message/${msg.ID}`)
      const texto = c.Text || ''; const html = c.HTML || ''
      const links = [...new Set(`${texto} ${html}`.match(/https?:\/\/[^\s"'<>]+/g) || [])].map((l) => l.replace(/&amp;/g, '&'))
      const m = { id: msg.ID, assunto: msg.Subject, de: c.From?.Address, para: dest, texto, html, links }
      vistos.push(m)
      return m
    }
    await dorme(300)
  }
  return null
}
const linkDeVerificacao = (m) => m?.links.find((l) => l.includes('/auth/v1/verify'))
// mostra só o que não é segredo: origem + caminho + type + redirect_to
function resumoDoLink(l) {
  const u = new URL(l)
  return `${u.origin}${u.pathname}?type=${u.searchParams.get('type')}&redirect_to=${u.searchParams.get('redirect_to')}`
}

// "OUTRO NAVEGADOR": cliente HTTP sem cookie/estado nenhum; segue o link do e-mail sem seguir o redirect
// (o Location do GoTrue leva os tokens no fragmento #access_token=…).
async function abrirLinkEmOutroNavegador(link) {
  const r = await fetch(link, { redirect: 'manual', headers: { 'user-agent': 'e2e-outro-navegador' } })
  const loc = r.headers.get('location') || ''
  const u = loc ? new URL(loc) : null
  const frag = new URLSearchParams((u?.hash || '').replace(/^#/, ''))
  return {
    status: r.status,
    destino: u ? `${u.origin}${u.pathname}` : null,
    temTokens: !!frag.get('access_token') && !!frag.get('refresh_token'),
    tipo: frag.get('type'),
    erro: frag.get('error_description') || frag.get('error') || new URLSearchParams(u?.search || '').get('error_description'),
    access: frag.get('access_token'), refresh: frag.get('refresh_token'),
  }
}
// o cliente do navegador 2: só tem a sessão que o link do e-mail entregou
async function sessaoDoLink(abertura) {
  const c = novoCliente()
  const { data, error } = await c.auth.setSession({ access_token: abertura.access, refresh_token: abertura.refresh })
  if (error) throw new Error(`setSession: ${error.message}`)
  return { c, user: data.user }
}

// ---- helpers de banco ----
const vinculos = (uid, clube) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('role', role, 'status', status, 'source', metadata->>'source') order by created_at), '[]') from public.organization_memberships where user_id='${uid}' and organizational_unit_id='${clube}';`))
const idClube = (slug) => sql(`select id from public.organizational_units where slug='${slug}';`)
const semAcesso = (r) => !!r.error || r.data == null || (Array.isArray(r.data) && r.data.length === 0)

function limparBanco() {
  sql(`
    set session_replication_role = replica;
    delete from public.onboarding_sessions where user_id in (select id from auth.users where email like '${PREFIXO}%@teste.local');
    delete from public.entrada_tentativas where user_id in (select id from auth.users where email like '${PREFIXO}%@teste.local');
    delete from public.responsaveis where responsavel_id in (select id from auth.users where email like '${PREFIXO}%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like '${PREFIXO}%@teste.local');
    delete from public.profiles where id in (select id from auth.users where email like '${PREFIXO}%@teste.local');
    delete from auth.users where email like '${PREFIXO}%@teste.local';
    delete from public.club_entry_codes where club_id in (select id from public.organizational_units where slug in ('hml-clube-a','hml-clube-b'));
  `)
}

function clienteHml() {
  let clube = null
  const fetchComHeader = (input, init) => {
    const h = new Headers((init || {}).headers || {})
    if (clube) h.set('x-clube-atual', clube)
    return fetch(input, { ...(init || {}), headers: h })
  }
  const c = createClient(API_URL, ANON, { ...semSessao, global: { fetch: fetchComHeader } })
  return { c, usar: (id) => { clube = id } }
}
async function logarHml(chave) {
  const s = clienteHml()
  const { error } = await s.c.auth.signInWithPassword({ email: `hml-${chave}@teste.local`, password: SENHA_HML })
  if (error) throw new Error(`login hml-${chave}: ${error.message} (rode antes: node supabase/tests/e2e/_seed_homologacao.mjs)`)
  return s
}
// o que o navegador faz ao ter sessão: ClubeGuard roda o serviço apontando o "supabase" do app para esta sessão
function comoNavegador(cliente) { globalThis.__clienteE2E = cliente }

// cadastro (signUp real) + espera do e-mail de confirmação; devolve { email, id, mail, link }
async function cadastrar(rotulo, meta = {}) {
  const email = `${PREFIXO}${rotulo}@teste.local`
  const c = novoCliente()
  const t0 = Date.now() - 1500
  const { data, error } = await c.auth.signUp({ email, password: SENHA, options: { data: { nome: `E2E Mail ${rotulo}`, tipo: '', nascimento: '2012-05-05', cargo: '', ...meta } } })
  if (error) throw new Error(`signUp ${rotulo}: ${error.message}`)
  const mail = await esperarEmail(email, { depoisDe: t0 })
  return { email, id: data.user?.id, session: data.session, mail, link: linkDeVerificacao(mail) }
}

async function principal() {
  if (sql(`select count(*) from public.organizational_units where slug in ('hml-clube-a','hml-clube-b');`) !== '2') {
    console.error('ABORTADO: faltam hml-clube-a/b. Rode antes: node supabase/tests/e2e/_seed_homologacao.mjs'); process.exit(2)
  }
  limparBanco(); await limparCaixa()
  const A = idClube('hml-clube-a'); const B = idClube('hml-clube-b')
  const dirA = await logarHml('diretoria_a'); dirA.usar(A)
  const dirB = await logarHml('diretoria_b'); dirB.usar(B)
  const CA = (await dirA.c.rpc('clube_codigo_gerar', { p_dias: null })).data?.codigo
  const CB = (await dirB.c.rpc('clube_codigo_gerar', { p_dias: null })).data?.codigo
  nota(`leitura de e-mail: ${await mailGet('/api/v1/messages?limit=1').then(() => 'Mailpit API (host 127.0.0.1:54324, com fallback docker exec)')}; Auth local: site_url=${siteLocal}; allow-list=${allowList}`)

  // =========================================================================================================
  console.log('\n== 1. link/QR do clube A (código) -> cadastro -> e-mail REAL -> confirmação em OUTRO navegador ==')
  const forja = { entrada_codigo: CA, papel: 'diretoria', role: 'diretoria', club_id: B, status: 'ativo' }
  const p1 = await cadastrar('codigo', forja)
  ok('signUp com entrada_codigo (+ metadado forjado papel/role/club_id/status): aceito, SEM sessão (confirmação ligada)', !!p1.id && p1.session == null)
  ok('o e-mail de confirmação CHEGOU na caixa (remetente do GoTrue, para o endereço do cadastro)', !!p1.mail && p1.mail.para === p1.email, 'nenhuma mensagem')
  ok('o e-mail traz um link /auth/v1/verify do GoTrue (type=signup)', !!p1.link && new URL(p1.link).searchParams.get('type') === 'signup', p1.link ? resumoDoLink(p1.link) : 'sem link')
  nota(`assunto: "${p1.mail?.assunto}"; link (sem token): ${p1.link ? resumoDoLink(p1.link) : '-'}`)
  const semConf = await novoCliente().auth.signInWithPassword({ email: p1.email, password: SENHA })
  ok('antes de abrir o link: login recusado e ZERO vínculos (cadastro não coloca ninguém em clube)', !!semConf.error && vinculos(p1.id, A).length === 0 && vinculos(p1.id, B).length === 0, semConf.error?.message)
  const ab1 = await abrirLinkEmOutroNavegador(p1.link)
  ok('link aberto por cliente HTTP novo e sem estado: o GoTrue responde com redirect e entrega tokens no fragmento', ab1.status >= 300 && ab1.status < 400 && ab1.temTokens && ab1.tipo === 'signup', `status=${ab1.status} destino=${ab1.destino} tipo=${ab1.tipo} erro=${ab1.erro}`)
  nota(`o redirect do e-mail cai em: ${ab1.destino} (artefato do ambiente local: o cadastro não passa emailRedirectTo, então vale o site_url local ${siteLocal}; em produção vale o Site URL do painel)`)
  const nav2 = await sessaoDoLink(ab1)
  ok('a sessão do link é a da conta recém-confirmada (e-mail confirmado), sem nenhum estado do cadastro original', !!nav2.user?.email_confirmed_at && nav2.user.email === p1.email)
  ok('...o ÚNICO rastro do clube é user_metadata.entrada_codigo (o código do app lê isso; sem ?proximo, sem sessionStorage)', codigoDoMetadado(nav2.user) === CA && slugDoMetadado(nav2.user) === null, JSON.stringify(Object.keys(nav2.user.user_metadata || {})))
  ok('...e nada de vínculo foi criado só por confirmar o e-mail', vinculos(p1.id, A).length === 0 && vinculos(p1.id, B).length === 0)
  ok('...e o perfil continua desbravador/membro/ativo (metadado forjado ignorado pelo gatilho)', sql(`select papel || '/' || tipo_cadastro || '/' || status from public.profiles where id='${p1.id}'`) === 'desbravador/membro/ativo')
  // o que o ClubeGuard faz ao ver a sessão: roda aplicarEntradaDoCadastro com o código da conta
  comoNavegador(nav2.c)
  const r1 = await aplicarEntradaDoCadastro(codigoDoMetadado(nav2.user), { tambemClube: false })
  ok('aplicarEntradaDoCadastro (serviço real do app): estado "pedido", situação pendente', r1.estado === 'pedido' && r1.situacao === 'pendente', JSON.stringify(r1))
  let vv = vinculos(p1.id, A)
  ok('banco: vínculo PENDENTE no clube do CÓDIGO (A), papel decidido pelo servidor (desbravador), origem codigo_de_entrada, NUNCA ativo; nada no B', vv.length === 1 && vv[0].status === 'pendente' && vv[0].role === 'desbravador' && vv[0].source === 'codigo_de_entrada' && vinculos(p1.id, B).length === 0, JSON.stringify(vv))
  const meta1 = (await nav2.c.auth.getUser()).data.user.user_metadata
  ok('o serviço limpou entrada_codigo da conta (updateUser null); o resto do metadado segue', !('entrada_codigo' in meta1) && meta1.nome === 'E2E Mail codigo', JSON.stringify(Object.keys(meta1)))
  const ctx = (await nav2.c.rpc('meu_contexto')).data
  ok('meu_contexto: o vínculo é pendente e NÃO selecionável (o app não dá acesso)', ctx?.vinculos?.[0]?.status === 'pendente' && ctx.vinculos[0].selecionavel === false, JSON.stringify(ctx?.vinculos?.[0]))
  const sA = clienteHml(); await sA.c.auth.setSession({ access_token: ab1.access, refresh_token: ab1.refresh }); sA.usar(A)
  ok('pendente com header x-clube-atual=A: o servidor NÃO dá clube em uso, não vê código nem fila', (await sA.c.rpc('clube_atual_id')).data == null && !!(await sA.c.rpc('clube_codigo_atual')).error && semAcesso(await sA.c.rpc('entradas_pendentes')))
  const repete = await aplicarEntradaDoCadastro(CA)
  ok('repetir o serviço (ex.: outra aba): "ja_era", continua 1 vínculo pendente', repete.estado === 'ja_era' && vinculos(p1.id, A).length === 1, JSON.stringify(repete))
  const tent = await novoCliente().auth.signInWithPassword({ email: p1.email, password: SENHA })
  ok('o link de confirmação reaberto (replay) não dá NOVA sessão por cima do que já foi usado', await (async () => { const o = await abrirLinkEmOutroNavegador(p1.link); return !o.temTokens })())
  void tent
  console.log('\n   -- diretoria do clube certo aprova; só então há acesso --')
  const fila = (await dirA.c.rpc('entradas_pendentes')).data || []
  const dirBfila = (await dirB.c.rpc('entradas_pendentes')).data || []
  ok('Aprovações da diretoria A mostra a pessoa (papel pedido desbravador, origem do código); a diretoria do B NÃO', fila.some((x) => x.id === p1.id && x.papel_pedido === 'desbravador' && x.origem === 'codigo_de_entrada') && !dirBfila.some((x) => x.id === p1.id))
  const apErrada = await dirB.c.rpc('vinculo_gerir', { p_user_id: p1.id, p_status: 'ativo' })
  ok('a diretoria do OUTRO clube (B) não consegue aprovar', !!apErrada.error && vinculos(p1.id, A)[0].status === 'pendente', apErrada.error?.message)
  const auto = await nav2.c.rpc('vinculo_gerir', { p_user_id: p1.id, p_status: 'ativo' })
  ok('auto-aprovação pela própria pessoa: recusada', !!auto.error && vinculos(p1.id, A)[0].status === 'pendente', auto.error?.message)
  const ap = await dirA.c.rpc('vinculo_gerir', { p_user_id: p1.id, p_status: 'ativo' })
  vv = vinculos(p1.id, A)
  ok('a diretoria do clube A aprova: vínculo ATIVO, papel continua desbravador', ap.data?.ok === true && vv[0].status === 'ativo' && vv[0].role === 'desbravador', JSON.stringify(vv))
  sA.usar(A)
  const ctx2 = (await sA.c.rpc('meu_contexto')).data
  ok('só agora: vínculo selecionável e o servidor age no clube A', ctx2?.vinculos?.[0]?.selecionavel === true && (await sA.c.rpc('clube_atual_id')).data === A, JSON.stringify(ctx2?.vinculos?.[0]))

  // =========================================================================================================
  console.log('\n== 2. clube escolhido na LISTA do cadastro (entrada_clube_slug) -> e-mail real -> outro navegador ==')
  const p2 = await cadastrar('slug', { entrada_clube_slug: 'hml-clube-a', papel: 'diretoria', role: 'diretoria', club_id: B, status: 'ativo' })
  ok('signUp com entrada_clube_slug (+ forjados): aceito sem sessão; e-mail de confirmação chegou com link verify', !!p2.id && p2.session == null && !!p2.link && new URL(p2.link).searchParams.get('type') === 'signup')
  const ab2 = await abrirLinkEmOutroNavegador(p2.link)
  ok('link aberto em cliente sem estado: tokens no fragmento', ab2.temTokens && ab2.tipo === 'signup', `status=${ab2.status} erro=${ab2.erro}`)
  const nav3 = await sessaoDoLink(ab2)
  ok('a sessão traz só o slug na conta (nenhum código); nenhum vínculo criado pela confirmação', slugDoMetadado(nav3.user) === 'hml-clube-a' && codigoDoMetadado(nav3.user) === null && vinculos(p2.id, A).length === 0 && vinculos(p2.id, B).length === 0)
  comoNavegador(nav3.c)
  const r2 = await aplicarClubeEscolhidoNoCadastro(slugDoMetadado(nav3.user))
  vv = vinculos(p2.id, A)
  ok('aplicarClubeEscolhidoNoCadastro (serviço real): pedido PENDENTE no clube escolhido, papel do servidor, origem cadastro_escolheu_clube; nada no B',
    r2.estado === 'pedido' && r2.situacao === 'pendente' && vv.length === 1 && vv[0].status === 'pendente' && vv[0].role === 'desbravador' && vv[0].source === 'cadastro_escolheu_clube' && vinculos(p2.id, B).length === 0, JSON.stringify({ r2, vv }))
  ok('...e o slug saiu da conta', !('entrada_clube_slug' in (await nav3.c.auth.getUser()).data.user.user_metadata))
  const ap2 = await dirA.c.rpc('vinculo_gerir', { p_user_id: p2.id, p_status: 'ativo' })
  ok('diretoria A aprova -> ativo (só então)', ap2.data?.ok === true && vinculos(p2.id, A)[0].status === 'ativo')

  // =========================================================================================================
  console.log('\n== 3. conta guarda código do B E slug do A: o código tem prioridade, nada vai para o A ==')
  const p3 = await cadastrar('ambos', { entrada_codigo: CB, entrada_clube_slug: 'hml-clube-a' })
  const ab3 = await abrirLinkEmOutroNavegador(p3.link)
  const nav4 = await sessaoDoLink(ab3)
  comoNavegador(nav4.c)
  const r3 = await aplicarEntradaDoCadastro(codigoDoMetadado(nav4.user), { tambemClube: !!slugDoMetadado(nav4.user) })
  const m3 = (await nav4.c.auth.getUser()).data.user.user_metadata
  ok('código do B vence: pendente no B, NADA no A, e os dois metadados saem da conta', r3.estado === 'pedido' && vinculos(p3.id, B)[0]?.status === 'pendente' && vinculos(p3.id, A).length === 0 && !('entrada_codigo' in m3) && !('entrada_clube_slug' in m3), JSON.stringify({ r3, A: vinculos(p3.id, A), B: vinculos(p3.id, B) }))

  // =========================================================================================================
  console.log('\n== 4. código que morreu ENTRE o cadastro e o clique no e-mail ==')
  const p4 = await cadastrar('morto', { entrada_codigo: CA })
  const novoCA = (await dirA.c.rpc('clube_codigo_gerar', { p_dias: null })).data?.codigo   // regera: CA morre
  const ab4 = await abrirLinkEmOutroNavegador(p4.link)
  const nav5 = await sessaoDoLink(ab4)
  comoNavegador(nav5.c)
  const r4 = await aplicarEntradaDoCadastro(codigoDoMetadado(nav5.user))
  ok('código revogado: estado "invalido", nenhum vínculo (o app mostra a mensagem e o "Entrar com código")', r4.estado === 'invalido' && vinculos(p4.id, A).length === 0, JSON.stringify(r4))
  ok('...e o metadado vencido sai da conta (não fica tentando para sempre)', !('entrada_codigo' in (await nav5.c.auth.getUser()).data.user.user_metadata))
  void novoCA

  // =========================================================================================================
  console.log('\n== 5. recuperação de senha: e-mail real, o que o link contém e a troca com o token ==')
  const emailR = `${PREFIXO}codigo@teste.local`   // conta do cenário 1 (confirmada, com vínculo)
  await dorme(1200)   // GOTRUE_SMTP_MAX_FREQUENCY=1s
  const tR = Date.now() - 1500
  const c5 = novoCliente()
  const prod = 'https://app.desbravaclube.com.br/nova-senha'
  const pedido = await c5.auth.resetPasswordForEmail(emailR, { redirectTo: prod })
  ok('pedido de recuperação com redirectTo de PRODUÇÃO é aceito pelo Auth local', !pedido.error, pedido.error?.message)
  const mR = await esperarEmail(emailR, { depoisDe: tR })
  const lR = linkDeVerificacao(mR)
  ok('o e-mail de recuperação chegou com link verify type=recovery', !!lR && new URL(lR).searchParams.get('type') === 'recovery', lR ? resumoDoLink(lR) : 'sem link')
  const redirR = lR ? new URL(lR).searchParams.get('redirect_to') : null
  nota(`redirectTo pedido = ${prod}; allow-list local = ${allowList}`)
  nota(`link do e-mail (sem token): ${lR ? resumoDoLink(lR) : '-'}`)
  ok('redirect de produção FORA da allow-list local: o GoTrue o troca pelo site_url local (comportamento esperado do stack; em produção o domínio está na allow-list do painel)', redirR === siteLocal || redirR === siteLocal + '/' || redirR?.startsWith(siteLocal), String(redirR))
  // com um redirect permitido localmente, o link carrega o redirectTo (prova de que o mecanismo respeita /nova-senha)
  await dorme(1200)
  const tR2 = Date.now() - 1500
  const permitido = 'http://127.0.0.1:4173/nova-senha'
  await novoCliente().auth.resetPasswordForEmail(emailR, { redirectTo: permitido })
  const mR2 = await esperarEmail(emailR, { depoisDe: tR2 })
  const lR2 = linkDeVerificacao(mR2)
  ok('com redirectTo permitido na allow-list local, o link do e-mail carrega /nova-senha', !!lR2 && new URL(lR2).searchParams.get('redirect_to') === permitido, lR2 ? resumoDoLink(lR2) : 'sem link')
  const abR = await abrirLinkEmOutroNavegador(lR2)
  ok('link de recuperação aberto em cliente sem estado: tokens no fragmento (type=recovery) e destino /nova-senha', abR.temTokens && abR.tipo === 'recovery' && abR.destino === permitido, `destino=${abR.destino} tipo=${abR.tipo} erro=${abR.erro}`)
  const navR = await sessaoDoLink(abR)
  const troca = await navR.c.auth.updateUser({ password: SENHA_NOVA })
  ok('com o token do e-mail a senha nova é aceita', !troca.error, troca.error?.message)
  await navR.c.auth.signOut()
  const lNova = await novoCliente().auth.signInWithPassword({ email: emailR, password: SENHA_NOVA })
  const lVelha = await novoCliente().auth.signInWithPassword({ email: emailR, password: SENHA })
  ok('login com a senha NOVA funciona e a ANTIGA é recusada', !!lNova.data?.session && !!lVelha.error)
  ok('o link de recuperação já usado não abre sessão de novo', !(await abrirLinkEmOutroNavegador(lR2)).temTokens)
  ok('a recuperação não mexeu no vínculo (continua ativo no A com o mesmo papel)', vinculos(p1.id, A)[0].status === 'ativo' && vinculos(p1.id, A)[0].role === 'desbravador')

  // =========================================================================================================
  console.log('\n== 6. varredura: nenhum e-mail/link com esquema de app nativo; hosts locais = artefato do ambiente ==')
  const proibidos = /(capacitor:|ionic:|file:)/i
  const locais = /(localhost|127\.0\.0\.1)/i
  const nativo = vistos.filter((m) => proibidos.test(m.texto) || proibidos.test(m.html) || m.links.some((l) => proibidos.test(l)))
  ok(`nenhum dos ${vistos.length} e-mails lidos contém capacitor:/ionic:/file:`, nativo.length === 0, nativo.map((m) => m.assunto).join(','))
  const hostsLocais = new Set()
  for (const m of vistos) for (const l of m.links) if (locais.test(l)) { const u = new URL(l); hostsLocais.add(u.origin); const rt = u.searchParams.get('redirect_to'); if (rt && locais.test(rt)) hostsLocais.add(new URL(rt).origin) }
  const inesperados = [...hostsLocais].filter((h) => ![API_URL, siteLocal, 'http://127.0.0.1:4173'].some((p) => h === p || h === new URL(p).origin))
  ok('toda ocorrência de localhost/127.0.0.1 é só a API local (verify) ou o site_url/allow-list locais', inesperados.length === 0, inesperados.join(','))
  nota(`ARTEFATO DO AMBIENTE LOCAL (não existe em produção): ${[...hostsLocais].join(', ')}`)
  const remetentes = [...new Set(vistos.map((m) => m.de))]
  nota(`remetente local: ${remetentes.join(', ')} (SMTP local; em produção sai do SMTP configurado no painel)`)
}

let erroFatal = null
try { await principal() } catch (e) { erroFatal = e; console.log('\nERRO FATAL:', e.stack || e.message) } finally {
  try { limparBanco(); await limparCaixa(); console.log('\n(limpo: contas e2e-mail-*, vínculos, códigos dos clubes hml-*, mensagens do Mailpit desses endereços)') } catch (e) { console.log('FALHA NA LIMPEZA:', e.message) }
}
console.log(`\n${total - reprovados}/${total} asserts ok${reprovados ? `  —  ${reprovados} REPROVADOS` : ''}`)
if (falhas.length) { console.log('\nFalhas:'); for (const f of falhas) console.log(' - ' + f) }
process.exit(erroFatal || reprovados ? 1 : 0)
