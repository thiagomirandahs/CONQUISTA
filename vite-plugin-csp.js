// =============================================================================
//  Fase 8.1 — CSP de verdade para o Web/PWA E para o APK.
//
//  O problema que este plugin resolve:
//
//  A CSP do projeto não tinha `script-src` nem `default-src`. Isso não foi descuido: o
//  `@vitejs/plugin-legacy` injeta no index.html um detector de navegador moderno que começa com
//
//      import 'data:text/javascript,if(!import.meta.resolve)throw Error("...")'
//
//  Com `script-src` ativo e sem `data:` na lista, esse import é BLOQUEADO e lança. O detector
//  então nunca marca `window.__vite_is_modern_browser = true`, e TODO navegador moderno cai nos
//  bundles legados — ~3,5 MB de polyfill em vez do bundle moderno, num produto que é 100% celular.
//  Colocar `data:` em `script-src` resolveria e abriria um vetor de XSS clássico
//  (`<script src="data:text/javascript,...">`), então também não serve.
//
//  A saída: trocar aquele import por uma verificação DIRETA, com o mesmo efeito observável.
//
//      de:    import 'data:text/javascript,if(!import.meta.resolve)throw Error("...")'
//      para:  if(!import.meta.resolve)throw Error("import.meta.resolve not supported")
//
//  Se `import.meta.resolve` não existir, continua lançando e continua caindo no legado —
//  exatamente como antes. O que se perde é a exigência implícita de "o navegador precisa saber
//  importar data: URL", e navegador que tem `import.meta.resolve` e não importa data: não existe
//  na prática (as duas coisas chegaram na mesma safra). O teste em vite-plugin-csp.test.js trava
//  essa equivalência.
//
//  Com o detector limpo, todo script inline do index.html pode ser autorizado por HASH — que é a
//  forma correta num host estático, onde não há como gerar nonce por requisição.
//
//  Por que META e não só header: o APK (Capacitor) serve o index.html do próprio pacote, sem
//  servidor nenhum na frente. Header de Vercel não existe ali. A meta viaja junto com o HTML,
//  então a MESMA política vale para o navegador e para a WebView. As diretivas que só funcionam
//  em header (`frame-ancestors`) continuam no vercel.json, e as duas se somam.
// =============================================================================
import { createHash } from 'node:crypto'

// O hash tem de ser calculado sobre o texto COMO O NAVEGADOR O VÊ, não como está no arquivo.
// O parser de HTML normaliza CRLF (e CR solto) para LF antes de entregar o conteúdo do <script>.
// O index.html deste projeto está salvo com CRLF, então hashear os bytes crus produzia um valor
// que nunca batia: o script do tema — o que aplica claro/escuro ANTES de renderizar — era
// bloqueado em produção, e a pessoa via um piscar de tema errado a cada abertura.
// Isso não aparece em teste de unidade nenhum; apareceu abrindo o build no navegador.
const comoONavegadorVe = (texto) => texto.replace(/\r\n?/g, '\n')
const hashDe = (texto) =>
  `'sha256-${createHash('sha256').update(comoONavegadorVe(texto), 'utf8').digest('base64')}'`

// O import data: do plugin-legacy. Ele aparece em DOIS lugares, e os dois precisam ser tratados:
//   1. no index.html, no detector de navegador moderno (`__vite_is_modern_browser`);
//   2. dentro do chunk de entrada moderno, no `__vite_legacy_guard`.
// Só o primeiro é visível no HTML — o segundo só aparece quando o navegador executa o bundle, e
// foi encontrado exatamente assim: com a CSP ligada, olhando o console do build servido.
const IMPORT_DATA = /import\s*'data:text\/javascript,([^']*)'\s*;?/g

// `import 'data:text/javascript,<código>'` -> `<código>;`
// O código vem percent-encoded dentro da URL; decodifica e executa no lugar.
// Efeito observável idêntico: se lançar, o módulo moderno falha e o legado assume.
const semDataUrl = (texto) => texto.replace(IMPORT_DATA, (_, corpo) => decodeURIComponent(corpo) + ';')

