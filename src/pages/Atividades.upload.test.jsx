// Entrega de atividade: o anexo usa a ZonaUpload (fase 9) e preserva o comportamento antigo —
// foto/vídeo aceitos, limite de 50 MB com mensagem amigável, arquivo livre quando não exige foto.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../lib/supabase.js', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } } }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({}) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({}) }))

const { EntregarModal } = await import('./Atividades.jsx')

beforeAll(() => { URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn() })

const atividade = (criterios) => ({ id: 'a1', titulo: 'Nó básico', descricao: 'Faça', pontos: 10, criterios })
const abrir = (c) => render(<EntregarModal atividade={atividade(c)} onFechar={() => {}} onConfirmar={vi.fn()} />)

describe('EntregarModal — anexo com ZonaUpload', () => {
  it('foto exigida: aceita imagem e vídeo, input sr-only', () => {
    abrir({ foto: true })
    const input = screen.getByLabelText('Foto ou vídeo de comprovação')
    expect(input).toHaveAttribute('accept', 'image/*,video/*')
    expect(input.className).toContain('sr-only')
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'vazio')
  })

  it('sem foto exigida: arquivo livre (sem filtro de imagem)', () => {
    abrir({ arquivo: true })
    expect(screen.getByLabelText('Arquivo')).toHaveAttribute('accept', '*/*')
  })

  it('arquivo grande demais mostra erro amigável e não anexa', () => {
    abrir({ foto: true })
    const grande = new File(['x'], 'v.mp4', { type: 'video/mp4' })
    Object.defineProperty(grande, 'size', { value: 80 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('Foto ou vídeo de comprovação'), { target: { files: [grande] } })
    expect(screen.getByText(/grande demais/)).toBeInTheDocument()
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'vazio')
  })

  it('foto escolhida aparece como selecionada e pode ser removida', () => {
    abrir({ foto: true })
    fireEvent.change(screen.getByLabelText('Foto ou vídeo de comprovação'), { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'selecionado')
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto' }))
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'vazio')
  })

  it('vídeo escolhido ganha player de prévia', () => {
    const { container } = abrir({ foto: true })
    fireEvent.change(screen.getByLabelText('Foto ou vídeo de comprovação'), { target: { files: [new File(['x'], 'v.mp4', { type: 'video/mp4' })] } })
    expect(container.querySelector('video')).not.toBeNull()
  })
})
