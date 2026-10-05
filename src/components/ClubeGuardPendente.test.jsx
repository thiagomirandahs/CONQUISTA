// Cadastro pendente: "Já fui aprovado — atualizar" e releitura automática ao voltar para o app (auditoria de 05/10/2026).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const recarregar = vi.fn(async () => {})
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ sair: vi.fn(), session: { user: { id: 'u1', user_metadata: {} } } }) }))
vi.mock('../context/Clube.jsx', () => ({
  useClube: () => ({ carregando: false, erro: null, semVinculo: true, precisaEscolher: false, recarregar, marca: { nome: 'Clube X' }, trocarClube: vi.fn(),
    vinculos: [{ clubeId: 'c1', status: 'pendente', marca: { nome: 'Clube X' } }] }),
}))
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => ({ temEscopo: false, escopos: [], carregando: false }) }))
vi.mock('../services/admin.js', () => ({ souAdminPlataforma: async () => false }))
vi.mock('../services/entrada.js', () => ({ aplicarEntradaDoCadastro: vi.fn(), aplicarClubeEscolhidoNoCadastro: vi.fn() }))
const { default: ClubeGuard } = await import('./ClubeGuard.jsx')

beforeEach(() => { recarregar.mockClear(); vi.useRealTimers() })

describe('ClubeGuard — cadastro pendente', () => {
  it('mostra "Já fui aprovado — atualizar", que relê o contexto', async () => {
    render(<MemoryRouter><ClubeGuard><p>app</p></ClubeGuard></MemoryRouter>)
    expect(await screen.findByText('Seu cadastro aguarda aprovação')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ja-fui-aprovado'))
    expect(recarregar).toHaveBeenCalledTimes(1)
  })
  it('ao voltar para o app (visibilitychange/focus) relê sozinho, no máximo uma vez a cada 20 s', async () => {
    render(<MemoryRouter><ClubeGuard><p>app</p></ClubeGuard></MemoryRouter>)
    await screen.findByText('Seu cadastro aguarda aprovação')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(recarregar).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(recarregar).toHaveBeenCalledTimes(1)   // dentro dos 20 s: não repete
  })
})
