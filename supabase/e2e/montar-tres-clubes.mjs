// =============================================================================
//  Fase 8.4 — monta os TRÊS clubes para a validação multi-clube.
//
//  A regra que dá validade ao resto: **B e C nascem exclusivamente pelo produto.** Nenhum INSERT
//  manual em conta, assinatura, clube, marca, diretoria, unidades ou recursos. Tudo pelas mesmas
//  RPCs e pelas mesmas tabelas que o app usa, com a sessão da pessoa que está cadastrando.
//
//  Se algum passo exigir SQL para funcionar, isso NÃO é um detalhe de setup — é um achado, e o
//  script para e diz qual é.
//
//    A = Tenant 001 / legado ... já existe no seed. Preservado, não tocado.
//    B = cliente novo principal ... 8 unidades, plano completo, marca própria, PIX próprio
//    C = terceiro clube, menor ... 2 unidades, plano gratuito, para pegar lógica binária A/B
//
//  A e B compartilham NOMES de unidade de propósito ("Falcão", "Pantera"): é o jeito de procurar
//  colisão por nome em vez de por id.
//
//  Uso:  node supabase/e2e/montar-tres-clubes.mjs
//  Escreve supabase/e2e/atores.json com os ids e tokens, para os testes seguintes.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const API = 'http://127.0.0.1:54321'
const ANON = process.env.ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA = 'Multiclube2026'

let falhas = 0
const ok = (n, c, d = '') => { if (c) console.log(`   OK      ${n}`); else { falhas++; console.log(`   FALHOU  ${n}${d ? `  [${d}]` : ''}`) } ; return c }
const nota = (n) => console.log(`   ·       ${n}`)

const anon = () => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

// Uma sessão de verdade. `clube` opcional = o header x-clube-atual, como a aba do app manda.
function sessao(token, clube) {
  return createClient(API, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, ...(clube ? { 'x-clube-atual': clube } : {}) } },
  })
}

async function criarConta(email, meta) {
  const sb = anon()
  const { data, error } = await sb.auth.signUp({ email, password: SENHA, options: { data: meta } })
  if (error && !/already/i.test(error.message)) throw new Error(`signUp ${email}: ${error.message}`)
  // confirmação de e-mail está LIGADA (fase 8.1): sem sessão no signUp. Confirmar é operação de
  // e-mail, não de produto — aqui é feita pela API de admin do GoTrue, não por SQL no schema.
  await fetch(`${API}/auth/v1/admin/users`, { method: 'GET' }).catch(() => {})
  return data?.user?.id || null
}

// Confirma o e-mail e entra. O `confirmar` usa o service_role do GoTrue — é o equivalente a a
// pessoa ter clicado no link, não um atalho no schema do produto.
async function entrar(email) {
  const SERVICE = process.env.SERVICE_ROLE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
  const adm = createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: lista } = await adm.auth.admin.listUsers({ page: 1, perPage: 200 })
  const u = (lista?.users || []).find((x) => x.email === email)
  if (u && !u.email_confirmed_at) await adm.auth.admin.updateUserById(u.id, { email_confirm: true })
  const { data, error } = await anon().auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { id: data.user.id, token: data.session.access_token }
}

// ---------------------------------------------------------------------------
console.log('\n=== FASE 8.4 — montando os três clubes ===\n')

const atores = { clubes: {}, pessoas: {} }

// ---------------------------------------------------------------------------
// A — o legado. Só é LIDO aqui; nada é criado nem alterado.
// ---------------------------------------------------------------------------
console.log('-- A: Tenant 001 (legado) --')
{
  const sb = anon()
  const { data } = await sb.rpc('clube_legado_id')
  atores.clubes.A = data
  ok('o clube legado existe e é alcançável', !!data)
  nota(`A = ${data}`)
}

