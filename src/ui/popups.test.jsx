// FilaDePopupsProvider + usePopup (fase 6.3): dois popups disputando a tela, só um aparece;
// prioridade; fechar libera o próximo; "já visto" na sessão não reabre.
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { FilaDePopupsProvider, usePopup, esquecerPopupVisto, popupJaVisto } from './index.jsx'

function Popup({ id, prioridade, ativo }) {
  const { minhaVez, fechar } = usePopup(id, { prioridade, ativo })
  if (!minhaVez) return null
  return <div role="dialog" aria-label={id}><button onClick={fechar}>fechar {id}</button></div>
}

const tique = () => act(() => new Promise((r) => setTimeout(r, 0)))

beforeEach(() => { sessionStorage.clear() })

describe('usePopup', () => {
  it('dois popups: só o primeiro aparece; fechar libera o segundo', async () => {
    render(<FilaDePopupsProvider><Popup id="avisos" /><Popup id="devocional" /></FilaDePopupsProvider>)
    await tique()
    expect(screen.getByRole('dialog', { name: 'avisos' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'devocional' })).toBeNull()
    fireEvent.click(screen.getByText('fechar avisos'))
    await tique()
    expect(screen.queryByRole('dialog', { name: 'avisos' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'devocional' })).toBeInTheDocument()
  })

  it('prioridade maior entra primeiro mesmo montando depois (pedidos no mesmo render disputam pela prioridade)', async () => {
    // Os três montam no mesmo render: a vez é decidida no fim do tique, então vence a maior prioridade.
    render(<FilaDePopupsProvider><Popup id="a" /><Popup id="b" prioridade={1} /><Popup id="c" prioridade={10} /></FilaDePopupsProvider>)
    await tique()
    expect(screen.getByRole('dialog', { name: 'c' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('fechar c'))
    await tique()
    expect(screen.getByRole('dialog', { name: 'b' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('fechar b'))
    await tique()
    expect(screen.getByRole('dialog', { name: 'a' })).toBeInTheDocument()
  })

  it('fechado uma vez, não reabre na mesma sessão (sessionStorage)', async () => {
    const a = render(<FilaDePopupsProvider><Popup id="tour" /></FilaDePopupsProvider>)
    await tique()
    fireEvent.click(screen.getByText('fechar tour'))
    expect(popupJaVisto('tour')).toBe(true)
    a.unmount()
    render(<FilaDePopupsProvider><Popup id="tour" /><Popup id="outro" /></FilaDePopupsProvider>)
    await tique()
    expect(screen.queryByRole('dialog', { name: 'tour' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'outro' })).toBeInTheDocument()
    esquecerPopupVisto('tour')
    expect(popupJaVisto('tour')).toBe(false)
  })

  it('`ativo: false` não entra na fila; ao ficar ativo pede a vez', async () => {
    function Tela() {
      const [pronto, setPronto] = React.useState(false)
      return <><button onClick={() => setPronto(true)}>carregou</button><Popup id="evento" ativo={pronto} /></>
    }
    render(<FilaDePopupsProvider><Tela /></FilaDePopupsProvider>)
    await tique()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('carregou'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'evento' })).toBeInTheDocument())
  })

  it('desmontar quem está na vez libera o próximo', async () => {
    function Tela() {
      const [mostrar, setMostrar] = React.useState(true)
      return <><button onClick={() => setMostrar(false)}>sumir</button>{mostrar && <Popup id="x" />}<Popup id="y" /></>
    }
    render(<FilaDePopupsProvider><Tela /></FilaDePopupsProvider>)
    await tique()
    expect(screen.getByRole('dialog', { name: 'x' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('sumir'))
    await tique()
    expect(screen.getByRole('dialog', { name: 'y' })).toBeInTheDocument()
  })

  it('sessionStorage quebrado não derruba o hook', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('bloqueado') } })
    try {
      render(<FilaDePopupsProvider><Popup id="z" /></FilaDePopupsProvider>)
      await tique()
      expect(screen.getByRole('dialog', { name: 'z' })).toBeInTheDocument()
      fireEvent.click(screen.getByText('fechar z'))
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      Object.defineProperty(window, 'sessionStorage', original)
    }
  })
})
