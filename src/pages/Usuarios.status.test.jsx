// Achado F-R2 da revisão da fase 9.1: desde a migration 80 o servidor só redefine a senha e só
// liga/desliga o modo teste de quem está ATIVO no clube (recusar 'pendente' é de propósito: um
// vínculo pendente nasce de qualquer conta que digita o código). A tela seguia mostrando "🔑 Senha"
// e "🧪 Teste" para todo mundo, e a liderança só descobria a recusa depois de tocar. E o diálogo de
// desativar prometia "Ela não vai mais conseguir entrar", o que deixou de ser verdade: a conta
// entra, e o que ela perde é o acesso a ESTE clube.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let papel = 'diretoria'
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel }) }))
vi.mock('../components/Avatar.jsx', () => ({ default: () => null }))
vi.mock('../components/ConvitesDeEquipe.jsx', () => ({ ConvidarEquipe: () => null }))
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { confirmar: (...a) => confirmar(...a), erro: vi.fn() } }))
const carregarUsuarios = vi.fn()
const inativarMembro = vi.fn()
const reativarMembro = vi.fn()
const listarInativos = vi.fn()
const historicoDoMembro = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarUsuarios: (...a) => carregarUsuarios(...a),
  listarUnidades: async () => [],
  inativarMembro: (...a) => inativarMembro(...a),
  reativarMembro: (...a) => reativarMembro(...a),
  listarInativos: (...a) => listarInativos(...a),
  historicoDoMembro: (...a) => historicoDoMembro(...a),
  resetarSenha: vi.fn(), mudarCargo: vi.fn(), mudarUnidade: vi.fn(), lancarPontosIndividual: vi.fn(),
  excluirUsuario: vi.fn(), definirTesteUsuario: vi.fn(),
  carregarCargosDeUnidade: async () => ({}), definirCargoDeUnidade: vi.fn(),
}))
const { default: Usuarios } = await import('./Usuarios.jsx')

// status como o listar_usuarios devolve (o vínculo ENCERRADO chega como 'rejeitado')
const PESSOAS = [
  { id: 'ativo', nome: 'Ana Ativa', papel: 'desbravador', status: 'ativo', unidade_id: 'u1', teste: false },
  { id: 'pendente', nome: 'Beto Pendente', papel: 'desbravador', status: 'pendente', unidade_id: null, teste: false },
  { id: 'inativo', nome: 'Caio Desativado', papel: 'desbravador', status: 'inativo', unidade_id: 'u1', teste: true },
  { id: 'rejeitado', nome: 'Duda Recusada', papel: 'desbravador', status: 'rejeitado', unidade_id: null, teste: false },
]
// a linha de cada pessoa na lista (o bloco que contém o elemento com o nome dela)
const linha = (elNome) => elNome.closest('.px-3.py-3')

beforeEach(() => {
  papel = 'diretoria'
  carregarUsuarios.mockReset().mockResolvedValue(PESSOAS)
  inativarMembro.mockReset().mockResolvedValue({})
  reativarMembro.mockReset().mockResolvedValue({})
  listarInativos.mockReset().mockResolvedValue([
    { user_id: 'inativo', nome: 'Caio Desativado', status: 'suspenso', inativo_desde: '2026-08-01T12:00:00Z',
      motivo_categoria: 'mudou_cidade_igreja', motivo_texto: 'Foi para Campinas' },
  ])
  historicoDoMembro.mockReset().mockResolvedValue([
    { id: 2, acao: 'reativado', em: '2026-08-10T12:00:00Z', motivo_categoria: null, motivo_texto: null, feito_por_nome: 'Lider A' },
    { id: 1, acao: 'inativado', em: '2026-08-01T12:00:00Z', motivo_categoria: 'faltas', motivo_texto: 'muitas faltas', feito_por_nome: 'Lider A' },
  ])
  confirmar.mockReset().mockResolvedValue(true)
})

describe('Usuários: senha e modo teste só para quem está ativo', () => {
  it('ativo: tem "🔑 Senha" e "🧪 Teste", sem aviso', async () => {
    render(<Usuarios />)
    const l = linha(await screen.findByText('Ana Ativa'))
    expect(within(l).getByRole('button', { name: '🔑 Senha' })).toBeInTheDocument()
    expect(within(l).getByRole('button', { name: '🧪 Teste' })).toBeInTheDocument()
    expect(screen.queryByTestId('so-ativo-ativo')).toBeNull()
  })

  it.each([
    ['pendente', 'Beto Pendente', 'aprove primeiro'],
    ['inativo', 'Caio Desativado', 'reative primeiro'],
    ['rejeitado', 'Duda Recusada', 'reative primeiro'],
  ])('%s: sem "🔑 Senha" nem "🧪 Teste" (o servidor recusaria) e com o caminho certo escrito', async (id, nome, caminho) => {
    render(<Usuarios />)
    const l = linha(await screen.findByText(nome))
    expect(within(l).queryByRole('button', { name: '🔑 Senha' })).toBeNull()
    expect(within(l).queryByRole('button', { name: /🧪/ })).toBeNull()
    expect(screen.getByTestId(`so-ativo-${id}`)).toHaveTextContent(`Senha e modo teste só para quem está ativo: ${caminho}`)
    // o botão que leva ao estado em que senha e teste voltam a valer continua lá
    // (pendente se aprova em "Solicitações pendentes"; reativar é para quem já foi membro — migration 310)
    if (id === 'pendente') expect(within(l).queryByRole('button', { name: '✅ Reativar' })).toBeNull()
    else expect(within(l).getByRole('button', { name: '✅ Reativar' })).toBeInTheDocument()
  })

  it('o vínculo encerrado aparece marcado como recusado (antes não tinha marca nenhuma)', async () => {
    render(<Usuarios />)
    const l = linha(await screen.findByText('Duda Recusada'))
    expect(within(l).getByText('recusado')).toBeInTheDocument()
  })

  it('instrutor (migration 210): Usuários é só da diretoria — tela restrita, sem lista', async () => {
    papel = 'instrutor'
    render(<Usuarios />)
    expect(await screen.findByText('Apenas a diretoria pode gerenciar usuários.')).toBeInTheDocument()
    expect(screen.queryByText('Beto Pendente')).toBeNull()
  })
})

