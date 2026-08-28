import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Config SÓ pros testes (separada da vite.config.js, que carrega PWA/legacy e
// deixaria o teste lento). jsdom simula o navegador pra testar componentes.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,
  },
})
