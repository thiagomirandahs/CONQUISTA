// "Concluídas anteriormente" na visão do próprio membro: inclui registros feitos pela liderança deste clube (521).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ m: { div: (p) => <div {...Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'transition'].includes(k)))} /> } }))
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: vi.fn(), carregarMinhasClasses: vi.fn(), carregarClassesDisponiveis: vi.fn(), iniciarClasse: vi.fn(),
  carregarClassesConcluidasAnteriormente: vi.fn(), salvarRequisito: vi.fn(), enviarRequisito: vi.fn(), escolherOpcoesRequisito: vi.fn(),
  carregarOrigemRequisito: vi.fn(), carregarHistoricoRequisito: vi.fn(),
}))

const { ConcluidasAnteriormente } = await import('./MinhaClasse.jsx')
const r = (itens) => render(<MemoryRouter><ConcluidasAnteriormente itens={itens} /></MemoryRouter>)

describe('ConcluidasAnteriormente com registro da liderança', () => {
  it('mostra "Registrada em" e a data da conclusão', () => {
    r([{ class_id: 'k1', nome: 'Amigo', origem: 'registro_anterior_neste_clube', concluida_em: '2024-05-10T12:00:00Z', registrada_em: '2026-09-30T10:00:00Z', data_desconhecida: false }])
    const li = screen.getByRole('listitem')
    expect(li).toHaveTextContent('Concluída em 10/05/2024')
    expect(li).toHaveTextContent('Registrada em 30/09/2026')
    expect(screen.getByText('Você já concluiu estas classes antes. Elas valem aqui.')).toBeInTheDocument()
  })
  it('data desconhecida não inventa data', () => {
    r([{ class_id: 'k1', nome: 'Amigo', origem: 'registro_anterior_neste_clube', concluida_em: null, registrada_em: '2026-09-30T10:00:00Z', data_desconhecida: true }])
    const li = screen.getByRole('listitem')
    expect(li).toHaveTextContent('Data da conclusão desconhecida')
    expect(li).not.toHaveTextContent('Concluída em')
  })
  it('itens de outro clube seguem iguais (sem campos novos)', () => {
    r([{ class_id: 'k9', nome: 'Pesquisador', origem: 'outro_clube', concluida_em: '2025-11-03T12:00:00Z', origem_clube_nome: 'Aurora' }])
    expect(screen.getByRole('listitem')).toHaveTextContent('Concluída em 03/11/2025 no clube Aurora')
    expect(screen.getByText('Você já concluiu estas classes em outro clube. Elas valem aqui.')).toBeInTheDocument()
  })
})