describe('Usuários: desativar exige MOTIVO (migration 310) e diz o que acontece de verdade', () => {
  it('fala em perder o acesso A ESTE CLUBE, não desativa sem motivo, e com motivo desativa', async () => {
    const u = userEvent.setup()
    render(<Usuarios />)
    const l = linha(await screen.findByText('Ana Ativa'))
    await u.click(within(l).getByRole('button', { name: '🚫 Desativar' }))
    const modal = screen.getByRole('dialog')
    expect(modal).toHaveTextContent(/perde o acesso a este clube/)
    expect(modal).not.toHaveTextContent(/não vai mais conseguir entrar/)
    // sem motivo: o botão fica travado e nada é chamado
    expect(screen.getByTestId('confirmar-inativar')).toBeDisabled()
    // "Outro" sem texto continua travado
    await u.click(within(modal).getByLabelText('Outro'))
    expect(screen.getByTestId('confirmar-inativar')).toBeDisabled()
    await u.click(within(modal).getByLabelText('Faltas'))
    await u.click(screen.getByTestId('confirmar-inativar'))
    expect(inativarMembro).toHaveBeenCalledWith('ativo', { categoria: 'faltas', texto: '' })
    // desativada na hora: os botões de senha e teste somem da linha dela
    expect(within(l).queryByRole('button', { name: '🔑 Senha' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Outro" exige o texto escrito', async () => {
    const u = userEvent.setup()
    render(<Usuarios />)
    const l = linha(await screen.findByText('Ana Ativa'))
    await u.click(within(l).getByRole('button', { name: '🚫 Desativar' }))
    await u.click(within(screen.getByRole('dialog')).getByLabelText('Outro'))
    await u.type(screen.getByLabelText('Escreva o motivo'), 'mudou de escola')
    await u.click(screen.getByTestId('confirmar-inativar'))
    expect(inativarMembro).toHaveBeenCalledWith('ativo', { categoria: 'outro', texto: 'mudou de escola' })
  })

  it('reativar abre o modal com motivo opcional', async () => {
    const u = userEvent.setup()
    render(<Usuarios />)
    const l = linha(await screen.findByText('Caio Desativado'))
    await u.click(within(l).getByRole('button', { name: '✅ Reativar' }))
    await u.click(screen.getByTestId('confirmar-reativar'))
    expect(reativarMembro).toHaveBeenCalledWith('inativo', { texto: '' })
  })

  it('inativo não tem "Excluir" (não se apaga)', async () => {
    render(<Usuarios />)
    const l = linha(await screen.findByText('Caio Desativado'))
    expect(within(l).queryByRole('button', { name: '🗑️ Excluir' })).toBeNull()
    expect(within(linha(screen.getByText('Ana Ativa'))).getByRole('button', { name: '🗑️ Excluir' })).toBeInTheDocument()
  })
})

describe('Usuários: filtro "Inativos" e histórico', () => {
  it('filtro mostra só quem está inativo, desde quando e o último motivo', async () => {
    const u = userEvent.setup()
    render(<Usuarios />)
    await screen.findByText('Ana Ativa')
    await u.click(screen.getByTestId('filtro-inativos'))
    expect(listarInativos).toHaveBeenCalled()
    expect(await screen.findByTestId('inativo-info-inativo')).toHaveTextContent(
      `Inativo desde ${new Date('2026-08-01T12:00:00Z').toLocaleDateString('pt-BR')} · Mudou de cidade ou de igreja: Foi para Campinas`)
    expect(screen.queryByText('Ana Ativa')).toBeNull()
    expect(screen.queryByText('Beto Pendente')).toBeNull()
  })

  it('"📜 Histórico" mostra a linha do tempo com os motivos', async () => {
    const u = userEvent.setup()
    render(<Usuarios />)
    const l = linha(await screen.findByText('Caio Desativado'))
    await u.click(within(l).getByTestId('historico-inativo'))
    expect(historicoDoMembro).toHaveBeenCalledWith('inativo')
    const lista = await screen.findByTestId('historico-lista')
    expect(lista).toHaveTextContent('Reativado')
    expect(lista).toHaveTextContent('Desativado')
    expect(lista).toHaveTextContent('Faltas: muitas faltas')
    expect(lista).toHaveTextContent('por Lider A')
  })

  it('pendente não tem histórico nem desativar', async () => {
    render(<Usuarios />)
    const l = linha(await screen.findByText('Beto Pendente'))
    expect(within(l).queryByTestId('historico-pendente')).toBeNull()
    expect(within(l).queryByRole('button', { name: '🚫 Desativar' })).toBeNull()
  })
})
