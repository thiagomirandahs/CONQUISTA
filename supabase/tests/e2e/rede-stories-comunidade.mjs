// E2E dos STORIES PARA TODOS NA COMUNIDADE (migration 535) — LOCAL, nunca produção. Irmão de rede-foto-avatar.mjs:
// supabase-js de verdade, PostgREST de verdade e Storage de verdade (bucket PRIVADO 'comunidade'). Prova que:
//   * o autor sobe a foto do story pelo caminho de sempre (<clube>/<eu>/<uuid>.webp), pede o saneamento (529) e publica
//     com p_alcance 'comunidade' (nasce publicado, sem aprovação); a chamada ANTIGA (sem p_alcance) continua criando 'clube';
//   * membro de OUTRO clube elegível: rede_stories() (chamada antiga) NÃO traz nada do clube A; rede_stories('comunidade')
//     traz o story de alcance comunidade (menor com nome reduzido, sem unidade), ASSINA o arquivo e a URL abre (200 + image/*);
//     o arquivo do story de alcance CLUBE é negado;
//   * clube SEM o recurso e anon: nada (RPC e Storage);
//   * expirado e apagado: somem da faixa, o arquivo deixa de ser assinável e entram na fila de apagar (limpar-fotos-rede).
//
//   node supabase/tests/e2e/rede-stories-comunidade.mjs   (Supabase local no ar e banco local na 535; usa só 127.0.0.1)
//
// Cria clubes/usuários com prefixo "e2e-rede-" no banco LOCAL e apaga tudo (banco e Storage) no fim, mesmo se falhar.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-rede-123'
// WebP 1x1 válido (o bucket 'comunidade' só aceita image/jpeg|image/webp até 300 KB)
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')

function statusLocal() {
  const out = execFileSync('npx', ['--yes', 'supabase@2.117.0', 'status', '-o', 'env'], { encoding: 'utf8', shell: process.platform === 'win32' })
  const env = {}
  for (const l of out.split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/); if (m) env[m[1]] = m[2] }
  return env
}
const env = statusLocal()
const URL_API = env.API_URL
if (!URL_API || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API)) {
  console.error('ABORTADO: API_URL não é o Supabase LOCAL (' + URL_API + '). Este teste nunca roda contra outro ambiente.')
  process.exit(2)
}
const ANON = env.ANON_KEY
const SERVICE = env.SERVICE_ROLE_KEY

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
const uid = (k) => sql(`select md5('e2e-rede:${k}')::uuid;`)

const ledger = sql(`select max(version) from supabase_migrations.schema_migrations;`)
if (ledger < '20260930000535') {
  console.error(`ABORTADO: o banco local está na ${ledger}; este E2E precisa da 535 (stories na Comunidade).`)
  process.exit(2)
}

