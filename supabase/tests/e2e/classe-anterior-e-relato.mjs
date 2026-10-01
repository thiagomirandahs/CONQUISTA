// E2E de CLASSES (LOCAL, nunca produção) contra Supabase + PostgREST + Storage REAIS:
//   A. Registrar classe JÁ CONCLUÍDA (521): permissões, comprovante no bucket privado 'comprovacoes', caminhos forjados,
//      não cria matrícula/aprovação, aparece nas leituras, libera a avançada, revogação auditada, log append-only, órfão.
//   B. Comprovação universal (520): relato por requisito, fila (classe_avaliacoes_pendentes + fila_avaliacao_unificada),
//      devolução, reenvio, histórico por tentativa, autoavaliação, isolamento entre clubes, limites.
//   C. Versão arquivada (523): matrícula na 2026.3 bloqueia iniciar a 2026.4 no mesmo clube; cancelada libera.
//   D. Prévia de atualização (522): leitura pura e sem oráculo entre clubes.
//
//   npm run test:classes:e2e     (precisa do Supabase local no ar; usa só 127.0.0.1)
//
// Dados com prefixo "e2e-cla-"; ids determinísticos; idempotente; limpa banco E Storage no início e no fim.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-cla-123'
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
function sqlTenta(texto) {
  try { return { ok: true, saida: sql(texto) } } catch (e) { return { ok: false, saida: String(e.stderr || e.message) } }
}
const uid = (k) => sql(`select md5('e2e-cla:${k}')::uuid;`)
const CLUBE_A = sql(`select md5('e2e-cla:clubeA')::uuid;`)
const CLUBE_B = sql(`select md5('e2e-cla:clubeB')::uuid;`)

// chave -> [papel, clube(s)]
const PESSOAS = {
  dirA: ['diretoria', 'A'], selfD: ['diretoria', 'A'], instrA: ['instrutor', 'A'], consA: ['conselheiro', 'A'], paisA: ['pais', 'A'],
  desbA: ['desbravador', 'A'], m1: ['desbravador', 'A'], m2: ['desbravador', 'A'], m3: ['desbravador', 'A'], m4: ['desbravador', 'AB'],
  m5: ['desbravador', 'A'], m6: ['desbravador', 'A'], dirB: ['diretoria', 'B'], desbB: ['desbravador', 'B'],
}
const CHAVES = Object.keys(PESSOAS)

function limparBanco() {
  const lista = CHAVES.map((k) => `'${k}'`).join(',')
  sql(`
    set session_replication_role = replica;
    create temp table e2e_u as select id from public.organizational_units where slug like 'e2e-cla-%';
    create temp table e2e_us as select id from auth.users where email like 'e2e-cla-%@teste.local';
    do $$
    declare r record;
    begin
      for r in select c.table_name, c.column_name from information_schema.columns c
                 join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
                where c.table_schema = 'public' and c.data_type = 'uuid' and c.table_name not in ('organizational_units', 'profiles')
                  and c.column_name in ('club_id', 'club_id_origem', 'registrado_no_club_id', 'organizational_unit_id') loop
        execute format('delete from public.%I where %I in (select id from e2e_u)', r.table_name, r.column_name);
      end loop;
      for r in select c.table_name, c.column_name from information_schema.columns c
                 join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
                where c.table_schema = 'public' and c.data_type = 'uuid' and c.table_name not in ('organizational_units', 'profiles')
                  and c.column_name in ('usuario_id', 'user_id', 'ator_id', 'registrado_por', 'avaliado_por', 'desbravador_id', 'responsavel_id', 'autor_id', 'criado_por', 'para_usuario') loop
        execute format('delete from public.%I where %I in (select id from e2e_us)', r.table_name, r.column_name);
      end loop;
      begin delete from auth.refresh_tokens where session_id in (select id from auth.sessions where user_id in (select id from e2e_us)); exception when others then null; end;
      begin delete from auth.mfa_amr_claims where session_id in (select id from auth.sessions where user_id in (select id from e2e_us)); exception when others then null; end;
      begin delete from auth.sessions where user_id in (select id from e2e_us); exception when others then null; end;
      begin delete from auth.identities where user_id in (select id from e2e_us); exception when others then null; end;
    end $$;
    delete from public.profiles where id in (select id from e2e_us);
    delete from auth.users where id in (select id from e2e_us);
    delete from public.organizational_units where id in (select id from e2e_u);
  `.replace('${lista}', lista))
}

function preparar() {
  limparBanco()
  const linhas = []
  for (const [k, [papel, clubes]] of Object.entries(PESSOAS)) for (const c of clubes.split('')) linhas.push(`('${k}', '${papel}', '${c === 'A' ? CLUBE_A : CLUBE_B}')`)
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (id, type, nome, slug, pais, timezone, metadata) values
      ('${CLUBE_A}', 'clube', 'E2E Cla Clube A', 'e2e-cla-clube-a', 'BR', 'America/Recife', '{"test_only":true}'),
      ('${CLUBE_B}', 'clube', 'E2E Cla Clube B', 'e2e-cla-clube-b', 'BR', 'America/Recife', '{"test_only":true}');
    insert into public.club_features (club_id, feature, enabled) values ('${CLUBE_A}', 'classes', true), ('${CLUBE_B}', 'classes', true);
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('e2e-cla:' || k)::uuid, 'authenticated', 'authenticated', 'e2e-cla-' || lower(k) || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
      from unnest(array[${CHAVES.map((k) => `'${k}'`).join(',')}]) as k;
    insert into public.profiles (id, nome, papel, status, nascimento, created_at)
    select md5('e2e-cla:' || k)::uuid, 'E2E Cla ' || k, 'desbravador', 'ativo', (current_date - interval '16 years')::date, now() - interval '60 days'
      from unnest(array[${CHAVES.map((k) => `'${k}'`).join(',')}]) as k;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select md5('e2e-cla:' || v.k)::uuid, v.c::uuid, v.p, 'ativo' from (values ${linhas.join(',')}) as v(k, p, c);
  `)
}

let total = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) { falhas.push(`${nome}  [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`)
}
const info = (t) => console.log(`   info   ${t}`)

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }
async function entrar(k, clube) {
  const c = createClient(URL_API, ANON, { ...semSessao, global: { headers: clube ? { 'x-clube-atual': clube } : {} } })
  const { error } = await c.auth.signInWithPassword({ email: `e2e-cla-${k.toLowerCase()}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return c
}
const rpc = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); return { data, erro: error?.message || null } }
const BK = 'comprovacoes'

async function acessa(c, caminho) {
  const b = c.storage.from(BK)
  const a = await b.createSignedUrl(caminho, 120)
  const lote = await b.createSignedUrls([caminho], 120)
  const dl = await b.download(caminho)
  let status = null
  const url = a.data?.signedUrl || null
  if (url) { try { status = (await fetch(url)).status } catch { status = -1 } }
  return {
    assina: !!url && status === 200, assinou: !!url, lote: !!(lote.data || [])[0]?.signedUrl, baixa: !!dl.data && !dl.error, status,
    resumo: `assina=${!!url}/${status} lote=${!!(lote.data || [])[0]?.signedUrl} baixa=${!!dl.data} (${a.error?.message || dl.error?.message || ''})`,
  }
}
const abriu = (r) => r.assina && r.lote && r.baixa
const fechado = (r) => !r.assinou && !r.lote && !r.baixa

