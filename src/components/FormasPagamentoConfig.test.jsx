import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const ler = vi.fn()
const salvar = vi.fn()
const sucesso = vi.fn()
const erro = vi.fn()
vi.mock('../services/unidades.js', () => ({ lerPagamentoDoClube: (...a) => ler(...a), salvarPagamentoDoClube: (...a) => salvar(...a) }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: (...a) => sucesso(...a), erro: (...a) => erro(...a), info: vi.fn(), confirmar: vi.fn() } }))
const { default: Config } = await import('./FormasPagamentoConfig.jsx')

beforeEach(() => {
  vi.clearAllMocks()
  ler.mockResolvedValue({ formas: [{ tipo: 'pix', rotulo: '', detalhe: 'minha-chave' }], valor: 30 })
  salvar.mockResolvedValue()
})

describe('FormasPagamentoConfig', () => {
  it('carrega o que existe; adicionar forma, preencher e salvar chama o serviço com valor e formas', async () => {
    render(<Config />)
    expect(await screen.findByDisplayValue('minha-chave')).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Dinheiro na reunião/ }))
    await userEvent.type(screen.getByLabelText(/Quem recebe/), 'tesoureiro')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(salvar).toHaveBeenCalledWith({
      valor: '30',
      formas: [
        { tipo: 'pix', rotulo: '', detalhe: 'minha-chave' },
        { tipo: 'dinheiro', rotulo: '', detalhe: 'tesoureiro' },
      ],
    })
    expect(sucesso).toHaveBeenCalled()
  })

  it('remover tira a forma da lista', async () => {
    render(<Config />)
    await screen.findByDisplayValue('minha-chave')
    await userEvent.click(screen.getByRole('button', { name: /Remover PIX/ }))
    expect(screen.queryByDisplayValue('minha-chave')).not.toBeInTheDocument()
  })

  it('falha de leitura: aviso e Salvar desabilitado (não apaga o que já existe)', async () => {
    ler.mockRejectedValue(new Error('offline'))
    render(<Config />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não consegui carregar/)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
})
