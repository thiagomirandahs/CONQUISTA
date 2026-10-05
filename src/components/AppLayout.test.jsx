// Barra de destinos do celular (fase 8): rótulo + ícone, aria-current no destino ativo, alvo >= 44px,
// encaixe na área segura e no máximo 5 destinos.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

let clube
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { nome: 'Ana' }, sair: () => {} }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => ({ temEscopo: false }) }))
vi.mock('./Notificacoes.jsx', () => ({ default: () => null }))
vi.mock('./PreferenciasAcessibilidade.jsx', () => ({ default: () => null }))
vi.mock('./DevocionalPopup.jsx', () => ({ default: () => null }))
vi.mock('./AvisosPopup.jsx', () => ({ default: () => null }))
vi.mock('./AvisoTocado.jsx', () => ({ default: () => null }))
vi.mock('./ProximoEventoPopup.jsx', () => ({ default: () => null }))
const { default: AppLayout } = await import('./AppLayout.jsx')

const montar = (inicial, c) => {
  clube = { ehPais: false, temGestao: false, marca: { nome: 'Clube' }, clubeId: 'c1', temRecurso: () => true, ...c }
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <Routes><Route element={<AppLayout />}><Route path="*" element={<p>tela</p>} /></Route></Routes>
    </MemoryRouter>)
}

describe('AppLayout: barra de destinos', () => {
  it('tem no máximo 5 links, cada um com rótulo visível e alvo de 44px', () => {
    montar('/inicio', {})
    const barra = screen.getByRole('navigation', { name: 'Destinos' })
    const links = within(barra).getAllByRole('link')
    expect(links.length).toBeLessThanOrEqual(5)
    for (const l of links) {
      expect(l.textContent.replace(/\s/g, '').length).toBeGreaterThan(0)
      expect(l.className).toMatch(/min-h-\[52px\]/)
    }
  })

  it('só o destino da tela atual recebe aria-current="page"', () => {
    montar('/meu-clube', {})
    const links = within(screen.getByRole('navigation', { name: 'Destinos' })).getAllByRole('link')
    const ativos = links.filter((l) => l.getAttribute('aria-current') === 'page')
    expect(ativos).toHaveLength(1)
    expect(ativos[0]).toHaveAttribute('href', '/meu-clube')
  })

  it('respeita a área segura embaixo e dos lados (gestos/3 botões do Android)', () => {
    montar('/inicio', {})
    const barra = screen.getByRole('navigation', { name: 'Destinos' })
    expect(barra.style.bottom).toContain('--seguro-baixo')
    expect(barra.style.left).toContain('--seguro-esq')
    expect(barra.style.right).toContain('--seguro-dir')
  })

  it('recurso desligado: sem Jogos nem Jornada na barra, em vez de telas vazias', () => {
    montar('/inicio', { temRecurso: () => false })
    const hrefs = within(screen.getByRole('navigation', { name: 'Destinos' })).getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual(['/inicio', '/meu-clube', '/eu'])
  })

  it('responsável vê só Meus filhos e Eu', () => {
    montar('/meu-filho', { ehPais: true })
    const hrefs = within(screen.getByRole('navigation', { name: 'Destinos' })).getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(hrefs).toEqual(['/meu-filho', '/eu'])
  })
})
