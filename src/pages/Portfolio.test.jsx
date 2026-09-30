import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const carregar = vi.fn()
vi.mock('../services/jornada.js', () => ({ carregarPortfolio: (...a) => carregar(...a) }))
const { default: Portfolio } = await import('./Portfolio.jsx')
const item = (n, extra = {}) => ({ alvo: 'classe', origem: `Origem ${n}`, requisito_codigo: `I.${n}`, requisito: `Req ${n}`, aprovado_em: `2026-09-0${n}T10:00:00Z`, avaliador: 'Ana', resumo: null, anexos: 0, ...extra })
beforeEach(() => carregar.mockReset())

describe('Portfólio', () => {
  it('explica que é separado do cartão oficial e pagina com Ver mais', async () => {
    carregar.mockResolvedValueOnce({ itens: [item(1, { resumo: 'Fiz tudo' })], proximo: 'c|id' })
      .mockResolvedValueOnce({ itens: [item(2)], proximo: null })
    render(<Portfolio />)
    expect(screen.getByText(/separado do cartão oficial/)).toBeInTheDocument()
    expect(await screen.findByText('Origem 1')).toBeInTheDocument()
    expect(screen.getByText(/Fiz tudo/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver mais' }))
    expect(carregar).toHaveBeenLastCalledWith({ depois: 'c|id' })
    expect(await screen.findByText('Origem 2')).toBeInTheDocument()
    expect(screen.getByText('Origem 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver mais' })).toBeNull()
  })
  it('vazio', async () => {
    carregar.mockResolvedValue({ itens: [], proximo: null })
    render(<Portfolio />)
    expect(await screen.findByText(/Nada no portfólio/)).toBeInTheDocument()
  })
  it('erro e tentar de novo', async () => {
    carregar.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ itens: [item(1)], proximo: null })
    render(<Portfolio />)
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Origem 1')).toBeInTheDocument()
  })
})
