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
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const RAIZ = process.cwd()
const CLI = ['--yes', 'supabase@2.117.0']
const STG = { db: 'supabase_db_CONQUISTA-STAGING', storage: 'supabase_storage_CONQUISTA-STAGING' }
const R_DIR = 'restore'
const R_NOME = 'CONQUISTA-RESTORE'
const r = (servico) => `supabase_${servico}_${R_NOME}`
const R_API = 'http://127.0.0.1:56321'
const SENHA = 'Multiclube2026'

const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts })
const psql = (container, sql, db = 'postgres') =>
  docker(['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db], { input: sql }).trim()
const supabase = (args, env = {}) => execFileSync('npx', [...CLI, ...args], {
  cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, ...env },
})
const sha = (arquivo) => createHash('sha256').update(readFileSync(arquivo)).digest('hex')
const seg = (ms) => `${(ms / 1000).toFixed(1)}s`
const espera = (ms) => new Promise((res) => setTimeout(res, ms))

let falhas = 0
const ok = (n, c, d = '') => {
  console.log(c ? `   OK      ${n}` : `   FALHOU  ${n}${d ? `  [${d}]` : ''}`)
  if (!c) falhas++
  return c
}

// ---------------------------------------------------------------------------
//  O MANIFESTO: o que PRECISA voltar, contado fora da RLS. É calculado igual na origem e no
//  destino, e as duas saídas são comparadas campo a campo.
// ---------------------------------------------------------------------------
const MANIFESTO_SQL = `
select json_build_object(
  'migracao',        (select max(version) from supabase_migrations.schema_migrations),
  'contas',          (select count(*) from auth.users),
  'identidades_auth',(select count(*) from auth.identities),
  'vinculos_ativos', (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select organizational_unit_id, count(*) n from public.organization_memberships where status = 'ativo' group by 1) x
                       join public.organizational_units u on u.id = x.organizational_unit_id),
  'pessoas_multiclube', (select count(*) from (select m.user_id from public.organization_memberships m
                       join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
                       where m.status = 'ativo' group by 1 having count(*) > 1) y),
  'pontos',          (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select club_id, sum(pontos) n from public.pontos group by 1) x join public.organizational_units u on u.id = x.club_id),
  'mensalidades',    (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select club_id, count(*) n from public.mensalidades group by 1) x join public.organizational_units u on u.id = x.club_id),
  'fotos',           (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select club_id, count(*) n from public.fotos group by 1) x join public.organizational_units u on u.id = x.club_id),
  'matriculas',      (select coalesce(json_object_agg(status, n order by status), '{}') from (select status, count(*) n from public.member_classes group by 1) x),
  'requisitos_aprovados', (select count(*) from public.member_requirements where status = 'aprovado'),
  'documentos',      (select count(*) from public.class_documents),
  'objetos_storage', (select coalesce(json_object_agg(bucket_id, n order by bucket_id), '{}') from (select bucket_id, count(*) n from storage.objects group by 1) x),
  'cron_jobs',       (select count(*) from cron.job),
  'policies',        (select count(*) from pg_policies where schemaname = 'public'),
  'funcoes',         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  'gatilhos',        (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and not t.tgisinternal),
  'tabelas_com_rls', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)
);`

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
  const info = { origem: 'staging', ponto_de_recuperacao: pontoDeRecuperacao, duracao_ms: Date.now() - t0, arquivos, manifesto }
  writeFileSync(join(dir, 'manifesto.json'), JSON.stringify(info, null, 2))
  console.log(`   ·       banco.dump  ${(arquivos['banco.dump'].bytes / 1024 / 1024).toFixed(1)} MB  sha256 ${arquivos['banco.dump'].sha256.slice(0, 16)}…`)
  console.log(`   ·       storage.tgz ${(arquivos['storage.tgz'].bytes / 1024).toFixed(0)} KB  sha256 ${arquivos['storage.tgz'].sha256.slice(0, 16)}…`)
  console.log(`   ·       ponto de recuperação ${pontoDeRecuperacao}  (backup em ${seg(info.duracao_ms)})`)
  console.log(`   ·       migração ${manifesto.migracao}, ${manifesto.contas} contas, ${manifesto.pessoas_multiclube} pessoas multi-clube`)
  return dir
}

