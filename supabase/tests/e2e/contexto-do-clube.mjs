// E2E do CONTEXTO DO CLUBE no stack LOCAL (nunca produção): supabase-js de verdade -> PostgREST -> banco, e as funções puras do front
// (src/lib/clube.js) lendo a resposta REAL. Prova o que o teste SQL e o Vitest só provam separados: o JSON que o PostgREST entrega
// é o que o front entende, as RPCs respeitam papel/clube por HTTP, e a logo do clube sobe no bucket público e vira marca.
//
//   npm run test:contexto:e2e       (precisa do Supabase local no ar — a mesma stack do `supabase db reset`)
//
// Cria contas/clube com prefixo "ctx-" no banco LOCAL e DEVOLVE tudo ao estado anterior no fim (marca do Tenant 001, recursos, arquivos).
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { normalizarContexto, escolherClubeAtual, podeTrocarPara, permissoesDoPapel } from '../../../src/lib/clube.js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-ctx-123'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

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

// ---------- estado original (para devolver no fim) ----------
const ORIGINAL = {
  marca: sql(`select coalesce(metadata->'marca', 'null'::jsonb)::text from public.organizational_units where slug = 'filhos-da-conquista';`),
  recursos: sql(`select coalesce(json_agg(json_build_object('feature', feature, 'enabled', enabled))::text, '[]') from public.club_features where club_id = (select id from public.organizational_units where slug = 'filhos-da-conquista');`),
}
function restaurar() {
  sql(`
    set session_replication_role = replica;
    update public.organizational_units set metadata = case when $j$${ORIGINAL.marca}$j$::jsonb = 'null'::jsonb then metadata - 'marca' else jsonb_set(metadata, '{marca}', $j$${ORIGINAL.marca}$j$::jsonb) end
     where slug = 'filhos-da-conquista';
    delete from public.club_features where club_id = (select id from public.organizational_units where slug = 'filhos-da-conquista');
    insert into public.club_features (club_id, feature, enabled)
      select (select id from public.organizational_units where slug = 'filhos-da-conquista'), r->>'feature', (r->>'enabled')::boolean
      from json_array_elements($j$${ORIGINAL.recursos}$j$::json) r;
    delete from public.responsaveis where responsavel_id in (select id from auth.users where email like 'ctx-%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'ctx-%@teste.local');
    delete from public.profiles where id in (select id from auth.users where email like 'ctx-%@teste.local');
    delete from auth.users where email like 'ctx-%@teste.local';
    delete from public.club_features where club_id in (select id from public.organizational_units where slug = 'ctx-clube-b');
    delete from public.unidades where nome like 'CTX %';
    delete from public.organizational_units where slug = 'ctx-clube-b';
  `)
}

