// =============================================================================
//  GATE DE AMBIENTE (fase 8.5, item 8).
//
//  A pergunta que este gate responde, e que nenhum teste unitário responde:
//
//      o bundle que eu acabei de gerar fala com o ambiente CERTO, e SÓ com ele?
//
//  Por que precisa ser um build de verdade: a configuração de ambiente atravessa três camadas que
//  só existem juntas no artefato final —
//
//    1. `import.meta.env.VITE_SUPABASE_URL`, que o Vite substitui DENTRO do JavaScript;
//    2. a CSP `connect-src`, que o vite-plugin-csp calcula do mesmo valor e escreve no HTML;
//    3. os headers do vercel.json, que desde a 8.5 não repetem mais nada da CSP.
//
//  Se as três divergirem, o app não quebra no teste nem no dev: quebra no celular de quem usa, com
//  um erro de CSP no console que ninguém está olhando. Foi exatamente assim que a fase 8.4
//  descobriu que a CSP tinha o host cravado — tentando fazer login contra o Supabase local.
//
//  O QUE ELE PROVA, em três builds:
//
//    · LOCAL/TESTE  aponta para o stack local e a CSP autoriza só ele;
//    · PRODUÇÃO     aponta para o projeto de produção e a CSP autoriza só ele;
//    · nenhum dos dois carrega o endpoint do outro — nem no JS, nem na política;
//    · PRODUÇÃO SEM ENV **falha o build**. É o fail-closed: sem endpoint, o bundle ou não funciona
//      ou sobe com uma política frouxa, e as duas saídas são piores do que parar aqui.
//
//  Uso:  node supabase/tests/e2e/build-por-ambiente.mjs
// =============================================================================
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
// RELATIVO de proposito: no Windows o caminho do projeto tem espaco, e com `shell: true` um
// --outDir absoluto nao citado e quebrado em dois argumentos pelo shell. O build falhava com um
// erro do Vite que nao dizia nada sobre o caminho.
const SAIDA_REL = '.tmp-build-ambiente'
const SAIDA = join(RAIZ, SAIDA_REL)

const LOCAL = 'http://127.0.0.1:54321'
const STAGING = 'http://127.0.0.1:55321'
const PRODUCAO = 'https://projeto-de-producao.supabase.co'

let falhas = 0
const ok = (n, c, d = '') => {
  if (c) console.log(`   OK      ${n}`)
  else { falhas++; console.log(`   FALHOU  ${n}${d ? `\n             ${d}` : ''}`) }
  return c
}

function construir(nome, env) {
  const destino = join(SAIDA, nome)
  rmSync(destino, { recursive: true, force: true })
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', `${SAIDA_REL}/${nome}`, '--emptyOutDir', '--mode', env.MODE || 'production'], {
      cwd: RAIZ,
      // `VITE_SUPABASE_URL: ''` (string vazia) é diferente de não passar: o loadEnv do Vite lê os
      // arquivos .env do disco, e a máquina de quem roda isto pode ter um .env.local. Passar vazio
      // explicitamente é o que garante que o caso "sem env" seja mesmo sem env.
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    return { destino, erro: null }
  } catch (e) {
    return { destino, erro: `${e.stdout || ''}${e.stderr || ''}` || e.message }
  }
}

