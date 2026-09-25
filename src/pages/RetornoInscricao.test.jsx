// O código do clube não se perde entre cadastro e login: `?proximo=` na URL (e o retorno guardado)
// levam de volta ao pedido de entrada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const signUp = vi.fn()
const signInWithPassword = vi.fn()
const signOut = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signUp: (...a) => signUp(...a), signInWithPassword: (...a) => signInWithPassword(...a), signOut: (...a) => signOut(...a) }, storage: { from: vi.fn() }, from: vi.fn() } }))
vi.mock('../lib/convite.js', () => ({ lerTokenConvite: () => null, limparConviteDaUrl: () => {} }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ marca: { nome: 'DesbravaClube', sigla: 'DC', logoUrl: '/icon-192.png' } }) }))
const { default: Cadastro } = await import('./Cadastro.jsx')
const { default: Login } = await import('./Login.jsx')

const VOLTA = '/entrar?codigo=AB12CD34EF56AB78&pedir=1'
const Q = `?proximo=${encodeURIComponent(VOLTA)}`

function montar(inicio) {
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <Routes>
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/login" element={<Login />} />
        <Route path="/entrar" element={<p>pedido-de-entrada</p>} />
        <Route path="/ranking" element={<p>ranking</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { signUp.mockReset(); signInWithPassword.mockReset(); signOut.mockReset(); sessionStorage.clear() })

describe('cadastro vindo do link do clube', () => {
  it('cria a conta e segue direto para o pedido de entrada (sem logout, sem procurar o link de novo)', async () => {
    signUp.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    montar(`/cadastro${Q}`)
    await userEvent.type(screen.getByLabelText('Nome completo'), 'Ana Nova')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText(/Senha/), 'segredo123')
    await userEvent.type(screen.getByLabelText('Data de nascimento'), '2013-05-05')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))
    expect(await screen.findByText('pedido-de-entrada')).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('o link "Entrar" do cadastro leva o mesmo retorno para o login', () => {
    montar(`/cadastro${Q}`)
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', `/login${Q}`)
  })

  it('cadastro comum (sem link de clube) continua como antes: sai e mostra o próximo passo', async () => {
    signUp.mockResolvedValue({ data: { session: { user: { id: 'u2' } } }, error: null })
    montar('/cadastro')
    await userEvent.type(screen.getByLabelText('Nome completo'), 'Bia')
    await userEvent.type(screen.getByLabelText('E-mail'), 'bia@x.com')
    await userEvent.type(screen.getByLabelText(/Senha/), 'segredo123')
    await userEvent.type(screen.getByLabelText('Data de nascimento'), '2013-05-05')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar cadastro' }))
    expect(await screen.findByText(/Sua conta está pronta/)).toBeInTheDocument()
    expect(signOut).toHaveBeenCalled()
  })
})

describe('login vindo do link do clube', () => {
  it('depois de entrar, volta para o pedido de entrada (mesmo sem nada guardado na sessão do navegador)', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null })
    montar(`/login${Q}`)
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('pedido-de-entrada')).toBeInTheDocument()
  })

  it('"Cadastre-se" no login mantém o retorno', () => {
    montar(`/login${Q}`)
    expect(screen.getByRole('link', { name: 'Cadastre-se' })).toHaveAttribute('href', `/cadastro${Q}`)
  })

  it('um retorno para fora do site é ignorado (sem redirecionamento aberto)', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null })
    montar(`/login?proximo=${encodeURIComponent('//evil.test/x')}`)
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('ranking')).toBeInTheDocument()
  })
})
