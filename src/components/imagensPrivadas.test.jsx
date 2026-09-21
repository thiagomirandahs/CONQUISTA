import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const BASE = 'https://proj.supabase.co/storage/v1/object'
const pub = (p) => `${BASE}/public/imagens/${p}`

let createSignedUrls
vi.mock('../lib/supabase.js', () => ({
  supabase: { storage: { from: () => ({ createSignedUrls: (...a) => createSignedUrls(...a) }) } },
}))

let Avatar, ImagemPrivada, imagens
beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  createSignedUrls = vi.fn(async (caminhos) => ({
    data: caminhos.map((p) => ({ path: p, signedUrl: `${BASE}/sign/imagens/${p}?token=ok`, error: null })),
    error: null,
  }))
  imagens = await import('../lib/imagens.js')
  imagens._reiniciarImagens()
  Avatar = (await import('./Avatar.jsx')).default
  ImagemPrivada = (await import('./ImagemPrivada.jsx')).default
})

describe('Avatar com foto do bucket privado', () => {
  it('mostra a inicial enquanto assina e depois a foto com a URL ASSINADA (nunca a pública)', async () => {
    render(<Avatar foto={pub('perfis/u1-1.jpg')} nome="Ana" />)
    expect(screen.getByText('A')).toBeInTheDocument()
    const img = await screen.findByRole('img', { name: 'Ana' })
    expect(img.getAttribute('src')).toBe(`${BASE}/sign/imagens/perfis/u1-1.jpg?token=ok`)
    expect(document.querySelector(`img[src^="${BASE}/public/"]`)).toBeNull()
  })

  it('se a foto assinada não abrir, cai nas iniciais (sem imagem quebrada)', async () => {
    render(<Avatar foto={pub('perfis/u1-1.jpg')} nome="Ana" />)
    const img = await screen.findByRole('img', { name: 'Ana' })
    fireEvent.error(img)
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Ana' })).toBeNull())
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('se a assinatura falhar (ex.: front novo antes do SQL), usa a URL original guardada no banco', async () => {
    createSignedUrls = vi.fn(async () => ({ data: null, error: { message: 'negado' } }))
    render(<Avatar foto={pub('perfis/u1-1.jpg')} nome="Ana" />)
    const img = await screen.findByRole('img', { name: 'Ana' })
    expect(img.getAttribute('src')).toBe(pub('perfis/u1-1.jpg'))
  })

  it('URL fora do bucket (externa) aparece na hora, sem assinar', () => {
    render(<Avatar foto="https://exemplo.com/a.jpg" nome="Bia" />)
    expect(screen.getByRole('img', { name: 'Bia' }).getAttribute('src')).toBe('https://exemplo.com/a.jpg')
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('sem foto: emoji/inicial como sempre, sem tocar no Storage', () => {
    render(<Avatar nome="Caio" />)
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('uma lista de avatares vira UMA chamada de assinatura', async () => {
    render(<div>{['a', 'b', 'c', 'd'].map((k) => <Avatar key={k} foto={pub(`perfis/${k}-1.jpg`)} nome={`N${k}`} />)}</div>)
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(4))
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
  })
})

describe('ImagemPrivada (mural, emblema, bandeira)', () => {
  it('reserva o espaço com uma caixa neutra e troca pela imagem assinada', async () => {
    const { container } = render(<ImagemPrivada src={pub('mural/u1-1.jpg')} alt="foto" className="w-full h-full" />)
    expect(container.querySelector('span[aria-hidden]')).not.toBeNull()
    const img = await screen.findByRole('img', { name: 'foto' })
    expect(img.getAttribute('src')).toContain('/sign/imagens/mural/u1-1.jpg')
    expect(img).toHaveClass('w-full')
  })

  it('imagem que não abre volta para a caixa neutra', async () => {
    const { container } = render(<ImagemPrivada src={pub('mural/u1-1.jpg')} alt="foto" />)
    fireEvent.error(await screen.findByRole('img', { name: 'foto' }))
    await waitFor(() => expect(container.querySelector('span[aria-hidden]')).not.toBeNull())
  })

  it('sem src não renderiza nada', () => {
    const { container } = render(<ImagemPrivada src={null} alt="x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('URL local (blob: da prévia) passa direto', () => {
    render(<ImagemPrivada src="blob:http://localhost/xyz" alt="prévia" />)
    expect(screen.getByRole('img', { name: 'prévia' }).getAttribute('src')).toBe('blob:http://localhost/xyz')
    expect(createSignedUrls).not.toHaveBeenCalled()
  })
})
