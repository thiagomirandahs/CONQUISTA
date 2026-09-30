// Contrato (fase 7): OTA e PWA nunca seguram a abertura do app.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const main = readFileSync('src/main.jsx', 'utf8')

describe('main.jsx não espera OTA/PWA/animação para desenhar a tela', () => {
  it('iniciarNativo() (OTA) é chamado SEM await', () => {
    expect(main).toMatch(/^iniciarNativo\(\)/m)
    expect(main).not.toMatch(/await\s+iniciarNativo/)
  })
  it('nenhum await de topo antes de renderizar', () => {
    expect(main).not.toMatch(/^\s*await\s/m)
  })
  it('service worker / registro PWA não é aguardado', () => {
    expect(main).not.toMatch(/await[^\n]*(registerSW|serviceWorker)/i)
  })
  it('marca o início do JS para o vigia da abertura', () => {
    expect(main).toMatch(/__cqIniciou\s*=\s*true/)
  })
})
