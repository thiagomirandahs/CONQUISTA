// E2E do ADMIN DA PLATAFORMA x FOTO da Comunidade (LOCAL, nunca produção): prova contra o Storage REAL
// (bucket privado 'comunidade', policy "quem pode ver le" -> _comunidade_pode_ver_foto, migration 515/D4) que:
//   1. o admin da plataforma NÃO abre foto de post 'clube', nem de Comunidade publicado sem denúncia/análise;
//   2. (migration 530) o admin NÃO lê o bucket direto; assina SOMENTE foto de Comunidade em análise/denunciado pela
//      RPC mediada admin_comunidade_foto_assinar (a mesma que a Edge Function admin-comunidade-foto chama com o JWT
//      do admin); cada ASSINATURA vira exatamente 1 linha em plataforma_acesso_log (append-only; UPDATE/DELETE/TRUNCATE
//      falham), com quem/o_que/item/bucket/contexto e SEM URL assinada/token/caminho; listar o bucket não registra nada;
//   3. o que o OUTRO clube realmente enxerga (antes e depois da aprovação);
//   4. usuário comum / desbravador / diretoria de outro clube não ganham acesso administrativo;
//   5. caminho forjado (../, outro clube, UUID inexistente, objeto de outro bucket) recusado;
//   6. saiu do contexto (aprovado/removido/resolvido) -> o admin perde o acesso (nada permanente);
//   7. anon nada; modo manutenção; log que falha => negado (fail-closed).
//
//   npm run test:rede:admin-foto:e2e     (precisa do Supabase local no ar COM a migration 530; usa só 127.0.0.1)
//   A assinatura final (Edge Function) é simulada aqui com a chave de serviço local sobre o caminho que a RPC autorizou
//   (a função em si só é empacotada em test:edge:bundle:pdf; o runtime de funções não é exercitado por este script).
//
// Dados de teste com prefixo "e2e-radm-"; limpa banco E objetos do Storage no fim (mesmo se falhar).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-radm-123'
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
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
// como sql(), mas devolve { ok, saida } em vez de lançar (para provar que UPDATE/DELETE/TRUNCATE FALHAM)
function sqlTenta(texto) {
  try { return { ok: true, saida: sql(texto) } } catch (e) { return { ok: false, saida: String(e.stderr || e.message) } }
}
const uid = (k) => sql(`select md5('e2e-radm:${k}')::uuid;`)

const CHAVES = ['dirA', 'dirA2', 'instrA', 'desbA', 'dirB', 'desbB', 'instrB', 'comum', 'adm']
function preparar() {
  limparBanco()
  sql(`
    set session_replication_role = replica;
    insert into public.organizational_units (type, nome, slug, pais, timezone, metadata) values
      ('clube', 'E2E Radm Clube A', 'e2e-radm-clube-a', 'BR', 'America/Recife', '{"test_only":true}'),
      ('clube', 'E2E Radm Clube B', 'e2e-radm-clube-b', 'BR', 'America/Recife', '{"test_only":true}');
    insert into public.club_features (club_id, feature, enabled)
    select id, 'comunidade', true from public.organizational_units where slug in ('e2e-radm-clube-a', 'e2e-radm-clube-b');
    create temp table e2e_p (k text, papel text, clube text);
    insert into e2e_p values ('dirA','diretoria','e2e-radm-clube-a'), ('dirA2','diretoria','e2e-radm-clube-a'),
      ('instrA','instrutor','e2e-radm-clube-a'), ('desbA','desbravador','e2e-radm-clube-a'),
      ('dirB','diretoria','e2e-radm-clube-b'), ('instrB','instrutor','e2e-radm-clube-b'), ('desbB','desbravador','e2e-radm-clube-b');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', md5('e2e-radm:' || k)::uuid, 'authenticated', 'authenticated', 'e2e-radm-' || lower(k) || '@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false
      from (select unnest(array['dirA','dirA2','instrA','desbA','dirB','desbB','instrB','comum','adm']) as k) t;
    insert into public.profiles (id, nome, papel, status, created_at)
    select md5('e2e-radm:' || k)::uuid, 'E2E Radm ' || k, 'desbravador', 'ativo', now() - interval '60 days'
      from (select unnest(array['dirA','dirA2','instrA','desbA','dirB','desbB','instrB','comum','adm']) as k) t;
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select md5('e2e-radm:' || p.k)::uuid, (select id from public.organizational_units where slug = p.clube), p.papel, 'ativo' from e2e_p p;
    -- o admin da plataforma mora em platform_admins, NUNCA em organization_memberships
    insert into public.platform_admins (user_id, papel, ativo, motivo) values (md5('e2e-radm:adm')::uuid, 'suporte', true, 'e2e-radm');
  `)
}
function limparBanco() {
  sql(`
    set session_replication_role = replica;
    create temp table e2e_u as select id from public.organizational_units where slug like 'e2e-radm-%';
    create temp table e2e_us as select id from auth.users where email like 'e2e-radm-%@teste.local';
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
  const { error } = await c.auth.signInWithPassword({ email: `e2e-radm-${k.toLowerCase()}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${k}: ${error.message}`)
  return c
}
const rpc = async (c, nome, args) => { const { data, error } = await c.rpc(nome, args); return { data, erro: error?.message || null } }

// tenta ABRIR o arquivo de todas as formas que o app/atacante tem: assinar (individual e lote), URL assinada, download autenticado
async function acessa(c, caminho, bucket = 'comunidade') {
  const b = c.storage.from(bucket)
  const a = await b.createSignedUrl(caminho, 120)
  const lote = await b.createSignedUrls([caminho], 120)
  const dl = await b.download(caminho)
  let status = null
  let urlAssinada = a.data?.signedUrl || null
  if (urlAssinada) { try { status = (await fetch(urlAssinada)).status } catch { status = -1 } }
  return {
    assina: !!urlAssinada && status === 200,
    assinou: !!urlAssinada,
    lote: !!(lote.data || [])[0]?.signedUrl,
    baixa: !!dl.data && !dl.error,
    status, urlAssinada,
    resumo: `assina=${!!urlAssinada}/${status} lote=${!!(lote.data || [])[0]?.signedUrl} baixa=${!!dl.data} (${a.error?.message || dl.error?.message || ''})`,
  }
}
const abriu = (r) => r.assina && r.lote && r.baixa
const fechado = (r) => !r.assinou && !r.lote && !r.baixa

const logLinhas = (admId, postId) => Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id = '${admId}' and o_que = 'foto_assinada' and item_id = '${postId}';`))
// o caminho do admin (530): RPC mediada (confere contexto + 1 log) e, só então, a URL assinada com a chave de serviço (papel da Edge Function)
async function assinaMediado(cli, servico, tipo, id) {
  const r = await cli.rpc('admin_comunidade_foto_assinar', { p_tipo: tipo, p_id: id })
  if (r.error || !r.data?.ok) return { ok: false, erro: r.error?.message || 'sem retorno', abre: false }
  const a = await servico.storage.from(r.data.bucket).createSignedUrl(r.data.path, 60)
  let status = null
  if (a.data?.signedUrl) { try { status = (await fetch(a.data.signedUrl)).status } catch { status = -1 } }
  return { ok: true, path: r.data.path, contexto: r.data.contexto, url: a.data?.signedUrl || null, abre: status === 200 }
}
const negado = (r) => !r.ok && /não encontrado|Sem permiss/i.test(r.erro || '')
const criadosStorage = []

