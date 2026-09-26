import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const signIn = vi.fn()
const update = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signInWithPassword: (...a) => signIn(...a), updateUser: (...a) => update(...a) } } }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ session: { user: { email: 'a@b.com' } } }) }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn() } }))
const { default: TrocarSenha, erroDaNovaSenha } = await import('./TrocarSenha.jsx')

const preencher = async (atual, nova, conf) => {
  const [a, n, c] = document.querySelectorAll('input[autocomplete]')
  if (atual) await userEvent.type(a, atual)
  if (nova) await userEvent.type(n, nova)
  if (conf) await userEvent.type(c, conf)
  await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }))
}

describe('Trocar senha', () => {
  beforeEach(() => { signIn.mockReset(); update.mockReset() })

  it('regras da nova senha', () => {
    expect(erroDaNovaSenha('abc', 'abc')).toMatch(/8 caracteres/)
    expect(erroDaNovaSenha('abcdefgh', 'abcdefgh')).toMatch(/letras e números/)
    expect(erroDaNovaSenha('abcd1234', 'abcd12345')).toMatch(/confirmação/)
    expect(erroDaNovaSenha('abcd1234', 'abcd1234', 'abcd1234')).toMatch(/diferente/)
    expect(erroDaNovaSenha('abcd1234', 'abcd1234', 'velha123')).toBe('')
  })

  it('exige a senha atual e não troca se ela estiver errada', async () => {
    render(<MemoryRouter><TrocarSenha /></MemoryRouter>)
    await preencher('', 'nova12345', 'nova12345')
    expect(screen.getByRole('alert')).toHaveTextContent('senha atual')
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await preencher('errada1', '', '')
    expect(await screen.findByText('A senha atual está incorreta.')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('com a senha atual certa, grava a nova', async () => {
    signIn.mockResolvedValue({ error: null })
    update.mockResolvedValue({ error: null })
    render(<MemoryRouter><TrocarSenha /></MemoryRouter>)
    await preencher('velha123', 'nova12345', 'nova12345')
    expect(signIn).toHaveBeenCalledWith({ email: 'a@b.com', password: 'velha123' })
    expect(update).toHaveBeenCalledWith({ password: 'nova12345' })
  })
})
