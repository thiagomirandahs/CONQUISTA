// Homologação do piloto — fase final: teste REAL (API contra o Supabase local de verdade, RLS/RPC
// executando pra valer) de cada persona + ataques cruzados. Não é leitura de policy: cada linha
// chama a RPC/tabela de verdade, logada como a pessoa de verdade, e confere o resultado.
//
// A troca de clube/escopo institucional é por HEADER (x-clube-atual / x-escopo-atual — ver
// src/lib/supabase.js), não por RPC: aqui replicamos exatamente esse mecanismo.
//
// Pré-requisito: node supabase/tests/e2e/_seed_homologacao.mjs (cria as 15 contas hml-*).
// Uso: node supabase/tests/e2e/homologacao-personas.mjs
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA = 'senha-homologacao-123'
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
const idDe = (k) => sql(`select md5('hml:${k}')::uuid;`)

let total = 0, reprovados = 0
function ok(nome, cond, detalhe = '') { total++; if (!cond) { reprovados++; console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`) }

async function logar(chave) {
  let clube = null, escopo = null
  const fetchComHeaders = (input, init) => {
    const opcoes = { ...(init || {}) }
    const cabecalhos = new Headers(opcoes.headers || {})
    if (clube) cabecalhos.set('x-clube-atual', clube)
    if (escopo) cabecalhos.set('x-escopo-atual', escopo)
    opcoes.headers = cabecalhos
    return fetch(input, opcoes)
  }
  const c = createClient(API_URL, ANON, { auth: { persistSession: false }, global: { fetch: fetchComHeaders } })
  const { error } = await c.auth.signInWithPassword({ email: `hml-${chave}@teste.local`, password: SENHA })
  if (error) throw new Error(`login ${chave}: ${error.message}`)
  return { c, usarClube: (id) => { clube = id }, usarEscopo: (id) => { escopo = id } }
}

// resultado "seguro sem vazar": ou deu erro explícito, ou devolveu vazio/nulo — as duas formas são
// aceitáveis (o produto usa as duas convenções em lugares diferentes); o que NUNCA pode acontecer é
// devolver dado de verdade pra quem não tem autoridade.
function semVazar(r) {
  if (r.error) return true
  if (r.data == null) return true
  if (Array.isArray(r.data)) return r.data.length === 0
  return false
}

async function principal() {
  console.log('== login de cada persona ==')
  const chaves = ['desbravador', 'desbravador2', 'responsavel', 'responsavel2', 'conselheiro', 'instrutor', 'diretoria_a', 'diretoria_b', 'coord_dist', 'coord_reg', 'coord_campo', 'diretor_mda', 'admin', 'multi', 'acumula']
  const sessoes = Object.fromEntries(await Promise.all(chaves.map(async (k) => [k, await logar(k)])))
  ok('15 personas logaram com sucesso', true)
  const { desbravador, responsavel, responsavel2, conselheiro, instrutor, diretoria_a: diretoriaA, admin, multi, acumula, coord_dist: coordDist } = sessoes

  const clubeAId = sql(`select id from public.organizational_units where slug='hml-clube-a';`)
  const clubeBId = sql(`select id from public.organizational_units where slug='hml-clube-b';`)
  const distritoAId = sql(`select id from public.organizational_units where slug='hml-distrito-a';`)

  // ---------------- DESBRAVADOR ----------------
  console.log('\n== DESBRAVADOR ==')
  desbravador.usarClube(clubeAId)
  const ctxDesbravador = await desbravador.c.rpc('meu_contexto')
  ok('desbravador: meu_contexto funciona e mostra o clube A', !ctxDesbravador.error && JSON.stringify(ctxDesbravador.data).includes(clubeAId), ctxDesbravador.error?.message)
  const { error: errAdminDesbravador } = await desbravador.c.rpc('admin_contas_listar')
  ok('desbravador NÃO acessa RPC de admin da plataforma', !!errAdminDesbravador, 'deveria ter recusado')
  const rVinc = await desbravador.c.rpc('vinculos_pendentes')
  ok('desbravador NÃO gerencia vínculos pendentes (ação de liderança) — recusado ou vazio, nunca dado de verdade', semVazar(rVinc), JSON.stringify(rVinc.data))

  // ---------------- RESPONSÁVEL ----------------
  console.log('\n== RESPONSÁVEL ==')
  responsavel.usarClube(clubeAId)
  const meusFilhos = await responsavel.c.rpc('meus_filhos')
  ok('responsável: meus_filhos traz o filho vinculado', !meusFilhos.error && (meusFilhos.data || []).some((f) => f.nome === 'Hml Desbravador'), JSON.stringify(meusFilhos.data))
  const vincId = sql(`select id from public.responsaveis where responsavel_id = '${idDe('responsavel')}' and desbravador_id = '${idDe('desbravador')}';`)
  const consentOk = await responsavel.c.rpc('consentimento_conceder', { p_vinculo_id: vincId })
  ok('responsável concede consentimento pro PRÓPRIO filho', !consentOk.error, consentOk.error?.message)
  console.log('   -- ataques --')
  const vincOutro = sql(`select id from public.responsaveis where responsavel_id = '${idDe('responsavel2')}' and desbravador_id = '${idDe('desbravador2')}';`)
  const ataque1 = await responsavel.c.rpc('consentimento_conceder', { p_vinculo_id: vincOutro })
  ok('responsável NÃO consente pelo filho de OUTRO responsável', !!ataque1.error, JSON.stringify(ataque1.data))
  const ataque2 = await responsavel.c.rpc('consentimento_conceder', { p_vinculo_id: '00000000-0000-0000-0000-000000000099' })
  ok('UUID aleatório dá a MESMA mensagem (sem oráculo)', !!ataque2.error && ataque2.error.message === ataque1.error.message, `${ataque1.error?.message} vs ${ataque2.error?.message}`)
  responsavel2.usarClube(clubeBId)
  const respOutroLeCriancaErrada = await responsavel2.c.rpc('meus_filhos')
  ok('responsável 2 só vê o PRÓPRIO filho (nunca o filho do responsável 1)', (respOutroLeCriancaErrada.data || []).every((f) => f.nome !== 'Hml Desbravador'), JSON.stringify(respOutroLeCriancaErrada.data))

  // ---------------- CONSELHEIRO vs INSTRUTOR (diferença real) ----------------
  console.log('\n== CONSELHEIRO vs INSTRUTOR ==')
  conselheiro.usarClube(clubeAId)
  instrutor.usarClube(clubeAId)
  const rUsuariosConselheiro = await conselheiro.c.rpc('listar_usuarios')
  ok('conselheiro NÃO lista usuários (não é papel de gestão neste produto — pode_gerir_no_clube só aceita instrutor/diretoria)', semVazar(rUsuariosConselheiro), JSON.stringify(rUsuariosConselheiro.data))
  const rUsuariosInstrutor = await instrutor.c.rpc('listar_usuarios')
  ok('instrutor LISTA usuários (é papel de gestão neste produto, como diretoria)', !rUsuariosInstrutor.error && (rUsuariosInstrutor.data || []).length > 0, rUsuariosInstrutor.error?.message)
  const rContextoConselheiro = await conselheiro.c.rpc('meu_contexto')
  const rContextoInstrutor = await instrutor.c.rpc('meu_contexto')
  ok('conselheiro e instrutor têm CONTEXTOS DIFERENTES (papéis distintos, não os mesmos)',
    JSON.stringify(rContextoConselheiro.data)?.includes('conselheiro') && JSON.stringify(rContextoInstrutor.data)?.includes('instrutor'),
    `${JSON.stringify(rContextoConselheiro.data)} | ${JSON.stringify(rContextoInstrutor.data)}`)

  // ---------------- LIDERANÇA (diretoria) ----------------
  console.log('\n== LIDERANÇA (diretoria) ==')
  diretoriaA.usarClube(clubeAId)
  const rListarUsuarios = await diretoriaA.c.rpc('listar_usuarios')
  ok('diretoria LISTA usuários do próprio clube', !rListarUsuarios.error, rListarUsuarios.error?.message)
  const rVincPend = await diretoriaA.c.rpc('vinculos_pendentes')
  ok('diretoria vê vínculos pendentes do próprio clube', !rVincPend.error, rVincPend.error?.message)

  // ---------------- ADMIN DA PLATAFORMA ----------------
  console.log('\n== ADMIN DA PLATAFORMA ==')
  const ehAdmin = await admin.c.rpc('eh_admin_plataforma')
  ok('admin: eh_admin_plataforma() confirma true', ehAdmin.data === true, JSON.stringify(ehAdmin))
  const rContas = await admin.c.rpc('admin_contas_listar')
  ok('admin lista contas comerciais', !rContas.error, rContas.error?.message)
  console.log('   -- ataques: Admin SaaS não vira liderança de clube --')
  admin.usarClube(clubeAId) // até TENTA usar o header de clube — não deve virar autoridade de clube por isso
  const adminVinculos = await admin.c.rpc('vinculos_pendentes')
  ok('admin NÃO vê vínculos pendentes de um clube só por ser admin da plataforma (não é liderança de clube nenhum)', semVazar(adminVinculos), JSON.stringify(adminVinculos.data))
  const adminListarUsuarios = await admin.c.rpc('listar_usuarios')
  ok('admin NÃO lista usuários de um clube (sem vínculo de liderança lá, mesmo forçando o header de clube)', semVazar(adminListarUsuarios), JSON.stringify(adminListarUsuarios.data))
  const adminMensalidade = await admin.c.from('mensalidades').select('*').eq('desbravador_id', idDe('desbravador'))
  ok('admin NÃO lê mensalidade individual pela tabela direta (RLS não dá esse acesso a admin de plataforma)', (adminMensalidade.data || []).length === 0, JSON.stringify(adminMensalidade.data))
  const adminChat = await admin.c.from('chat_mensagens').select('*').eq('club_id', clubeAId).limit(1)
  ok('admin NÃO lê chat privado do clube pela tabela', !adminChat.data || adminChat.data.length === 0, JSON.stringify(adminChat.data))
  const adminRequisito = await admin.c.rpc('requisito_avaliar', { p_member_requirement_id: '00000000-0000-0000-0000-000000000099', p_decisao: 'aprovado', p_comentario: 'invasão [TESTE]', p_submission_id: null })
  ok('admin NÃO altera requisito curricular (não é a autoridade pedagógica de clube nenhum)', !!adminRequisito.error, JSON.stringify(adminRequisito.data))
  const desbravadorEhAdmin = await desbravador.c.rpc('eh_admin_plataforma')
  ok('...e o inverso: desbravador comum NÃO é admin da plataforma', desbravadorEhAdmin.data === false, JSON.stringify(desbravadorEhAdmin))

  // ---------------- INSTITUCIONAL: distrital / regional / campo / uniao ----------------
  console.log('\n== CADEIA INSTITUCIONAL ==')
  coordDist.usarEscopo(distritoAId)
  const ctxDist = await coordDist.c.rpc('meu_contexto_institucional')
  ok('coordenador distrital: meu_contexto_institucional funciona', !ctxDist.error, ctxDist.error?.message)
  const painelDist = await coordDist.c.rpc('escopo_painel')
  ok('coordenador distrital: escopo_painel funciona (não lança erro)', !painelDist.error, painelDist.error?.message)
  console.log('   -- ataque: hierarquia NÃO equivale a acesso privado automático --')
  const distMensalidade = await coordDist.c.from('mensalidades').select('*').eq('desbravador_id', idDe('desbravador'))
  ok('coordenador distrital NÃO lê mensalidade individual pela tabela (RLS não abre financeiro pra hierarquia)', (distMensalidade.data || []).length === 0, JSON.stringify(distMensalidade.data))
  const distChat = await coordDist.c.from('chat_mensagens').select('*').eq('club_id', clubeAId).limit(1)
  ok('coordenador distrital NÃO lê chat privado do clube pela tabela', !distChat.data || distChat.data.length === 0, JSON.stringify(distChat.data))
  const distFoto = await coordDist.c.from('fotos').select('*').eq('autor_id', idDe('desbravador'))
  ok('coordenador distrital NÃO lê foto/evidência privada pela tabela', !distFoto.data || distFoto.data.length === 0, JSON.stringify(distFoto.data))
  const distListaUsuarios = await coordDist.c.rpc('listar_usuarios')
  ok('coordenador distrital NÃO vira liderança de clube (listar_usuarios do clube A recusado/vazio)', semVazar(distListaUsuarios), JSON.stringify(distListaUsuarios.data))

  console.log('\n== REGIONAL — ataque dedicado ==')
  const { coord_reg: coordReg } = sessoes
  const regiaoId = sql(`select id from public.organizational_units where slug='hml-regiao';`)
  coordReg.usarEscopo(regiaoId)
  const ctxReg = await coordReg.c.rpc('meu_contexto_institucional')
  ok('regional: meu_contexto_institucional funciona e mostra a região certa', !ctxReg.error && ctxReg.data?.escopo_atual_id === regiaoId, JSON.stringify(ctxReg.data))
  const painelReg = await coordReg.c.rpc('escopo_painel')
  ok('regional: escopo_painel funciona (visão institucional PERMITIDA)', !painelReg.error, painelReg.error?.message)
  const clubesReg = await coordReg.c.rpc('escopo_painel')
  ok('regional VÊ os clubes A e B (os dois distritos estão sob a mesma região) — visão institucional correta',
    !clubesReg.error && JSON.stringify(clubesReg.data)?.includes(clubeAId) && JSON.stringify(clubesReg.data)?.includes(clubeBId), JSON.stringify(clubesReg.data))
  console.log('   -- ataques: visão institucional PERMITIDA ≠ acesso privado irrestrito --')
  const regMensalidade = await coordReg.c.from('mensalidades').select('*').eq('desbravador_id', idDe('desbravador'))
  ok('regional NÃO lê mensalidade individual pela tabela (mesmo de um clube do PRÓPRIO escopo)', (regMensalidade.data || []).length === 0, JSON.stringify(regMensalidade.data))
  const regChat = await coordReg.c.from('chat_mensagens').select('*').eq('club_id', clubeAId).limit(1)
  ok('regional NÃO lê chat privado do clube', !regChat.data || regChat.data.length === 0, JSON.stringify(regChat.data))
  const regFoto = await coordReg.c.from('fotos').select('*').eq('autor_id', idDe('desbravador'))
  ok('regional NÃO lê foto/evidência privada', !regFoto.data || regFoto.data.length === 0, JSON.stringify(regFoto.data))
  const regResponsaveis = await coordReg.c.from('responsaveis').select('*')
  ok('regional NÃO lê a tabela de vínculos de responsável (dado de família, não institucional)', (regResponsaveis.data || []).length === 0, JSON.stringify(regResponsaveis.data))
  const regListaUsuarios = await coordReg.c.rpc('listar_usuarios')
  ok('regional NÃO vira liderança de clube nenhum (listar_usuarios recusado/vazio)', semVazar(regListaUsuarios), JSON.stringify(regListaUsuarios.data))
  coordReg.usarEscopo(distritoAId) // regional TENTA se passar por autoridade distrital forjando o header
  const regComoDistrital = await coordReg.c.rpc('meu_contexto_institucional')
  ok('regional NÃO assume escopo distrital só forjando o header (sem vínculo LÁ, escopo_atual_id não honra)', regComoDistrital.data?.escopo_atual_id !== distritoAId, JSON.stringify(regComoDistrital.data))
  const regStorage = await coordReg.c.storage.from('imagens').list(clubeAId)
  ok('regional NÃO lista Storage privado do clube A (bucket imagens é escopado por clube, não por hierarquia)', !!regStorage.error || (regStorage.data || []).length === 0, JSON.stringify(regStorage.data))

  console.log('\n== CAMPO/ASSOCIAÇÃO/MISSÃO — ataque dedicado ==')
  const { coord_campo: coordCampo, diretor_mda: diretorMda } = sessoes
  const campoId = sql(`select id from public.organizational_units where slug='hml-campo';`)
  const uniaoId = sql(`select id from public.organizational_units where slug='hml-uniao';`)
  coordCampo.usarEscopo(campoId)
  const ctxCampo = await coordCampo.c.rpc('meu_contexto_institucional')
  ok('campo: meu_contexto_institucional funciona e mostra o campo certo', !ctxCampo.error && ctxCampo.data?.escopo_atual_id === campoId, JSON.stringify(ctxCampo.data))
  const clubesCampo = await coordCampo.c.rpc('escopo_painel')
  ok('campo VÊ os clubes A e B (toda a árvore região→distritos→clubes abaixo dele) — visão institucional correta',
    !clubesCampo.error && JSON.stringify(clubesCampo.data)?.includes(clubeAId) && JSON.stringify(clubesCampo.data)?.includes(clubeBId), JSON.stringify(clubesCampo.data))
  console.log('   -- ataques: autoridade institucional superior NÃO equivale a admin interno de cada clube --')
  const campoMensalidade = await coordCampo.c.from('mensalidades').select('*').eq('desbravador_id', idDe('desbravador'))
  ok('campo NÃO lê mensalidade individual pela tabela', (campoMensalidade.data || []).length === 0, JSON.stringify(campoMensalidade.data))
  const campoChat = await coordCampo.c.from('chat_mensagens').select('*').eq('club_id', clubeBId).limit(1)
  ok('campo NÃO lê chat privado do clube', !campoChat.data || campoChat.data.length === 0, JSON.stringify(campoChat.data))
  const campoDoc = await coordCampo.c.from('class_documents').select('*').limit(1)
  ok('campo NÃO lê documento privado pela tabela (verificação pública é só por RPC/token)', (campoDoc.data || []).length === 0, JSON.stringify(campoDoc.data))
  const campoListaUsuarios = await coordCampo.c.rpc('listar_usuarios')
  ok('campo NÃO vira liderança/admin interno de clube nenhum', semVazar(campoListaUsuarios), JSON.stringify(campoListaUsuarios.data))
  diretorMda.usarEscopo(uniaoId)
  const ctxUniao = await diretorMda.c.rpc('meu_contexto_institucional')
  ok('diretor MDA (união): meu_contexto_institucional funciona no topo da árvore', !ctxUniao.error && ctxUniao.data?.escopo_atual_id === uniaoId, JSON.stringify(ctxUniao.data))
  const uniaoMensalidade = await diretorMda.c.from('mensalidades').select('*').eq('desbravador_id', idDe('desbravador'))
  ok('nem no TOPO da árvore institucional (união) alguém lê mensalidade individual pela tabela', (uniaoMensalidade.data || []).length === 0, JSON.stringify(uniaoMensalidade.data))

  // ---------------- MULTI-CLUBE ----------------
  console.log('\n== MULTI-CLUBE ==')
  multi.usarClube(clubeAId)
  const ctxMultiA = await multi.c.rpc('meu_contexto')
  ok('pessoa multi-clube no clube A: contexto reflete o papel LÁ (desbravador)', JSON.stringify(ctxMultiA.data)?.includes('desbravador'), JSON.stringify(ctxMultiA.data))
  multi.usarClube(clubeBId)
  const ctxMultiB = await multi.c.rpc('meu_contexto')
  ok('a MESMA pessoa no clube B: contexto reflete o papel LÁ (conselheiro) — nunca mistura os dois', JSON.stringify(ctxMultiB.data)?.includes('conselheiro'), JSON.stringify(ctxMultiB.data))
  console.log('   -- ataque: header de clube onde a pessoa NÃO tem vínculo --')
  multi.usarClube(distritoAId) // não é nem clube, nem vínculo da pessoa
  const ctxMultiForjado = await multi.c.rpc('meu_contexto')
  ok('header apontando pra unidade sem vínculo: clube_atual_id fica NULO (o servidor não confia cegamente no header)', ctxMultiForjado.data?.clube_atual_id == null, JSON.stringify(ctxMultiForjado.data))

  // ---------------- ACUMULA CARGOS (clube + institucional) ----------------
  console.log('\n== ACUMULA CARGOS (diretoria do clube A + coordenador distrital do distrito A) ==')
  acumula.usarClube(clubeAId)
  const acumulaListaUsuarios = await acumula.c.rpc('listar_usuarios')
  ok('acumula: na ABA DE CLUBE, age como diretoria (lista usuários)', !acumulaListaUsuarios.error, acumulaListaUsuarios.error?.message)
  acumula.usarEscopo(distritoAId)
  const acumulaInstitucional = await acumula.c.rpc('meu_contexto_institucional')
  ok('...e SEPARADAMENTE, o contexto institucional dela (distrital) também funciona — os dois convivem sem um vazar autoridade pro outro', !acumulaInstitucional.error, acumulaInstitucional.error?.message)

  // ---------------- STORAGE (ataque adicional, além do já coberto em rodadas anteriores) ----------------
  console.log('\n== ataque adicional de Storage ==')
  const pathOutroClube = `${clubeBId}/${idDe('desbravador')}-x.jpg`
  const { error: errUploadCruzado } = await diretoriaA.c.storage.from('imagens').upload(pathOutroClube, Buffer.from('x'), { contentType: 'image/jpeg' })
  ok('diretoria do clube A NÃO sobe arquivo na pasta do clube B (path cruzado)', !!errUploadCruzado, errUploadCruzado ? 'recusado' : 'DEVERIA TER RECUSADO')

  // ---------------- AUTH ----------------
  console.log('\n== AUTH ==')
  const cAnon1 = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const loginSenhaErrada = await cAnon1.auth.signInWithPassword({ email: 'hml-desbravador@teste.local', password: 'senha-errada-de-proposito' })
  ok('senha errada pra conta REAL é recusada', !!loginSenhaErrada.error, JSON.stringify(loginSenhaErrada.data?.user))
  const cAnon2 = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const loginInexistente = await cAnon2.auth.signInWithPassword({ email: 'hml-nao-existe-nunca@teste.local', password: 'qualquer-coisa-123' })
  ok('e-mail que NÃO existe é recusado', !!loginInexistente.error, JSON.stringify(loginInexistente.data?.user))
  ok('...com a MESMA mensagem de "senha errada" (sem oráculo de e-mail existente — não dá pra enumerar contas pelo erro de login)',
    loginInexistente.error?.message === loginSenhaErrada.error?.message, `"${loginSenhaErrada.error?.message}" vs "${loginInexistente.error?.message}"`)
  ok('...e o MESMO status HTTP também', loginInexistente.error?.status === loginSenhaErrada.error?.status, `${loginSenhaErrada.error?.status} vs ${loginInexistente.error?.status}`)

  console.log('   -- vínculo suspenso: a pessoa continua logando (é da CONTA), mas perde o acesso ao clube --')
  sql(`update public.organization_memberships set status='suspenso' where user_id='${idDe('desbravador2')}' and organizational_unit_id='${clubeBId}';`)
  const cSuspenso = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const loginSuspenso = await cSuspenso.auth.signInWithPassword({ email: 'hml-desbravador2@teste.local', password: SENHA })
  ok('conta com vínculo suspenso AINDA consegue autenticar (a suspensão é do VÍNCULO, não da conta)', !loginSuspenso.error, loginSuspenso.error?.message)
  let clubeSuspenso = null
  const fetchSusp = (input, init) => { const o = { ...(init || {}) }; const h = new Headers(o.headers || {}); if (clubeSuspenso) h.set('x-clube-atual', clubeSuspenso); o.headers = h; return fetch(input, o) }
  const cSuspensoAutenticado = createClient(API_URL, ANON, { auth: { persistSession: false }, global: { fetch: fetchSusp } })
  await cSuspensoAutenticado.auth.setSession(loginSuspenso.data.session)
  clubeSuspenso = clubeBId
  const ctxSuspenso = await cSuspensoAutenticado.rpc('meu_contexto')
  const vinculoSuspensoNoContexto = (ctxSuspenso.data?.vinculos || []).find((v) => v.club_id === clubeBId)
  ok('...mas o vínculo suspenso aparece como NÃO selecionável (a UI barra o acesso, o servidor barra de novo)', vinculoSuspensoNoContexto?.selecionavel === false, JSON.stringify(vinculoSuspensoNoContexto))
  ok('...e clube_atual_id NÃO assume o clube suspenso mesmo com o header pedindo', ctxSuspenso.data?.clube_atual_id !== clubeBId, JSON.stringify(ctxSuspenso.data?.clube_atual_id))
  sql(`update public.organization_memberships set status='ativo' where user_id='${idDe('desbravador2')}' and organizational_unit_id='${clubeBId}';`)

  console.log(`\n${total - reprovados}/${total} ok${reprovados ? ` — ${reprovados} FALHA(S)` : ' — TUDO OK'}`)
  process.exitCode = reprovados > 0 ? 1 : 0
}

principal().catch((e) => { console.error('ERRO INESPERADO:', e); process.exit(1) })
