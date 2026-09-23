// CSP por hash (fase 8.1). O que estes testes travam:
//   - a política sai completa, com default-src e script-src — que era o buraco da fase 8;
//   - NENHUM script inline fica de fora do hash (um que ficasse quebraria o app em produção,
//     e só em produção: no dev server a CSP não é gerada);
//   - o probe `data:` do @vitejs/plugin-legacy é desarmado SEM perder a detecção de navegador
//     moderno — é o que permite ter script-src sem jogar 3,5 MB de legado em todo mundo;
//   - nada de 'unsafe-inline'/'unsafe-eval'/data: em script-src.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
// o plugin mora na raiz (convenção do Vite); o teste mora aqui, junto com o outro
// contrato de build do projeto (pushEdgeContrato.test.js), porque é onde o vitest olha
import { cspComHashes } from '../../vite-plugin-csp.js'

const rodar = (html, opcoes) => cspComHashes(opcoes).transformIndexHtml.handler(html)
const politicaDe = (html) => (html.match(/content="([^"]*)"/) || [])[1] || ''
// Como o NAVEGADOR calcula: o parser de HTML normaliza CRLF para LF antes de expor o conteúdo
// do <script>. Hashear os bytes crus do arquivo dá outro valor.
const sha = (s) => `'sha256-${createHash('sha256').update(s.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`

describe('CSP: a política', () => {
  const saida = rodar('<html><head><title>x</title></head><body></body></html>', { conectaEm: ['https://ex.supabase.co'] })
  const p = politicaDe(saida)

  it('fecha o padrão (era o que faltava: sem default-src, tudo que não é citado fica livre)', () => {
    expect(p).toContain("default-src 'self'")
  })

  it('tem script-src — o buraco que a auditoria da fase 8 classificou como ALTO', () => {
    expect(p).toMatch(/script-src 'self'/)
  })

  it('não afrouxa script-src de jeito nenhum', () => {
    const scriptSrc = p.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval')
    expect(scriptSrc).not.toContain('data:')
    expect(scriptSrc).not.toContain('*')
  })

  it('a meta é o PRIMEIRO elemento do head (só governa o que vem depois dela)', () => {
    expect(saida).toMatch(/<head>\s*\n\s*<meta http-equiv="Content-Security-Policy"/)
    expect(saida.indexOf('Content-Security-Policy')).toBeLessThan(saida.indexOf('<title>'))
  })

  it('não tenta colocar em meta o que o navegador só aceita em header', () => {
    for (const d of cspComHashes()._soEmHeader) expect(p).not.toContain(d)
  })

  it('o Supabase entra em connect-src nas duas formas (https para REST, wss para realtime)', () => {
    expect(p).toContain('https://ex.supabase.co')
    expect(p).toContain('wss://ex.supabase.co')
  })

  // A origem passou a vir do VITE_SUPABASE_URL (8.4), então ela pode ser http — o stack local é.
  // O conversor antigo fazia um replace global de `https:` por `wss:` e deixava uma origem http
  // SEM o par de websocket: o realtime ficava bloqueado e nada no build dizia isso.
  it('uma origem http ganha o par ws, não fica sem websocket nenhum', () => {
    const local = politicaDe(rodar('<html><head></head></html>', { conectaEm: ['http://127.0.0.1:54321'] }))
    expect(local).toContain('http://127.0.0.1:54321')
    expect(local).toContain('ws://127.0.0.1:54321')
    expect(local).not.toContain('wss://127.0.0.1')
  })

  it('a política cita a origem que lhe passaram, e não um curinga que autorizaria qualquer projeto', () => {
    const proprio = politicaDe(rodar('<html><head></head></html>', { conectaEm: ['https://abc123.supabase.co'] }))
    expect(proprio).toContain('https://abc123.supabase.co')
    expect(proprio).not.toContain('*.supabase.co')
  })
})

