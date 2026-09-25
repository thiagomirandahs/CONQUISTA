// /admin — painel da OPERAÇÃO da plataforma. O guard real é o servidor (eh_admin_plataforma());
// estes testes garantem que o FRONT nunca desenha o painel antes da resposta do servidor confirmar
// isso, e que as ações administrativas (transição de assinatura, revogar suporte) chamam as MESMAS
// RPCs já auditadas da Fase 5 — nenhuma nova.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const souAdminPlataforma = vi.fn()
const contasListar = vi.fn()
const provisionamentoPendencias = vi.fn()
const provisionamentoReexecutar = vi.fn()
const assinaturaTransicionar = vi.fn()
const suporteListar = vi.fn()
const suporteRevogar = vi.fn()
const auditoriaListar = vi.fn()
vi.mock('../services/admin.js', () => ({
  souAdminPlataforma: (...a) => souAdminPlataforma(...a),
  contasListar: (...a) => contasListar(...a),
  provisionamentoPendencias: (...a) => provisionamentoPendencias(...a),
  provisionamentoReexecutar: (...a) => provisionamentoReexecutar(...a),
  assinaturaTransicionar: (...a) => assinaturaTransicionar(...a),
  suporteListar: (...a) => suporteListar(...a),
  suporteRevogar: (...a) => suporteRevogar(...a),
  auditoriaListar: (...a) => auditoriaListar(...a),
}))

const carregarPlanos = vi.fn()
vi.mock('../services/comercial.js', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, carregarPlanos: (...a) => carregarPlanos(...a) }
})

const { default: Admin } = await import('./Admin.jsx')

const CONTA = {
  conta_id: 'conta-1', nome: 'Conta do Clube A', status: 'ativa',
  assinatura: { id: 'sub-1', status: 'ativa', plano_nome: 'Padrão v1' },
  clubes: [{ club_id: 'clube-1', nome: 'Clube A', membros: 12, provisionamento: 'ok' }],
  cobrancas_abertas: 0,
}

beforeEach(() => {
  souAdminPlataforma.mockReset()
  contasListar.mockReset().mockResolvedValue([])
  provisionamentoPendencias.mockReset().mockResolvedValue([])
  provisionamentoReexecutar.mockReset()
  assinaturaTransicionar.mockReset()
  suporteListar.mockReset().mockResolvedValue([])
  suporteRevogar.mockReset()
  auditoriaListar.mockReset().mockResolvedValue([])
  carregarPlanos.mockReset().mockResolvedValue([])
})

describe('Admin: guard — nunca mostra o painel sem confirmação do servidor', () => {
  it('não-admin: vê "área restrita", nunca as RPCs administrativas', async () => {
    souAdminPlataforma.mockResolvedValue(false)
    render(<Admin />)
    expect(await screen.findByText('Área restrita')).toBeInTheDocument()
    expect(contasListar).not.toHaveBeenCalled()
    expect(provisionamentoPendencias).not.toHaveBeenCalled()
  })

  it('erro ao verificar (ex.: RPC falhou): trata como NÃO-admin, nunca abre o painel', async () => {
    souAdminPlataforma.mockRejectedValue(new Error('falhou'))
    render(<Admin />)
    expect(await screen.findByText('Área restrita')).toBeInTheDocument()
  })

  it('admin de verdade: painel abre e carrega Visão geral', async () => {
    souAdminPlataforma.mockResolvedValue(true)
    contasListar.mockResolvedValue([CONTA])
    provisionamentoPendencias.mockResolvedValue([])
    render(<Admin />)
    expect(await screen.findByText('Administração DesbravaClube')).toBeInTheDocument()
    expect(await screen.findByTestId('visao-contas')).toHaveTextContent('1')
  })
})

describe('Admin: Contas e transição de assinatura', () => {
  it('lista contas e permite transicionar status com motivo obrigatório', async () => {
    souAdminPlataforma.mockResolvedValue(true)
    contasListar.mockResolvedValue([CONTA])
    render(<Admin />)
    await userEvent.click(await screen.findByText('Contas'))
    await userEvent.click(await screen.findByText('Conta do Clube A'))

    // sem motivo: recusa, NUNCA chama a RPC
    await userEvent.selectOptions(screen.getByTestId('assinatura-status'), 'suspensa')
    await userEvent.click(screen.getByTestId('confirmar-transicao'))
    expect(assinaturaTransicionar).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText(/Motivo/), 'Inadimplência confirmada')
    await userEvent.click(screen.getByTestId('confirmar-transicao'))
    expect(assinaturaTransicionar).toHaveBeenCalledWith('sub-1', 'suspensa', 'Inadimplência confirmada')
  })
})

describe('Admin: Suporte — admin nunca autoriza o próprio pedido', () => {
  it('mostra o aviso de que autorizar aqui não concede acesso real', async () => {
    souAdminPlataforma.mockResolvedValue(true)
    render(<Admin />)
    await userEvent.click(await screen.findByText('Suporte'))
    expect(await screen.findByText(/não concede acesso real/)).toBeInTheDocument()
    // nenhum botão "Autorizar" existe nesta tela — só a liderança do clube autoriza (fora deste painel)
    expect(screen.queryByText('Autorizar')).toBeNull()
  })

  it('revogar chama suporte_revogar', async () => {
    souAdminPlataforma.mockResolvedValue(true)
    suporteListar.mockResolvedValue([{ id: 'g1', motivo: 'Investigar erro relatado', status: 'solicitado' }])
    render(<Admin />)
    await userEvent.click(await screen.findByText('Suporte'))
    await userEvent.click(await screen.findByText('Revogar'))
    expect(suporteRevogar).toHaveBeenCalledWith('g1', expect.any(String))
  })
})

describe('Admin: Planos — somente leitura', () => {
  it('não existe nenhum botão de editar/salvar plano', async () => {
    souAdminPlataforma.mockResolvedValue(true)
    carregarPlanos.mockResolvedValue([{ chave: 'padrao', versao: 1, nome: 'Padrão', provisorio: true, precos: [] }])
    render(<Admin />)
    await userEvent.click(await screen.findByText('Planos'))
    expect(await screen.findByText('PROVISÓRIO')).toBeInTheDocument()
    expect(screen.queryByText('Salvar')).toBeNull()
    expect(screen.queryByText('Editar')).toBeNull()
  })
})
