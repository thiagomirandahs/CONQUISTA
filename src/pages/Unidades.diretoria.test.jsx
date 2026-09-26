// Tela da Unidade: a "diretoria da unidade" (cargos oficiais) aparece em destaque.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../lib/dados.js', () => ({}))
vi.mock('../lib/imagem.js', () => ({}))
vi.mock('../lib/upload.js', () => ({}))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({}) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({}) }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => null }))
vi.mock('../components/AvisoOffline.jsx', () => ({ default: () => null }))
vi.mock('../components/ImagemPrivada.jsx', () => ({ default: () => null }))
vi.mock('../components/CardAniversariantes.jsx', () => ({ default: () => null }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: {} }))
const { DiretoriaDaUnidade } = await import('./Unidades.jsx')

const unidade = { id: 'u1', cor: '#123', membros: [
  { id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Beto' }, { id: 'c', nome: 'Caio' }, { id: 'd', nome: 'Duda' },
] }

describe('DiretoriaDaUnidade', () => {
  it('lista os cargos na ordem oficial, só da própria unidade', () => {
    render(<DiretoriaDaUnidade unidade={unidade} cargos={{
      b: { unidade_id: 'u1', cargo: 'capitao' }, a: { unidade_id: 'u1', cargo: 'conselheiro' },
      c: { unidade_id: 'u1', cargo: 'secretario' }, d: { unidade_id: 'OUTRA', cargo: 'tesoureiro' },
    }} />)
    const itens = within(screen.getByRole('region', { name: 'Diretoria da unidade' })).getAllByRole('listitem')
    expect(itens.map((li) => li.textContent)).toEqual(['🎗️ Conselheiro(a)Ana', '🚩 Capitão/CapitãBeto', '📋 Secretário(a)Caio'])
  })

  it('sem ninguém com cargo, não mostra o bloco', () => {
    const { container } = render(<DiretoriaDaUnidade unidade={unidade} cargos={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
