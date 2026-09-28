import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../services/catalogoEspecialidades.js', () => ({
  catalogoEspecialidades: () => Promise.resolve({
    especialidades: [
      { codigo: 'AR-050', nome: 'Acampamento I', area: 'AR', area_nome: 'Atividades Recreativas', nivel: 1, ano: 1986, url: 'https://mda.wiki.br/Especialidade_de_Acampamento_I', extinta: false },
      { codigo: 'EN-006', nome: 'Árvores', area: 'EN', area_nome: 'Estudos da Natureza', nivel: 1, ano: 1928, url: 'https://mda.wiki.br/Especialidade_de_%C3%81rvores', extinta: false },
      { codigo: 'EN-099', nome: 'Liquens', area: 'EN', area_nome: 'Estudos da Natureza', nivel: 2, ano: 1950, url: 'https://mda.wiki.br/x', extinta: true },
    ],
    mestrados: [{ codigo: 'ME-009', nome: 'Mestrado em Vida Campestre', minimo: 7, area: null, url: 'https://mda.wiki.br/Mestrado_em_Vida_Campestre', especialidades: ['AR-050'] }],
  }),
}))
const { default: Catalogo } = await import('./CatalogoEspecialidades.jsx')
const abrir = (url = '/catalogo-especialidades') => render(<MemoryRouter initialEntries={[url]}><Catalogo /></MemoryRouter>)

describe('Catálogo de especialidades', () => {
  it('lista as ativas (sem as extintas), com link para os requisitos', async () => {
    abrir()
    expect(await screen.findAllByTestId('especialidade-item')).toHaveLength(2)
    expect(screen.queryByText('Liquens')).toBeNull()
    expect(screen.getAllByRole('link', { name: /Ver requisitos/ })[0]).toHaveAttribute('target', '_blank')
  })
  it('já abre filtrado a partir do requisito (?q=) e busca sem acento', async () => {
    abrir('/catalogo-especialidades?q=arvores')
    expect(await screen.findAllByTestId('especialidade-item')).toHaveLength(1)
    expect(screen.getByText('Árvores')).toBeInTheDocument()
  })
  it('mestrados mostram a regra e as especialidades que contam', async () => {
    abrir()
    await userEvent.click(await screen.findByRole('tab', { name: /Mestrados/ }))
    expect(screen.getByText(/Ter 7 das 1 especialidades da lista/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Vida Campestre/ }))
    expect(screen.getByRole('link', { name: /Acampamento I/ })).toBeInTheDocument()
  })
})

describe('Catálogo: filtro de área', () => {
  it('é um seletor único e filtra pela área escolhida', async () => {
    abrir()
    const sel = await screen.findByTestId('filtro-area')
    expect(sel.tagName).toBe('SELECT')
    await userEvent.selectOptions(sel, 'EN')
    expect(screen.getAllByTestId('especialidade-item')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getAllByTestId('especialidade-item')).toHaveLength(2)
  })
})
