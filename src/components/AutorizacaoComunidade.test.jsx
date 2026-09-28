// Rótulos desde a 491 (29/09/2026): a autorização dos pais é a do papel; no app o responsável só DESLIGA/RELIGA.
// Autorização do responsável para a Comunidade: some quando o recurso está desligado; autoriza e revoga
// chamando a RPC com o filho certo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const autorizacoesDosFilhos = vi.fn()
const autorizar = vi.fn()
const responsavelImagem = vi.fn()
vi.mock('../services/comunidade.js', () => ({
  autorizacoesDosFilhos: (...a) => autorizacoesDosFilhos(...a),
  autorizar: (...a) => autorizar(...a),
  responsavelImagem: (...a) => responsavelImagem(...a),
}))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))

const { default: AutorizacaoComunidade } = await import('./AutorizacaoComunidade.jsx')

beforeEach(() => { autorizacoesDosFilhos.mockReset(); autorizar.mockReset(); autorizar.mockResolvedValue({ ok: true }) })

describe('Autorização da Comunidade (responsável)', () => {
  it('recurso desligado: não mostra nada', async () => {
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: false, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: false }] })
    const { container } = render(<AutorizacaoComunidade />)
    await vi.waitFor(() => expect(autorizacoesDosFilhos).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('autoriza o filho', async () => {
    const u = userEvent.setup()
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: true, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: false }] })
    render(<AutorizacaoComunidade />)
    await u.click(await screen.findByRole('button', { name: 'Religar' }))
    expect(autorizar).toHaveBeenCalledWith('f1', true)
  })

  it('revoga (com confirmação)', async () => {
    const u = userEvent.setup()
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: true, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: true }] })
    render(<AutorizacaoComunidade />)
    await u.click(await screen.findByRole('button', { name: 'Desligar' }))
    expect(autorizar).toHaveBeenCalledWith('f1', false)
  })

  it('responsável DESLIGA a foto de rosto na rede (autorização de imagem)', async () => {
    const u = userEvent.setup()
    responsavelImagem.mockResolvedValue({ ok: true })
    autorizacoesDosFilhos.mockResolvedValue({ recurso_ligado: true, filhos: [{ desbravador_id: 'f1', nome: 'Lia', autorizado: true, imagem_arquivada: true, imagem_autorizada: true, imagem_desligada: false }] })
    render(<AutorizacaoComunidade />)
    expect(await screen.findByText('Foto aparece na rede')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Desligar foto' }))
    expect(responsavelImagem).toHaveBeenCalledWith('f1', true)
  })
})
