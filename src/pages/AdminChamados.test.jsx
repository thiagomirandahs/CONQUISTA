// /admin → Chamados (migration 290): fila com filtros, detalhe com contexto, nota interna e status.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  adminChamadosListar: vi.fn(), adminChamadoVer: vi.fn(), adminChamadoResponder: vi.fn(), adminChamadoAtualizar: vi.fn(),
  enviarAnexo: vi.fn(), urlDoAnexo: vi.fn(),
}
vi.mock('../services/suporte.js', async () => {
  const real = await vi.importActual('../services/suporte.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({}) }))

const { default: AdminChamados } = await import('./AdminChamados.jsx')

const item = { id: 'c1', assunto: 'Cobrança duplicada', autor: 'Ana', clube: 'Clube A', categoria: 'pagamento', status: 'aberto',
  prioridade: 'alta', criado_em: new Date(Date.now() - 3 * 3600e3).toISOString(), ultima_msg_origem: 'usuario', meu: false }
const detalhe = { ...item, contexto: { versao: '1.2', rota: '/planos' }, mensagens: [
  { id: 'm1', origem: 'usuario', interna: false, texto: 'Veio duas vezes', autor: 'Ana', criado_em: item.criado_em },
  { id: 'm2', origem: 'suporte', interna: true, texto: 'Checar gateway', autor: 'Dono', criado_em: item.criado_em },
] }

beforeEach(() => {
  Object.values(f).forEach((m) => m.mockReset())
  f.adminChamadosListar.mockResolvedValue([item])
  f.adminChamadoVer.mockResolvedValue(detalhe)
  f.adminChamadoResponder.mockResolvedValue(null)
  f.adminChamadoAtualizar.mockResolvedValue(null)
})

describe('AdminChamados', () => {
  it('mostra a fila com prioridade, clube, categoria e tempo', async () => {
    render(<AdminChamados />)
    expect(await screen.findByText('Cobrança duplicada')).toBeInTheDocument()
    expect(screen.getByText(/Ana · Clube A · Pagamento\/plano/)).toBeInTheDocument()
    expect(screen.getByText('Prioridade Alta')).toBeInTheDocument()
    expect(screen.getByText('há 3 h')).toBeInTheDocument()
    expect(f.adminChamadosListar).toHaveBeenCalledWith('abertos')
  })

  it('troca o filtro', async () => {
    const u = userEvent.setup()
    render(<AdminChamados />)
    await screen.findByText('Cobrança duplicada')
    await u.click(screen.getByRole('button', { name: 'Aguardando usuário' }))
    expect(f.adminChamadosListar).toHaveBeenLastCalledWith('aguardando')
    await u.click(screen.getByRole('button', { name: 'Meus' }))
    expect(f.adminChamadosListar).toHaveBeenLastCalledWith('meus')
  })

  it('detalhe: contexto, nota interna marcada, responder e mudar status', async () => {
    const aoMudar = vi.fn()
    const u = userEvent.setup()
    render(<AdminChamados aoMudarContagem={aoMudar} />)
    await u.click(await screen.findByTestId('chamado-item'))
    expect(await screen.findByText('/planos')).toBeInTheDocument()
    expect(screen.getByTestId('nota-interna')).toHaveTextContent('Checar gateway')

    await u.type(screen.getByLabelText('Mensagem'), 'Estornamos a segunda cobrança.')
    await u.click(screen.getByRole('button', { name: 'Enviar resposta' }))
    expect(f.adminChamadoResponder).toHaveBeenCalledWith('c1', { texto: 'Estornamos a segunda cobrança.', interna: false, anexo: null, status: null })

    await u.click(screen.getByLabelText(/Nota interna/))
    await u.type(screen.getByLabelText('Mensagem'), 'Cliente ok')
    await u.click(screen.getByRole('button', { name: 'Salvar nota' }))
    expect(f.adminChamadoResponder).toHaveBeenLastCalledWith('c1', expect.objectContaining({ interna: true, texto: 'Cliente ok' }))

    await u.selectOptions(screen.getByLabelText('Status'), 'resolvido')
    expect(f.adminChamadoAtualizar).toHaveBeenCalledWith('c1', { status: 'resolvido' })
    await u.click(screen.getByRole('button', { name: 'Assumir chamado' }))
    expect(f.adminChamadoAtualizar).toHaveBeenLastCalledWith('c1', { assumir: true })
    expect(aoMudar).toHaveBeenCalled()
  })
})