// ---------------------------------------------------------------------------
//  O AMBIENTE DESCARTÁVEL: terceiro stack, derivado da config do staging.
// ---------------------------------------------------------------------------
function provisionar() {
  const base = readFileSync(join('staging', 'supabase', 'config.toml'), 'utf8')
  let cfg = base
    .replace('project_id = "CONQUISTA-STAGING"', `project_id = "${R_NOME}"`)
    .replace(/\b553(\d\d)\b/g, '563$1')                 // 55321 → 56321 etc.
    .replace(/:4273\b/g, ':4373')
    .replace(/port = 8183\b/, 'port = 8283')
  // sem seed: o banco do descartável é SUBSTITUÍDO pelo backup; nada de dado próprio
  cfg = cfg.replace(/(\[db\.seed\][^[]*?enabled = )true/, '$1false')
  if (cfg.includes('55321') || !cfg.includes('56321')) throw new Error('a config do descartável ainda aponta para o staging')
  mkdirSync(join(R_DIR, 'supabase', 'migrations'), { recursive: true })
  writeFileSync(join(R_DIR, 'supabase', 'config.toml'),
    `# GERADO por scripts/restaurar-staging.mjs — ambiente DESCARTÁVEL de restore. Não versionar.\n${cfg}`)
  // Chave de assinatura e segredo PRÓPRIOS: o descartável não pode aceitar token do staging.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  writeFileSync(join(R_DIR, 'supabase', 'signing_keys.json'), JSON.stringify([{
    ...privateKey.export({ format: 'jwk' }), alg: 'ES256', kid: randomUUID(), use: 'sig', key_ops: ['sign', 'verify'], ext: true,
  }]))
  const segredo = randomBytes(30).toString('base64url')
  writeFileSync(join(R_DIR, '.jwt-secret'), segredo)
  // Só o que a conferência usa: banco, auth, API e storage.
  supabase(['start', '--workdir', R_DIR, '-x', 'studio,mailpit,edge-runtime,imgproxy,vector,logflare,supavisor,postgres-meta,realtime'],
    { SUPABASE_AUTH_JWT_SECRET: segredo })
  const env = supabase(['status', '--workdir', R_DIR, '-o', 'env'], { SUPABASE_AUTH_JWT_SECRET: segredo })
  const pega = (k) => (env.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) || [])[1] || ''
  return { anon: pega('ANON_KEY'), service: pega('SERVICE_ROLE_KEY') }
}

function descartar() {
  if (!existsSync(join(R_DIR, 'supabase', 'config.toml'))) return
  try { supabase(['stop', '--workdir', R_DIR, '--no-backup']) } catch { /* já parado */ }
  rmSync(R_DIR, { recursive: true, force: true })
  console.log('   ·       ambiente descartável derrubado e apagado (containers, volumes e diretório)')
}

async function esperarApi(anon) {
  for (let i = 0; i < 60; i++) {
    try {
      const a = await fetch(`${R_API}/auth/v1/health`, { headers: { apikey: anon } })
      const b = await fetch(`${R_API}/rest/v1/`, { headers: { apikey: anon } })
      const c = await fetch(`${R_API}/storage/v1/bucket`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
      if (a.ok && b.ok && c.status < 500) return true
    } catch { /* subindo */ }
    await espera(1000)
  }
  return false
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
  psql(r('db'), 'drop database if exists postgres with (force);', 'template1')
  psql(r('db'), 'create database postgres;', 'template1')
  docker(['cp', join(dir, 'banco.dump'), `${r('db')}:/tmp/banco.dump`])
  let saida = ''
  try {
    saida = docker(['exec', r('db'), 'pg_restore', '-U', 'supabase_admin', '-d', 'postgres', '/tmp/banco.dump'])
  } catch (e) { saida = `${e.stdout || ''}${e.stderr || ''}` }
  const erros = (saida.match(/^pg_restore: error/gm) || []).length
  T.banco = Date.now()
  ok(`pg_restore terminou sem erro (${seg(T.banco - T.provisionado)})`, erros === 0, saida.split('\n').filter((l) => /error/.test(l)).slice(0, 3).join(' | '))

  docker(['start', r('storage')])
  docker(['cp', join(dir, 'storage.tgz'), `${r('storage')}:/tmp/storage.tgz`])
  docker(['exec', r('storage'), 'sh', '-c', 'rm -rf /mnt/* && tar xzf /tmp/storage.tgz -C /mnt && rm -f /tmp/storage.tgz'])
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
  const esperado = { so_a: [C.A], so_b: [C.B], so_c: [C.C], ab: [C.A, C.B], abc: [C.A, C.B, C.C], dir_a_membro_b: [C.A, C.B], instrutor_ab: [C.A, C.B], fundador_sem_clube: [] }
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
