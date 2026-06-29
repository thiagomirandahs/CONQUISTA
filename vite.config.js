import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
    })
  ],
  server: {
    open: true, // abre o navegador automaticamente ao rodar "npm run dev"
  },
})