const CHAVES = ['a1', 'lider_a', 'pais_a', 'pend_a', 'b1', 'lider_b', 'sem_vinculo']
function preparar() {
  restaurar()
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values ('clube', 'CTX Clube B', 'ctx-clube-b', 'BR', 'America/Recife', '{"test_only":true}');
    insert into public.unidades (nome, cor, club_id) select 'CTX A1', '#111111', id from public.organizational_units where slug = 'filhos-da-conquista';
    insert into public.unidades (nome, cor, club_id) select 'CTX B1', '#333333', id from public.organizational_units where slug = 'ctx-clube-b';
    create temp table ctx_p (k text, papel text, status text, clube text, unidade text);
    insert into ctx_p values ('a1','desbravador','ativo','filhos-da-conquista','CTX A1'), ('lider_a','diretoria','ativo','filhos-da-conquista',null),
      ('pais_a','pais','ativo','filhos-da-conquista',null), ('pend_a','desbravador','pendente','filhos-da-conquista','CTX A1'),
      ('b1','desbravador','ativo','ctx-clube-b','CTX B1'), ('lider_b','diretoria','ativo','ctx-clube-b',null), ('sem_vinculo','desbravador','ativo',null,null);
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('ctx:' || k)::uuid, 'authenticated', 'authenticated', 'ctx-' || k || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false from ctx_p;
    insert into public.profiles (id, nome, papel, status, unidade_id)
    select md5('ctx:' || p.k)::uuid, 'CTX ' || p.k, p.papel, p.status, (select id from public.unidades where nome = p.unidade) from ctx_p p;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id)
    select md5('ctx:' || p.k)::uuid, (select id from public.organizational_units where slug = p.clube), p.papel,
           case p.status when 'ativo' then 'ativo' else 'pendente' end,
           (select id from public.unidades where nome = p.unidade) from ctx_p p where p.clube is not null;
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
  const { error } = await c.auth.signInWithPassword({ email: `ctx-${k}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return c
}
const contexto = async (c) => { const { data, error } = await c.rpc('meu_contexto'); if (error) throw new Error(error.message); return normalizarContexto(data) }

let clubeA; let clubeB
async function principal() {
  preparar()
  clubeA = sql(`select id from public.organizational_units where slug = 'filhos-da-conquista';`)
  clubeB = sql(`select id from public.organizational_units where slug = 'ctx-clube-b';`)
  const c = {}
  for (const k of CHAVES) c[k] = await entrar(k)
  const anon = createClient(URL_API, ANON, semSessao)

  console.log('\n== meu_contexto: o JSON do PostgREST é o que o front entende ==')
  const a1 = await contexto(c.a1)
  ok('membro A: 1 vínculo do Tenant 001, papel e status no vínculo', a1.vinculos.length === 1 && a1.vinculos[0].clubeId === clubeA && a1.vinculos[0].papel === 'desbravador' && a1.vinculos[0].status === 'ativo', JSON.stringify(a1.vinculos[0]?.papel))
  ok('membro A: unidade DO VÍNCULO (nome e id)', a1.vinculos[0].unidadeNome === 'CTX A1' && !!a1.vinculos[0].unidadeId)
  ok('membro A: o servidor age no clube A e ele é selecionável', a1.servidorClubeId === clubeA && a1.vinculos[0].selecionavel === true)
  // logoUrl é '/clubes/tenant-001.png' desde a Fase 8.5 (migration 65): antes disso a marca do
  // Tenant 001 apontava pro ÍCONE DO PRODUTO ('/icon-192.png'), o que vazava o brasão de um único
  // clube pra todo push/PWA/favicon da plataforma — a migration separou as duas identidades.
  ok('Tenant 001: a marca de sempre vem do banco', a1.vinculos[0].marca.nome === 'Filhos da Conquista' && a1.vinculos[0].marca.sigla === 'FC' && a1.vinculos[0].marca.lema === 'Desbravadores · 1994' && a1.vinculos[0].marca.desde === 1994 && a1.vinculos[0].marca.logoUrl === '/clubes/tenant-001.png' && a1.vinculos[0].marca.corPrimaria === null, JSON.stringify(a1.vinculos[0].marca))
  ok('Tenant 001: os 11 recursos de sempre + o leilão que já usavam', ['chat', 'mural', 'jogos', 'mensalidades', 'desafios', 'chefao', 'missoes', 'biblia', 'bichinho', 'agenda', 'atividades', 'leilao'].every((r) => a1.vinculos[0].recursos[r] === true), JSON.stringify(a1.vinculos[0].recursos))
  ok('o front escolhe o clube A e o papel vira permissão (desbravador: sem gestão)', escolherClubeAtual({ vinculos: a1.vinculos, servidorClubeId: a1.servidorClubeId, preferidoId: null }) === clubeA && permissoesDoPapel(a1.vinculos[0].papel).podeGerir === false)

  const b1 = await contexto(c.b1)
  ok('membro B: 1 vínculo, do clube B, marca derivada do NOME do clube (sigla CC), sem lema/logo do A', b1.vinculos.length === 1 && b1.vinculos[0].clubeId === clubeB && b1.vinculos[0].marca.nome === 'CTX Clube B' && b1.vinculos[0].marca.sigla === 'CC' && b1.vinculos[0].marca.lema === null && b1.vinculos[0].marca.logoUrl === null, JSON.stringify(b1.vinculos[0].marca))
  ok('membro B: o leilão vem desligado (padrão) e o chat ligado', b1.vinculos[0].recursos.leilao === false && b1.vinculos[0].recursos.chat === true)
  ok('nada do clube A vaza no contexto do B (nem nome nem id)', !JSON.stringify(b1).includes(clubeA) && !JSON.stringify(b1).includes('Filhos da Conquista'))
  ok('nada do clube B vaza no contexto do A', !JSON.stringify(a1).includes(clubeB) && !JSON.stringify(a1).includes('CTX Clube B'))

  const pais = await contexto(c.pais_a)
  ok('responsável: papel "pais", sem unidade, sem gestão', pais.vinculos[0].papel === 'pais' && pais.vinculos[0].unidadeId === null && permissoesDoPapel('pais').temGestao === false)
  const lider = await contexto(c.lider_a)
  ok('diretoria: papel diretoria, gere e é financeiro', lider.vinculos[0].papel === 'diretoria' && permissoesDoPapel('diretoria').podeGerir === true)
  const pend = await contexto(c.pend_a)
  ok('cadastro pendente: vínculo pendente, NÃO selecionável, sem clube em uso (o front não dá acesso)', pend.vinculos[0].status === 'pendente' && pend.vinculos[0].selecionavel === false && escolherClubeAtual({ vinculos: pend.vinculos, servidorClubeId: pend.servidorClubeId, preferidoId: null }) === null)
  const sem = await contexto(c.sem_vinculo)
  ok('conta sem vínculo: lista vazia e nenhum clube', sem.vinculos.length === 0 && escolherClubeAtual({ vinculos: sem.vinculos, servidorClubeId: sem.servidorClubeId, preferidoId: 'qualquer' }) === null)
  ok('trocar para o clube B com vínculo só no A: recusado (sem_vinculo)', podeTrocarPara(a1.vinculos, clubeB).motivo === 'sem_vinculo')
  const { error: anonErro } = await anon.rpc('meu_contexto')
  ok('anon NÃO executa meu_contexto', !!anonErro, anonErro?.message)

  console.log('\n== marca: só a liderança do PRÓPRIO clube grava ==')
  const grava = (quem, campos) => c[quem].rpc('clube_marca_gravar', { p_marca: campos })
  let r = await grava('lider_a', { nome: 'CTX Oficial', cor_primaria: '#112233', lema: 'Sempre prontos' })
  ok('diretoria A grava a marca do clube A', !r.error && r.data.nome === 'CTX Oficial' && r.data.cor_primaria === '#112233', r.error?.message)
  const a1b = await contexto(c.a1)
  ok('o membro A passa a ver a marca nova no contexto', a1b.vinculos[0].marca.nome === 'CTX Oficial' && a1b.vinculos[0].marca.corPrimaria === '#112233' && a1b.vinculos[0].marca.lema === 'Sempre prontos' && a1b.vinculos[0].marca.sigla === 'FC')
  r = await grava('a1', { nome: 'Hackeado' })
  ok('membro NÃO grava marca (HTTP)', !!r.error, r.error?.message)
  r = await grava('pais_a', { nome: 'Hackeado' })
  ok('responsável NÃO grava marca', !!r.error)
  r = await grava('sem_vinculo', { nome: 'Hackeado' })
  ok('conta sem vínculo NÃO grava marca de clube nenhum', !!r.error)
  r = await anon.rpc('clube_marca_gravar', { p_marca: { nome: 'Hackeado' } })
  ok('anon NÃO grava marca', !!r.error)
  r = await grava('lider_a', { cor_primaria: 'red' })
  ok('cor inválida é recusada com mensagem clara', !!r.error && /cor/i.test(r.error.message), r.error?.message)
  r = await grava('lider_a', { logo_url: 'https://evil.test/x.png' })
  ok('logo de site externo é recusada', !!r.error && /logo/i.test(r.error.message), r.error?.message)
  r = await grava('lider_b', { nome: 'CTX B Oficial' })
  ok('diretoria B grava a marca do clube B', !r.error)
  const a1c = await contexto(c.a1); const b1c = await contexto(c.b1)
  ok('...sem mexer na marca do A (isolamento)', a1c.vinculos[0].marca.nome === 'CTX Oficial' && b1c.vinculos[0].marca.nome === 'CTX B Oficial')

  console.log('\n== logo: sobe no bucket público, na pasta do clube, e vira marca ==')
  const caminhoA = `${clubeA}/logo-ctx.png`
  const up = await c.lider_a.storage.from('publico').upload(caminhoA, PNG, { contentType: 'image/png', upsert: true })
  ok('diretoria A sobe a logo na pasta do clube A (Storage real)', !up.error, up.error?.message)
  const urlA = c.lider_a.storage.from('publico').getPublicUrl(caminhoA).data.publicUrl
  r = await grava('lider_a', { logo_url: urlA })
  ok('a URL da logo do PRÓPRIO clube é aceita como marca', !r.error, r.error?.message)
  ok('...e a logo abre sem login (bucket público)', (await fetch(urlA)).status === 200)
  r = await grava('lider_b', { logo_url: urlA })
  ok('diretoria B NÃO usa a logo da pasta do clube A', !!r.error && /logo/i.test(r.error.message), r.error?.message)
  const upB = await c.lider_b.storage.from('publico').upload(`${clubeA}/logo-invasao.png`, PNG, { contentType: 'image/png', upsert: true })
  ok('diretoria B NÃO sobe arquivo na pasta do clube A', !!upB.error)
  const upM = await c.a1.storage.from('publico').upload(`${clubeA}/logo-membro.png`, PNG, { contentType: 'image/png', upsert: true })
  ok('membro comum NÃO sobe logo', !!upM.error)
  await c.lider_a.storage.from('publico').remove([caminhoA])

  console.log('\n== recursos: catálogo, liga/desliga por clube ==')
  const cat = await c.a1.from('recursos_catalogo').select('chave,nome,icone,padrao').order('ordem')
  // 15 recursos desde a Fase 9 (migration 83): especialidades ganhou recurso PRÓPRIO, separado de
  // classes (o catálogo de especialidades ainda é de teste, então fica fora do piloto por padrão).
  ok('membro lê o catálogo (15 recursos; leilão, classes, especialidades e experiências desligados por padrão)', !cat.error && cat.data.length === 15 && cat.data.filter((x) => !x.padrao).map((x) => x.chave).sort().join() === 'classes,especialidades,experiencias,leilao', cat.error?.message)
  const catAnon = await anon.from('recursos_catalogo').select('chave')
  ok('anon não lê o catálogo', !!catAnon.error || (catAnon.data || []).length === 0)
  const catW = await c.lider_a.from('recursos_catalogo').update({ padrao: false }).eq('chave', 'chat')
  ok('nem a diretoria altera o catálogo da plataforma', !!catW.error || catW.status === 204 && (await c.a1.from('recursos_catalogo').select('padrao').eq('chave', 'chat').single()).data.padrao === true)
  r = await c.lider_a.rpc('recurso_definir', { p_feature: 'chat', p_enabled: false })
  ok('diretoria A desliga o chat do clube A', !r.error && r.data.chat === false, r.error?.message)
  ok('...o membro A vê o chat desligado; o membro B segue com o chat ligado', (await contexto(c.a1)).vinculos[0].recursos.chat === false && (await contexto(c.b1)).vinculos[0].recursos.chat === true)
  r = await c.a1.rpc('recurso_definir', { p_feature: 'chat', p_enabled: true })
  ok('membro NÃO liga recurso', !!r.error)
  r = await c.lider_a.rpc('recurso_definir', { p_feature: 'inventado', p_enabled: true })
  ok('recurso fora do catálogo é recusado', !!r.error && /desconhecido/i.test(r.error.message), r.error?.message)
  r = await c.lider_b.rpc('recurso_definir', { p_feature: 'leilao', p_enabled: true })
  ok('diretoria B liga o leilão do clube B', !r.error && r.data.leilao === true)
  ok('...e o leilão do clube A não mudou', (await contexto(c.a1)).vinculos[0].recursos.leilao === true)
  const direto = await c.lider_a.from('club_features').insert({ club_id: clubeA, feature: 'inventado', enabled: true })
  ok('nem por escrita direta na tabela entra recurso fora do catálogo (FK)', !!direto.error, direto.error?.message)
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
    if (clubeA) await servico.storage.from('publico').remove([`${clubeA}/logo-ctx.png`, `${clubeA}/logo-invasao.png`, `${clubeA}/logo-membro.png`])
  } catch (e) { console.error('limpeza do Storage:', e.message) }
  try { restaurar() } catch (e) { console.error('limpeza do banco:', e.message) }
  console.log(`\n${total - reprovados}/${total} ok` + (falhas.length ? `, ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}` : ' — TUDO OK'))
  saiu = falhas.length ? 1 : 0
}
process.exit(saiu)
