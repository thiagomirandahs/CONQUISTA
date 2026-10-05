// Gestão: aviso de cadastros esperando aprovação (só diretoria; falha de rede não mostra "0").
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const f = { pendentes: vi.fn(), papel: 'diretoria' }
vi.mock('../services/entrada.js', () => ({ entradasPendentes: (...a) => f.pendentes(...a) }))
vi.mock('../services/inicio.js', () => ({ carregarAvaliacoesPendentes: async () => ({ total: 0, itens: [] }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: f.papel, temRecurso: () => true }) }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../components/BotaoAjuda.jsx', () => ({ default: () => null }))
vi.mock('../components/TourDaArea.jsx', () => ({ default: () => null }))
const { default: Gestao } = await import('./Gestao.jsx')
const r = () => render(<MemoryRouter><Gestao /></MemoryRouter>)

beforeEach(() => { f.pendentes.mockReset(); f.papel = 'diretoria' })

describe('Gestão — cadastros pendentes', () => {
  it('diretoria com 3 pendentes: card chamativo com o número e link para as inscrições', async () => {
    f.pendentes.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    r()
    const card = await screen.findByTestId('aviso-cadastros-pendentes')
    expect(card).toHaveTextContent('3 cadastros esperando aprovação')
    expect(card).toHaveAttribute('href', '/gestao/inscricoes')
  })
  it('1 pendente usa o singular; zero pendentes não mostra nada', async () => {
    f.pendentes.mockResolvedValueOnce([{ id: 1 }])
    const { unmount } = r()
    expect(await screen.findByTestId('aviso-cadastros-pendentes')).toHaveTextContent('1 cadastro esperando aprovação')
    unmount()
    f.pendentes.mockResolvedValueOnce([])
    r()
    await waitFor(() => expect(f.pendentes).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('aviso-cadastros-pendentes')).not.toBeInTheDocument()
  })
  it('falha de rede: não mostra aviso nenhum (nunca um "0" falso); instrutor nem consulta', async () => {
    f.pendentes.mockRejectedValue(new Error('offline'))
    const { unmount } = r()
    await waitFor(() => expect(f.pendentes).toHaveBeenCalled())
    expect(screen.queryByTestId('aviso-cadastros-pendentes')).not.toBeInTheDocument()
    unmount()
    f.pendentes.mockClear(); f.papel = 'instrutor'
    r()
    expect(f.pendentes).not.toHaveBeenCalled()
  })
})
