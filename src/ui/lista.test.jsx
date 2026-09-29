// ItemLista / GrupoLista / CabecalhoSecao / Chip (fase 6.3): o que estes testes travam é a
// SEMÂNTICA (link x botão x linha), o alvo de 44px e o nome acessível.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ItemLista, GrupoLista, CabecalhoSecao, Chip } from './index.jsx'

const r = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ItemLista', () => {
  it('com `to` vira Link, dentro de <li>, com 44px', () => {
    r(<GrupoLista titulo="Conta"><ItemLista to="/perfil" icone="🪪" titulo="Meu perfil" descricao="Foto e dados" /></GrupoLista>)
    const link = screen.getByRole('link', { name: /Meu perfil/ })
    expect(link).toHaveAttribute('href', '/perfil')
    expect(link.closest('li')).toBeTruthy()
    expect(link.className).toMatch(/min-h-\[44px\]/)
    expect(screen.getByText('Foto e dados')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Conta' })).toBeInTheDocument()
  })

  it('com `onClick` vira button e chama a ação', () => {
    const f = vi.fn()
    r(<ul><ItemLista onClick={f} icone="🔄" titulo="Atualizar" /></ul>)
    fireEvent.click(screen.getByRole('button', { name: /Atualizar/ }))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('sem `to`/`onClick` é uma linha simples, sem seta', () => {
    const { container } = r(<ul><ItemLista titulo="Só informação" info="42" /></ul>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.textContent).not.toContain('›')
    expect(screen.getByTestId('item-info')).toHaveTextContent('42')
  })

  it('clicável mostra a seta (decorativa); `seta={false}` esconde', () => {
    const a = r(<ul><ItemLista to="/x" titulo="A" /></ul>)
    expect(a.container.textContent).toContain('›')
    expect(a.container.querySelector('[aria-hidden="true"]')).toBeTruthy()
    a.unmount()
    const b = r(<ul><ItemLista to="/x" titulo="B" seta={false} /></ul>)
    expect(b.container.textContent).not.toContain('›')
  })

  it('badge vira Selo com o tom pedido', () => {
    r(<ul><ItemLista titulo="Pendentes" badge="3 novos" tomBadge="atencao" /></ul>)
    const selo = screen.getByText('3 novos').closest('span.rounded-full')
    expect(selo.className).toMatch(/amber/)
  })

  it('desabilitado: link vira botão inerte, não dispara nada', () => {
    const f = vi.fn()
    r(<ul><ItemLista to="/x" titulo="Bloqueado" desabilitado /><ItemLista onClick={f} titulo="Parado" desabilitado /></ul>)
    expect(screen.queryByRole('link')).toBeNull()
    const b = screen.getByRole('button', { name: /Parado/ })
    expect(b).toBeDisabled()
    fireEvent.click(b)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('CabecalhoSecao', () => {
  it('é um h2 com contador anunciado, descrição e ação', () => {
    render(<CabecalhoSecao titulo="Pendentes" descricao="Aguardam você" contador={3} acao={<button>Ver todos</button>} badge="novo" />)
    expect(screen.getByRole('heading', { level: 2, name: /Pendentes/ })).toBeInTheDocument()
    expect(screen.getByLabelText('3 itens')).toHaveTextContent('3')
    expect(screen.getByText('Aguardam você')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver todos' })).toBeInTheDocument()
    expect(screen.getByText('novo')).toBeInTheDocument()
  })
  it('contador 1 é singular', () => {
    render(<CabecalhoSecao titulo="X" contador={1} />)
    expect(screen.getByLabelText('1 item')).toBeInTheDocument()
  })
})

describe('Chip', () => {
  it('interativo: button com aria-pressed e 44px; mostra contador', () => {
    const f = vi.fn()
    render(<Chip selecionado onClick={f} contador={12}>Todos</Chip>)
    const b = screen.getByRole('button', { name: /Todos/ })
    expect(b).toHaveAttribute('aria-pressed', 'true')
    expect(b.className).toMatch(/min-h-\[44px\]/)
    expect(b).toHaveTextContent('(12)')
    fireEvent.click(b)
    expect(f).toHaveBeenCalled()
  })
  it('não selecionado: aria-pressed=false', () => {
    render(<Chip onClick={() => {}}>Ativos</Chip>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })
  it('sem onClick é só uma etiqueta (span)', () => {
    render(<Chip>Etiqueta</Chip>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Etiqueta')).toBeInTheDocument()
  })
})
