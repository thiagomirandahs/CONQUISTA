// Acessibilidade (homologação do piloto): todos os campos de Cadastro precisam de label ASSOCIADO
// de verdade. Achado real: Nome/E-mail/Senha/Data/Foto/Função tinham <label> solto, sem htmlFor/id.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signUp: vi.fn() }, storage: { from: vi.fn() }, from: vi.fn() } }))
vi.mock('../lib/convite.js', () => ({ lerTokenConvite: () => null, limparConviteDaUrl: () => {} }))

const { default: Cadastro } = await import('./Cadastro.jsx')

describe('Cadastro — acessibilidade', () => {
  it('todos os campos têm label associado de verdade (getByLabelText funciona)', () => {
    render(<MemoryRouter><Cadastro /></MemoryRouter>)
    expect(screen.getByLabelText('Nome completo')).toBeInTheDocument()
    expect(screen.getByLabelText('Foto de perfil')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText(/Senha/)).toBeInTheDocument()
    expect(screen.getByLabelText('Data de nascimento')).toBeInTheDocument()
    expect(screen.getByLabelText('Função no clube')).toBeInTheDocument()
  })
})

describe('Cadastro — foto de perfil (ZonaUpload)', () => {
  it('usa a zona de upload padrão (input sr-only, só imagem) e mostra o arquivo escolhido', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    render(<MemoryRouter><Cadastro /></MemoryRouter>)
    const input = screen.getByLabelText('Foto de perfil')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input.className).toContain('sr-only')
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'vazio')
    fireEvent.change(input, { target: { files: [new File(['x'], 'eu.jpg', { type: 'image/jpeg' })] } })
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'selecionado')
    expect(screen.getByTestId('zona-upload-nome')).toHaveTextContent('eu.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto' }))
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'vazio')
  })
})
