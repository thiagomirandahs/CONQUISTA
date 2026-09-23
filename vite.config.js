import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import legacy from '@vitejs/plugin-legacy'
import { cspComHashes } from './vite-plugin-csp.js'

// CAP_BUILD=1 → build pro app nativo (Capacitor/Android): SEM service worker
// (dentro da WebView o SW guardaria versão velha e daria tela em branco, o mesmo
// problema que já tivemos no PWA) e SEM o modo legado (a WebView do Android é
// moderna — corta ~centenas de KB de polyfill à toa).
const forCap = process.env.CAP_BUILD === '1'

// A quem a CSP autoriza o app a se conectar.
//
// Isto era `['https://*.supabase.co']` cravado aqui, e o AMBIENTE-DE-PRODUCAO.md registrava, como
// passo manual, "se um dia houver domínio próprio para a API, entra em cspComHashes". Passo manual
// numa política de segurança é dívida: quem esquecer não vê erro nenhum no build — vê o app
// quebrando em produção, ou, pior, uma política mais frouxa do que deveria.
//
// Agora sai do MESMO `VITE_SUPABASE_URL` que o app usa para falar com o banco. Três efeitos:
//   · a política passa a citar o host exato do projeto, em vez do curinga que autoriza QUALQUER
//     projeto Supabase do mundo — inclusive um que um atacante controle;
//   · um domínio próprio para a API passa a funcionar sem ninguém lembrar de nada;
//   · o stack local (http://127.0.0.1:54321) passa a ser alcançável em desenvolvimento, que é o
//     que revelou o problema: com o host cravado, nenhuma jornada de navegador contra o Supabase
//     local conseguia sequer fazer login.
// O curinga fica como último recurso, para um build sem env (o aviso do src/lib/supabase.js já cobre).
const apiDoSupabase = (() => {
  // `loadEnv` e não `process.env`: o Vite lê os .env para `import.meta.env` do app, mas o arquivo
  // de configuração roda antes disso e não enxerga nada por `process.env`. Sem esta linha a
  // política cairia sempre no curinga, em silêncio — que é como este tipo de coisa costuma
  // "funcionar" por meses.
  const bruto = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '').VITE_SUPABASE_URL
  if (!bruto) return ['https://*.supabase.co']
  try {
    const { origin } = new URL(bruto)
    return [origin]
  } catch {
    return ['https://*.supabase.co']
  }
})()

// Configuração do projeto: React + Tailwind + PWA (instalável no celular)
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    !forCap && VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Não faz precache dos bundles "legacy"/polyfills: celular moderno nunca
        // roda esse código, então não vale baixar/guardar (economiza dados).
        globIgnores: ['**/*-legacy*.js', '**/polyfills*.js'],
        // Carrega o handler de push (public/push-sw.js) dentro do service worker
        importScripts: ['/push-sw.js'],
        // Cache em tempo de execução: SÓ conteúdo público.
        //
        // SEGURANÇA (hardening 28/08): o cache genérico de /rest/v1/ foi
        // REMOVIDO. Aquelas respostas são AUTENTICADAS (variam por usuário) e o
        // cache do service worker é compartilhado por URL no aparelho — num
        // celular usado por duas contas, dados de um podiam "vazar" pro outro
        // offline. (O push-sw.js apaga o cache antigo 'dados-conquista' que já
        // existia nos aparelhos.)
        //
        // Se um dia quisermos "dados offline" de verdade: guardar por conta em
        // IndexedDB com a chave separada por auth.uid() e LIMPAR no logout —
        // nunca voltar a usar cache de service worker pra resposta autenticada.
        runtimeCaching: [
          {
            // Fotos/avatares do Storage PÚBLICO: guardar pra ver offline +
            // carregar rápido. Seguro porque o bucket é público (mesmo conteúdo
            // pra qualquer pessoa) e cada arquivo tem caminho único (imutável).
            urlPattern: /\/storage\/v1\/object\/public\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'imagens-conquista',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // O app instalado é o DesbravaClube (o produto), não o nome de um cliente: desde a fase 5 a
      // plataforma é multi-clube, e o manifest ainda levava o nome do Tenant 001. A marca do CLUBE
      // continua aparecendo dentro do app (nome, cores e logo vêm do servidor, por clube) — o que
      // não pode é o ícone da tela inicial de todo mundo levar o nome de um clube só.
      manifest: {
        name: 'DesbravaClube',
        short_name: 'DesbravaClube',
        description: 'O clube de Desbravadores na palma da mão: classes, especialidades, experiências e o dia a dia da unidade.',
        lang: 'pt-BR',
        theme_color: '#1e3a8a',
        background_color: '#1e3a8a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // `maskable` faz o Android recortar o ícone no formato do sistema sem cortar o desenho
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    }),
    // Modo de compatibilidade: faz o app rodar em celulares/navegadores antigos
    // (no web). No app nativo (forCap) não entra — a WebView já é moderna.
    !forCap && legacy({
      targets: ['defaults', 'Android >= 6', 'Chrome >= 61', 'not dead'],
    }),
    // CSP por HASH, embutida no próprio HTML (fase 8.1). Precisa ser o ÚLTIMO plugin:
    // ele calcula o hash dos scripts inline que os anteriores injetaram. Vale para os dois
    // builds — o do navegador e o do APK, que não tem servidor na frente para mandar header.
    cspComHashes({ conectaEm: apiDoSupabase }),
  ].filter(Boolean),
  build: {
    // Minifica com terser e tira console/debugger do bundle de produção
    minify: 'terser',
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
  },
  server: {
    open: true, // abre o navegador automaticamente ao rodar "npm run dev"
  },
})
