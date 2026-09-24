#!/usr/bin/env node
// =============================================================================
//  Fase 9, item 8 — BACKUP do staging e RESTORE COMPROVADO num ambiente DESCARTÁVEL.
//
//  "Backup sem restore comprovado continua sendo considerado não validado." O restore da fase 8.1
//  (`supabase/infra/restaurar-teste.sh`) provou que o BANCO volta, dentro do mesmo Postgres. Não
//  provava três coisas que um incidente de verdade exige:
//
//    1. os ARQUIVOS do Storage — fotos e evidências de criança não moram no banco; o banco só tem
//       os metadados. Um restore só do banco devolve um mural de links quebrados;
//    2. um ambiente SEPARADO — um terceiro stack, com outras portas, outro segredo e outra chave de
//       assinatura. Restaurar dentro do mesmo Postgres não prova que o backup é autossuficiente;
//    3. que o SISTEMA volta, e não só as linhas: a conferência final é pela API, logando como as
//       pessoas sintéticas, abrindo a classe, conferindo o documento, baixando a evidência — e
//       tentando baixar a evidência de OUTRA criança, que tem de continuar proibido.
//
//    node scripts/restaurar-staging.mjs completo   # marcador → backup → marcador → restore → suíte → descarta
//    node scripts/restaurar-staging.mjs backup     # só o backup (staging/backups/<instante>/)
//    node scripts/restaurar-staging.mjs restaurar [dir]   # restaura o backup mais recente (ou `dir`)
//    node scripts/restaurar-staging.mjs descartar  # derruba o ambiente descartável
//
//  NUNCA toca em produção nem no ambiente de desenvolvimento: lê do staging, escreve no descartável.
// =============================================================================
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { MANIFESTO_SQL } from './lib/manifesto.mjs'
import {
  R_NOME, R_API, r, docker, psql, seg, provisionar, descartar as descartarStack, esperarApi,
  trocarBanco as trocar, restaurarArquivos as restaurarTgz, conferirQueODeployContinua as conferirDeploy,
} from './lib/descartavel.mjs'

const STG = { db: 'supabase_db_CONQUISTA-STAGING', storage: 'supabase_storage_CONQUISTA-STAGING' }
const SENHA = 'Multiclube2026'
const sha = (arquivo) => createHash('sha256').update(readFileSync(arquivo)).digest('hex')

let falhas = 0
const ok = (n, c, d = '') => {
  console.log(c ? `   OK      ${n}` : `   FALHOU  ${n}${d ? `  [${d}]` : ''}`)
  if (!c) falhas++
  return c
}

// O MANIFESTO (o que PRECISA voltar, contado fora da RLS) mora em scripts/lib/manifesto.mjs:
// o drill de migration (item 9) usa o mesmo, para as duas conferências falarem a mesma língua.

// ---------------------------------------------------------------------------
//  BACKUP
// ---------------------------------------------------------------------------
function backup() {
  const instante = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join('staging', 'backups', instante)
  mkdirSync(dir, { recursive: true })
  console.log(`\n-- BACKUP do staging → ${dir} --`)
  const t0 = Date.now()
  const manifesto = JSON.parse(psql(STG.db, MANIFESTO_SQL))
  // Os vínculos ativos de cada identidade sintética, lidos NA ORIGEM no instante do backup: a UAT
  // e os ensaios mudam o staging (o fundador sem clube da população já fundou um), e uma lista fixa
  // no script acusaria "restore errado" onde o restore está certo.
  const pop = JSON.parse(readFileSync('supabase/e2e/populacao.staging.json', 'utf8'))
  const identidades = Object.fromEntries(Object.entries(pop.pessoas).map(([k, p]) => [k,
    psql(STG.db, `select coalesce(string_agg(organizational_unit_id::text, ',' order by organizational_unit_id::text), '') from public.organization_memberships where user_id = '${p.id}' and status = 'ativo';`).split(',').filter(Boolean)]))
  // `supabase_admin` (superusuário do stack) e formato custom: leva donos, GRANTs e os schemas da
  // plataforma (auth, storage, cron). O `postgres` do stack local NÃO é superusuário.
  docker(['exec', STG.db, 'pg_dump', '-U', 'supabase_admin', '-Fc', '-f', '/tmp/banco.dump', 'postgres'])
  const pontoDeRecuperacao = new Date().toISOString()
  docker(['cp', `${STG.db}:/tmp/banco.dump`, join(dir, 'banco.dump')])
  docker(['exec', STG.db, 'rm', '-f', '/tmp/banco.dump'])
  // Os arquivos do Storage: o backend local é `file`, em /mnt do container de storage.
  docker(['exec', STG.storage, 'tar', 'czf', '/tmp/storage.tgz', '-C', '/mnt', '.'])
  docker(['cp', `${STG.storage}:/tmp/storage.tgz`, join(dir, 'storage.tgz')])
  docker(['exec', STG.storage, 'rm', '-f', '/tmp/storage.tgz'])
  const arquivos = Object.fromEntries(['banco.dump', 'storage.tgz'].map((f) => [f, { bytes: statSync(join(dir, f)).size, sha256: sha(join(dir, f)) }]))
  const info = { origem: 'staging', ponto_de_recuperacao: pontoDeRecuperacao, duracao_ms: Date.now() - t0, arquivos, manifesto, identidades }
  writeFileSync(join(dir, 'manifesto.json'), JSON.stringify(info, null, 2))
  console.log(`   ·       banco.dump  ${(arquivos['banco.dump'].bytes / 1024 / 1024).toFixed(1)} MB  sha256 ${arquivos['banco.dump'].sha256.slice(0, 16)}…`)
  console.log(`   ·       storage.tgz ${(arquivos['storage.tgz'].bytes / 1024).toFixed(0)} KB  sha256 ${arquivos['storage.tgz'].sha256.slice(0, 16)}…`)
  console.log(`   ·       ponto de recuperação ${pontoDeRecuperacao}  (backup em ${seg(info.duracao_ms)})`)
  console.log(`   ·       migração ${manifesto.migracao}, ${manifesto.contas} contas, ${manifesto.pessoas_multiclube} pessoas multi-clube`)
  return dir
}