// Tudo o que o navegador vai carregar: o HTML (onde mora a CSP) e todo o JavaScript.
function conteudoServido(destino) {
  const html = readFileSync(join(destino, 'index.html'), 'utf8')
  const dirAssets = join(destino, 'assets')
  const js = existsSync(dirAssets)
    ? readdirSync(dirAssets).filter((f) => f.endsWith('.js'))
        .map((f) => readFileSync(join(dirAssets, f), 'utf8')).join('\n')
    : ''
  return { html, js, tudo: `${html}\n${js}` }
}
const politicaDe = (html) => (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || ''

console.log('\n=== GATE DE AMBIENTE — o bundle fala com o ambiente certo? ===\n')

// ---------------------------------------------------------------------------
console.log('-- 1. build LOCAL/TESTE --')
{
  const { destino, erro } = construir('local', { VITE_SUPABASE_URL: LOCAL, VITE_SUPABASE_ANON_KEY: 'chave-local-de-teste' })
  if (!ok('o build local termina', !erro, erro?.slice(-500))) process.exit(1)
  const { tudo, html } = conteudoServido(destino)
  const csp = politicaDe(html)

  ok('a CSP autoriza o stack local', csp.includes(LOCAL), csp)
  ok('...inclusive o websocket (realtime), no esquema certo', csp.includes('ws://127.0.0.1:54321'))
  ok('o bundle aponta para o stack local', tudo.includes(LOCAL))
  // O CERNE: nada do outro ambiente atravessou.
  ok('e NADA do endpoint de produção entrou', !tudo.includes(PRODUCAO), `achou "${PRODUCAO}"`)
  ok('...nem o curinga que autorizava qualquer projeto Supabase do mundo', !csp.includes('*.supabase.co'), csp)
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. build de PRODUÇÃO --')
{
  const { destino, erro } = construir('producao', { VITE_SUPABASE_URL: PRODUCAO, VITE_SUPABASE_ANON_KEY: 'chave-de-producao' })
  if (!ok('o build de produção termina', !erro, erro?.slice(-500))) process.exit(1)
  const { tudo, html } = conteudoServido(destino)
  const csp = politicaDe(html)

  ok('a CSP autoriza o projeto de produção', csp.includes(PRODUCAO), csp)
  ok('...e o websocket dele em wss', csp.includes(`wss://${new URL(PRODUCAO).host}`))
  ok('o bundle aponta para produção', tudo.includes(PRODUCAO))
  ok('e NADA do stack local entrou', !tudo.includes(LOCAL), `achou "${LOCAL}"`)
  ok('...nem o curinga', !csp.includes('*.supabase.co'), csp)

  // A política de produção também precisa continuar sendo uma política, não só uma origem.
  for (const diretiva of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'"]) {
    ok(`a política mantém "${diretiva}"`, csp.includes(diretiva), csp)
  }
  ok('sem unsafe-inline/unsafe-eval em script-src', !/script-src[^;]*unsafe-(inline|eval)/.test(csp), csp)
  // `frame-ancestors` o navegador IGNORA em <meta>; ela vive no header do vercel.json, e é a única
  // parte da CSP que ainda mora lá — justamente para as duas políticas não se intersectarem.
  ok('frame-ancestors NÃO está na meta (o navegador ignora ali; ela é do header)', !csp.includes('frame-ancestors'))
  // Conferido no header JÁ PARSEADO, não no texto do arquivo: o vercel.json carrega um comentário
  // explicando por que a política encolheu, e esse comentário cita `connect-src`. Procurar no texto
  // acusaria a explicação como se fosse a política — que é o tipo de falso positivo que faz alguém
  // apagar o comentário para o teste passar, e a próxima pessoa repetir o erro por falta dele.
  const vercel = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'))
  const headerCsp = (vercel.headers || [])
    .flatMap((h) => h.headers || [])
    .filter((h) => h.key === 'Content-Security-Policy')
    .map((h) => h.value)
  ok('o header do vercel.json tem frame-ancestors', headerCsp.some((v) => v.includes("frame-ancestors 'none'")), JSON.stringify(headerCsp))
  ok('...e NÃO repete nenhuma diretiva que a meta já define (senão o navegador intersecta as duas)',
    headerCsp.every((v) => !/(connect|img|media|font|script|style|worker|manifest|object|default)-src|base-uri|form-action/.test(v)),
    JSON.stringify(headerCsp))
}

// ---------------------------------------------------------------------------
//  O STAGING entrou aqui na fase 9. Ele é um TERCEIRO ambiente, e a pergunta que importa não é
//  "ele funciona?" — é se o bundle de staging carrega, por descuido, o endpoint de desenvolvimento
//  (que é o vizinho de porta, 54321 x 55321) ou o de produção. Os três builds saem da mesma árvore,
//  e a única coisa que os distingue é uma variável.
console.log('\n-- 3. build de STAGING --')
{
  const { destino, erro } = construir('staging', { VITE_SUPABASE_URL: STAGING, VITE_SUPABASE_ANON_KEY: 'chave-de-staging' })
  if (!ok('o build de staging termina', !erro, erro?.slice(-500))) process.exit(1)
  const { tudo, html } = conteudoServido(destino)
  const csp = politicaDe(html)

  ok('a CSP autoriza o endpoint de staging', csp.includes(STAGING), csp)
  ok('o bundle aponta para staging', tudo.includes(STAGING))
  ok('e NADA do endpoint de desenvolvimento entrou', !tudo.includes(LOCAL), `achou "${LOCAL}"`)
  ok('...nem do de produção', !tudo.includes(PRODUCAO), `achou "${PRODUCAO}"`)
  ok('...nem o curinga', !csp.includes('*.supabase.co'), csp)
}

// ---------------------------------------------------------------------------
console.log('\n-- 4. FAIL-CLOSED: produção sem endpoint --')
{
  const { erro } = construir('sem-env', { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })
  ok('o build de produção SEM VITE_SUPABASE_URL falha', !!erro)
  ok('...e a mensagem diz o que fazer', !!erro && /VITE_SUPABASE_URL/.test(erro), (erro || '').slice(-300))
}

rmSync(SAIDA, { recursive: true, force: true })
console.log(`\n${falhas === 0 ? 'AMBIENTE OK' : `${falhas} FALHA(S)`}\n`)
process.exit(falhas === 0 ? 0 : 1)
