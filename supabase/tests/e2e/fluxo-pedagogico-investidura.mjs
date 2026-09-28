// =============================================================================
//  Fluxo pedagógico COMPLETO de ponta a ponta, por HTTP, contra o Supabase LOCAL de verdade
//  (rodada de 28/09 — "o código existe mas nunca foi usado inteiro"):
//
//    desbravador → classe → requisito → envia texto+foto → instrutor pede correção → desbravador
//    reenvia → histórico guarda as 2 tentativas → instrutor aprova → conclui → revisão do clube →
//    DISTRITO → REGIÃO → apto (workflow v2, migration 330) → devolução do distrito com requisito
//    marcado → volta ao clube → reenvio → aprova de novo → apto → investidura → documento → PDF real
//    (Edge Function) → hash → revisão documental → assinatura (quem pode / quem não pode) →
//    revogação de assinatura com motivo → verificação pública.
//
//  Cada chamada usa o mecanismo REAL do app: login por senha, header x-clube-atual / x-escopo-atual
//  (src/lib/supabase.js). Nada de SQL para "adiantar" etapa — SQL só no preparo (contas de teste) e
//  para conferir o que a API não expõe.
//
//  Pré-requisitos: stack local no ar + `node supabase/tests/e2e/_seed_homologacao.mjs` (contas hml-*).
//  Uso:  node supabase/tests/e2e/fluxo-pedagogico-investidura.mjs
//  Cria e apaga o que é dele (prefixo "e2e-fluxo-"); a matrícula de classe do hml-desbravador é
//  apagada no início. NUNCA toca em produção: a URL é fixa em 127.0.0.1.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA = 'senha-homologacao-123'
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
let total = 0, reprovados = 0
function ok(nome, cond, detalhe = '') { total++; if (!cond) { reprovados++; console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`) }
const recusou = (r) => !!r.error || r.data == null || (Array.isArray(r.data) && r.data.length === 0)

async function logar(email) {
  let clube = null, escopo = null
  const f = (input, init) => {
    const o = { ...(init || {}) }; const h = new Headers(o.headers || {})
    if (clube) h.set('x-clube-atual', clube)
    if (escopo) h.set('x-escopo-atual', escopo)
    o.headers = h; return fetch(input, o)
  }
  const c = createClient(API_URL, ANON, { auth: { persistSession: false }, global: { fetch: f } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { c, uid: data.user.id, clube: (id) => { clube = id; escopo = null }, escopo: (id) => { escopo = id; clube = null } }
}

function limpar() {
  sql(`
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'e2e-fluxo-%@teste.local');
    delete from auth.users where email like 'e2e-fluxo-%@teste.local';
    delete from public.organizational_units where slug = 'e2e-fluxo-regiao-x';
  `)
}

async function principal() {
  const id = (slug) => sql(`select id from public.organizational_units where slug='${slug}';`)
  const clubeA = id('hml-clube-a'), clubeB = id('hml-clube-b'), distA = id('hml-distrito-a'), distB = id('hml-distrito-b'), regiao = id('hml-regiao')
  if (!clubeA || !distA || !regiao) throw new Error('rode antes: node supabase/tests/e2e/_seed_homologacao.mjs')

  // ---------- preparo: só contas de teste e dado de conteúdo dinâmico (nada do fluxo) ----------
  limpar()
  sql(`
    delete from public.member_classes where usuario_id = md5('hml:desbravador')::uuid;
    insert into public.organizational_units (type, nome, slug, pais, timezone) values ('regiao', 'E2E Fluxo Regiao X', 'e2e-fluxo-regiao-x', 'BR', 'America/Recife');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e,
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, jsonb_build_object('nome', n), now(), now(), '', '', '', '', '', '', '', '', false, false
    from (values ('e2e-fluxo-dist-b@teste.local', 'E2E Coord Distrito B'), ('e2e-fluxo-reg-x@teste.local', 'E2E Coord Regiao X')) v(e, n);
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'e2e-fluxo-%@teste.local');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select u.id, '${distB}', 'coordenador_distrital', 'ativo' from auth.users u where u.email = 'e2e-fluxo-dist-b@teste.local';
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select u.id, (select id from public.organizational_units where slug = 'e2e-fluxo-regiao-x'), 'coordenador_regional', 'ativo'
      from auth.users u where u.email = 'e2e-fluxo-reg-x@teste.local';
    insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
    select d.id, extract(year from public._data_no_brasil())::int, 'Livro do ano [FIXTURE DE TESTE E2E-FLUXO]',
           make_date(extract(year from public._data_no_brasil())::int, 1, 1), make_date(extract(year from public._data_no_brasil())::int, 12, 31),
           'https://exemplo.test/fixture', 'FIXTURE DE TESTE E2E-FLUXO — não é o livro oficial'
    from public.dynamic_content_definitions d where d.chave = 'curso_leitura_amigo'
      and not exists (select 1 from public.dynamic_content_values v where v.definicao_id = d.id and v.ano = extract(year from public._data_no_brasil())::int);
  `)

  const L = async (k) => logar(`hml-${k}@teste.local`)
  const desb = await L('desbravador'), instr = await L('instrutor'), dirA = await L('diretoria_a'), dirB = await L('diretoria_b')
  const desb2 = await L('desbravador2'), coordDist = await L('coord_dist'), coordReg = await L('coord_reg')
  const distBCoord = await logar('e2e-fluxo-dist-b@teste.local'), regX = await logar('e2e-fluxo-reg-x@teste.local')
  desb.clube(clubeA); instr.clube(clubeA); dirA.clube(clubeA); dirB.clube(clubeB); desb2.clube(clubeB)
  coordDist.escopo(distA); coordReg.escopo(regiao); distBCoord.escopo(distB); regX.escopo(id('e2e-fluxo-regiao-x'))
  console.log('== preparo: 9 contas logadas (desbravador, instrutor, 2 diretorias, outra criança, 4 coordenações) ==')

  // ---------- 1) desbravador inicia a classe e envia texto + FOTO ----------
  console.log('\n== 1) desbravador → classe → requisito → envia texto + foto ==')
  const { data: classe } = await desb.c.from('classes').select('id').eq('manifesto_id', 'amigo').limit(1).single()
  const ini = await desb.c.rpc('classe_iniciar', { p_class_id: classe.id })
  ok('desbravador inicia a classe Amigo', !ini.error && !!ini.data?.member_class_id, ini.error?.message)
  const mc = ini.data.member_class_id
  const minha = async () => (await desb.c.rpc('minha_classe', { p_member_class_id: mc })).data
  let m = await minha()
  const todos = m.secoes.flatMap((s) => s.requisitos)
  const reqFoto = todos.find((r) => !r.escolha && r.tipo_evidencia === 'foto')
  const reqTexto = todos.find((r) => !r.escolha && r.tipo_evidencia === 'texto' && r.id !== reqFoto?.id)
  ok('a classe tem um requisito de foto e um de texto para o teste', !!reqFoto && !!reqTexto)

  const subirFoto = async (sessao, rotulo) => {
    const path = `${sessao.uid}/requisitos/e2e-fluxo-${rotulo}-${Date.now()}.png`
    const up = await sessao.c.storage.from('comprovacoes').upload(path, PNG, { contentType: 'image/png', upsert: false })
    if (up.error) throw new Error('upload: ' + up.error.message)
    return path
  }
  const foto1 = await subirFoto(desb, 'tentativa1')
  const s1 = await desb.c.rpc('requisito_salvar', { p_requirement_id: reqFoto.id, p_texto: 'Primeira tentativa [E2E-FLUXO]', p_evidencia_path: foto1 })
  const e1 = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqFoto.id })
  ok('envia o requisito de foto (texto + foto no bucket privado)', !s1.error && !e1.error, s1.error?.message || e1.error?.message)
  const anonimo = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const fotoAnon = await anonimo.storage.from('comprovacoes').download(foto1)
  ok('a foto da criança NÃO é baixável sem login (bucket privado)', !!fotoAnon.error)
  const fotoOutroClube = await dirB.c.storage.from('comprovacoes').download(foto1)
  ok('...nem pela diretoria de OUTRO clube', !!fotoOutroClube.error)

  // ---------- 2) instrutor pede correção; quem não pode, não consegue ----------
  console.log('\n== 2) instrutor avalia e pede correção ==')
  const fila = async (s) => (await s.c.rpc('classe_avaliacoes_pendentes')).data || []
  const item1 = (await fila(instr)).find((p) => p.requisito_id === reqFoto.id)
  ok('a tentativa aparece na fila do instrutor, com a foto', !!item1 && item1.tentativa_numero === 1 && item1.evidencia_path === foto1)
  const fotoInstr = await instr.c.storage.from('comprovacoes').download(foto1)
  ok('o instrutor do clube consegue abrir a foto', !fotoInstr.error, fotoInstr.error?.message)
  const autoAval = await desb.c.rpc('requisito_avaliar', { p_member_requirement_id: item1.member_requirement_id, p_decisao: 'aprovado', p_submission_id: item1.submission_id })
  ok('o desbravador NÃO aprova o próprio requisito', !!autoAval.error)
  const avalB = await dirB.c.rpc('requisito_avaliar', { p_member_requirement_id: item1.member_requirement_id, p_decisao: 'aprovado', p_submission_id: item1.submission_id })
  ok('a diretoria de OUTRO clube não avalia', !!avalB.error)
  ok('a diretoria de OUTRO clube não vê a fila deste clube', !(await fila(dirB)).some((p) => p.member_requirement_id === item1.member_requirement_id))
  const semMotivo = await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: item1.member_requirement_id, p_decisao: 'correcao_solicitada', p_comentario: '', p_submission_id: item1.submission_id })
  ok('pedir correção sem explicar é recusado', !!semMotivo.error)
  const corr = await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: item1.member_requirement_id, p_decisao: 'correcao_solicitada', p_comentario: 'Mostre o desenho inteiro [E2E-FLUXO]', p_submission_id: item1.submission_id })
  ok('instrutor pede correção com explicação', !corr.error, corr.error?.message)

  // ---------- 3) desbravador reenvia; histórico guarda as 2 tentativas ----------
  console.log('\n== 3) desbravador reenvia; o histórico preserva as duas tentativas ==')
  m = await minha()
  const r1 = m.secoes.flatMap((s) => s.requisitos).find((r) => r.id === reqFoto.id)
  ok('o desbravador vê "correção solicitada" e o comentário', r1?.status === 'correcao_solicitada' && JSON.stringify(r1).includes('Mostre o desenho inteiro'), r1?.status)
  const foto2 = await subirFoto(desb, 'tentativa2')
  const s2 = await desb.c.rpc('requisito_salvar', { p_requirement_id: reqFoto.id, p_texto: 'Segunda tentativa, desenho inteiro [E2E-FLUXO]', p_evidencia_path: foto2 })
  const e2 = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqFoto.id })
  ok('reenvia com texto e foto novos', !s2.error && !e2.error, s2.error?.message || e2.error?.message)
  const velha = await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: item1.member_requirement_id, p_decisao: 'aprovado', p_submission_id: item1.submission_id })
  ok('avaliar a tentativa ANTIGA é recusado (não aprova o que foi corrigido)', !!velha.error)
  const hist = (await instr.c.rpc('requisito_historico', { p_member_requirement_id: item1.member_requirement_id })).data
  const tent = hist?.tentativas || []
  ok('histórico tem as 2 tentativas', tent.length === 2, JSON.stringify(tent.map((t) => t.tentativa_numero)))
  const t1 = tent.find((t) => t.tentativa_numero === 1), t2 = tent.find((t) => t.tentativa_numero === 2)
  ok('tentativa 1 preservada: texto, foto e a decisão de correção', t1?.evidencia_texto?.includes('Primeira tentativa') && t1?.evidencia_path === foto1 && JSON.stringify(t1).includes('correcao_solicitada'))
  ok('tentativa 2 com o texto e a foto novos', t2?.evidencia_texto?.includes('Segunda tentativa') && t2?.evidencia_path === foto2)
  const _f1 = await instr.c.storage.from('comprovacoes').download(foto1)
  ok('a foto da 1ª tentativa continua no Storage (não foi apagada pelo reenvio)', !_f1.error, (_f1.error?.message || '') + ' objetos=' + sql(`select count(*) from storage.objects where bucket_id='comprovacoes' and name='${foto1}';`))

  // ---------- 4) conclui todos os requisitos ----------
  console.log('\n== 4) conclui a classe (todos os requisitos) ==')
  for (const r of todos) {
    if (r.id === reqFoto.id) continue
    if (r.escolha) {
      const op = r.escolha.opcoes?.[0]?.id
      await desb.c.rpc('requisito_escolher', { p_requirement_id: r.id, p_option_ids: op ? [op] : [], p_rotulos_livres: op ? [] : ['[E2E-FLUXO]'] })
    }
    if (!r.escolha || r.evidencia_obrigatoria) {
      const ev = r.evidencia_obrigatoria && r.tipo_evidencia === 'foto' ? await subirFoto(desb, 'req') : null
      await desb.c.rpc('requisito_salvar', { p_requirement_id: r.id, p_texto: '[E2E-FLUXO]', p_evidencia_path: ev })
    }
    const env = await desb.c.rpc('requisito_enviar', { p_requirement_id: r.id })
    if (env.error) throw new Error(`requisito_enviar ${r.codigo}: ${env.error.message}`)
  }
  for (let volta = 0; volta < 5; volta++) {
    const pend = (await fila(instr)).filter((p) => todos.some((r) => r.id === p.requisito_id))
    if (!pend.length) break
    for (const p of pend) {
      const a = await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: p.member_requirement_id, p_decisao: 'aprovado', p_comentario: 'ok [E2E-FLUXO]', p_submission_id: p.submission_id })
      if (a.error) throw new Error('avaliar: ' + a.error.message)
    }
  }
  const status = () => sql(`select status from public.member_classes where id = '${mc}';`)
  const etapa = () => sql(`select r.workflow_versao || '|' || r.current_stage_ordem || '|' || r.status from public.investiture_workflow_runs r
     join public.class_completion_snapshots sn on sn.id = r.snapshot_id where r.member_class_id = '${mc}' order by sn.versao desc limit 1;`)
  ok('todos aprovados: a classe vai para a revisão do clube', status() === 'aguardando_revisao', status())
  ok('a conclusão abriu corrida no workflow v2 (4 etapas), etapa 1', etapa() === '2|1|em_andamento', etapa())

  // ---------- 5) revisão do clube → distrito ----------
  console.log('\n== 5) revisão do clube → distrito ==')
  const cedo = await coordDist.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado' })
  ok('o distrito NÃO decide antes da revisão do clube', !!cedo.error)
  const rev = await instr.c.rpc('revisao_final_decidir', { p_member_class_id: mc, p_decisao: 'aprovado', p_observacao: 'Clube confere [E2E-FLUXO]' })
  ok('instrutor aprova a revisão do clube', !rev.error, rev.error?.message)
  ok('a corrida está na etapa 2 (distrito)', etapa() === '2|2|em_andamento', etapa())

  console.log('\n== 6) acesso por escopo: quem não é da árvore não vê nem decide ==')
  const cartao = async (s) => s.c.rpc('investidura_cartao', { p_member_class_id: mc })
  const pend = async (s) => ((await s.c.rpc('escopo_investiduras_pendentes')).data || [])
  ok('distrito ERRADO não vê o cartão', recusou(await cartao(distBCoord)))
  ok('distrito ERRADO não recebe na fila', !(await pend(distBCoord)).some((p) => p.member_class_id === mc))
  ok('distrito ERRADO não decide', !!(await distBCoord.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado' })).error)
  ok('região ERRADA não vê o cartão', recusou(await cartao(regX)))
  ok('a região certa NÃO decide antes do distrito', !!(await coordReg.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado' })).error)
  ok('clube ERRADO (diretoria do B) não vê o cartão', recusou(await cartao(dirB)))
  ok('outra criança (clube B) não vê o cartão', recusou(await cartao(desb2)))
  ok('a diretoria do próprio clube não decide a etapa do distrito', !!(await dirA.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado' })).error)
  ok('o distrito certo recebe na fila', (await pend(coordDist)).some((p) => p.member_class_id === mc))
  const cart = await cartao(coordDist)
  ok('o distrito certo vê o cartão completo (requisitos com texto e foto)', !cart.error && JSON.stringify(cart.data).includes('Segunda tentativa') && JSON.stringify(cart.data).includes(foto2), cart.error?.message)
  const txt = JSON.stringify(cart.data || {})
  ok('o cartão da coordenação não traz e-mail, telefone, nascimento, financeiro nem chat',
    !/@teste\.local|nascimento|telefone|whatsapp|mensalidade|financeiro|chat|mensagem/i.test(txt))
  ok('coordenação vê a foto só enquanto é a etapa dela', !(await coordDist.c.storage.from('comprovacoes').download(foto2)).error)
  ok('...e a coordenação de OUTRO distrito não abre a foto', !!(await distBCoord.c.storage.from('comprovacoes').download(foto2)).error)
  const outraAba = await coordDist.c.from('mensalidades').select('id').limit(1)
  ok('coordenação não lê mensalidades do clube', recusou(outraAba))
  const chat = await coordDist.c.from('chat_mensagens').select('id').limit(1)
  ok('coordenação não lê o chat do clube', recusou(chat))

  // ---------- 7) distrito DEVOLVE com requisito marcado ----------
  console.log('\n== 7) distrito devolve com requisito marcado → volta ao clube ==')
  const mrTexto = sql(`select mr.id from public.member_requirements mr where mr.member_class_id = '${mc}' and mr.requirement_id = '${reqTexto.id}';`)
  const devSem = await coordDist.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'devolvido', p_comentario: ' ' })
  ok('devolver sem motivo é recusado', !!devSem.error)
  const dev = await coordDist.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'devolvido', p_comentario: 'Faltou detalhe no requisito [E2E-FLUXO]',
    p_correcoes: [{ member_requirement_id: mrTexto, comentario: 'Detalhe melhor este requisito [E2E-FLUXO]' }] })
  ok('distrito devolve com motivo e 1 requisito marcado', !dev.error, dev.error?.message)
  ok('a matrícula volta a "em andamento"', status() === 'em_andamento', status())
  m = await minha()
  const rT = m.secoes.flatMap((s) => s.requisitos).find((r) => r.id === reqTexto.id)
  ok('o requisito marcado volta para correção, com o comentário do distrito', rT?.status === 'correcao_solicitada' && JSON.stringify(rT).includes('Detalhe melhor'), rT?.status)
  ok('o requisito NÃO marcado continua aprovado', m.secoes.flatMap((s) => s.requisitos).find((r) => r.id === reqFoto.id)?.status === 'aprovado')
  const hw = (await instr.c.rpc('workflow_historico', { p_member_class_id: mc })).data
  ok('o histórico do workflow guarda a devolução e o motivo (nada foi apagado)', JSON.stringify(hw || {}).includes('Faltou detalhe'))

  // ---------- 8) reenvio → clube → distrito → região → APTO ----------
  console.log('\n== 8) reenvio → clube → distrito → região → apto ==')
  await desb.c.rpc('requisito_salvar', { p_requirement_id: reqTexto.id, p_texto: 'Agora com detalhe [E2E-FLUXO]', p_evidencia_path: null })
  const re = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqTexto.id })
  ok('desbravador reenvia o requisito devolvido', !re.error, re.error?.message)
  const pT = (await fila(instr)).find((p) => p.requisito_id === reqTexto.id)
  await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: pT.member_requirement_id, p_decisao: 'aprovado', p_comentario: 'ok [E2E-FLUXO]', p_submission_id: pT.submission_id })
  ok('clube reaprova: nova conclusão selada, corrida NOVA na etapa 1', status() === 'aguardando_revisao' && etapa() === '2|1|em_andamento', `${status()} ${etapa()}`)
  await instr.c.rpc('revisao_final_decidir', { p_member_class_id: mc, p_decisao: 'aprovado', p_observacao: 'Clube confere de novo [E2E-FLUXO]' })
  const dOk = await coordDist.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado', p_comentario: 'Distrito confere [E2E-FLUXO]' })
  ok('distrito aprova', !dOk.error && etapa() === '2|3|em_andamento', dOk.error?.message || etapa())
  ok('distrito que já aprovou não decide a etapa da região', !!(await coordDist.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado' })).error)
  const rOk = await coordReg.c.rpc('coordenacao_investidura_decidir', { p_member_class_id: mc, p_decisao: 'aprovado', p_comentario: 'Região confere [E2E-FLUXO]' })
  ok('região aprova → APTO à investidura (etapa 4)', !rOk.error && status() === 'apto_investidura' && etapa() === '2|4|em_andamento', rOk.error?.message || `${status()} ${etapa()}`)
  // desenho da 330: quem aprovou uma etapa segue vendo o cartão ENQUANTO a corrida está em andamento
  // (apto = etapa 4, ainda em andamento); o corte é quando a corrida termina, na investidura (seção 9)
  ok('apto: o distrito que aprovou ainda vê a foto (corrida em andamento, regra da 330)', !(await coordDist.c.storage.from('comprovacoes').download(foto2)).error)
  const snaps = sql(`select count(*) from public.class_completion_snapshots where member_class_id = '${mc}';`)
  ok('as duas conclusões seladas ficaram guardadas (histórico não perdido)', Number(snaps) >= 2, snaps)

  // ---------- 9) investidura → documento → PDF ----------
  console.log('\n== 9) investidura → documento → PDF real ==')
  ok('o desbravador não registra a própria investidura', !!(await desb.c.rpc('investidura_registrar', { p_member_class_id: mc })).error)
  const inv = await dirA.c.rpc('investidura_registrar', { p_member_class_id: mc, p_data: new Date().toISOString().slice(0, 10), p_observacao: 'Investidura [E2E-FLUXO]' })
  ok('diretoria registra a investidura', !inv.error && inv.data?.status === 'investida', inv.error?.message)
  ok('investida: a corrida terminou', sql(`select status from public.investiture_workflow_runs where member_class_id = '${mc}' order by created_at desc limit 1;`) !== 'em_andamento')
  ok('investida: o distrito não abre mais a foto', !!(await coordDist.c.storage.from('comprovacoes').download(foto2)).error)
  ok('investida: nem vê mais o cartão', recusou(await cartao(coordDist)))
  const emitB = await dirB.c.rpc('documento_emitir', { p_member_class_id: mc, p_tipo: 'final' })
  ok('diretoria de OUTRO clube não emite o documento', !!emitB.error)
  const doc = await dirA.c.rpc('documento_emitir', { p_member_class_id: mc, p_tipo: 'final' })
  ok('documento emitido', !doc.error && !!doc.data?.token, doc.error?.message)
  const token = doc.data.token
  const conteudo = (await dirA.c.rpc('documento_conteudo', { p_token: token })).data
  const cj = JSON.stringify(conteudo || {})
  ok('conteúdo: nome da pessoa, clube e classe corretos', cj.includes('Hml Desbravador') && cj.includes('Amigo') && /Hml Clube A/i.test(cj), cj.slice(0, 200))
  // (o rótulo da OPÇÃO escolhida num requisito de escolha pertence ao cartão; o que não pode sair é
  //  o TEXTO/FOTO da evidência, e-mail ou caminho de Storage)
  const proibido = /@teste\.local|comprovacoes|\/requisitos\/|Primeira tentativa|Segunda tentativa|Agora com detalhe/
  ok('conteúdo: sem e-mail, caminho de foto nem texto das evidências', !proibido.test(cj), (cj.match(new RegExp('.{0,60}(' + proibido.source + ').{0,30}', 'g')) || []).join(' || '))
  const pdf = await dirA.c.functions.invoke('gerar-documento-pdf', { body: { token } })
  ok('Edge Function gerou o PDF', pdf.data?.ok === true, JSON.stringify(pdf.error || pdf.data))
  const reg = sql(`select pdf_hash || '|' || pdf_storage_path from public.class_documents where token_publico = '${token}';`).split('|')
  const url = await dirA.c.storage.from('documentos-emitidos').createSignedUrl(pdf.data?.storage_path || reg[1], 60)
  let hashOk = false
  if (url.data?.signedUrl) {
    const buf = Buffer.from(await (await fetch(url.data.signedUrl)).arrayBuffer())
    hashOk = buf.subarray(0, 5).toString() === '%PDF-' && crypto.createHash('sha256').update(buf).digest('hex') === reg[0]
  }
  ok('o PDF baixado é um PDF e o SHA-256 bate com o registrado', hashOk, url.error?.message || reg.join(' '))

  // ---------- 10) assinatura ----------
  console.log('\n== 10) assinatura: quem pode, quem não pode, revogação, verificação ==')
  const DECL = 'Declaro que revisei este documento [TESTE E2E-FLUXO].'
  ok('assinar antes da revisão documental é recusado', !!(await instr.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })).error)
  const revDoc = await dirA.c.rpc('documento_revisar', { p_token: token, p_decisao: 'aprovado' })
  ok('revisão documental aprovada', !revDoc.error, revDoc.error?.message)
  ok('sem a declaração, não assina', !!(await instr.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: '' })).error)
  ok('o desbravador NÃO assina', !!(await desb.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })).error)
  ok('diretoria de OUTRO clube NÃO assina', !!(await dirB.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })).error)
  ok('coordenação de OUTRO distrito NÃO assina', !!(await distBCoord.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })).error)
  const aI = await instr.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })
  ok('o instrutor (decidiu a revisão do clube) assina', !aI.error && !!aI.data?.signature_id, aI.error?.message)
  const aD = await coordDist.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })
  ok('o distrito (decidiu a etapa dele) assina', !aD.error && !!aD.data?.signature_id, aD.error?.message)
  const aR = await coordReg.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })
  ok('a região (decidiu a etapa dela) assina', !aR.error && !!aR.data?.signature_id, aR.error?.message)
  ok('assinar de novo é recusado com mensagem amigável', /já assinou/i.test((await instr.c.rpc('documento_assinar', { p_token: token, p_consentimento_texto: DECL })).error?.message || ''))
  const hashAntes = sql(`select pdf_hash from public.class_documents where token_publico = '${token}';`)
  ok('outra pessoa NÃO revoga a assinatura do instrutor', !!(await dirB.c.rpc('documento_assinatura_revogar', { p_signature_id: aI.data.signature_id, p_motivo: 'tentativa indevida' })).error)
  ok('revogar sem motivo é recusado', !!(await instr.c.rpc('documento_assinatura_revogar', { p_signature_id: aI.data.signature_id, p_motivo: '' })).error)
  const rv = await instr.c.rpc('documento_assinatura_revogar', { p_signature_id: aI.data.signature_id, p_motivo: 'Assinei por engano [E2E-FLUXO]' })
  ok('o próprio instrutor revoga a assinatura, com motivo', !rv.error, rv.error?.message)
  ok('revogar a assinatura não muda o PDF (H1) silenciosamente', sql(`select pdf_hash from public.class_documents where token_publico = '${token}';`) === hashAntes)
  const audit = sql(`select (select count(*) from public.auditoria_operacoes where operacao = 'documento_assinado'
        and (detalhe ->> 'documento_id') = (select id::text from public.class_documents where token_publico = '${token}'))
    || '+' || (select count(*) from public.auditoria_operacoes where operacao = 'documento_assinatura_revogada'
        and (detalhe ->> 'signature_id') = '${aI.data.signature_id}');`)
  ok('auditoria registrou 3 assinaturas + 1 revogação (com motivo)', audit === '3+1', audit)
  const ver = await anonimo.rpc('documento_verificar', { p_token: token })
  const vj = JSON.stringify(ver.data || {})
  ok('verificação pública responde com o hash do PDF', !ver.error && vj.includes(hashAntes), ver.error?.message)
  ok('verificação mostra quem assinou (nome/papel) e quando', /Hml Coord|coordenador/i.test(vj) && /\d{4}-\d{2}-\d{2}/.test(vj))
  // a verificação PÚBLICA lista só as assinaturas vigentes; a revogação fica para quem tem autoridade
  ok('verificação pública: a assinatura revogada deixa de valer (o instrutor sai da lista)', !/Hml Instrutor/.test(vj) && (ver.data?.assinaturas || []).every((a) => a.status !== 'revogada'), vj.slice(0, 300))
  const asn = await dirA.c.rpc('documento_assinaturas', { p_token: token })
  const aj = JSON.stringify(asn.data || {})
  ok('a diretoria vê só as assinaturas vigentes (a revogada não conta mais)', !asn.error && !aj.includes('Hml Instrutor') && (asn.data?.registradas || []).length === 2, asn.error?.message || aj.slice(0, 300))
  ok('a assinatura revogada continua gravada (não apagada), com status revogada',
    sql(`select status from public.document_signatures where id = '${aI.data.signature_id}';`) === 'revogada')
  ok('a auditoria guarda o motivo da revogação', sql(`select detalhe ->> 'motivo' from public.auditoria_operacoes where operacao = 'documento_assinatura_revogada' and (detalhe ->> 'signature_id') = '${aI.data.signature_id}';`).includes('Assinei por engano'))
  ok('verificação pública não expõe e-mail, UUID de pessoa nem foto', !/@teste\.local|comprovacoes/.test(vj) && !vj.includes(desb.uid))
  const H2 = await dirA.c.functions.invoke('gerar-documento-pdf-final', { body: { token } })
  ok('representação final assinada (H2) gerada', H2.data?.ok === true, JSON.stringify(H2.error || H2.data))
  ok('H2 é um arquivo diferente do H1 (H1 não foi sobrescrito)', sql(`select pdf_hash from public.class_documents where token_publico = '${token}';`) === hashAntes)
}

principal()
  .catch((e) => { reprovados++; console.log('ERRO INESPERADO:', e) })
  .finally(() => {
    try { limpar() } catch (e) { console.log('limpeza falhou:', e.message) }
    console.log(`\n${total - (reprovados && total ? 0 : 0) - reprovados}/${total} ok${reprovados ? ` — ${reprovados} FALHA(S)` : ' — TUDO OK'}`)
    process.exitCode = reprovados ? 1 : 0
  })
