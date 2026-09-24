// =============================================================================
//  Fase 9, item 11 — RED-TEAM no staging.
//
//  Cada ataque é feito como o atacante faria (pela API, com um token de verdade), e o resultado é
//  medido no BANCO, fora da RLS. "Recebi erro" não é defesa: defesa é o estado não ter mudado.
//
//    1. código de entrada    força bruta, oráculo, revogado, o que ele revela, o que ele NÃO dá
//    2. convites             token usado por outro, convite de outra pessoa, revogado
//    3. pessoa A+B+C         poder de um clube usado em outro
//    4. suspenso / removido  o token continua valendo; o acesso ao clube não
//    5. Storage              pasta alheia, traversal, sobrescrever, bucket público, listagem
//    6. evidência de criança URL assinada, responsável, liderança de outro clube
//    7. APIs / RPC           superfície anônima, RPC com id de outro clube
//    8. headers              lista, JSON, maiúsculas, injeção, escopo forjado
//    9. rate limit           entrada, ajuda, chat, login (por último: bloqueia o IP por minutos)
//   10. logout / identidade  refresh revogado, access token até expirar
//
//  Tudo o que muda é desfeito no fim (fora da RLS). Uso: ALVO=staging node supabase/e2e/redteam-staging.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

if (process.env.ALVO !== 'staging') { console.error('Rode com ALVO=staging.'); process.exit(2) }
const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const API = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const DB = 'supabase_db_CONQUISTA-STAGING'
const SENHA = 'Multiclube2026'
const pop = JSON.parse(readFileSync('supabase/e2e/populacao.staging.json', 'utf8'))
const C = pop.clubes
const P = pop.pessoas
const MARCA = `rt-${Date.now().toString(36)}`
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim()
const n = (sql) => Number(psql(sql))

const resultado = []
let area = ''
const secao = (t) => { area = t; console.log(`\n== ${t} ==`) }
const defesa = (ataque, segurou, evidencia = '') => {
  resultado.push({ area, ataque, segurou, evidencia })
  console.log(`   ${segurou ? 'SEGUROU' : 'FUROU  '}  ${ataque}${evidencia ? `  [${evidencia}]` : ''}`)
}
const achado = (texto) => { resultado.push({ area, ataque: texto, segurou: null }); console.log(`   ACHADO   ${texto}`) }

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
async function entrar(email, senha = SENHA) {
  const { data, error } = await createClient(API, ANON, opcoes).auth.signInWithPassword({ email, password: senha })
  if (error) throw new Error(`${email}: ${error.message}`)
  return { id: data.user.id, token: data.session.access_token, refresh: data.session.refresh_token }
}
const cli = (token, headers = {}) => createClient(API, ANON, { ...opcoes, global: { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } } })
const naAba = (q, clube) => cli(q.token, clube ? { 'x-clube-atual': clube } : {})
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

const q = {}
for (const k of ['so_a', 'so_b', 'so_b2', 'so_c', 'ab', 'abc', 'dir_a_membro_b', 'instrutor_ab', 'responsavel', 'coordenador', 'fundador_sem_clube']) q[k] = await entrar(P[k].email)
q.lider_a = await entrar('tenant001@local.test', 'local-test-only')
q.lider_b = await entrar('fundador.b@multiclube.local')
q.lider_c = await entrar('fundador.c@multiclube.local')
// um atacante "limpo": conta nova, sem clube, criada aqui
const emailAtacante = `atacante.${MARCA}@staging.local`
await createClient(API, ANON, opcoes).auth.signUp({ email: emailAtacante, password: SENHA })
psql(`update auth.users set email_confirmed_at = now() where email = '${emailAtacante}';`)
q.atacante = await entrar(emailAtacante)

