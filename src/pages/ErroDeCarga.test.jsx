// Ranking e Mural: falha de rede NÃO vira "ranking vazio" / "álbum vazio" nem trava em "Carregando…" (auditoria de 05/10/2026).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { ranking: vi.fn(), fotos: vi.fn() }
vi.mock('../lib/dados.js', () => ({
  carregarRanking: (...a) => f.ranking(...a), carregarFotos: (...a) => f.fotos(...a), adicionarFoto: vi.fn(), excluirFoto: vi.fn(),
}))
vi.mock('../lib/juice.js', () => ({ vitoria: vi.fn() }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel: 'desbravador' }) }))
vi.mock('../components/AvisoOffline.jsx', () => ({ default: () => null }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => null }))
vi.mock('../components/Contador.jsx', () => ({ default: ({ valor }) => <span>{valor}</span> }))
vi.mock('../components/ImagemPrivada.jsx', () => ({ default: () => null }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { erro: vi.fn(), sucesso: vi.fn(), info: vi.fn(), confirmar: vi.fn(async () => true) } }))
const { default: Ranking } = await import('./Ranking.jsx')
const { default: Mural } = await import('./Mural.jsx')

beforeEach(() => { f.ranking.mockReset(); f.fotos.mockReset() })

describe('Ranking', () => {
  it('falha: aviso com "Tentar de novo" (nunca "Ranking ainda vazio"); tentar de novo carrega', async () => {
    const u = userEvent.setup()
    f.ranking.mockRejectedValueOnce(new Error('offline'))
    f.ranking.mockResolvedValueOnce({ unidades: [], individual: [] })
    render(<Ranking />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui carregar o ranking')
    expect(screen.queryByText('Ranking ainda vazio')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Ranking ainda vazio')).toBeInTheDocument()
    expect(f.ranking).toHaveBeenCalledTimes(2)
  })
})

describe('Mural', () => {
  it('falha ao carregar as fotos do álbum: aviso e tentar de novo (nunca fica em "Carregando fotos…")', async () => {
    const u = userEvent.setup()
    f.fotos.mockRejectedValueOnce(new Error('offline'))
    f.fotos.mockResolvedValueOnce([])
    render(<Mural />)
    const album = (await screen.findAllByRole('button')).find((b) => /foto\(s\)|fotos?/i.test(b.textContent || '') && !/Voltar/.test(b.getAttribute('aria-label') || ''))
    await u.click(album)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui carregar as fotos')
    expect(screen.queryByText('Carregando fotos...')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(f.fotos).toHaveBeenCalledTimes(2)
  })
})
