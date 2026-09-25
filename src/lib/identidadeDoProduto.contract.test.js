import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import { MARCA_PRODUTO } from './marca.js'

// =============================================================================
//  O CONTRATO DE IDENTIDADE DO PRODUTO (fase 8.5, item 1).
//
//  A regra, em uma frase: **sem contexto de clube, a identidade é DesbravaClube.**
//
//  O nome de um clube só pode chegar à tela vindo do BANCO — da marca daquele clube, por
//  requisição, como a de qualquer outro. Nunca escrito no código, no HTML, no manifest, na
//  configuração do app nativo, no service worker ou numa imagem que o app embarca.
//
//  POR QUE ISTO PRECISA SER UM TESTE E NÃO UMA COMBINAÇÃO:
//
//  O projeto nasceu como o app de UM clube — "Filhos da Conquista", fundado em 1994 — e virou
//  produto. O nome dele foi saindo das telas ao longo de várias fases, mas ficou onde ninguém
//  costuma olhar. A fase 8.4 encontrou o `<title>` do index.html. Esta fase encontrou o resto, e o
//  resto era pior:
//
//    · `public/icon-192.png` e `public/icon-512.png` eram o BRASÃO do clube A, com o nome dele
//      desenhado na imagem. Esses arquivos são o favicon, os ícones do PWA, o ícone do app Android
//      e — o mais grave — o `icon` e o `badge` de TODA notificação push de TODO clube;
//    · `MARCA_LEGADA`, o fallback de marca do front, era a marca do clube A: era o que aparecia na
//      tela de entrada, no primeiro quadro do app e em qualquer estado sem clube;
//    · a marca do Tenant 001 no banco apontava `logo_url` para `/icon-192.png` — ou seja, a
//      identidade do produto e a de um cliente eram literalmente o mesmo arquivo.
//
//  Nada disso aparece em teste de banco, em revisão de PR ou em jornada de navegador de quem já
//  conhece o produto: o olho passa por cima de um logo familiar. Aparece aqui.
//
//  O QUE ESTE ARQUIVO VARRE: o que é ENTREGUE a um aparelho (HTML, código do app, service worker,
//  manifest, configuração nativa, assets) e a configuração de build que os gera. Não varre
//  documentação nem SQL histórico: README e PLANEJAMENTO contam a história do produto, e os
//  arquivos `supabase/2026-*.sql` são o registro do que já foi rodado — reescrever o passado não
//  torna ninguém mais seguro.
// =============================================================================

const RAIZ = process.cwd()
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8')

// O nome do primeiro cliente e as marcas d'água dele. Se qualquer um voltar a uma superfície
// global, este arquivo falha e diz exatamente onde.
const NOME_DE_TENANT = /Filhos da Conquista|filhos-da-conquista|filhosdaconquista|FilhosDaConquista|Desbravadores · 1994|Desde 1994/

// ---------------------------------------------------------------------------
//  A varredura
// ---------------------------------------------------------------------------
const IGNORAR_PASTA = new Set(['node_modules', 'dist', '.git', 'android', 'ios', '.vite', 'coverage'])
const EXTENSOES_DE_TEXTO = /\.(js|jsx|ts|tsx|html|json|css|svg|webmanifest)$/

function varrer(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR_PASTA.has(nome)) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) varrer(caminho, acc)
    else acc.push(caminho)
  }
  return acc
}

// O que ESTE contrato considera superfície global: o app (src/), o que vai para o aparelho
// (public/, index.html) e a configuração que os gera.
const SUPERFICIES = [
  ...varrer(join(RAIZ, 'src')),
  ...varrer(join(RAIZ, 'public')),
  join(RAIZ, 'index.html'),
  join(RAIZ, 'vite.config.js'),
  join(RAIZ, 'vite-plugin-csp.js'),
  join(RAIZ, 'capacitor.config.json'),
  join(RAIZ, 'vercel.json'),
]
  .filter((f) => existsSync(f) && EXTENSOES_DE_TEXTO.test(f))
  .map((f) => ({ arquivo: relative(RAIZ, f).split(sep).join('/'), texto: readFileSync(f, 'utf8') }))

