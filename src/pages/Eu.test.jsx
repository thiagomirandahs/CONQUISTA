// Tela "Eu" sobre GrupoLista/ItemLista (fase 6.3): os links continuam sendo links, o botão de
// atualizar continua botão, e a troca de clube só aparece com mais de um clube.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let clube
const sair = vi.fn()
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { nome: 'Ana Souza', foto: null }, sair }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
let escopo = { temEscopo: false, escopos: [] }
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => escopo }))
vi.mock('../components/ConvitesDeEquipe.jsx', () => ({ MeusConvites: () => null }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => <span data-testid="avatar" /> }))

const { default: Eu } = await import('./Eu.jsx')

const V = (id, nome) => ({ clubeId: id, status: 'ativo', selecionavel: true, marca: { nome } })
const r = () => render(<MemoryRouter><Eu /></MemoryRouter>)

beforeEach(() => {
  sair.mockReset()
  escopo = { temEscopo: false, escopos: [] }
  clube = { vinculos: [V('A', 'Clube A')], clubeId: 'A', trocarClube: vi.fn(), marca: { nome: 'Clube A' }, papel: 'desbravador', temGestao: false }
})

describe('Eu', () => {
  it('conta e aplicativo em listas agrupadas, com links de verdade', () => {
    r()
    expect(screen.getByRole('heading', { level: 1, name: 'Ana Souza' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Conta' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Meu perfil/ })).toHaveAttribute('href', '/perfil')
    expect(screen.getByTestId('ir-trocar-senha')).toHaveAttribute('href', '/trocar-senha')
    expect(screen.getByTestId('ir-ajuda')).toHaveAttribute('href', '/ajuda')
    expect(screen.getByTestId('ir-suporte')).toHaveAttribute('href', '/suporte')
    expect(screen.getByRole('button', { name: /Atualizar o app/ })).toBeInTheDocument()
    // desbravador sem escopo: sem grupo "Clube" e sem troca de clube
    expect(screen.queryByRole('heading', { name: 'Clube' })).toBeNull()
    expect(screen.queryByLabelText('Clube em uso')).toBeNull()
  })

  it('diretoria vê Configurações do clube; coordenador vê o portal', () => {
    clube.temGestao = true
    escopo = { temEscopo: true, escopos: [{ nome: 'Distrito Central' }] }
    r()
    expect(screen.getByRole('link', { name: /Configurações do clube/ })).toHaveAttribute('href', '/clube')
    expect(screen.getByTestId('ir-portal')).toHaveAttribute('href', '/institucional')
    expect(screen.getByText('Distrito Central')).toBeInTheDocument()
  })

  it('com dois clubes aparece a troca; sair chama sair()', () => {
    clube.vinculos = [V('A', 'Clube A'), V('B', 'Clube B')]
    r()
    expect(screen.getByLabelText('Clube em uso')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }))
    expect(sair).toHaveBeenCalledTimes(1)
  })
})
