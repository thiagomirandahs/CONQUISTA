// E2E da INSCRIÇÃO NO CLUBE POR CÓDIGO/LINK no stack LOCAL (nunca produção): supabase-js de verdade -> PostgREST/GoTrue -> banco.
//
//   node supabase/tests/e2e/_seed_homologacao.mjs     (cria hml-clube-a/b e as personas hml-*)
//   npm run test:inscricao:e2e
//
// Cobre: diretoria gera/regera/revoga o código; pessoa NOVA (signUp real, e-mail e2e-insc-*@teste.local) usa o código e
// cria solicitação PENDENTE (nunca ativa sozinha, papel decidido pelo servidor); Aprovações; aprovação -> vínculo ativo;
// código inválido/expirado/revogado; forja de papel/clube; isolamento entre clubes; membro/instrutor não aprovam;
// sem duplicar pedido; nome de clube único; multiclube (migration 340); limite de tentativas; e a ponte link -> rota.
//
// Sobre o e-mail: o GoTrue local tem GOTRUE_MAILER_AUTOCONFIRM=false (signUp devolve conta SEM sessão). O script NÃO depende de
// e-mail: faz o signUp de verdade e "clica no link de confirmação" via SQL (email_confirmed_at), igual ao que o clique faria.
// Limpa tudo que criou (usuários e2e-insc-*, vínculos, códigos dos clubes hml-*, tentativas, onboarding) no início e no fim,
// mesmo se falhar. NUNCA apaga o código do Tenant 001 nem nada fora dos clubes hml-* / contas e2e-insc-*.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { urlPublicaDoApp } from '../../../src/lib/dominios.js'
import { retornoDaUrl } from '../../../src/lib/retornoPosLogin.js'

const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA_HML = 'senha-homologacao-123'
const SENHA = 'senha-insc-123'
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const INICIO = new Date().toISOString()

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}

let total = 0
let reprovados = 0
const falhas = []
function ok(nome, cond, detalhe = '') {
  total++
  if (!cond) { reprovados++; falhas.push(`${nome}  [${detalhe}]`); console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`)
}
const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }

// cliente com o header x-clube-atual (o mesmo mecanismo de src/lib/supabase.js)
function cliente() {
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
  const s = cliente()
  const { error } = await s.c.auth.signInWithPassword({ email: `hml-${chave}@teste.local`, password: SENHA_HML })
  if (error) throw new Error(`login hml-${chave}: ${error.message} (rode antes: node supabase/tests/e2e/_seed_homologacao.mjs)`)
  return s
}
// pessoa NOVA: signUp real (o gatilho handle_new_user cria o perfil) + "clique" de confirmação via SQL + login
async function novaPessoa(rotulo, meta = {}) {
  const email = `e2e-insc-${rotulo}@teste.local`
  const s = cliente()
  const { data, error } = await s.c.auth.signUp({ email, password: SENHA, options: { data: { nome: `E2E Insc ${rotulo}`, tipo: '', nascimento: '2012-05-05', cargo: '', ...meta } } })
  if (error) throw new Error(`signUp ${rotulo}: ${error.message}`)
  const semConfirmar = await s.c.auth.signInWithPassword({ email, password: SENHA })
  if (!semConfirmar.error && data?.session == null) { /* ambiente com autoconfirm: tudo bem */ }
  sql(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email = '${email}';`)
  const { error: e2 } = await s.c.auth.signInWithPassword({ email, password: SENHA })
  if (e2) throw new Error(`login ${rotulo}: ${e2.message}`)
  s.id = data.user.id
  s.email = email
  s.bloqueadoAntesDeConfirmar = !!semConfirmar.error
  return s
}