// ===========================================================================
secao('1. código de entrada')
{
  const codigoC = (await naAba(q.lider_c, C.C).rpc('clube_codigo_gerar', { p_dias: 1 })).data?.codigo
  const { data: pub } = await naAba(q.atacante).rpc('entrada_abrir', { p_codigo: codigoC })
  const chaves = Object.keys(pub || {}).sort()
  const expoe = JSON.stringify(pub || {})
  defesa('o código só revela a identidade PÚBLICA do clube (sem id, sem membros, sem e-mail)',
    !expoe.includes(C.C) && !/@|membros|total|usuarios|email/.test(expoe), `chaves: ${chaves.join(',')}`)
  // pedir entrada NÃO dá acesso: pendente até a liderança decidir
  await naAba(q.atacante).rpc('entrada_solicitar', { p_codigo: codigoC })
  const { data: fotos } = await naAba(q.atacante, C.C).from('fotos').select('id')
  defesa('pedir entrada não abre o clube: o pendente não lê nada de C', (fotos || []).length === 0 && n(`select count(*) from public.fotos where club_id = '${C.C}'`) > 0)
  defesa('...e o vínculo nasce PENDENTE no banco', psql(`select status from public.organization_memberships where user_id = '${q.atacante.id}' and organizational_unit_id = '${C.C}'`) === 'pendente')
  // revogar mata o código na hora
  await naAba(q.lider_c, C.C).rpc('clube_codigo_revogar')
  const { data: rev } = await naAba(q.fundador_sem_clube).rpc('entrada_abrir', { p_codigo: codigoC })
  defesa('código revogado não abre mais', rev?.encontrado === false, JSON.stringify(rev))
  // oráculo: inexistente e revogado respondem igual
  const { data: inex } = await naAba(q.fundador_sem_clube).rpc('entrada_abrir', { p_codigo: 'AAAA-0000' })
  defesa('revogado e inexistente respondem com a MESMA forma (sem oráculo)', JSON.stringify(rev) === JSON.stringify(inex), `${JSON.stringify(rev)} vs ${JSON.stringify(inex)}`)
  // força bruta: 10 erros em 10 minutos travam a pessoa — inclusive para o código CERTO
  const codigoNovo = (await naAba(q.lider_c, C.C).rpc('clube_codigo_gerar', { p_dias: 1 })).data?.codigo
  let travou = false
  for (let i = 0; i < 12; i++) {
    const { error } = await naAba(q.atacante).rpc('entrada_abrir', { p_codigo: `ZZZZ-${String(1000 + i)}` })
    if (error && /tentativas/i.test(error.message)) { travou = true; break }
  }
  const { data: certo, error: eCerto } = await naAba(q.atacante).rpc('entrada_abrir', { p_codigo: codigoNovo })
  defesa('força bruta: depois de 10 erros, nem o código certo abre (limite por pessoa)', travou && (!!eCerto || !certo?.encontrado), eCerto?.message || JSON.stringify(certo))
  defesa('...e o limite é contado no banco (tentativas registradas)', n(`select count(*) from public.entrada_tentativas where user_id = '${q.atacante.id}' and not acertou`) >= 10)
  achado('o limite de entrada é POR CONTA: um atacante com N contas tem N×10 tentativas a cada 10 min. O código tem espaço grande e expira, mas o limite não é por IP.')
  // o código novo continua valendo para quem não abusou
  const { data: ok2 } = await naAba(q.fundador_sem_clube).rpc('entrada_abrir', { p_codigo: codigoNovo })
  defesa('quem não abusou continua entrando com o código certo', ok2?.encontrado === true)
}

