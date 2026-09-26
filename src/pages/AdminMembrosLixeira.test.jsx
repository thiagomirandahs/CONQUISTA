// /admin › detalhe do clube: limite de membros ajustável e lixeira de inativos. O servidor é quem
// barra (só admin da plataforma); aqui garantimos que a tela mostra uso x limite, a regra, a lista
// "iria para a lixeira" (dry-run), a data prevista do expurgo e que as ações chamam as RPCs certas.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  limiteMembros: vi.fn(), limiteMembrosDefinir: vi.fn(), lixeiraListar: vi.fn(), lixeiraSimular: vi.fn(),
  lixeiraRecuperar: vi.fn(), lixeiraModoClube: vi.fn(), lixeiraConfig: vi.fn(), lixeiraConfigDefinir: vi.fn(),
}
vi.mock('../services/adminMembros.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))

const { LimiteMembrosClube, LixeiraClube } = await import('./AdminMembrosLixeira.jsx')

const LIXEIRA = {
  modo: 'dry_run', modo_proprio: 'dry_run', dias_inatividade: 60, dias_retencao: 90, sem_login_dias: null,
  regra: 'Vai para a lixeira quem, neste clube, não tem vínculo ativo/pendente há 60 dias ou mais.',
  marcacoes: [{ nome: 'Joana P.', papeis: ['desbravador'], motivo: 'vinculo_encerrado', inativo_desde: '2026-07-01T12:00:00Z' }],
  pacotes: [
    { id: 'p1', nome: 'Pedro S.', papeis: ['desbravador'], motivo: 'vinculo_suspenso', inativo_desde: '2026-06-01T12:00:00Z', status: 'na_lixeira',
      arquivado_em: '2026-08-01T12:00:00Z', expurgo_previsto_em: '2026-10-30T12:00:00Z', contagens: { pontos: 3 }, arquivos: 2 },
    { id: 'p2', nome: null, papeis: ['pais'], motivo: 'vinculo_encerrado', status: 'expurgado', expurgado_em: '2026-09-01T12:00:00Z', conta_removida: true },
  ],
  execucoes: [{ quando: '2026-09-26T04:45:00Z', modo: 'dry_run', candidatos: 1, arquivados: 0, expurgados: 0, erros: 0 }],
}

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  confirmar.mockReset()
  f.limiteMembros.mockResolvedValue({ uso: 20, limite_plano: 20, limite_efetivo: 20, ajuste: null, regra: 'Conta vínculo ATIVO, exceto responsável (pais).' })
  f.limiteMembrosDefinir.mockResolvedValue({ ok: true, limite_efetivo: 50, uso: 20 })
  f.lixeiraListar.mockResolvedValue(LIXEIRA)
  f.lixeiraSimular.mockResolvedValue({ candidatos: 1 })
  f.lixeiraRecuperar.mockResolvedValue({ ok: true, restauradas: 5 })
  f.lixeiraModoClube.mockResolvedValue({ ok: true })
  f.lixeiraConfig.mockResolvedValue({ modo: 'dry_run', dias_inatividade: 60, dias_retencao: 90, sem_login_dias: null, clubes: [] })
  f.lixeiraConfigDefinir.mockResolvedValue({})
})

