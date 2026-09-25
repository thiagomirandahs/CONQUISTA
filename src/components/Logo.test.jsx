// Identidade global × identidade do clube (decisão de 25/09): abertura, carregamento, login e
// cadastro são SEMPRE DesbravaClube; o brasão do clube só aparece dentro do clube (cabeçalho).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Clube.jsx', () => ({
  useClube: () => ({ marca: { nome: 'Clube Brasão', sigla: 'CB', logoUrl: '/clubes/tenant-001.png' } }),
}))
vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn() }, from: vi.fn(), storage: { from: vi.fn() } } }))
vi.mock('../lib/convite.js', () => ({ lerTokenConvite: () => null, limparConviteDaUrl: () => {} }))
const { default: Logo } = await import('./Logo.jsx')
const { default: Login } = await import('../pages/Login.jsx')
const { default: Cadastro } = await import('../pages/Cadastro.jsx')

const logos = (container) => [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))

describe('Logo: produto × clube', () => {
  it('superfície interna (padrão): o brasão do clube em uso', () => {
    const { container } = render(<Logo />)
    expect(logos(container)).toEqual(['/clubes/tenant-001.png'])
  })
  it('superfície global (produto): sempre o emblema DesbravaClube, mesmo com clube carregado', () => {
    const { container } = render(<Logo produto />)
    expect(logos(container)).toEqual(['/icon-192.png'])
  })
})

describe('telas globais nunca vestem a marca do clube', () => {
  it('Login: emblema e nome DesbravaClube', () => {
    const { container } = render(<MemoryRouter><Login /></MemoryRouter>)
    expect(logos(container)).toEqual(['/icon-192.png'])
    expect(screen.getByRole('heading', { name: 'DesbravaClube' })).toBeInTheDocument()
    expect(screen.queryByText('Clube Brasão')).toBeNull()
  })
  it('Cadastro: emblema DesbravaClube', () => {
    const { container } = render(<MemoryRouter><Cadastro /></MemoryRouter>)
    expect(logos(container)).toContain('/icon-192.png')
    expect(logos(container)).not.toContain('/clubes/tenant-001.png')
  })
})
