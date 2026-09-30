// Avaliar classes com relatório estruturado: mostra o conteúdo legível + histórico; sem modelo, como sempre.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'diretoria' }) }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: ({ valor }) => <span data-testid="foto">{valor}</span> }))
const carregarAvaliacoesPendentesDeClasse = vi.fn()
const avaliarRequisito = vi.fn()
const carregarHistoricoRequisito = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarAvaliacoesPendentesDeClasse: (...a) => carregarAvaliacoesPendentesDeClasse(...a),
  avaliarRequisito: (...a) => avaliarRequisito(...a),
  carregarHistoricoRequisito: (...a) => carregarHistoricoRequisito(...a),
}))
const { default: AvaliarClasse } = await import('./AvaliarClasse.jsx')

const MODELO = { versao: 1, familia: 'T1', schema: { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte o que fez' }, { chave: 'fotos', tipo: 'anexos', rotulo: 'Fotos' }] } }
const item = (over) => ({
  member_requirement_id: 'mr1', usuario_id: 'u1', usuario_nome: 'Criança Teste', classe_nome: 'Classe Teste', secao_nome: 'Seção I',
  requisito_id: 'r1', requisito_codigo: '4', requisito_descricao: 'Requisito de teste.', tipo_evidencia: 'texto',
  evidencia_texto: 'Resumo legível gerado pelo servidor', evidencia_path: null, escolha: null, bloqueios: [], submission_id: 'sub-2', tentativa_numero: 2, ...over,
})

describe('AvaliarClasse — relatório estruturado', () => {
  it('com modelo: mostra o conteúdo por rótulo, as fotos e o histórico; avalia passando a tentativa vista', async () => {
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ modelo: MODELO, conteudo: { resumo: 'Fiz a trilha' }, anexos: [{ campo: 'fotos', path: 'u/requisitos/1.jpg' }] })])
    carregarHistoricoRequisito.mockResolvedValue({ modelo: MODELO, tentativas: [
      { submission_id: 'sub-1', tentativa_numero: 1, conteudo: { resumo: 'Primeira' }, anexos: [], decisao: 'correcao_solicitada', comentario: 'Mais detalhes' },
      { submission_id: 'sub-2', tentativa_numero: 2, conteudo: { resumo: 'Fiz a trilha' }, anexos: [], decisao: null },
    ] })
    render(<AvaliarClasse />)
    expect(await screen.findByText('Conte o que fez')).toBeInTheDocument()
    expect(screen.getByText('Fiz a trilha')).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('u/requisitos/1.jpg')
    expect(screen.queryByText(/Resumo legível gerado pelo servidor/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Ver histórico/ }))
    expect(await screen.findByText('Primeira')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Aprovar/ })) })
    expect(avaliarRequisito).toHaveBeenCalledWith('mr1', 'aprovado', null, 'sub-2')
  })

  it('devolver exige comentário', async () => {
    avaliarRequisito.mockClear()
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ modelo: MODELO, conteudo: { resumo: 'x' }, anexos: [] })])
    render(<AvaliarClasse />)
    await screen.findByText('Conte o que fez')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pedir correção' })) })
    expect(avaliarRequisito).not.toHaveBeenCalled()
  })

  it('sem modelo: texto e foto como sempre', async () => {
    carregarAvaliacoesPendentesDeClasse.mockResolvedValue([item({ modelo: null, conteudo: null, tentativa_numero: 1, evidencia_path: 'u/requisitos/9.jpg' })])
    render(<AvaliarClasse />)
    expect(await screen.findByText(/Resumo legível gerado pelo servidor/)).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('u/requisitos/9.jpg')
    expect(screen.queryByTestId('relatorio-leitura')).toBeNull()
    expect(screen.queryByRole('button', { name: /Ver histórico/ })).toBeNull()
  })
})
