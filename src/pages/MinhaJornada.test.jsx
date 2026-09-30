import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
const carregar = vi.fn()
vi.mock('../services/jornada.js', () => ({ carregarMinhaJornada: (...a) => carregar(...a) }))
const { default: MinhaJornada } = await import('./MinhaJornada.jsx')
const ver = () => render(<MemoryRouter><MinhaJornada /></MemoryRouter>)
const V = { classes: [], especialidades: [], investiduras: [], conquistas: [], leituras: [] }
beforeEach(() => carregar.mockReset())

describe('Minha Jornada', () => {
  it('mostra carregando e depois os dados', async () => {
    carregar.mockResolvedValue({ ...V, classes: [{ member_class_id: '1', nome: 'Amigo', status: 'em_andamento', percentual: 40, iniciada_em: '2026-01-02T12:00:00Z' }],
      leituras: [{ titulo: 'Vaso', concluido: true }] })
    ver()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(await screen.findByText('Amigo')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /Amigo/ })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText('Vaso')).toBeInTheDocument()
  })
  it('estado vazio', async () => {
    carregar.mockResolvedValue(V)
    ver()
    expect(await screen.findByText(/ainda não começou/)).toBeInTheDocument()
  })
  it('erro com Tentar de novo', async () => {
    carregar.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(V)
    ver()
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText(/ainda não começou/)).toBeInTheDocument()
    expect(carregar).toHaveBeenCalledTimes(2)
  })
})