const criadosStorage = new Set()
async function subir(c, caminho, tipo = 'image/png', corpo = PNG) {
  const r = await c.storage.from(BK).upload(caminho, corpo, { contentType: tipo })
  if (!r.error) criadosStorage.add(caminho)
  return r
}
async function limparStorage() {
  const servico = createClient(URL_API, SERVICE, semSessao)
  const b = servico.storage.from(BK)
  const apagar = [...criadosStorage]
  for (const clube of [CLUBE_A, CLUBE_B]) {
    const pastas = (await b.list(clube)).data || []
    for (const p of pastas) {
      const arqs = (await b.list(`${clube}/${p.name}/conclusao-anterior`)).data || []
      for (const f of arqs) if (f.name) apagar.push(`${clube}/${p.name}/conclusao-anterior/${f.name}`)
    }
  }
  if (apagar.length) await b.remove([...new Set(apagar)])
}
const existeNoStorage = async (caminho) => !!(await createClient(URL_API, SERVICE, semSessao).storage.from(BK).download(caminho)).data

const classeId = (codigo, versao) => sql(`select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id
  where c.codigo = '${codigo}' and v.origem = 'oficial' and ${versao ? `v.versao = '${versao}'` : `v.status = 'publicado'`} limit 1;`)
function reqSimples(classe, k) {   // requisito sem evidência, sem modelo, sem escolha, sem conteúdo dinâmico
  return sql(`select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id
    where s.class_id = '${classe}' and r.ativo and r.tipo_evidencia = 'nenhuma' and not r.evidencia_obrigatoria and not public._requisito_exige_documento(r.id) and r.conteudo_dinamico_definicao_id is null
      and not exists (select 1 from public.requirement_option_groups g where g.alvo_id = r.id)
      and not exists (select 1 from public.requisito_modelos m where m.alvo = 'classe' and m.chave = r.manifesto_id)
    order by s.ordem, r.ordem offset ${k} limit 1;`)
}
function reqFoto(classe) {
  return sql(`select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id
    where s.class_id = '${classe}' and r.ativo and r.tipo_evidencia = 'foto' and r.evidencia_obrigatoria and not public._requisito_exige_documento(r.id) and r.conteudo_dinamico_definicao_id is null
      and not exists (select 1 from public.requirement_option_groups g where g.alvo_id = r.id)
      and not exists (select 1 from public.requisito_modelos m where m.alvo = 'classe' and m.chave = r.manifesto_id)
    order by s.ordem, r.ordem limit 1;`)
}
const mrId = (usuario, req) => sql(`select id from public.member_requirements where usuario_id = '${usuario}' and requirement_id = '${req}';`)
const n = (q) => Number(sql(q))
const cod = (lista, codigo) => (lista || []).find((x) => x.codigo === codigo)

