// Fase 6 — safe-area em TODO o app (regra do dono, 29/09): o app ocupa só o espaço entre a barra de
// status e a navegação do celular; nada de valor fixo simulando a folga.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (p) => readFileSync(resolve(raiz, p), 'utf8')
const css = ler('index.css')

describe('safe-area (Fase 6)', () => {
  it('as quatro folgas existem e vêm de env()/Capacitor, nunca de número fixo', () => {
    for (const lado of ['topo', 'baixo', 'esq', 'dir']) {
      expect(css).toMatch(new RegExp(`--seguro-${lado}: max[(]env[(]safe-area-inset-`))
    }
  })
  it('todo overlay fixo de tela cheia respeita as barras (regra global, sem mexer em cada modal)', () => {
    expect(css).toMatch(/\.fixed\.inset-0\.items-end > \* \{ padding-bottom: max\(var\(--seguro-baixo\)/)
    expect(css).toMatch(/\.fixed\.inset-0:not\(\.items-end\) \{\s*padding-top: max\(0\.75rem, var\(--seguro-topo\)\)/)
  })
  it('o conteúdo rola acima do menu de baixo, somando a folga real do aparelho', () => {
    expect(ler('components/AppLayout.jsx')).toMatch(/pb-\[calc\(7rem\+var\(--seguro-baixo\)\)\]/)
    expect(ler('pages/rede/LayoutRede.jsx')).toMatch(/pb-\[calc\(6rem\+var\(--seguro-baixo\)\)\]/)
  })
  it('cabeçalhos fixos de todos os layouts começam abaixo da barra de status', () => {
    for (const f of ['components/AppLayout.jsx', 'components/LayoutConta.jsx', 'pages/Admin.jsx', 'pages/rede/LayoutRede.jsx', 'pages/Landing.jsx', 'components/Manutencao.jsx']) {
      expect(ler(f), f).toMatch(/var\(--seguro-topo\)/)
    }
  })
})
