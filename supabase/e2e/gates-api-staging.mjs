// =============================================================================
//  Fase 9, item 5 — os CINCO GATES pelo caminho de verdade: HTTP → PostgREST → RLS → banco.
//
//  Os gates SQL (55, 56, 57, 58, 24…) simulam a requisição com `set_config`. Este aqui manda a
//  requisição de verdade: JWT emitido pelo auth do staging, header `x-clube-atual` como a aba manda,
//  identidades e dados criados pelo POVOAMENTO (não por fixture). E a regra do item 5:
//
//      "Não aceite apenas HTTP 200/403 como evidência. Confira estado real do banco fora da RLS."
//
//  Então toda escrita é medida no banco, por `docker exec psql` como superusuário, ANTES e DEPOIS —
//  e toda leitura vazia só conta se o banco provar que havia o que vazar (o PISO).
//
//    1. ISOLAMENTO DE LEITURA   cada identidade × cada contexto × cada tabela operacional
//    2. ISOLAMENTO DE ESCRITA   escrever no próprio clube, no clube alheio, forjando club_id, PATCH e
//                               DELETE em linha alheia — medido no banco
//    3. INTEGRIDADE DE CONTEXTO header de clube alheio, lixo, clube inexistente, distrito, ausente
//    4. FRONTEIRA DO PORTÁTIL   o que viaja com a pessoa viaja; o operacional não
//    5. ISOLAMENTO DE IDENTIDADE token adulterado, token de outro ambiente, logout, oráculos
//
//  Uso:  ALVO=staging node supabase/e2e/gates-api-staging.mjs
//  Tudo o que ele grava é marcado e APAGADO no fim (fora da RLS). O staging sai como entrou.
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
const NOME = { [C.A]: 'A', [C.B]: 'B', [C.C]: 'C' }
const MARCA = `gate-api-${Date.now().toString(36)}`

const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8' }).trim()
const verdade = (sql) => Number(psql(sql))

const placar = {}
const falhas = []
let gateAtual = ''
const gate = (n) => { gateAtual = n; placar[n] = { ok: 0, falhou: 0 }; console.log(`\n== ${n} ==`) }
const ok = (n, c, d = '') => {
  if (c) placar[gateAtual].ok++
  else { placar[gateAtual].falhou++; falhas.push(`[${gateAtual}] ${n}${d ? ` — ${d}` : ''}`); console.log(`   FALHOU  ${n}${d ? `  [${d}]` : ''}`) }
  return c
}
const nota = (n) => console.log(`   ·       ${n}`)

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
async function entrar(email, senha = SENHA) {
  const { data, error } = await createClient(API, ANON, opcoes).auth.signInWithPassword({ email, password: senha })
  if (error) throw new Error(`${email}: ${error.message}`)
  return { id: data.user.id, token: data.session.access_token, refresh: data.session.refresh_token }
}
const cliente = (token, header) => createClient(API, ANON, {
  ...opcoes, global: { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(header !== undefined ? { 'x-clube-atual': header } : {}) } },
})

// ---------------------------------------------------------------------------
//  As identidades e os clubes em que cada uma está ATIVA — tirados do BANCO, não do script.
// ---------------------------------------------------------------------------
const P = pop.pessoas
const quem = {}
for (const k of ['so_a', 'so_b', 'so_c', 'ab', 'abc', 'dir_a_membro_b', 'instrutor_ab', 'responsavel', 'coordenador', 'fundador_sem_clube']) {
  quem[k] = await entrar(P[k].email)
}
quem.lider_a = await entrar('tenant001@local.test', 'local-test-only')
quem.lider_b = await entrar('fundador.b@multiclube.local')
quem.lider_c = await entrar('fundador.c@multiclube.local')
// só CLUBES (um distrito não é aba de dado operacional), e o padrão: o clube ativo mais antigo —
// é o que `clube_atual_id()` usa quando a requisição não manda header.
const ativosDe = (id) => psql(`select coalesce(string_agg(m.organizational_unit_id::text, ',' order by m.starts_at, m.created_at, m.id), '')
  from public.organization_memberships m join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = '${id}' and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())`).split(',').filter(Boolean)
for (const q of Object.values(quem)) { q.clubes = ativosDe(q.id); q.padrao = q.clubes[0] || null }

