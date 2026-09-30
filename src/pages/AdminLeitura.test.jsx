import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { adminLeituraListar: vi.fn(), adminLeituraSalvar: vi.fn(), adminLeituraAuditoria: vi.fn() }
vi.mock('../services/leituras.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
vi.mock('../services/audiolivros.js', () => ({ adminAudiolivros: () => Promise.resolve([{ id: 'al1', titulo: 'Vaso de Barro', capitulos: [] }]) }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn() }
vi.mock('../ui/avisos.jsx', () => ({ avisar: avisos }))
const { default: AdminLeitura } = await import('./AdminLeitura.jsx')

const M = { id: 'm1', chave: 'vaso', titulo: 'Vaso de Barro', autor: 'X', descricao: '', tipo: 'livro_classe', classe_manifesto: 'amigo', ano: null, capa_url: null,
  book_url: null, book_rotulo: 'Ver livro', pdf_url: null, pdf_fonte_licenca: null, audio_url: null, audiolivro_id: 'al1', audio_confirmado: false, audio_fonte: null,
  fonte: null, observacao: null, ordem: 10, ativo: true, revisado: false }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.adminLeituraListar.mockResolvedValue([M])
  f.adminLeituraSalvar.mockResolvedValue({ ok: true, id: 'm1' })
  f.adminLeituraAuditoria.mockResolvedValue([])
  Object.values(avisos).forEach((fn) => fn.mockReset())
})

const editar = async () => { await userEvent.click(await screen.findByRole('button', { name: /Editar Vaso de Barro/ })); return screen.findByTestId('leitura-form') }

describe('AdminLeitura', () => {
  it('mostra o aviso, a lista e os chips de status', async () => {
    render(<AdminLeitura />)
    expect(await screen.findByText(/Só o administrador da plataforma altera o catálogo\. Não cadastre link sem fonte\./)).toBeInTheDocument()
    expect(screen.getByText('No app')).toBeInTheDocument()
    expect(screen.getByText('Sem revisão')).toBeInTheDocument()
    expect(screen.getByText('Áudio não confirmado')).toBeInTheDocument()
  })

  it('salva os campos editados pela RPC', async () => {
    render(<AdminLeitura />)
    const form = await editar()
    await userEvent.type(within(form).getByLabelText(/Link do livro/), 'https://loja.exemplo/vaso')
    await userEvent.click(within(form).getByLabelText('Revisado'))
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar' }))
    expect(f.adminLeituraSalvar).toHaveBeenCalledTimes(1)
    const [id, dados] = f.adminLeituraSalvar.mock.calls[0]
    expect(id).toBe('m1')
    expect(dados).toMatchObject({ book_url: 'https://loja.exemplo/vaso', revisado: true, audiolivro_id: 'al1', ordem: 10 })
    expect(avisos.sucesso).toHaveBeenCalled()
  })

  it('mostra o erro do banco em português e não fecha o formulário', async () => {
    f.adminLeituraSalvar.mockRejectedValue(new Error('O link precisa começar com https://.'))
    render(<AdminLeitura />)
    const form = await editar()
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('O link precisa começar com https://.')).toBeInTheDocument()
    expect(screen.getByTestId('leitura-form')).toBeInTheDocument()
  })

  it('confirmar o áudio exige a fonte (nem chama o servidor sem ela)', async () => {
    render(<AdminLeitura />)
    const form = await editar()
    await userEvent.click(within(form).getByLabelText('Áudio confirmado'))
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/informe a fonte do áudio/i)).toBeInTheDocument()
    expect(f.adminLeituraSalvar).not.toHaveBeenCalled()
    await userEvent.type(within(form).getByLabelText(/Fonte do áudio/), 'Playlist indicada pelo dono')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar' }))
    expect(f.adminLeituraSalvar.mock.calls[0][1]).toMatchObject({ audio_confirmado: true, audio_fonte: 'Playlist indicada pelo dono' })
  })

  it('novo material envia id nulo', async () => {
    render(<AdminLeitura />)
    await userEvent.click(await screen.findByRole('button', { name: 'Novo material' }))
    const form = await screen.findByTestId('leitura-form')
    await userEvent.type(within(form).getByLabelText(/Chave/), 'novo-livro')
    await userEvent.type(within(form).getByLabelText('Título'), 'Novo Livro')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar' }))
    const [id, dados] = f.adminLeituraSalvar.mock.calls[0]
    expect(id).toBeNull()
    expect(dados).toMatchObject({ chave: 'novo-livro', titulo: 'Novo Livro', ativo: false })
  })

  it('auditoria lista quem, quando e antes → depois só dos campos que mudaram', async () => {
    f.adminLeituraAuditoria.mockResolvedValue([{
      id: 1, material_id: 'm1', ator: 'abcdef12-0000', acao: 'editar', em: '2026-09-30T12:00:00Z',
      antes: { ...M, revisado: false, atualizado_em: 'a' }, depois: { ...M, revisado: true, atualizado_em: 'b' },
    }])
    render(<AdminLeitura />)
    const form = await editar()
    await userEvent.click(within(form).getByRole('button', { name: 'Ver auditoria' }))
    expect(f.adminLeituraAuditoria).toHaveBeenCalledWith('m1', 50)
    const aud = await screen.findByTestId('leitura-auditoria')
    expect(aud).toHaveTextContent('revisado: false → true')
    expect(aud.querySelectorAll('li li')).toHaveLength(1)
    expect(aud).toHaveTextContent('abcdef12')
    expect(within(aud).queryByText(/atualizado_em/)).toBeNull()
  })
})