// ---------------------------------------------------------------------------
// B — nasce pelo onboarding, com INTERRUPÇÃO e RETOMADA no meio
// ---------------------------------------------------------------------------
console.log('\n-- B: cliente novo, pelo fluxo real --')
const emailB = 'fundador.b@multiclube.local'
await criarConta(emailB, { nome: 'Beatriz Fundadora', tipo: 'fundador' })
const fundadorB = await entrar(emailB)
atores.pessoas.fundador_b = { ...fundadorB, email: emailB }
ok('o fundador de B entra no sistema', !!fundadorB.token)

{
  const sb = sessao(fundadorB.token)
  // A pessoa que vai abrir um clube não tem clube nenhum — é o caso que o ClubeGuard trata.
  const { data: ini, error: e1 } = await sb.rpc('onboarding_iniciar')
  ok('onboarding_iniciar responde', !e1, e1?.message)

  const etapa = async (nome, dados) => {
    const { data, error } = await sb.rpc('onboarding_etapa', { p_etapa: nome, p_dados: dados })
    if (error) throw new Error(`etapa ${nome}: ${error.message}`)
    return data
  }

  await etapa('conta', { nome: 'Associação Águias do Vale', email: 'financeiro@aguiasdovale.local' })
  await etapa('dados_basicos', { documento: '11.222.333/0001-44', telefone: '+55 81 99999-0001', pais: 'BR', timezone: 'America/Recife' })

  // ---- INTERRUPÇÃO: a pessoa fecha o navegador aqui ----
  nota('interrompendo no meio (etapa 3 de 9) e recarregando…')
  const sb2 = sessao((await entrar(emailB)).token)   // nova sessão = novo carregamento do app
  const { data: retomado } = await sb2.rpc('onboarding_estado')
  ok('ao voltar, o onboarding retoma de onde parou', retomado?.etapa === 'clube',
    `etapa=${retomado?.etapa}`)

  const etapa2 = async (nome, dados) => {
    const { data, error } = await sb2.rpc('onboarding_etapa', { p_etapa: nome, p_dados: dados })
    if (error) throw new Error(`etapa ${nome}: ${error.message}`)
    return data
  }

  await etapa2('clube', { nome: 'Águias do Vale', plano: 'completo' })
  // ---- REPETIÇÃO de etapa: a pessoa volta e salva de novo ----
  nota('repetindo a etapa "clube" (a pessoa voltou e salvou de novo)…')
  await etapa2('clube', { nome: 'Águias do Vale' })
  await etapa2('conta', { nome: 'Associação Águias do Vale', email: 'financeiro@aguiasdovale.local' })

  await etapa2('identidade', {
    sigla: 'ADV', lema: 'Voar alto, servir sempre', descricao: 'Clube do Vale do Ipojuca',
    desde: '2019', cor_primaria: '#7c3aed', cor_secundaria: '#f59e0b',
  })
  await etapa2('diretor', {})
  await etapa2('diretor', {})          // repetição também aqui
  await etapa2('configuracao', { pix: 'PIX-AGUIAS-DO-VALE' })
  await etapa2('recursos', { recursos: { leilao: true, experiencias: true, mensalidades: true, chat: true } })
  await etapa2('equipe', { emails: ['instrutor.b@multiclube.local'], papel: 'instrutor' })
  const fim = await etapa2('pronto', {})
  ok('o onboarding chega ao fim', !!fim, JSON.stringify(fim)?.slice(0, 120))

  const { data: estado } = await sb2.rpc('onboarding_estado')
  atores.clubes.B = estado?.club_id || retomado?.club_id || null
  ok('B foi criado e o onboarding aponta para ele', !!atores.clubes.B)
  nota(`B = ${atores.clubes.B}`)
}