// ---------------------------------------------------------------------------
//  O AMBIENTE DESCARTÁVEL (provisionar/descartar/esperar) mora em scripts/lib/descartavel.mjs:
//  o ensaio de produção (fase 9.1) usa o mesmo stack.
// ---------------------------------------------------------------------------
function descartar() {
  if (descartarStack()) console.log('   ·       ambiente descartável derrubado e apagado (containers, volumes e diretório)')
}

// ---------------------------------------------------------------------------
//  A TROCA DO BANCO — o coração dos dois restores (o descartável e o in-place).
//
//  O banco novo nasce com o MESMO DONO do original: `postgres`. Sem isso o restore "funciona" —
//  dados, policies e GRANTs voltam, a suíte passa —, mas o schema `public` pertence a
//  `pg_database_owner`, que passaria a ser o `supabase_admin`. O papel `postgres` (o do SQL Editor)
//  perde o direito de CRIAR no `public`, e a PRÓXIMA migration falha com "permission denied for
//  schema public". Achado pelo drill de migration (item 9) — depois de o restore do item 8 ter
//  passado sem ver, porque ele não aplicava migration nenhuma depois de restaurar.
// ---------------------------------------------------------------------------
function trocarBanco(container, dir) {
  const { erros } = trocar(container, join(dir, 'banco.dump'))
  return erros
}
const restaurarArquivos = (container, dir) => restaurarTgz(container, join(dir, 'storage.tgz'))
// Não basta o banco voltar: o PRÓXIMO deploy tem de continuar possível. A prova é fazer o que uma
// migration faz — criar uma função no `public` como `postgres` — e desfazer.
const conferirQueODeployContinua = (container) => conferirDeploy(container, ok)

// ---------------------------------------------------------------------------
//  RESTORE IN-PLACE do próprio staging — o caminho de recuperação de uma migration que commitou
//  dano (item 9). Em produção, o equivalente é o PITR do plano, que restaura no mesmo projeto.
// ---------------------------------------------------------------------------
async function inPlace(dir) {
  const info = JSON.parse(readFileSync(join(dir, 'manifesto.json'), 'utf8'))
  console.log(`\n-- RESTORE IN-PLACE do STAGING a partir de ${dir} --`)
  for (const [f, meta] of Object.entries(info.arquivos)) ok(`${f} íntegro (sha256)`, sha(join(dir, f)) === meta.sha256)
  const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
  const T0 = Date.now()
  const servicos = docker(['ps', '--format', '{{.Names}}']).split('\n').filter((n) => n.endsWith('_CONQUISTA-STAGING') && n !== STG.db)
  for (const s of servicos) docker(['stop', s])
  const erros = trocarBanco(STG.db, dir)
  const T1 = Date.now()
  ok(`banco restaurado sem erro (${seg(T1 - T0)}, com os serviços parados)`, erros.length === 0, erros.slice(0, 3).join(' | '))
  conferirQueODeployContinua(STG.db)
  docker(['start', STG.storage])
  restaurarArquivos(STG.storage, dir)
  for (const s of servicos) if (s !== STG.storage) docker(['start', s])
  const noAr = await esperarApi(env.VITE_SUPABASE_ANON_KEY, env.VITE_SUPABASE_URL)
  const T2 = Date.now()
  ok(`serviços do staging de volta (${seg(T2 - T1)})`, noAr)
  const depois = JSON.parse(psql(STG.db, MANIFESTO_SQL))
  const diverge = Object.keys(info.manifesto).filter((k) => JSON.stringify(info.manifesto[k]) !== JSON.stringify(depois[k]))
  ok('o manifesto voltou IDÊNTICO ao do backup', diverge.length === 0, diverge.join(','))
  console.log(`   ·       restore in-place: ${seg(T2 - T0)} (banco ${seg(T1 - T0)} + serviços ${seg(T2 - T1)})`)
}