// ===========================================================================
secao('2. convites')
{
  // convite de EQUIPE de B para a Bia; o atacante tenta aceitar
  await naAba(q.lider_b, C.B).rpc('convite_equipe_criar', { p_email: P.so_c.email, p_papel: 'conselheiro' })
  const idConvite = psql(`select id from public.club_team_invites where club_id = '${C.B}' and lower(email) = lower('${P.so_c.email}') and status = 'pendente' order by created_at desc limit 1`)
  const { error: e1 } = await naAba(q.atacante).rpc('convite_equipe_aceitar', { p_id: idConvite })
  defesa('o convite de equipe de OUTRA pessoa não é aceito pelo atacante (mesmo com o id)', !!e1 && n(`select count(*) from public.organization_memberships where user_id = '${q.atacante.id}' and organizational_unit_id = '${C.B}'`) === 0, e1?.message)
  const { data: vistos } = await naAba(q.atacante).rpc('convites_da_equipe')
  defesa('...e nem aparece na lista dele', !(vistos || []).some((c) => c.id === idConvite))
  await naAba(q.lider_b, C.B).rpc('convite_equipe_revogar', { p_id: idConvite })
  const { error: e2 } = await naAba(q.so_c).rpc('convite_equipe_aceitar', { p_id: idConvite })
  defesa('convite revogado não é aceito nem pela pessoa certa', !!e2 && n(`select count(*) from public.organization_memberships where user_id = '${q.so_c.id}' and organizational_unit_id = '${C.B}'`) === 0, e2?.message)
  // convite de RESPONSÁVEL: token usado por outra conta depois de usado
  const conv = (await naAba(q.lider_a, C.A).rpc('criar_convite_responsavel')).data
  await naAba(q.fundador_sem_clube).rpc('convite_aceitar', { p_token: conv.token })
  // uma SEGUNDA conta, limpa — o atacante da seção 1 já está travado pelo limite de tentativas, e a
  // recusa dele provaria o limite, não a proteção contra replay (foi o que o primeiro ensaio mediu)
  const email2 = `atacante2.${MARCA}@staging.local`
  await createClient(API, ANON, opcoes).auth.signUp({ email: email2, password: SENHA })
  psql(`update auth.users set email_confirmed_at = now() where email = '${email2}';`)
  q.atacante2 = await entrar(email2)
  const { data: r2, error: eR2 } = await naAba(q.atacante2).rpc('convite_aceitar', { p_token: conv.token })
  defesa('token de responsável já usado não serve para uma segunda conta (replay)',
    !eR2 && r2?.encontrado === false && n(`select count(*) from public.organization_memberships where user_id = '${q.atacante2.id}'`) === 0,
    eR2?.message || JSON.stringify(r2))
  // e ser "responsável" em A não dá nenhum filho sem aprovação
  const { data: filhos } = await naAba(q.fundador_sem_clube, C.A).rpc('meus_filhos')
  defesa('entrar como responsável por convite não entrega filho nenhum sem aprovação da liderança', (filhos || []).length === 0)
  psql(`delete from public.organization_memberships where user_id = '${q.fundador_sem_clube.id}' and organizational_unit_id = '${C.A}';`)
}

// ===========================================================================
secao('3. pessoa em vários clubes: poder de um clube usado em outro')
{
  // Vera é DIRETORIA em A e desbravadora em B
  const { error: e1 } = await naAba(q.dir_a_membro_b, C.B).rpc('vinculo_gerir', { p_user_id: P.so_b.id, p_status: 'inativo' })
  defesa('Vera (diretoria de A) na aba B não gere membro de B', !!e1 && psql(`select status from public.organization_memberships where user_id = '${P.so_b.id}' and organizational_unit_id = '${C.B}'`) === 'ativo', e1?.message)
  const { error: e2 } = await naAba(q.dir_a_membro_b, C.A).rpc('vinculo_gerir', { p_user_id: P.so_b.id, p_status: 'inativo' })
  defesa('...nem na aba A, apontando para alguém que só é de B', !!e2 && psql(`select status from public.organization_memberships where user_id = '${P.so_b.id}' and organizational_unit_id = '${C.B}'`) === 'ativo', e2?.message)
  const { data: fila } = await naAba(q.dir_a_membro_b, C.B).rpc('entradas_pendentes')
  defesa('Vera na aba B não vê a fila de aprovação de B', !fila || fila.length === 0 || fila.error)
  // Ivo é instrutor em A e B: aprovação de requisito de B pela aba A
  const mrB = psql(`select mr.id from public.member_requirements mr join public.member_classes mc on mc.id = mr.member_class_id where mc.club_id = '${C.B}' limit 1`)
  const antes = psql(`select status from public.member_requirements where id = '${mrB}'`)
  await naAba(q.instrutor_ab, C.A).rpc('requisito_avaliar', { p_member_requirement_id: mrB, p_decisao: 'reprovado', p_comentario: MARCA })
  defesa('Ivo (instrutor de A e B), na aba A, não mexe em requisito de B', psql(`select status from public.member_requirements where id = '${mrB}'`) === antes)
}

