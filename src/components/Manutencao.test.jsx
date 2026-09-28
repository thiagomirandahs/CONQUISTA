import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Modo manutenção (migration 400): faixa do aviso prévio, tela de manutenção e exceções (admin, login).
const ler = vi.fn()
vi.mock('../services/manutencao.js', () => ({ lerEstadoManutencao: (...a) => ler(...a) }))
let sessao = null
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ session: sessao }) }))
const { default: GuardaDeManutencao, TelaManutencao, FaixaManutencao } = await import('./Manutencao.jsx')

const estado = (o = {}) => ({ ativo: false, mensagem: '', avisoInicio: null, avisoMensagem: '', souAdmin: false, ...o })
const montar = (caminho = '/inicio') => render(
  <MemoryRouter initialEntries={[caminho]}><GuardaDeManutencao><p>conteúdo do app</p></GuardaDeManutencao></MemoryRouter>)

describe('GuardaDeManutencao', () => {
  beforeEach(() => { ler.mockReset(); sessao = { user: { id: 'u1' } } })

  it('normal: mostra o app, sem faixa', async () => {
    ler.mockResolvedValue(estado())
    montar()
    await vi.waitFor(() => expect(ler).toHaveBeenCalled())
    expect(screen.getByText('conteúdo do app')).toBeInTheDocument()
    expect(screen.queryByTestId('faixa-manutencao')).toBeNull()
  })

  it('aviso prévio: faixa "vai entrar em manutenção às HH:MM" e o app continua usável', async () => {
    ler.mockResolvedValue(estado({ avisoInicio: new Date(Date.now() + 30 * 60 * 1000) }))
    montar()
    expect(await screen.findByTestId('faixa-manutencao')).toHaveTextContent(/vai entrar em manutenção às \d{2}:\d{2}\. Termine o que está fazendo\./)
    expect(screen.getByText('conteúdo do app')).toBeInTheDocument()
  })

  it('manutenção ligada: tela amigável no lugar do app', async () => {
    ler.mockResolvedValue(estado({ ativo: true, mensagem: 'Voltamos às 22h.' }))
    montar()
    expect(await screen.findByTestId('tela-manutencao')).toBeInTheDocument()
    expect(screen.getByText('Estamos em manutenção')).toBeInTheDocument()
    expect(screen.getByText('Voltamos às 22h.')).toBeInTheDocument()
    expect(screen.getByText(/Nada do que você fez foi perdido/)).toBeInTheDocument()
    expect(screen.queryByText('conteúdo do app')).toBeNull()
  })

  it('admin da plataforma continua entrando (com faixa de lembrete)', async () => {
    ler.mockResolvedValue(estado({ ativo: true, souAdmin: true }))
    montar()
    expect(await screen.findByTestId('faixa-manutencao')).toHaveTextContent(/LIGADA/)
    expect(screen.getByText('conteúdo do app')).toBeInTheDocument()
  })

  it('o login continua aberto (é por onde o admin entra)', async () => {
    sessao = null
    ler.mockResolvedValue(estado({ ativo: true }))
    montar('/login')
    await vi.waitFor(() => expect(ler).toHaveBeenCalled())
    expect(screen.getByText('conteúdo do app')).toBeInTheDocument()
    expect(screen.queryByTestId('tela-manutencao')).toBeNull()
  })

  it('falha ao consultar = segue normal (quem protege o dado é o servidor)', async () => {
    ler.mockRejectedValue(new TypeError('Failed to fetch'))
    montar()
    await vi.waitFor(() => expect(ler).toHaveBeenCalled())
    expect(screen.getByText('conteúdo do app')).toBeInTheDocument()
  })

  it('consulta de novo a cada 60s e ao voltar o foco', async () => {
    vi.useFakeTimers()
    try {
      ler.mockResolvedValue(estado())
      montar()
      await act(async () => {})
      const inicial = ler.mock.calls.length
      await act(async () => { vi.advanceTimersByTime(60 * 1000) })
      expect(ler.mock.calls.length).toBe(inicial + 1)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(ler.mock.calls.length).toBe(inicial + 2)
    } finally { vi.useRealTimers() }
  })
})

describe('TelaManutencao / FaixaManutencao', () => {
  it('"Tentar de novo" consulta o estado; alvo de toque grande', async () => {
    const tentar = vi.fn().mockResolvedValue()
    render(<TelaManutencao mensagem="" aoTentar={tentar} mostrarEntrar />)
    const botao = screen.getByRole('button', { name: 'Tentar de novo' })
    expect(botao.className).toMatch(/min-h-\[48px\]/)
    await act(async () => { fireEvent.click(botao) })
    expect(tentar).toHaveBeenCalled()
    expect(screen.getByText(/Sou da equipe DesbravaClube/)).toHaveAttribute('href', '/login')
  })

  it('faixa é status acessível', () => {
    render(<FaixaManutencao texto="O app vai entrar em manutenção às 22:00." />)
    expect(screen.getByRole('status')).toHaveTextContent('22:00')
  })
})
