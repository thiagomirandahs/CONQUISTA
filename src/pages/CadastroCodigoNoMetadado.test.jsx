// O código do clube viaja COM A CONTA (user_metadata.entrada_codigo), não só no navegador: a
// confirmação de e-mail pode abrir em OUTRO navegador/aparelho, onde sessionStorage e `?proximo=`
// não existem. O servidor continua sendo quem valida o código e decide papel/clube.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const signUp = vi.fn()
const signOut = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signUp: (...a) => signUp(...a), signOut: (...a) => signOut(...a) }, storage: { from: vi.fn() }, from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../lib/convite.js', () => ({ lerTokenConvite: () => null, limparConviteDaUrl: () => {} }))
vi.mock('../services/vitrine.js', () => ({ clubesDaVitrine: () => Promise.resolve([]) }))
const { default: Cadastro } = await import('./Cadastro.jsx')

const CODIGO = 'AB12CD34EF56AB78'
const q = (volta) => `?proximo=${encodeURIComponent(volta)}`

async function enviar(inicio, { sessao = false } = {}) {
  signUp.mockResolvedValue({ data: { session: sessao ? { user: { id: 'u1' } } : null }, error: null })
  render(
    <MemoryRouter initialEntries={[inicio]}>
      <Routes>
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/entrar" element={<p>pedido-de-entrada</p>} />
      </Routes>
    </MemoryRouter>,
  )
  await userEvent.type(screen.getByLabelText('Nome completo'), 'Ana Nova')
  await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
  await userEvent.type(screen.getByLabelText(/Senha/), 'segredo123')
  const nasc = screen.queryByLabelText('Data de nascimento')   // coordenação não pede
  if (nasc) await userEvent.type(nasc, '2013-05-05')
  await userEvent.click(screen.getByRole('button', { name: /Enviar cadastro|Criar conta/ }))
  await vi.waitFor(() => expect(signUp).toHaveBeenCalled())
  return signUp.mock.calls[0][0].options.data
}

beforeEach(() => { signUp.mockReset(); signOut.mockReset(); sessionStorage.clear() })

describe('cadastro com código do clube: o código vai junto da conta', () => {
  it('grava entrada_codigo no signUp (via ?proximo=)', async () => {
    const data = await enviar(`/cadastro${q(`/entrar?codigo=${CODIGO}&pedir=1`)}`)
    expect(data.entrada_codigo).toBe(CODIGO)
  })

  it('grava também quando o retorno só existe no sessionStorage do navegador', async () => {
    sessionStorage.setItem('pos-login-retorno', `/entrar?codigo=${CODIGO.toLowerCase()}&pedir=1`)
    const data = await enviar('/cadastro')
    expect(data.entrada_codigo).toBe(CODIGO)
  })

  it('NÃO envia papel, clube nem status (o cliente não escolhe nada disso)', async () => {
    const data = await enviar(`/cadastro${q(`/entrar?codigo=${CODIGO}&pedir=1`)}`)
    for (const k of ['papel', 'role', 'club_id', 'clube', 'status', 'organizational_unit_id']) expect(data).not.toHaveProperty(k)
  })

  it('cadastro SEM código não grava a chave', async () => {
    const data = await enviar('/cadastro')
    expect(data).not.toHaveProperty('entrada_codigo')
  })

  it('formato inválido não é gravado (tamanho, caracteres, injeção)', async () => {
    for (const ruim of ['abc', 'A'.repeat(64), 'AB12 CD34', '<script>alert(1)</script>', "AB12CD34'; drop table x;--"]) {
      signUp.mockReset(); document.body.innerHTML = ''
      const data = await enviar(`/cadastro${q(`/entrar?codigo=${encodeURIComponent(ruim)}&pedir=1`)}`)
      expect(data).not.toHaveProperty('entrada_codigo')
    }
  })

  it('retorno que não é a porta de entrada (coordenação) não grava código', async () => {
    const data = await enviar(`/cadastro${q(`/coordenacao?codigo=${CODIGO}`)}`)
    expect(data).not.toHaveProperty('entrada_codigo')
  })
})
