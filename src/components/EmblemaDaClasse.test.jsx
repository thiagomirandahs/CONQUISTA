import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { existsSync } from 'node:fs'
import EmblemaDaClasse, { imagemDaClasse } from './EmblemaDaClasse.jsx'

describe('EmblemaDaClasse (imagem oficial autorizada)', () => {
  it('as 6 regulares têm imagem e o arquivo existe em public/classes', () => {
    for (const n of ['Amigo', 'Companheiro', 'Pesquisador', 'Pioneiro', 'Excursionista', 'Guia']) {
      const url = imagemDaClasse(n)
      expect(url).toBe(`/classes/${n.toLowerCase()}.png`)
      expect(existsSync(`public${url}`)).toBe(true)
    }
  })
  it('a avançada usa a imagem da regular pareada e ganha o selo de estrelas', () => {
    expect(imagemDaClasse('Amigo da Natureza')).toBe('/classes/amigo.png')
    expect(imagemDaClasse('Guia de Exploração')).toBe('/classes/guia.png')
    render(<EmblemaDaClasse nome="Pioneiro de Novas Fronteiras" />)
    expect(screen.getByTestId('emblema-classe')).toHaveAttribute('data-avancada', 'true')
    expect(screen.getByTestId('emblema-detalhe-avancada')).toBeInTheDocument()
  })
  it('regular: sem selo; classe desconhecida ou imagem que falha cai no escudo próprio (SVG)', () => {
    const { unmount } = render(<EmblemaDaClasse nome="Amigo" />)
    expect(screen.getByTestId('emblema-classe')).toHaveAttribute('data-avancada', 'false')
    expect(screen.queryByTestId('emblema-detalhe-avancada')).not.toBeInTheDocument()
    fireEvent.error(screen.getByTestId('emblema-classe').querySelector('img'))
    expect(screen.getByTestId('emblema-classe').tagName.toLowerCase()).toBe('svg')
    unmount()
    render(<EmblemaDaClasse nome="Classe Inventada" />)
    expect(screen.getByTestId('emblema-classe').tagName.toLowerCase()).toBe('svg')
  })
})
