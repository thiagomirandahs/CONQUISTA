import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Foto do admin da plataforma (migration 530): só abre por clique, via Edge Function mediada; nunca pelo Storage direto.
const rpc = vi.fn()
const invoke = vi.fn()
const storageFrom = vi.fn()
vi.mock('../lib/supabase.js', () => ({
  supabase: { rpc: (...a) => rpc(...a), functions: { invoke: (...a) => invoke(...a) }, storage: { from: (...a) => storageFrom(...a) } },
}))
vi.mock('./AdminDesafiosRede.jsx', () => ({ default: () => null }))
vi.mock('./AdminRedeTodosClubes.jsx', () => ({ default: () => null }))
const erro = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: (...a) => erro(...a), info: vi.fn(), confirmar: vi.fn() } }))
const { default: AdminComunidade } = await import('./AdminComunidade.jsx')
const { adminFotoUrl } = await import('../services/comunidade.js')

const painel = {
  clubes_com_recurso: 1, denuncias_pendentes: 0, bloqueios_7d: 0, suspensos: 0, bloqueios: [],
  fila: {
    fotos: [
      { tipo: 'post', id: 'p1', texto: 'Acampamento', foto: 'c/u/f.webp', status: 'em_analise', autor: 'Ana', clube: 'Clube A', criado_em: new Date().toISOString() },
      { tipo: 'comentario', id: 'k1', texto: 'oi', foto: null, status: 'em_analise', autor: 'Bia', clube: 'Clube A', criado_em: new Date().toISOString() },
    ],
    denuncias: [],
  },
}

function preparar() {
  rpc.mockReset().mockImplementation((nome) => Promise.resolve({ data: nome === 'admin_comunidade_painel' ? painel : [], error: null }))
  invoke.mockReset()
  storageFrom.mockReset()
  erro.mockReset()
}

describe('AdminComunidade: foto mediada', () => {
  beforeEach(preparar)

  it('não pede nem assina foto sozinha: sem clique, nenhuma chamada e nenhuma leitura de Storage', async () => {
    render(<AdminComunidade />)
    expect(await screen.findByTestId('ver-foto-p1')).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
    expect(storageFrom).not.toHaveBeenCalled()
  })

  it('só item com foto ganha o botão (comentário não)', async () => {
    render(<AdminComunidade />)
    await screen.findByTestId('ver-foto-p1')
    expect(screen.queryByTestId('ver-foto-k1')).toBeNull()
  })

  it('1 clique = 1 chamada à função mediada (tipo + id) e mostra a imagem; nunca usa Storage direto', async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: 'https://x.test/assinada', expira_em_segundos: 60 }, error: null })
    render(<AdminComunidade />)
    await userEvent.click(await screen.findByTestId('ver-foto-p1'))
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('admin-comunidade-foto', { body: { tipo: 'post', id: 'p1' } })
    expect(await screen.findByAltText('Foto em análise')).toHaveAttribute('src', 'https://x.test/assinada')
    expect(storageFrom).not.toHaveBeenCalled()
  })

  it('o servidor recusa (fora do contexto): avisa e não mostra imagem', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: () => Promise.resolve({ erro: 'Conteúdo não encontrado.' }) } } })
    render(<AdminComunidade />)
    await userEvent.click(await screen.findByTestId('ver-foto-p1'))
    await vi.waitFor(() => expect(erro).toHaveBeenCalled())
    expect(erro.mock.calls[0][0].message).toBe('Conteúdo não encontrado.')
    expect(screen.queryByAltText('Foto em análise')).toBeNull()
  })

  it('fechar a foto some com a imagem; abrir de novo é OUTRA chamada (outro registro)', async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: 'https://x.test/a' }, error: null })
    render(<AdminComunidade />)
    await userEvent.click(await screen.findByTestId('ver-foto-p1'))
    await userEvent.click(await screen.findByRole('button', { name: /Fechar foto/ }))
    expect(screen.queryByAltText('Foto em análise')).toBeNull()
    await userEvent.click(screen.getByTestId('ver-foto-p1'))
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('services/comunidade.adminFotoUrl', () => {
  beforeEach(preparar)

  it('devolve a URL assinada da função', async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: 'https://x.test/u' }, error: null })
    await expect(adminFotoUrl('story', 's1')).resolves.toBe('https://x.test/u')
    expect(invoke).toHaveBeenCalledWith('admin-comunidade-foto', { body: { tipo: 'story', id: 's1' } })
  })
  it('sem URL na resposta: erro claro', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await expect(adminFotoUrl('post', 'p1')).rejects.toThrow(/Não foi possível/)
  })
  it('propaga o erro em português do servidor; sem corpo, a mensagem do cliente', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'falhou', context: { json: () => Promise.resolve({ erro: 'Sem permissão.' }) } } })
    await expect(adminFotoUrl('post', 'p1')).rejects.toThrow('Sem permissão.')
    invoke.mockResolvedValue({ data: null, error: { message: 'rede caiu' } })
    await expect(adminFotoUrl('post', 'p1')).rejects.toThrow('rede caiu')
  })
})