// Diretivas que o navegador IGNORA quando vêm por <meta>. Ficam no vercel.json.
// (documentado aqui para ninguém tentar mover e achar que funcionou)
const SO_EM_HEADER = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']

export function cspComHashes({ conectaEm = [] } = {}) {
  return {
    name: 'conquista-csp',
    // O @vitejs/plugin-legacy injeta o guard por um plugin que ele mesmo acrescenta pelo hook
    // `config()` — ou seja, no fim do grupo normal. Sem `enforce: 'post'`, o nosso `renderChunk`
    // rodaria ANTES dele e não veria o `import 'data:...'` para limpar.
    enforce: 'post',

    // Lugar 2: o guard dentro do bundle. Sem isto, a CSP bloqueia o import no chunk de entrada
    // e o app não carrega — falha que só aparece no build servido, nunca no dev server.
    //
    // Tem de ser `renderChunk`, não `generateBundle`: o nome do arquivo (o hash no
    // `index-XXXX.js`) é calculado ENTRE os dois. Transformando depois, o conteúdo muda e o nome
    // não — e quem já tivesse a versão antiga daquela URL no cache do navegador continuaria com
    // ela para sempre. Foi exatamente o que aconteceu na primeira tentativa: o dist estava
    // corrigido no disco e o navegador seguia executando o código bloqueado.
    renderChunk(code) {
      if (!code.includes('data:text/javascript')) return null
      return { code: semDataUrl(code), map: null }
    },

    // Lugar 1: o HTML. 'post' para rodar depois de todos os plugins que injetam script
    // (react, pwa, legacy) e calcular o hash do que realmente vai ao ar.
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const limpo = semDataUrl(html)

        // 2. hash de cada script inline (os com src são cobertos por 'self')
        const hashes = new Set()
        for (const m of limpo.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
          if (!m[1].trim()) continue
          hashes.add(hashDe(m[1]))
        }
        // 3. estilos inline em <style> (o Tailwind sai em arquivo, mas plugins podem injetar)
        const hashesEstilo = new Set()
        for (const m of limpo.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
          if (!m[1].trim()) continue
          hashesEstilo.add(hashDe(m[1]))
        }

        const supabase = conectaEm.join(' ')
        const politica = [
          // tudo que não for explicitado abaixo cai aqui — é o que faltava
          `default-src 'self'`,
          // só o próprio domínio e os inlines que ESTE build produziu.
          // Sem 'unsafe-inline', sem 'unsafe-eval', sem data:.
          `script-src 'self' ${[...hashes].join(' ')}`.trim(),
          // 'unsafe-inline' aqui cobre o atributo style={{...}} do React, que é onipresente e
          // não pode ser hasheado. Estilo não executa código; o risco é exfiltração por seletor,
          // muito abaixo do de script.
          `style-src 'self' 'unsafe-inline' ${[...hashesEstilo].join(' ')}`.trim(),
          `img-src 'self' data: blob: ${supabase}`.trim(),
          `media-src 'self' blob: ${supabase}`.trim(),
          `font-src 'self' data:`,
          // O realtime usa websocket, então cada origem entra duas vezes: o esquema HTTP e o
          // esquema WS correspondente. `https→wss` e `http→ws`, um por um — o replace global de
          // antes só sabia converter https, e uma origem http (o stack local) entrava sem o par
          // de websocket, deixando o realtime bloqueado sem nenhum sinal no build.
          `connect-src 'self' ${supabase} ${conectaEm
            .map((o) => o.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'))
            .join(' ')}`.trim(),
          `worker-src 'self' blob:`,
          `manifest-src 'self'`,
          `object-src 'none'`,
          `base-uri 'self'`,
          `form-action 'self'`,
        ].join('; ')

        const meta = `<meta http-equiv="Content-Security-Policy" content="${politica}">`
        // Precisa ser o PRIMEIRO filho de <head>: uma meta CSP só governa o que vem depois dela.
        return limpo.replace(/<head[^>]*>/, (h) => `${h}\n    ${meta}`)
      },
    },
    // Exposto para o teste conferir que nada foi esquecido.
    _soEmHeader: SO_EM_HEADER,
  }
}