describe('CSP: hash de todo script inline', () => {
  it('um script inline vira hash; um com src fica por conta do self', () => {
    const html = `<html><head><script>var a=1</script><script src="/x.js"></script></head></html>`
    const p = politicaDe(rodar(html))
    expect(p).toContain(sha('var a=1'))
    // um único hash: o script com src não gera nenhum
    expect(p.match(/'sha256-/g)).toHaveLength(1)
  })

  it('script vazio não gera hash inútil', () => {
    const p = politicaDe(rodar('<html><head><script>  </script></head></html>'))
    expect(p).not.toContain('sha256-')
  })

  it('o hash é do conteúdo EXATO, quebras de linha inclusive', () => {
    const corpo = '\n  var t = 1;\n  if (t) { }\n'
    const p = politicaDe(rodar(`<html><head><script>${corpo}</script></head></html>`))
    expect(p).toContain(sha(corpo))
  })

  // Este caso custou uma ida ao navegador para ser descoberto. O index.html do projeto está
  // salvo com CRLF; o parser de HTML normaliza para LF antes de expor o conteúdo do <script>.
  // Hasheando os bytes crus, o hash NUNCA batia — e o script do tema (que aplica claro/escuro
  // antes de renderizar) era bloqueado em produção, dando um piscar de tema errado toda vez.
  // Nenhum teste de unidade pegava isso; o console do build servido pegou na primeira olhada.
  it('CRLF é normalizado para LF antes de hashear — como o navegador faz', () => {
    const comCrlf = '\r\n  var t = 1;\r\n'
    const p = politicaDe(rodar(`<html><head><script>${comCrlf}</script></head></html>`))
    // o hash publicado é o do texto JÁ normalizado
    expect(p).toContain(`'sha256-${createHash('sha256').update('\n  var t = 1;\n', 'utf8').digest('base64')}'`)
    // e NÃO o dos bytes crus
    expect(p).not.toContain(`'sha256-${createHash('sha256').update(comCrlf, 'utf8').digest('base64')}'`)
  })
})

describe('CSP: o probe data: do @vitejs/plugin-legacy', () => {
  // O detector real que o plugin-legacy injeta, verbatim.
  const detector = `<script type="module">import'data:text/javascript,if(!import.meta.resolve)throw Error("import.meta.resolve not supported")';import.meta.url;import("_").catch(()=>1);(async function*(){})().next();window.__vite_is_modern_browser=true</script>`
  const saida = rodar(`<html><head>${detector}</head></html>`)

  it('o import de data: some (com ele, script-src bloquearia e TODO navegador cairia no legado)', () => {
    expect(saida).not.toContain("import'data:")
    expect(saida).not.toContain('data:text/javascript')
  })

  it('a verificação que ele fazia continua ali, agora direta — mesmo efeito observável', () => {
    expect(saida).toContain('if(!import.meta.resolve)throw Error("import.meta.resolve not supported")')
  })

  it('o resto do detector fica intacto, na ordem', () => {
    const corpo = saida.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    expect(corpo).toMatch(/import\.meta\.url;.*import\("_"\)\.catch.*async function\*.*__vite_is_modern_browser=true/s)
  })

  it('e o detector transformado está autorizado por hash', () => {
    const corpo = saida.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    expect(politicaDe(saida)).toContain(sha(corpo))
  })
})

// Este é o teste que pega a regressão de verdade: roda contra o dist/ de um build real.
// Sem build, ele se declara pulado em vez de passar no vazio.
describe('CSP: o build real', () => {
  const caminho = join(process.cwd(), 'dist', 'index.html')
  const temBuild = existsSync(caminho)

  it.skipIf(!temBuild)('o dist/index.html tem a meta CSP', () => {
    expect(readFileSync(caminho, 'utf8')).toContain('http-equiv="Content-Security-Policy"')
  })

  it.skipIf(!temBuild)('TODO script inline do build está autorizado por hash', () => {
    const html = readFileSync(caminho, 'utf8')
    const p = politicaDe(html)
    const semHash = []
    for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      if (!m[1].trim()) continue
      if (!p.includes(sha(m[1]))) semHash.push(m[1].trim().slice(0, 60))
    }
    expect(semHash).toEqual([])
  })

  it.skipIf(!temBuild)('o build não contém mais nenhum import de data: no HTML', () => {
    expect(readFileSync(caminho, 'utf8')).not.toContain('data:text/javascript')
  })
})
