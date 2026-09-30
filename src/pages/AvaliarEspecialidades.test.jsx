// Fila de avaliação de especialidades com o motor de relatório.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'diretoria' }) }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: ({ valor }) => <span data-testid="foto">{valor}</span> }))
const carregarAvaliacoesPendentesDeEspecialidade = vi.fn()
const avaliarRequisitoEspecialidade = vi.fn()
const carregarHistoricoEspecialidade = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarAvaliacoesPendentesDeEspecialidade: (...a) => carregarAvaliacoesPendentesDeEspecialidade(...a),
  avaliarRequisitoEspecialidade: (...a) => avaliarRequisitoEspecialidade(...a),
  carregarEspecialidadesDisponiveis: vi.fn().mockResolvedValue([]),
  criarOfertaEspecialidade: vi.fn(),
  carregarOfertasDoClube: vi.fn().mockResolvedValue([]),
  carregarHistoricoEspecialidade: (...a) => carregarHistoricoEspecialidade(...a),
}))
const { default: AvaliarEspecialidades } = await import('./AvaliarEspecialidades.jsx')

const MODELO = { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte a técnica' }] }
const linha = (over) => ({
  member_specialty_requirement_id: 'msr1', submission_id: 'sub-9', tentativa_numero: 1, usuario_nome: 'Criança Teste', especialidade_nome: 'Espec.',
  requisito_codigo: '1', requisito_descricao: 'Requisito.', evidencia_texto: 'Resumo do servidor', evidencia_path: null, ...over,
})

describe('AvaliarEspecialidades — relatório estruturado', () => {
  it('com modelo: mostra o conteúdo por rótulo e avalia passando o submission_id', async () => {
    carregarAvaliacoesPendentesDeEspecialidade.mockResolvedValue([linha({ modelo: MODELO, conteudo: { resumo: 'Fiz o nó direito' }, anexos: [{ campo: 'f', path: 'u/requisitos/2.jpg' }] })])
    carregarHistoricoEspecialidade.mockResolvedValue({ modelo: MODELO, tentativas: [{ submission_id: 'sub-9', tentativa_numero: 1, conteudo: { resumo: 'Fiz o nó direito' }, anexos: [], decisao: null }] })
    render(<AvaliarEspecialidades />)
    expect(await screen.findByText('Conte a técnica')).toBeInTheDocument()
    expect(screen.getByText('Fiz o nó direito')).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('u/requisitos/2.jpg')
    expect(screen.queryByText('Resumo do servidor')).toBeNull()
    fireEvent.click(screen.getByTestId('ver-historico'))
    expect(await screen.findByTestId('historico-tentativas')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Aprovar/ })) })
    expect(avaliarRequisitoEspecialidade).toHaveBeenCalledWith('msr1', 'aprovado', null, 'sub-9')
  })

  it('devolver sem comentário não chama o servidor', async () => {
    avaliarRequisitoEspecialidade.mockClear()
    carregarAvaliacoesPendentesDeEspecialidade.mockResolvedValue([linha({ modelo: MODELO, conteudo: { resumo: 'x' }, anexos: [] })])
    render(<AvaliarEspecialidades />)
    await screen.findByText('Conte a técnica')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pedir correção' })) })
    expect(avaliarRequisitoEspecialidade).not.toHaveBeenCalled()
  })

  it('sem modelo: texto e foto como sempre, sem botão de histórico', async () => {
    carregarAvaliacoesPendentesDeEspecialidade.mockResolvedValue([linha({ modelo: null, conteudo: null, evidencia_path: 'u/requisitos/7.jpg' })])
    render(<AvaliarEspecialidades />)
    expect(await screen.findByText(/Resumo do servidor/)).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('u/requisitos/7.jpg')
    expect(screen.queryByTestId('ver-historico')).toBeNull()
  })
})
