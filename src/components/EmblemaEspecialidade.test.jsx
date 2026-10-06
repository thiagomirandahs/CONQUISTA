import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EmblemaEspecialidade, { urlDoEmblema } from './EmblemaEspecialidade.jsx'

describe('EmblemaEspecialidade', () => {
  it('código com imagem: <img> decorativa, preguiçosa, no caminho certo (maiúscula ou minúscula)', () => {
    expect(urlDoEmblema('ap-002')).toBe('/especialidades/ap-002.png')
    expect(urlDoEmblema('HM-044')).toBe('/especialidades/hm-044.jpg')
    render(<EmblemaEspecialidade codigo="AP-002" />)
    const img = screen.getByTestId('emblema-especialidade')
    expect(img).toHaveAttribute('src', '/especialidades/ap-002.png')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })

  it('sem imagem: selo com a sigla da área; com semSelo não desenha nada', () => {
    const { unmount } = render(<EmblemaEspecialidade codigo="ME-001" />)
    expect(screen.getByTestId('emblema-selo')).toHaveTextContent('ME')
    unmount()
    const { container } = render(<EmblemaEspecialidade codigo="XX-999" semSelo />)
    expect(container).toBeEmptyDOMElement()
  })

  it('imagem que falha ao carregar cai no selo', () => {
    render(<EmblemaEspecialidade codigo="AP-002" />)
    fireEvent.error(screen.getByTestId('emblema-especialidade'))
    expect(screen.getByTestId('emblema-selo')).toHaveTextContent('AP')
  })
})
