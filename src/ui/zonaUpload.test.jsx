// ZonaUpload (fase 6.3): os cinco estados, o input escondido mas acessível, remover/trocar.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ZonaUpload } from './index.jsx'

beforeAll(() => {
  // jsdom não tem createObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:previa')
  URL.revokeObjectURL = vi.fn()
})

const foto = () => new File(['x'], 'minha-foto.jpg', { type: 'image/jpeg' })

describe('ZonaUpload', () => {
  it('vazio: caixa tracejada, input acessível com rótulo, accept e capture', () => {
    render(<ZonaUpload rotulo="Foto de comprovação" obrigatorio aoEscolher={() => {}} capture="environment" />)
    const input = screen.getByLabelText('Foto de comprovação (obrigatória)')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).toHaveAttribute('capture', 'environment')
    expect(input.className).toContain('sr-only')
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'vazio')
    expect(screen.getByText('Adicionar foto')).toBeInTheDocument()
    expect(screen.getByTestId('zona-upload').querySelector('label').className).toMatch(/border-dashed/)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('escolher um arquivo chama aoEscolher com o File', () => {
    const f = vi.fn()
    render(<ZonaUpload aoEscolher={f} />)
    const input = screen.getByLabelText('Foto')
    const arq = foto()
    fireEvent.change(input, { target: { files: [arq] } })
    expect(f).toHaveBeenCalledWith(arq)
  })

  it('selecionado: miniatura, nome do arquivo, "Trocar" e botão Remover', () => {
    const rem = vi.fn()
    render(<ZonaUpload arquivo={foto()} aoEscolher={() => {}} aoRemover={rem} />)
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'selecionado')
    expect(screen.getByTestId('zona-upload-nome')).toHaveTextContent('minha-foto.jpg')
    expect(screen.getByTestId('zona-upload').querySelector('img')).toHaveAttribute('src', 'blob:previa')
    expect(screen.getByText('Trocar foto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto' }))
    expect(rem).toHaveBeenCalledTimes(1)
  })

  it('enviando: progresso em texto, input travado, sem Remover, anunciado', () => {
    render(<ZonaUpload arquivo={foto()} aoEscolher={() => {}} aoRemover={() => {}} estado="enviando" progresso={42} />)
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByLabelText('Foto')).toBeDisabled()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Enviando 42%')
  })

  it('enviando com progresso em texto livre', () => {
    render(<ZonaUpload arquivo={foto()} aoEscolher={() => {}} estado="enviando" progresso="Comprimindo…" />)
    expect(screen.getByText('Comprimindo…')).toBeInTheDocument()
  })

  it('erro: mensagem humana, alert, "Tentar de novo", aria-invalid', () => {
    render(<ZonaUpload arquivo={foto()} aoEscolher={() => {}} estado="erro" erro="A foto é grande demais." />)
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'erro')
    expect(screen.getByRole('alert')).toHaveTextContent('A foto é grande demais.')
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument()
    expect(screen.getByLabelText('Foto')).toHaveAttribute('aria-invalid', 'true')
  })

  it('concluído: "Enviado" e ainda dá para remover', () => {
    const rem = vi.fn()
    render(<ZonaUpload arquivo={foto()} aoEscolher={() => {}} aoRemover={rem} estado="concluido" />)
    expect(screen.getByText('Enviado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeInTheDocument()
  })

  it('previaUrl (foto já salva) conta como selecionado, sem File', () => {
    render(<ZonaUpload previaUrl="https://x/foto.jpg" aoEscolher={() => {}} />)
    expect(screen.getByTestId('zona-upload')).toHaveAttribute('data-estado', 'selecionado')
    expect(screen.getByTestId('zona-upload').querySelector('img')).toHaveAttribute('src', 'https://x/foto.jpg')
  })

  it('accept que não é imagem: textos de "arquivo"', () => {
    render(<ZonaUpload accept="application/pdf" rotulo="Documento" aoEscolher={() => {}} />)
    expect(screen.getByText('Adicionar arquivo')).toBeInTheDocument()
    expect(screen.getByLabelText('Documento')).toHaveAttribute('accept', 'application/pdf')
  })
})