// ---------------------------------------------------------------------------
// C — o terceiro clube, menor, para pegar lógica binária A/B
// ---------------------------------------------------------------------------
console.log('\n-- C: terceiro clube, também pelo fluxo real --')
const emailC = 'fundador.c@multiclube.local'
await criarConta(emailC, { nome: 'Carlos Fundador', tipo: 'fundador' })
const fundadorC = await entrar(emailC)
atores.pessoas.fundador_c = { ...fundadorC, email: emailC }
{
  const sb = sessao(fundadorC.token)
  await sb.rpc('onboarding_iniciar')
  const etapa = async (nome, dados) => {
    const { error } = await sb.rpc('onboarding_etapa', { p_etapa: nome, p_dados: dados })
    if (error) throw new Error(`C/${nome}: ${error.message}`)
  }
  await etapa('conta', { nome: 'Igreja Central de Caruaru', email: 'tesouraria@central.local' })
  await etapa('dados_basicos', { documento: '99.888.777/0001-11', telefone: '+55 81 98888-0002', pais: 'BR', timezone: 'America/Recife' })
  await etapa('clube', { nome: 'Sentinelas do Agreste', plano: 'gratuito' })
  await etapa('identidade', { sigla: 'SDA', lema: 'Vigiar e servir', descricao: 'Clube da Central', desde: '2024', cor_primaria: '#0f766e', cor_secundaria: '#facc15' })
  await etapa('diretor', {})
  await etapa('configuracao', { pix: 'PIX-SENTINELAS' })
  // C esta no plano GRATUITO: liga so o que esse plano inclui. Pedir 'leilao' aqui e recusado
  // pelo servidor (a 1a camada manda), e e isso que faz C ser diferente de B de verdade.
  await etapa('recursos', { recursos: { chat: true } })
  await etapa('equipe', { emails: [] })
  await etapa('pronto', {})
  const { data: estado } = await sb.rpc('onboarding_estado')
  atores.clubes.C = estado?.club_id
  ok('C foi criado pelo mesmo fluxo', !!atores.clubes.C)
  nota(`C = ${atores.clubes.C}`)
}

// ---------------------------------------------------------------------------
// A invariante do item 2: 1 conta + 1 assinatura + 1 clube, apesar das repetições
// ---------------------------------------------------------------------------
console.log('\n-- a invariante do onboarding retomável --')
{
  const SERVICE = process.env.SERVICE_ROLE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
  const adm = createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  const conta = async (t, f, v) => (await adm.from(t).select('id', { count: 'exact', head: true }).eq(f, v)).count
  const contaB = (await adm.from('billing_account_contacts').select('billing_account_id').eq('user_id', fundadorB.id)).data || []
  ok('B tem exatamente UMA conta comercial, apesar da repetição de etapa', contaB.length === 1, `contas=${contaB.length}`)
  const subs = (await adm.from('subscription_clubs').select('subscription_id').eq('club_id', atores.clubes.B)).data || []
  ok('...UMA assinatura', subs.length === 1, `assinaturas=${subs.length}`)
  const clubes = (await adm.from('organizational_units').select('id').eq('nome', 'Águias do Vale')).data || []
  ok('...e UM clube', clubes.length === 1, `clubes=${clubes.length}`)
  const sessoes = (await adm.from('onboarding_sessions').select('id').eq('user_id', fundadorB.id)).data || []
  ok('...e uma única sessão de onboarding', sessoes.length === 1, `sessoes=${sessoes.length}`)
}

