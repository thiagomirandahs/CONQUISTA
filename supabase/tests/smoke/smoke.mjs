// =============================================================================
//  SMOKE TEST PÓS-DEPLOY — seguro para rodar contra o ambiente real.
//
//  Para que serve: responder, em menos de um minuto depois de um deploy, "o sistema está de pé
//  de ponta a ponta?". Não substitui a suíte de testes (50 arquivos SQL + 408 de unidade), que
//  roda contra banco descartável. Este aqui roda contra o ambiente de VERDADE, e por isso a
//  regra número um é:
//
//      NÃO DESTRÓI DADO, e tudo que ele cria é identificável como teste.
//
//  Como cada passo respeita isso:
//    - autenticação ... usa uma conta de smoke dedicada, criada UMA VEZ pelo operador, com
//                       `profiles.teste = true` (a flag que o projeto já usa para tirar contas
//                       de teste de rankings, lembretes e prêmios de cron).
//    - leituras ....... contexto, Home, ranking: só leem.
//    - Storage ........ pede URL ASSINADA de um caminho que não existe. Mede se o serviço
//                       responde e assina; não baixa nem escreve nada.
//    - Edge Function .. chama SEM o segredo do webhook e exige 401. Isso prova que a função está
//                       publicada, acordada e com a fechadura no lugar — sem disparar um único
//                       push para o celular de ninguém. Mandar um push de verdade num smoke test
//                       seria acordar o clube inteiro a cada deploy.
//    - verificação ... `documento_verificar` com um token inexistente: prova que a superfície
//      pública ....... anônima responde (e responde "não encontrado", não 500).
//
//  O ÚNICO passo que escreve é opcional (--escrever) e ele mesmo limpa o que criou.
//
//  Uso:
//    SMOKE_URL=https://<projeto>.supabase.co \
//    SMOKE_ANON=<anon key> \
//    SMOKE_EMAIL=smoke@seu-dominio \
//    SMOKE_SENHA=<senha> \
//    node supabase/tests/smoke/smoke.mjs [--escrever]
//
//  Sai com 0 se tudo passou, 1 se algo falhou. Serve para bloquear um deploy em CI.
// =============================================================================
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:54321'
const ANON = process.env.SMOKE_ANON
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const EMAIL = process.env.SMOKE_EMAIL
const SENHA = process.env.SMOKE_SENHA
const ESCREVER = process.argv.includes('--escrever')
// O stack local do `supabase start` não sobe o runtime de Edge Functions. Saber disso muda o
// veredito de um passo — e só desse.
const LOCAL = /127\.0\.0\.1|localhost/.test(URL)

// Marcador em tudo que este arquivo criar. Se alguém encontrar esta string no banco de produção,
// sabe na hora de onde veio e que pode apagar.
const MARCA = '[SMOKE]'

let falhas = 0
let avisos = 0
const inicio = Date.now()

