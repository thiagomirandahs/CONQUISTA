import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import legacy from '@vitejs/plugin-legacy'

// Configuração do projeto: React + Tailwind + PWA (instalável no celular)
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
      },
      manifest: {
        name: 'Filhos da Conquista',
        short_name: 'Conquista',
        description: 'Clube de Desbravadores Filhos da Conquista — atividades, ranking e mural.',
        theme_color: '#1e3a8a',
        background_color: '#1e3a8a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    }),
    // Modo de compatibilidade: faz o app rodar em celulares/navegadores antigos
    legacy({
      targets: ['defaults', 'Android >= 6', 'Chrome >= 61', 'not dead'],
    }),
  ],
  build: {
    // Minifica com terser e tira console/debugger do bundle de produção
    minify: 'terser',
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
  },
  server: {
    open: true, // abre o navegador automaticamente ao rodar "npm run dev"
  },
})
