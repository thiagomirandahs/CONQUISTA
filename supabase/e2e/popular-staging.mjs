// =============================================================================
//  Fase 9, item 3 — povoa o staging com as identidades e os dados do piloto A/B/C.
//
//  Roda DEPOIS de `montar-tres-clubes.mjs` (que cria B e C pelo onboarding). Aqui entram as
//  pessoas e o que elas fazem. A mesma regra da montagem: **tudo pelo produto** — cadastro,
//  código de entrada, aprovação, convite de equipe, convite de responsável, as RPCs e tabelas que
//  o app usa, com a sessão e a aba (header `x-clube-atual`) de quem age.
//
//  A ÚNICA exceção é o coordenador institucional: não existe caminho de produto para criar um
//  distrito nem para dar a alguém o papel de coordenador (medido na fase 9). Isso é feito por SQL
//  de plataforma, marcado como tal na saída — e é um achado do relatório, não um detalhe de setup.
//
//  Nada de dado pessoal real: e-mails `@staging.local`, nomes inventados, uma imagem de 1 pixel.
//
//  Uso:  SERVICE_ROLE_KEY=... ALVO=staging node supabase/e2e/popular-staging.mjs
//  Idempotente: rodar de novo não duplica pessoas nem vínculos (dados de atividade se somam).
//  Escreve supabase/e2e/populacao.staging.json (ids e e-mails; SEM tokens) — fora do git.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

if (process.env.ALVO !== 'staging') {
  console.error('Este script só povoa o STAGING. Rode com ALVO=staging.')
  process.exit(2)
}
const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const API = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SERVICE_ROLE_KEY
if (!API?.includes('55321')) { console.error(`.env.staging aponta para ${API}, não para o staging`); process.exit(2) }
if (!SERVICE) { console.error('Exporte SERVICE_ROLE_KEY (node scripts/staging.mjs chaves).'); process.exit(2) }
const DB = 'supabase_db_CONQUISTA-STAGING'
// Na versão 72 (antes da migration 73), quem é de dois clubes não grava mensalidade nem foto no
// clube que não é o mais antigo dele. Rodando contra um staging nessa versão — o "N" do drill de
// migration —, passe ESPERA_DEFEITO_73=1: essas recusas viram "conhecido em N" em vez de falha.
// Sem a variável, elas são falha. Nunca é uma heurística que decide sozinha o que é esperado.
const ESPERA_DEFEITO_73 = process.env.ESPERA_DEFEITO_73 === '1'
const conhecidos = []
const SENHA = 'Multiclube2026'

let falhas = 0
const achados = []
const ok = (n, c, d = '') => {
  if (c) console.log(`   OK      ${n}`)
  else { falhas++; achados.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`   FALHOU  ${n}${d ? `  [${d}]` : ''}`) }
  return c
}
const nota = (n) => console.log(`   ·       ${n}`)
// Recusa de quem age no clube que não é o seu mais antigo: é o defeito que a 73 corrige.
const multiNoOutroClube = (m, c) => { const p = PESSOAS.find((x) => gente[x.chave] === m); return p && (p.entra || []).indexOf(c) > 0 }
const okOuConhecido = (n, c, d, ehConhecido) => {
  if (!c && ESPERA_DEFEITO_73 && ehConhecido && /row-level security/.test(d || '')) {
    conhecidos.push(n); console.log(`   CONHEC. ${n}  [defeito da versão 72, corrigido pela 73]`); return false
  }
  return ok(n, c, d)
}
// C está no plano gratuito: estes recursos estão desligados lá, e a recusa É o comportamento certo.
const DESLIGADO_EM_C = /recurso está desabilitado/
const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
const anon = () => createClient(API, ANON, opcoes)
const adm = createClient(API, SERVICE, opcoes)
const sessao = (token, clube) => createClient(API, ANON, {
  ...opcoes, global: { headers: { Authorization: `Bearer ${token}`, ...(clube ? { 'x-clube-atual': clube } : {}) } },
})