// ===========================================================================
secao('4. vínculo suspenso / removido')
{
  const conta = async () => (await naAba(q.so_b2, C.B).from('fotos').select('id')).data?.length || 0
  const antes = await conta()
  await naAba(q.lider_b, C.B).rpc('vinculo_gerir', { p_user_id: P.so_b2.id, p_status: 'inativo' })
  const depois = await conta()
  const { error: eEsc } = await naAba(q.so_b2, C.B).from('fotos').insert({ url: `mural/${P.so_b2.id}-${MARCA}.jpg`, evento: 'RT', legenda: MARCA, autor_id: P.so_b2.id })
  defesa('suspenso: com o MESMO token de antes, perde a leitura de B na hora', antes > 0 && depois === 0, `${antes} → ${depois}`)
  defesa('...e a escrita', !!eEsc && n(`select count(*) from public.fotos where legenda = '${MARCA}'`) === 0)
  const ctx = (await naAba(q.so_b2).rpc('meu_contexto')).data
  defesa('...e o contexto não oferece mais B como ativo', !(ctx?.vinculos || []).some((v) => v.club_id === C.B && v.status === 'ativo'))
  await naAba(q.lider_b, C.B).rpc('vinculo_gerir', { p_user_id: P.so_b2.id, p_status: 'ativo' })
  defesa('reativado, volta (o controle é o vínculo, não o token)', (await conta()) === antes)
}

// ===========================================================================
secao('5. Storage')
{
  const tentativas = [
    ['subir na pasta de comprovação de OUTRA criança', 'comprovacoes', `${P.so_a.id}/classe/${MARCA}.jpg`, q.so_b, C.B],
    ['subir no mural com o id de OUTRA pessoa no nome', 'imagens', `mural/${P.so_a.id}-${MARCA}.jpg`, q.so_b, C.B],
    ['path traversal para a pasta de outra criança', 'comprovacoes', `${P.so_b.id}/../${P.so_a.id}/${MARCA}.jpg`, q.so_b, C.B],
    ['subir no bucket público sem ser liderança', 'publico', `${C.B}/${MARCA}.jpg`, q.so_b, C.B],
    ['subir num prefixo de pasta inventado', 'imagens', `admin/${MARCA}.jpg`, q.so_b, C.B],
  ]
  for (const [nome, bucket, caminho, quem, aba] of tentativas) {
    const antes = n(`select count(*) from storage.objects where name like '%${MARCA}%'`)
    const { error } = await naAba(quem, aba).storage.from(bucket).upload(caminho, JPEG, { contentType: 'image/jpeg', upsert: true })
    defesa(nome, !!error && n(`select count(*) from storage.objects where name like '%${MARCA}%'`) === antes, error?.message?.slice(0, 60) || 'SUBIU')
  }
  // sobrescrever o arquivo EXISTENTE de outra pessoa com upsert
  const alheio = psql(`select name from storage.objects where bucket_id = 'imagens' and name like 'mural/${P.so_a.id}-%' limit 1`)
  const etag0 = psql(`select coalesce(metadata->>'eTag', updated_at::text) from storage.objects where bucket_id = 'imagens' and name = '${alheio}'`)
  const { error: eOver } = await naAba(q.ab, C.A).storage.from('imagens').upload(alheio, JPEG, { contentType: 'image/jpeg', upsert: true })
  defesa('sobrescrever (upsert) a foto de outra pessoa do MESMO clube', !!eOver && psql(`select coalesce(metadata->>'eTag', updated_at::text) from storage.objects where bucket_id = 'imagens' and name = '${alheio}'`) === etag0, eOver?.message?.slice(0, 60))
  // listagem do mural: quem é de C lista só arquivos de gente de C
  const { data: lista } = await naAba(q.so_c, C.C).storage.from('imagens').list('mural', { limit: 1000 })
  const autores = [...new Set((lista || []).map((o) => o.name.slice(0, 36)))]
  const deFora = autores.filter((id) => n(`select count(*) from public.organization_memberships where user_id = '${id}' and organizational_unit_id = '${C.C}'`) === 0)
  defesa('listar o mural (Storage) em C só traz arquivos de gente de C', deFora.length === 0, `${(lista || []).length} arquivos, ${deFora.length} autor(es) de fora`)
  // baixar a foto do mural de A estando só em C
  const { data: fotoA } = await naAba(q.so_c, C.C).storage.from('imagens').download(alheio)
  defesa('baixar a foto do mural de A sendo só de C', !fotoA)
  // URL pública "adivinhada" do bucket privado
  const r = await fetch(`${API}/storage/v1/object/public/imagens/${alheio}`)
  defesa('URL pública de um arquivo do bucket PRIVADO não abre', r.status >= 400, `HTTP ${r.status}`)
}

