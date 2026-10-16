// Falha que parece falha (auditoria 16/10/2026): comentários e fotos da Rede não fingem "vazio" nem "carregando para sempre".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { carregarComentarios: vi.fn(), comentar: vi.fn(), assinar: vi.fn() }
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, carregarComentarios: (...a) => f.carregarComentarios(...a), comentar: (...a) => f.comentar(...a) }
})
vi.mock('../../lib/supabase.js', () => ({
  supabase: { storage: { from: () => ({ createSignedUrls: (...a) => f.assinar(...a) }) } },
}))
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn() } }))

const { Comentarios } = await import('./componentes.jsx')
const { useFotoComunidadeComEstado, definirUsuarioComunidade, _reiniciarFotosComunidade } = await import('../../lib/fotosComunidade.js')

const POST = { id: 'p1', crianca: false, clube_id: 'c1', autor: { nome: 'Ana' } }
const STATUS = { pode_ver: true, pode_publicar: true, papel: 'desbravador' }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  _reiniciarFotosComunidade()
  definirUsuarioComunidade('eu')
})

describe('Comentários', () => {
  it('falha ao carregar: aviso com "Tentar de novo" (nunca "Ninguém comentou ainda"); tentar de novo carrega', async () => {
    const u = userEvent.setup()
    f.carregarComentarios.mockRejectedValueOnce(new Error('offline'))
    f.carregarComentarios.mockResolvedValueOnce({ itens: [{ id: 'k1', texto: 'Muito bom!', autor: { nome: 'Bia' } }] })
    render(<Comentarios aberta aoFechar={() => {}} post={POST} status={STATUS} clubeId="c1" aoContar={() => {}} />)
    expect(await screen.findByTestId('comentarios-falha')).toHaveTextContent('Não consegui carregar os comentários')
    expect(screen.queryByText('Ninguém comentou ainda.')).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Muito bom!')).toBeInTheDocument()
    expect(f.carregarComentarios).toHaveBeenCalledTimes(2)
  })

  it('sem comentários de verdade: "Ninguém comentou ainda."', async () => {
    f.carregarComentarios.mockResolvedValue({ itens: [] })
    render(<Comentarios aberta aoFechar={() => {}} post={POST} status={STATUS} clubeId="c1" aoContar={() => {}} />)
    expect(await screen.findByText('Ninguém comentou ainda.')).toBeInTheDocument()
  })
})

describe('foto da Rede (useFotoComunidadeComEstado)', () => {
  it('servidor não liberou: falhou = true (não fica "carregando" para sempre); tentar de novo busca outra vez', async () => {
    f.assinar.mockResolvedValueOnce({ data: [], error: { message: 'negado' } })
    f.assinar.mockResolvedValueOnce({ data: [{ path: 'c1/foto.webp', signedUrl: 'https://x/sign/ok' }], error: null })
    const { result } = renderHook(() => useFotoComunidadeComEstado('c1/foto.webp'))
    await waitFor(() => expect(result.current.falhou).toBe(true))
    expect(result.current.url).toBeNull()
    act(() => { result.current.tentarDeNovo() })
    await waitFor(() => expect(result.current.url).toBe('https://x/sign/ok'))
    expect(result.current.falhou).toBe(false)
    expect(f.assinar).toHaveBeenCalledTimes(2)
  })
})