// Confirmar e-mail é operação do GoTrue (o equivalente a clicar no link), não do schema do produto.
async function contaConfirmada(email, meta, senha = SENHA) {
  const { error } = await anon().auth.signUp({ email, password: senha, options: { data: meta } })
  if (error && !/already/i.test(error.message)) throw new Error(`cadastro ${email}: ${error.message}`)
  const { data: lista } = await adm.auth.admin.listUsers({ page: 1, perPage: 500 })
  const u = (lista?.users || []).find((x) => x.email === email)
  if (u && !u.email_confirmed_at) await adm.auth.admin.updateUserById(u.id, { email_confirm: true })
  return entrar(email, senha)
}
async function entrar(email, senha = SENHA) {
  const { data, error } = await anon().auth.signInWithPassword({ email, password: senha })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { id: data.user.id, token: data.session.access_token, email }
}
const rpc = async (sb, nome, args = {}) => {
  const { data, error } = await sb.rpc(nome, args)
  if (error) throw new Error(`${nome}: ${error.message}`)
  return data
}
const tenta = async (nome, fn) => {
  try { return await fn() } catch (e) { ok(nome, false, e.message); return null }
}
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8' }).trim()

// Uma imagem JPEG de 1 pixel. É a "foto" e a "evidência" de todo o staging: nenhuma imagem real.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

// ---------------------------------------------------------------------------
console.log('\n=== FASE 9 — povoando o staging ===\n')
const montagem = JSON.parse(readFileSync('supabase/e2e/atores.staging.json', 'utf8'))
const CLUBES = { A: montagem.clubes.A, B: montagem.clubes.B, C: montagem.clubes.C }
nota(`A=${CLUBES.A}  B=${CLUBES.B}  C=${CLUBES.C}`)

// As lideranças que operam cada clube. A é o legado (seed); B e C nasceram no onboarding.
const lider = {
  A: await entrar('tenant001@local.test', 'local-test-only'),
  B: await entrar('fundador.b@multiclube.local'),
  C: await entrar('fundador.c@multiclube.local'),
}
const naAba = (quem, clube) => sessao(quem.token, CLUBES[clube])

const unidades = {}
for (const c of ['A', 'B', 'C']) {
  const { data } = await naAba(lider[c], c).from('unidades').select('id,nome').order('nome')
  unidades[c] = data || []
  ok(`${c} tem unidades para distribuir as pessoas`, unidades[c].length > 0, `n=${unidades[c].length}`)
}

// O código de entrada de cada clube. Volta em claro UMA vez; o banco guarda só o hash.
const codigo = {}
for (const c of ['A', 'B', 'C']) {
  const r = await tenta(`código de entrada de ${c}`, () => rpc(naAba(lider[c], c), 'clube_codigo_gerar', { p_dias: 7 }))
  codigo[c] = r?.codigo || r?.code || null
  ok(`a liderança de ${c} gera o código de entrada`, !!codigo[c], JSON.stringify(r)?.slice(0, 80))
}

// O motor curricular nasce DESLIGADO (recursos_catalogo: classes = false). A liderança liga pela
// tela de Configurações, que chama `recurso_definir`. A e B ligam; C (plano gratuito) não.
for (const c of ['A', 'B']) {
  const r = await tenta(`${c} liga as classes (Configurações → Recursos)`, () => rpc(naAba(lider[c], c), 'recurso_definir', { p_feature: 'classes', p_enabled: true }))
  if (r !== null) ok(`${c} liga o motor curricular pela tela de recursos`, true)
}

// ---------------------------------------------------------------------------
//  AS IDENTIDADES
// ---------------------------------------------------------------------------
const PESSOAS = [
  { chave: 'so_a', nome: 'Ana Somente-A', entra: ['A'] },
  { chave: 'so_a2', nome: 'Davi Somente-A', entra: ['A'] },
  { chave: 'so_b', nome: 'Bia Somente-B', entra: ['B'] },
  { chave: 'so_b2', nome: 'Enzo Somente-B', entra: ['B'] },
  { chave: 'so_c', nome: 'Caio Somente-C', entra: ['C'] },
  { chave: 'ab', nome: 'Lia A-e-B', entra: ['A', 'B'] },
  { chave: 'abc', nome: 'Rui A-B-C', entra: ['A', 'B', 'C'] },
  { chave: 'dir_a_membro_b', nome: 'Vera Diretora-A Membro-B', entra: ['B'], equipe: [['A', 'diretoria']] },
  { chave: 'instrutor_ab', nome: 'Ivo Instrutor-A-B', equipe: [['A', 'instrutor'], ['B', 'instrutor']] },
]
const gente = {}