const DISTRITO = P.coordenador.distrito
const CONTEXTOS = {
  A: C.A, B: C.B, C: C.C,
  'sem header': undefined,
  'lixo': 'nao-e-um-uuid',
  'clube inexistente': '00000000-0000-4000-8000-00000000dead',
  'distrito': DISTRITO,
}
// `experiences` fica de fora da leitura direta: a policy dela chama `_experiencia_no_publico`, que
// `authenticated` não pode executar — TODA leitura direta dá erro (falha fechada). O app lê pela RPC
// `experiencias_do_clube`, e é por ela que o gate confere, logo abaixo. Registrado como achado BAIXO.
const TABELAS = ['fotos', 'mensalidades', 'pontos', 'member_classes', 'notificacoes', 'unidades', 'chat_mensagens']

// ===========================================================================
gate('1. ISOLAMENTO DE LEITURA')
// O piso: o que existe em cada clube, fora da RLS. Uma leitura vazia só prova isolamento se o
// clube tinha linha para vazar.
const piso = {}
for (const t of TABELAS) {
  piso[t] = Object.fromEntries(Object.entries(C).map(([n, id]) => [n, verdade(`select count(*) from public.${t} where club_id = '${id}'`)]))
}
nota(`piso (linhas por clube, fora da RLS): ${TABELAS.map((t) => `${t} ${piso[t].A}/${piso[t].B}/${piso[t].C}`).join(' · ')}`)
let leituras = 0
for (const [k, q] of Object.entries(quem)) {
  for (const [ctx, header] of Object.entries(CONTEXTOS)) {
    const sb = cliente(q.token, header)
    for (const t of TABELAS) {
      const { data, error } = await sb.from(t).select('club_id').limit(1000)
      leituras++
      const clubesVistos = [...new Set((data || []).map((r) => r.club_id))]
      // o único clube que PODE aparecer: o da aba, se a pessoa estiver ativa nele. Sem header, o
      // servidor usa o clube ativo mais antigo da pessoa.
      const abaEfetiva = header === undefined ? q.padrao : header
      const permitido = q.clubes.includes(abaEfetiva) ? [abaEfetiva] : []
      ok(`${k} · ${ctx} · ${t}: só vê o clube da aba (e só se for dela)`,
        !error && clubesVistos.every((c) => permitido.includes(c)),
        error?.message || `viu ${clubesVistos.map((c) => NOME[c] || c).join(',')} permitido=${permitido.map((c) => NOME[c]).join(',') || 'nada'}`)
    }
  }
}
// profiles: a regra é por PESSOA (vê quem compartilha algum clube com ela), não por aba — escrita
// no gate 56. O que se confere: uma pessoa de UM clube só nunca vê ninguém de fora dele.
for (const k of ['so_a', 'so_b', 'so_c']) {
  const { data } = await cliente(quem[k].token, quem[k].clubes[0]).from('profiles').select('id')
  const fora = (data || []).filter((p) => p.id !== quem[k].id && !ativosDe(p.id).includes(quem[k].clubes[0]))
  ok(`${k}: os perfis que enxerga são todos do clube dela (${(data || []).length})`, fora.length === 0, `${fora.length} de fora`)
}
// experiências, pelo caminho do app: os ids que a RPC devolve têm de ser todos do clube da aba
const expDe = (clube) => psql(`select coalesce(string_agg(id::text, ','), '') from public.experiences where club_id = '${clube}'`).split(',').filter(Boolean)
const expPorClube = Object.fromEntries(Object.values(C).map((id) => [id, expDe(id)]))
for (const [k, q] of Object.entries(quem)) {
  for (const [ctx, header] of Object.entries(CONTEXTOS)) {
    const { data, error } = await cliente(q.token, header).rpc('experiencias_do_clube', { p_incluir_rascunhos: true })
    leituras++
    const abaEfetiva = header === undefined ? q.padrao : header
    const deOnde = (data || []).map((e) => Object.entries(expPorClube).find(([, ids]) => ids.includes(e.id))?.[0])
    ok(`${k} · ${ctx} · experiências (RPC do app): só do clube da aba`,
      deOnde.every((c) => c === abaEfetiva && q.clubes.includes(c)), error?.message || `de ${deOnde.map((c) => NOME[c] || c)}`)
  }
}
nota(`${leituras} leituras (tabelas + RPC de experiências), cada uma conferida contra o clube da aba`)
const { error: eDireta } = await cliente(quem.so_b.token, C.B).from('experiences').select('id').limit(1)
nota(`leitura DIRETA de experiences por um membro: ${eDireta ? 'ERRO (' + eDireta.message + ') — falha fechada' : 'funciona'}`)