// ===========================================================================
secao('6. evidência de criança')
{
  const evid = psql(`select name from storage.objects where bucket_id = 'comprovacoes' and name like '${P.so_a.id}/%' limit 1`)
  for (const [nome, quem, aba] of [['outra criança do MESMO clube (Davi, só A)', await entrar(P.so_a2.email), C.A],
    ['membro de outro clube (Bia)', q.so_b, C.B], ['liderança de outro clube (B)', q.lider_b, C.B], ['coordenador distrital (A está no distrito)', q.coordenador, undefined], ['atacante sem clube', q.atacante, undefined]]) {
    const { data: url } = await naAba(quem, aba).storage.from('comprovacoes').createSignedUrl(evid, 60)
    const { data: blob } = await naAba(quem, aba).storage.from('comprovacoes').download(evid)
    defesa(`${nome}: nem URL assinada, nem download da evidência de Ana`, !url?.signedUrl && !blob)
  }
  const { data: urlLider } = await naAba(q.lider_a, C.A).storage.from('comprovacoes').createSignedUrl(evid, 60)
  defesa('a liderança do clube DELA vê (para avaliar) — o acesso certo continua funcionando', !!urlLider?.signedUrl)
  const { data: urlResp } = await naAba(q.responsavel, C.A).storage.from('comprovacoes').createSignedUrl(evid, 60)
  achado(`a responsável aprovada de Ana ${urlResp?.signedUrl ? 'CONSEGUE' : 'NÃO consegue'} abrir a evidência de classe da filha (decisão de produto a registrar)`)
}

// ===========================================================================
secao('7. APIs / RPC')
{
  const anon = psql(`select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)
  const lista = anon.split(',').filter(Boolean)
  console.log(`   ·        funções executáveis por ANON: ${lista.length ? lista.join(', ') : '(nenhuma)'}`)
  // cada uma chamada de verdade, sem login
  let respondeuDado = []
  for (const f of lista) {
    const r = await fetch(`${API}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}' })
    const corpo = await r.text()
    if (r.ok && corpo && !['null', '[]', '{}', 'false'].includes(corpo.trim())) respondeuDado.push(`${f}=${corpo.slice(0, 60)}`)
  }
  defesa('nenhuma RPC devolve dado a quem não entrou', respondeuDado.length === 0, respondeuDado.join(' | ') || `${lista.length} testadas`)
  // tabelas pela API sem login
  let tabelasAbertas = []
  for (const t of ['profiles', 'fotos', 'mensalidades', 'organization_memberships', 'club_invites', 'entrada_tentativas', 'app_erros', 'class_documents']) {
    const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON } })
    const corpo = await r.text()
    if (r.ok && corpo.trim() !== '[]') tabelasAbertas.push(t)
  }
  defesa('nenhuma tabela responde linha para anônimo', tabelasAbertas.length === 0, tabelasAbertas.join(','))
  // RPC de liderança com id de OUTRO clube
  const { error: eR } = await naAba(q.lider_b, C.B).rpc('resetar_senha_membro', { alvo: P.so_a.id, nova_senha: 'Invadido123!' })
  const senhaMudou = await createClient(API, ANON, opcoes).auth.signInWithPassword({ email: P.so_a.email, password: 'Invadido123!' })
  defesa('a liderança de B não troca a senha de uma criança de A', !!eR && !senhaMudou.data?.session, eR?.message)
}

// ===========================================================================
secao('8. manipulação de headers')
{
  const variantes = {
    'lista "A,B"': `${C.A},${C.B}`,
    'lista "B, A"': `${C.B}, ${C.A}`,
    'JSON': JSON.stringify([C.A]),
    'maiúsculas (A)': C.A.toUpperCase(),
    'espaços': ` ${C.A} `,
    'injeção SQL': `${C.A}' or '1'='1`,
    'uuid nulo': '00000000-0000-0000-0000-000000000000',
  }
  for (const [nome, h] of Object.entries(variantes)) {
    const { data } = await cli(q.so_b.token, { 'x-clube-atual': h }).from('fotos').select('club_id')
    const clubes = [...new Set((data || []).map((r) => r.club_id))]
    defesa(`Bia (só B) com x-clube-atual ${nome}: nunca vê A`, !clubes.includes(C.A), clubes.join(','))
  }
  // quem É de A, com A em maiúsculas: o servidor deve reconhecer (é o mesmo uuid) — não é furo
  const { data: m } = await cli(q.so_a.token, { 'x-clube-atual': C.A.toUpperCase() }).rpc('meu_contexto')
  console.log(`   ·        Ana com A em maiúsculas → clube em uso ${m?.clube_atual_id === C.A ? 'A (mesmo uuid)' : String(m?.clube_atual_id)}`)
  // escopo institucional forjado
  const { data: esc } = await cli(q.so_a.token, { 'x-escopo-atual': P.coordenador.distrito }).rpc('escopo_painel')
  defesa('um membro com x-escopo-atual = distrito não abre o painel institucional', !esc || (Array.isArray(esc) && esc.length === 0) || esc?.clubes === undefined, JSON.stringify(esc)?.slice(0, 80))
}

