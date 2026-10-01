// Relato por TENTATIVA (520): a tentativa antiga mantém o seu relato; a nova tem o dela. Só leitura.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import RelatoDoMembro from './RelatoDoMembro.jsx'
import HistoricoTentativas from './HistoricoTentativas.jsx'
import HistoricoDeTentativas from '../HistoricoDeTentativas.jsx'

vi.mock('../Comprovacao.jsx', () => ({ default: () => null }))

const modelo = { versao: 1, familia: 'T1', schema: { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Resumo' }] } }

describe('RelatoDoMembro', () => {
  it('mostra o rótulo e o texto; sem relato não renderiza', () => {
    const { rerender, container } = render(<RelatoDoMembro relato="  Fiz com minha unidade  " />)
    expect(screen.getByText('Relato do membro')).toBeInTheDocument()
    expect(screen.getByText('Fiz com minha unidade')).toBeInTheDocument()
    rerender(<RelatoDoMembro relato={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<RelatoDoMembro relato="   " />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('histórico mostra o relato de CADA tentativa', () => {
  const tentativas = [
    { submission_id: 's1', tentativa_numero: 1, conteudo: { resumo: 'v1' }, relato: 'Relato da tentativa 1', decisao: 'correcao_solicitada', comentario: 'mais' },
    { submission_id: 's2', tentativa_numero: 2, conteudo: { resumo: 'v2' }, relato: 'Relato da tentativa 2', decisao: null },
    { submission_id: 's3', tentativa_numero: 3, conteudo: { resumo: 'v3' }, relato: null, decisao: null },
  ]

  it('com formulário (HistoricoTentativas): tentativa 1 intacta na 2; sem relato não mostra bloco', () => {
    render(<HistoricoTentativas tentativas={tentativas} modelo={modelo} />)
    const itens = screen.getAllByTestId('tentativa')
    expect(within(itens[0]).getByText('Relato da tentativa 1')).toBeInTheDocument()
    expect(within(itens[0]).queryByText('Relato da tentativa 2')).toBeNull()
    expect(within(itens[1]).getByText('Relato da tentativa 2')).toBeInTheDocument()
    expect(within(itens[2]).queryByTestId('relato-do-membro')).toBeNull()
  })

  it('sem formulário (HistoricoDeTentativas): relato por tentativa', () => {
    render(<HistoricoDeTentativas tentativas={tentativas.map((t) => ({ ...t, conteudo: undefined, evidencia_texto: 'texto' }))} />)
    const itens = screen.getByTestId('historico-tentativas').querySelectorAll('li')
    expect(within(itens[0]).getByText('Relato da tentativa 1')).toBeInTheDocument()
    expect(within(itens[1]).getByText('Relato da tentativa 2')).toBeInTheDocument()
    expect(within(itens[2]).queryByTestId('relato-do-membro')).toBeNull()
  })

  it('histórico antigo (sem a chave relato) segue como sempre', () => {
    render(<HistoricoTentativas tentativas={[{ submission_id: 'a', tentativa_numero: 1, conteudo: { resumo: 'ok' }, decisao: 'aprovado' }]} modelo={modelo} />)
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.queryByTestId('relato-do-membro')).toBeNull()
  })
})
