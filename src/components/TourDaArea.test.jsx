// TourDaArea + fila de popups: tour tem prioridade sobre os outros popups; um por vez; fechar revela o próximo.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TourDaArea from './TourDaArea.jsx'
import { FilaDePopupsProvider, usePopup, esquecerPopupVisto } from '../ui/index.jsx'

function PopupFalso({ id, prioridade }) {
  const { minhaVez, fechar } = usePopup(id, { prioridade, umaVezPorSessao: false })
  if (!minhaVez) return null
  return <div role="dialog" aria-label={id} data-testid={`popup-${id}`}><button type="button" onClick={fechar}>Fechar {id}</button></div>
}

beforeEach(() => { localStorage.clear(); for (const id of ['avisos', 'devocional', 'proximo-evento']) esquecerPopupVisto(id) })

describe('TourDaArea', () => {
  it('Próximo, Voltar, pontos com aria-current e Concluir marca visto', async () => {
    render(<TourDaArea id="classes" uid="u1" forcar={false} />)
    await screen.findByTestId('tour')
    const atual = () => screen.getByRole('listitem', { current: 'step' }).getAttribute('aria-label')
    expect(atual()).toMatch(/^Passo 1/)
    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(atual()).toMatch(/^Passo 2/)
    expect(document.activeElement.textContent).toBe('Requisitos') // foco vai para o título do passo
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(atual()).toMatch(/^Passo 1/)
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull())
    expect(localStorage.getItem('dc:tour-visto:u1:classes')).toBe('1')
  })

  it('Esc = Pular', async () => {
    render(<TourDaArea id="rede" uid="u2" />)
    await screen.findByTestId('tour')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull())
    expect(localStorage.getItem('dc:tour-visto:u2:rede')).toBe('1')
  })

  it('gestão não aparece para desbravador', async () => {
    render(<TourDaArea id="gestao" uid="u3" papel="desbravador" />)
    await act(async () => {})
    expect(screen.queryByTestId('tour')).toBeNull()
  })

  it('já visto não reabre', async () => {
    localStorage.setItem('dc:tour-visto:u4:classes', '1')
    render(<TourDaArea id="classes" uid="u4" />)
    await act(async () => {})
    expect(screen.queryByTestId('tour')).toBeNull()
  })
})

describe('fila de popups com o tour', () => {
  it('tour e aviso elegíveis: só o tour aparece; fechar o tour revela o aviso, fechar o aviso revela o devocional', async () => {
    render(
      <FilaDePopupsProvider>
        <PopupFalso id="devocional" prioridade={10} />
        <PopupFalso id="avisos" prioridade={30} />
        <TourDaArea id="primeiros-passos" uid="u5" />
      </FilaDePopupsProvider>,
    )
    await screen.findByTestId('tour')
    expect(screen.queryByTestId('popup-avisos')).toBeNull()
    expect(screen.queryByTestId('popup-devocional')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }))
    await screen.findByTestId('popup-avisos')
    expect(screen.queryByTestId('popup-devocional')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Fechar avisos' }))
    await screen.findByTestId('popup-devocional')
    expect(screen.queryByTestId('popup-avisos')).toBeNull()
  })
})
