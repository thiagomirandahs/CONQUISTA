// Sino de notificações (Fase 6): o painel é uma Folha (bottom sheet) com fechar de 44px e Esc,
// a lista abre o link do aviso, e falha ao ativar o push vira mensagem humana — nunca "Erro: " + cru.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const carregarNotificacoes = vi.fn()
const marcarNotificacoesVistas = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarNotificacoes: (...a) => carregarNotificacoes(...a),
  marcarNotificacoesVistas: (...a) => marcarNotificacoesVistas(...a),
}))
const ativarPush = vi.fn()
vi.mock('../lib/push.js', () => ({ pushSuportado: () => true, pushAtivo: async () => false, ativarPush: (...a) => ativarPush(...a) }))
vi.mock('../lib/nativo.js', () => ({ ehNativo: () => false }))
vi.mock('../lib/pushNativo.js', () => ({ estadoPushNativo: async () => 'inativo', ativarPushNativo: vi.fn(), MSG_NEGADO: 'negado' }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1', notif_visto_em: '2026-09-01T00:00:00Z' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'c1' }) }))

const { default: Notificacoes } = await import('./Notificacoes.jsx')

const AVISO = { id: 'n1', tipo: 'geral', titulo: 'Reunião sábado', corpo: 'Traga o lenço', created_at: '2026-09-20T10:00:00Z', link: '/agenda' }
const renderT = () => render(<MemoryRouter><Notificacoes /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  carregarNotificacoes.mockResolvedValue([AVISO])
  marcarNotificacoesVistas.mockResolvedValue(true)
})

describe('Notificacoes', () => {
  it('o sino conta as não lidas e abre uma Folha (dialog) com a lista', async () => {
    renderT()
    const sino = await screen.findByRole('button', { name: /Notificações, 1 não lida/ })
    await userEvent.click(sino)
    const folha = await screen.findByRole('dialog', { name: 'Notificações' })
    expect(within(folha).getByText('Reunião sábado')).toBeInTheDocument()
    expect(marcarNotificacoesVistas).toHaveBeenCalledWith('u1')
  })

  it('fecha no botão ✕ (44px) e no Esc', async () => {
    renderT()
    await userEvent.click(await screen.findByTestId('sino-notificacoes'))
    const folha = await screen.findByRole('dialog', { name: 'Notificações' })
    const fechar = within(folha).getByRole('button', { name: 'Fechar' })
    expect(fechar.className).toMatch(/w-11 h-11/)
    await userEvent.click(fechar)
    expect(await screen.findByTestId('sino-notificacoes')).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByTestId('sino-notificacoes'))
    await screen.findByRole('dialog', { name: 'Notificações' })
    await userEvent.keyboard('{Escape}')
    expect(screen.getByTestId('sino-notificacoes')).toHaveAttribute('aria-expanded', 'false')
  })

  it('sem avisos, mostra um vazio amigável', async () => {
    carregarNotificacoes.mockResolvedValue([])
    renderT()
    await userEvent.click(await screen.findByTestId('sino-notificacoes'))
    expect(await screen.findByText('Nada por aqui ainda.')).toBeInTheDocument()
  })

  it('falha ao ativar o push vira mensagem humana, nunca o erro cru', async () => {
    ativarPush.mockRejectedValue(new Error('AbortError: Registration failed - push service error'))
    renderT()
    await userEvent.click(await screen.findByTestId('sino-notificacoes'))
    await userEvent.click(await screen.findByTestId('ativar-push'))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Não consegui ativar os avisos/)
    expect(alerta).not.toHaveTextContent(/AbortError|Registration failed/)
  })

  it('motivo conhecido (permissão negada) tem a orientação própria', async () => {
    ativarPush.mockRejectedValue(new Error('PERMISSAO_NEGADA'))
    renderT()
    await userEvent.click(await screen.findByTestId('sino-notificacoes'))
    await userEvent.click(await screen.findByTestId('ativar-push'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Libere nas configurações do navegador/)
  })
})
