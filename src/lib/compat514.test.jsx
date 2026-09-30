// COMPATIBILIDADE "frontend NOVO + banco 513" (migration 514 ainda não aplicada): as RPCs novas não existem
// (PostgREST responde PGRST202). As telas novas têm de falhar de forma CONTROLADA (mensagem + "Tentar de novo")
// e as telas antigas não podem quebrar por isso.
import { describe, it, expect, vi } from 'vitest'
import { render as r0, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const render = (ui) => r0(<MemoryRouter>{ui}</MemoryRouter>)

const ausente = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' } }
const rpc = vi.fn(async () => ausente)
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), from: vi.fn(), auth: { getSession: vi.fn() } } }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../services/audiolivros.js', () => ({ audiolivros: () => Promise.resolve([]) }))

describe('frontend novo + banco 513 (sem as RPCs da 514)', () => {
  it('Leituras: mostra erro com "Tentar de novo" e não quebra', async () => {
    const { default: Leituras } = await import('../pages/Leituras.jsx')
    render(<Leituras />)
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })
  it('Minha Jornada: erro controlado', async () => {
    const { default: MinhaJornada } = await import('../pages/MinhaJornada.jsx')
    render(<MinhaJornada />)
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })
  it('Portfólio: erro controlado', async () => {
    const { default: Portfolio } = await import('../pages/Portfolio.jsx')
    render(<Portfolio />)
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })
  it('card de livro na Minha Classe: some em silêncio (não quebra a classe)', async () => {
    const { default: Card } = await import('../components/leitura/CardLivroDaClasse.jsx')
    const { container } = render(<Card classeManifesto="amigo" userId="u1" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe('')
  })
})