console.log('\n-- cadastro e entrada pelo código (a liderança aprova) --')
for (const p of PESSOAS) {
  const email = `${p.chave.replace(/_/g, '.')}@staging.local`
  const conta = await tenta(`cadastro de ${p.chave}`, () => contaConfirmada(email, { nome: p.nome, tipo: '', nascimento: '2012-05-10', cargo: '' }))
  if (!conta) continue
  gente[p.chave] = { ...conta, nome: p.nome }
  const jaEm = new Set(((await rpc(sessao(conta.token), 'meu_contexto'))?.vinculos || []).map((v) => v.club_id))

  for (const [i, c] of (p.entra || []).entries()) {
    if (jaEm.has(CLUBES[c])) { nota(`${p.chave} já é de ${c}`); continue }
    const sol = await tenta(`${p.chave} pede para entrar em ${c}`, () => rpc(sessao(conta.token), 'entrada_solicitar', { p_codigo: codigo[c] }))
    if (!sol?.encontrado) { ok(`${p.chave} → ${c}: o código foi aceito`, false, JSON.stringify(sol)); continue }
    const fila = await rpc(naAba(lider[c], c), 'entradas_pendentes')
    ok(`${p.chave} aparece na fila de aprovação de ${c}`, (fila || []).some((x) => x.id === conta.id))
    await tenta(`${c} aprova ${p.chave}`, () => rpc(naAba(lider[c], c), 'vinculo_gerir', { p_user_id: conta.id, p_status: 'ativo' }))
    const u = unidades[c][i % unidades[c].length]
    if (u) await tenta(`${c} põe ${p.chave} na unidade ${u.nome}`, () => rpc(naAba(lider[c], c), 'vinculo_gerir', { p_user_id: conta.id, p_unidade_id: u.id }))
  }

  for (const [c, papel] of p.equipe || []) {
    if (jaEm.has(CLUBES[c])) { nota(`${p.chave} já é da equipe de ${c}`); continue }
    await tenta(`${c} convida ${p.chave} como ${papel}`, () => rpc(naAba(lider[c], c), 'convite_equipe_criar', { p_email: email, p_papel: papel }))
    const convites = await rpc(sessao(conta.token), 'convites_da_equipe')
    const conv = (convites || []).find((x) => x.club_id === CLUBES[c] || x.clube_id === CLUBES[c]) || (convites || [])[0]
    if (!ok(`${p.chave} vê o convite de ${c}`, !!conv, JSON.stringify(convites)?.slice(0, 120))) continue
    await tenta(`${p.chave} aceita o convite de ${c}`, () => rpc(sessao(conta.token), 'convite_equipe_aceitar', { p_id: conv.id }))
  }

  const vinculos = (await rpc(sessao(conta.token), 'meu_contexto'))?.vinculos || []
  const esperado = new Set([...(p.entra || []), ...(p.equipe || []).map(([c]) => c)].map((c) => CLUBES[c]))
  const tem = new Set(vinculos.filter((v) => v.status === 'ativo').map((v) => v.club_id))
  ok(`${p.chave}: vínculos ativos exatamente em ${[...(p.entra || []), ...(p.equipe || []).map(([c]) => c)].join('+')}`,
    esperado.size === tem.size && [...esperado].every((x) => tem.has(x)),
    JSON.stringify(vinculos.map((v) => [v.club_id === CLUBES.A ? 'A' : v.club_id === CLUBES.B ? 'B' : v.club_id === CLUBES.C ? 'C' : '?', v.papel || v.role, v.status])))
}

