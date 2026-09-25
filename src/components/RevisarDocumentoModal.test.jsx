// Revisão DOCUMENTAL — diferente de avaliação curricular. Correção exige motivo; aprovação não.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const revisarDocumento = vi.fn()
vi.mock('../services/documentos.js', () => ({ revisarDocumento: (...a) => revisarDocumento(...a) }))

const { default: RevisarDocumentoModal } = await import('./RevisarDocumentoModal.jsx')

const DOC = { documento_id: 'doc-1', token: 'tok1', titular_nome: 'Fulano', classe_nome: 'Amigo' }

beforeEach(() => { revisarDocumento.mockReset().mockResolvedValue({ ok: true }) })

describe('RevisarDocumentoModal', () => {
  it('aprovar não exige motivo', async () => {
    const aoDecidido = vi.fn()
    render(<RevisarDocumentoModal aberta documento={DOC} aoFechar={() => {}} aoDecidido={aoDecidido} />)
    await userEvent.click(screen.getByTestId('confirmar-revisao'))
    expect(revisarDocumento).toHaveBeenCalledWith('tok1', 'aprovado', null, null)
    expect(aoDecidido).toHaveBeenCalled()
  })

  it('pedir correção sem motivo é recusado (nunca chama a RPC)', async () => {
    render(<RevisarDocumentoModal aberta documento={DOC} aoFechar={() => {}} aoDecidido={() => {}} />)
    await userEvent.click(screen.getByText('↺ Pedir correção'))
    await userEvent.click(screen.getByTestId('confirmar-revisao'))
    expect(revisarDocumento).not.toHaveBeenCalled()
  })

  it('pedir correção com motivo chama a RPC com motivo e orientação', async () => {
    render(<RevisarDocumentoModal aberta documento={DOC} aoFechar={() => {}} aoDecidido={() => {}} />)
    await userEvent.click(screen.getByText('↺ Pedir correção'))
    await userEvent.type(screen.getByTestId('revisao-motivo'), 'Falta a unidade')
    await userEvent.type(screen.getByTestId('revisao-orientacao'), 'Preencha a unidade')
    await userEvent.click(screen.getByTestId('confirmar-revisao'))
    expect(revisarDocumento).toHaveBeenCalledWith('tok1', 'correcao_solicitada', 'Falta a unidade', 'Preencha a unidade')
  })

  it('nunca menciona requisito/evidência/aprovação curricular (é revisão de DOCUMENTO)', () => {
    render(<RevisarDocumentoModal aberta documento={DOC} aoFechar={() => {}} aoDecidido={() => {}} />)
    expect(screen.getByText(/não é avaliação de requisito/)).toBeInTheDocument()
  })
})