// ===========================================================================
gate('2. ISOLAMENTO DE ESCRITA')
const fotosDe = (id) => verdade(`select count(*) from public.fotos where club_id = '${id}'`)
const mensDe = (id) => verdade(`select count(*) from public.mensalidades where club_id = '${id}'`)
const retrato = () => JSON.stringify(Object.values(C).map((id) => [fotosDe(id), mensDe(id)]))
for (const [k, q] of Object.entries(quem)) {
  for (const [ctx, header] of Object.entries(CONTEXTOS)) {
    const sb = cliente(q.token, header)
    const antes = Object.fromEntries(Object.values(C).map((id) => [id, fotosDe(id)]))
    const { error } = await sb.from('fotos').insert({ url: `mural/${q.id}-${MARCA}.jpg`, evento: 'Gate', legenda: MARCA, autor_id: q.id })
    const depois = Object.fromEntries(Object.values(C).map((id) => [id, fotosDe(id)]))
    const cresceu = Object.values(C).filter((id) => depois[id] > antes[id])
    const abaEfetiva = header === undefined ? q.padrao : header
    const podia = q.clubes.includes(abaEfetiva) && k !== 'responsavel'
    if (podia) ok(`${k} · ${ctx}: a foto cai NO clube da aba, e só nele`, !error && cresceu.length === 1 && cresceu[0] === abaEfetiva, error?.message || `cresceu ${cresceu.map((c) => NOME[c])}`)
    else ok(`${k} · ${ctx}: sem vínculo ativo na aba, a foto NÃO cai em lugar nenhum`, cresceu.length === 0, `cresceu ${cresceu.map((c) => NOME[c])}`)
    // forjando club_id de um clube em que a pessoa NÃO está na aba
    for (const alvo of Object.values(C).filter((id) => id !== abaEfetiva)) {
      const a0 = fotosDe(alvo)
      await sb.from('fotos').insert({ url: `mural/${q.id}-${MARCA}.jpg`, evento: 'Gate', legenda: MARCA, autor_id: q.id, club_id: alvo })
      ok(`${k} · ${ctx}: club_id forjado para ${NOME[alvo]} não grava lá`, fotosDe(alvo) === a0)
    }
  }
}
// PATCH e DELETE em linha ALHEIA: a resposta pode ser 200 com zero linhas — o que conta é o banco.
// o alvo: uma foto de OUTRA pessoa. Apagar a própria foto é permitido (e o primeiro ensaio deste
// gate apagou fotos legítimas por escolher "qualquer foto do clube" — erro do teste, não do produto).
const fotoDe = (clube, ator) => psql(`select id from public.fotos where club_id = '${clube}' and legenda <> '${MARCA}' and autor_id is distinct from '${ator}' limit 1`)
// moderar (apagar foto alheia) é direito de instrutor/diretoria do clube: esses casos são legítimos
const modera = (ator, clube) => verdade(`select count(*) from public.organization_memberships where user_id = '${ator}' and organizational_unit_id = '${clube}'
  and role in ('instrutor', 'diretoria') and status = 'ativo'`) > 0