console.log('\n-- responsável: convite da liderança de A, e o vínculo com o filho aprovado --')
{
  const email = 'responsavel@staging.local'
  const conv = await tenta('A cria o convite de responsável', () => rpc(naAba(lider.A, 'A'), 'criar_convite_responsavel'))
  const conta = await tenta('cadastro do responsável', () => contaConfirmada(email, { nome: 'Rita Responsável', tipo: 'pais', convite_responsavel: conv?.token || '' }))
  if (conta && conv?.token) {
    gente.responsavel = { ...conta, nome: 'Rita Responsável' }
    const jaEmA = ((await rpc(sessao(conta.token), 'meu_contexto'))?.vinculos || []).some((v) => v.club_id === CLUBES.A)
    if (!jaEmA) {
      const r = await tenta('o responsável aceita o convite', () => rpc(sessao(conta.token), 'convite_aceitar', { p_token: conv.token }))
      ok('...e o convite o leva para A', r?.encontrado === true, JSON.stringify(r))
    }
    const pedidos = (await sessao(conta.token, CLUBES.A).from('responsaveis').select('id,status')).data || []
    if (!pedidos.some((x) => x.status === 'aprovado')) {
      await tenta('o responsável pede o vínculo com "Ana Somente-A"', () => rpc(sessao(conta.token, CLUBES.A), 'pedir_vinculo', { p_nome: 'Ana Somente-A' }))
      const pend = await rpc(naAba(lider.A, 'A'), 'vinculos_pendentes')
      const pedido = (pend || []).find((x) => x.responsavel_id === conta.id || x.user_id === conta.id || x.pai_id === conta.id) || (pend || [])[0]
      if (ok('o pedido chega à liderança de A', !!pedido, JSON.stringify(pend)?.slice(0, 160))) {
        await tenta('A aprova o vínculo com a filha certa', () => rpc(naAba(lider.A, 'A'), 'aprovar_vinculo', { p_id: pedido.id, p_desbravador_id: gente.so_a.id }))
      }
    }
    const filhos = await rpc(sessao(conta.token, CLUBES.A), 'meus_filhos')
    ok('o responsável enxerga exatamente UMA filha, a certa', (filhos || []).length === 1 && filhos[0].id === gente.so_a?.id,
      JSON.stringify((filhos || []).map((f) => f.nome)))
  }
}

console.log('\n-- fundador sem clube (conta criada, onboarding nunca iniciado) --')
{
  const conta = await tenta('cadastro do fundador sem clube', () => contaConfirmada('fundador.sem.clube@staging.local', { nome: 'Otto Fundador-Sem-Clube', tipo: 'fundador' }))
  if (conta) {
    gente.fundador_sem_clube = { ...conta, nome: 'Otto Fundador-Sem-Clube' }
    const ctx = await rpc(sessao(conta.token), 'meu_contexto')
    ok('...e ele não tem vínculo nenhum (estado válido desde a 8.6)', (ctx?.vinculos || []).length === 0)
  }
}

console.log('\n-- coordenador institucional: OPERAÇÃO DE PLATAFORMA (SQL) — não há caminho de produto --')
{
  const conta = await tenta('cadastro do coordenador', () => contaConfirmada('coordenador@staging.local', { nome: 'Gil Coordenador-Distrital', tipo: '' }))
  if (conta) {
    gente.coordenador = { ...conta, nome: 'Gil Coordenador-Distrital' }
    // Distrito com A e B embaixo; C fica FORA de propósito (o coordenador não pode enxergá-lo).
    const saida = psql(`
      insert into public.organizational_units (type, nome, slug, metadata)
      values ('distrito', 'Distrito Staging do Agreste', 'staging-distrito-agreste', '{"staging":true}')
      on conflict (slug) do update set nome = excluded.nome;
      update public.organizational_units set parent_id = (select id from public.organizational_units where slug = 'staging-distrito-agreste')
       where id in ('${CLUBES.A}', '${CLUBES.B}');
      insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
      select '${conta.id}', id, 'coordenador_distrital', 'ativo' from public.organizational_units where slug = 'staging-distrito-agreste'
       and not exists (select 1 from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id
                        where m.user_id = '${conta.id}' and u.slug = 'staging-distrito-agreste');
      select id from public.organizational_units where slug = 'staging-distrito-agreste';`)
    gente.coordenador.distrito = saida.split('\n').pop()
    nota(`distrito ${gente.coordenador.distrito} (A e B embaixo; C fora) — criado por SQL de plataforma`)
  }
}

