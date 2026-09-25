// Landing pública (item 4): só garante que é acessível sem sessão nenhuma e que os dois caminhos
// (criar clube / já tenho conta) apontam pras rotas certas.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from './Landing.jsx'

describe('Landing', () => {
  it('mostra o CTA de criar clube apontando pra /adquirir e o de entrar apontando pra /login', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /quero criar meu clube/i })).toHaveAttribute('href', '/adquirir')
    expect(screen.getByRole('link', { name: /já tenho conta/i })).toHaveAttribute('href', '/login')
  })
})