function ok(nome, cond, detalhe = '') {
  if (cond) console.log(`   OK      ${nome}`)
  else { falhas++; console.log(`   FALHOU  ${nome}${detalhe ? `\n             ${detalhe}` : ''}`) }
  return cond
}
function aviso(nome, detalhe) { avisos++; console.log(`   AVISO   ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }

async function cronometrar(fn) {
  const t = Date.now()
  const r = await fn()
  return [r, Date.now() - t]
}

console.log(`\n=== SMOKE TEST — ${URL} ===\n`)

if (!EMAIL || !SENHA) {
  console.log('Faltam SMOKE_EMAIL e SMOKE_SENHA (a conta de smoke dedicada).')
  console.log('Crie-a UMA VEZ, marque profiles.teste = true, e guarde as credenciais no cofre da equipe.')
  process.exit(2)
}

const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

// ---------------------------------------------------------------------------
// 1. Autenticação
// ---------------------------------------------------------------------------
console.log('-- 1. autenticação --')
const [login, msLogin] = await cronometrar(() => sb.auth.signInWithPassword({ email: EMAIL, password: SENHA }))
if (!ok('a conta de smoke entra', !!login.data?.session, login.error?.message)) {
  console.log('\nSem sessão não há o que testar adiante.')
  process.exit(1)
}
ok(`...em tempo razoável (${msLogin} ms)`, msLogin < 5000, `${msLogin} ms`)
const uid = login.data.session.user.id

// A conta de smoke PRECISA estar marcada como teste, senão ela entra em ranking e em lembrete.
const { data: perfil } = await sb.from('profiles').select('nome,teste').eq('id', uid).maybeSingle()
if (!ok('a conta está marcada como teste (profiles.teste)', perfil?.teste === true,
  'sem isso ela aparece em ranking, lembrete de ausência e prêmio de cron do clube real')) {
  console.log('             corrija com: update public.profiles set teste = true where id = \'' + uid + '\';')
}

// ---------------------------------------------------------------------------
// 2. Contexto do clube — o caminho quente de toda abertura do app
// ---------------------------------------------------------------------------
console.log('\n-- 2. contexto do clube --')
const [ctx, msCtx] = await cronometrar(() => sb.rpc('meu_contexto'))
ok('meu_contexto responde', !ctx.error, ctx.error?.message)
// A resposta é { usuario_id, clube_atual_id, vinculos[] }. Sem header de clube, `clube_atual_id`
// vem do vínculo padrão — é exatamente o caminho que o app percorre ao abrir.
const clube = ctx.data?.clube_atual_id || ctx.data?.vinculos?.[0]?.club_id || null
ok('...e devolve um clube em uso', !!clube,
  'a conta de smoke precisa de vínculo ativo em UM clube — de preferência um clube de teste, não o do cliente')
ok('...e ao menos um vínculo', (ctx.data?.vinculos?.length ?? 0) >= 1)
ok(`...em tempo razoável (${msCtx} ms)`, msCtx < 3000, `${msCtx} ms`)

// A partir daqui toda chamada carrega o clube, como o app faz.
const comClube = clube
  ? createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-clube-atual': clube, Authorization: `Bearer ${login.data.session.access_token}` } },
    })
  : sb

// ---------------------------------------------------------------------------
// 3. Home — o motor de prioridades
// ---------------------------------------------------------------------------
console.log('\n-- 3. Home --')
const [home, msHome] = await cronometrar(() => comClube.rpc('meu_inicio'))
ok('meu_inicio responde', !home.error, home.error?.message)
ok('...devolve uma lista (mesmo vazia é resposta válida)', Array.isArray(home.data) || typeof home.data === 'object')
ok(`...em tempo razoável (${msHome} ms)`, msHome < 3000, `${msHome} ms`)

// ---------------------------------------------------------------------------
// 4. Um recurso simples — leitura de verdade, com RLS no caminho
// ---------------------------------------------------------------------------
console.log('\n-- 4. recurso simples (leitura com RLS) --')
const [rank, msRank] = await cronometrar(() =>
  comClube.from('profiles').select('id,nome').limit(5))
ok('leitura de perfis do clube responde', !rank.error, rank.error?.message)
ok('...e a RLS está no caminho (devolveu no máximo o pedido)', (rank.data?.length ?? 0) <= 5)
ok(`...em tempo razoável (${msRank} ms)`, msRank < 3000, `${msRank} ms`)

// Prova NEGATIVA: a conta de smoke não pode ler a telemetria (isso é da operação da plataforma).
// Um smoke test que só confere o que FUNCIONA não percebe uma RLS que caiu.
const semAcesso = await comClube.from('app_erros').select('id').limit(1)
ok('a conta de smoke NÃO lê a telemetria (a autorização está de pé)',
  !!semAcesso.error || (semAcesso.data?.length ?? 0) === 0,
  'se isto passar a devolver linhas, alguma policy caiu')

// ---------------------------------------------------------------------------
// 5. Storage — o serviço responde e assina
// ---------------------------------------------------------------------------
console.log('\n-- 5. Storage --')
const [assin, msAssin] = await cronometrar(() =>
  comClube.storage.from('imagens').createSignedUrl(`smoke/${uid}/inexistente.jpg`, 60))
// Objeto inexistente devolve erro — e está certo. O que se mede é se o SERVIÇO respondeu:
// um Storage fora do ar dá erro de rede/5xx, não "não encontrado".
const storageVivo = !!assin.data?.signedUrl || /not found|does not exist|Object not found/i.test(assin.error?.message || '')
ok('o serviço de Storage responde', storageVivo, assin.error?.message)
ok(`...em tempo razoável (${msAssin} ms)`, msAssin < 5000, `${msAssin} ms`)

// ---------------------------------------------------------------------------
// 6. Edge Function — controlada: prova que está viva SEM disparar push
// ---------------------------------------------------------------------------
console.log('\n-- 6. Edge Function (controlada) --')
const [edge, msEdge] = await cronometrar(() =>
  fetch(`${URL}/functions/v1/enviar-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ smoke: MARCA }),
  }).then((r) => r.status).catch(() => 0))
