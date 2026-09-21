// E2E do Storage LOCAL (nunca produção): prova, com o supabase-js de verdade e o Storage de verdade, o que o teste SQL 25 só prova
// pelas policies — a URL pública do bucket privado NÃO abre, a URL assinada abre só para quem passa na policy do clube, o upload
// com `upsert: true` (o que o app faz) funciona nos caminhos legítimos e é recusado nos demais.
//
//   npm run test:storage:e2e        (precisa do Supabase local no ar: `supabase start` — a mesma stack do `supabase db reset`)
//
// Cria usuários/clube de teste com prefixo "e2e-" no banco LOCAL e apaga tudo no fim (mesmo se falhar).
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-123'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

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
const uid = (k) => sql(`select md5('e2e:${k}')::uuid;`)

// ---------- preparo ----------
const CHAVES = ['a1', 'a2', 'lider_a', 'pais_a', 'b1', 'lider_b']
function preparar() {
  limparBanco()
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values ('clube', 'E2E Clube B', 'e2e-clube-b', 'BR', 'America/Recife', '{"test_only":true}');
    insert into public.unidades (nome, cor, club_id) select 'E2E A1', '#111111', id from public.organizational_units where slug = 'filhos-da-conquista';
    insert into public.unidades (nome, cor, club_id) select 'E2E A2', '#222222', id from public.organizational_units where slug = 'filhos-da-conquista';
    insert into public.unidades (nome, cor, club_id) select 'E2E B1', '#333333', id from public.organizational_units where slug = 'e2e-clube-b';
    create temp table e2e_p (k text, papel text, clube text, unidade text);
    insert into e2e_p values ('a1','desbravador','filhos-da-conquista','E2E A1'), ('a2','desbravador','filhos-da-conquista','E2E A2'),
      ('lider_a','diretoria','filhos-da-conquista',null), ('pais_a','pais','filhos-da-conquista',null),
      ('b1','desbravador','e2e-clube-b','E2E B1'), ('lider_b','diretoria','e2e-clube-b',null);
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('e2e:' || k)::uuid, 'authenticated', 'authenticated', 'e2e-' || k || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false from e2e_p;
    insert into public.profiles (id, nome, papel, status, unidade_id)
    select md5('e2e:' || p.k)::uuid, 'E2E ' || p.k, p.papel, 'ativo', (select id from public.unidades where nome = p.unidade) from e2e_p p;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select md5('e2e:' || p.k)::uuid, (select id from public.organizational_units where slug = p.clube), p.papel, 'ativo' from e2e_p p;
    insert into public.responsaveis (responsavel_id, desbravador_id, nome_digitado, status, club_id) select md5('e2e:pais_a')::uuid, md5('e2e:a1')::uuid, 'E2E a1', 'aprovado', id from public.organizational_units where slug = 'filhos-da-conquista';
  `)
}
function limparBanco() {
  sql(`
    set session_replication_role = replica;
    delete from public.responsaveis where responsavel_id in (select id from auth.users where email like 'e2e-%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'e2e-%@teste.local');
    delete from public.profiles where id in (select id from auth.users where email like 'e2e-%@teste.local');
    delete from auth.users where email like 'e2e-%@teste.local';
    delete from public.unidades where nome like 'E2E %';
    delete from public.organizational_units where slug = 'e2e-clube-b';
  `)
}

// ---------- asserts ----------
let total = 0
let reprovados = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) { reprovados++; falhas.push(`${nome}  [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`)
}

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }
async function entrar(k) {
  const c = createClient(URL_API, ANON, semSessao)
  const { error } = await c.auth.signInWithPassword({ email: `e2e-${k}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return c
}
const upar = (c, bucket, caminho) => c.storage.from(bucket).upload(caminho, PNG, { contentType: 'image/png', upsert: true })   // igual ao app
async function abre(url) {   // GET sem nenhuma credencial (como um navegador anônimo com a URL)
  const r = await fetch(url)
  return { status: r.status, tipo: r.headers.get('content-type') || '' }
}

const criados = { imagens: [], publico: [] }
async function principal() {
  preparar()
  const id = Object.fromEntries(CHAVES.map((k) => [k, uid(k)]))
  const uniA1 = sql(`select id from public.unidades where nome = 'E2E A1';`)
  const clubeA = sql(`select id from public.organizational_units where slug = 'filhos-da-conquista';`)
  const clubeB = sql(`select id from public.organizational_units where slug = 'e2e-clube-b';`)
  const c = {}
  for (const k of CHAVES) c[k] = await entrar(k)
  const anon = createClient(URL_API, ANON, semSessao)
  const servico = createClient(URL_API, SERVICE, semSessao)
  const bruto = (bucket, caminho) => `${URL_API}/storage/v1/object/public/${bucket}/${caminho}`

  console.log('\n== buckets ==')
  const { data: buckets } = await servico.storage.listBuckets()
  const imagens = buckets.find((b) => b.id === 'imagens'); const publico = buckets.find((b) => b.id === 'publico')
  ok('bucket imagens é PRIVADO', imagens && imagens.public === false, JSON.stringify(imagens))
  ok('bucket publico existe e é público', publico && publico.public === true, JSON.stringify(publico))

  console.log('\n== envio (upload com upsert:true, como o app) — caminhos legítimos ==')
  const P = {
    avatarA1: `perfis/${id.a1}-1.png`, muralA1: `mural/${id.a1}-1.png`, muralThumbA1: `mural/${id.a1}-1-thumb.png`,
    compA1: `missoes/${id.a1}-1.png`, avatarA2: `perfis/${id.a2}-1.png`, avatarPais: `perfis/${id.pais_a}-1.png`,
    emblemaA1: `unidades/${uniA1}-emblema-1.png`, avatarB1: `perfis/${id.b1}-1.png`,
  }
  const sobe = async (quem, caminho, esperado, nome) => {
    const { error } = await upar(c[quem], 'imagens', caminho)
    ok(nome, esperado ? !error : !!error, error ? error.message : 'enviou')
    if (!error) criados.imagens.push(caminho)
  }
  await sobe('a1', P.avatarA1, true, 'membro A sobe o PRÓPRIO avatar')
  await sobe('a1', P.muralA1, true, 'membro A sobe foto do mural')
  await sobe('a1', P.muralThumbA1, true, 'membro A sobe a miniatura do mural')
  await sobe('a1', P.compA1, true, 'membro A sobe comprovante do fallback antigo (missoes/)')
  await sobe('a2', P.avatarA2, true, 'membro A2 sobe o próprio avatar')
  await sobe('pais_a', P.avatarPais, true, 'responsável sobe o próprio avatar')
  await sobe('lider_a', P.emblemaA1, true, 'líder A sobe o emblema da unidade do clube')
  await sobe('b1', P.avatarB1, true, 'membro B sobe o próprio avatar')
  // sobrescrever o PRÓPRIO arquivo (upsert de verdade: ON CONFLICT DO UPDATE) também funciona
  await sobe('a1', P.avatarA1, true, 'membro A sobrescreve o PRÓPRIO avatar (upsert)')

  console.log('\n== envio — caminhos recusados ==')
  await sobe('a1', `perfis/${id.a2}-2.png`, false, 'membro A NÃO sobe avatar em nome de outra pessoa')
  await sobe('a1', 'qualquer/coisa.png', false, 'membro A NÃO sobe em caminho solto')
  await sobe('a1', `unidades/${uniA1}-emblema-2.png`, false, 'membro A (comum) NÃO troca emblema')
  await sobe('lider_b', `unidades/${uniA1}-emblema-2.png`, false, 'líder B NÃO troca emblema de unidade do clube A')
  await sobe('pais_a', `mural/${id.pais_a}-1.png`, false, 'responsável NÃO posta no mural')
  const sobeAnon = await upar(anon, 'imagens', `perfis/${id.a1}-3.png`)
  ok('anon NÃO sobe nada', !!sobeAnon.error, sobeAnon.error?.message)
  const naoImagem = await c.a1.storage.from('imagens').upload(`perfis/${id.a1}-4.png`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { contentType: 'image/svg+xml', upsert: true })
  ok('bucket recusa SVG (só imagem raster)', !!naoImagem.error, naoImagem.error?.message)

  console.log('\n== leitura: a URL PÚBLICA não abre mais (bucket privado) ==')
  for (const [nome, p] of Object.entries({ avatar: P.avatarA1, mural: P.muralA1, emblema: P.emblemaA1 })) {
    const r = await abre(bruto('imagens', p))
    ok(`URL pública do ${nome} NÃO abre sem login (status ${r.status})`, r.status >= 400 && !r.tipo.startsWith('image/'), `${r.status} ${r.tipo}`)
  }

  console.log('\n== leitura: URL ASSINADA só para quem passa na policy do clube ==')
  const assina = async (quem, caminho) => { const { data, error } = await c[quem].storage.from('imagens').createSignedUrl(caminho, 3600); return { url: data?.signedUrl, erro: error } }
  const a1av = await assina('a1', P.avatarA1)
  ok('o DONO assina o próprio avatar', !!a1av.url, a1av.erro?.message)
  const r1 = a1av.url ? await abre(a1av.url) : {}
  ok('...e a URL assinada ABRE sem credencial e devolve a imagem', r1.status === 200 && r1.tipo.startsWith('image/'), `${r1.status} ${r1.tipo}`)
  const a2av = await assina('a2', P.avatarA1)
  ok('COLEGA do clube assina o avatar (ranking)', !!a2av.url, a2av.erro?.message)
  const r2 = a2av.url ? await abre(a2av.url) : {}
  ok('...e a assinada do colega abre', r2.status === 200, String(r2.status))
  ok('colega assina a foto do mural e a miniatura', !!(await assina('a2', P.muralA1)).url && !!(await assina('a2', P.muralThumbA1)).url)
  ok('colega assina o emblema da unidade do clube', !!(await assina('a2', P.emblemaA1)).url)
  ok('colega NÃO assina o comprovante antigo do outro (privado)', !(await assina('a2', P.compA1)).url)
  ok('DONO assina o próprio comprovante antigo', !!(await assina('a1', P.compA1)).url)
  ok('LIDERANÇA do clube assina o comprovante antigo (moderação)', !!(await assina('lider_a', P.compA1)).url)
  ok('RESPONSÁVEL assina a foto do FILHO vinculado', !!(await assina('pais_a', P.avatarA1)).url)
  ok('responsável NÃO assina avatar de outro membro nem o mural', !(await assina('pais_a', P.avatarA2)).url && !(await assina('pais_a', P.muralA1)).url)
  ok('membro do clube B NÃO assina nada do clube A (avatar, mural, emblema, comprovante)',
    !(await assina('b1', P.avatarA1)).url && !(await assina('b1', P.muralA1)).url && !(await assina('b1', P.emblemaA1)).url && !(await assina('b1', P.compA1)).url)
  ok('líder B NÃO assina nada do clube A', !(await assina('lider_b', P.avatarA1)).url && !(await assina('lider_b', P.emblemaA1)).url && !(await assina('lider_b', P.compA1)).url)
  ok('membro A NÃO assina o avatar do clube B', !(await assina('a1', P.avatarB1)).url)
  const { data: anonAssina, error: anonErr } = await anon.storage.from('imagens').createSignedUrl(P.avatarA1, 3600)
  ok('anon NÃO assina nada', !anonAssina?.signedUrl, anonErr?.message)

  console.log('\n== leitura em LOTE (createSignedUrls — o que o app usa para uma lista de avatares) ==')
  const lote = await c.a2.storage.from('imagens').createSignedUrls([P.avatarA1, P.muralA1, P.compA1, P.avatarB1, 'perfis/nao-existe.png'], 3600)
  const por = Object.fromEntries((lote.data || []).map((x) => [x.path, x]))
  ok('lote do colega: assina o que pode', !!por[P.avatarA1]?.signedUrl && !!por[P.muralA1]?.signedUrl)
  ok('lote do colega: NEGA (por item) o comprovante, o do clube B e o inexistente — sem derrubar o lote',
    !por[P.compA1]?.signedUrl && !por[P.avatarB1]?.signedUrl && !por['perfis/nao-existe.png']?.signedUrl, JSON.stringify(lote.data?.map((x) => [x.path.slice(0, 14), !!x.signedUrl])))
  ok('o "negado por RLS" e o "não existe" têm a MESMA resposta (sem oráculo de existência)',
    por[P.avatarB1]?.error === por['perfis/nao-existe.png']?.error, `${por[P.avatarB1]?.error} x ${por['perfis/nao-existe.png']?.error}`)

  console.log('\n== listagem ==')
  const lista = async (quem, prefixo) => { const { data } = await c[quem].storage.from('imagens').list(prefixo, { limit: 100 }); return (data || []).map((o) => o.name) }
  const perfisA2 = await lista('a2', 'perfis')
  ok('colega lista os avatares do PRÓPRIO clube, não os do clube B nem o do responsável',
    perfisA2.includes(`${id.a1}-1.png`) && perfisA2.includes(`${id.a2}-1.png`) && !perfisA2.includes(`${id.b1}-1.png`) && !perfisA2.includes(`${id.pais_a}-1.png`), JSON.stringify(perfisA2))
  const perfisB = await lista('b1', 'perfis')
  ok('membro B lista só o próprio avatar', perfisB.length === 1 && perfisB[0] === `${id.b1}-1.png`, JSON.stringify(perfisB))
  const { data: anonLista } = await anon.storage.from('imagens').list('perfis')
  ok('anon lista NADA', (anonLista || []).length === 0)

  console.log('\n== bucket "publico": leitura por URL, escrita só da liderança do PRÓPRIO clube ==')
  const sobeP = async (quem, caminho) => { const r = await upar(c[quem], 'publico', caminho); if (!r.error) criados.publico.push(caminho); return r }
  ok('líder A grava o asset público na pasta do clube A', !(await sobeP('lider_a', `${clubeA}/logo.png`)).error)
  ok('líder A NÃO grava na pasta do clube B', !!(await sobeP('lider_a', `${clubeB}/logo.png`)).error)
  ok('membro comum NÃO grava no bucket publico', !!(await sobeP('a1', `${clubeA}/x.png`)).error)
  ok('anon NÃO grava no bucket publico', !!(await upar(anon, 'publico', `${clubeA}/y.png`)).error)
  const rp = await abre(bruto('publico', `${clubeA}/logo.png`))
  ok('o asset público ABRE sem login (é o único bucket público)', rp.status === 200 && rp.tipo.startsWith('image/'), `${rp.status} ${rp.tipo}`)
  const { data: anonPub } = await anon.storage.from('publico').list(clubeA)
  ok('anon NÃO lista o bucket publico (só abre por URL exata)', (anonPub || []).length === 0)
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
    if (criados.imagens.length) await servico.storage.from('imagens').remove(criados.imagens)
    if (criados.publico.length) await servico.storage.from('publico').remove(criados.publico)
  } catch (e) { console.error('limpeza do Storage:', e.message) }
  try { limparBanco() } catch (e) { console.error('limpeza do banco:', e.message) }
  console.log(`\n${total - falhas.length}/${total} ok` + (falhas.length ? `, ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}` : ' — TUDO OK'))
  saiu = falhas.length ? 1 : 0
}
process.exit(saiu)