// ===========================================================================
secao('9. rate limit')
{
  // pedir ajuda: 5 a cada 5 min
  let barrou = 0
  for (let i = 0; i < 7; i++) {
    const { error } = await naAba(q.ab, C.B).rpc('pedir_ajuda', { p_para: P.so_b.id, p_jogo: 'forca', p_enunciado: { palavra: 'x' }, p_resposta: MARCA })
    if (error && /demais/.test(error.message)) barrou++
  }
  defesa('pedir ajuda: o 6º pedido em 5 minutos é barrado', barrou >= 1, `barrados=${barrou}`)
  // chat: quantas mensagens seguidas passam
  let enviadas = 0
  for (let i = 0; i < 40; i++) {
    const { error } = await naAba(q.so_a, C.A).rpc('chat_enviar_geral', { p_texto: `${MARCA} ${i}` })
    if (!error) enviadas++
    else break
  }
  if (enviadas >= 40) achado(`chat geral: ${enviadas} mensagens seguidas em segundos, sem limite — um membro pode inundar o chat do clube`)
  else defesa('chat geral: há limite de envio', true, `${enviadas} passaram antes de barrar`)
}

// ===========================================================================
secao('10. logout / troca de identidade')
{
  const s = await entrar(P.so_c.email)
  const sb = createClient(API, ANON, opcoes)
  await sb.auth.setSession({ access_token: s.token, refresh_token: s.refresh })
  await sb.auth.signOut({ scope: 'global' })
  const { error } = await createClient(API, ANON, opcoes).auth.refreshSession({ refresh_token: s.refresh })
  defesa('depois do logout, o refresh token não gera sessão nova', !!error)
  const r = await fetch(`${API}/rest/v1/rpc/meu_contexto`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: '{}' })
  achado(`depois do logout, o access token antigo ainda responde HTTP ${r.status} até expirar (jwt_expiry = 3600 s). Mitigação: expiração menor; o vínculo continua sendo checado a cada requisição.`)
}

// ---------------------------------------------------------------------------
//  Limpeza (fora da RLS) e o placar
// ---------------------------------------------------------------------------
psql(`delete from public.chat_mensagens where texto like '${MARCA}%';
      delete from public.ajudas where resposta = '${MARCA}';
      delete from public.notificacoes where criado_por = '${P.ab.id}' and titulo like '%ajuda%' and created_at > now() - interval '10 minutes';
      delete from public.entrada_tentativas where user_id = '${q.atacante.id}';
      delete from public.organization_memberships where user_id = '${q.atacante.id}';
      delete from public.club_team_invites where club_id = '${C.B}' and lower(email) = lower('${P.so_c.email}');
      delete from public.entrada_tentativas where user_id = '${q.atacante2?.id}';
      delete from auth.users where email in ('${emailAtacante}', 'atacante2.${MARCA}@staging.local');`)
console.log('\n   ·        limpeza feita: mensagens, ajudas, tentativas, convites e a conta do atacante')

const furos = resultado.filter((r) => r.segurou === false)
const achados = resultado.filter((r) => r.segurou === null)
console.log('\n==============================================================')
console.log(` ${resultado.filter((r) => r.segurou).length} ataques SEGURADOS · ${furos.length} FURO(S) · ${achados.length} achado(s) para o relatório`)
for (const f of furos) console.log(`   FURO   [${f.area}] ${f.ataque} — ${f.evidencia}`)
for (const a of achados) console.log(`   ACHADO [${a.area}] ${a.ataque}`)
console.log('==============================================================')
process.exit(furos.length === 0 ? 0 : 1)
