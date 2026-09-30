import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import HistoricoTentativas from './HistoricoTentativas.jsx'

vi.mock('../Comprovacao.jsx', () => ({ default: ({ valor }) => <span data-testid="foto">{valor}</span> }))

const modelo = { versao: 1, familia: 'T1', schema: { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Resumo' }, { chave: 'fotos', tipo: 'anexos', rotulo: 'Fotos' }] } }
const tentativas = [
  {
    submission_id: 's1', tentativa_numero: 1, enviado_em: '2026-09-01T12:00:00Z', conteudo: { resumo: 'Primeira versão' }, anexos: [{ campo: 'fotos', path: 'u/requisitos/1.jpg' }],
    decisao: 'correcao_solicitada', avaliado_por_nome: 'Ana', avaliado_papel: 'instrutor', avaliado_em: '2026-09-02T12:00:00Z', comentario: 'Conte mais',
  },
  { submission_id: 's2', tentativa_numero: 2, enviado_em: '2026-09-05T12:00:00Z', conteudo: { resumo: 'Segunda versão' }, anexos: [], decisao: null },
]

describe('HistoricoTentativas', () => {
  it('lista as duas tentativas em ordem e preserva a primeira (conteúdo, anexo, avaliador, comentário)', () => {
    render(<HistoricoTentativas tentativas={tentativas} modelo={modelo} mostrarAvaliador />)
    const itens = screen.getAllByTestId('tentativa')
    expect(itens).toHaveLength(2)
    expect(within(itens[0]).getByText(/Tentativa 1/)).toBeInTheDocument()
    expect(within(itens[0]).getByText('Primeira versão')).toBeInTheDocument()
    expect(within(itens[0]).getByTestId('foto')).toHaveTextContent('u/requisitos/1.jpg')
    expect(within(itens[0]).getByText(/Correção solicitada/)).toBeInTheDocument()
    expect(within(itens[0]).getByText(/por Ana \(instrutor\)/)).toBeInTheDocument()
    expect(within(itens[0]).getByText(/Conte mais/)).toBeInTheDocument()
    expect(within(itens[1]).getByText(/Tentativa 2/)).toBeInTheDocument()
    expect(within(itens[1]).getByText('Segunda versão')).toBeInTheDocument()
    expect(within(itens[1]).getByText(/Aguardando avaliação/)).toBeInTheDocument()
  })

  it('aceita o modelo como schema direto (especialidades)', () => {
    render(<HistoricoTentativas tentativas={[tentativas[1]]} modelo={modelo.schema} />)
    expect(screen.getByText('Segunda versão')).toBeInTheDocument()
  })

  it('tentativa antiga (sem conteúdo) mostra o texto e a foto como antes', () => {
    render(<HistoricoTentativas tentativas={[{ submission_id: 'x', tentativa_numero: 1, evidencia_texto: 'Texto velho', evidencia_path: 'u/requisitos/v.jpg', decisao: 'aprovado' }]} modelo={modelo} />)
    expect(screen.getByText(/Texto velho/)).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('u/requisitos/v.jpg')
  })

  it('sem tentativas', () => {
    render(<HistoricoTentativas tentativas={[]} />)
    expect(screen.getByText('Nenhuma tentativa registrada.')).toBeInTheDocument()
  })
})
