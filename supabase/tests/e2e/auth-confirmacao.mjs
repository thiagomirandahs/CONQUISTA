// =============================================================================
//  Fase 8.1 — os quatro fluxos de autenticação, de ponta a ponta, contra o Supabase LOCAL.
//
//    cadastro -> confirmação -> login -> recuperação
//
//  Por que um e2e e não um teste de banco: o que está sendo verificado é o GoTrue configurado por
//  supabase/config.toml — se a confirmação está mesmo exigida, se a senha fraca é mesmo recusada,
//  se o e-mail sai, se o link funciona. Nada disso passa por SQL; só uma ida de verdade à API
//  prova. O e-mail é lido pelo Mailpit do stack local (a mesma caixa que o `supabase start` abre).
//
//  Uso:  node supabase/tests/e2e/auth-confirmacao.mjs
//  Exige o stack local no ar. Não toca em produção: as URLs são fixas em 127.0.0.1.
// =============================================================================
import { createClient } from '@supabase/supabase-js'

const API = 'http://127.0.0.1:54321'
const MAIL = 'http://127.0.0.1:54324'
const ANON = process.env.ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const sb = () => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const email = `fase81-${Date.now()}@teste.local`
const SENHA_FRACA = 'abc123'        // 6 caracteres: era aceita antes
const SENHA_CURTA = 'abcdefgh'      // 8 mas só letras: falha em letters_digits
const SENHA = 'Conquista2026'
const SENHA_NOVA = 'Conquista2027x'

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  if (cond) console.log(`   OK    ${nome}`)
  else { falhas++; console.log(`   FALHOU ${nome}${detalhe ? `  [${detalhe}]` : ''}`) }
}

