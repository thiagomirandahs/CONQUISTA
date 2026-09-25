// Acessibilidade (homologação do piloto): os campos de E-mail/Senha precisam ter label ASSOCIADO
// de verdade (htmlFor/id) — sem isso, um leitor de tela não anuncia nome nenhum pro campo. Achado
// real: o label era um <div> irmão solto, sem htmlFor nem id no input.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signInWithPassword: vi.fn() } } }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ marca: { nome: 'DesbravaClube', descricao: '', lema: '' } }) }))

const { default: Login } = await import('./Login.jsx')

describe('Login — acessibilidade', () => {
  it('E-mail e Senha têm label associado de verdade (getByLabelText funciona)', () => {
    render(<MemoryRouter><Login /></MemoryRouter>)
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })
})
