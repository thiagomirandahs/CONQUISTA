// Modal de assinatura individual. O desenho é OPCIONAL — assinar sem desenhar já é válido. O
// checkbox de consentimento é obrigatório (botão desabilitado até marcar).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const assinarDocumento = vi.fn()
const subirDesenhoAssinatura = vi.fn()
vi.mock('../services/documentos.js', () => ({
  assinarDocumento: (...a) => assinarDocumento(...a),
  subirDesenhoAssinatura: (...a) => subirDesenhoAssinatura(...a),
}))

const { default: AssinarDocumentoModal } = await import('./AssinarDocumentoModal.jsx')

const DOC = { documento_id: 'doc-1', token: 'tok1', titular_nome: 'Fulano', classe_nome: 'Amigo', tipo: 'final', conferencia: 'ABCD1234' }

beforeEach(() => {
  assinarDocumento.mockReset().mockResolvedValue({ signature_id: 'sig-1' })
  subirDesenhoAssinatura.mockReset()
})

describe('AssinarDocumentoModal', () => {
  it('botão de assinar começa desabilitado até marcar o consentimento', async () => {
    render(<AssinarDocumentoModal aberta documento={DOC} clubId="clube-1" aoFechar={() => {}} aoAssinado={() => {}} />)
    expect(screen.getByTestId('confirmar-assinatura')).toBeDisabled()
    await userEvent.click(screen.getByTestId('consentimento-checkbox'))
    expect(screen.getByTestId('confirmar-assinatura')).not.toBeDisabled()
  })

  it('assina sem desenhar nada — não sobe desenho nenhum', async () => {
    const aoAssinado = vi.fn()
    render(<AssinarDocumentoModal aberta documento={DOC} clubId="clube-1" aoFechar={() => {}} aoAssinado={aoAssinado} />)
    await userEvent.click(screen.getByTestId('consentimento-checkbox'))
    await userEvent.click(screen.getByTestId('confirmar-assinatura'))
    expect(assinarDocumento).toHaveBeenCalledWith('tok1', expect.stringContaining('Declaro que revisei'))
    expect(subirDesenhoAssinatura).not.toHaveBeenCalled()
    expect(aoAssinado).toHaveBeenCalled()
  })

  it('mostra titular, classe e código de conferência', () => {
    render(<AssinarDocumentoModal aberta documento={DOC} clubId="clube-1" aoFechar={() => {}} aoAssinado={() => {}} />)
    expect(screen.getByText('Fulano')).toBeInTheDocument()
    expect(screen.getByText('Amigo')).toBeInTheDocument()
    expect(screen.getByText('ABCD1234')).toBeInTheDocument()
  })
})
