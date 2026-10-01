// Clube escolhido na lista durante o cadastro: o slug vai junto da conta (sem sessão não há pedido).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const signUp = vi.fn()
const signOut = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signUp: (...a) => signUp(...a), signOut: (...a) => signOut(...a) }, storage: { from: vi.fn() }, from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../lib/convite.js', () => ({ lerTokenConvite: () => null, limparConviteDaUrl: () => {} }))
let lista = [{ slug: 'clube-exemplo', nome: 'Clube Exemplo', cidade: 'Recife' }]
vi.mock('../services/vitrine.js', () => ({ clubesDaVitrine: () => Promise.resolve(lista) }))
const { default: Cadastro } = await import('./Cadastro.jsx')

// sem atraso entre teclas: com a CPU cheia (suíte inteira) digitar com o atraso padrão estourava o tempo do teste
const u = userEvent.setup({ delay: null })
async function enviar({ escolher = true } = {}) {
  signUp.mockResolvedValue({ data: { session: null }, error: null })
  render(<MemoryRouter initialEntries={['/cadastro']}><Routes><Route path="/cadastro" element={<Cadastro />} /></Routes></MemoryRouter>)
  await u.type(screen.getByLabelText('Nome completo'), 'Ana Nova')
  await u.type(screen.getByLabelText('E-mail'), 'ana@x.com')
  await u.type(screen.getByLabelText(/Senha/), 'segredo123')
  await u.type(screen.getByLabelText('Data de nascimento'), '2013-05-05')
  if (escolher) {
    await u.type(await screen.findByTestId('cadastro-clube'), 'exemplo')
    await u.click(await screen.findByRole('option', { name: /Clube Exemplo/ }))
  }
  await u.click(screen.getByRole('button', { name: 'Enviar cadastro' }))
  await vi.waitFor(() => expect(signUp).toHaveBeenCalled())
  return signUp.mock.calls[0][0].options.data
}
beforeEach(() => { signUp.mockReset(); signOut.mockReset(); sessionStorage.clear(); lista = [{ slug: 'clube-exemplo', nome: 'Clube Exemplo', cidade: 'Recife' }] })

describe('cadastro escolhendo o clube na lista', () => {
  it('grava entrada_clube_slug no signUp (e nada de papel/clube/status)', async () => {
    const data = await enviar()
    expect(data.entrada_clube_slug).toBe('clube-exemplo')
    for (const k of ['papel', 'role', 'club_id', 'clube', 'status']) expect(data).not.toHaveProperty(k)
    expect(data).not.toHaveProperty('entrada_codigo')
  })
  it('sem escolher clube não grava a chave', async () => {
    expect(await enviar({ escolher: false })).not.toHaveProperty('entrada_clube_slug')
  })
  it('slug fora do formato vindo da vitrine não é gravado', async () => {
    lista = [{ slug: 'Clube Exemplo!', nome: 'Clube Exemplo', cidade: 'Recife' }]
    expect(await enviar()).not.toHaveProperty('entrada_clube_slug')
  })
})
