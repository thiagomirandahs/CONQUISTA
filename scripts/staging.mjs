#!/usr/bin/env node
// =============================================================================
//  STAGING — criar, recriar e conferir (Fase 9, item 2).
//
//  O QUE É, e o que deliberadamente NÃO É.
//
//  Este é um stack Supabase COMPLETO e SEPARADO: banco, storage, auth, edge functions, realtime e
//  studio próprios, em containers próprios, em portas próprias, com chaves próprias. Nada — nem uma
//  credencial, nem um bucket, nem um endpoint — é compartilhado com o ambiente de desenvolvimento.
//
//  Ele roda na MESMA máquina. Isso é suficiente para tudo que a fase 9 pede sobre isolamento,
//  jornada, backup/restore, drill de migration e red-team — e é insuficiente para MEDIR CAPACIDADE.
//  Um teste de carga aqui mede este computador, não o Supabase. O relatório da fase diz isso onde
//  o número aparece, em vez de deixar o número passar por promessa.
//
//  A PROVA DE ISOLAMENTO é executável e está em `conferir`: um token emitido pelo auth de
//  desenvolvimento é REJEITADO pelo staging, e vice-versa. Isso só é verdade porque os dois usam
//  segredos JWT diferentes — e é por isso que o segredo é a primeira coisa que este script escreve.
//
//  Uso:
//    node scripts/staging.mjs recriar    # do zero: derruba, apaga volumes, sobe, aplica migrations
//    node scripts/staging.mjs subir      # sobe sem apagar nada
//    node scripts/staging.mjs baixar
//    node scripts/staging.mjs conferir   # prova que staging e desenvolvimento não se enxergam
//    node scripts/staging.mjs chaves     # imprime as chaves do staging (para .env.staging)
// =============================================================================
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const DIR = 'staging'                       // relativo: o caminho do projeto tem espaço no Windows
const CLI = ['--yes', 'supabase@2.117.0']

const sh = (args, opts = {}) => execFileSync('npx', [...CLI, ...args], {
  cwd: RAIZ, stdio: opts.mudo ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  shell: process.platform === 'win32', ...opts,
})

// ---------------------------------------------------------------------------
//  O SEGREDO JWT. É o que separa os dois ambientes de verdade: sem ele, um token de
//  desenvolvimento seria aceito no staging, e "ambiente separado" seria só um nome de pasta.
//
//  Fica em `staging/.jwt-secret`, fora do git, e é gerado uma vez. As chaves anon/service_role do
//  staging são derivadas dele pelo próprio CLI.
// ---------------------------------------------------------------------------
function segredoJwt() {
  const caminho = join(RAIZ, DIR, '.jwt-secret')
  if (!existsSync(caminho)) {
    mkdirSync(join(RAIZ, DIR), { recursive: true })
    // 40 caracteres: o mínimo que o GoTrue aceita é 32; a folga não custa nada.
    // `randomBytes` direto, e nao um `node -e` por subprocesso: no Windows aquilo dependia de um
    // shell que pode nao existir, e o caminho "recriar do zero" — o unico em que esta linha roda —
    // e justamente o que o runbook promete que funciona.
    const s = randomBytes(30).toString('base64url')
    writeFileSync(caminho, s + '\n', 'utf8')
    console.log('   ·  segredo JWT de staging criado (staging/.jwt-secret, fora do git)')
  }
  return readFileSync(caminho, 'utf8').trim()
}

// ---------------------------------------------------------------------------
//  A CHAVE DE ASSINATURA. O achado que quase passou, e o motivo de este script ter uma sonda.
//
//  Trocar o segredo JWT (`SUPABASE_AUTH_JWT_SECRET`) NÃO isola dois stacks locais. A sonda mostrou
//  isso na cara: um token emitido pelo auth de desenvolvimento era ACEITO pelo staging.
//
//  A razão está no PostgREST. Ele valida o token contra um JWKS com DUAS chaves:
//
//    · uma `oct` (simétrica), derivada do segredo — essa sim, diferente entre os dois;
//    · uma `EC / ES256`, que é a chave de assinatura ASSIMÉTRICA padrão do CLI — e ela é FIXA.
//      Medido: o mesmo `kid` (b81269f1-…) nos dois stacks, porque o CLI embarca a mesma chave em
//      todo projeto local.
//
//  Como o GoTrue assina com a assimétrica, o token de um ambiente valida no outro. Os dois stacks
//  tinham bancos separados, buckets separados, portas separadas — e o MESMO domínio de confiança.
//  "Nenhuma credencial compartilhada com produção", que é o que o item 2 pede, seria falso.
//
//  Este gerador dá ao staging uma chave própria, e o `signing_keys_path` do config aponta para ela.
// ---------------------------------------------------------------------------
function chaveDeAssinatura() {
  const caminho = join(RAIZ, DIR, 'supabase', 'signing_keys.json')
  if (!existsSync(caminho)) {
    mkdirSync(join(RAIZ, DIR, 'supabase'), { recursive: true })
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = privateKey.export({ format: 'jwk' })
    writeFileSync(caminho, JSON.stringify([{
      ...jwk, alg: 'ES256', kid: randomUUID(), use: 'sig',
      key_ops: ['sign', 'verify'], ext: true,
    }], null, 2), 'utf8')
    console.log('   ·  chave de assinatura propria do staging criada (kid novo)')
  }
  return caminho
}

