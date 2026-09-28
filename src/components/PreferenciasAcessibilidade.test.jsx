import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const salvar = vi.fn()
let sessao = { user: { id: 'u1' } }
vi.mock('../services/usuarios.js', () => ({ salvarPreferenciasAcessibilidade: (...a) => salvar(...a) }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ session: sessao }) }))
const erro = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { erro: (...a) => erro(...a), sucesso: vi.fn() } }))
const { PainelAcessibilidade, default: BotaoAcessibilidade } = await import('./PreferenciasAcessibilidade.jsx')

const html = document.documentElement

describe('painel de acessibilidade', () => {
  beforeEach(() => {
    localStorage.clear(); salvar.mockReset(); salvar.mockResolvedValue({}); erro.mockReset()
    sessao = { user: { id: 'u1' } }
    html.style.fontSize = ''; html.removeAttribute('data-contraste')
  })

  it('A+ aplica na hora, guarda no aparelho e grava NA CONTA', async () => {
    render(<PainelAcessibilidade />)
    fireEvent.click(screen.getByRole('button', { name: /Letra grande/ }))
    expect(html.style.fontSize).toBe('115%')
    expect(JSON.parse(localStorage.getItem('acessibilidade'))).toEqual({ fonte: 'grande', alto_contraste: false })
    await waitFor(() => expect(salvar).toHaveBeenCalledWith({ fonte: 'grande', alto_contraste: false }))
    expect(screen.getByRole('button', { name: /Letra grande/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('alto contraste é um interruptor com nome e estado', async () => {
    render(<PainelAcessibilidade />)
    const sw = screen.getByRole('switch', { name: 'Alto contraste' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(html.getAttribute('data-contraste')).toBe('alto')
    await waitFor(() => expect(salvar).toHaveBeenCalledWith({ fonte: 'normal', alto_contraste: true }))
  })

  it('sem sessão: vale no aparelho e não chama o servidor', () => {
    sessao = null
    render(<PainelAcessibilidade />)
    fireEvent.click(screen.getByRole('button', { name: /Letra menor/ }))
    expect(html.style.fontSize).toBe('90%')
    expect(salvar).not.toHaveBeenCalled()
  })

  it('falha de rede: a escolha continua valendo e a pessoa é avisada', async () => {
    salvar.mockRejectedValue(new Error('Failed to fetch'))
    render(<PainelAcessibilidade />)
    fireEvent.click(screen.getByRole('button', { name: /Letra muito grande/ }))
    await waitFor(() => expect(erro).toHaveBeenCalled())
    expect(html.style.fontSize).toBe('130%')
  })

  it('o botão "Aa" tem nome acessível e abre o painel', () => {
    render(<BotaoAcessibilidade />)
    fireEvent.click(screen.getByRole('button', { name: /Acessibilidade/ }))
    expect(screen.getByRole('dialog', { name: 'Acessibilidade' })).toBeInTheDocument()
    expect(screen.getByTestId('painel-acessibilidade')).toBeInTheDocument()
  })
})
