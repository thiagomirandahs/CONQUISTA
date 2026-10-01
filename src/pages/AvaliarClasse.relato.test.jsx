// Relato complementar (520) na fila de avaliação: o avaliador vê o "Relato do membro" da tentativa em avaliação,
// e o histórico mostra o relato de cada tentativa. Sem a 520 (sem a chave), nada muda.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'diretoria' }) }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: ({ valor }) => <span data-testid="foto">{valor}</span> }))
const carregarAvaliacoesPendentesDeClasse = vi.fn()
const carregarHistoricoRequisito = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarAvaliacoesPendentesDeClasse: (...a) => carregarAvaliacoesPendentesDeClasse(...a),
  avaliarRequisito: vi.fn(),
  carregarHistoricoRequisito: (...a) => carregarHistoricoRequisito(...a),
}))
const { default: AvaliarClasse } = await import('./AvaliarClasse.jsx')

const item = (over) => ({
  member_requirement_id: 'mr1', usuario_id: 'u1', usuario_nome: 'Criança Teste', classe_nome: 'Classe Teste', secao_nome: 'Seção I',
  requisito_id: 'r1', requisito_codigo: '4', requisito_descricao: 'Requisito de teste.', tipo_evidencia: 'nenhuma',
  evidencia_texto: null, evidencia_path: null, escolha: null, bloqueios: [], submission_id: 'sub-2', tentativa_numero: 2, modelo: null, conteudo: null, ...over,
})

describe('AvaliarClasse — relato do membro', () => {
  it('requisito sem evidência: a fila mostra o relato da tentativa; o histórico mostra o de cada tentativa', async () => {
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ relato: 'Relato da tentativa 2' })])
    carregarHistoricoRequisito.mockResolvedValue({ modelo: null, tentativas: [
      { submission_id: 'sub-1', tentativa_numero: 1, relato: 'Relato da tentativa 1', decisao: 'correcao_solicitada', comentario: 'Conte mais' },
      { submission_id: 'sub-2', tentativa_numero: 2, relato: 'Relato da tentativa 2', decisao: null },
    ] })
    render(<AvaliarClasse />)
    const atual = await screen.findByTestId('relato-do-membro')
    expect(within(atual).getByText('Relato do membro')).toBeInTheDocument()
    expect(atual).toHaveTextContent('Relato da tentativa 2')
    fireEvent.click(screen.getByRole('button', { name: /Ver histórico/ }))
    expect(await screen.findByText('Relato da tentativa 1')).toBeInTheDocument()
    expect(screen.getAllByTestId('relato-do-membro')).toHaveLength(3) // atual + 2 do histórico
  })

  it('sem a chave `relato` (banco sem a 520) não aparece bloco algum', async () => {
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ tentativa_numero: 1 })])
    render(<AvaliarClasse />)
    await screen.findByText(/Requisito de teste/)
    expect(screen.queryByTestId('relato-do-membro')).toBeNull()
  })
})