for (const [k, q] of Object.entries(quem)) {
  for (const alvoNome of ['A', 'B', 'C']) {
    const alvo = C[alvoNome]
    if (modera(q.id, alvo)) continue   // instrutor/diretoria do clube PODE apagar foto alheia
    const id = fotoDe(alvo, q.id)
    const leg0 = psql(`select legenda from public.fotos where id = '${id}'`)
    for (const aba of [alvo, q.clubes[0]].filter(Boolean)) {
      await cliente(q.token, aba).from('fotos').update({ legenda: `${MARCA}-invadido` }).eq('id', id)
      await cliente(q.token, aba).from('fotos').delete().eq('id', id)
    }
    const agora = psql(`select coalesce((select legenda from public.fotos where id = '${id}'), '(APAGADA)')`)
    ok(`${k}: PATCH/DELETE na foto de ${alvoNome} não mudou o banco`, agora === leg0, `agora=${agora}`)
  }
}
// liderança escrevendo o caixa de OUTRO clube (e o apontamento), pela aba própria e pela alheia
const membroSoDe = { A: P.so_a.id, B: P.so_b.id, C: P.so_c.id }
for (const [lk, meu] of [['lider_a', 'A'], ['lider_b', 'B'], ['lider_c', 'C']]) {
  for (const outro of ['A', 'B', 'C'].filter((x) => x !== meu)) {
    // Quem é liderança do OUTRO clube também (pelo banco, não pelo nome) pode escrever lá — é
    // legítimo. A UAT da fase 9 fez o fundador de C aceitar um convite de instrutor em B, e a 2ª
    // rodada deste gate acusou "furo" onde havia só o dado novo: a regra agora é o papel real.
    if (modera(quem[lk].id, C[outro])) { nota(`${lk} é liderança de ${outro} também — escrever lá é legítimo, pulado`); continue }
    const r0 = retrato()
    for (const aba of [C[meu], C[outro]]) {
      await cliente(quem[lk].token, aba).from('mensalidades').upsert({ desbravador_id: membroSoDe[outro], mes: 11, ano: 2026, valor: 1, status: 'pago' }, { onConflict: 'club_id,desbravador_id,mes,ano' })
      await cliente(quem[lk].token, aba).rpc('salvar_reuniao', { p_data: '2026-11-07', p_motivo: MARCA, p_itens: [{ usuario_id: membroSoDe[outro], pontos: 99 }] })
    }
    ok(`${lk} não grava caixa nem pontos de ${outro} (pela aba própria nem pela alheia)`,
      retrato() === r0 && verdade(`select count(*) from public.pontos where motivo = '${MARCA}'`) === 0)
  }
}

// ===========================================================================
gate('3. INTEGRIDADE DE CONTEXTO')
{
  // a MESMA sessão, duas abas: cada uma vê o seu clube
  for (const k of ['ab', 'abc', 'instrutor_ab', 'dir_a_membro_b']) {
    const vistos = {}
    for (const n of ['A', 'B', 'C']) {
      const { data } = await cliente(quem[k].token, C[n]).from('fotos').select('club_id')
      vistos[n] = [...new Set((data || []).map((r) => NOME[r.club_id]))].join('')
    }
    const esperado = Object.fromEntries(['A', 'B', 'C'].map((n) => [n, quem[k].clubes.includes(C[n]) && piso.fotos[n] > 0 ? n : '']))
    ok(`${k}: a mesma sessão em três abas vê exatamente o clube de cada aba`, JSON.stringify(vistos) === JSON.stringify(esperado), JSON.stringify(vistos))
  }
  // o que o servidor responde como "clube em uso" para cada header — a verdade que decide tudo
  for (const [ctx, header] of Object.entries(CONTEXTOS)) {
    const { data } = await cliente(quem.ab.token, header).rpc('meu_contexto')
    const atual = data?.clube_atual?.id || data?.clube_atual_id || data?.clube_atual || null
    const esperado = ctx === 'A' ? C.A : ctx === 'B' ? C.B : ctx === 'sem header' ? quem.ab.padrao : null
    ok(`Lia · header ${ctx}: o servidor resolve o clube em uso para ${NOME[esperado] || 'NENHUM'} (sem cair em outro)`,
      (atual || null) === esperado || (typeof atual === 'object' && atual?.id === esperado), JSON.stringify(atual))
  }
  // um DISTRITO na aba não é clube em uso — mesmo para quem tem vínculo ativo nele (migration 75).
  // Achado por este gate: antes, o coordenador publicava no mural e adotava bichinho "no distrito".
  {
    const sbD = cliente(quem.coordenador.token, DISTRITO)
    const { data: ctxD } = await sbD.rpc('meu_contexto')
    ok('coordenador · header = distrito: o servidor NÃO resolve clube em uso', !ctxD?.clube_atual_id, JSON.stringify(ctxD?.clube_atual_id))
    await sbD.from('fotos').insert({ url: `mural/${quem.coordenador.id}-${MARCA}.jpg`, evento: 'Gate', legenda: MARCA, autor_id: quem.coordenador.id })
    await sbD.rpc('bichinho_adotar', { p_nome: MARCA.slice(0, 20), p_especie: 'cachorro' })
    const noDistrito = verdade(`select (select count(*) from public.fotos where club_id = '${DISTRITO}') + (select count(*) from public.bichinhos where club_id = '${DISTRITO}')`)
    ok('...e nada é gravado com club_id = distrito (foto nem bichinho), conferido no banco', noDistrito === 0, `${noDistrito} linha(s)`)
  }
  // sem header, cada um cai no PRÓPRIO clube padrão — nunca no legado por ser o legado
  const { data: fotosSoB } = await cliente(quem.so_b.token).from('fotos').select('club_id')
  ok('Bia (só B), sem header: vê só B, nada do clube legado A', (fotosSoB || []).length > 0 && fotosSoB.every((f) => f.club_id === C.B) && piso.fotos.A > 0)
}

