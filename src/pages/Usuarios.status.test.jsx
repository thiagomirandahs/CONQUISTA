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
const definirAtivoUsuario = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarUsuarios: (...a) => carregarUsuarios(...a),
  listarUnidades: async () => [],
  definirAtivoUsuario: (...a) => definirAtivoUsuario(...a),
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
  definirAtivoUsuario.mockReset().mockResolvedValue({})
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
    expect(within(l).getByRole('button', { name: '✅ Reativar' })).toBeInTheDocument()
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

describe('Usuários: o diálogo de desativar diz o que acontece de verdade', () => {
  it('fala em perder o acesso A ESTE CLUBE, e não promete que a pessoa não entra mais', async () => {
    render(<Usuarios />)
    const l = linha(await screen.findByText('Ana Ativa'))
    await userEvent.click(within(l).getByRole('button', { name: '🚫 Desativar' }))
    expect(confirmar).toHaveBeenCalledTimes(1)
    const { descricao } = confirmar.mock.calls[0][0]
    expect(descricao).toMatch(/perde o acesso a este clube/)
    expect(descricao).not.toMatch(/não vai mais conseguir entrar/)
    expect(definirAtivoUsuario).toHaveBeenCalledWith('ativo', false)
    // desativada na hora: os botões de senha e teste somem da linha dela
    expect(within(l).queryByRole('button', { name: '🔑 Senha' })).toBeNull()
  })
})