async function principal() {
  preparar()
  await limparStorage()
  const ID = Object.fromEntries(CHAVES.map((k) => [k, uid(k)]))
  const A = CLUBE_A; const B = CLUBE_B
  const C = {}
  for (const k of CHAVES) C[k] = await entrar(k, PESSOAS[k][1][0] === 'A' ? A : B)
  C.m4B = await entrar('m4', B)
  C.dirAhdrB = await entrar('dirA', B)       // diretoria do A mandando o header do B (onde NÃO é membro)
  C.m2hdrB = await entrar('m2', B)
  C.dirBhdrA = await entrar('dirB', A)
  const anon = createClient(URL_API, ANON, semSessao)
  const servico = createClient(URL_API, SERVICE, semSessao)

  const AMIGO = classeId('amigo'); const COMP = classeId('companheiro'); const NAT = classeId('amigo_da_natureza')
  const AMIGO3 = classeId('amigo', '2026.3')
  if (!AMIGO || !COMP || !NAT || !AMIGO3) throw new Error('catálogo oficial não encontrado (amigo/companheiro/amigo_da_natureza/2026.3)')
  const reg = (cli, quem, classe, data, desc, obs, path) => rpc(cli, 'classe_concluida_anteriormente_registrar',
    { p_usuario_id: ID[quem], p_class_id: classe, p_concluida_em: data, p_data_desconhecida: desc, p_observacao: obs, p_comprovante_path: path ?? null })
  const OBS = 'Cartão de classe do clube antigo'

  // ======================================================================================================
  console.log('\n== A1. quem pode registrar ==')
  for (const [nome, cli] of [['desbravador', C.desbA], ['conselheiro', C.consA], ['pais', C.paisA], ['membro (m2)', C.m2]]) {
    const r = await reg(cli, 'm1', COMP, '2023-05-10', false, OBS)
    ok(`${nome} NÃO registra`, !!r.erro && /permiss/i.test(r.erro), r.erro)
  }
  let r = await reg(C.instrA, 'instrA', COMP, '2023-05-10', false, OBS)
  ok('instrutor NÃO registra para si mesmo', !!r.erro && /outra pessoa/i.test(r.erro), r.erro)
  r = await reg(C.dirA, 'dirA', COMP, '2023-05-10', false, OBS)
  ok('diretoria NÃO registra para si mesma', !!r.erro && /outra pessoa/i.test(r.erro), r.erro)
  r = await reg(C.dirB, 'm1', COMP, '2023-05-10', false, OBS)
  ok('diretoria de OUTRO clube (B) não registra membro do A (sem vínculo no B)', !!r.erro && /vínculo/i.test(r.erro), r.erro)
  r = await reg(C.dirAhdrB, 'm1', COMP, '2023-05-10', false, OBS)
  ok('diretoria do A forjando x-clube-atual=B (não é membro): negado', !!r.erro, r.erro)
  r = await reg(C.dirA, 'paisA', COMP, '2023-05-10', false, OBS)
  ok('registrar para membro com papel "pais": recusado', !!r.erro, r.erro)
  r = await reg(anon, 'm1', COMP, '2023-05-10', false, OBS)
  ok('anon NÃO registra', !!r.erro, r.erro)
  r = await reg(C.dirA, 'm1', COMP, '2099-01-01', false, OBS)
  ok('data no futuro recusada', !!r.erro && /futuro/i.test(r.erro), r.erro)
  r = await reg(C.dirA, 'm1', COMP, '2023-05-10', false, 'abc')
  ok('observação curta recusada', !!r.erro && /observação/i.test(r.erro), r.erro)
  r = await reg(C.dirA, 'm1', COMP, '2023-05-10', true, OBS)
  ok('data informada + "não sei a data" recusada', !!r.erro, r.erro)
  r = await reg(C.dirA, 'm1', COMP, null, false, OBS)
  ok('sem data e sem marcar desconhecida: recusada', !!r.erro, r.erro)
  r = await reg(C.dirA, 'm1', COMP, '1990-01-01', false, OBS)
  ok('data anterior ao nascimento recusada', !!r.erro && /nascimento/i.test(r.erro), r.erro)
  ok('nenhuma conquista nasceu das tentativas negadas', n(`select count(*) from public.curriculum_achievements where usuario_id = '${ID.m1}';`) === 0)

  console.log('\n== A2. registrar SEM comprovante (m1: Companheiro com data; Amigo com data desconhecida) ==')
  let d = await rpc(C.m1, 'classes_disponiveis')
  ok('antes: m1 vê Companheiro e Amigo como oferta', !!cod(d.data, 'companheiro') && !!cod(d.data, 'amigo'), d.erro)
  ok('antes: Amigo da Natureza bloqueada por pré-requisito', cod(d.data, 'amigo_da_natureza')?.elegivel === false && cod(d.data, 'amigo_da_natureza')?.bloqueio === 'pre_requisito', JSON.stringify(cod(d.data, 'amigo_da_natureza')))
  const antesTabelas = sql(`select count(*) from public.member_classes where usuario_id = '${ID.m1}';`)
  const r1 = await reg(C.dirA, 'm1', COMP, '2023-05-10', false, OBS)
  ok('diretoria registra Companheiro (data conhecida, sem comprovante)', r1.data?.ok === true && r1.data?.origem === 'registro_anterior' && r1.data?.concluida_em === '2023-05-10', r1.erro || JSON.stringify(r1.data))
  const r2 = await reg(C.instrA, 'm1', AMIGO, null, true, OBS)
  ok('instrutor registra Amigo (data DESCONHECIDA, sem comprovante)', r2.data?.ok === true && r2.data?.data_desconhecida === true && r2.data?.concluida_em === null, r2.erro || JSON.stringify(r2.data))
  const ach1 = sql(`select concat_ws('|', origem, registrado_por, registrado_papel, registrado_no_club_id, status, coalesce(comprovante_path, 'sem')) from public.curriculum_achievements where id = '${r1.data?.achievement_id}';`)
  ok('conquista: origem registro_anterior, quem registrou, papel, clube, ativa, sem comprovante', ach1 === `registro_anterior|${ID.dirA}|diretoria|${A}|ativa|sem`, ach1)
  const ach2 = sql(`select registrado_papel from public.curriculum_achievements where id = '${r2.data?.achievement_id}';`)
  ok('papel do ator é o REAL (instrutor)', ach2 === 'instrutor', ach2)
  // nada de aprovação falsa
  for (const t of ['member_classes', 'member_requirements', 'requirement_submissions', 'requirement_approvals', 'class_investitures']) {
    const nn = t === 'requirement_approvals' || t === 'requirement_submissions'
      ? n(`select count(*) from public.${t} where club_id = '${A}' and member_requirement_id in (select id from public.member_requirements where usuario_id = '${ID.m1}');`)
      : n(`select count(*) from public.${t} where usuario_id = '${ID.m1}';`)
    ok(`registrar NÃO criou linha em ${t}`, nn === 0, String(nn))
  }
  void antesTabelas
  const tabs = sql(`select string_agg(t, ',') from (select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'usuario_id' and table_name in
    (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')) x where true;`).split(',')
  const sel = tabs.map((t) => `select '${t}' as t, count(*) c from public.${t} where usuario_id = '${ID.m1}'`).join(' union all ')
  const nz = sql(`select string_agg(t || '=' || c, ' ') from (${sel}) y where c > 0;`).split(' ').filter(Boolean)
  const curr = nz.filter((x) => /class|requirement|document|invest|assinat|snapshot|evento|especialid|specialt/i.test(x) && !/^(curriculum_achievements|class_prior_completion_log)=/.test(x))
  ok('nenhuma tabela curricular (matrícula/aprovação/documento/investidura/snapshot/evento) tem linha do m1 além de conquista+log', curr.length === 0, curr.join(' '))
  info(`tabelas com linhas de m1 (usuario_id): ${nz.join(' ')}`)

  console.log('\n== A3. leituras e efeitos ==')
  const l1 = await rpc(C.m1, 'classes_concluidas_anteriormente')
  const lc = cod(l1.data, 'companheiro'); const la = cod(l1.data, 'amigo')
  ok('classes_concluidas_anteriormente (m1): Companheiro com origem e data', lc?.origem === 'registro_anterior_neste_clube' && String(lc?.concluida_em).startsWith('2023-05-10'), JSON.stringify(lc))
  ok('...e Amigo com data null e data_desconhecida (a data do registro nunca vira conclusão)', la?.concluida_em === null && la?.data_desconhecida === true, JSON.stringify(la))
  const l2 = await rpc(C.dirA, 'classe_concluidas_do_membro', { p_usuario_id: ID.m1 })
  const mc = cod(l2.data, 'companheiro'); const ma = cod(l2.data, 'amigo')
  ok('classe_concluidas_do_membro (liderança): origem registro_anterior, ativa, quem registrou, pode revogar', mc?.origem === 'registro_anterior' && mc?.status === 'ativa' && mc?.registrado_por_nome === 'E2E Cla dirA' && mc?.pode_revogar === true, JSON.stringify(mc))
  ok('...Amigo: concluida_em null, observação visível à liderança do clube', ma?.concluida_em === null && ma?.data_desconhecida === true && ma?.observacao === OBS, JSON.stringify(ma))
  const l3 = await rpc(C.dirB, 'classe_concluidas_do_membro', { p_usuario_id: ID.m1 })
  ok('diretoria de OUTRO clube não lê as conclusões do membro', !!l3.erro, l3.erro)
  const l4 = await rpc(C.desbA, 'classe_concluidas_do_membro', { p_usuario_id: ID.m1 })
  ok('desbravador (sem liderança) não lê as conclusões de outro', !!l4.erro, l4.erro)
  const j = await rpc(C.m1, 'minha_jornada')
  const jc = (j.data?.conquistas || []).find((x) => x.nome === 'Amigo')
  ok('minha_jornada: conquista Amigo com origem e data null', jc?.origem === 'registro_anterior' && jc?.concluida_em === null && jc?.data_desconhecida === true, JSON.stringify(jc))
  d = await rpc(C.m1, 'classes_disponiveis')
  ok('classes_disponiveis NÃO oferece mais Companheiro nem Amigo', !cod(d.data, 'companheiro') && !cod(d.data, 'amigo'))
  ok('classes_disponiveis: Amigo da Natureza LIBERADA (conclusão registrada vale como pré-requisito)', cod(d.data, 'amigo_da_natureza')?.elegivel === true, JSON.stringify(cod(d.data, 'amigo_da_natureza')))
  for (const [nome, cl] of [['Companheiro', COMP], ['Amigo', AMIGO]]) {
    const ini = await rpc(C.m1, 'classe_iniciar', { p_class_id: cl })
    ok(`classe_iniciar(${nome}) recusa (já concluída)`, !!ini.erro && /conclu/i.test(ini.erro), ini.erro)
    const at = await rpc(C.dirA, 'classe_atribuir', { p_usuario_id: ID.m1, p_class_id: cl })
    ok(`classe_atribuir(${nome}) recusa`, !!at.erro && /conclu/i.test(at.erro), at.erro)
  }
  r = await reg(C.dirA, 'm1', COMP, '2023-05-10', false, OBS)
  ok('registrar a MESMA classe de novo: recusado (duplicata)', !!r.erro && /já consta/i.test(r.erro), r.erro)
  r = await reg(C.dirA, 'm1', classeId('companheiro', '2026.3'), '2023-05-10', false, OBS)
  ok('...mesmo apontando a versão arquivada da mesma classe', !!r.erro, r.erro)
  const gen = await rpc(C.dirA, 'curriculum_achievement_revogar', { p_id: r1.data?.achievement_id, p_motivo: 'teste' })
  ok('revogação GENÉRICA não revoga registro_anterior (exige o fluxo com log)', !!gen.erro && /registrada como conclu/i.test(gen.erro), gen.erro)
  ok('classe iniciada pelo m1 de uma avançada: Natureza pode ser iniciada', (await rpc(C.m1, 'classe_iniciar', { p_class_id: NAT })).data?.ok === true)
  // regular só INICIADA em outro clube NÃO libera
  const inB = await rpc(C.m4B, 'classe_iniciar', { p_class_id: AMIGO })
  ok('m4 inicia Amigo no clube B (matrícula em andamento)', inB.data?.ok === true, inB.erro)
  d = await rpc(C.m4, 'classes_disponiveis')
  ok('regular só INICIADA em OUTRO clube não libera a avançada no A (pré-requisito)', cod(d.data, 'amigo_da_natureza')?.elegivel === false && cod(d.data, 'amigo_da_natureza')?.bloqueio === 'pre_requisito', JSON.stringify(cod(d.data, 'amigo_da_natureza')))
  const mi = await rpc(C.m4, 'classe_iniciar', { p_class_id: NAT })
  ok('...e classe_iniciar(avançada) no A recusa', !!mi.erro && /primeiro/i.test(mi.erro), mi.erro)
  ok('controle: iniciando a regular no próprio A, a avançada libera', (await rpc(C.m4, 'classe_iniciar', { p_class_id: AMIGO })).data?.ok === true && cod((await rpc(C.m4, 'classes_disponiveis')).data, 'amigo_da_natureza')?.elegivel === true)

  console.log('\n== A4. COM comprovante (m5: Amigo) — Storage real ==')
  const ARQ = `${randomUUID()}.png`
  const P = `${A}/${ID.m5}/conclusao-anterior/${ARQ}`
  const up = await subir(C.instrA, P)
  ok('instrutor sobe o comprovante em <A>/<m5>/conclusao-anterior/<uuid>.png', !up.error, up.error?.message)
  const r5 = await reg(C.instrA, 'm5', AMIGO, '2022-11-20', false, OBS, P)
  ok('registrar com comprovante', r5.data?.ok === true, r5.erro)
  ok('conquista guarda o comprovante_path', sql(`select comprovante_path from public.curriculum_achievements where id = '${r5.data?.achievement_id}';`) === P)
  for (const [nome, cli] of [['diretoria A', C.dirA], ['instrutor A', C.instrA], ['o membro dono (m5)', C.m5]]) {
    const x = await acessa(cli, P)
    ok(`${nome}: assina, lote, baixa e a URL assinada abre (200)`, abriu(x), x.resumo)
  }
  for (const [nome, cli] of [['diretoria do OUTRO clube (B)', C.dirB], ['diretoria B forjando header A', C.dirBhdrA], ['desbravador B', C.desbB], ['outro membro do A sem liderança (desbA)', C.desbA],
    ['outro membro (m6)', C.m6], ['conselheiro A', C.consA], ['pais A', C.paisA], ['anon', anon]]) {
    const x = await acessa(cli, P)
    ok(`${nome}: comprovante FECHADO`, fechado(x), x.resumo)
  }
  const pub = await fetch(`${URL_API}/storage/v1/object/public/${BK}/${P}`)
  ok(`URL pública do bucket privado não abre (${pub.status})`, pub.status >= 400)
  const lm = await rpc(C.dirA, 'classe_concluidas_do_membro', { p_usuario_id: ID.m5 })
  ok('RPC da liderança devolve tem_comprovante/comprovante_path ao clube que registrou', cod(lm.data, 'amigo')?.tem_comprovante === true && cod(lm.data, 'amigo')?.comprovante_path === P, JSON.stringify(cod(lm.data, 'amigo')))

  console.log('\n== A5. caminho forjado e envio forjado ==')
  const orf = `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`
  const upO = await subir(C.instrA, orf)
  ok('preparo: arquivo órfão legítimo de m6 (sem conquista)', !upO.error, upO.error?.message)
  const forjados = {
    'com ../ saindo da pasta': `${A}/${ID.m6}/conclusao-anterior/../${ARQ}`,
    'pasta de OUTRO membro (arquivo real do m5)': P,
    'pasta de outro clube': `${B}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`,
    'uuid inexistente (caminho certo, sem arquivo)': `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`,
    'fora da pasta conclusao-anterior': `${A}/${ID.m6}/requisitos/${randomUUID()}.png`,
    'extensão não permitida (.pdf)': `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.pdf`,
    'barra no início': `/${orf}`,
    'texto livre': 'qualquer-coisa',
  }
  for (const [nome, caminho] of Object.entries(forjados)) {
    const x = await reg(C.instrA, 'm6', AMIGO, '2022-11-20', false, OBS, caminho)
    ok(`registrar com caminho "${nome}": recusado`, !!x.erro, x.erro)
  }
  const dup = await reg(C.instrA, 'm5', COMP, '2022-11-20', false, OBS, P)
  ok('reaproveitar o MESMO comprovante em outro registro do mesmo membro: recusado', !!dup.erro && /outro registro/i.test(dup.erro), dup.erro)
  ok('nenhum registro nasceu de caminho forjado', n(`select count(*) from public.curriculum_achievements where usuario_id = '${ID.m6}';`) === 0)
  // upload forjado pela API do Storage
  const cenarios = [
    ['instrutor A -> pasta de outro clube', C.instrA, `${B}/${ID.desbB}/conclusao-anterior/${randomUUID()}.png`],
    ['instrutor A -> pasta de usuário que não é membro', C.instrA, `${A}/${randomUUID()}/conclusao-anterior/${randomUUID()}.png`],
    ['instrutor A -> fora da pasta conclusao-anterior', C.instrA, `${A}/${ID.m6}/outra/${randomUUID()}.png`],
    ['instrutor A -> com ../', C.instrA, `${A}/${ID.m6}/conclusao-anterior/../${randomUUID()}.png`],
    ['instrutor A -> membro com papel pais', C.instrA, `${A}/${ID.paisA}/conclusao-anterior/${randomUUID()}.png`],
    ['instrutor A -> extensão .pdf', C.instrA, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.pdf`],
    ['conselheiro A -> pasta de membro', C.consA, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`],
    ['desbravador A -> pasta de outro membro', C.desbA, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`],
    ['diretoria B (header B) -> pasta do clube A', C.dirB, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`],
    ['diretoria B forjando header A -> pasta do clube A', C.dirBhdrA, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`],
    ['anon', anon, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`],
  ]
  for (const [nome, cli, caminho] of cenarios) {
    const x = await subir(cli, caminho)
    ok(`upload forjado (${nome}): recusado`, !!x.error, x.error?.message || 'subiu!')
  }
  const txt = await subir(C.instrA, `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`, 'text/plain', Buffer.from('nao sou imagem'))
  ok('upload de não-imagem (text/plain) recusado pelo bucket', !!txt.error, txt.error?.message || 'subiu!')
  // dono envia na própria pasta (política antiga "comprovacao dono envia") — observação
  const proprio = `${A}/${ID.m6}/conclusao-anterior/${randomUUID()}.png`
  const upProprio = await subir(C.m6, proprio)
  info(`OBSERVAÇÃO: o PRÓPRIO membro (m6) ${upProprio.error ? 'NÃO consegue' : 'CONSEGUE'} subir arquivo na própria pasta conclusao-anterior (${upProprio.error?.message || 'policy antiga "comprovacao dono envia"'}); a conquista só nasce se a liderança registrar`)

  console.log('\n== A6. comprovante órfão: só apaga quem pode e só sem referência ==')
  for (const [nome, cli] of [['desbravador A', C.desbA], ['diretoria B', C.dirB], ['conselheiro A', C.consA], ['anon', anon]]) {
    await cli.storage.from(BK).remove([orf])
    ok(`${nome} NÃO apaga o órfão (arquivo continua)`, await existeNoStorage(orf))
  }
  await C.dirA.storage.from(BK).remove([P])
  ok('diretoria NÃO apaga comprovante REFERENCIADO por conquista (arquivo continua)', await existeNoStorage(P))
  await C.instrA.storage.from(BK).remove([orf])
  ok('liderança APAGA o órfão (nenhuma conquista referencia)', !(await existeNoStorage(orf)))
  await C.m5.storage.from(BK).remove([P])
  ok('o próprio dono NÃO apaga o comprovante referenciado', await existeNoStorage(P))

  console.log('\n== A7. revogar (auditável) e log append-only ==')
  const rv = (cli, id, motivo) => rpc(cli, 'classe_concluida_anteriormente_revogar', { p_achievement_id: id, p_motivo: motivo })
  const ach5 = r5.data?.achievement_id
  let x = await rv(C.desbA, ach5, 'motivo qualquer')
  ok('desbravador NÃO revoga', !!x.erro && /permiss/i.test(x.erro), x.erro)
  x = await rv(C.dirB, ach5, 'motivo qualquer')
  const msgOutroClube = x.erro
  const xi = await rv(C.dirB, randomUUID(), 'motivo qualquer')
  ok('diretoria de OUTRO clube NÃO revoga e a resposta é IGUAL à de id inexistente (sem oráculo)', !!x.erro && x.erro === xi.erro, `${msgOutroClube} | ${xi.erro}`)
  x = await rv(C.dirA, ach5, 'abc')
  ok('revogar sem motivo suficiente: recusado', !!x.erro && /motivo/i.test(x.erro), x.erro)
  x = await rv(C.dirA, ach5, 'Registro feito no membro errado')
  ok('diretoria revoga com motivo', x.data?.ok === true, x.erro)
  ok('status vira revogada (nunca DELETE): linha continua, com quem/quando/motivo', sql(`select concat_ws('|', status, revogada_por, revogada_motivo) from public.curriculum_achievements where id = '${ach5}';`) === `revogada|${ID.dirA}|Registro feito no membro errado`)
  x = await rv(C.dirA, ach5, 'Registro feito no membro errado')
  ok('revogar de novo: "já revogado"', !!x.erro && /já está revogado/i.test(x.erro), x.erro)
  const logs = JSON.parse(sql(`select coalesce(json_agg(l order by em), '[]') from public.class_prior_completion_log l where achievement_id = '${ach5}';`))
  ok('log: 2 linhas (registrar, revogar) com ator, papel, clube, membro e motivo', logs.length === 2 && logs[0].acao === 'registrar' && logs[1].acao === 'revogar'
    && logs[0].ator_id === ID.instrA && logs[0].ator_papel === 'instrutor' && logs[1].ator_id === ID.dirA && logs[1].ator_papel === 'diretoria'
    && logs[1].club_id === A && logs[1].usuario_id === ID.m5 && logs[1].motivo === 'Registro feito no membro errado', JSON.stringify(logs).slice(0, 300))
  d = await rpc(C.m5, 'classes_disponiveis')
  ok('depois de revogar: a classe VOLTA a ser oferecida', !!cod(d.data, 'amigo'))
  ok('...e a avançada volta a ficar bloqueada', cod(d.data, 'amigo_da_natureza')?.elegivel === false)
  const l5 = await rpc(C.m5, 'classes_concluidas_anteriormente')
  ok('...e deixa de aparecer em classes_concluidas_anteriormente', !cod(l5.data, 'amigo'))
  const l6 = await rpc(C.dirA, 'classe_concluidas_do_membro', { p_usuario_id: ID.m5 })
  ok('a liderança ainda vê o registro revogado (histórico), com motivo, sem poder revogar de novo', cod(l6.data, 'amigo')?.status === 'revogada' && cod(l6.data, 'amigo')?.pode_revogar === false && cod(l6.data, 'amigo')?.revogada_motivo === 'Registro feito no membro errado', JSON.stringify(cod(l6.data, 'amigo')))
  await C.dirA.storage.from(BK).remove([P])
  ok('comprovante de conquista REVOGADA continua protegido (evidência não se apaga)', await existeNoStorage(P))
  const nov = await reg(C.dirA, 'm5', AMIGO, '2021-01-15', false, OBS)
  ok('depois de revogar dá para registrar de novo (índice ignora o revogado; histórico preservado)', nov.data?.ok === true, nov.erro)
  ok('...e agora são 2 linhas da classe (1 revogada, 1 ativa)', n(`select count(*) from public.curriculum_achievements where usuario_id = '${ID.m5}' and classe_id = '${AMIGO}';`) === 2)
  // append-only
  const alvoLog = `achievement_id = '${ach5}'`
  for (const [nomeOp, q] of [['UPDATE', `update public.class_prior_completion_log set motivo = 'x' where ${alvoLog};`], ['DELETE', `delete from public.class_prior_completion_log where ${alvoLog};`], ['TRUNCATE', 'truncate public.class_prior_completion_log;']]) {
    const t = sqlTenta(q)
    ok(`${nomeOp} no log (postgres) falha`, !t.ok, t.saida.slice(0, 100))
  }
  const sd = await servico.from('class_prior_completion_log').delete().eq('achievement_id', ach5)
  ok('DELETE pela API com service_role falha', !!sd.error, sd.error?.message || `status ${sd.status}`)
  const su = await servico.from('class_prior_completion_log').update({ motivo: 'x' }).eq('achievement_id', ach5)
  ok('UPDATE pela API com service_role falha', !!su.error, su.error?.message || `status ${su.status}`)
  for (const [nome, cli] of [['diretoria A', C.dirA], ['anon', anon]]) {
    const sl = await cli.from('class_prior_completion_log').select('*')
    ok(`${nome} NÃO lê o log pela API`, !!sl.error || (sl.data || []).length === 0, sl.error?.message || `${(sl.data || []).length} linhas`)
    const si = await cli.from('class_prior_completion_log').insert({ club_id: A, ator_papel: 'x', usuario_id: ID.m5, class_id: AMIGO, acao: 'registrar', motivo: 'forjado' })
    ok(`${nome} NÃO insere no log pela API`, !!si.error, si.error?.message)
  }
  ok('linhas do log continuam intactas', n(`select count(*) from public.class_prior_completion_log where ${alvoLog};`) === 2)
  const imut = sqlTenta(`update public.curriculum_achievements set observacao = 'trocada observacao' where id = '${r1.data?.achievement_id}';`)
  ok('registro_anterior é imutável (trocar observação no banco falha)', !imut.ok && /imutável/i.test(imut.saida), imut.saida.slice(0, 100))
  const imut2 = sqlTenta(`update public.curriculum_achievements set origem = 'conclusao_no_app', registrado_em = null, comprovante_path = null, data_desconhecida = false, registrado_por = null, registrado_papel = null, registrado_no_club_id = null where id = '${r1.data?.achievement_id}';`)
  ok('...nem trocar a origem', !imut2.ok, imut2.saida.slice(0, 100))
  const viaApi = await C.dirA.from('curriculum_achievements').update({ status: 'revogada' }).eq('id', r1.data?.achievement_id).select()
  ok('liderança NÃO revoga/edita a conquista direto pela API de tabela', !!viaApi.error || (viaApi.data || []).length === 0, viaApi.error?.message || `${(viaApi.data || []).length} linhas`)
  ok('...e a conquista segue ativa', sql(`select status from public.curriculum_achievements where id = '${r1.data?.achievement_id}';`) === 'ativa')

  // ======================================================================================================
  console.log('\n== B. COMPROVAÇÃO UNIVERSAL (relato) — m2 em Amigo ==')
  const R1 = reqSimples(AMIGO, 0); const R2 = reqSimples(AMIGO, 1); const R3 = reqFoto(AMIGO)
  if (!R1 || !R2 || !R3) throw new Error('requisitos de teste não encontrados na Amigo 2026.4')
  ok('m2 inicia Amigo', (await rpc(C.m2, 'classe_iniciar', { p_class_id: AMIGO })).data?.ok === true)
  const MR1 = mrId(ID.m2, R1)
  const salvar = (cli, req, texto) => rpc(cli, 'requisito_relato_salvar', { p_requirement_id: req, p_relato: texto })
  const T1 = 'Primeira versão do relato: fiz na reunião de sábado.'
  x = await salvar(C.m2, R1, T1)
  ok('salvar relato em requisito SEM evidência', x.data?.ok === true && x.data?.relato === T1, x.erro)
  ok('requisito vai a em_andamento', sql(`select status from public.member_requirements where id = '${MR1}';`) === 'em_andamento')
  ok('requisito_formulario devolve o rascunho do relato ao dono', (await rpc(C.m2, 'requisito_formulario', { p_requirement_id: R1 })).data?.relato === T1)
  x = await rpc(C.m2, 'requisito_enviar', { p_requirement_id: R1 })
  ok('enviar (relato vira a tentativa 1)', x.data?.ok === true && x.data?.tentativa_numero === 1, x.erro)
  ok('relato congelado na tentativa 1', sql(`select relato from public.requirement_submissions where member_requirement_id = '${MR1}' and tentativa_numero = 1;`) === T1)
  x = await salvar(C.m2, R1, 'mudei depois de enviar')
  ok('relato em requisito AGUARDANDO avaliação: recusado', !!x.erro && /já foi enviado/i.test(x.erro), x.erro)
  const fila = await rpc(C.instrA, 'classe_avaliacoes_pendentes')
  const itemF = (fila.data || []).find((i) => i.member_requirement_id === MR1)
  ok('instrutor vê o relato em classe_avaliacoes_pendentes', itemF?.relato === T1 && itemF?.tentativa_numero === 1, JSON.stringify(itemF)?.slice(0, 160))
  const fu = await rpc(C.instrA, 'fila_avaliacao_unificada', { p_tipo: null, p_unidade_id: null })
  const itemU = (fu.data || []).find((i) => i.item_id === MR1)
  ok('instrutor vê o relato em fila_avaliacao_unificada (524)', itemU?.relato === T1 && itemU?.tipo === 'classe', JSON.stringify(itemU)?.slice(0, 160))
  for (const [nome, cli] of [['diretoria do OUTRO clube', C.dirB]]) {
    const f1 = await rpc(cli, 'classe_avaliacoes_pendentes'); const f2 = await rpc(cli, 'fila_avaliacao_unificada', { p_tipo: null, p_unidade_id: null })
    ok(`${nome} não vê o item nas filas`, !(f1.data || []).some((i) => i.member_requirement_id === MR1) && !(f2.data || []).some((i) => i.item_id === MR1), f2.erro || '')
  }
  x = await rpc(C.desbA, 'fila_avaliacao_unificada', { p_tipo: null, p_unidade_id: null })
  ok('desbravador não acessa a fila unificada', !!x.erro, x.erro)
  x = await rpc(C.instrA, 'requisito_avaliar', { p_member_requirement_id: MR1, p_decisao: 'correcao_solicitada', p_comentario: 'Conte quem estava com você.', p_submission_id: itemF?.submission_id })
  ok('instrutor DEVOLVE com comentário', x.data?.ok === true, x.erro)
  const T2 = 'Segunda versão: estavam comigo o instrutor e dois colegas da unidade.'
  x = await salvar(C.m2, R1, T2)
  ok('membro salva novo relato após a devolução', x.data?.ok === true, x.erro)
  x = await rpc(C.m2, 'requisito_enviar', { p_requirement_id: R1 })
  ok('reenvia (tentativa 2)', x.data?.ok === true && x.data?.tentativa_numero === 2, x.erro)
  for (const [nome, cli] of [['membro dono', C.m2], ['instrutor', C.instrA]]) {
    const h = await rpc(cli, 'requisito_historico', { p_member_requirement_id: MR1 })
    const t = h.data?.tentativas || []
    ok(`histórico (${nome}): 2 tentativas, cada uma com o SEU relato; a 1 intacta, com decisão e comentário`,
      t.length === 2 && t[0].relato === T1 && t[1].relato === T2 && t[0].decisao === 'correcao_solicitada' && t[0].comentario === 'Conte quem estava com você.' && t[1].decisao === null, JSON.stringify(t.map((z) => [z.tentativa_numero, z.relato, z.decisao])))
  }
  const fu2 = (await rpc(C.instrA, 'fila_avaliacao_unificada', { p_tipo: null, p_unidade_id: null })).data?.find((i) => i.item_id === MR1)
  const fp2 = (await rpc(C.instrA, 'classe_avaliacoes_pendentes')).data?.find((i) => i.member_requirement_id === MR1)
  ok('as duas filas passam a mostrar o relato da tentativa 2', fu2?.relato === T2 && fp2?.relato === T2 && fp2?.tentativa_numero === 2)
  const upd = sqlTenta(`update public.requirement_submissions set relato = 'adulterado' where member_requirement_id = '${MR1}' and tentativa_numero = 1;`)
  ok('a tentativa enviada é imutável (alterar relato no banco falha)', !upd.ok, upd.saida.slice(0, 100))
  const ro = await C.m2.from('requirement_submissions').update({ relato: 'adulterado' }).eq('member_requirement_id', MR1).select()
  ok('membro NÃO altera relato congelado pela API de tabela', !!ro.error || (ro.data || []).length === 0, ro.error?.message)
  const ro2 = await C.m2.from('member_requirements').update({ relato: 'adulterado', status: 'aprovado' }).eq('id', MR1).select()
  ok('membro NÃO altera member_requirements (relato/status) direto pela API', !!ro2.error || (ro2.data || []).length === 0, ro2.error?.message)
  ok('...e a tentativa 1 segue com o texto original', sql(`select relato from public.requirement_submissions where member_requirement_id = '${MR1}' and tentativa_numero = 1;`) === T1)
  // isolamento
  console.log('   -- isolamento --')
  for (const [nome, cli] of [['diretoria de OUTRO clube (B)', C.dirB], ['diretoria B forjando header A', C.dirBhdrA], ['desbravador do mesmo clube sem liderança', C.desbA], ['anon', anon]]) {
    const h = await rpc(cli, 'requisito_historico', { p_member_requirement_id: MR1 })
    ok(`${nome}: NÃO lê o histórico/relato`, !!h.erro, h.erro)
  }
  for (const [nome, cli] of [['desbravador do clube B (sem a classe)', C.desbB], ['membro m2 forjando header B (não é membro)', C.m2hdrB], ['liderança do A', C.instrA], ['diretoria B', C.dirB]]) {
    const s = await salvar(cli, R1, 'invasor escrevendo no relato alheio')
    ok(`${nome}: NÃO escreve relato neste requisito`, !!s.erro, s.erro)
  }
  for (const [nome, cli] of [['diretoria B', C.dirB], ['desbravador A (colega)', C.desbA], ['anon', anon]]) {
    const s1 = await cli.from('requirement_submissions').select('id, relato').eq('member_requirement_id', MR1)
    const s2 = await cli.from('member_requirements').select('id, relato').eq('id', MR1)
    ok(`${nome}: tabelas (RLS) não devolvem o relato`, (s1.data || []).length === 0 && (s2.data || []).length === 0, `${(s1.data || []).length}/${(s2.data || []).length} ${s1.error?.message || ''}`)
  }
  const s1 = await C.m2.from('requirement_submissions').select('relato').eq('member_requirement_id', MR1)
  ok('controle: o próprio dono lê as 2 tentativas pela RLS', (s1.data || []).length === 2)
  // aprovar + relato em aprovado
  x = await rpc(C.instrA, 'requisito_avaliar', { p_member_requirement_id: MR1, p_decisao: 'aprovado', p_comentario: 'Ok', p_submission_id: fp2?.submission_id })
  ok('instrutor APROVA a tentativa 2', x.data?.ok === true, x.erro)
  x = await salvar(C.m2, R1, 'depois de aprovado')
  ok('relato em requisito APROVADO: recusado', !!x.erro && /já foi aprovado/i.test(x.erro), x.erro)
  ok('aprovação gravou a tentativa 2 no histórico', (await rpc(C.m2, 'requisito_historico', { p_member_requirement_id: MR1 })).data?.tentativas?.[1]?.decisao === 'aprovado')
  // limites
  console.log('   -- limites do relato --')
  x = await salvar(C.m2, R2, 'a'.repeat(2000))
  ok('relato de EXATAMENTE 2000 caracteres: aceito', x.data?.ok === true && x.data?.relato?.length === 2000, x.erro)
  x = await salvar(C.m2, R2, 'a'.repeat(2001))
  ok('relato de 2001 caracteres: recusado', !!x.erro && /2000/.test(x.erro), x.erro)
  x = await salvar(C.m2, R2, 'a'.repeat(30000))
  ok('relato gigante (30 mil): recusado sem erro cru', !!x.erro && /2000/.test(x.erro), x.erro)
  ok('...e o relato salvo continua o de 2000 (recusa não apagou)', sql(`select length(relato) from public.member_requirements where requirement_id = '${R2}' and usuario_id = '${ID.m2}';`) === '2000')
  x = await salvar(C.m2, R2, 'texto com controle \u0007 aqui')
  ok('caractere de controle: recusado', !!x.erro && /inválid/i.test(x.erro), x.erro)
  x = await salvar(C.m2, R2, '   \n  ')
  ok('só espaços = apagar o relato (null)', x.data?.ok === true && x.data?.relato === null, x.erro)
  x = await salvar(C.m2, R3, 'Tirei a foto mas esqueci de anexar')
  ok('relato em requisito que EXIGE foto: aceito (é complementar)', x.data?.ok === true, x.erro)
  x = await rpc(C.m2, 'requisito_enviar', { p_requirement_id: R3 })
  ok('...mas o envio continua exigindo a evidência (relato não substitui)', !!x.erro && /evidência/i.test(x.erro), x.erro)
  x = await salvar(C.m2, randomUUID(), 'x')
  ok('requisito inexistente/forjado: recusado', !!x.erro, x.erro)
  x = await salvar(anon, R1, 'x')
  ok('anon não salva relato', !!x.erro, x.erro)
  // autoavaliação
  console.log('   -- autoavaliação --')
  ok('selfD (diretoria) inicia Amigo', (await rpc(C.selfD, 'classe_iniciar', { p_class_id: AMIGO })).data?.ok === true)
  ok('selfD salva relato e envia o próprio requisito', (await salvar(C.selfD, R1, 'meu próprio relato')).data?.ok === true && (await rpc(C.selfD, 'requisito_enviar', { p_requirement_id: R1 })).data?.ok === true)
  const MRS = mrId(ID.selfD, R1)
  x = await rpc(C.selfD, 'requisito_avaliar', { p_member_requirement_id: MRS, p_decisao: 'aprovado', p_comentario: 'me aprovei' })
  ok('diretoria NÃO aprova o PRÓPRIO requisito', !!x.erro, x.erro)
  x = await rpc(C.selfD, 'requisito_avaliar', { p_member_requirement_id: MRS, p_decisao: 'correcao_solicitada', p_comentario: 'me devolvi' })
  ok('...nem devolve o próprio requisito', !!x.erro, x.erro)
  ok('...e o requisito segue aguardando, sem aprovação gravada', sql(`select status from public.member_requirements where id = '${MRS}';`) === 'aguardando_avaliacao' && n(`select count(*) from public.requirement_approvals where member_requirement_id = '${MRS}';`) === 0)
  x = await rpc(C.dirA, 'requisito_avaliar', { p_member_requirement_id: MRS, p_decisao: 'aprovado', p_comentario: 'ok, avaliado por outra pessoa' })
  ok('controle: OUTRA pessoa da liderança aprova', x.data?.ok === true, x.erro)
  x = await rpc(C.dirB, 'requisito_avaliar', { p_member_requirement_id: MR1, p_decisao: 'correcao_solicitada', p_comentario: 'invasor' })
  ok('diretoria de OUTRO clube não avalia', !!x.erro, x.erro)

  // ======================================================================================================
  console.log('\n== C. VERSÃO ARQUIVADA (523): m3 ==')
  sql(`select public._classe_matricular('${ID.m3}', '${A}', '${AMIGO3}');`)
  const mc3 = sql(`select id from public.member_classes where usuario_id = '${ID.m3}' and class_id = '${AMIGO3}';`)
  ok('preparo: matrícula direta na Amigo 2026.3 (arquivada), em andamento', sql(`select status from public.member_classes where id = '${mc3}';`) === 'em_andamento')
  x = await rpc(C.m3, 'classe_iniciar', { p_class_id: AMIGO })
  ok('m3 NÃO inicia a Amigo 2026.4 (versão anterior em andamento) — com mensagem clara', !!x.erro && /versão anterior/i.test(x.erro), x.erro)
  x = await rpc(C.dirA, 'classe_atribuir', { p_usuario_id: ID.m3, p_class_id: AMIGO })
  ok('diretoria NÃO atribui a 2026.4 a m3', !!x.erro && /versão anterior/i.test(x.erro), x.erro)
  d = await rpc(C.m3, 'classes_disponiveis')
  ok('classes_disponiveis não oferece a Amigo 2026.4 a m3', !cod(d.data, 'amigo'))
  ok('...e não existe 2ª matrícula de Amigo', n(`select count(*) from public.member_classes mc join public.classes c on c.id = mc.class_id where mc.usuario_id = '${ID.m3}' and c.codigo = 'amigo' and mc.status <> 'cancelada';`) === 1)
  // D (prévia) com a matrícula arquivada em andamento
  console.log('\n== D. PRÉVIA DE ATUALIZAÇÃO (522) ==')
  const snap = () => sql(`select md5(coalesce(string_agg(t, '|' order by t), '')) from (
      select mc::text as t from public.member_classes mc where usuario_id = '${ID.m3}'
      union all select mr::text from public.member_requirements mr where usuario_id = '${ID.m3}') z;`)
  const antes = snap()
  const pv = await rpc(C.m3, 'classe_atualizacao_previa', { p_member_class_id: mc3 })
  ok('prévia da matrícula arquivada: existe_atualizacao=true, somente_leitura, aponta a versão vigente', pv.data?.existe_atualizacao === true && pv.data?.somente_leitura === true && pv.data?.versao_vigente?.versao === '2026.4', pv.erro || JSON.stringify(pv.data)?.slice(0, 200))
  ok('prévia NÃO alterou nenhuma linha de matrícula/requisito', snap() === antes)
  const pvL = await rpc(C.instrA, 'classe_atualizacao_previa', { p_member_class_id: mc3 })
  ok('a liderança do clube também vê a prévia', pvL.data?.ok === true, pvL.erro)
  // cancelada libera
  x = await rpc(C.m3, 'classe_cancelar', { p_member_class_id: mc3 })
  ok('m3 cancela a matrícula da 2026.3', x.data?.ok === true, x.erro)
  x = await rpc(C.m3, 'classe_iniciar', { p_class_id: AMIGO })
  ok('com a matrícula CANCELADA, m3 inicia a Amigo 2026.4', x.data?.ok === true, x.erro)
  ok('a matrícula da 2026.3 segue cancelada (nada foi migrado nem apagado)', sql(`select status from public.member_classes where id = '${mc3}';`) === 'cancelada')
  // D vigente
  const mc2 = sql(`select id from public.member_classes where usuario_id = '${ID.m2}' and class_id = '${AMIGO}';`)
  const pv2 = await rpc(C.m2, 'classe_atualizacao_previa', { p_member_class_id: mc2 })
  ok('prévia de matrícula NA versão vigente: existe_atualizacao=false (ja_na_versao_vigente)', pv2.data?.existe_atualizacao === false && pv2.data?.motivo === 'ja_na_versao_vigente', pv2.erro || JSON.stringify(pv2.data)?.slice(0, 200))
  const pv2L = await rpc(C.instrA, 'classe_atualizacao_previa', { p_member_class_id: mc2 })
  ok('...a liderança vê o mesmo', pv2L.data?.existe_atualizacao === false, pv2L.erro)
  const forj = []
  for (const [nome, cli, id] of [['outro usuário do mesmo clube (desbA)', C.desbA, mc2], ['colega m3 (outro membro)', C.m3, mc2], ['diretoria de OUTRO clube', C.dirB, mc2], ['diretoria B forjando header A', C.dirBhdrA, mc2],
    ['m2 com header de clube onde não é membro', C.m2hdrB, mc2], ['UUID forjado', C.m2, randomUUID()], ['anon', anon, mc2]]) {
    const q = await rpc(cli, 'classe_atualizacao_previa', { p_member_class_id: id })
    ok(`prévia recusada: ${nome}`, !!q.erro, q.erro)
    forj.push(q.erro)
  }
  ok('outro clube e UUID forjado recebem a MESMA mensagem (sem oráculo de existência)', forj[2] === forj[5] && /não encontrada/i.test(forj[2] || ''), `${forj[2]} | ${forj[5]}`)
}

