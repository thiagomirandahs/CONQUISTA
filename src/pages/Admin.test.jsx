// /admin — Administração da Plataforma. O guard real é o servidor (eh_admin_plataforma()); estes
// testes garantem que o FRONT nunca desenha o painel antes da confirmação, que a visão é por CLUBE
// (inclusive o fundador, sem conta comercial) e que as ações chamam as RPCs auditadas.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  souAdminPlataforma: vi.fn(), visaoGeral: vi.fn(), clubesListar: vi.fn(), clubeDetalhe: vi.fn(),
  planosAdminListar: vi.fn(), assinaturasListar: vi.fn(), onboardingListar: vi.fn(), planoMudar: vi.fn(),
  provisionamentoPendencias: vi.fn(), provisionamentoReexecutar: vi.fn(), assinaturaTransicionar: vi.fn(),
  suporteListar: vi.fn(), suporteRevogar: vi.fn(), auditoriaListar: vi.fn(),
}
vi.mock('../services/admin.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))

const { default: Admin, formatarBytes } = await import('./Admin.jsx')

const FUNDADOR = {
  club_id: 'c1', nome: 'Filhos da Conquista', slug: 'filhos-da-conquista', status: 'ativo', criado_em: '2026-09-24T21:00:00Z',
  assinatura_id: null, armazenamento_bytes: 700 * 1048576, armazenamento_objetos: 397,
  armazenamento_limite_mb: null, armazenamento_pct: null, armazenamento_situacao: 'sem_limite', membros: 30,
  onboarding_status: null, provisionamento: 'ok',
}
const NOVO = {
  club_id: 'c2', nome: 'Exército da colina', slug: 'exercito-da-colina', status: 'ativo', criado_em: '2026-09-25T11:29:00Z',
  assinatura_id: 's2', assinatura_status: 'trial', ciclo: 'mensal', plano_chave: 'gratuito', plano_versao: 1,
  plano_nome: 'Gratuito', provider: 'mock', armazenamento_bytes: 0, armazenamento_objetos: 0, armazenamento_limite_mb: 10,
  armazenamento_pct: 0, armazenamento_situacao: 'normal', membros: 0, onboarding_status: 'em_andamento', onboarding_etapa: 'identidade',
}
const DETALHE = {
  clube: NOVO, hierarquia: null, limites: [{ chave: 'membros', teto: '20', uso: 0 }], recursos: [],
  vinculos_por_papel: [], assinatura_eventos: [], onboarding: [{ status: 'em_andamento', etapa: 'identidade', atualizado_em: '2026-09-25T11:30:00Z' }],
  provisionamento: { status: 'ok' }, auditoria: [],
}
const PLANOS = [
  { id: 'p1', chave: 'anual', versao: 1, nome: 'Licença Anual', publico: true, status: 'publicado', ativo: true, provisorio: false, limites: { membros: 300 }, recursos: null, assinaturas: 0, precos: [{ ciclo: 'anual', moeda: 'BRL', valor_centavos: 22990, ativo: true, vigente_de: '2026-09-25' }] },
  { id: 'p2', chave: 'gratuito', versao: 1, nome: 'Gratuito', publico: false, status: 'publicado', ativo: true, provisorio: true, limites: { membros: 20 }, recursos: ['chat'], assinaturas: 1, precos: [] },
]

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.visaoGeral.mockResolvedValue({ clubes_total: 2, clubes_ativos: 2, clubes_inativos: 0, onboarding_em_andamento: 1, onboarding_concluidos: 0,
    assinaturas_por_status: { trial: 1 }, planos_total: 6, planos_publicos: 1, armazenamento_total_bytes: 700 * 1048576,
    clubes_proximos_do_limite: 0, clubes_no_limite: 0, provisionamentos_pendentes: 0, eventos_admin_7d: 0, eventos_assinatura_7d: 1 })
  f.clubesListar.mockResolvedValue([FUNDADOR, NOVO])
  f.clubeDetalhe.mockResolvedValue(DETALHE)
  f.planosAdminListar.mockResolvedValue(PLANOS)
  f.assinaturasListar.mockResolvedValue([])
  f.onboardingListar.mockResolvedValue([])
  f.provisionamentoPendencias.mockResolvedValue([])
  f.suporteListar.mockResolvedValue([])
  f.auditoriaListar.mockResolvedValue([])
})

const abrirComoAdmin = async () => { f.souAdminPlataforma.mockResolvedValue(true); render(<Admin />); await screen.findByText('Administração da Plataforma') }

describe('Admin: guard — nunca mostra o painel sem confirmação do servidor', () => {
  it('não-admin: vê "área restrita" e nenhuma RPC administrativa é chamada', async () => {
    f.souAdminPlataforma.mockResolvedValue(false)
    render(<Admin />)
    expect(await screen.findByText('Área restrita')).toBeInTheDocument()
    for (const k of ['visaoGeral', 'clubesListar', 'planosAdminListar', 'assinaturasListar', 'onboardingListar']) expect(f[k]).not.toHaveBeenCalled()
  })

  it('erro ao verificar: trata como NÃO-admin', async () => {
    f.souAdminPlataforma.mockRejectedValue(new Error('falhou'))
    render(<Admin />)
    expect(await screen.findByText('Área restrita')).toBeInTheDocument()
  })

  it('admin: abre na Visão geral com as métricas do servidor', async () => {
    await abrirComoAdmin()
    expect(await screen.findByTestId('visao-clubes')).toHaveTextContent('2')
    expect(screen.getByText('Em onboarding')).toBeInTheDocument()
  })
})

