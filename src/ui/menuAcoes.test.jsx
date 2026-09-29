// MenuAcoes (fase 6.3): no celular abre como Folha; em tela larga como popover com setas.
// Nos dois: Esc fecha, foco volta ao "⋯", ação de perigo é visivelmente diferente.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MenuAcoes } from './index.jsx'

const acoes = (editar = vi.fn(), apagar = vi.fn()) => ({
  editar, apagar,
  lista: [
    { rotulo: 'Editar', icone: '✏️', onClick: editar },
    { rotulo: 'Apagar', icone: '🗑️', tom: 'perigo', onClick: apagar },
  ],
})

const larga = (sim) => {
  window.matchMedia = (q) => ({ matches: sim && q.includes('768'), addEventListener() {}, removeEventListener() {} })
}
let antes
beforeEach(() => { antes = window.matchMedia; vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { window.matchMedia = antes; vi.useRealTimers() })

describe('MenuAcoes no celular (Folha)', () => {
  beforeEach(() => larga(false))

  it('botão ⋯ tem aria-label e aria-haspopup; abre a folha com as ações', () => {
    const a = acoes()
    render(<MenuAcoes rotulo="Ações da foto" acoes={a.lista} />)
    const b = screen.getByRole('button', { name: 'Ações da foto' })
    expect(b).toHaveAttribute('aria-haspopup')
    expect(b).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(b)
    expect(screen.getByRole('dialog', { name: 'Ações da foto' })).toBeInTheDocument()
    expect(b).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    expect(a.editar).toHaveBeenCalledTimes(1)
  })

  it('ação de perigo é vermelha, fica por último e separada', () => {
    render(<MenuAcoes acoes={[{ rotulo: 'Apagar', tom: 'perigo', onClick() {} }, { rotulo: 'Editar', onClick() {} }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    const lista = screen.getByTestId('menu-acoes-folha')
    const botoes = lista.querySelectorAll('button')
    expect(botoes[0]).toHaveTextContent('Editar')
    expect(botoes[1]).toHaveTextContent('Apagar')
    expect(botoes[1].className).toMatch(/rose/)
    expect(botoes[0].className).not.toMatch(/rose/)
    expect(lista.querySelector('hr')).toBeTruthy()
  })

  it('Esc fecha e o foco volta ao botão ⋯', async () => {
    render(<MenuAcoes acoes={acoes().lista} />)
    const b = screen.getByRole('button', { name: 'Mais ações' })
    b.focus()
    fireEvent.click(b)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(300) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(b)
  })
})

describe('MenuAcoes em tela larga (popover)', () => {
  beforeEach(() => larga(true))

  it('abre um role=menu com menuitems, foco no primeiro', () => {
    render(<MenuAcoes acoes={acoes().lista} />)
    const b = screen.getByRole('button', { name: 'Mais ações' })
    expect(b).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(b)
    const itens = screen.getAllByRole('menuitem')
    expect(itens).toHaveLength(2)
    expect(document.activeElement).toBe(itens[0])
    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(itens[1].className).toMatch(/rose/)
  })

  it('setas movem o foco (com volta), Esc fecha e devolve o foco', () => {
    render(<MenuAcoes acoes={acoes().lista} />)
    const b = screen.getByRole('button', { name: 'Mais ações' })
    fireEvent.click(b)
    const itens = screen.getAllByRole('menuitem')
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(itens[1])
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(itens[0])
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(itens[1])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => { vi.advanceTimersByTime(10) })
    expect(document.activeElement).toBe(b)
  })

  it('clicar numa ação executa e fecha; clicar fora fecha', () => {
    const a = acoes()
    render(<div><p>fora</p><MenuAcoes acoes={a.lista} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Apagar/ }))
    expect(a.apagar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ação desabilitada não executa', () => {
    const f = vi.fn()
    render(<MenuAcoes acoes={[{ rotulo: 'Bloqueada', onClick: f, desabilitada: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Bloqueada/ }))
    expect(f).not.toHaveBeenCalled()
  })
})
