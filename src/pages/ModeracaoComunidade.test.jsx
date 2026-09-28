// Moderação da Comunidade (diretoria): a fila do próprio clube, decisões chamando a RPC certa, e quem
// denunciou nunca aparece (o servidor não manda; a tela também não inventa).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { filaModeracao: vi.fn(), moderar: vi.fn(), encerrarSuspensao: vi.fn(), urlDaFoto: vi.fn() }
vi.mock('../services/comunidade.js', async () => {
  const real = await vi.importActual('../services/comunidade.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))

const { default: ModeracaoComunidade } = await import('./ModeracaoComunidade.jsx')

const agora = new Date().toISOString()
const FILA = {
  denuncias: [{ tipo: 'post', id: 'p1', texto: 'texto denunciado', autor: 'Ana Clara Souza', criado_em: agora, status: 'oculto_denuncia', denuncias: 2, motivos: ['ofensivo'] }],
  fotos: [{ tipo: 'post', id: 'p2', texto: 'nossa unidade', foto: 'c/u/f.jpg', autor: 'Rui Lima', criado_em: agora, status: 'em_analise' }],
  suspensos: [{ usuario_id: 'u9', nome: 'Léo Alves', ate: agora }],
  historico: [{ acao: 'ocultado_por_denuncia', via: 'sistema', por: 'Sistema', quando: agora }],
}

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.filaModeracao.mockResolvedValue(FILA)
  f.moderar.mockResolvedValue({ ok: true })
  f.encerrarSuspensao.mockResolvedValue({ ok: true })
  f.urlDaFoto.mockResolvedValue('blob:x')
})

describe('Moderação da Comunidade', () => {
  it('mostra a denúncia com contagem e motivo, e restaura', async () => {
    const u = userEvent.setup()
    render(<ModeracaoComunidade />)
    expect(await screen.findByText('texto denunciado')).toBeInTheDocument()
    expect(screen.getByText('🚩 2 denúncias')).toBeInTheDocument()
    expect(screen.getByText('Escondido')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Restaurar' }))
    expect(f.moderar).toHaveBeenCalledWith('post', 'p1', 'restaurar')
  })

  it('remove de vez', async () => {
    const u = userEvent.setup()
    render(<ModeracaoComunidade />)
    await screen.findByText('texto denunciado')
    await u.click(screen.getByRole('button', { name: 'Remover de vez' }))
    expect(f.moderar).toHaveBeenCalledWith('post', 'p1', 'remover')
  })

  it('aprova foto em análise', async () => {
    const u = userEvent.setup()
    render(<ModeracaoComunidade />)
    await screen.findByText('texto denunciado')
    await u.click(screen.getByRole('tab', { name: /Fotos/ }))
    expect(await screen.findByAltText('Foto para revisar')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(f.moderar).toHaveBeenCalledWith('post', 'p2', 'aprovar_foto')
  })

  it('encerra a pausa de um membro', async () => {
    const u = userEvent.setup()
    render(<ModeracaoComunidade />)
    await screen.findByText('texto denunciado')
    await u.click(screen.getByRole('tab', { name: /Pausados/ }))
    await u.click(await screen.findByRole('button', { name: 'Encerrar' }))
    expect(f.encerrarSuspensao).toHaveBeenCalledWith('u9')
  })

  it('sem permissão: mensagem humana', async () => {
    f.filaModeracao.mockRejectedValue(new Error('Sem permissão (apenas a diretoria do clube).'))
    render(<ModeracaoComunidade />)
    expect(await screen.findByRole('alert')).toHaveTextContent('liderança')
  })
})
