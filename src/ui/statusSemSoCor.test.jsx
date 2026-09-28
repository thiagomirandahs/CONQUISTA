import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Selo, Aviso } from './index.jsx'
import { Chip } from '../components/admin/AdminUI.jsx'

// Status nunca só por cor: todo tom de estado leva um símbolo (decorativo) além da palavra.
describe('status nunca só por cor', () => {
  it('Selo: símbolo por tom + a palavra continua achável', () => {
    const { container } = render(<><Selo tom="ok">Aprovado</Selo><Selo tom="perigo">Recusado</Selo><Selo tom="atencao">Pendente</Selo><Selo>Neutro</Selo></>)
    expect(screen.getByText('Aprovado')).toBeInTheDocument()
    const icones = [...container.querySelectorAll('[data-icone-tom]')]
    expect(icones.map((i) => i.textContent)).toEqual(['✓', '✕', '!'])
    icones.forEach((i) => expect(i).toHaveAttribute('aria-hidden', 'true'))
  })

  it('Aviso leva símbolo do tom', () => {
    const { container } = render(<Aviso tom="erro" titulo="Deu errado">x</Aviso>)
    expect(container.querySelector('[data-icone-tom="erro"]')).not.toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('Deu errado')
  })

  it('Chip do admin: ponto vira símbolo nos tons de estado', () => {
    render(<Chip tom="ok" ponto>Ativa</Chip>)
    expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true')
  })
})