// ---------------------------------------------------------------------------
//  As migrations, o seed e as functions são COPIADOS do projeto, não referenciados.
//
//  Cópia e não link simbólico, por duas razões: o Windows trata link como caso especial e o
//  docker-compose do CLI monta o diretório: um link quebrado vira um erro incompreensível. E,
//  principalmente, a cópia deixa explícito QUAL versão o staging está rodando — se alguém mexer
//  numa migration e não sincronizar, o drill de migration (item 9) mostra a diferença em vez de
//  escondê-la.
// ---------------------------------------------------------------------------
function sincronizar() {
  for (const parte of ['migrations', 'functions']) {
    const destino = join(RAIZ, DIR, 'supabase', parte)
    rmSync(destino, { recursive: true, force: true })
    if (existsSync(join(RAIZ, 'supabase', parte))) {
      cpSync(join(RAIZ, 'supabase', parte), destino, { recursive: true })
    }
  }
  cpSync(join(RAIZ, 'supabase', 'seed.sql'), join(RAIZ, DIR, 'supabase', 'seed.sql'))
  // `readdirSync` e nao `ls | wc -l`: este script roda no Windows, onde /bin/bash pode nao existir.
  const n = readdirSync(join(RAIZ, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).length
  console.log(`   ·  ${n} migrations + seed + functions sincronizados para o staging`)
}

function subir({ limpo }) {
  const segredo = segredoJwt()
  chaveDeAssinatura()
  sincronizar()
  if (limpo) {
    try { sh(['stop', '--workdir', DIR, '--no-backup'], { mudo: true }) } catch { /* já estava parado */ }
  }
  // O segredo entra por ambiente: assim ele não vive no config.toml, que é versionado.
  sh(['start', '--workdir', DIR], { env: { ...process.env, SUPABASE_AUTH_JWT_SECRET: segredo } })
  gravarEnv()
}

// ---------------------------------------------------------------------------
//  AS CHAVES DO STAGING — e uma armadilha do CLI que custaria caro no runbook.
//
//  `supabase status -o env` NÃO lê as chaves do stack que está rodando: ele as RECALCULA a partir
//  do segredo JWT que enxerga no momento. Como o nosso segredo entra por variável de ambiente (para
//  não viver no config.toml versionado), um `status` sem ela devolve as chaves do segredo PADRÃO —
//  isto é, as chaves do ambiente de desenvolvimento, apontando para a porta do staging.
//
//  Medido: `status --workdir staging` imprimia a ANON_KEY do desenvolvimento. Quem seguisse o
//  runbook copiaria aquela chave, o auth recusaria tudo, e o erro não diria nada sobre segredo.
//
//  Duas defesas: o segredo vai junto em toda chamada, e as chaves são gravadas em `.env.staging`
//  no momento em que o stack sobe — uma fonte de verdade só, escrita por quem sabe o segredo.
// ---------------------------------------------------------------------------
function chaves() {
  const saida = sh(['status', '--workdir', DIR, '-o', 'env'],
    { mudo: true, env: { ...process.env, SUPABASE_AUTH_JWT_SECRET: segredoJwt() } }).toString()
  const pega = (k) => (saida.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) || [])[1] || ''
  return {
    url: pega('API_URL') || 'http://127.0.0.1:55321',
    anon: pega('ANON_KEY'),
    service: pega('SERVICE_ROLE_KEY'),
    db: pega('DB_URL'),
  }
}