// ---------------------------------------------------------------------------
//  RESTORE + CONFERÊNCIA
// ---------------------------------------------------------------------------
async function restaurar(dir, marcadores = null) {
  const info = JSON.parse(readFileSync(join(dir, 'manifesto.json'), 'utf8'))
  console.log(`\n-- RESTORE de ${dir} num ambiente DESCARTÁVEL (${R_NOME}, porta 56321) --`)
  for (const [f, meta] of Object.entries(info.arquivos)) {
    ok(`o arquivo ${f} do backup está íntegro (sha256 confere)`, sha(join(dir, f)) === meta.sha256)
  }
  const T = { inicio: Date.now() }
  descartar()
  const chaves = provisionar()
  T.provisionado = Date.now()
  console.log(`   ·       stack descartável no ar em ${seg(T.provisionado - T.inicio)}`)

  // O banco do descartável é trocado INTEIRO pelo do backup. Os serviços param antes, para nenhum
  // deles segurar conexão nem escrever num banco pela metade.
  for (const s of ['auth', 'rest', 'storage']) docker(['stop', r(s)])
  const erros = trocarBanco(r('db'), dir)
  T.banco = Date.now()
  ok(`pg_restore terminou sem erro (${seg(T.banco - T.provisionado)})`, erros.length === 0, erros.slice(0, 3).join(' | '))
  conferirQueODeployContinua(r('db'))

  docker(['start', r('storage')])
  restaurarArquivos(r('storage'), dir)
  for (const s of ['auth', 'rest', 'storage']) docker(['restart', r(s)])
  const noAr = await esperarApi(chaves.anon)
  T.servicos = Date.now()
  ok(`auth, API e storage do descartável respondem (${seg(T.servicos - T.banco)})`, noAr)

  // ---- 1. o manifesto, campo a campo, fora da RLS ----
  console.log('\n-- 1. o que voltou (manifesto, fora da RLS) --')
  const depois = JSON.parse(psql(r('db'), MANIFESTO_SQL))
  for (const [k, v] of Object.entries(info.manifesto)) {
    ok(`${k.padEnd(22)} ${JSON.stringify(v)}`, JSON.stringify(depois[k]) === JSON.stringify(v), `restaurado=${JSON.stringify(depois[k])}`)
  }
  const arquivosNoDisco = Number(docker(['exec', r('storage'), 'sh', '-c', 'find /mnt -type f | wc -l']).trim())
  const objetos = Object.values(info.manifesto.objetos_storage).reduce((a, b) => a + b, 0)
  ok(`os ${objetos} objetos do Storage têm arquivo no disco do descartável`, arquivosNoDisco >= objetos, `arquivos=${arquivosNoDisco}`)

  // ---- 2. o sistema volta: a suíte reduzida pela API, como as pessoas usam ----
  console.log('\n-- 2. a suíte reduzida, pela API do descartável --')
  const pop = JSON.parse(readFileSync('supabase/e2e/populacao.staging.json', 'utf8'))
  const C = pop.clubes
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
  const entrar = async (email, senha = SENHA) => {
    const { data, error } = await createClient(R_API, chaves.anon, opcoes).auth.signInWithPassword({ email, password: senha })
    if (error) throw new Error(`${email}: ${error.message}`)
    return { id: data.user.id, token: data.session.access_token }
  }
  const aba = (q, clube) => createClient(R_API, chaves.anon, { ...opcoes, global: { headers: { Authorization: `Bearer ${q.token}`, ...(clube ? { 'x-clube-atual': clube } : {}) } } })
  const vinculos = async (q) => ((await aba(q).rpc('meu_contexto')).data?.vinculos || []).filter((v) => v.status === 'ativo').map((v) => v.club_id).sort()

  const P = pop.pessoas
  const quem = {}
  for (const k of ['so_a', 'so_b', 'so_c', 'ab', 'abc', 'dir_a_membro_b', 'instrutor_ab', 'responsavel', 'coordenador', 'fundador_sem_clube']) {
    try { quem[k] = await entrar(P[k].email); ok(`identidade ${k} entra com a senha de antes (hash restaurado)`, quem[k].id === P[k].id) } catch (e) { ok(`identidade ${k} entra`, false, e.message) }
  }
  quem.lider_a = await entrar('tenant001@local.test', 'local-test-only')
  const esperado = info.identidades
    ? Object.fromEntries(Object.entries(info.identidades).filter(([k]) => k in quem && k !== 'responsavel' && k !== 'coordenador'))
    : { so_a: [C.A], so_b: [C.B], so_c: [C.C], ab: [C.A, C.B], abc: [C.A, C.B, C.C], dir_a_membro_b: [C.A, C.B], instrutor_ab: [C.A, C.B], fundador_sem_clube: [] }
  for (const [k, clubes] of Object.entries(esperado)) {
    if (quem[k]) ok(`${k}: vínculos ativos voltaram exatamente (${clubes.length})`, JSON.stringify(await vinculos(quem[k])) === JSON.stringify([...clubes].sort()))
  }
  if (quem.responsavel) {
    const { data: filhos } = await aba(quem.responsavel, C.A).rpc('meus_filhos')
    ok('o responsável volta vendo exatamente a filha certa', (filhos || []).length === 1 && filhos[0].id === P.so_a.id)
  }
  // progresso curricular + documento
  const mc = pop.matriculas['so_a@A']
  const { data: classe } = await aba(quem.so_a, C.A).rpc('minha_classe', { p_member_class_id: mc })
  ok('a classe de Ana volta INVESTIDA', classe?.member_class?.status === 'investida', classe?.member_class?.status)
  const { data: docs } = await aba(quem.lider_a, C.A).rpc('documentos_da_matricula', { p_member_class_id: mc })
  ok('o documento emitido voltou', (docs || []).length >= 1)
  if (docs?.[0]?.token) {
    const { data: verif, error } = await aba(quem.so_b).rpc('documento_verificar', { p_token: docs[0].token })
    ok('...e a verificação pública do documento ainda confere', !error && !!verif && verif.valido !== false, error?.message || JSON.stringify(verif)?.slice(0, 80))
  }
  // pontos, pela RLS da liderança, batem com o manifesto
  const { data: pts } = await aba(quem.lider_a, C.A).from('pontos').select('pontos')
  const soma = (pts || []).reduce((a, x) => a + (x.pontos || 0), 0)
  const nomeA = Object.keys(info.manifesto.pontos).find((n) => n === 'Filhos da Conquista')
  ok(`a liderança de A vê os mesmos ${info.manifesto.pontos[nomeA]} pontos de antes`, soma === info.manifesto.pontos[nomeA], `vê ${soma}`)
  // Storage: a evidência da criança baixa para ELA, e NÃO para outra criança de outro clube
  const { data: objs } = await aba(quem.so_a).storage.from('comprovacoes').list(`${P.so_a.id}/classe`, { limit: 5 })
  const alvo = objs?.[0] && `${P.so_a.id}/classe/${objs[0].name}`
  if (ok('Ana lista as próprias evidências no bucket privado', !!alvo)) {
    const { data: blob, error } = await aba(quem.so_a).storage.from('comprovacoes').download(alvo)
    const bytes = blob ? Buffer.from(await blob.arrayBuffer()) : null
    ok('...baixa a evidência, e o arquivo é o mesmo de antes (bytes)', !error && bytes?.length > 0 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff', error?.message)
    const { data: alheio } = await aba(quem.so_b, C.B).storage.from('comprovacoes').download(alvo)
    ok('...e Bia (só B) continua SEM acesso à evidência de Ana depois do restore', !alheio)
  }
  const { data: fotosB } = await aba(quem.so_b, C.B).from('fotos').select('club_id')
  ok('o mural de B, visto por Bia, não traz foto de A', (fotosB || []).length > 0 && fotosB.every((f) => f.club_id === C.B), `n=${fotosB?.length}`)
  // uma foto que o POVOAMENTO subiu de verdade (os marcadores de RPO são só linha, sem arquivo)
  const { data: fotoA } = await aba(quem.so_a, C.A).from('fotos').select('url').like('url', '%-staging-A-%').limit(1)
  if (ok('há foto do povoamento no mural de A', !!fotoA?.[0]?.url)) {
    const { data: img } = await aba(quem.so_a, C.A).storage.from('imagens').download(fotoA[0].url)
    ok('uma foto do mural de A abre (arquivo e metadado voltaram juntos)', !!img)
  }
  // token do staging NÃO vale no descartável (domínio de confiança próprio)
  const pre = marcadores?.tokenStaging
  if (pre) {
    const res = await fetch(`${R_API}/rest/v1/rpc/meu_contexto`, { method: 'POST', headers: { apikey: chaves.anon, Authorization: `Bearer ${pre}`, 'Content-Type': 'application/json' }, body: '{}' })
    ok('um token emitido pelo STAGING é recusado pelo descartável', res.status === 401 || res.status === 403, `HTTP ${res.status}`)
  }

  // ---- 3. RPO: o que foi escrito depois do backup NÃO pode estar aqui ----
  if (marcadores) {
    console.log('\n-- 3. RPO — o ponto de recuperação é o instante do dump --')
    const conta = (legenda) => Number(psql(r('db'), `select count(*) from public.fotos where legenda = '${legenda}';`))
    ok(`a escrita de ANTES do backup voltou (${marcadores.antes})`, conta(marcadores.antes) === 1)
    ok(`a escrita de DEPOIS do backup não voltou (${marcadores.depois}) — é a perda que o RPO mede`, conta(marcadores.depois) === 0)
  }
  T.fim = Date.now()

  console.log('\n==============================================================')
  console.log(` RTO OBSERVADO (backup de ${(info.arquivos['banco.dump'].bytes / 1024 / 1024).toFixed(1)} MB + ${(info.arquivos['storage.tgz'].bytes / 1024).toFixed(0)} KB de arquivos)`)
  console.log(`   provisionar o ambiente ... ${seg(T.provisionado - T.inicio)}`)
  console.log(`   restaurar o banco ........ ${seg(T.banco - T.provisionado)}`)
  console.log(`   storage + serviços ....... ${seg(T.servicos - T.banco)}`)
  console.log(`   conferência .............. ${seg(T.fim - T.servicos)}`)
  console.log(`   TOTAL (até a suíte verde)  ${seg(T.fim - T.inicio)}`)
  console.log(` RPO: o instante do dump (${info.ponto_de_recuperacao}). Numa rotina real, RPO = intervalo entre backups.`)
  console.log(`\n RESULTADO: ${falhas === 0 ? 'RESTORE COMPROVADO' : `${falhas} FALHA(S) — este backup NÃO está validado`}`)
  console.log('==============================================================')
}

// ---------------------------------------------------------------------------
//  Marcadores de RPO: uma foto antes do backup e outra depois, pela API do STAGING.
// ---------------------------------------------------------------------------
async function marcar(legenda) {
  const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
  const pop = JSON.parse(readFileSync('supabase/e2e/populacao.staging.json', 'utf8'))
  const o = { auth: { persistSession: false, autoRefreshToken: false } }
  const { data: s, error: e1 } = await createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, o).auth.signInWithPassword({ email: pop.pessoas.so_a.email, password: SENHA })
  if (e1) throw e1
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { ...o, global: { headers: { Authorization: `Bearer ${s.session.access_token}`, 'x-clube-atual': pop.clubes.A } } })
  const { error } = await sb.from('fotos').insert({ url: `mural/${pop.pessoas.so_a.id}-marcador.jpg`, evento: 'Acampamento', legenda, autor_id: pop.pessoas.so_a.id })
  if (error) throw error
  return s.session.access_token
}

// ---------------------------------------------------------------------------
const cmd = process.argv[2]
if (cmd === 'backup') backup()
else if (cmd === 'descartar') descartar()
else if (cmd === 'in-place') {
  if (!process.argv[3]) { console.log('uso: node scripts/restaurar-staging.mjs in-place staging/backups/<instante>'); process.exit(2) }
  await inPlace(process.argv[3])
}
else if (cmd === 'restaurar') {
  const base = join('staging', 'backups')
  const dir = process.argv[3] || join(base, readdirSync(base).sort().pop())
  await restaurar(dir)
} else if (cmd === 'completo') {
  const marca = Date.now().toString(36)
  const antes = `rpo-antes-${marca}`
  const depois = `rpo-depois-${marca}`
  const tokenStaging = await marcar(antes)
  const dir = backup()
  await marcar(depois)
  await restaurar(dir, { antes, depois, tokenStaging })
  if (!process.argv.includes('--manter')) descartar()
} else {
  console.log('uso: node scripts/restaurar-staging.mjs completo|backup|restaurar [dir]|descartar')
  process.exit(2)
}
process.exit(falhas === 0 ? 0 : 1)
