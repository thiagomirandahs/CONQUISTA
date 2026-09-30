import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const carregar = vi.fn()
vi.mock('../../services/leituras.js', () => ({ carregarLeituras: (...a) => carregar(...a), salvarProgressoLeitura: vi.fn().mockResolvedValue({}) }))
vi.mock('../../services/audiolivros.js', () => ({ audiolivros: () => Promise.resolve([{ id: 'al1', titulo: 'Vaso', capitulos: [{ ordem: 1, titulo: 'Capítulo 1', video_id: 'video000001' }] }]) }))
const { default: Card, limparCacheLivroDaClasse } = await import('./CardLivroDaClasse.jsx')

const base = { autor: 'Autor', tipo: 'livro_classe', ano: null, capa_url: null, tem_audio: false, audiolivro_id: null, audio_url: null,
  book_url: null, book_rotulo: 'Ver livro', pdf_url: null, na_minha_classe: true, progresso: null }
const AMIGO = { ...base, id: 'a', titulo: 'Vaso de Barro', classe_manifesto: 'amigo', book_url: 'https://loja.exemplo/v', book_rotulo: 'Ler', tem_audio: true, audiolivro_id: 'al1',
  progresso: { capitulo: 1, posicao_seg: 75, duracao_seg: 100, concluido: false, ultima_em: '2026-09-29T00:00:00Z' } }
const GUIA = { ...base, id: 'b', titulo: 'O Livro Amargo', classe_manifesto: 'guia' }

beforeEach(() => { limparCacheLivroDaClasse(); carregar.mockReset().mockResolvedValue([AMIGO, GUIA]); localStorage.clear() })

describe('CardLivroDaClasse', () => {
  it('mostra o livro da classe, com capa-placeholder e botões condicionais', async () => {
    render(<Card classeManifesto="amigo" userId="u1" />)
    expect(await screen.findByText('Vaso de Barro')).toBeInTheDocument()
    expect(screen.getByTestId('capa-placeholder')).toBeInTheDocument()
    const ler = screen.getByRole('link', { name: /Ler/ })
    expect(ler).toHaveAttribute('href', 'https://loja.exemplo/v')
    expect(ler).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('button', { name: /Ouvir audiobook/ })).toBeInTheDocument()
    expect(screen.getByText('Você já começou a ouvir.')).toBeInTheDocument()
  })

  it('sem link e sem áudio não mostra botões; sem livro para a classe não renderiza nada', async () => {
    const { container, rerender } = render(<Card classeManifesto="guia" userId="u1" />)
    expect(await screen.findByText('O Livro Amargo')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: /Ouvir/ })).toBeNull()
    rerender(<Card classeManifesto="pioneiro" userId="u1" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('usa uma leitura só por sessão e abre o player ao tocar em Ouvir', async () => {
    const { unmount } = render(<Card classeManifesto="amigo" userId="u1" />)
    await userEvent.click(await screen.findByRole('button', { name: /Ouvir audiobook/ }))
    expect(await screen.findByTestId('player-audio')).toBeInTheDocument()
    expect(await screen.findByText(/Você parou em: Capítulo 1 · 1:15/)).toBeInTheDocument()
    unmount()
    render(<Card classeManifesto="guia" userId="u1" />)
    await screen.findByText('O Livro Amargo')
    expect(carregar).toHaveBeenCalledTimes(1)
    expect(carregar).toHaveBeenCalledWith('minha_classe')
  })
})