const vinculos = (uid, clube) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('role', role, 'status', status, 'source', metadata->>'source') order by created_at), '[]') from public.organization_memberships where user_id='${uid}' and organizational_unit_id='${clube}';`))
const idClube = (slug) => sql(`select id from public.organizational_units where slug='${slug}';`)
const semAcesso = (r) => !!r.error || r.data == null || (Array.isArray(r.data) && r.data.length === 0)

function limpar() {
  sql(`
    set session_replication_role = replica;
    delete from public.onboarding_sessions where user_id in (select id from auth.users where email like 'e2e-insc-%@teste.local');
    delete from public.billing_account_contacts where user_id in (select id from auth.users where email like 'e2e-insc-%@teste.local');
    delete from public.billing_accounts where nome like 'E2E Insc%';
    delete from public.entrada_tentativas where user_id in (select id from auth.users where email like 'e2e-insc-%@teste.local');
    delete from public.responsaveis where responsavel_id in (select id from auth.users where email like 'e2e-insc-%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'e2e-insc-%@teste.local');
    delete from public.profiles where id in (select id from auth.users where email like 'e2e-insc-%@teste.local');
    delete from auth.users where email like 'e2e-insc-%@teste.local';
    delete from public.club_entry_codes where club_id in (select id from public.organizational_units where slug in ('hml-clube-a','hml-clube-b'));
    delete from public.entrada_tentativas_publicas where quando >= '${INICIO}'::timestamptz - interval '1 minute';
  `)
}

async function principal() {
  if (sql(`select count(*) from public.organizational_units where slug in ('hml-clube-a','hml-clube-b');`) !== '2') {
    console.error('ABORTADO: faltam hml-clube-a/b. Rode antes: node supabase/tests/e2e/_seed_homologacao.mjs'); process.exit(2)
  }
  limpar()
  const A = idClube('hml-clube-a'); const B = idClube('hml-clube-b')
  const dirA = await logarHml('diretoria_a'); dirA.usar(A)
  const dirB = await logarHml('diretoria_b'); dirB.usar(B)
  const instrA = await logarHml('instrutor'); instrA.usar(A)
  const membroA = await logarHml('desbravador'); membroA.usar(A)
  const anon = createClient(API_URL, ANON, semSessao)

  console.log('\n== 1. quem pode gerar/ver/revogar o código ==')
  for (const [nome, s] of [['membro comum (desbravador)', membroA], ['instrutor (liderança, mas não administra)', instrA]]) {
    const g = await s.c.rpc('clube_codigo_gerar', { p_dias: null })
    const v = await s.c.rpc('clube_codigo_atual')
    const r = await s.c.rpc('clube_codigo_revogar')
    ok(`${nome}: NÃO gera, NÃO vê, NÃO revoga o código`, !!g.error && !!v.error && !!r.error, `${g.error?.message}`)
  }
  dirB.usar(A)   // diretoria do B apontando o header para o clube A (onde ela não tem vínculo)
  const gX = await dirB.c.rpc('clube_codigo_gerar', { p_dias: null })
  ok('diretoria do clube B com header x-clube-atual = A: NÃO gera código do A', !!gX.error, gX.error?.message)
  dirB.usar(B)
  ok('nenhum código foi criado pelas tentativas indevidas', sql(`select count(*) from public.club_entry_codes where club_id in ('${A}','${B}');`) === '0')
  const gAnon = await anon.rpc('clube_codigo_gerar', { p_dias: null })
  ok('anon NÃO gera código', !!gAnon.error)
  const gForja = await dirA.c.rpc('clube_codigo_gerar', { p_dias: null, p_papel: 'diretoria' })
  ok('diretoria NÃO consegue gerar código que concede papel de liderança (p_papel=diretoria)', !!gForja.error, gForja.error?.message)

  console.log('\n== 2. diretoria gera; código preservado enquanto vale; só o hash fica no banco ==')
  const v0 = await dirA.c.rpc('clube_codigo_atual')
  ok('antes de gerar: "Nenhum código ativo"', v0.data?.existe === false)
  const g1 = await dirA.c.rpc('clube_codigo_gerar', { p_dias: null })
  const C1 = g1.data?.codigo
  ok('gerar: 16 hex em maiúsculas, papel desbravador, sem prazo', /^[0-9A-F]{16}$/.test(C1 || '') && g1.data.papel === 'desbravador' && g1.data.expira_em === null, JSON.stringify(g1.data))
  const v1 = await dirA.c.rpc('clube_codigo_atual')
  const v1b = await dirA.c.rpc('clube_codigo_atual')
  ok('ver o código: existe, prefixo = 4 primeiros caracteres, SEM o código em claro', v1.data?.existe === true && v1.data.prefixo === C1.slice(0, 4) && !JSON.stringify(v1.data).includes(C1), JSON.stringify(v1.data))
  ok('o código é PRESERVADO enquanto vale: consultar de novo não troca nada (mesmo criado_em)', v1b.data?.criado_em === v1.data?.criado_em && v1b.data?.prefixo === v1.data?.prefixo)
  ok('o banco guarda só o HASH (sha256), nunca o código', sql(`select count(*) from public.club_entry_codes where codigo_hash = '${C1}' or codigo_hash like '%${C1}%';`) === '0'
    && sql(`select count(*) from public.club_entry_codes where club_id='${A}' and revoked_at is null and codigo_hash = encode(extensions.digest('${C1}','sha256'),'hex');`) === '1')
  const leitura = await dirA.c.from('club_entry_codes').select('*')
  ok('a tabela club_entry_codes não é legível nem pela diretoria (sem grant)', !!leitura.error || (leitura.data || []).length === 0, leitura.error?.message)

  console.log('\n== 3. pessoa NOVA usa o código: nasce PENDENTE (passo a passo igual ao app) ==')
  const n1 = await novaPessoa('n1')
  ok('signUp real: e-mail ainda não confirmado não loga (confirmação no clique)', n1.bloqueadoAntesDeConfirmar === true)
  const ctx0 = await n1.c.rpc('meu_contexto')
  ok('conta recém-criada: ZERO vínculos (cadastro não coloca ninguém em clube)', (ctx0.data?.vinculos || []).length === 0, JSON.stringify(ctx0.data?.vinculos))
  const pub = await anon.rpc('entrada_abrir_publico', { p_codigo: C1 })
  ok('link sem conta (InscricaoPublica): anon vê SÓ a identidade pública do clube', pub.data?.encontrado === true && pub.data.clube === 'Hml Clube A' && !('papel' in pub.data) && !('club_id' in pub.data) && !JSON.stringify(pub.data).includes(A), JSON.stringify(pub.data))
  const anonAbrir = await anon.rpc('entrada_abrir', { p_codigo: C1 })
  const anonSolic = await anon.rpc('entrada_solicitar', { p_codigo: C1 })
  ok('anon NÃO executa entrada_abrir nem entrada_solicitar (exige conta)', !!anonAbrir.error && !!anonSolic.error)
  const ab = await n1.c.rpc('entrada_abrir', { p_codigo: C1 })
  ok('com sessão (Entrar.jsx): entrada_abrir devolve o clube de destino', ab.data?.encontrado === true && ab.data.clube === 'Hml Clube A', JSON.stringify(ab.data))
  ok('abrir NÃO cria vínculo (só confirmar cria)', vinculos(n1.id, A).length === 0)
  const s1 = await n1.c.rpc('entrada_solicitar', { p_codigo: `  ${C1.toLowerCase()} ` })
  ok('solicitar: ok, ja_era=false, situação PENDENTE, papel do servidor = desbravador (aceita minúsculas/espaços)', s1.data?.ok === true && s1.data.ja_era === false && s1.data.situacao === 'pendente' && s1.data.papel === 'desbravador', JSON.stringify(s1.data))
  let vv = vinculos(n1.id, A)
  ok('banco: 1 vínculo no A, status pendente (NUNCA ativo sozinho), role desbravador, origem codigo_de_entrada', vv.length === 1 && vv[0].status === 'pendente' && vv[0].role === 'desbravador' && vv[0].source === 'codigo_de_entrada', JSON.stringify(vv))
  ok('o código continua valendo depois do uso (não é de uso único)', (await dirA.c.rpc('clube_codigo_atual')).data?.existe === true)
  const ctx1 = await n1.c.rpc('meu_contexto')
  const vin1 = (ctx1.data?.vinculos || [])[0]
  ok('meu_contexto: vínculo pendente e NÃO selecionável (o front não dá acesso)', vin1?.status === 'pendente' && vin1.selecionavel === false, JSON.stringify(vin1))
  n1.usar(A)
  const cid = await n1.c.rpc('clube_atual_id')
  ok('servidor: pendente com header x-clube-atual=A NÃO ganha clube em uso', cid.data == null, String(cid.data))
  const cc = await n1.c.rpc('clube_codigo_atual'); const ep = await n1.c.rpc('entradas_pendentes')
  ok('pendente não vê código nem fila de aprovação', !!cc.error && semAcesso(ep), `${cc.error?.message}`)
  const s1b = await n1.c.rpc('entrada_solicitar', { p_codigo: C1 })
  ok('mesma pessoa de novo: NÃO duplica (ja_era=true, situação pendente, ainda 1 vínculo)', s1b.data?.ja_era === true && s1b.data.situacao === 'pendente' && vinculos(n1.id, A).length === 1, JSON.stringify(s1b.data))

  console.log('\n== 4. forja de papel/clube por quem pede ==')
  const n2 = await novaPessoa('n2', { papel: 'diretoria', role: 'diretoria', club_id: A, status: 'ativo' })
  ok('signUp com metadata forjada (papel/role/club_id/status): continua sem vínculo e perfil desbravador', vinculos(n2.id, A).length === 0 && sql(`select papel from public.profiles where id='${n2.id}'`) === 'desbravador')
  const f1 = await n2.c.rpc('entrada_solicitar', { p_codigo: C1, p_papel: 'diretoria', p_club_id: B, p_status: 'ativo' })
  ok('parâmetros extras (p_papel/p_club_id/p_status) são recusados pelo PostgREST', !!f1.error && vinculos(n2.id, A).length === 0 && vinculos(n2.id, B).length === 0, f1.error?.message)
  n2.usar(B)   // header apontando para o OUTRO clube
  const f2 = await n2.c.rpc('entrada_solicitar', { p_codigo: C1 })
  ok('header x-clube-atual = B + código do A: o pedido cai no A (o código decide, não o header)', f2.data?.situacao === 'pendente' && vinculos(n2.id, A).length === 1 && vinculos(n2.id, B).length === 0, JSON.stringify(f2.data))
  n2.usar(null)
  const ins = await n2.c.from('organization_memberships').insert({ user_id: n2.id, organizational_unit_id: A, role: 'diretoria', status: 'ativo' })
  ok('INSERT direto em organization_memberships com papel diretoria/ativo: negado', !!ins.error && vinculos(n2.id, A).length === 1 && vinculos(n2.id, A)[0].status === 'pendente', ins.error?.message)
  await n1.c.from('organization_memberships').update({ status: 'ativo', role: 'diretoria' }).eq('user_id', n1.id)
  vv = vinculos(n1.id, A)
  ok('UPDATE direto do próprio vínculo (status ativo/role diretoria): sem efeito', vv[0].status === 'pendente' && vv[0].role === 'desbravador', JSON.stringify(vv))
  const auto = await n1.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_status: 'ativo' })
  ok('auto-aprovação por vinculo_gerir: recusada', !!auto.error && vinculos(n1.id, A)[0].status === 'pendente', auto.error?.message)

  console.log('\n== 5. Aprovações: só a diretoria DO clube vê e decide ==')
  const fila = await dirA.c.rpc('entradas_pendentes')
  const meu = (fila.data || []).find((x) => x.id === n1.id)
  ok('diretoria A vê n1 (e n2) na fila, com papel pedido e origem do código', !!meu && meu.papel_pedido === 'desbravador' && meu.origem === 'codigo_de_entrada' && (fila.data || []).some((x) => x.id === n2.id), JSON.stringify(meu))
  const filaB = await dirB.c.rpc('entradas_pendentes')
  ok('diretoria do clube B NÃO vê os pedidos do A', !(filaB.data || []).some((x) => x.id === n1.id || x.id === n2.id), JSON.stringify(filaB.data))
  dirB.usar(A)
  const filaBA = await dirB.c.rpc('entradas_pendentes')
  const apB = await dirB.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_status: 'ativo' })
  ok('diretoria B com header = A: não vê a fila nem aprova (sem vínculo ativo no A)', semAcesso(filaBA) && !!apB.error && vinculos(n1.id, A)[0].status === 'pendente', apB.error?.message)
  dirB.usar(B)
  const apB2 = await dirB.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_status: 'ativo' })
  ok('diretoria B no próprio clube: n1 não tem vínculo lá -> recusado', !!apB2.error && vinculos(n1.id, A)[0].status === 'pendente', apB2.error?.message)
  for (const [nome, s] of [['membro comum', membroA], ['instrutor', instrA]]) {
    const f = await s.c.rpc('entradas_pendentes'); const d = await s.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_status: 'ativo' })
    ok(`${nome} NÃO vê a fila e NÃO aprova`, semAcesso(f) && !!d.error && vinculos(n1.id, A)[0].status === 'pendente', d.error?.message)
  }

  console.log('\n== 6. aprovar e recusar ==')
  const ap = await dirA.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_status: 'ativo' })
  vv = vinculos(n1.id, A)
  ok('diretoria A aprova n1: vínculo ATIVO, papel continua desbravador', ap.data?.ok === true && vv[0].status === 'ativo' && vv[0].role === 'desbravador', JSON.stringify(vv))
  ok('n1 sai da fila de Aprovações', !((await dirA.c.rpc('entradas_pendentes')).data || []).some((x) => x.id === n1.id))
  const ctx2 = (await n1.c.rpc('meu_contexto')).data
  ok('n1: vínculo agora selecionável e o servidor age no clube A', ctx2?.vinculos?.[0]?.status === 'ativo' && ctx2.vinculos[0].selecionavel === true && (await n1.c.rpc('clube_atual_id')).data === A, JSON.stringify(ctx2?.vinculos?.[0]))
  const esc = await n1.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_papel: 'diretoria' })
  ok('depois de ativo, n1 continua sem poder se promover nem aprovar', !!esc.error && vinculos(n1.id, A)[0].role === 'desbravador')
  const rc = await dirA.c.rpc('vinculo_gerir', { p_user_id: n2.id, p_status: 'rejeitado' })
  ok('diretoria recusa n2: vínculo encerrado, sai da fila', rc.data?.ok === true && vinculos(n2.id, A)[0].status === 'encerrado' && !((await dirA.c.rpc('entradas_pendentes')).data || []).some((x) => x.id === n2.id))
  const s2 = await n2.c.rpc('entrada_solicitar', { p_codigo: C1 })
  ok('n2 recusado usa o código de novo: NÃO reabre (ja_era, situação encerrado, nada novo na fila)', s2.data?.ja_era === true && s2.data.situacao === 'encerrado' && vinculos(n2.id, A).length === 1 && !((await dirA.c.rpc('entradas_pendentes')).data || []).some((x) => x.id === n2.id), JSON.stringify(s2.data))

  console.log('\n== 7. código inválido / expirado / revogado / regerado ==')
  const n3 = await novaPessoa('n3')
  const lixo = ['ZZZZZZZZZZZZZZZZ', '', 'abc', C1.slice(0, 8), `${C1}0`]
  let todosRecusados = true
  for (const l of lixo) { const r = await n3.c.rpc('entrada_solicitar', { p_codigo: l }); if (!(r.data?.encontrado === false)) todosRecusados = false }
  ok('código errado/vazio/curto/parcial/com sobra: recusado (encontrado=false), nenhum vínculo', todosRecusados && vinculos(n3.id, A).length === 0)
  const erradas = sql(`select count(*) from public.entrada_tentativas where user_id='${n3.id}' and not acertou;`)
  ok('cada tentativa errada fica registrada (alimenta o limite de abuso)', erradas === String(lixo.length), erradas)
  // regerar: o anterior morre no mesmo ato
  const g2 = await dirA.c.rpc('clube_codigo_gerar', { p_dias: 30 })
  const C2 = g2.data?.codigo
  ok('regerar com prazo de 30 dias: código novo, diferente, com expira_em', /^[0-9A-F]{16}$/.test(C2) && C2 !== C1 && !!g2.data.expira_em)
  const ativos = sql(`select count(*) from public.club_entry_codes where club_id='${A}' and revoked_at is null;`)
  const revog = sql(`select count(*) from public.club_entry_codes where club_id='${A}' and revoked_at is not null;`)
  ok('REGRA REAL: um único código ativo por clube; regerar REVOGA o anterior no mesmo ato (histórico fica)', ativos === '1' && revog === '1', `${ativos}/${revog}`)
  const velho = await n3.c.rpc('entrada_solicitar', { p_codigo: C1 })
  const velhoPub = await anon.rpc('entrada_abrir_publico', { p_codigo: C1 })
  ok('código ANTIGO (regerado): recusado, tanto logado quanto pelo link público', velho.data?.encontrado === false && velhoPub.data?.encontrado === false && vinculos(n3.id, A).length === 0)
  const lixoJson = JSON.stringify((await n3.c.rpc('entrada_abrir', { p_codigo: 'NAOEXISTE0000000' })).data)
  ok('resposta idêntica para revogado e inexistente (sem oráculo de existência)', JSON.stringify(velho.data) === lixoJson && JSON.stringify(velho.data) === '{"encontrado":false}', lixoJson)
  // expirado
  sql(`update public.club_entry_codes set expires_at = now() - interval '1 minute' where club_id='${A}' and revoked_at is null;`)
  const venc = await dirA.c.rpc('clube_codigo_atual')
  const exp = await n3.c.rpc('entrada_solicitar', { p_codigo: C2 })
  const expPub = await anon.rpc('entrada_abrir_publico', { p_codigo: C2 })
  ok('código EXPIRADO: diretoria vê "vencido"; usar é recusado (igual a inexistente) e não cria vínculo', venc.data?.vencido === true && JSON.stringify(exp.data) === '{"encontrado":false}' && expPub.data?.encontrado === false && vinculos(n3.id, A).length === 0, JSON.stringify(exp.data))
  // revogado
  const g3 = await dirA.c.rpc('clube_codigo_gerar', { p_dias: null })
  const C3 = g3.data?.codigo
  const rv = await dirA.c.rpc('clube_codigo_revogar'); const rv2 = await dirA.c.rpc('clube_codigo_revogar')
  const revUso = await n3.c.rpc('entrada_solicitar', { p_codigo: C3 })
  ok('código REVOGADO: revogar devolve ok, 2ª revogação ok=false, uso recusado, "Nenhum código ativo"', rv.data?.ok === true && rv2.data?.ok === false && revUso.data?.encontrado === false && (await dirA.c.rpc('clube_codigo_atual')).data?.existe === false && vinculos(n3.id, A).length === 0)
  const g4 = await dirA.c.rpc('clube_codigo_gerar', { p_dias: null }); const C4 = g4.data.codigo
  ok('gerar depois de revogar volta a ter 1 ativo e 3+ revogados no histórico', sql(`select count(*) filter (where revoked_at is null) || '/' || count(*) filter (where revoked_at is not null) from public.club_entry_codes where club_id='${A}';`) === '1/3')

  console.log('\n== 8. limite de tentativas erradas (abuso) ==')
  const n5 = await novaPessoa('n5')
  for (let i = 0; i < 10; i++) await n5.c.rpc('entrada_solicitar', { p_codigo: `ERRADO${i}` })
  const lim = await n5.c.rpc('entrada_solicitar', { p_codigo: C4 })
  ok('10 erradas em 10 min: a 11ª, mesmo com o código CERTO, é barrada ("Muitas tentativas")', !!lim.error && /Muitas tentativas/.test(lim.error.message) && vinculos(n5.id, A).length === 0, lim.error?.message)
  const limAbrir = await n5.c.rpc('entrada_abrir', { p_codigo: C4 })
  ok('o limite também vale para entrada_abrir', !!limAbrir.error && /Muitas tentativas/.test(limAbrir.error.message))

  console.log('\n== 9. multiclube: entrar no 2º clube NÃO herda papel do 1º (migration 340) ==')
  const promo = await dirA.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_papel: 'conselheiro' })
  ok('preparo: diretoria A promove n1 a CONSELHEIRO no clube A', promo.data?.ok === true && vinculos(n1.id, A)[0].role === 'conselheiro' && vinculos(n1.id, A)[0].status === 'ativo')
  const gB = await dirB.c.rpc('clube_codigo_gerar', { p_dias: 7 }); const CB = gB.data?.codigo
  ok('diretoria B gera o código do clube B (independente do A: o do A segue ativo)', /^[0-9A-F]{16}$/.test(CB || '') && (await dirA.c.rpc('clube_codigo_atual')).data?.existe === true)
  const aCruz = await n1.c.rpc('entrada_abrir', { p_codigo: CB })
  ok('o código do B abre o clube B (nome do B, nada do A)', aCruz.data?.clube === 'Hml Clube B' && !JSON.stringify(aCruz.data).includes('Hml Clube A'))
  n1.usar(null)
  const sB = await n1.c.rpc('entrada_solicitar', { p_codigo: CB })
  const vA = vinculos(n1.id, A); const vB = vinculos(n1.id, B)
  ok('n1 (conselheiro ATIVO no A) pede o B: pendente como DESBRAVADOR (não herdou conselheiro)', sB.data?.situacao === 'pendente' && sB.data.papel === 'desbravador' && vB.length === 1 && vB[0].status === 'pendente' && vB[0].role === 'desbravador', JSON.stringify(vB))
  ok('o vínculo do A não mudou (conselheiro, ativo)', vA.length === 1 && vA[0].role === 'conselheiro' && vA[0].status === 'ativo')
  n1.usar(B)
  ok('pendente no B: header x-clube-atual=B não vale (não vira clube em uso)', (await n1.c.rpc('clube_atual_id')).data !== B)
  const filaB2 = await dirB.c.rpc('entradas_pendentes')
  ok('só a diretoria do B vê o pedido do n1 (a do A não)', (filaB2.data || []).some((x) => x.id === n1.id) && !((await dirA.c.rpc('entradas_pendentes')).data || []).some((x) => x.id === n1.id))
  const apBb = await dirB.c.rpc('vinculo_gerir', { p_user_id: n1.id, p_status: 'ativo' })
  ok('diretoria B aprova: ativo no B como desbravador; A segue conselheiro', apBb.data?.ok === true && vinculos(n1.id, B)[0].status === 'ativo' && vinculos(n1.id, B)[0].role === 'desbravador' && vinculos(n1.id, A)[0].role === 'conselheiro')
  n1.usar(A); const cidA = (await n1.c.rpc('clube_atual_id')).data
  n1.usar(B); const cidB = (await n1.c.rpc('clube_atual_id')).data
  ok('multiclube: header A resolve o A, header B resolve o B', cidA === A && cidB === B)
  const nCtx = (await n1.c.rpc('meu_contexto')).data
  ok('meu_contexto: 2 vínculos ativos (A conselheiro, B desbravador)', (nCtx?.vinculos || []).length === 2)
  // conta aberta como RESPONSÁVEL: pedido nasce 'pais'
  const np = await novaPessoa('pais', { tipo: 'pais', nascimento: '' })
  const sP = await np.c.rpc('entrada_solicitar', { p_codigo: CB })
  ok('conta aberta como responsável: pedido nasce papel "pais", pendente', sP.data?.situacao === 'pendente' && sP.data.papel === 'pais' && vinculos(np.id, B)[0].role === 'pais' && vinculos(np.id, B)[0].status === 'pendente', JSON.stringify(sP.data))
  // O papel que o servidor decide é o do CÓDIGO (desbravador|conselheiro), sempre pendente
  const gC = await dirB.c.rpc('clube_codigo_gerar', { p_dias: null, p_papel: 'conselheiro' })
  const n6 = await novaPessoa('n6')
  const sC = await n6.c.rpc('entrada_solicitar', { p_codigo: gC.data?.codigo })
  ok('código "conselheiro" (escolha da diretoria): pedido nasce conselheiro mas PENDENTE (continua dependendo de aprovação)', sC.data?.papel === 'conselheiro' && sC.data.situacao === 'pendente' && vinculos(n6.id, B)[0].status === 'pendente')
  // o código do B antigo morreu ao regerar
  ok('e o código antigo do B (regerado) morreu', (await n6.c.rpc('entrada_solicitar', { p_codigo: CB })).data?.encontrado === false)

  console.log('\n== 10. nome de clube único (migration 205), pelo caminho real do onboarding ==')
  const n7 = await novaPessoa('n7')
  await n7.c.rpc('onboarding_iniciar')
  await n7.c.rpc('onboarding_etapa', { p_etapa: 'conta', p_dados: { nome: 'E2E Insc n7' } })
  await n7.c.rpc('onboarding_etapa', { p_etapa: 'dados_basicos', p_dados: {} })
  const dupes = []
  for (const nome of ['Hml Clube A', 'hml clube a', 'HML  CLUBE Á', 'Hml-Clube.A!']) {
    const r = await n7.c.rpc('onboarding_etapa', { p_etapa: 'clube', p_dados: { nome } })
    dupes.push(!!r.error && /Já existe um clube/.test(r.error.message))
  }
  ok('criar clube com nome igual (ignora caixa/acento/espaço/pontuação): recusado nas 4 variações', dupes.every(Boolean), JSON.stringify(dupes))
  ok('nenhum clube novo foi criado', sql(`select count(*) from public.organizational_units where type='clube' and slug like '%hml-clube-a%' and slug <> 'hml-clube-a';`) === '0')

  console.log('\n== 11. a ponte link -> rota -> retorno (código do app) ==')
  const web = { protocol: 'https:', hostname: 'app.desbravaclube.com.br', host: 'app.desbravaclube.com.br' }
  const site = { protocol: 'https:', hostname: 'desbravaclube.com.br', host: 'desbravaclube.com.br' }
  const loc = { protocol: 'http:', hostname: 'localhost', host: 'localhost:5173' }
  const gestao = readFileSync(new URL('../../../src/pages/GestaoInscricoes.jsx', import.meta.url), 'utf8')
  const appJsx = readFileSync(new URL('../../../src/App.jsx', import.meta.url), 'utf8')
  const entrarJsx = readFileSync(new URL('../../../src/pages/Entrar.jsx', import.meta.url), 'utf8')
  const caminho = `/entrar?codigo=${encodeURIComponent(C4)}`
  ok('GestaoInscricoes monta o link com urlPublicaDoApp(`/entrar?codigo=…`)', gestao.includes('urlPublicaDoApp(`/entrar?codigo=${encodeURIComponent(codigo)}`)'))
  ok('no app (app.desbravaclube.com.br) o link é https://app…/entrar?codigo=…', urlPublicaDoApp(caminho, web) === `https://app.desbravaclube.com.br${caminho}`)
  ok('gerado no site/APK-like também aponta para o app público, nunca para a origem local', urlPublicaDoApp(caminho, site) === `https://app.desbravaclube.com.br${caminho}` && urlPublicaDoApp(caminho, loc) === `http://localhost:5173${caminho}`)
  ok('App.jsx tem <Route path="/entrar"> -> PortaDeEntrada, e o domínio do site manda /entrar para o app (IrParaApp)', /<Route path="\/entrar" element=\{<PortaDeEntrada \/>\} \/>/.test(appJsx) && appJsx.includes('function IrParaApp') && appJsx.includes('urlDoApp(pathname + search + hash)'))
  ok('PortaDeEntrada: com sessão -> Entrar; sem sessão + ?codigo -> InscricaoPublica', /if \(session\) return <Entrar \/>/.test(appJsx) && /get\('codigo'\)\) return <InscricaoPublica \/>/.test(appJsx))
  ok('InscricaoPublica volta para /entrar?codigo=…&pedir=1 e Entrar.jsx pede entrada sozinho com pedir=1', entrarJsx.includes('/entrar?codigo=${encodeURIComponent(codigo)}&pedir=1') && entrarJsx.includes("params.get('pedir') === '1'") && entrarJsx.includes('await solicitarEntrada(codigoDaUrl)'))
  const volta = `/entrar?codigo=${encodeURIComponent(C4)}&pedir=1`
  ok('retorno pós-login/cadastro: ?proximo= só aceita caminho relativo seguro', retornoDaUrl(`?proximo=${encodeURIComponent(volta)}`) === volta && retornoDaUrl('?proximo=//evil.test') === null && retornoDaUrl('?proximo=https://evil.test') === null && retornoDaUrl('?proximo=/\\evil.test') === null)
  // o que o app faz ao voltar com pedir=1, executado de verdade com uma pessoa nova
  const n8 = await novaPessoa('n8')
  const abre = await n8.c.rpc('entrada_abrir', { p_codigo: C4 })
  const pede = abre.data?.encontrado ? await n8.c.rpc('entrada_solicitar', { p_codigo: C4 }) : null
  ok('simulação do retorno (abrir + solicitar automático): vínculo PENDENTE no A, aparece em Aprovações', pede?.data?.situacao === 'pendente' && ((await dirA.c.rpc('entradas_pendentes')).data || []).some((x) => x.id === n8.id))
  ok('ClubeGuard/Aprovações: GestaoInscricoes lista SolicitacoesPendentes (entradas_pendentes -> vinculo_gerir)', gestao.includes('<SolicitacoesPendentes') && readFileSync(new URL('../../../src/components/SolicitacoesPendentes.jsx', import.meta.url), 'utf8').includes("rpc('vinculo_gerir'"))
}

let erroFatal = null
try { await principal() } catch (e) { erroFatal = e; console.log('\nERRO FATAL:', e.message) } finally {
  try { limpar(); console.log('\n(limpo: contas e2e-insc-*, vínculos, códigos dos clubes hml-*, tentativas e onboarding de teste removidos)') } catch (e) { console.log('FALHA NA LIMPEZA:', e.message) }
}
console.log(`\n${total - reprovados}/${total} asserts ok${reprovados ? `  —  ${reprovados} REPROVADOS` : ''}`)
if (falhas.length) { console.log('\nFalhas:'); for (const f of falhas) console.log(' - ' + f) }
process.exit(erroFatal || reprovados ? 1 : 0)
