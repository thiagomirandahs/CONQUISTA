// E2E da FOTO e do AVATAR na REDE DBV (LOCAL, nunca produção): prova com o supabase-js de verdade, o PostgREST
// de verdade e o Storage de verdade (o que os testes SQL 106/110 só provam pelas policies) que:
//   * Rede ligada + autorização de imagem ARQUIVADA pela diretoria -> membro de OUTRO clube recebe a URL da foto
//     em rede_perfil/rede_feed, ASSINA o arquivo do bucket privado 'imagens' e a URL assinada abre (200 + image/*);
//   * sem autorização -> foto null no JSON, sem URL assinada (negado) e a URL pública não abre;
//   * o responsável DESLIGA -> bloqueado de novo na hora (JSON e Storage);
//   * quem escolheu o PERSONAGEM aparece com o desenho para outro clube (avatar_tipo/avatar), com foto null mesmo
//     depois de a diretoria arquivar (migration 500);
//   * caminho FORJADO perfis/<uuid>-<outro>.png (arquivo real, mas não é o de profiles.foto) -> negado;
//   * membro de clube SEM o recurso 'comunidade' -> sem rede, sem perfil, sem assinar nada;
//   * imagem_autorizada só vem no próprio perfil; anon sem nada.
//
//   npm run test:rede:e2e        (precisa do Supabase local no ar: `supabase start`; usa só 127.0.0.1)
//
// Cria clubes/usuários de teste com prefixo "e2e-rede-" no banco LOCAL e apaga tudo no fim (mesmo se falhar).
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-rede-123'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PERSONAGEM = { pele: '#f1c27d', cabelo: 'curto', corCabelo: '#2b1d0e', roupa: 'lisa', corRoupa: '#1e3a8a', acessorio: 'nenhum', corAcessorio: '#1e3a8a' }

// ---------- ambiente local ----------
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

// ---------- preparo ----------
// clube A e B com a Rede LIGADA; clube C SEM o recurso.
//   a1: desbravador do A, usa FOTO;  a2: desbravador do A, escolheu o PERSONAGEM (e tem foto antiga gravada)
//   lider_a: diretoria do A;  pais_a: responsável de a1;  b1: desbravador do B;  c1: desbravador do C
const CHAVES = ['a1', 'a2', 'lider_a', 'pais_a', 'b1', 'c1', 'v1']
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
    insert into e2e_p values ('a1','desbravador','e2e-rede-clube-a'), ('a2','desbravador','e2e-rede-clube-a'),
      ('lider_a','diretoria','e2e-rede-clube-a'), ('pais_a','pais','e2e-rede-clube-a'),
      ('b1','desbravador','e2e-rede-clube-b'), ('c1','desbravador','e2e-rede-clube-c'), ('v1','desbravador','e2e-rede-clube-a');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('e2e-rede:' || k)::uuid, 'authenticated', 'authenticated', 'e2e-rede-' || k || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false from e2e_p;
    insert into public.profiles (id, nome, papel, status, foto, avatar_tipo, avatar, created_at)
    select md5('e2e-rede:' || p.k)::uuid,
           case p.k when 'a1' then 'Ana de Souza Lima' when 'a2' then 'Caio Pereira Dias' else 'E2E Rede ' || p.k end,
           p.papel, 'ativo',
           case when p.k in ('a1', 'a2') then '${URL_API}/storage/v1/object/public/imagens/perfis/' || md5('e2e-rede:' || p.k)::uuid || '-1.png' end,
           case when p.k = 'a2' then 'personagem' else 'foto' end,
           case when p.k = 'a2' then '${JSON.stringify(PERSONAGEM)}'::jsonb end,
           now() - interval '60 days'
      from e2e_p p;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select md5('e2e-rede:' || p.k)::uuid, (select id from public.organizational_units where slug = p.clube), p.papel, 'ativo' from e2e_p p;
    -- 502: a2 tem UNIDADE no clube A ("Águias"); a1 não tem unidade
    insert into public.unidades (nome, cor, club_id)
    select 'E2E Unidade Águias', '#111111', id from public.organizational_units where slug = 'e2e-rede-clube-a';
    update public.organization_memberships set unidade_id = (select id from public.unidades where nome = 'E2E Unidade Águias')
     where user_id = md5('e2e-rede:a2')::uuid;
    insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id)
    select md5('e2e-rede:pais_a')::uuid, md5('e2e-rede:a1')::uuid, 'Ana', 'aprovado', id from public.organizational_units where slug = 'e2e-rede-clube-a';
  `)
}
function limparBanco() {
  sql(`
    set session_replication_role = replica;
    create temp table e2e_u as select id from public.organizational_units where slug like 'e2e-rede-%';
    create temp table e2e_us as select id from auth.users where email like 'e2e-rede-%@teste.local';
    delete from public.comunidade_curtidas where usuario_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.comunidade_comentarios where autor_id in (select id from e2e_us) or club_id in (select id from e2e_u);
    delete from public.comunidade_denuncias where club_id in (select id from e2e_u);
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