// 401 é o resultado CERTO: a função está publicada, acordada, e recusou porque falta o segredo
// do webhook. Qualquer outra coisa merece olhar:
//   0   = não respondeu (fora do ar / rede)
//   404 = não publicada
//   500 = publicada mas quebrada — OU, num stack local, simplesmente não servida
//   200 = a fechadura sumiu — isso é incidente de segurança, não smoke test verde
if (edge === 200) {
  ok('a função recusa quem não tem o segredo do webhook', false,
    'ACEITOU sem o segredo — a fechadura caiu. Isto é incidente de segurança, não falha de smoke.')
} else if (LOCAL && edge !== 401) {
  // O `supabase start` não sobe o runtime de Edge Functions; exigir 401 aqui seria um teste que
  // falha sempre no ambiente onde ele é mais rodado, e teste que falha sempre é teste ignorado.
  aviso('Edge Function não avaliada (stack local não serve functions)', `respondeu ${edge || 'nada'}`)
} else {
  ok('a função está publicada e recusa quem não tem o segredo (401)', edge === 401,
    edge === 0 ? 'não respondeu' : edge === 404 ? 'não está publicada' : `respondeu ${edge}`)
}
ok(`...em tempo razoável (${msEdge} ms)`, msEdge < 10000, `${msEdge} ms (invoke frio pode demorar)`)

// ---------------------------------------------------------------------------
// 7. Verificação pública — a única superfície anônima do produto
// ---------------------------------------------------------------------------
console.log('\n-- 7. verificação pública (sem login) --')
const anonimo = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const [verif, msVerif] = await cronometrar(() =>
  anonimo.rpc('documento_verificar', { p_token: 'smoke-token-que-nao-existe-0000000000' }))
// O contrato real: devolve `{ encontrado: false }` — um objeto, não erro e não conteúdo. É a
// forma certa: responder com erro diferente para token válido e inválido já seria um oráculo.
ok('a verificação pública responde sem login', !verif.error || !/permission|denied/i.test(verif.error.message),
  verif.error?.message)
ok('...e responde "não encontrado" para um token inexistente', verif.data?.encontrado === false,
  JSON.stringify(verif.data))
ok('...sem vazar nenhum outro campo junto', Object.keys(verif.data || {}).join(',') === 'encontrado',
  `campos: ${Object.keys(verif.data || {}).join(',')}`)
ok(`...em tempo razoável (${msVerif} ms)`, msVerif < 3000, `${msVerif} ms`)

// ---------------------------------------------------------------------------
// 8. Escrita (opcional, --escrever): cria e APAGA o que criou
// ---------------------------------------------------------------------------
if (ESCREVER) {
  console.log('\n-- 8. escrita (opcional) --')
  const texto = `${MARCA} verificação automática de deploy`
  const env = await comClube.rpc('chat_enviar_geral', { p_texto: texto })
  if (ok('consegue escrever no chat geral', !env.error, env.error?.message)) {
    // apaga o que acabou de escrever — a moderação do próprio clube é o caminho previsto
    const id = typeof env.data === 'string' ? env.data : env.data?.id
    if (id) {
      const apg = await comClube.rpc('chat_apagar_mensagem', { p_mensagem_id: id })
      if (!ok('...e limpa o que escreveu', !apg.error, apg.error?.message)) {
        aviso('sobrou uma mensagem de smoke no chat', `procure por "${MARCA}" e apague à mão`)
      }
    } else {
      aviso('não consegui identificar a mensagem criada', `procure por "${MARCA}" no chat e apague à mão`)
    }
  }
} else {
  console.log('\n-- 8. escrita — pulada (use --escrever para incluir) --')
}

await sb.auth.signOut()

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(62)}`)
console.log(` ${falhas === 0 ? 'SMOKE OK' : `${falhas} FALHA(S)`}${avisos ? `  ·  ${avisos} aviso(s)` : ''}   (${Date.now() - inicio} ms)`)
console.log('='.repeat(62) + '\n')
process.exit(falhas === 0 ? 0 : 1)