describe('Admin: Clubes', () => {
  it('lista TODOS os clubes, inclusive o fundador sem assinatura, com busca e filtro', async () => {
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Clubes/ }))
    const todos = await screen.findAllByTestId('clube-item')
    expect(todos).toHaveLength(2)
    expect(within(todos[0]).getByText('Sem assinatura')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Buscar clube'), 'colina')
    expect(screen.getAllByTestId('clube-item')).toHaveLength(1)
    await userEvent.clear(screen.getByLabelText('Buscar clube'))
    await userEvent.selectOptions(screen.getByLabelText('Filtro'), 'onboarding')
    const itens = screen.getAllByTestId('clube-item')
    expect(itens).toHaveLength(1)
    expect(within(itens[0]).getByText(/Exército da colina/)).toBeInTheDocument()
  })

  it('detalhe do clube: status da assinatura só muda com motivo (vai para a auditoria)', async () => {
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Clubes/ }))
    await userEvent.click(await screen.findByText(/Exército da colina/))
    expect(f.clubeDetalhe).toHaveBeenCalledWith('c2')
    expect(await screen.findByText('Sem gateway — combinado fora do sistema')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByTestId('assinatura-status'), 'suspensa')
    await userEvent.click(screen.getByTestId('confirmar-transicao'))
    expect(f.assinaturaTransicionar).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Pedido do próprio clube')
    await userEvent.click(screen.getByTestId('confirmar-transicao'))
    expect(f.assinaturaTransicionar).toHaveBeenCalledWith('s2', 'suspensa', 'Pedido do próprio clube')
  })

  it('alterar plano: excedente exige confirmação explícita antes de aplicar', async () => {
    f.planoMudar.mockResolvedValueOnce({ ok: false, precisa_confirmar: true, mensagem: 'O plano escolhido é menor que o uso atual.', excedentes: [{ clube: 'Exército da colina', limite: 'membros', uso: 30, teto: 20 }] })
      .mockResolvedValueOnce({ ok: true })
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Clubes/ }))
    await userEvent.click(await screen.findByText(/Exército da colina/))
    await userEvent.selectOptions(await screen.findByLabelText('Alterar plano'), 'anual|1')
    await userEvent.click(screen.getByText('Aplicar plano'))
    expect(f.planoMudar).toHaveBeenLastCalledWith('s2', 'anual', 1, false)
    expect(await screen.findByText('O plano novo é menor que o uso atual')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Confirmar mesmo assim'))
    expect(f.planoMudar).toHaveBeenLastCalledWith('s2', 'anual', 1, true)
  })
})

describe('Admin: Planos, Assinaturas, Armazenamento', () => {
  it('Planos mostra TODAS as versões (inclusive fora da vitrine) e não tem edição', async () => {
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Planos/ }))
    expect(await screen.findAllByTestId('plano-item')).toHaveLength(2)
    expect(screen.getByText('Fora da vitrine')).toBeInTheDocument()
    expect(screen.queryByText('Salvar')).toBeNull()
    expect(screen.queryByText('Editar')).toBeNull()
  })

  it('Assinaturas nunca mostra pagamento confirmado sem gateway', async () => {
    f.assinaturasListar.mockResolvedValue([{ id: 's2', status: 'trial', ciclo: 'mensal', plano_nome: 'Gratuito', plano_versao: 1, criada_em: '2026-09-25', clubes: [{ club_id: 'c2', nome: 'Exército da colina' }], faturas_pagas_gateway: 0, faturas_abertas: 0 }])
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Assinaturas/ }))
    expect(await screen.findByText('Pagamento não confirmado por gateway')).toBeInTheDocument()
  })

  it('Armazenamento põe quem está no limite primeiro', async () => {
    f.clubesListar.mockResolvedValue([NOVO, { ...FUNDADOR, club_id: 'c3', nome: 'Clube Cheio', armazenamento_situacao: 'atingido', armazenamento_limite_mb: 10, armazenamento_pct: 100 }])
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Armazenamento/ }))
    const itens = await screen.findAllByTestId('armazenamento-item')
    expect(within(itens[0]).getByText('Clube Cheio')).toBeInTheDocument()
    expect(within(itens[0]).getByText('Limite atingido')).toBeInTheDocument()
  })
})

describe('Admin: Suporte — admin nunca autoriza o próprio pedido', () => {
  it('não existe botão Autorizar; revogar chama suporte_revogar', async () => {
    f.suporteListar.mockResolvedValue([{ id: 'g1', motivo: 'Investigar erro relatado', status: 'solicitado' }])
    await abrirComoAdmin()
    await userEvent.click(screen.getByRole('tab', { name: /Suporte/ }))
    expect(await screen.findByText(/não concede acesso real/)).toBeInTheDocument()
    expect(screen.queryByText('Autorizar')).toBeNull()
    await userEvent.click(screen.getByText('Revogar'))
    expect(f.suporteRevogar).toHaveBeenCalledWith('g1', expect.any(String))
  })
})

describe('formatarBytes', () => {
  it('formata em B/KB/MB/GB', () => {
    expect(formatarBytes(0)).toBe('0 B')
    expect(formatarBytes(2048)).toBe('2 KB')
    expect(formatarBytes(700 * 1048576)).toBe('700 MB')
    expect(formatarBytes(10 * 1024 ** 3)).toBe('10,0 GB')
  })
})
