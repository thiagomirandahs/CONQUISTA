// Folha (bottom sheet / diálogo): acessibilidade de teclado — Esc, foco inicial, devolução do foco e,
// achado da validação visual de 30/09, TRAP de Tab (aria-modal promete que o foco não escapa).
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Folha } from './index.jsx'

function Cena({ aoFechar = () => {} }) {
  const [aberta, setAberta] = useState(false)
  return (
    <div>
      <button onClick={() => setAberta(true)}>abrir</button>
      <button>fora-1</button>
      <Folha aberta={aberta} aoFechar={() => { aoFechar(); setAberta(false) }} titulo="Avisos">
        <button>primeiro</button>
        <button>ultimo</button>
      </Folha>
    </div>
  )
}

const abrir = async () => { await userEvent.click(screen.getByText('abrir')) }

describe('Folha: teclado e foco', () => {
  it('abre como diálogo modal nomeado e leva o foco para dentro', async () => {
    render(<Cena />)
    await abrir()
    const d = screen.getByRole('dialog', { name: 'Avisos' })
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(d)
  })

  it('Tab circula só dentro da folha: do último volta ao primeiro (nunca escapa para a página)', async () => {
    render(<Cena />)
    await abrir()
    await userEvent.tab() // ✕ Fechar
    await userEvent.tab() // primeiro
    await userEvent.tab() // ultimo
    expect(document.activeElement).toHaveTextContent('ultimo')
    await userEvent.tab() // deveria voltar ao ✕, não sair
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toHaveAccessibleName('Fechar')
    expect(document.activeElement).not.toHaveTextContent('fora-1')
  })

  it('Shift+Tab a partir do primeiro item vai para o último (circular)', async () => {
    render(<Cena />)
    await abrir()
    await userEvent.tab() // ✕ Fechar (primeiro focável)
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toHaveTextContent('ultimo')
  })

  it('o botão invisível do fundo não entra na ordem do teclado (o ✕ já fecha)', async () => {
    render(<Cena />)
    await abrir()
    const fundos = screen.getAllByRole('button', { name: 'Fechar', hidden: true })
    expect(fundos.some((b) => b.getAttribute('tabindex') === '-1')).toBe(true)
  })

  it('Esc fecha e devolve o foco a quem abriu', async () => {
    const aoFechar = vi.fn()
    render(<Cena aoFechar={aoFechar} />)
    const gatilho = screen.getByText('abrir')
    gatilho.focus()
    await userEvent.click(gatilho)
    await userEvent.keyboard('{Escape}')
    expect(aoFechar).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(gatilho)
  })
})
