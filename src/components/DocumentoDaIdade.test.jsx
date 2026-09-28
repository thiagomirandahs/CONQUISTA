import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const apagar = vi.fn()
vi.mock('../services/documentoIdade.js', () => ({
  enviarDocumento: vi.fn(),
  apagarDocumentoConferido: (...a) => apagar(...a),
  documentoDoRequisito: vi.fn(),
}))
vi.mock('./Comprovacao.jsx', () => ({ default: ({ alt }) => <span>{alt}</span> }))
const { DocumentoDaIdade } = await import('./DocumentoDaIdade.jsx')

describe('Foto do documento (requisito de idade)', () => {
  beforeEach(() => { apagar.mockReset(); apagar.mockResolvedValue(true) })

  it('pede a foto com o aviso de privacidade (cobrir o número, apagada depois)', () => {
    render(<DocumentoDaIdade info={{ orientacao: 'Foto de um documento.', documento: null }} requirementId="r" memberRequirementId="m" podeEditar userId="u" />)
    expect(screen.getByText(/Cubra o número do documento/)).toBeInTheDocument()
    expect(screen.getByText(/apagada/)).toBeInTheDocument()
    expect(screen.getByLabelText('Foto do documento')).toBeInTheDocument()
  })

  it('com foto enviada, mostra e deixa trocar', () => {
    render(<DocumentoDaIdade info={{ documento: { status: 'enviado', evidencia_path: 'u/documentos/1.jpg' } }} requirementId="r" memberRequirementId="m" podeEditar userId="u" />)
    expect(screen.getByText('foto do documento enviada')).toBeInTheDocument()
    expect(screen.getByText('Trocar a foto do documento')).toBeInTheDocument()
  })

  it('conferido: só o registro; se a foto ainda existir, o app do dono apaga de reserva', async () => {
    render(<DocumentoDaIdade info={{ documento: { status: 'conferido', evidencia_path: 'u/documentos/1.jpg', conferido_por_nome: 'Ana', conferido_em: '2026-09-28T12:00:00Z' } }}
      requirementId="r" memberRequirementId="m" podeEditar={false} userId="u" />)
    expect(screen.getByTestId('documento-conferido')).toHaveTextContent('Idade conferida por Ana')
    expect(screen.queryByText('foto do documento enviada')).toBeNull()
    await vi.waitFor(() => expect(apagar).toHaveBeenCalledWith('m', 'u/documentos/1.jpg'))
  })
})