// ---------------------------------------------------------------------------
//  OS DADOS — cada um gravado na aba do clube em que acontece
// ---------------------------------------------------------------------------
const membrosDe = (c) => PESSOAS.filter((p) => (p.entra || []).includes(c) && gente[p.chave]).map((p) => gente[p.chave])
const hoje = new Date().toISOString().slice(0, 10)

console.log('\n-- pontos (apontamento da reunião, pela liderança) --')
for (const c of ['A', 'B', 'C']) {
  const itens = membrosDe(c).map((m, i) => ({ usuario_id: m.id, pontos: 10 + i * 5 }))
  const r = await tenta(`reunião de ${c} com ${itens.length} apontamentos`, () => rpc(naAba(lider[c], c), 'salvar_reuniao', { p_data: hoje, p_motivo: `Reunião de sábado (staging ${c})`, p_itens: itens }))
  if (r !== null) ok(`reunião de ${c} registrada com ${itens.length} apontamentos`, true)
}

console.log('\n-- mensalidades (o upsert que a tela faz, na aba do clube) --')
for (const c of ['A', 'B', 'C']) {
  for (const m of membrosDe(c)) {
    for (const mes of [7, 8]) {
      const { error } = await naAba(lider[c], c).from('mensalidades').upsert({
        desbravador_id: m.id, mes, ano: 2026, valor: c === 'C' ? 15 : 25, status: mes === 7 ? 'pago' : 'pendente',
        data_pagamento: mes === 7 ? `2026-07-1${mes % 10}` : null, registrado_por: lider[c].id,
      }, { onConflict: 'club_id,desbravador_id,mes,ano' })
      if (c === 'C') okOuConhecido(`C (gratuito) recusa a mensalidade de ${m.nome}: o recurso é desligado lá`, DESLIGADO_EM_C.test(error?.message || ''), error?.message || 'gravou', multiNoOutroClube(m, c))
      else okOuConhecido(`mensalidade ${mes}/2026 de ${m.nome} em ${c}`, !error, error?.message, multiNoOutroClube(m, c))
    }
  }
}

console.log('\n-- fotos no mural e partidas de jogo (cada pessoa, em cada clube dela) --')
for (const c of ['A', 'B', 'C']) {
  for (const m of membrosDe(c)) {
    const sb = naAba(m, c)
    const caminho = `mural/${m.id}-staging-${c}-${Date.now()}.jpg`
    const up = await sb.storage.from('imagens').upload(caminho, JPEG, { contentType: 'image/jpeg', upsert: true })
    if (!ok(`${m.nome} sobe a foto no Storage (aba ${c})`, !up.error, up.error?.message)) continue
    const { error } = await sb.from('fotos').insert({ url: caminho, evento: 'Acampamento', legenda: `staging ${c}`, autor_id: m.id })
    okOuConhecido(`${m.nome} publica a foto no mural de ${c}`, !error, error?.message, multiNoOutroClube(m, c))
    const { error: eJogo } = await sb.rpc('iniciar_jogo', { p_tipo: 'memoria' })
    if (c === 'C') ok(`C (gratuito) não tem jogos: a partida de ${m.nome} é recusada`, DESLIGADO_EM_C.test(eJogo?.message || ''), eJogo?.message || 'jogou')
    else ok(`${m.nome} joga uma partida em ${c}`, !eJogo, eJogo?.message)
  }
}

