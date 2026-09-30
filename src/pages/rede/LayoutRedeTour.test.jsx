// Mini-tour da Rede DBV (Fase 6, item 3): aparece 1x quando a pessoa pode ver a rede, com Próximo/Voltar/
// Pular/Concluir; depois de visto (localStorage por usuário + tour) não volta; sem acesso (pode_ver = false)
// não aparece; entra pela FilaDePopups (um popup por vez), provida pelo próprio LayoutRede.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const f = { meuStatus: vi.fn(), carregarPerfil: vi.fn() }
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/supabase.js', () => ({ definirRedeComoNoTransporte: vi.fn(), supabase: {} }))
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Eu Mesmo' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a', papel: 'desbravador' }) }))
vi.mock('../../components/Notificacoes.jsx', () => ({ default: () => null }))

const { STATUS } = await import('./_testeRede.jsx')
const { default: LayoutRede } = await import('./LayoutRede.jsx')
const { chaveDoTourDaArea, TOURS } = await import('../../lib/tutorial/tours.js')

const CHAVE = chaveDoTourDaArea('eu', 'rede')
const montar = () => render(
  <MemoryRouter initialEntries={['/rede']}>
    <Routes><Route element={<LayoutRede />}><Route path="/rede" element={<p data-testid="feed-falso">feed</p>} /></Route></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.meuStatus.mockResolvedValue({ ...STATUS, unidade_id: 'clube-a' })
  f.carregarPerfil.mockResolvedValue({ id: 'eu', eu: true, nome: 'Eu Mesmo', foto: null })
  localStorage.clear()
  sessionStorage.clear()
})

describe('LayoutRede — mini-tour da Rede DBV', () => {
  it('1ª vez com acesso: o tour abre (passo 1 de 5) e marca "visto" ao aparecer', async () => {
    montar()
    await screen.findByTestId('feed-falso')
    const tour = await screen.findByTestId('tour')
    expect(tour).toHaveAttribute('data-tour', 'rede')
    expect(within(tour).getByText('Passo 1 de 5')).toBeInTheDocument()
    expect(within(tour).getByRole('heading', { name: TOURS.rede.passos[0].titulo })).toBeInTheDocument()
    expect(within(tour).getByRole('button', { name: 'Pular' })).toBeInTheDocument()
    expect(within(tour).getByRole('button', { name: 'Próximo' })).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(CHAVE)).toBe('1'))
  })

  it('Próximo/Voltar andam pelos passos; o último tem Concluir e fecha; alvos ≥ 48 px', async () => {
    const u = userEvent.setup()
    montar()
    const tour = await screen.findByTestId('tour')
    await u.click(within(tour).getByRole('button', { name: 'Próximo' }))
    expect(within(tour).getByText('Passo 2 de 5')).toBeInTheDocument()
    expect(within(tour).getByRole('button', { name: 'Voltar' }).className).toContain('min-h-[48px]')
    await u.click(within(tour).getByRole('button', { name: 'Voltar' }))
    expect(within(tour).getByText('Passo 1 de 5')).toBeInTheDocument()
    for (let i = 0; i < 4; i++) await u.click(within(tour).getByRole('button', { name: 'Próximo' }))
    expect(within(tour).getByText('Passo 5 de 5')).toBeInTheDocument()
    await u.click(within(tour).getByRole('button', { name: 'Concluir' }))
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull())
    expect(localStorage.getItem(CHAVE)).toBe('1')
  })

  it('Pular fecha e não volta ao remontar (já visto neste aparelho)', async () => {
    const u = userEvent.setup()
    const a = montar()
    await u.click(within(await screen.findByTestId('tour')).getByRole('button', { name: 'Pular' }))
    await waitFor(() => expect(screen.queryByTestId('tour')).toBeNull())
    a.unmount()
    montar()
    await screen.findByTestId('feed-falso')
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByTestId('tour')).toBeNull()
  })

  it('já visto (chave no localStorage): não aparece', async () => {
    localStorage.setItem(CHAVE, '1')
    montar()
    await screen.findByTestId('feed-falso')
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByTestId('tour')).toBeNull()
  })

  it('sem acesso (pode_ver = false): tela de "sem acesso" e NENHUM tour', async () => {
    f.meuStatus.mockResolvedValue({ pode_ver: false, motivo: 'recurso_desligado' })
    montar()
    expect(await screen.findByText('A Rede DBV não está liberada')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByTestId('tour')).toBeNull()
    expect(localStorage.getItem(CHAVE)).toBeNull()
  })

  it('enquanto o status não chegou: sem tour (só depois de saber que pode ver)', async () => {
    let soltar
    f.meuStatus.mockImplementation(() => new Promise((r) => { soltar = r }))
    montar()
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByTestId('tour')).toBeNull()
    expect(localStorage.getItem(CHAVE)).toBeNull()
    soltar({ ...STATUS })
    expect(await screen.findByTestId('tour')).toBeInTheDocument()
  })
})
