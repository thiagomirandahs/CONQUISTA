import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../services/audiolivros.js', () => ({
  audiolivros: () => Promise.resolve([{
    id: 'l1', titulo: 'Vaso de Barro', canal: 'Canal X', autor: 'Fulano',
    capitulos: [{ ordem: 1, titulo: 'Capítulo 1', video_id: 'AAAAAAAAAAA' }, { ordem: 2, titulo: 'Capítulo 2', video_id: 'BBBBBBBBBBB' }],
  }]),
}))
const { default: OuvirLivro } = await import('./OuvirLivro.jsx')

describe('Ouvir o livro', () => {
  beforeEach(() => localStorage.clear())

  it('não aparece em requisito sem livro do catálogo', async () => {
    render(<OuvirLivro descricao='Ler o livro do Curso de Leitura do ano.' userId="u" />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('ouvir-livro')).toBeNull()
  })

  it('toca pelo player sem cookie, avança de capítulo e lembra onde parou', async () => {
    const { unmount } = render(<OuvirLivro descricao='Ler o livro da classe: "Vaso de Barro".' userId="u" />)
    await userEvent.click(await screen.findByRole('button', { name: /Ouvir o livro/ }))
    await userEvent.click(screen.getByTestId('ouvir-tocar'))
    expect(document.querySelector('iframe').src).toMatch(/youtube-nocookie\.com\/embed\/AAAAAAAAAAA/)
    await userEvent.click(screen.getByTestId('ouvir-terminei'))
    expect(document.querySelector('iframe').src).toMatch(/BBBBBBBBBBB/)
    unmount()

    render(<OuvirLivro descricao='Ler o livro da classe: "Vaso de Barro".' userId="u" />)
    expect(await screen.findByText('1 de 2 capítulos ouvidos')).toBeInTheDocument()
  })

  it('deixa CLARA a origem: conteúdo de terceiros, título, autor e canal', async () => {
    render(<OuvirLivro descricao='Ler o livro da classe: "Vaso de Barro".' userId="u" />)
    await userEvent.click(await screen.findByRole('button', { name: /Ouvir o livro/ }))
    const origem = screen.getByTestId('ouvir-origem').textContent
    expect(origem).toMatch(/não produzido pelo DesbravaClube/)
    expect(origem).toMatch(/Vaso de Barro/)
    expect(origem).toMatch(/Fulano/)
    expect(origem).toMatch(/canal Canal X/)
    expect(origem).toMatch(/não substitui o que o requisito pede/)
  })
})