console.log('\n-- progresso curricular (classe) com evidência de criança --')
// OPERAÇÃO DE PLATAFORMA (SQL) nº 2: o "Curso de Leitura do ano" de cada classe é conteúdo
// dinâmico por ANO, e SEM o valor do ano o requisito fica bloqueado — nenhuma classe pode ser
// concluída. Em produção o único caminho é o manifesto validado (supabase/curriculo-manifesto/
// PUBLICACAO-CONTEUDO-ANUAL.md → conteudo_anual_publicar). Aqui é dado de STAGING, por SQL direto,
// mas já na regra da migration 84: ano explícito e vigência FECHADA no ano corrente do Brasil (um
// período aberto valeria nos anos seguintes — é exatamente o que a 84 proíbe).
{
  const n = psql(`
    with novos as (
      insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_descricao)
      select d.id, a.y, 'Livro do ano [STAGING]', make_date(a.y, 1, 1), make_date(a.y, 12, 31), 'staging: operação de plataforma (SQL)'
        from public.dynamic_content_definitions d, (select extract(year from public._data_no_brasil())::int as y) a
       where public.conteudo_dinamico_resolver(d.chave, public._data_no_brasil()) ->> 'valor' is null
      returning 1)
    select count(*) from novos;`)
  nota(`conteúdo do período publicado por SQL de plataforma para ${n} definição(ões) (0 = já estava)`)
}

// Ana (só A) leva a classe ATÉ O FIM: todos os requisitos, revisão final, investidura e documento
// — é o que dá ao staging um documento real para a jornada e para o red-team. Lia (A+B, agindo em
// B) e Bia (só B) ficam com UM requisito com evidência, avaliado: progresso parcial, em B.
const matriculas = {}
const requisitosDe = async (m, c, mcId) =>
  ((await rpc(naAba(m, c), 'minha_classe', { p_member_class_id: mcId }))?.secoes || []).flatMap((sec) => sec.requisitos || [])
