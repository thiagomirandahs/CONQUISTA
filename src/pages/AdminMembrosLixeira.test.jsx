// /admin › detalhe do clube: LIMITE DE MEMBROS ajustável. A lixeira de inativos foi desligada
// (migration 310): não há mais modo, simulação nem expurgo na tela — só "recuperar" algum pacote
// antigo, e o cartão nem aparece quando não há nenhum.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { limiteMembros: vi.fn(), limiteMembrosDefinir: vi.fn(), lixeiraListar: vi.fn(), lixeiraRecuperar: vi.fn() }
vi.mock('../services/adminMembros.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))

const { LimiteMembrosClube, PacotesGuardados } = await import('./AdminMembrosLixeira.jsx')

const LIXEIRA = {
  pacotes: [
    { id: 'p1', nome: 'Pedro S.', papeis: ['desbravador'], motivo: 'vinculo_suspenso', inativo_desde: '2026-06-01T12:00:00Z', status: 'na_lixeira',
      arquivado_em: '2026-08-01T12:00:00Z', expurgo_previsto_em: '2026-10-30T12:00:00Z', contagens: { pontos: 3 }, arquivos: 2 },
    { id: 'p2', nome: null, papeis: ['pais'], motivo: 'vinculo_encerrado', status: 'expurgado', expurgado_em: '2026-09-01T12:00:00Z', conta_removida: true },
  ],
}

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  confirmar.mockReset()
  f.limiteMembros.mockResolvedValue({ uso: 20, limite_plano: 20, limite_efetivo: 20, ajuste: null, regra: 'Conta vínculo ATIVO, exceto responsável (pais).' })
  f.limiteMembrosDefinir.mockResolvedValue({ ok: true, limite_efetivo: 50, uso: 20 })
  f.lixeiraListar.mockResolvedValue(LIXEIRA)
  f.lixeiraRecuperar.mockResolvedValue({ ok: true, restauradas: 5 })
})

describe('Lixeira de membros desligada', () => {
  it('sem pacote guardado: não mostra nada de lixeira', async () => {
    f.lixeiraListar.mockResolvedValue({ pacotes: [] })
    const { container } = render(<PacotesGuardados clubId="c1" />)
    await vi.waitFor(() => expect(f.lixeiraListar).toHaveBeenCalledWith('c1'))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/expurgo|Modo neste clube|Iria para a lixeira/i)).toBeNull()
  })

  it('com pacote antigo: só oferece recuperar (com confirmação)', async () => {
    const u = userEvent.setup()
    render(<PacotesGuardados clubId="c1" />)
    expect(await screen.findByText('Pedro S.')).toBeInTheDocument()
    expect(screen.queryByText(/apagado de vez/i)).toBeNull()
    confirmar.mockResolvedValueOnce(false)
    await u.click(screen.getByTestId('recuperar-p1'))
    expect(f.lixeiraRecuperar).not.toHaveBeenCalled()
    confirmar.mockResolvedValueOnce(true)
    await u.click(screen.getByTestId('recuperar-p1'))
    expect(f.lixeiraRecuperar).toHaveBeenCalledWith('p1', 'recuperado pelo admin')
  })
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

describe('Mensagem para a diretoria quando o clube está cheio', () => {
  it('traduz o erro do servidor mantendo o número do limite', async () => {
    const { mensagemDeErro } = await import('../ui/index.jsx')
    const msg = mensagemDeErro(new Error('O clube atingiu o limite de 300 membros do plano (300 ativos; responsáveis não contam). Nada foi removido'), 'Não consegui aprovar.')
    expect(msg).toContain('Não consegui aprovar.')
    expect(msg).toContain('limite de 300 membros')
    expect(mensagemDeErro(new Error('sem permissão'))).toMatch(/liderança/)
  })
})
