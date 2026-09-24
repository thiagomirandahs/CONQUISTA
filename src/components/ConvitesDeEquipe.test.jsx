import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// O formulário de convite de equipe vive dentro da tela de Usuários da liderança. Na UAT da fase 9
// ele derrubava a tela inteira: o `Selecao` recebe pares [valor, rótulo] e recebia objetos. Nenhum
// teste o RENDERIZAVA — só os serviços eram testados. Este é o teste que teria pegado.
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ podeGerir: true, clubeId: 'clube-x' }) }))
vi.mock('../services/equipe.js', () => ({
  convitesDoClube: () => Promise.resolve([]),
  convidarParaEquipe: vi.fn(),
  revogarConvite: vi.fn(),
  meusConvites: () => Promise.resolve([]),
  aceitarConvite: vi.fn(),
}))
const { ConvidarEquipe } = await import('./ConvitesDeEquipe.jsx')

describe('ConvidarEquipe', () => {
  it('renderiza sem quebrar, com os quatro papéis que o convite aceita', () => {
    render(<ConvidarEquipe />)
    const papeis = [...screen.getByTestId('convite-papel').querySelectorAll('option')].map((o) => [o.value, o.textContent])
    expect(papeis).toEqual([
      ['instrutor', 'Instrutor'], ['conselheiro', 'Conselheiro'], ['tesoureiro', 'Tesoureiro'], ['diretoria', 'Diretoria'],
    ])
  })
})