describe('Limite de membros', () => {
  it('mostra uso x limite, a regra e o aviso de limite atingido', async () => {
    render(<LimiteMembrosClube clubId="c1" />)
    expect(await screen.findByTestId('limite-uso')).toHaveTextContent('20 de 20')
    expect(screen.getByText(/novas entradas barradas/)).toBeInTheDocument()
    expect(screen.getByText(/exceto responsável/)).toBeInTheDocument()
  })

  it('ajustar exige motivo e chama a RPC com número', async () => {
    const u = userEvent.setup()
    render(<LimiteMembrosClube clubId="c1" />)
    await screen.findByTestId('limite-uso')
    await u.type(screen.getByLabelText('Novo limite só deste clube'), '50')
    expect(screen.getByTestId('limite-salvar')).toBeDisabled()
    await u.type(screen.getByLabelText('Motivo (vai para a auditoria)'), 'clube cresceu')
    await u.click(screen.getByTestId('limite-salvar'))
    expect(f.limiteMembrosDefinir).toHaveBeenCalledWith('c1', 50, 'clube cresceu')
  })

  it('com ajuste: mostra o teto do plano e deixa voltar a ele', async () => {
    f.limiteMembros.mockResolvedValue({ uso: 20, limite_plano: 20, limite_efetivo: 50, ajuste: { valor: 50, motivo: 'cresceu', definido_em: '2026-09-26T10:00:00Z' }, regra: 'r' })
    const u = userEvent.setup()
    render(<LimiteMembrosClube clubId="c1" />)
    expect(await screen.findByText('Ajustado pelo admin')).toBeInTheDocument()
    await u.click(screen.getByTestId('limite-remover'))
    expect(f.limiteMembrosDefinir).toHaveBeenCalledWith('c1', null, null)
  })
})

describe('Lixeira de membros', () => {
  it('mostra o modo, a regra, quem iria (dry-run) e a data prevista do expurgo', async () => {
    render(<LixeiraClube clubId="c1" />)
    expect(await screen.findByTestId('lixeira-regra')).toHaveTextContent('60 dias')
    expect(screen.getAllByText(/Somente listar/).length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('lixeira-marcacoes')).getByText('Joana P.')).toBeInTheDocument()
    const pacotes = screen.getByTestId('lixeira-pacotes')
    expect(within(pacotes).getByText(/Pedro S\./)).toBeInTheDocument()
    expect(within(pacotes).getByText(new Date('2026-10-30T12:00:00Z').toLocaleDateString('pt-BR'))).toBeInTheDocument()
  })

  it('recuperar pede confirmação e chama a RPC', async () => {
    const u = userEvent.setup()
    render(<LixeiraClube clubId="c1" />)
    await screen.findByTestId('lixeira-pacotes')
    confirmar.mockResolvedValueOnce(false)
    await u.click(screen.getByTestId('lixeira-recuperar-p1'))
    expect(f.lixeiraRecuperar).not.toHaveBeenCalled()
    confirmar.mockResolvedValueOnce(true)
    await u.click(screen.getByTestId('lixeira-recuperar-p1'))
    expect(f.lixeiraRecuperar).toHaveBeenCalledWith('p1', 'recuperado pelo admin')
  })

  it('ligar o modo ativo no clube exige confirmação; "atualizar lista" só simula', async () => {
    const u = userEvent.setup()
    render(<LixeiraClube clubId="c1" />)
    await screen.findByTestId('lixeira-regra')
    confirmar.mockResolvedValueOnce(false)
    await u.selectOptions(screen.getByLabelText('Modo neste clube'), 'ativo')
    expect(f.lixeiraModoClube).not.toHaveBeenCalled()
    await u.selectOptions(screen.getByLabelText('Modo neste clube'), 'desligado')
    expect(f.lixeiraModoClube).toHaveBeenCalledWith('c1', 'desligado')
    await u.click(screen.getByTestId('lixeira-simular'))
    expect(f.lixeiraSimular).toHaveBeenCalledWith('c1')
  })
})

describe('Mensagem para a diretoria quando o clube está cheio', () => {
  it('traduz o erro do servidor mantendo o número do limite', async () => {
    const { mensagemDeErro } = await import('../ui/index.jsx')
    const msg = mensagemDeErro(new Error('O clube atingiu o limite de 300 membros do plano (300 ativos; responsáveis não contam). Nada foi removido'), 'Não consegui aprovar.')
    expect(msg).toContain('Não consegui aprovar.')
    expect(msg).toContain('limite de 300 membros')
    expect(mensagemDeErro(new Error('sem permissão'))).toMatch(/liderança/)
  })
})
