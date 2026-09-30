import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let perfil = { id: 'eu' }
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: perfil }) }))
const { default: Aviso, useEhMeuRequisito } = await import('./AvisoAvaliadorUnico.jsx')

function Sonda({ dono }) { return <p>{useEhMeuRequisito(dono) ? 'meu' : 'de outro'}</p> }

describe('avaliador único (D8: sem exceção, só orientação)', () => {
  it('mostra a orientação operacional clara', () => {
    render(<Aviso />)
    expect(screen.getByRole('note')).toHaveTextContent('Este requisito precisa ser avaliado por outra pessoa autorizada.')
  })
  it('reconhece o requisito da própria pessoa; de outro não', () => {
    render(<Sonda dono="eu" />); expect(screen.getByText('meu')).toBeInTheDocument()
    render(<Sonda dono="outra" />); expect(screen.getByText('de outro')).toBeInTheDocument()
  })
  it('sem usuário no requisito, não presume nada', () => {
    render(<Sonda dono={undefined} />); expect(screen.getByText('de outro')).toBeInTheDocument()
  })
})