// Mailpit: pega a mensagem mais recente para um endereço e devolve o primeiro link do corpo.
async function ultimoLink(destinatario, tentativas = 20) {
  for (let i = 0; i < tentativas; i++) {
    const lista = await (await fetch(`${MAIL}/api/v1/messages?limit=30`)).json()
    const msg = (lista.messages || []).find((m) => (m.To || []).some((t) => t.Address === destinatario))
    if (msg) {
      const corpo = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json()
      const texto = `${corpo.Text || ''} ${corpo.HTML || ''}`
      const link = (texto.match(/https?:\/\/[^\s"'<>]+/g) || []).find((l) => l.includes('verify') || l.includes('token'))
      if (link) return { link, assunto: msg.Subject }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

console.log(`\n=== fluxos de autenticação (conta de teste: ${email}) ===\n`)

// ---------------------------------------------------------------------------
// 1. A política de senha é aplicada ANTES de criar qualquer coisa
// ---------------------------------------------------------------------------
console.log('-- 1. política de senha --')
{
  const { error } = await sb().auth.signUp({ email: `fraca-${Date.now()}@teste.local`, password: SENHA_FRACA })
  ok('senha de 6 caracteres é recusada (o mínimo virou 8)', !!error, error?.message)
}
{
  const { error } = await sb().auth.signUp({ email: `soletras-${Date.now()}@teste.local`, password: SENHA_CURTA })
  ok('senha só com letras é recusada (exige letra E número)', !!error, error?.message)
}

// ---------------------------------------------------------------------------
// 2. Cadastro: cria a conta, mas NÃO entrega sessão
// ---------------------------------------------------------------------------
console.log('\n-- 2. cadastro --')
const { data: cadastro, error: erroCadastro } = await sb().auth.signUp({
  email, password: SENHA, options: { data: { nome: 'Teste Fase 8.1' } },
})
ok('cadastro com senha válida é aceito', !erroCadastro, erroCadastro?.message)
ok('o cadastro NÃO devolve sessão — a conta nasce por confirmar', !cadastro?.session)
ok('...e o usuário ainda não está confirmado', !cadastro?.user?.email_confirmed_at)

// ---------------------------------------------------------------------------
// 3. Login antes de confirmar: tem de ser barrado
// ---------------------------------------------------------------------------
console.log('\n-- 3. login antes de confirmar --')
{
  const { data, error } = await sb().auth.signInWithPassword({ email, password: SENHA })
  ok('login antes da confirmação é recusado', !!error && !data?.session, error?.message)
  ok('...e a mensagem fala de confirmação, não de senha errada',
    /confirm/i.test(error?.message || ''), error?.message)
}

// ---------------------------------------------------------------------------
// 4. O e-mail de confirmação chega e o link funciona
// ---------------------------------------------------------------------------
console.log('\n-- 4. confirmação --')
const confirmacao = await ultimoLink(email)
ok('o e-mail de confirmação chegou', !!confirmacao, 'nenhuma mensagem no Mailpit')
if (confirmacao) {
  const resp = await fetch(confirmacao.link, { redirect: 'manual' })
  ok('o link de confirmação é aceito pelo servidor', resp.status >= 200 && resp.status < 400, `HTTP ${resp.status}`)
}

// ---------------------------------------------------------------------------
// 5. Login depois de confirmar
// ---------------------------------------------------------------------------
console.log('\n-- 5. login depois de confirmar --')
const { data: login, error: erroLogin } = await sb().auth.signInWithPassword({ email, password: SENHA })
ok('login funciona depois da confirmação', !!login?.session, erroLogin?.message)
ok('...e agora o e-mail consta como confirmado', !!login?.user?.email_confirmed_at)

// ---------------------------------------------------------------------------
// 6. Recuperação de senha
// ---------------------------------------------------------------------------
console.log('\n-- 6. recuperação --')
{
  // limpa a caixa para não confundir o e-mail de confirmação com o de recuperação
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' })
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: 'http://127.0.0.1:4173/nova-senha' })
  ok('o pedido de recuperação é aceito', !error, error?.message)

  const recuperacao = await ultimoLink(email)
  ok('o e-mail de recuperação chegou', !!recuperacao)
  ok('...e aponta para /nova-senha (a tela que troca a senha)',
    !!recuperacao && recuperacao.link.includes('nova-senha'), recuperacao?.link)

  if (recuperacao) {
    // O supabase-js faz isto sozinho no navegador; aqui a troca é manual para poder conferir.
    const cliente = sb()
    const url = new URL(recuperacao.link)
    const token = url.searchParams.get('token')
    const { data, error: erroOtp } = await cliente.auth.verifyOtp({ token_hash: token, type: 'recovery' })
    ok('o link de recuperação abre uma sessão de recuperação', !!data?.session, erroOtp?.message)

    if (data?.session) {
      const { error: erroTroca } = await cliente.auth.updateUser({ password: SENHA_NOVA })
      ok('a senha nova é aceita', !erroTroca, erroTroca?.message)
      await cliente.auth.signOut()
    }
  }
}

// ---------------------------------------------------------------------------
// 7. A senha nova vale e a antiga não
// ---------------------------------------------------------------------------
console.log('\n-- 7. depois da troca --')
{
  const { data } = await sb().auth.signInWithPassword({ email, password: SENHA_NOVA })
  ok('login com a senha NOVA funciona', !!data?.session)
}
{
  const { data, error } = await sb().auth.signInWithPassword({ email, password: SENHA })
  ok('login com a senha ANTIGA é recusado', !data?.session && !!error)
}
{
  const { error } = await sb().auth.resetPasswordForEmail(`nao-existe-${Date.now()}@teste.local`)
  // O importante não é o código de retorno e sim que a UI não distinga os casos — a tela
  // /recuperar mostra a mesma mensagem com ou sem erro. Aqui só registramos o comportamento.
  console.log(`   nota   recuperação para e-mail inexistente: ${error ? `erro "${error.message}"` : 'aceita em silêncio'}`)
}

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}\n`)
process.exit(falhas === 0 ? 0 : 1)