async function principal() {
  preparar()
  const ID = Object.fromEntries(CHAVES.map((k) => [k, uid(k)]))
  const clubeA = sql(`select id from public.organizational_units where slug = 'e2e-radm-clube-a';`)
  const clubeB = sql(`select id from public.organizational_units where slug = 'e2e-radm-clube-b';`)
  const c = {
    dirA: await entrar('dirA', clubeA), dirA2: await entrar('dirA2', clubeA), instrA: await entrar('instrA', clubeA), desbA: await entrar('desbA', clubeA),
    dirB: await entrar('dirB', clubeB), desbB: await entrar('desbB', clubeB), instrB: await entrar('instrB', clubeB),
    comum: await entrar('comum', null),
    adm: await entrar('adm', null),
    admComHeaderA: await entrar('adm', clubeA),   // admin mandando x-clube-atual de um clube onde NÃO é membro
  }
  const anon = createClient(URL_API, ANON, semSessao)
  const servico = createClient(URL_API, SERVICE, semSessao)

  console.log('\n== preparo: posts reais (upload no Storage + rede_publicar) ==')
  async function postar(quem, clube, alcance, rotulo) {
    const caminho = `${clube}/${ID[quem]}/${randomUUID()}.jpg`
    const up = await c[quem].storage.from('comunidade').upload(caminho, JPG, { contentType: 'image/jpeg' })
    if (up.error) throw new Error(`upload ${rotulo}: ${up.error.message}`)
    criadosStorage.push(caminho)
    const r = await rpc(c[quem], 'rede_publicar', { p_tipo: alcance === 'comunidade' ? 'foto_clube' : 'foto', p_legenda: `e2e ${rotulo}`, p_foto_path: caminho, p_foto_alt: 'foto e2e', p_alcance: alcance })
    if (!r.data?.id) throw new Error(`publicar ${rotulo}: ${JSON.stringify(r)}`)
    return { id: r.data.id, caminho, status: r.data.status, quem, clube }
  }
  const P = {
    clube: await postar('dirA', clubeA, 'clube', 'clube'),
    analise: await postar('dirA', clubeA, 'comunidade', 'analise'),
    pub: await postar('instrA', clubeA, 'comunidade', 'pub'),
    den: await postar('instrA', clubeA, 'comunidade', 'den'),
    fim: await postar('dirA2', clubeA, 'comunidade', 'fim'),
    clubeDen: await postar('dirA2', clubeA, 'clube', 'clubeDen'),
    manut: await postar('dirB', clubeB, 'comunidade', 'manut'),
    falha: await postar('dirB', clubeB, 'comunidade', 'falha'),
  }
  ok('post alcance clube com foto: publicado direto', P.clube.status === 'publicado', P.clube.status)
  for (const k of ['analise', 'pub', 'den', 'fim', 'manut', 'falha']) ok(`post Comunidade com foto "${k}": entra EM ANÁLISE`, P[k].status === 'em_analise', P[k].status)
  const aprova = async (p) => rpc(c.dirA, 'comunidade_moderar', { p_tipo: 'post', p_id: p.id, p_acao: 'aprovar_foto' })
  ok('diretoria A aprova a foto "pub"', (await aprova(P.pub)).data?.status === 'publicado')
  ok('diretoria A aprova a foto "den"', (await aprova(P.den)).data?.status === 'publicado')
  const den = await rpc(c.dirB, 'comunidade_denunciar', { p_tipo: 'post', p_id: P.den.id, p_motivo: 'imagem' })
  ok('dirB (outro clube) denuncia o post "den" da Comunidade', den.data?.ok === true, JSON.stringify(den))
  const denClube = await rpc(c.instrA, 'comunidade_denunciar', { p_tipo: 'post', p_id: P.clubeDen.id, p_motivo: 'imagem' })
  ok('colega do clube A denuncia o post "clubeDen" (alcance clube)', denClube.data?.ok === true, JSON.stringify(denClube))
  const st = (p) => sql(`select status from public.comunidade_posts where id = '${p.id}';`)
  info(`status: clube=${st(P.clube)} analise=${st(P.analise)} pub=${st(P.pub)} den=${st(P.den)} fim=${st(P.fim)} clubeDen=${st(P.clubeDen)}`)

  console.log('\n== 0. o log começa vazio para este admin e ninguém que não seja admin aparece nele ==')
  ok('plataforma_acesso_log sem linhas deste admin no início', Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id = '${ID.adm}';`)) === 0)

  console.log('\n== 1. admin NÃO abre foto de post "clube" nem de Comunidade publicada sem denúncia ("navegar livremente") ==')
  for (const [nome, p] of [['post clube (publicado)', P.clube], ['post clube DENUNCIADO', P.clubeDen], ['Comunidade publicada sem denúncia (pub)', P.pub]]) {
    const r = await acessa(c.adm, p.caminho)
    ok(`admin: ${nome} -> assinar/lote/baixar FECHADOS`, fechado(r), r.resumo)
  }
  const rHdr = await acessa(c.admComHeaderA, P.clube.caminho)
  ok('admin forjando x-clube-atual do clube A (sem ser membro): post clube continua FECHADO', fechado(rHdr), rHdr.resumo)
  const rHdr2 = await acessa(c.admComHeaderA, P.pub.caminho)
  ok('...e a Comunidade publicada sem denúncia também', fechado(rHdr2), rHdr2.resumo)
  const modA = await rpc(c.adm, 'admin_comunidade_moderar', { p_tipo: 'post', p_id: P.clubeDen.id, p_acao: 'remover' })
  ok('admin NÃO modera post denunciado de alcance clube ("Conteúdo não encontrado")', !!modA.erro && /não encontrado/i.test(modA.erro), modA.erro)
  const modB = await rpc(c.adm, 'admin_comunidade_moderar', { p_tipo: 'post', p_id: P.pub.id, p_acao: 'remover' })
  ok('admin NÃO modera Comunidade publicada sem denúncia', !!modB.erro && /não encontrado/i.test(modB.erro), modB.erro)
  for (const [nome, p] of [['post clube (publicado)', P.clube], ['post clube DENUNCIADO', P.clubeDen], ['Comunidade publicada sem denúncia (pub)', P.pub]]) {
    const rm = await assinaMediado(c.adm, servico, 'post', p.id)
    ok(`admin: RPC mediada também NEGA ${nome}`, negado(rm), rm.erro)
  }
  ok('...nada disso gerou linha em plataforma_acesso_log (acesso negado não é acesso)',
    Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id = '${ID.adm}';`)) === 0)

  console.log('\n== 2. admin assina SÓ o que está em análise/denunciado na Comunidade (RPC mediada), 1 log por assinatura ==')
  const rAn = await acessa(c.adm, P.analise.caminho)
  ok('admin: Comunidade EM ANÁLISE -> leitura DIRETA no Storage fechada (assinar/lote/baixar)', fechado(rAn), rAn.resumo)
  ok('log: nenhuma linha por tentar ler direto (nada foi assinado pela RPC ainda)', logLinhas(ID.adm, P.analise.id) === 0)
  const m1 = await assinaMediado(c.adm, servico, 'post', P.analise.id)
  ok('admin: RPC mediada autoriza (contexto em_analise) e a URL assinada abre (200)', m1.ok && m1.contexto === 'em_analise' && m1.abre && m1.path === P.analise.caminho, JSON.stringify({ ...m1, url: undefined }))
  ok('log: 1 linha (foto_assinada/post/analise)', logLinhas(ID.adm, P.analise.id) === 1, String(logLinhas(ID.adm, P.analise.id)))
  const m1b = await assinaMediado(c.adm, servico, 'post', P.analise.id)
  ok('2ª assinatura do mesmo item = 2ª linha (1 por assinatura, sem dedupe)', m1b.ok && logLinhas(ID.adm, P.analise.id) === 2, String(logLinhas(ID.adm, P.analise.id)))
  const urlAdm = m1.url || ''
  const linha = JSON.parse(sql(`select coalesce(json_agg(l order by quando), '[]') from (select * from public.plataforma_acesso_log where admin_user_id = '${ID.adm}' and item_id = '${P.analise.id}') l;`))[0] || {}
  ok('log identifica quem (admin), o_que=foto_assinada, item_tipo=post, item_id, clube de origem, bucket, contexto e quando',
    linha.admin_user_id === ID.adm && linha.o_que === 'foto_assinada' && linha.item_tipo === 'post' && linha.item_id === P.analise.id && linha.item_club_id === clubeA
      && linha.bucket === 'comunidade' && linha.contexto === 'em_analise' && !!linha.quando, JSON.stringify(linha))
  ok('log tem só as colunas previstas (sem campo para URL/token/caminho)', Object.keys(linha).sort().join(',') === 'admin_user_id,bucket,contexto,id,item_club_id,item_id,item_tipo,o_que,quando', Object.keys(linha).join(','))
  const tokenDaUrl = (urlAdm.match(/token=([^&]+)/) || [])[1] || '@@'
  const logTudo = sql(`select coalesce(string_agg(l::text, ' '), '') from public.plataforma_acesso_log l where admin_user_id = '${ID.adm}';`)
  ok('log NÃO contém URL assinada, token, JWT nem o caminho do arquivo',
    !logTudo.includes(tokenDaUrl) && !/eyJ[A-Za-z0-9_-]{10,}/.test(logTudo) && !logTudo.includes('object/sign') && !logTudo.includes(P.analise.caminho), logTudo.slice(0, 200))
  const mFim = await assinaMediado(c.adm, servico, 'post', P.fim.id)
  ok('admin: outra foto EM ANÁLISE (fim) também assina', mFim.ok && mFim.abre, JSON.stringify({ ...mFim, url: undefined }))
  const mDen = await assinaMediado(c.adm, servico, 'post', P.den.id)
  const stDen = st(P.den)
  ok(`admin: Comunidade DENUNCIADA (den, status=${stDen}) assina`, mDen.ok && mDen.abre, JSON.stringify({ ...mDen, url: undefined }))
  ok('log: linhas para fim e den (itens distintos), 1 cada', logLinhas(ID.adm, P.fim.id) === 1 && logLinhas(ID.adm, P.den.id) === 1)
  const porQuem = sql(`select count(*) from public.plataforma_acesso_log where admin_user_id <> '${ID.adm}' and item_club_id in ('${clubeA}', '${clubeB}');`)
  ok('nenhum não-admin aparece no log até aqui', Number(porQuem) === 0, porQuem)

  console.log('\n== 2b. log é APPEND-ONLY ==')
  const up = sqlTenta(`update public.plataforma_acesso_log set o_que = 'x' where admin_user_id = '${ID.adm}';`)
  ok('UPDATE no log falha (postgres)', !up.ok && /não se altera/i.test(up.saida), up.saida.slice(0, 120))
  const del = sqlTenta(`delete from public.plataforma_acesso_log where admin_user_id = '${ID.adm}';`)
  ok('DELETE no log falha (postgres)', !del.ok && /não se altera/i.test(del.saida), del.saida.slice(0, 120))
  const trunc = sqlTenta(`truncate public.plataforma_acesso_log;`)
  ok('TRUNCATE no log falha (postgres)', !trunc.ok && /não se altera/i.test(trunc.saida), trunc.saida.slice(0, 120))
  const delSvc = await servico.from('plataforma_acesso_log').delete().eq('admin_user_id', ID.adm)
  ok('DELETE pela API com service_role falha', !!delSvc.error, delSvc.error?.message || `status ${delSvc.status}`)
  const updSvc = await servico.from('plataforma_acesso_log').update({ o_que: 'x' }).eq('admin_user_id', ID.adm)
  ok('UPDATE pela API com service_role falha', !!updSvc.error, updSvc.error?.message || `status ${updSvc.status}`)
  for (const [n, cli] of [['admin da plataforma', c.adm], ['diretoria A', c.dirA], ['anon', anon]]) {
    const r = await cli.from('plataforma_acesso_log').select('*')
    ok(`${n} NÃO lê plataforma_acesso_log pela API (sem grant)`, !!r.error || (r.data || []).length === 0, r.error?.message || `${(r.data || []).length} linhas`)
    const ins = await cli.from('plataforma_acesso_log').insert({ admin_user_id: ID.adm, o_que: 'forjado' })
    ok(`${n} NÃO insere no log pela API`, !!ins.error, ins.error?.message)
  }
  ok('linhas do admin continuam intactas após as tentativas', logLinhas(ID.adm, P.analise.id) === 2)

  console.log('\n== 3. OUTRO clube (B): o que a regra do feed realmente dá ==')
  for (const [n, cli] of [['dirB (diretoria B)', c.dirB], ['desbB (desbravador B)', c.desbB]]) {
    let r = await acessa(cli, P.clube.caminho)
    ok(`${n}: post "clube" do A -> FECHADO`, fechado(r), r.resumo)
    r = await acessa(cli, P.analise.caminho)
    ok(`${n}: Comunidade EM ANÁLISE do A (antes da aprovação) -> FECHADO`, fechado(r), r.resumo)
    r = await acessa(cli, P.fim.caminho)
    ok(`${n}: outra em análise (fim) -> FECHADO`, fechado(r), r.resumo)
    r = await acessa(cli, P.clubeDen.caminho)
    ok(`${n}: post "clube" denunciado do A -> FECHADO`, fechado(r), r.resumo)
  }
  let rPubB = await acessa(c.dirB, P.pub.caminho)
  ok('REGRA REAL: Comunidade PUBLICADA (aprovada) do A abre para dirB (qualquer participante da Rede)', abriu(rPubB), rPubB.resumo)
  rPubB = await acessa(c.desbB, P.pub.caminho)
  ok('REGRA REAL: ...e para desbravador B autorizado (vê o item; o autor é adulto)', abriu(rPubB), rPubB.resumo)
  const rPubA = await acessa(c.desbA, P.clube.caminho)
  ok('controle: desbravador do MESMO clube A abre o post "clube" (a policy não quebrou o uso normal)', abriu(rPubA), rPubA.resumo)
  const rDenB = await acessa(c.dirB, P.den.caminho)
  info(`dirB com post "den" (status ${stDen}) -> ${abriu(rDenB) ? 'abre (continua publicado com denúncia pendente)' : 'fechado (oculto por denúncia)'}`)
  ok('...e se estiver oculto por denúncia, fica fechado para B (coerente com o status)', stDen === 'publicado' ? abriu(rDenB) : fechado(rDenB), `${stDen} ${rDenB.resumo}`)
  ok('o log não ganhou linha por leitura de membro/diretoria (só admin da plataforma registra)',
    Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id <> '${ID.adm}' and item_club_id in ('${clubeA}', '${clubeB}');`)) === 0)

  console.log('\n== 4. sem acesso administrativo: usuário comum, desbravador, diretoria de outro clube ==')
  for (const [n, cli] of [['usuário comum (sem vínculo)', c.comum], ['desbravador B', c.desbB], ['diretoria B', c.dirB], ['diretoria A', c.dirA], ['instrutor A', c.instrA]]) {
    const pn = await rpc(cli, 'admin_comunidade_painel')
    ok(`${n}: admin_comunidade_painel negado`, !!pn.erro && /permiss/i.test(pn.erro), pn.erro)
    const fo = await rpc(cli, 'admin_comunidade_foto_assinar', { p_tipo: 'post', p_id: P.analise.id })
    ok(`${n}: admin_comunidade_foto_assinar negado`, !!fo.erro && /permiss/i.test(fo.erro), fo.erro)
    const md = await rpc(cli, 'admin_comunidade_moderar', { p_tipo: 'post', p_id: P.analise.id, p_acao: 'remover' })
    ok(`${n}: admin_comunidade_moderar negado`, !!md.erro && /permiss/i.test(md.erro), md.erro)
  }
  for (const [n, cli] of [['usuário comum', c.comum], ['desbravador B', c.desbB], ['diretoria B', c.dirB]]) {
    const r1 = await acessa(cli, P.analise.caminho)
    const r2 = await acessa(cli, P.fim.caminho)
    ok(`${n}: fotos em análise do A fechadas`, fechado(r1) && fechado(r2), r1.resumo + ' | ' + r2.resumo)
  }
  const rA = await acessa(c.comum, P.pub.caminho)
  ok('usuário comum (sem vínculo/sem x-clube-atual) não abre nem a Comunidade publicada', fechado(rA), rA.resumo)
  ok('ninguém que não é admin consegue alterar platform_admins',
    !!(await c.comum.from('platform_admins').insert({ user_id: ID.comum, papel: 'owner' })).error)
  const pa = await c.comum.from('platform_admins').select('*')
  ok('usuário comum não lê platform_admins', (pa.data || []).length === 0, pa.error?.message)

  console.log('\n== 5. caminho/URL forjado ==')
  const nomeArq = P.analise.caminho.split('/').pop()
  const outroArq = P.clube.caminho.split('/').pop()
  const forjados = {
    'com ../ (sai da pasta do autor e cai no post clube)': `${clubeA}/${ID.dirA}/../${ID.dirA}/${outroArq}`,
    '../ para pasta de outro clube': `${clubeB}/${ID.dirB}/../../${clubeA}/${ID.dirA}/${outroArq}`,
    'traversal codificado (%2e%2e)': `${clubeA}/${ID.dirA}/%2e%2e/${ID.dirA}/${outroArq}`,
    'barra no início': `/${P.clube.caminho}`,
    'UUID inexistente na pasta do autor': `${clubeA}/${ID.dirA}/${randomUUID()}.jpg`,
    'clube inexistente': `${randomUUID()}/${ID.dirA}/${nomeArq}`,
    'pasta do admin (owner fallback) com arquivo que não existe': `${clubeA}/${ID.adm}/${randomUUID()}.jpg`,
    'extensão trocada (.png) do mesmo arquivo': P.clube.caminho.replace(/\.jpg$/, '.png'),
  }
  for (const [nome, caminho] of Object.entries(forjados)) {
    const r = await acessa(c.adm, caminho)
    ok(`admin: caminho forjado "${nome}" recusado`, !r.assina && !r.baixa, r.resumo)
    const r2 = await acessa(c.dirB, caminho)
    ok(`dirB: caminho forjado "${nome}" recusado`, !r2.assina && !r2.baixa, r2.resumo)
  }
  const rCruz = await acessa(c.desbA, P.manut.caminho)
  ok('desbravador do A com o caminho REAL de um post do clube B (Comunidade em análise) -> FECHADO', fechado(rCruz), rCruz.resumo)
  // objeto de OUTRO bucket com o mesmo nome: o admin não pode usar a policy do 'comunidade' em 'imagens'
  const up2 = await servico.storage.from('imagens').upload(P.analise.caminho, PNG, { contentType: 'image/png', upsert: true })
  if (!up2.error) criadosStorage.push(['imagens', P.analise.caminho])
  ok('preparo: arquivo de mesmo nome no bucket "imagens"', !up2.error, up2.error?.message)
  const rImg = await acessa(c.adm, P.analise.caminho, 'imagens')
  ok('admin assinando esse nome no bucket "imagens" (em vez de "comunidade"): FECHADO', fechado(rImg), rImg.resumo)
  const rImgB = await acessa(c.dirB, P.analise.caminho, 'imagens')
  ok('dirB idem: FECHADO', fechado(rImgB), rImgB.resumo)
  const rBuck = await acessa(c.adm, P.analise.caminho, 'inexistente')
  ok('bucket inexistente: recusado', !rBuck.assina && !rBuck.baixa, rBuck.resumo)
  // upload/remoção forçados pelo admin
  const upAdm = await c.adm.storage.from('comunidade').upload(`${clubeA}/${ID.adm}/${randomUUID()}.jpg`, JPG, { contentType: 'image/jpeg' })
  ok('admin NÃO sobe arquivo no bucket da Comunidade (não é membro)', !!upAdm.error, upAdm.error?.message)
  const rmAdm = await c.adm.storage.from('comunidade').remove([P.analise.caminho])
  ok('admin NÃO apaga a foto pela API do Storage', (rmAdm.data || []).length === 0 || !!rmAdm.error, JSON.stringify(rmAdm.data) + (rmAdm.error?.message || ''))
  const aindaLa = await servico.storage.from('comunidade').download(P.analise.caminho)
  ok('...e o arquivo continua no Storage', !!aindaLa.data)

  console.log('\n== 6. SAIU DO CONTEXTO: o admin perde o acesso (nada permanente) ==')
  // 6a. aprovado
  const pre = await assinaMediado(c.adm, servico, 'post', P.analise.id)   // URL emitida enquanto ainda estava em análise
  const apr = await aprova(P.analise)
  ok('diretoria A aprova a foto "analise"', apr.data?.status === 'publicado', JSON.stringify(apr))
  let r = await acessa(c.adm, P.analise.caminho)
  ok('6a. APROVADO (publicado, sem denúncia): admin perde o acesso (Storage direto fechado)', fechado(r), r.resumo)
  const m6a = await assinaMediado(c.adm, servico, 'post', P.analise.id)
  ok('6a. ...e a RPC mediada passa a NEGAR (saiu do contexto)', negado(m6a), m6a.erro)
  r = await acessa(c.dirB, P.analise.caminho)
  ok('6a. ...e o outro clube (B) GANHA acesso só porque agora é Comunidade publicada (regra do feed)', abriu(r), r.resumo)
  const preAbre = pre.url ? (await fetch(pre.url)).status : 0
  info(`URL assinada emitida ANTES da aprovação ${preAbre === 200 ? 'ainda abre' : 'não abre mais'} (status ${preAbre}) — validade curta do token (60 s)`)
  // 6b. removido pelo próprio admin (gera log de moderação)
  const preFim = await assinaMediado(c.adm, servico, 'post', P.fim.id)
  const rem = await rpc(c.adm, 'admin_comunidade_moderar', { p_tipo: 'post', p_id: P.fim.id, p_acao: 'remover', p_motivo: 'e2e' })
  ok('6b. admin remove o item em análise (contexto de moderação)', rem.data?.status === 'removido', JSON.stringify(rem))
  ok('...gera linha moderar_remover em plataforma_acesso_log',
    Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id = '${ID.adm}' and o_que = 'moderar_remover' and item_id = '${P.fim.id}' and item_tipo = 'post';`)) === 1)
  ok('...e em platform_admin_audit (comunidade_moderar)',
    Number(sql(`select count(*) from public.platform_admin_audit where admin_user_id = '${ID.adm}' and acao = 'comunidade_moderar' and alvo_id = '${P.fim.id}';`)) === 1)
  r = await acessa(c.adm, P.fim.caminho)
  ok('6b. REMOVIDO: admin perde o acesso à foto', fechado(r), r.resumo)
  const m6b = await assinaMediado(c.adm, servico, 'post', P.fim.id)
  ok('6b. ...a RPC mediada também NEGA o removido', negado(m6b), m6b.erro)
  r = await acessa(c.dirB, P.fim.caminho)
  ok('6b. REMOVIDO: outro clube também sem acesso', fechado(r), r.resumo)
  const remDeNovo = await rpc(c.adm, 'admin_comunidade_moderar', { p_tipo: 'post', p_id: P.fim.id, p_acao: 'restaurar' })
  ok('6b. admin não consegue "restaurar" o que saiu do contexto', !!remDeNovo.erro, remDeNovo.erro)
  const preFimStatus = preFim.url ? (await fetch(preFim.url)).status : 0
  info(`URL assinada emitida antes da remoção ${preFimStatus === 200 ? 'ainda abre' : 'não abre mais'} (status ${preFimStatus})`)
  // 6c. denúncia resolvida (restaurar) / oculto
  if (st(P.den) === 'publicado') {
    const oc = await rpc(c.dirA, 'comunidade_moderar', { p_tipo: 'post', p_id: P.den.id, p_acao: 'ocultar' })
    ok('6c. diretoria A oculta o denunciado', oc.data?.status === 'oculto_denuncia', JSON.stringify(oc))
  }
  const m6c = await assinaMediado(c.adm, servico, 'post', P.den.id)
  ok('6c. OCULTO por denúncia pendente: admin ainda assina (continua no contexto)', m6c.ok && m6c.abre, JSON.stringify({ ...m6c, url: undefined }))
  r = await acessa(c.dirB, P.den.caminho)
  ok('6c. ...e o outro clube NÃO abre item oculto', fechado(r), r.resumo)
  const rest = await rpc(c.dirA, 'comunidade_moderar', { p_tipo: 'post', p_id: P.den.id, p_acao: 'restaurar' })
  ok('6c. diretoria A restaura (denúncia improcedente = resolvida)', rest.data?.status === 'publicado', JSON.stringify(rest))
  const m6c2 = await assinaMediado(c.adm, servico, 'post', P.den.id)
  ok('6c. DENÚNCIA RESOLVIDA: admin perde o acesso (RPC mediada nega)', negado(m6c2), m6c2.erro)
  const ctxRestante = Number(sql(`select count(*) from public.comunidade_posts p where p.id in ('${P.analise.id}','${P.fim.id}','${P.den.id}') and p.status in ('em_analise','oculto_denuncia');`))
  ok('nenhum dos 3 itens segue em análise/oculto', ctxRestante === 0, String(ctxRestante))
  // nova denúncia (de outro denunciante) traz o item de volta ao contexto: acesso é por estado, não por histórico
  const denDeNovo = await rpc(c.desbB, 'comunidade_denunciar', { p_tipo: 'post', p_id: P.den.id, p_motivo: 'outro' })
  ok('6d. nova denúncia pendente', denDeNovo.data?.ok === true, JSON.stringify(denDeNovo))
  const m6d = await assinaMediado(c.adm, servico, 'post', P.den.id)
  ok('6d. o acesso do admin volta ENQUANTO houver denúncia pendente (segue o estado atual, não o histórico)', m6d.ok && m6d.abre, JSON.stringify({ ...m6d, url: undefined }))

  console.log('\n== 7. anon ==')
  for (const [n, p] of [['em análise', P.fim], ['publicada', P.pub], ['clube', P.clube]]) {
    const ra = await acessa(anon, p.caminho)
    ok(`anon: foto ${n} fechada (assinar/lote/baixar)`, fechado(ra), ra.resumo)
    const pub = await fetch(`${URL_API}/storage/v1/object/public/comunidade/${p.caminho}`)
    ok(`anon: URL pública do bucket privado (${n}) não abre (${pub.status})`, pub.status >= 400)
  }
  const anonList = await anon.storage.from('comunidade').list(`${clubeA}/${ID.dirA}`)
  ok('anon: list() vazio', (anonList.data || []).length === 0, JSON.stringify(anonList.error?.message))
  const anonFoto = await rpc(anon, 'admin_comunidade_foto_assinar', { p_tipo: 'post', p_id: P.fim.id })
  ok('anon: admin_comunidade_foto_assinar negado', !!anonFoto.erro, anonFoto.erro)
  const anonRpc = await rpc(anon, 'admin_comunidade_painel')
  ok('anon: admin_comunidade_painel negado', !!anonRpc.erro)

  console.log('\n== 8. MODO MANUTENÇÃO e LOG QUE FALHA (fail-closed) ==')
  const manutAntes = sql(`select ativo from public.plataforma_manutencao where id = 1;`)
  try {
    sql(`update public.plataforma_manutencao set ativo = true where id = 1;`)
    const rm = await assinaMediado(c.adm, servico, 'post', P.manut.id)
    ok('manutenção ON: admin (isento da guarda) ainda assina item em análise da Comunidade', rm.ok && rm.abre, JSON.stringify({ ...rm, url: undefined }))
    ok('manutenção ON: ...e a assinatura foi registrada (a guarda não bloqueou o INSERT do admin)', logLinhas(ID.adm, P.manut.id) === 1, String(logLinhas(ID.adm, P.manut.id)))
    const rmd = await acessa(c.dirB, P.manut.caminho)
    ok('manutenção ON: autor (dirB) continua abrindo a própria foto (leitura)', abriu(rmd), rmd.resumo)
    const rmb = await acessa(c.desbA, P.pub.caminho)
    ok('manutenção ON: desbravador A continua lendo Comunidade publicada (manutenção só bloqueia escrita)', abriu(rmb), rmb.resumo)
    const rmn = await acessa(c.dirA, P.manut.caminho)
    ok('manutenção ON: não-admin sem permissão continua fechado', fechado(rmn), rmn.resumo)
  } finally {
    sql(`update public.plataforma_manutencao set ativo = ${manutAntes === 't' ? 'true' : 'false'} where id = 1;`)
  }
  // fail-closed: se o INSERT no log falhar, a RPC falha e nada é autorizado. Simula com um gatilho temporário.
  try {
    sql(`
      create or replace function public._e2e_radm_falha_log() returns trigger language plpgsql as $f$ begin raise exception 'e2e: log indisponível'; end $f$;
      drop trigger if exists e2e_radm_falha_log on public.plataforma_acesso_log;
      create trigger e2e_radm_falha_log before insert on public.plataforma_acesso_log for each row execute function public._e2e_radm_falha_log();`)
    const rf = await assinaMediado(c.adm, servico, 'post', P.falha.id)
    ok('log indisponível: admin é NEGADO na foto em análise (fail-closed, sem assinatura sem registro)', !rf.ok && !rf.abre, rf.erro)
    ok('...e nenhuma linha foi gravada', logLinhas(ID.adm, P.falha.id) === 0)
    const pf = await rpc(c.adm, 'admin_comunidade_painel')
    ok('log indisponível: admin_comunidade_painel também falha fechado', !!pf.erro && /registrar o acesso/i.test(pf.erro), pf.erro)
    const mf = await rpc(c.adm, 'admin_comunidade_moderar', { p_tipo: 'post', p_id: P.falha.id, p_acao: 'recusar_foto' })
    ok('log indisponível: admin_comunidade_moderar falha fechado e o item não muda', !!mf.erro && st(P.falha) === 'em_analise', (mf.erro || '') + ' ' + st(P.falha))
  } finally {
    sql(`drop trigger if exists e2e_radm_falha_log on public.plataforma_acesso_log; drop function if exists public._e2e_radm_falha_log();`)
  }
  const rvolta = await assinaMediado(c.adm, servico, 'post', P.falha.id)
  ok('log restabelecido: admin volta a assinar o item em contexto e grava a linha', rvolta.ok && rvolta.abre && logLinhas(ID.adm, P.falha.id) === 1, rvolta.erro || '')
  console.log('\n== 9. list() do admin NÃO registra (achado da Fase 8 corrigido pela 530) ==')
  const extra = await postar('instrB', clubeB, 'comunidade', 'extra')
  ok('preparo: item "extra" em análise, ainda sem nenhum acesso registrado', logLinhas(ID.adm, extra.id) === 0)
  const totalAntes = Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id = '${ID.adm}';`))
  const lista = await c.adm.storage.from('comunidade').list(`${clubeA}/${ID.dirA}`)
  ok('list() do admin numa pasta de item em contexto não devolve nenhum arquivo', (lista.data || []).length === 0, JSON.stringify((lista.data || []).map((x) => x.name)))
  const lista2 = await c.adm.storage.from('comunidade').list(`${clubeB}/${ID.instrB}`)
  ok('list() do admin na pasta do item em análise também não devolve nada (sem leitura direta)', (lista2.data || []).length === 0, JSON.stringify((lista2.data || []).map((x) => x.name)))
  const totalDepois = Number(sql(`select count(*) from public.plataforma_acesso_log where admin_user_id = '${ID.adm}';`))
  ok('listar NÃO gerou nenhuma linha no log (nem para "extra" nem para outro item)', logLinhas(ID.adm, extra.id) === 0 && totalDepois === totalAntes, `${totalAntes} -> ${totalDepois}`)
  const mExtra = await assinaMediado(c.adm, servico, 'post', extra.id)
  ok('só assinar registra: 1 linha para "extra"', mExtra.ok && mExtra.abre && logLinhas(ID.adm, extra.id) === 1, mExtra.erro || '')
}

let saiu = 0
try {
  await principal()
} catch (e) {
  console.error('\nERRO no e2e:', e.message)
  falhas.push('erro de execução: ' + e.message)
} finally {
  try { sql(`drop trigger if exists e2e_radm_falha_log on public.plataforma_acesso_log; drop function if exists public._e2e_radm_falha_log();`) } catch (e) { console.error('limpeza do gatilho:', e.message) }
  try {
    const servico = createClient(URL_API, SERVICE, semSessao)
    const com = criadosStorage.filter((x) => typeof x === 'string')
    const img = criadosStorage.filter((x) => Array.isArray(x)).map((x) => x[1])
    if (com.length) await servico.storage.from('comunidade').remove(com)
    if (img.length) await servico.storage.from('imagens').remove(img)
  } catch (e) { console.error('limpeza do Storage:', e.message) }
  try { limparBanco() } catch (e) { console.error('limpeza do banco:', e.message) }
  console.log(`\n${total - falhas.length}/${total} ok` + (falhas.length ? `, ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}` : ' — TUDO OK'))
  saiu = falhas.length ? 1 : 0
}
process.exit(saiu)
