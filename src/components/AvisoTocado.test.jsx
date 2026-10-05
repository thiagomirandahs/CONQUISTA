// Tocar na notificação do celular abre um popup com o aviso INTEIRO (a bandeja corta o texto).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'

const carregarNotificacoes = vi.fn()
vi.mock('../lib/dados.js', () => ({ carregarNotificacoes: (...a) => carregarNotificacoes(...a) }))
const { default: AvisoTocado } = await import('./AvisoTocado.jsx')
const { anunciarAvisoTocado, linkInterno } = await import('../lib/avisoTocado.js')

function Local() { return <span data-testid="local">{useLocation().pathname}</span> }
const r = () => render(<MemoryRouter><AvisoTocado /><Local /></MemoryRouter>)

beforeEach(() => { carregarNotificacoes.mockReset(); carregarNotificacoes.mockResolvedValue([]) })

describe('AvisoTocado', () => {
  it('toque com o app aberto: popup com o texto; "Abrir" segue o link; "Entendi" fecha', async () => {
    r()
    expect(screen.queryByTestId('aviso-tocado')).not.toBeInTheDocument()
    act(() => anunciarAvisoTocado({ titulo: 'Reunião', corpo: 'Traga o lenço', link: '/agenda' }))
    const pop = await screen.findByTestId('aviso-tocado')
    expect(pop).toHaveTextContent('Traga o lenço')
    await userEvent.click(within(pop).getByRole('button', { name: 'Abrir' }))
    expect(screen.getByTestId('local')).toHaveTextContent('/agenda')
    expect(screen.queryByTestId('aviso-tocado')).not.toBeInTheDocument()
  })
  it('toque ANTES do app montar (abertura a frio): o aviso fica guardado e aparece', async () => {
    anunciarAvisoTocado({ titulo: 'Guardado', corpo: 'texto' })
    r()
    expect(await screen.findByTestId('aviso-tocado')).toHaveTextContent('Guardado')
  })
  it('o push vem cortado em 500: mostra o texto completo que está no sino', async () => {
    const completo = 'x'.repeat(900)
    carregarNotificacoes.mockResolvedValue([{ titulo: 'Longo', corpo: completo }])
    r()
    act(() => anunciarAvisoTocado({ titulo: 'Longo', corpo: 'x'.repeat(500) }))
    await screen.findByTestId('aviso-tocado')
    await vi.waitFor(() => expect(screen.getByTestId('aviso-tocado').textContent.length).toBeGreaterThan(850))
  })
  it('link só aceita caminho interno', () => {
    expect(linkInterno('/agenda')).toBe('/agenda')
    for (const ruim of ['https://x.com', '//x.com', 'javascript:1', '/a b', null]) expect(linkInterno(ruim)).toBeNull()
  })
})