async function cumprir(m, c, r, comFoto) {
  let evid = null
  if (comFoto) {
    evid = `${m.id}/classe/staging-${Date.now()}.jpg`
    const up = await naAba(m, c).storage.from('comprovacoes').upload(evid, JPEG, { contentType: 'image/jpeg' })
    ok(`${m.nome} sobe a evidência no bucket privado (${c})`, !up.error, up.error?.message)
  }
  // requisito de ESCOLHA ("1 especialidade à escolha"): as opções vêm em `escolha.opcoes`
  // — ou, quando a lista é aberta ("escolha 1 e informe qual foi"), em texto livre
  if (r.escolha) {
    const n = r.escolha.n_minimo || 1
    const ids = (r.escolha.opcoes || []).slice(0, n).map((o) => o.id)
    const livres = ids.length < n && r.escolha.aceita_texto_livre
      ? Array.from({ length: n - ids.length }, (_, i) => `Escolha de staging ${i + 1}`) : []
    await rpc(naAba(m, c), 'requisito_escolher', { p_requirement_id: r.id, p_option_ids: ids, p_rotulos_livres: livres })
  }
  await rpc(naAba(m, c), 'requisito_salvar', { p_requirement_id: r.id, p_texto: 'Fiz com a minha unidade (staging).', p_evidencia_path: evid })
  await rpc(naAba(m, c), 'requisito_enviar', { p_requirement_id: r.id })
}
async function avaliarTudo(m, c) {
  const avaliador = gente.instrutor_ab || lider[c]
  const pend = ((await rpc(naAba(avaliador, c), 'classe_avaliacoes_pendentes')) || []).filter((x) => x.usuario_id === m.id)
  for (const item of pend) {
    await rpc(naAba(avaliador, c), 'requisito_avaliar', { p_member_requirement_id: item.member_requirement_id, p_decisao: 'aprovado', p_comentario: 'ok (staging)' })
  }
  return pend.length
}
for (const [c, quem, completa] of [['A', 'so_a', true], ['B', 'ab', false], ['B', 'so_b', false]]) {
  const m = gente[quem]
  if (!m) continue
  const classes = await tenta(`${c} lista as classes`, () => rpc(naAba(lider[c], c), 'classes_disponiveis'))
  const classe = (classes || [])[0]
  const mc = classe && await tenta(`${c} atribui a classe ${classe.nome} a ${m.nome}`, () => rpc(naAba(lider[c], c), 'classe_atribuir', { p_usuario_id: m.id, p_class_id: classe.class_id }))
  const mcId = mc?.member_class_id || mc?.id || (typeof mc === 'string' ? mc : null)
  if (!ok(`${m.nome} tem matrícula na classe em ${c}`, !!mcId, JSON.stringify(mc)?.slice(0, 120))) continue
  matriculas[`${quem}@${c}`] = mcId
  const abertos = (await requisitosDe(m, c, mcId)).filter((r) => !['aprovado', 'enviado', 'em_avaliacao'].includes(r.status))
  const alvo = completa ? abertos : abertos.filter((r) => !r.escolha).slice(0, 1)
  let feitos = 0
  for (const [i, r] of alvo.entries()) {
    try { await cumprir(m, c, r, i === 0); feitos++ } catch (e) { ok(`${m.nome} cumpre o requisito ${r.codigo || r.id}`, false, e.message); break }
  }
  const avaliados = await tenta(`avaliação dos requisitos de ${m.nome} em ${c}`, () => avaliarTudo(m, c))
  ok(`${m.nome}: ${feitos} requisito(s) enviado(s) e ${avaliados} avaliado(s) em ${c}`, feitos === alvo.length && avaliados === feitos, `alvo=${alvo.length}`)
  if (!completa) continue

  // A conclusão, passo a passo conforme o status (o último requisito aprovado já pode ter levado a
  // matrícula para "aguardando_revisao" sozinho — e rodar de novo não pode repetir a investidura).
  const status = async () => (await rpc(naAba(m, c), 'minha_classe', { p_member_class_id: mcId }))?.member_class?.status
  if (await status() === 'requisitos_concluidos') {
    await tenta(`a liderança de ${c} pede a revisão final de ${m.nome}`, () => rpc(naAba(gente.instrutor_ab || lider[c], c), 'classe_revisao_solicitar', { p_member_class_id: mcId }))
  }
  if (await status() === 'aguardando_revisao') {
    await tenta(`a diretoria de ${c} aprova a revisão final`, () => rpc(naAba(lider[c], c), 'revisao_final_decidir', { p_member_class_id: mcId, p_decisao: 'aprovado', p_observacao: 'Revisado (staging).' }))
  }
  if (!['investido', 'investida', 'concluida'].includes(await status())) {
    await tenta(`a diretoria de ${c} registra a investidura`, () => rpc(naAba(lider[c], c), 'investidura_registrar', { p_member_class_id: mcId, p_observacao: 'Investidura de staging.' }))
  }
  nota(`matrícula de ${m.nome} em ${c}: ${await status()}`)
}

console.log('\n-- especialidade --')
for (const [c, quem] of [['B', 'abc'], ['A', 'abc']]) {
  const esp = await tenta(`${c} lista as especialidades`, () => rpc(naAba(lider[c], c), 'especialidades_disponiveis'))
  const e = (esp || [])[0]
  if (!ok(`${c} tem especialidade disponível`, !!e, JSON.stringify(esp)?.slice(0, 120))) continue
  await tenta(`${c} atribui ${e.nome} a ${gente[quem]?.nome}`, () => rpc(naAba(lider[c], c), 'especialidade_atribuir', { p_usuario_id: gente[quem].id, p_specialty_id: e.specialty_id || e.id }))
}