let saiu = 0
try {
  await principal()
} catch (e) {
  console.error('\nERRO no e2e:', e.stack || e.message)
  falhas.push('erro de execução: ' + e.message)
} finally {
  try { await limparStorage() } catch (e) { console.error('limpeza do Storage:', e.message) }
  try { limparBanco() } catch (e) { console.error('limpeza do banco:', e.message) }
  try {
    const resto = Number(sql(`select (select count(*) from public.organizational_units where slug like 'e2e-cla-%') + (select count(*) from auth.users where email like 'e2e-cla-%@teste.local')
      + (select count(*) from public.curriculum_achievements where club_id_origem in (md5('e2e-cla:clubeA')::uuid, md5('e2e-cla:clubeB')::uuid))
      + (select count(*) from public.class_prior_completion_log where club_id in (md5('e2e-cla:clubeA')::uuid, md5('e2e-cla:clubeB')::uuid))
      + (select count(*) from public.member_classes where club_id in (md5('e2e-cla:clubeA')::uuid, md5('e2e-cla:clubeB')::uuid));`))
    const objs = Number(sql(`select count(*) from storage.objects where bucket_id = 'comprovacoes' and (name like '${CLUBE_A}/%' or name like '${CLUBE_B}/%');`))
    total++
    if (resto !== 0 || objs !== 0) { falhas.push(`limpeza deixou resto: banco=${resto} storage=${objs}`); console.log(`   FALHOU limpeza: banco=${resto} storage=${objs}`) } else console.log('   ok     limpeza: nada do teste ficou no banco nem no Storage')
  } catch (e) { console.error('verificação da limpeza:', e.message) }
  console.log(`\n${total - falhas.length}/${total} ok` + (falhas.length ? `, ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}` : ' — TUDO OK'))
  saiu = falhas.length ? 1 : 0
}
process.exit(saiu)
