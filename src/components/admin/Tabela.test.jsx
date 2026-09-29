// Tabela do /admin (Fase 6, 5.4/5.6): ordenação com aria-sort, paginação 25/página, vazio e cartões < md.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabela, Paginacao, useOrdenacao, usePaginacao, comparar, contem } from './Tabela.jsx'

const COLUNAS = [
  { chave: 'nome', rotulo: 'Nome', ordenavel: true },
  { chave: 'membros', rotulo: 'Membros', ordenavel: true, alinhar: 'direita' },
  { chave: 'obs', rotulo: 'Obs' },
]
const gerar = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, nome: `Clube ${String(i + 1).padStart(2, '0')}`, membros: (i * 7) % 13 }))

function Harness({ lista, auto = false, cartao }) {
  const { ordenada, ordem, ordenarPor } = useOrdenacao(lista, COLUNAS)
  const pag = usePaginacao(ordenada, 25)
  return (
    <>
      <Tabela colunas={COLUNAS} linhas={pag.fatia} id={(l) => l.id} ordem={ordem} ordenarPor={ordenarPor}
        legenda="Clubes" testidLinha="linha" larga={auto ? undefined : true} cartao={cartao} />
      <Paginacao {...pag} rotulo="clube(s)" />
    </>
  )
}

const cabecalho = (nome) => screen.getByRole('columnheader', { name: new RegExp(nome) })
const nomes = () => screen.getAllByTestId('linha').map((tr) => within(tr).getAllByRole('cell')[0].textContent)

describe('Tabela: ordenação', () => {
  it('toca no cabeçalho: asc → desc, aria-sort acompanha e as linhas reordenam', async () => {
    const lista = [{ id: 'a', nome: 'Beta', membros: 5 }, { id: 'b', nome: 'alfa', membros: 20 }, { id: 'c', nome: 'Gama', membros: 1 }]
    render(<Harness lista={lista} />)
    expect(cabecalho('Nome')).toHaveAttribute('aria-sort', 'none')
    expect(cabecalho('Obs')).not.toHaveAttribute('aria-sort')
    expect(nomes()).toEqual(['Beta', 'alfa', 'Gama'])

    await userEvent.click(within(cabecalho('Nome')).getByRole('button'))
    expect(cabecalho('Nome')).toHaveAttribute('aria-sort', 'ascending')
    expect(nomes()).toEqual(['alfa', 'Beta', 'Gama'])

    await userEvent.click(within(cabecalho('Nome')).getByRole('button'))
    expect(cabecalho('Nome')).toHaveAttribute('aria-sort', 'descending')
    expect(nomes()).toEqual(['Gama', 'Beta', 'alfa'])

    // outra coluna começa crescente e a anterior volta a "none"
    await userEvent.click(within(cabecalho('Membros')).getByRole('button'))
    expect(cabecalho('Membros')).toHaveAttribute('aria-sort', 'ascending')
    expect(cabecalho('Nome')).toHaveAttribute('aria-sort', 'none')
    expect(nomes()).toEqual(['Gama', 'Beta', 'alfa'])
  })

  it('comparar: números por valor, vazio sempre por último, texto pt-BR numérico', () => {
    expect([10, 2, null, 1].sort(comparar)).toEqual([1, 2, 10, null])
    expect(['Clube 10', 'Clube 2', ''].sort(comparar)).toEqual(['Clube 2', 'Clube 10', ''])
    expect(contem('conquista', 'Filhos da CONQUISTA')).toBe(true)
    expect(contem('exercito', 'Exército')).toBe(true)
    expect(contem('', 'x')).toBe(true)
  })
})

describe('Tabela: paginação (25 por página)', () => {
  it('60 linhas = 3 páginas; próxima/anterior e botões desabilitados nas pontas', async () => {
    render(<Harness lista={gerar(60)} />)
    expect(screen.getAllByTestId('linha')).toHaveLength(25)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByText(/1–25 de 60 clube/)).toBeInTheDocument()
    expect(screen.getByLabelText('Página anterior')).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Próxima página'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(nomes()[0]).toBe('Clube 26')

    await userEvent.click(screen.getByLabelText('Próxima página'))
    expect(screen.getAllByTestId('linha')).toHaveLength(10)
    expect(screen.getByText(/51–60 de 60/)).toBeInTheDocument()
    expect(screen.getByLabelText('Próxima página')).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Página anterior'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('até 25 linhas: sem botões de página; lista vazia: sem paginação e tabela sem linhas', () => {
    const { unmount } = render(<Harness lista={gerar(25)} />)
    expect(screen.queryByLabelText('Próxima página')).toBeNull()
    expect(screen.getByText(/1–25 de 25/)).toBeInTheDocument()
    unmount()
    render(<Harness lista={[]} />)
    expect(screen.queryByTestId('paginacao')).toBeNull()
    expect(screen.queryAllByTestId('linha')).toHaveLength(0)
    expect(screen.getByTestId('tabela')).toBeInTheDocument()
  })
})

describe('Tabela: modo cartão (< md)', () => {
  afterEach(() => { delete window.matchMedia })

  it('sem matchMedia (celular) e com `cartao`: desenha cartões, não <table>', () => {
    render(<Harness lista={gerar(3)} auto cartao={(l) => <span>cartão {l.nome}</span>} />)
    expect(screen.queryByTestId('tabela')).toBeNull()
    expect(screen.getAllByTestId('linha')).toHaveLength(3)
    expect(screen.getByText('cartão Clube 01')).toBeInTheDocument()
  })

  it('tela ≥ md (matchMedia): tabela mesmo com `cartao`', () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    render(<Harness lista={gerar(3)} auto cartao={(l) => <span>cartão {l.nome}</span>} />)
    expect(screen.getByTestId('tabela')).toBeInTheDocument()
    expect(screen.queryByText('cartão Clube 01')).toBeNull()
  })

  it('linha clicável abre com clique e com Enter', async () => {
    const abrir = vi.fn()
    render(<Tabela colunas={COLUNAS} linhas={gerar(2)} id={(l) => l.id} legenda="x" testidLinha="linha" larga aoTocarLinha={abrir} />)
    const [l1, l2] = screen.getAllByTestId('linha')
    await userEvent.click(l1)
    l2.focus()
    await userEvent.keyboard('{Enter}')
    expect(abrir.mock.calls.map((c) => c[0].id)).toEqual(['c1', 'c2'])
  })
})