// ---------------------------------------------------------------------------
// Unidades — criadas pela diretoria, pela mesma tabela que a tela usa
// ---------------------------------------------------------------------------
console.log('\n-- unidades (pela diretoria, como a tela Unidades faz) --')
{
  const sbB = sessao(fundadorB.token, atores.clubes.B)
  // NOMES REPETIDOS de propósito: "Falcão" e "Pantera" também existem em A (ver abaixo).
  const nomesB = ['Falcão', 'Pantera', 'Leões do Vale', 'Corujas', 'Tubarões', 'Águia Real', 'Jaguares', 'Andorinhas']
  for (const nome of nomesB) {
    const { error } = await sbB.from('unidades').insert({ nome })
    if (error) { ok(`unidade "${nome}" em B`, false, error.message); break }
  }
  const { data: uB } = await sbB.from('unidades').select('id,nome').order('nome')
  ok(`B tem ${nomesB.length} unidades criadas pela diretoria`, (uB?.length || 0) === nomesB.length, `n=${uB?.length}`)
  atores.clubes.B_unidades = Object.fromEntries((uB || []).map((u) => [u.nome, u.id]))

  const sbC = sessao(fundadorC.token, atores.clubes.C)
  for (const nome of ['Falcão', 'Tatus']) await sbC.from('unidades').insert({ nome })
  const { data: uC } = await sbC.from('unidades').select('id,nome').order('nome')
  ok('C tem 2 unidades', (uC?.length || 0) === 2, `n=${uC?.length}`)
  atores.clubes.C_unidades = Object.fromEntries((uC || []).map((u) => [u.nome, u.id]))

  // A colisão que interessa: o MESMO nome em três clubes, com ids diferentes.
  const iguais = ['Falcão'].filter((n) => atores.clubes.B_unidades[n] && atores.clubes.C_unidades[n])
  ok('o mesmo NOME de unidade existe em B e C, com ids distintos',
    iguais.length === 1 && atores.clubes.B_unidades['Falcão'] !== atores.clubes.C_unidades['Falcão'])
}

// ---------------------------------------------------------------------------
// A PESSOA MULTI-CLUBE — e ela precisa nascer pelo produto, como todo o resto.
//
// É o ator mais importante da fase: quase tudo que a 8.4 encontrou só aparece para quem tem
// vínculo em mais de um clube. E, até a migration 61, não havia caminho de produto para criá-la —
// os 54 arquivos de teste anteriores montavam esses vínculos com INSERT direto, que é justamente
// o que esta fase proíbe. Aqui ela nasce por onde uma pessoa real nasceria: a diretoria de B
// convida, ela aceita, e passa a ter dois clubes.
// ---------------------------------------------------------------------------
console.log('\n-- a pessoa multi-clube (pelo convite de equipe, não por SQL) --')
{
  const sbB = sessao(fundadorB.token, atores.clubes.B)
  const { error: eConv } = await sbB.rpc('convite_equipe_criar', { p_email: emailC, p_papel: 'instrutor' })
  ok('a diretoria de B convida o fundador de C', !eConv, eConv?.message)

  // Quem aceita está operando em C — o vínculo tem de nascer no clube DO CONVITE, não no da aba.
  const sbC = sessao(fundadorC.token, atores.clubes.C)
  const { data: pend } = await sbC.rpc('convites_da_equipe')
  ok('o convidado enxerga o convite pendente', (pend?.length || 0) === 1, `n=${pend?.length}`)
  const { error: eAceite } = await sbC.rpc('convite_equipe_aceitar', { p_id: pend?.[0]?.id })
  ok('...e aceita, operando na aba de C', !eAceite, eAceite?.message)

  const { data: ctx } = await sessao(fundadorC.token).rpc('meu_contexto')
  const clubes = (ctx?.vinculos || []).map((v) => v.club_id)
  ok('agora ele tem vínculo nos DOIS clubes', clubes.length === 2, `n=${clubes.length}`)
  ok('...e são exatamente B e C', clubes.includes(atores.clubes.B) && clubes.includes(atores.clubes.C))
  atores.pessoas.multiclube = { ...fundadorC, email: emailC, clubes: { B: atores.clubes.B, C: atores.clubes.C } }
}

mkdirSync(dirname(join(process.cwd(), 'supabase/e2e/atores.json')), { recursive: true })
writeFileSync(join(process.cwd(), 'supabase/e2e/atores.json'), JSON.stringify(atores, null, 2))

console.log(`\n${falhas === 0 ? 'MONTAGEM OK' : `${falhas} FALHA(S) NA MONTAGEM`}\n`)
process.exit(falhas === 0 ? 0 : 1)
