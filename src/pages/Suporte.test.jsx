// Central de chamados (migration 290) — tela do usuário. O servidor decide o acesso; aqui garantimos o
// fluxo: lista, abrir chamado (com contexto técnico sem segredo), conversa e reabrir.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const f = {
  meusChamados: vi.fn(), chamadoAbrir: vi.fn(), chamadoVer: vi.fn(), chamadoResponder: vi.fn(),
  enviarAnexo: vi.fn(), urlDoAnexo: vi.fn(),
}
vi.mock('../services/suporte.js', async () => {
  const real = await vi.importActual('../services/suporte.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))
let papel = 'desbravador'
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ marca: { nome: 'Clube Teste' }, papel }) }))

const { default: Suporte } = await import('./Suporte.jsx')
const { resumirAparelho, contextoTecnico, validarAnexo, tempoDesde } = await vi.importActual('../services/suporte.js')

const abrir = (rota = '/suporte') => render(
  <MemoryRouter initialEntries={[rota]}><Routes><Route path="/suporte" element={<Suporte />} /></Routes></MemoryRouter>)

beforeEach(() => {
  Object.values(f).forEach((m) => m.mockReset())
  papel = 'desbravador'
  f.urlDoAnexo.mockResolvedValue('https://x/assinada')
})

describe('Suporte (usuário)', () => {
  it('lista os meus chamados com status', async () => {
    f.meusChamados.mockResolvedValue([{ id: 'c1', assunto: 'App trava', categoria: 'problema', status: 'aguardando_usuario', atualizado_em: '2026-09-26T10:00:00Z' }])
    abrir()
    expect(await screen.findByText('App trava')).toBeInTheDocument()
    expect(screen.getByText('Aguardando você')).toBeInTheDocument()
  })

  it('abre chamado com categoria, assunto e contexto técnico (sem prioridade para não-diretoria)', async () => {
    f.meusChamados.mockResolvedValue([])
    f.chamadoAbrir.mockResolvedValue('novo-id')
    f.chamadoVer.mockResolvedValue({ id: 'novo-id', assunto: 'Dúvida X', categoria: 'duvida', status: 'aberto', mensagens: [], pode_responder: true })
    const u = userEvent.setup()
    abrir()
    await u.click(await screen.findByTestId('novo-chamado'))
    expect(screen.queryByLabelText(/Prioridade sugerida/)).toBeNull()
    await u.selectOptions(screen.getByLabelText('Categoria'), 'duvida')
    await u.type(screen.getByLabelText('Assunto'), 'Dúvida X')
    await u.type(screen.getByLabelText(/Descreva/), 'Como faço para trocar de unidade?')
    await u.click(screen.getByRole('button', { name: /Enviar chamado/ }))
    expect(f.chamadoAbrir).toHaveBeenCalledTimes(1)
    const arg = f.chamadoAbrir.mock.calls[0][0]
    expect(arg).toMatchObject({ categoria: 'duvida', assunto: 'Dúvida X', prioridadeSugerida: null, anexo: null })
    expect(arg.contexto).toMatchObject({ clube: 'Clube Teste', papel: 'desbravador' })
    expect(JSON.stringify(arg.contexto)).not.toMatch(/token|senha|password/i)
  })

  it('valida campos antes de enviar', async () => {
    f.meusChamados.mockResolvedValue([])
    const u = userEvent.setup()
    abrir()
    await u.click(await screen.findByTestId('novo-chamado'))
    await u.click(screen.getByRole('button', { name: /Enviar chamado/ }))
    expect(screen.getByText('Escolha uma categoria.')).toBeInTheDocument()
    expect(f.chamadoAbrir).not.toHaveBeenCalled()
  })

  it('diretoria vê prioridade sugerida', async () => {
    papel = 'diretoria'
    f.meusChamados.mockResolvedValue([])
    const u = userEvent.setup()
    abrir()
    await u.click(await screen.findByTestId('novo-chamado'))
    expect(screen.getByLabelText(/Prioridade sugerida/)).toBeInTheDocument()
  })

  it('conversa: mostra mensagens do suporte e reabre chamado resolvido', async () => {
    f.meusChamados.mockResolvedValue([])
    f.chamadoVer.mockResolvedValue({
      id: 'c1', assunto: 'App trava', categoria: 'problema', status: 'resolvido', criado_em: '2026-09-25T10:00:00Z', pode_responder: true,
      mensagens: [
        { id: 'm1', origem: 'usuario', texto: 'Trava no ranking', criado_em: '2026-09-25T10:00:00Z' },
        { id: 'm2', origem: 'suporte', texto: 'Corrigido na versão nova', anexo_path: 'u/a.png', criado_em: '2026-09-25T11:00:00Z' },
      ],
    })
    f.chamadoResponder.mockResolvedValue(null)
    const u = userEvent.setup()
    abrir('/suporte?chamado=c1')
    expect(await screen.findByText('Corrigido na versão nova')).toBeInTheDocument()
    expect(await screen.findByAltText('Anexo do chamado')).toHaveAttribute('src', 'https://x/assinada')
    await u.type(screen.getByLabelText(/reabrir/i), 'Voltou a travar')
    await u.click(screen.getByRole('button', { name: 'Reabrir e enviar' }))
    expect(f.chamadoResponder).toHaveBeenCalledWith('c1', 'Voltou a travar', null)
  })

  it('chamado encerrado não oferece resposta', async () => {
    f.meusChamados.mockResolvedValue([])
    f.chamadoVer.mockResolvedValue({ id: 'c1', assunto: 'Velho', categoria: 'outro', status: 'fechado', pode_responder: false, mensagens: [] })
    abrir('/suporte?chamado=c1')
    expect(await screen.findByText('Chamado encerrado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Enviar resposta/ })).toBeNull()
  })
})

describe('utilitários do suporte', () => {
  it('resume o aparelho sem expor o user-agent inteiro', () => {
    expect(resumirAparelho('Mozilla/5.0 (Linux; Android 14; SM-A515F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'))
      .toEqual({ sistema: 'Android 14', navegador: 'Chrome' })
    const ctx = contextoTecnico({ clube: 'C', papel: 'pais', rota: '/x' })
    expect(Object.keys(ctx).sort()).toEqual(['app', 'clube', 'navegador', 'papel', 'rota', 'sistema', 'tela', 'versao'])
  })
  it('valida anexo (tipo e tamanho)', () => {
    expect(validarAnexo({ type: 'application/pdf', size: 10 })).toMatch(/imagem/)
    expect(validarAnexo({ type: 'image/png', size: 4 * 1024 * 1024 })).toMatch(/3 MB/)
    expect(validarAnexo({ type: 'image/png', size: 1000 })).toBeNull()
  })
  it('tempo desde', () => {
    const agora = Date.parse('2026-09-26T12:00:00Z')
    expect(tempoDesde('2026-09-26T11:30:00Z', agora)).toBe('30 min')
    expect(tempoDesde('2026-09-26T09:00:00Z', agora)).toBe('3 h')
    expect(tempoDesde('2026-09-20T12:00:00Z', agora)).toBe('6 d')
  })
})