// Fixture/teste é a exceção que a fase autoriza — mas SÓ quando está explicitamente identificado
// como tal pelo nome do arquivo. Um "mock" escondido dentro de código de produção não vale.
const ehTeste = (a) => /\.test\.(js|jsx|ts|tsx)$/.test(a) || a.includes('/__tests__/')

// A ÚNICA isenção, e ela é nomeada, justificada e verificada por um teste próprio abaixo.
//
// `app.filhosdaconquista` é o APPLICATION ID do app Android. Não é texto que alguém lê: é a chave
// de identidade da instalação. Trocá-lo publica um aplicativo DIFERENTE na Play Store, deixa quem
// já instalou sem caminho de atualização, e invalida no Firebase todos os tokens de push já
// registrados nos aparelhos — o projeto do Firebase é casado com o package name
// (android/app/google-services.json).
//
// É dívida de identidade reconhecida, com custo real e data para pagar (uma migração de app id só
// faz sentido junto de uma publicação nova). Fica isolada aqui para que ninguém a confunda com as
// outras ocorrências — que eram só descuido — e para que um teste continue exigindo que ela seja
// exatamente esta, e não cresça.
const ISENCOES = [
  { arquivo: 'capacitor.config.json', trecho: 'app.filhosdaconquista' },
]
const semIsencoes = (arquivo, texto) =>
  ISENCOES.filter((i) => i.arquivo === arquivo).reduce((t, i) => t.split(i.trecho).join('<APPID-ISENTO>'), texto)

describe('nenhum nome de clube em superfície global', () => {
  it('a varredura enxerga o projeto (nunca passa no vazio)', () => {
    expect(SUPERFICIES.length).toBeGreaterThan(100)
    for (const obrigatorio of ['index.html', 'public/push-sw.js', 'vite.config.js', 'src/lib/marca.js']) {
      expect(SUPERFICIES.map((s) => s.arquivo), obrigatorio).toContain(obrigatorio)
    }
  })

  it('nenhum arquivo de PRODUÇÃO cita o nome de um tenant', () => {
    const achados = SUPERFICIES
      .filter((s) => !ehTeste(s.arquivo))
      .map((s) => ({ ...s, texto: semIsencoes(s.arquivo, s.texto) }))
      .filter((s) => NOME_DE_TENANT.test(s.texto))
      .map((s) => `${s.arquivo}: ${(s.texto.match(NOME_DE_TENANT) || [])[0]}`)
    expect(achados).toEqual([])
  })

  // A varredura pega COMENTÁRIO também, e isso é de propósito. Quem procura "de onde vem esse nome
  // no meu app?" usa grep, não um analisador de sintaxe — e um comentário explicando que o nome
  // saiu dali é, para o grep, indistinguível do nome ainda estar ali. O jeito de contar a história
  // sem plantar a agulha é descrever ("o primeiro clube", "o Tenant 001") em vez de soletrar.
  it('as isenções são exatamente as declaradas — nenhuma a mais', () => {
    for (const i of ISENCOES) {
      const alvo = SUPERFICIES.find((s) => s.arquivo === i.arquivo)
      expect(alvo, `${i.arquivo} não está na varredura`).toBeTruthy()
      expect(alvo.texto, `a isenção de ${i.arquivo} virou letra morta`).toContain(i.trecho)
    }
    expect(ISENCOES).toHaveLength(1)
  })

  it('e os testes que citam o tenant são poucos e nomeados (fixture é exceção, não regra)', () => {
    const comTenant = SUPERFICIES.filter((s) => ehTeste(s.arquivo) && NOME_DE_TENANT.test(s.texto)).map((s) => s.arquivo)
    // Não é uma lista fechada por preguiça: é para que acrescentar um fixture novo com o nome do
    // Tenant 001 seja uma decisão consciente, e não algo que acontece sozinho.
    for (const a of comTenant) expect(ehTeste(a), a).toBe(true)
    expect(comTenant.length, `fixtures citando o tenant: ${comTenant.join(', ')}`).toBeLessThanOrEqual(8)
  })
})