// ===========================================================================
gate('4. FRONTEIRA DO PORTÁTIL')
{
  const mcAna = pop.matriculas['so_a@A']
  const mcLia = pop.matriculas['ab@B']
  // o que VIAJA: o documento da classe concluída é conferível por token, por qualquer um
  const { data: docs } = await cliente(quem.lider_a.token, C.A).rpc('documentos_da_matricula', { p_member_class_id: mcAna })
  const token = docs?.[0]?.token
  ok('o documento de Ana tem token público de conferência', !!token)
  if (token) {
    const { data: v1 } = await cliente(null).rpc('documento_verificar', { p_token: token })
    ok('...que qualquer um (até sem login) confere', !!v1 && v1.valido !== false, JSON.stringify(v1)?.slice(0, 120))
    const exposto = JSON.stringify(v1 || {})
    ok('...e a conferência NÃO expõe e-mail, nascimento nem id interno da criança',
      !exposto.includes(P.so_a.email) && !/nascimento|2012-05-10/.test(exposto) && !exposto.includes(P.so_a.id), exposto.slice(0, 160))
    const { data: v2 } = await cliente(null).rpc('documento_verificar', { p_token: token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa') })
    ok('...e um token adulterado não confere', !v2 || v2.valido === false || v2.encontrado === false, JSON.stringify(v2)?.slice(0, 80))
  }
  // o que NÃO viaja: a matrícula em andamento é operacional, do clube
  const { data: m1 } = await cliente(quem.ab.token, C.A).from('member_classes').select('id').eq('id', mcLia)
  ok('Lia, na aba A, não vê a própria matrícula de B (operacional é por clube)', (m1 || []).length === 0)
  const { data: m2 } = await cliente(quem.ab.token, C.B).from('member_classes').select('id').eq('id', mcLia)
  ok('...e na aba B vê', (m2 || []).length === 1)
  const { data: m3, error: e3 } = await cliente(quem.lider_a.token, C.A).rpc('minha_classe', { p_member_class_id: mcLia })
  ok('a liderança de A não abre a matrícula que Lia tem em B', !!e3 || !m3, JSON.stringify(m3)?.slice(0, 80))
  const { data: d3 } = await cliente(quem.lider_b.token, C.B).rpc('documentos_da_matricula', { p_member_class_id: mcAna })
  ok('a liderança de B não lista os documentos da matrícula de A', !(d3 || []).length)
  // a evidência da criança NÃO viaja: é do dono e da liderança do clube dele
  const evid = psql(`select name from storage.objects where bucket_id = 'comprovacoes' and name like '${P.so_a.id}/%' limit 1`)
  for (const [k, aba] of [['so_b', C.B], ['lider_b', C.B], ['lider_c', C.C], ['ab', C.B], ['responsavel', C.A]]) {
    const { data } = await cliente(quem[k].token, aba).storage.from('comprovacoes').download(evid)
    const deveVer = k === 'responsavel' ? null : false
    if (deveVer === false) ok(`${k} não baixa a evidência de Ana (criança de A)`, !data)
  }
  const { data: propria } = await cliente(quem.so_a.token, C.A).storage.from('comprovacoes').download(evid)
  ok('...e a própria Ana baixa', !!propria)
}

// ===========================================================================
gate('5. ISOLAMENTO DE IDENTIDADE')
{
  const adulterado = quem.so_a.token.slice(0, -4) + (quem.so_a.token.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  const r1 = await fetch(`${API}/rest/v1/fotos?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${adulterado}`, 'x-clube-atual': C.A } })
  ok('token com assinatura adulterada é recusado (401), não lido como anônimo', r1.status === 401, `HTTP ${r1.status}`)
  // um token emitido pelo ambiente de DESENVOLVIMENTO (outro domínio de confiança)
  try {
    const dev = await createClient('http://127.0.0.1:54321', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', opcoes)
      .auth.signInWithPassword({ email: 'fundador.b@multiclube.local', password: SENHA })
    if (dev.data?.session) {
      const r2 = await fetch(`${API}/rest/v1/rpc/meu_contexto`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${dev.data.session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' })
      ok('token do ambiente de DESENVOLVIMENTO é recusado pelo staging', r2.status === 401, `HTTP ${r2.status}`)
    } else nota('desenvolvimento sem essa conta: conferência de domínio de confiança feita por `node scripts/staging.mjs conferir`')
  } catch { nota('desenvolvimento fora do ar: conferência feita por `node scripts/staging.mjs conferir`') }
  // o id de outra pessoa no corpo não troca quem age
  const a0 = fotosDe(C.B)
  await cliente(quem.so_a.token, C.B).from('fotos').insert({ url: `mural/${P.so_b.id}-${MARCA}.jpg`, evento: 'Gate', legenda: MARCA, autor_id: P.so_b.id })
  ok('Ana não publica EM NOME de Bia (autor_id alheio no corpo)', fotosDe(C.B) === a0)
  // logout: o refresh morre; o access token vive até expirar (JWT sem estado) — medido, não suposto
  const sessaoTemp = await entrar(P.so_c.email)
  const sbTemp = createClient(API, ANON, opcoes)
  await sbTemp.auth.setSession({ access_token: sessaoTemp.token, refresh_token: sessaoTemp.refresh })
  await sbTemp.auth.signOut({ scope: 'global' })
  const { error: eRefresh } = await createClient(API, ANON, opcoes).auth.refreshSession({ refresh_token: sessaoTemp.refresh })
  ok('depois do logout, o refresh token não renova mais a sessão', !!eRefresh, 'renovou')
  const r3 = await fetch(`${API}/rest/v1/rpc/meu_contexto`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${sessaoTemp.token}`, 'Content-Type': 'application/json' }, body: '{}' })
  const exp = JSON.parse(Buffer.from(sessaoTemp.token.split('.')[1], 'base64url').toString()).exp
  nota(`depois do logout, o ACCESS token antigo responde HTTP ${r3.status} — vale até expirar (${Math.round((exp * 1000 - Date.now()) / 60000)} min). Propriedade do JWT sem estado: registrado como risco residual.`)
  // oráculo: um código de entrada que não existe e um que existe respondem com a MESMA forma
  const { data: o1 } = await cliente(quem.fundador_sem_clube.token).rpc('entrada_abrir', { p_codigo: 'ZZZZ-9999' })
  ok('código inexistente: {encontrado:false}, sem dizer por quê', o1?.encontrado === false && Object.keys(o1).length === 1, JSON.stringify(o1))
}

// ---------------------------------------------------------------------------
//  Limpeza, fora da RLS, e o placar
// ---------------------------------------------------------------------------
const apagadas = psql(`with d as (delete from public.fotos where legenda like '${MARCA}%' returning 1) select count(*) from d;`)
psql(`delete from public.pontos where motivo = '${MARCA}';`)
psql(`delete from public.bichinhos where nome = '${MARCA.slice(0, 20)}';`)
console.log(`\n   ·       limpeza: ${apagadas} foto(s) de gate apagadas; o staging sai como entrou`)
console.log('\n==============================================================')
let total = 0
for (const [g, p] of Object.entries(placar)) { console.log(` ${g.padEnd(30)} ${String(p.ok).padStart(5)} OK   ${p.falhou} falha(s)`); total += p.falhou }
console.log(`\n RESULTADO: ${total === 0 ? 'OS CINCO GATES PASSAM PELA API' : `${total} FALHA(S)`}`)
console.log('==============================================================')
for (const f of falhas.slice(0, 40)) console.log(`   ·  ${f}`)
process.exit(total === 0 ? 0 : 1)