console.log('\n-- experiência (B tem o recurso; C não tem) --')
for (const c of ['B', 'C']) {
  if (c === 'C') {
    const { error } = await naAba(lider.C, 'C').rpc('experiencia_do_template', { p_chave: 'leitura-da-semana' })
    ok('C (plano gratuito, sem o recurso) NÃO cria experiência', DESLIGADO_EM_C.test(error?.message || ''), error?.message || 'criou')
    continue
  }
  const exp = await tenta(`${c} cria a experiência do modelo "leitura-da-semana"`, () => rpc(naAba(lider[c], c), 'experiencia_do_template', { p_chave: 'leitura-da-semana' }))
  const expId = exp?.id || exp?.experience_id
  if (!expId) continue
  await tenta('B define o público (todos)', () => rpc(naAba(lider.B, 'B'), 'experiencia_publico_definir', { p_experience_id: expId, p_publico: [{ tipo: 'todos' }] }))
  await tenta('B publica a experiência', () => rpc(naAba(lider.B, 'B'), 'experiencia_estado', { p_experience_id: expId, p_novo: 'publicada' }))
  for (const m of membrosDe('B')) await tenta(`${m.nome} participa da experiência em B`, () => rpc(naAba(m, 'B'), 'experiencia_participar', { p_experience_id: expId }))
}

console.log('\n-- documento da matrícula --')
for (const [chave, mcId] of Object.entries(matriculas)) {
  const [quem, c] = chave.split('@')
  const { data, error } = await naAba(lider[c], c).rpc('documento_emitir', { p_member_class_id: mcId })
  if (quem === 'so_a') ok(`o documento da classe concluída de ${quem} é emitido em ${c}`, !error && !!data, error?.message)
  else ok(`...e o de ${quem} (classe incompleta) é RECUSADO em ${c}`, /conclusão selada/.test(error?.message || ''), error?.message || 'emitiu')
}

// ---------------------------------------------------------------------------
//  O RETRATO — contado FORA da RLS, direto no banco
// ---------------------------------------------------------------------------
console.log('\n-- o retrato do staging (contado no banco, fora da RLS) --')
const retrato = psql(`
  select string_agg(format('%s: %s', t, n), E'\\n' order by t) from (
    select 'clubes' t, count(*)::text n from public.organizational_units where type = 'clube'
    union all select 'contas (auth.users)', count(*)::text from auth.users
    union all select 'vínculos ativos por clube', string_agg(format('%s=%s', u.nome, x.n), ', ') from
      (select organizational_unit_id, count(*) n from public.organization_memberships where status = 'ativo' group by 1) x
      join public.organizational_units u on u.id = x.organizational_unit_id
    union all select 'pessoas em 2+ clubes', count(*)::text from (select user_id from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
      where m.status = 'ativo' group by user_id having count(*) > 1) y
    union all select 'mensalidades por clube', string_agg(format('%s=%s', u.nome, x.n), ', ') from
      (select club_id, count(*) n from public.mensalidades group by 1) x join public.organizational_units u on u.id = x.club_id
    union all select 'fotos por clube', string_agg(format('%s=%s', u.nome, x.n), ', ') from
      (select club_id, count(*) n from public.fotos group by 1) x join public.organizational_units u on u.id = x.club_id
    union all select 'objetos no Storage', string_agg(format('%s=%s', bucket_id, n), ', ') from (select bucket_id, count(*) n from storage.objects group by 1) s
  ) r;`)
console.log(retrato.split('\n').map((l) => `   ·       ${l}`).join('\n'))

writeFileSync('supabase/e2e/populacao.staging.json', JSON.stringify({
  clubes: CLUBES,
  pessoas: Object.fromEntries(Object.entries(gente).map(([k, v]) => [k, { id: v.id, email: v.email, nome: v.nome, ...(v.distrito ? { distrito: v.distrito } : {}) }])),
  senha_das_contas_sinteticas: SENHA,
  matriculas,
}, null, 2))
console.log('   ·       ids em supabase/e2e/populacao.staging.json (sem tokens)')

if (conhecidos.length) console.log(`
   ${conhecidos.length} recusa(s) CONHECIDA(S) da versão 72 (ESPERA_DEFEITO_73=1) — rode de novo depois da migration`)
if (achados.length) {
  console.log('\n-- o que não funcionou (achados, não detalhes de setup) --')
  for (const a of achados) console.log(`   ·  ${a}`)
}
console.log(`\n${falhas === 0 ? 'POVOAMENTO OK' : `${falhas} FALHA(S) NO POVOAMENTO`}\n`)
process.exit(falhas === 0 ? 0 : 1)