describe('a identidade sem clube é a do produto', () => {
  it('o <title> do HTML — o que aparece antes de o app montar', () => {
    expect(ler('index.html')).toMatch(/<title>DesbravaClube<\/title>/)
  })

  it('o manifest do PWA (nome na tela inicial do celular)', () => {
    const v = ler('vite.config.js')
    expect(v).toMatch(/name:\s*'DesbravaClube'/)
    expect(v).toMatch(/short_name:\s*'DesbravaClube'/)
  })

  it('o app nativo (Capacitor e Android)', () => {
    expect(JSON.parse(ler('capacitor.config.json')).appName).toBe('DesbravaClube')
    const strings = ler('android/app/src/main/res/values/strings.xml')
    expect(strings).toMatch(/<string name="app_name">DesbravaClube<\/string>/)
    expect(strings).toMatch(/<string name="title_activity_main">DesbravaClube<\/string>/)
    // O appId NÃO entra aqui de propósito: `app.filhosdaconquista` é a identidade de INSTALAÇÃO do
    // aplicativo na Play Store e no Firebase. Trocá-lo publica um app novo, deixa quem já instalou
    // sem atualização e invalida os tokens de push registrados. É dívida conhecida e documentada,
    // não algo que um teste deva forçar a pagar hoje.
    expect(strings).toMatch(/<string name="package_name">app\.filhosdaconquista<\/string>/)
  })

  it('a marca de fallback do front (tela de entrada, primeiro quadro, "escolha um clube")', () => {
    expect(MARCA_PRODUTO.nome).toBe('DesbravaClube')
    expect(NOME_DE_TENANT.test(JSON.stringify(MARCA_PRODUTO))).toBe(false)
  })
})

describe('os assets embarcados são do produto, não de um clube', () => {
  // A checagem é por BYTES. O brasão do clube A continua no repositório — ele é o logo do Tenant
  // 001 e tem de continuar funcionando — mas num caminho que diz de quem é. Se alguém copiar aquele
  // arquivo de volta por cima do ícone do produto (foi assim que ele chegou lá), isto falha.
  const bytes = (rel) => readFileSync(join(RAIZ, rel))

  it('o brasão do Tenant 001 existe, no caminho DELE', () => {
    expect(existsSync(join(RAIZ, 'public/clubes/tenant-001.png'))).toBe(true)
  })

  it('e não é nenhum dos ícones globais do app', () => {
    const doClube = bytes('public/clubes/tenant-001.png')
    for (const global of ['public/icon-192.png', 'public/icon-512.png', 'public/logo.png', 'assets/logo.png']) {
      expect(bytes(global).equals(doClube), `${global} é o brasão do Tenant 001`).toBe(false)
    }
  })

  it('a notificação push usa o ícone do produto (ela chega para TODO clube)', () => {
    const sw = ler('public/push-sw.js')
    expect(sw).toMatch(/icon:\s*'\/icon-192\.png'/)
    expect(sw).toMatch(/badge:\s*'\/icon-192\.png'/)
    expect(NOME_DE_TENANT.test(sw)).toBe(false)
  })

  it('o original do emblema do produto fica versionado (fora do caminho servido), para regerar os ícones sem perda', () => {
    const original = join(RAIZ, 'assets/logo-desbravaclube-original.png')
    expect(existsSync(original)).toBe(true)
    expect(bytes('assets/logo-desbravaclube-original.png').equals(bytes('public/clubes/tenant-001.png'))).toBe(false)
  })
  it('a bússola provisória não é mais publicada', () => {
    expect(existsSync(join(RAIZ, 'public/marca-produto.svg'))).toBe(false)
  })
})