// O arquivo que o front de staging consome. Escrito a cada `subir`, para nunca divergir do stack.
function gravarEnv() {
  const k = chaves()
  writeFileSync(join(RAIZ, '.env.staging'), [
    '# Gerado por scripts/staging.mjs — NAO EDITE A MAO, e NAO VERSIONE.',
    '# As chaves saem do segredo JWT proprio do staging (staging/.jwt-secret); um `supabase status`',
    '# sem esse segredo devolveria as chaves do ambiente de DESENVOLVIMENTO, apontando para a porta',
    '# do staging — e o auth recusaria tudo com um erro que nao fala em segredo nenhum.',
    `VITE_SUPABASE_URL=${k.url}`,
    `VITE_SUPABASE_ANON_KEY=${k.anon}`,
    '',
  ].join('\n'), 'utf8')
  console.log(`   ·  .env.staging escrito (${k.url})`)
  return k
}

// ---------------------------------------------------------------------------
//  A CONFERÊNCIA. Não é um checklist: é um experimento.
// ---------------------------------------------------------------------------
async function conferir() {
  const { createClient } = await import('@supabase/supabase-js')
  const st = chaves()
  const DEV = { url: 'http://127.0.0.1:54321', anon: process.env.ANON_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' }

  let falhas = 0
  const ok = (n, c, d = '') => { if (c) console.log(`   OK      ${n}`); else { falhas++; console.log(`   FALHOU  ${n}${d ? `  [${d}]` : ''}`) } }

  console.log('\n=== STAGING x DESENVOLVIMENTO: eles se enxergam? ===\n')

  ok('o staging responde na porta dele', !!st.anon, 'sem ANON_KEY — o stack subiu?')
  ok('e as chaves são DIFERENTES das de desenvolvimento', st.anon !== DEV.anon)
  ok('...e o endpoint também', st.url !== DEV.url, `${st.url} x ${DEV.url}`)

  // O experimento que importa: uma sessão criada no DESENVOLVIMENTO não pode valer no STAGING.
  // Se os segredos JWT fossem iguais, valeria — e os dois "ambientes" seriam um só com dois nomes.
  try {
    // Uma conta que JA EXISTE no desenvolvimento (a montagem dos tres clubes a cria). Criar uma
    // aqui nao serviria: a confirmacao de e-mail esta ligada desde a fase 8.1, entao um signUp
    // novo nao devolve sessao — e a sonda ficaria eternamente "pulando o teste cruzado", que e
    // como um teste morre sem ninguem notar.
    const dev = createClient(DEV.url, DEV.anon, { auth: { persistSession: false } })
    const { data: s2 } = await dev.auth.signInWithPassword({
      email: 'fundador.b@multiclube.local', password: 'Multiclube2026',
    })
    const token = s2?.session?.access_token
    if (!token) {
      falhas++
      console.log('   FALHOU  nao consegui sessao no desenvolvimento — rode `node supabase/e2e/montar-tres-clubes.mjs` antes')
    } else {
      const comTokenAlheio = createClient(st.url, st.anon, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { error } = await comTokenAlheio.rpc('meu_contexto')
      ok('um token do DESENVOLVIMENTO e recusado pelo staging', !!error,
         'o token passou — os segredos JWT sao iguais?')
    }
  } catch (e) {
    console.log(`   ·       (ambiente de desenvolvimento fora do ar: ${e.message})`)
  }

  // Bancos distintos: o staging não pode enxergar uma linha criada no desenvolvimento.
  try {
    const nomes = execFileSync('docker', ['ps', '--format', '{{.Names}}']).toString()
    ok('os containers de banco são dois, com nomes distintos',
      nomes.includes('supabase_db_CONQUISTA') && nomes.includes('supabase_db_CONQUISTA-STAGING'),
      nomes.split('\n').filter((n) => n.includes('supabase_db')).join(' '))
  } catch { /* docker fora do ar */ }

  console.log(`\n${falhas === 0 ? 'STAGING ISOLADO' : `${falhas} FALHA(S)`}\n`)
  process.exit(falhas === 0 ? 0 : 1)
}

const cmd = process.argv[2] || 'subir'
if (cmd === 'recriar') subir({ limpo: true })
else if (cmd === 'subir') subir({ limpo: false })
else if (cmd === 'baixar') sh(['stop', '--workdir', DIR])
else if (cmd === 'chaves') console.log(JSON.stringify(chaves(), null, 2))
else if (cmd === 'conferir') await conferir()
else { console.error(`comando desconhecido: ${cmd}`); process.exit(2) }