// clube A e B com a Rede LIGADA; clube C SEM o recurso. a1: criança do A (responsável pais_a); v1: adulto do A;
// lider_a: diretoria do A; b1: criança do B; lider_b: diretoria do B; c1: do clube C.
const CHAVES = ['a1', 'v1', 'lider_a', 'pais_a', 'b1', 'lider_b', 'c1']
function preparar() {
  limparBanco()
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values
      ('clube', 'E2E Rede Clube A', 'e2e-rede-clube-a', 'BR', 'America/Recife', '{"test_only":true}'),
      ('clube', 'E2E Rede Clube B', 'e2e-rede-clube-b', 'BR', 'America/Recife', '{"test_only":true}'),
      ('clube', 'E2E Rede Clube C', 'e2e-rede-clube-c', 'BR', 'America/Recife', '{"test_only":true}');
    insert into public.club_features (club_id, feature, enabled)
    select id, 'comunidade', true from public.organizational_units where slug in ('e2e-rede-clube-a', 'e2e-rede-clube-b');
    create temp table e2e_p (k text, papel text, clube text);
    insert into e2e_p values ('a1','desbravador','e2e-rede-clube-a'), ('v1','conselheiro','e2e-rede-clube-a'),
      ('lider_a','diretoria','e2e-rede-clube-a'), ('pais_a','pais','e2e-rede-clube-a'),
      ('b1','desbravador','e2e-rede-clube-b'), ('lider_b','diretoria','e2e-rede-clube-b'), ('c1','desbravador','e2e-rede-clube-c');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('e2e-rede:' || k)::uuid, 'authenticated', 'authenticated', 'e2e-rede-' || k || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false from e2e_p;
    insert into public.profiles (id, nome, papel, status, created_at)
    select md5('e2e-rede:' || p.k)::uuid, case p.k when 'a1' then 'Ana de Souza Lima' else 'E2E Rede ' || p.k end, p.papel, 'ativo', now() - interval '60 days'
      from e2e_p p;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select md5('e2e-rede:' || p.k)::uuid, (select id from public.organizational_units where slug = p.clube), p.papel, 'ativo' from e2e_p p;
    insert into public.unidades (nome, cor, club_id)
    select 'E2E Unidade Águias', '#111111', id from public.organizational_units where slug = 'e2e-rede-clube-a';
    update public.organization_memberships set unidade_id = (select id from public.unidades where nome = 'E2E Unidade Águias')
     where user_id = md5('e2e-rede:a1')::uuid;
    insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
    select md5('e2e-rede:pais_a')::uuid, md5('e2e-rede:a1')::uuid, 'Ana', 'aprovado', id from public.organizational_units where slug = 'e2e-rede-clube-a';
  `)
}
function limparBanco() {
  sql(`
    set session_replication_role = replica;
    create temp table e2e_u as select id from public.organizational_units where slug like 'e2e-rede-%';
    create temp table e2e_us as select id from auth.users where email like 'e2e-rede-%@teste.local';
    delete from public.rede_fotos_para_apagar where club_id in (select id from e2e_u);
    delete from public.imagem_saneamento where club_id in (select id from e2e_u) or dono_id in (select id from e2e_us);
    delete from public.comunidade_denuncias where club_id in (select id from e2e_u);
    delete from public.comunidade_moderacao_log where club_id in (select id from e2e_u);
    delete from public.comunidade_bloqueios where club_id in (select id from e2e_u);
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

let total = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) { falhas.push(`${nome}  [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`)
}

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }
async function entrar(k, clube) {
  const c = createClient(URL_API, ANON, { ...semSessao, global: { headers: clube ? { 'x-clube-atual': clube } : {} } })
  const { error } = await c.auth.signInWithPassword({ email: `e2e-rede-${k}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return c
}
const rpc = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); return { data, erro: error?.message || null } }
const upar = (c, caminho) => c.storage.from('comunidade').upload(caminho, WEBP, { contentType: 'image/webp', upsert: false })
const assina = async (c, caminho) => { const { data, error } = await c.storage.from('comunidade').createSignedUrl(caminho, 600); return { url: data?.signedUrl || null, erro: error?.message || null } }
async function abre(url) { const r = await fetch(url); return { status: r.status, tipo: r.headers.get('content-type') || '' } }
const naFaixa = (r, storyId) => (r.data || []).some((g) => (g.stories || []).some((s) => s.id === storyId))
const grupoDe = (r, autorId) => (r.data || []).find((g) => g.autor?.id === autorId)

const criados = []
async function principal() {
  preparar()
  const id = Object.fromEntries(CHAVES.map((k) => [k, uid(k)]))
  const clubeA = sql(`select id from public.organizational_units where slug = 'e2e-rede-clube-a';`)
  const clubeB = sql(`select id from public.organizational_units where slug = 'e2e-rede-clube-b';`)
  const clubeC = sql(`select id from public.organizational_units where slug = 'e2e-rede-clube-c';`)
  const c = {
    a1: await entrar('a1', clubeA), v1: await entrar('v1', clubeA), lider_a: await entrar('lider_a', clubeA), pais_a: await entrar('pais_a', clubeA),
    b1: await entrar('b1', clubeB), lider_b: await entrar('lider_b', clubeB), c1: await entrar('c1', clubeC),
  }
  const anon = createClient(URL_API, ANON, semSessao)
  const P = { com: `${clubeA}/${id.a1}/${randomUUID()}.webp`, clube: `${clubeA}/${id.a1}/${randomUUID()}.webp`, com2: `${clubeA}/${id.a1}/${randomUUID()}.webp`, forjado: `${clubeA}/${id.v1}/${randomUUID()}.webp` }

  console.log('\n== 1. Autor (criança do A, autorizada) sobe e publica: comunidade (novo) e clube (chamada antiga) ==')
  for (const k of ['com', 'clube', 'com2']) {
    const { error } = await upar(c.a1, P[k])
    ok(`a1 sobe a foto do story (${k}) no caminho <clube>/<eu>/<uuid>.webp`, !error, error?.message)
    if (!error) criados.push(P[k])
  }
  const san = await rpc(c.a1, 'imagem_saneamento_enfileirar', { p_bucket: 'comunidade', p_caminho: P.com })
  ok('a foto do story da Comunidade entra na fila de saneamento (529), como o app pede', !san.erro, san.erro)
  ok('...na fila, com o clube do caminho', sql(`select count(*) from public.imagem_saneamento where bucket = 'comunidade' and caminho = '${P.com}' and club_id = '${clubeA}';`) === '1')
  const pubCom = await rpc(c.a1, 'rede_story_publicar', { p_foto_path: P.com, p_texto: 'Para todos os clubes (e2e)', p_alcance: 'comunidade' })
  ok('publica com p_alcance comunidade: nasce PUBLICADO (sem aprovação), alcance comunidade', pubCom.data?.ok === true && pubCom.data?.status === 'publicado' && pubCom.data?.alcance === 'comunidade', JSON.stringify(pubCom))
  const pubClube = await rpc(c.a1, 'rede_story_publicar', { p_foto_path: P.clube, p_texto: 'Só do clube (e2e)' })
  ok('chamada ANTIGA (sem p_alcance) continua: publicado, alcance clube', pubClube.data?.ok === true && pubClube.data?.status === 'publicado' && pubClube.data?.alcance === 'clube', JSON.stringify(pubClube))
  const stCom = pubCom.data?.id; const stClube = pubClube.data?.id
  const pubInv = await rpc(c.a1, 'rede_story_publicar', { p_foto_path: P.com2, p_texto: null, p_alcance: 'amigos' })
  ok('alcance inventado é recusado pelo servidor', !!pubInv.erro && /Alcance inválido/.test(pubInv.erro), pubInv.erro)

  console.log('\n== 2. Outro clube elegível (b1, criança do B) ==')
  let r = await rpc(c.b1, 'rede_stories')
  ok('rede_stories() (chamada antiga) NÃO traz nada do clube A', !r.erro && !naFaixa(r, stCom) && !naFaixa(r, stClube), r.erro || JSON.stringify(r.data))
  r = await rpc(c.b1, 'rede_stories', { p_alcance: 'comunidade' })
  ok("rede_stories('comunidade') traz o story de alcance comunidade e NÃO o de alcance clube", !r.erro && naFaixa(r, stCom) && !naFaixa(r, stClube), r.erro || JSON.stringify(r.data))
  const g = grupoDe(r, id.a1)
  ok('menor de outro clube: nome reduzido (1º nome + inicial), sem unidade, com o clube', g?.autor?.nome === 'Ana S.' && (g?.autor?.unidade ?? null) === null && g?.autor?.clube === 'E2E Rede Clube A', JSON.stringify(g?.autor))
  ok('cada story diz o alcance', g?.stories?.every((s) => s.alcance === 'comunidade'), JSON.stringify(g?.stories))
  let s = await assina(c.b1, P.com)
  ok('b1 ASSINA o arquivo do story da Comunidade (bucket privado, policy do servidor)', !!s.url, s.erro)
  const urlAntes = s.url
  if (s.url) { const a = await abre(s.url); ok('...e a URL assinada abre (200 + image/*)', a.status === 200 && /^image\//.test(a.tipo), `${a.status} ${a.tipo}`) }
  s = await assina(c.b1, P.clube)
  ok('b1 NÃO assina o arquivo do story de alcance CLUBE', !s.url, s.erro || 'assinou!')
  const vis = await rpc(c.b1, 'rede_story_visto', { p_story: stCom })
  ok('b1 marca visto no story da Comunidade', vis.data?.ok === true, vis.erro)
  const visClube = await rpc(c.b1, 'rede_story_visto', { p_story: stClube })
  ok('...mas não no de alcance clube (mesma resposta de UUID forjado)', !!visClube.erro && /não está disponível/.test(visClube.erro), visClube.erro)
  const apagarAlheio = await rpc(c.b1, 'rede_story_apagar', { p_story: stCom })
  ok('b1 não apaga story alheio', !!apagarAlheio.erro, apagarAlheio.erro)
  const modB = await rpc(c.lider_b, 'comunidade_moderar', { p_tipo: 'story', p_id: stCom, p_acao: 'remover' })
  ok('diretoria de OUTRO clube não modera', !!modB.erro && /não encontrado/i.test(modB.erro), modB.erro)
  const vA = await rpc(c.v1, 'rede_stories')
  ok('mesmo clube (v1): a chamada antiga traz os dois stories (inclusive o de alcance comunidade)', naFaixa(vA, stCom) && naFaixa(vA, stClube), JSON.stringify(vA))
  ok('...com o nome público normal da criança (1º nome + sobrenome) e a unidade', grupoDe(vA, id.a1)?.autor?.nome === 'Ana Souza' && grupoDe(vA, id.a1)?.autor?.unidade === 'E2E Unidade Águias', JSON.stringify(grupoDe(vA, id.a1)?.autor))

  console.log('\n== 3. Não elegíveis ==')
  r = await rpc(c.c1, 'rede_stories', { p_alcance: 'comunidade' })
  ok('clube SEM o recurso: RPC bloqueada', !!r.erro && /liberad/i.test(r.erro), r.erro)
  s = await assina(c.c1, P.com)
  ok('...e não assina o arquivo', !s.url, s.erro || 'assinou!')
  const pc = await rpc(c.c1, 'rede_story_publicar', { p_foto_path: `${clubeC}/${id.c1}/${randomUUID()}.webp`, p_alcance: 'comunidade' })
  ok('...nem publica', !!pc.erro, pc.erro)
  r = await rpc(anon, 'rede_stories', { p_alcance: 'comunidade' })
  ok('anon NÃO executa rede_stories', !!r.erro, r.erro)
  const { data: anonAssina } = await anon.storage.from('comunidade').createSignedUrl(P.com, 600)
  ok('anon NÃO assina nada', !anonAssina?.signedUrl)
  const { error: anonUp } = await anon.storage.from('comunidade').upload(`${clubeA}/${id.a1}/${randomUUID()}.webp`, WEBP, { contentType: 'image/webp' })
  ok('anon NÃO sobe arquivo', !!anonUp)
  const { error: forj } = await upar(c.b1, P.forjado)
  ok('b1 não sobe arquivo no caminho de outra pessoa/clube', !!forj)

  console.log('\n== 4. Expirou (24 h): some e o arquivo deixa de ser assinável ==')
  sql(`update public.rede_stories set expira_em = now() - interval '1 minute', publicado_em = now() - interval '24 hours 1 minute' where id = '${stCom}';`)
  r = await rpc(c.b1, 'rede_stories', { p_alcance: 'comunidade' })
  ok('expirado: fora da faixa da Comunidade', !r.erro && !naFaixa(r, stCom), r.erro)
  s = await assina(c.b1, P.com)
  ok('expirado: b1 NÃO assina mais', !s.url, s.erro || 'assinou!')
  const rAntes = urlAntes ? await abre(urlAntes) : { status: 0 }
  console.log(`   info   a URL assinada ANTES de expirar ${rAntes.status === 200 ? 'ainda abre' : 'não abre mais'} (status ${rAntes.status}) — validade da assinatura (600 s) no aparelho`)
  ok('a rotina diária marca o expirado para a limpeza (motivo story)', sql(`select public.rede_marcar_fotos_para_apagar() >= 1;`) === 't'
    && sql(`select motivo from public.rede_fotos_para_apagar where story_id = '${stCom}';`) === 'story')

  console.log('\n== 5. Apagar o próprio: some e entra na fila na hora ==')
  sql(`update public.rede_stories set created_at = created_at - interval '5 minutes' where autor_id = '${id.a1}';`)
  const pub2 = await rpc(c.a1, 'rede_story_publicar', { p_foto_path: P.com2, p_texto: null, p_alcance: 'comunidade' })
  ok('a1 publica outro story na Comunidade', pub2.data?.status === 'publicado', JSON.stringify(pub2))
  const st2 = pub2.data?.id
  r = await rpc(c.b1, 'rede_stories', { p_alcance: 'comunidade' })
  s = await assina(c.b1, P.com2)
  ok('b1 vê e assina o novo', naFaixa(r, st2) && !!s.url, s.erro)
  const ap = await rpc(c.a1, 'rede_story_apagar', { p_story: st2 })
  ok('a1 apaga o próprio', ap.data?.ok === true, ap.erro)
  r = await rpc(c.b1, 'rede_stories', { p_alcance: 'comunidade' })
  s = await assina(c.b1, P.com2)
  ok('apagado: fora da faixa e sem URL assinada', !naFaixa(r, st2) && !s.url, s.erro || 'assinou!')
  ok('apagado: na fila de apagar na hora (limpar-fotos-rede)', sql(`select motivo from public.rede_fotos_para_apagar where story_id = '${st2}';`) === 'story')
  const pend = createClient(URL_API, SERVICE, semSessao)
  const { data: fila, error: filaErro } = await pend.rpc('rede_fotos_pendentes', { p_limite: 50 })
  ok('a Edge Function (service_role) recebe os dois arquivos na fila', !filaErro && [P.com, P.com2].every((p) => (fila || []).some((f) => f.caminho === p)), filaErro?.message || JSON.stringify(fila))
}

let saiu = 0
try {
  await principal()
} catch (e) {
  console.error('\nERRO no e2e:', e.message)
  falhas.push('erro de execução: ' + e.message)
} finally {
  try {
    const servico = createClient(URL_API, SERVICE, semSessao)
    if (criados.length) await servico.storage.from('comunidade').remove(criados)
  } catch (e) { console.error('limpeza do Storage:', e.message) }
  try { limparBanco() } catch (e) { console.error('limpeza do banco:', e.message) }
  console.log(`\n${total - falhas.length}/${total} ok` + (falhas.length ? `, ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}` : ' — TUDO OK'))
  saiu = falhas.length ? 1 : 0
}
process.exit(saiu)