// ---------- asserts ----------
let total = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) { falhas.push(`${nome}  [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`)
}

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }
// como o app: cada aba manda x-clube-atual em TODAS as chamadas (RPC e Storage)
async function entrar(k, clube) {
  const c = createClient(URL_API, ANON, { ...semSessao, global: { headers: clube ? { 'x-clube-atual': clube } : {} } })
  const { error } = await c.auth.signInWithPassword({ email: `e2e-rede-${k}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return c
}
const rpc = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); return { data, erro: error?.message || null } }
const upar = (c, caminho) => c.storage.from('imagens').upload(caminho, PNG, { contentType: 'image/png', upsert: true })
const assina = async (c, caminho) => { const { data, error } = await c.storage.from('imagens').createSignedUrl(caminho, 600); return { url: data?.signedUrl || null, erro: error?.message || null } }
async function abre(url) { const r = await fetch(url); return { status: r.status, tipo: r.headers.get('content-type') || '' } }

const criados = []
async function principal() {
  preparar()
  const id = Object.fromEntries(CHAVES.map((k) => [k, uid(k)]))
  const clubeA = sql(`select id from public.organizational_units where slug = 'e2e-rede-clube-a';`)
  const clubeB = sql(`select id from public.organizational_units where slug = 'e2e-rede-clube-b';`)
  const clubeC = sql(`select id from public.organizational_units where slug = 'e2e-rede-clube-c';`)
  const c = {
    a1: await entrar('a1', clubeA), a2: await entrar('a2', clubeA), lider_a: await entrar('lider_a', clubeA), pais_a: await entrar('pais_a', clubeA),
    b1: await entrar('b1', clubeB), c1: await entrar('c1', clubeC), v1: await entrar('v1', clubeA),
  }
  const anon = createClient(URL_API, ANON, semSessao)
  const P = { a1: `perfis/${id.a1}-1.png`, a2: `perfis/${id.a2}-1.png`, forjado: `perfis/${id.a1}-7.png`, forjadoA2: `perfis/${id.a2}-x.png` }
  const publica = (p) => `${URL_API}/storage/v1/object/public/imagens/${p}`

  console.log('\n== preparo: arquivos reais no bucket privado (o dono sobe o próprio avatar, como o app) ==')
  for (const [quem, p] of [['a1', P.a1], ['a2', P.a2], ['a1', P.forjado], ['a2', P.forjadoA2]]) {
    const { error } = await upar(c[quem], p)
    ok(`${quem} sobe ${p.replace(/perfis\/[0-9a-f-]{36}/, 'perfis/<uid>')}`, !error, error?.message)
    if (!error) criados.push(p)
  }
  const stB = await rpc(c.b1, 'comunidade_meu_status')
  ok('membro do colega do mesmo clube entra na Rede (recurso ligado)', stB.data?.pode_ver === true && stB.data?.unidade_id === clubeB, JSON.stringify(stB))
  const stC = await rpc(c.c1, 'comunidade_meu_status')
  ok('membro do clube C (sem o recurso) NÃO entra: motivo recurso_desligado', stC.data?.pode_ver === false && stC.data?.motivo === 'recurso_desligado', JSON.stringify(stC))

  console.log('\n== 1. SEM autorização de imagem: membro de outro clube não recebe a foto nem assina o arquivo ==')
  // 515: criança de OUTRO clube não tem perfil nem busca (proteção de menores)
  const pa1Fora = await rpc(c.b1, 'rede_perfil', { p_usuario: id.a1 })
  ok('515: rede_perfil(a1) NÃO abre para o outro clube (b1)', !pa1Fora.data && /não está disponível/i.test(pa1Fora.erro || ''), JSON.stringify(pa1Fora))
  const buscaFora = await rpc(c.b1, 'rede_buscar', { p_termo: 'ana', p_clube: null })
  ok('515: a busca do outro clube não traz criança do clube A', !JSON.stringify(buscaFora.data || '').includes(id.a1), JSON.stringify(buscaFora.data).slice(0, 120))
  let pa1 = await rpc(c.v1, 'rede_perfil', { p_usuario: id.a1 })
  ok('rede_perfil(a1) abre para o colega do mesmo clube (nome + sobrenome)', pa1.data?.nome === 'Ana Souza', JSON.stringify(pa1))
  ok('...foto = null', pa1.data?.foto === null, JSON.stringify(pa1.data?.foto))
  ok('...imagem_autorizada NÃO vem para outra pessoa', pa1.data?.imagem_autorizada == null, JSON.stringify(pa1.data?.imagem_autorizada))
  let s = await assina(c.b1, P.a1)
  ok('colega do mesmo clube NÃO assina o arquivo da foto (negado)', !s.url, s.erro || 'assinou!')
  const pub = await abre(publica(P.a1))
  ok(`URL pública do bucket privado NÃO abre (status ${pub.status})`, pub.status >= 400 && !pub.tipo.startsWith('image/'), `${pub.status} ${pub.tipo}`)
  const meu = await rpc(c.a1, 'rede_perfil')
  ok('a1 no PRÓPRIO perfil: imagem_autorizada = false e foto null (o que os outros veem)', meu.data?.eu === true && meu.data?.imagem_autorizada === false && meu.data?.foto === null, JSON.stringify(meu.data))

  console.log('\n== 2. PERSONAGEM aparece entre clubes (desenho), foto null ==')
  let pa2 = await rpc(c.v1, 'rede_perfil', { p_usuario: id.a2 })
  ok('rede_perfil(a2): avatar_tipo = personagem', pa2.data?.avatar_tipo === 'personagem', JSON.stringify(pa2))
  ok('...com as peças do desenho', pa2.data?.avatar?.cabelo === 'curto' && pa2.data?.avatar?.roupa === 'lisa', JSON.stringify(pa2.data?.avatar))
  ok('...e foto null (tem foto antiga gravada, mas escolheu o personagem)', pa2.data?.foto === null, JSON.stringify(pa2.data?.foto))
  ok('...imagem_autorizada oculta', pa2.data?.imagem_autorizada == null)
  s = await assina(c.b1, P.a2)
  ok('a foto antiga de quem usa personagem NÃO é assinável por outro clube (sem autorização)', !s.url, s.erro || 'assinou!')
  const pub2 = await rpc(c.a2, 'rede_publicar', { p_tipo: 'livre', p_legenda: 'Olá da rede! (e2e)' })
  ok('a2 publica na rede', pub2.data?.status === 'publicado', JSON.stringify(pub2))
  const feed = await rpc(c.v1, 'rede_feed', { p_filtro: 'meu_clube' })
  const itemA2 = (feed.data?.itens || []).find((i) => i.autor?.id === id.a2)
  ok('feed do colega do mesmo clube: o post de a2 vem com o personagem e sem foto', !!itemA2 && itemA2.autor.avatar_tipo === 'personagem' && !!itemA2.autor.avatar && itemA2.autor.foto === null, JSON.stringify(itemA2?.autor))
  const busca = await rpc(c.v1, 'rede_buscar', { p_termo: 'caio', p_clube: null })
  const pessoaA2 = (busca.data?.pessoas || []).find((p) => p.id === id.a2)
  ok('busca do colega do mesmo clube: a2 com personagem', pessoaA2?.avatar_tipo === 'personagem' && pessoaA2?.foto === null, JSON.stringify(pessoaA2))

  console.log('\n== 2b. UNIDADE do autor (502): nome da unidade visível entre clubes; null para quem não tem ==')
  ok('feed do colega do mesmo clube: o post de a2 traz unidade = "E2E Unidade Águias"', itemA2?.autor?.unidade === 'E2E Unidade Águias', JSON.stringify(itemA2?.autor?.unidade))
  ok('...e o clube junto (o app monta "Clube · Unidade · há X")', itemA2?.autor?.clube === 'E2E Rede Clube A', JSON.stringify(itemA2?.autor?.clube))
  ok('rede_perfil(a2) para o colega do mesmo clube: unidade vem', pa2.data?.unidade === 'E2E Unidade Águias', JSON.stringify(pa2.data?.unidade))
  ok('rede_perfil(a1) para o colega do mesmo clube: a1 não tem unidade → null', 'unidade' in (pa1.data || {}) && pa1.data.unidade === null, JSON.stringify(pa1.data?.unidade))
  const meuA2 = await rpc(c.a2, 'rede_perfil')
  ok('a2 no próprio perfil: unidade vem', meuA2.data?.unidade === 'E2E Unidade Águias', JSON.stringify(meuA2.data?.unidade))
  ok('só o NOME da unidade sai no autor (sem id/cor): chaves = 500 + unidade',
    Object.keys(itemA2?.autor || {}).sort().join(',') === 'avatar,avatar_tipo,clube,coordenacao,foto,id,nome,unidade', Object.keys(itemA2?.autor || {}).sort().join(','))

  console.log('\n== 3. Diretoria ARQUIVA a autorização: foto de quem usa foto aparece para outro clube; personagem continua ==')
  const m1 = await rpc(c.lider_a, 'rede_marcar_autorizacao_imagem', { p_usuario: id.a1, p_arquivada: true })
  ok('diretoria A arquiva a1', m1.data?.ok === true && m1.data?.arquivada === true, JSON.stringify(m1))
  const m2 = await rpc(c.lider_a, 'rede_marcar_autorizacao_imagem', { p_usuario: id.a2, p_arquivada: true })
  ok('diretoria A arquiva a2', m2.data?.ok === true, JSON.stringify(m2))
  const mb = await rpc(c.b1, 'rede_marcar_autorizacao_imagem', { p_usuario: id.a1, p_arquivada: true })
  ok('membro comum de outro clube NÃO marca', !!mb.erro, mb.erro)
  pa1 = await rpc(c.v1, 'rede_perfil', { p_usuario: id.a1 })
  ok('rede_perfil(a1) para o colega do mesmo clube: foto vem (URL do bucket)', typeof pa1.data?.foto === 'string' && pa1.data.foto.endsWith('/' + P.a1), JSON.stringify(pa1.data?.foto))
  ok('...imagem_autorizada continua oculta para outra pessoa', pa1.data?.imagem_autorizada == null)
  s = await assina(c.v1, P.a1)
  ok('colega do mesmo clube ASSINA o arquivo da foto', !!s.url, s.erro)
  const r1 = s.url ? await abre(s.url) : {}
  ok('...e a URL assinada ABRE (200, image/*)', r1.status === 200 && r1.tipo.startsWith('image/'), `${r1.status} ${r1.tipo}`)
  const urlAssinadaAntes = s.url
  const lote = await c.v1.storage.from('imagens').createSignedUrls([P.a1], 600)
  ok('lote (createSignedUrls, o que o app usa): o colega do mesmo clube assina a1', !!(lote.data || [])[0]?.signedUrl, JSON.stringify(lote.error?.message))
  // 515: só o PRÓPRIO clube abre o rosto de criança; o forjado e o a2 seguem negados para o OUTRO clube (b1)
  const lote2 = await c.b1.storage.from('imagens').createSignedUrls([P.a1, P.forjado, P.a2], 600)
  const por = Object.fromEntries((lote2.data || []).map((x) => [x.path, x]))
  ok('outro clube (b1) NÃO assina a1 em lote (515: rosto de criança só do próprio clube)', !por[P.a1]?.signedUrl, JSON.stringify(por[P.a1]))
  ok('caminho FORJADO perfis/<a1>-7.png (arquivo real, mas não é o de profiles.foto): NEGADO', !por[P.forjado]?.signedUrl, JSON.stringify(por[P.forjado]))
  s = await assina(c.b1, P.forjado)
  ok('...também na assinatura individual', !s.url, s.erro || 'assinou!')
  pa2 = await rpc(c.v1, 'rede_perfil', { p_usuario: id.a2 })
  ok('a2 (personagem) mesmo com autorização arquivada: foto CONTINUA null e o personagem vem', pa2.data?.foto === null && pa2.data?.avatar_tipo === 'personagem', JSON.stringify({ foto: pa2.data?.foto, tipo: pa2.data?.avatar_tipo }))
  // 501: personagem + autorização arquivada -> o ARQUIVO também fica fechado para outro clube
  s = await assina(c.b1, P.a2)
  ok('501: a2 (personagem, autorização arquivada) — outro clube NÃO assina a foto antiga', !s.url, s.erro || 'assinou!')
  s = await assina(c.b1, P.forjadoA2)
  ok('501: caminho FORJADO perfis/<a2>-x.png — outro clube NÃO assina', !s.url, s.erro || 'assinou!')
  s = await assina(c.a1, P.a2)
  ok('501: colega do MESMO clube segue assinando (policy do clube)', !!s.url, s.erro)
  s = await assina(c.a2, P.a2)
  ok('501: o próprio dono segue assinando', !!s.url, s.erro)
  const meu2 = await rpc(c.a1, 'rede_perfil')
  ok('a1 no próprio perfil: imagem_autorizada = true', meu2.data?.imagem_autorizada === true, JSON.stringify(meu2.data?.imagem_autorizada))
  const feed2 = await rpc(c.v1, 'rede_feed', { p_filtro: 'meu_clube' })
  ok('feed: o autor a2 segue com personagem e sem foto', (feed2.data?.itens || []).find((i) => i.autor?.id === id.a2)?.autor?.foto === null)

  console.log('\n== 4. Clube SEM o recurso: nada abre, nem com a autorização arquivada ==')
  const pc = await rpc(c.c1, 'rede_perfil', { p_usuario: id.a1 })
  ok('c1: rede_perfil bloqueado ("não está liberada")', !!pc.erro && /liberad/i.test(pc.erro), pc.erro)
  const fc = await rpc(c.c1, 'rede_feed', { p_filtro: 'meu_clube' })
  ok('c1: rede_feed bloqueado', !!fc.erro, fc.erro)
  s = await assina(c.c1, P.a1)
  ok('c1 NÃO assina a foto autorizada (fora da rede)', !s.url, s.erro || 'assinou!')
  s = await assina(c.c1, P.a2)
  ok('c1 NÃO assina a foto antiga de a2', !s.url, s.erro || 'assinou!')

  console.log('\n== 5. O responsável DESLIGA: bloqueado de novo na hora ==')
  const rv = await rpc(c.pais_a, 'rede_responsavel_imagem', { p_desbravador: id.a1, p_desligar: true })
  ok('responsável desliga a imagem de a1', rv.data?.ok === true && rv.data?.imagem_autorizada === false, JSON.stringify(rv))
  pa1 = await rpc(c.v1, 'rede_perfil', { p_usuario: id.a1 })
  ok('rede_perfil(a1) para o colega do mesmo clube: foto null de novo', pa1.data?.foto === null, JSON.stringify(pa1.data?.foto))
  s = await assina(c.b1, P.a1)
  ok('colega do mesmo clube NÃO assina mais o arquivo', !s.url, s.erro || 'assinou!')
  const rAntes = urlAssinadaAntes ? await abre(urlAssinadaAntes) : { status: 0 }
  console.log(`   info   a URL assinada ANTES da revogação ${rAntes.status === 200 ? 'ainda abre' : 'não abre mais'} (status ${rAntes.status}) — validade da assinatura no aparelho; deve constar no termo (auditoria 6.7-6.9)`)
  const re = await rpc(c.lider_a, 'rede_marcar_autorizacao_imagem', { p_usuario: id.a1, p_arquivada: true })
  ok('diretoria remarcar NÃO passa por cima do "não" do responsável', re.data?.ok === true && (await rpc(c.v1, 'rede_perfil', { p_usuario: id.a1 })).data?.foto === null)
  const rl = await rpc(c.pais_a, 'rede_responsavel_imagem', { p_desbravador: id.a1, p_desligar: false })
  ok('responsável religa: foto volta', rl.data?.imagem_autorizada === true && (await rpc(c.v1, 'rede_perfil', { p_usuario: id.a1 })).data?.foto !== null, JSON.stringify(rl))
  s = await assina(c.v1, P.a1)
  ok('...e o arquivo volta a ser assinável', !!s.url, s.erro)

  console.log('\n== 6. anon ==')
  const an = await rpc(anon, 'rede_perfil', { p_usuario: id.a1 })
  ok('anon NÃO executa rede_perfil', !!an.erro, an.erro)
  const { data: anonAssina } = await anon.storage.from('imagens').createSignedUrl(P.a1, 600)
  ok('anon NÃO assina nada', !anonAssina?.signedUrl)
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
    if (criados.length) await servico.storage.from('imagens').remove(criados)
  } catch (e) { console.error('limpeza do Storage:', e.message) }
  try { limparBanco() } catch (e) { console.error('limpeza do banco:', e.message) }
  console.log(`\n${total - falhas.length}/${total} ok` + (falhas.length ? `, ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}` : ' — TUDO OK'))
  saiu = falhas.length ? 1 : 0
}
process.exit(saiu)
