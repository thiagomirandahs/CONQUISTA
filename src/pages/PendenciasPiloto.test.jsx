// Pendências do piloto (migrations 170/171): corrigir o nascimento (própria pessoa e liderança) e
// cancelar a matrícula numa classe (própria pessoa e liderança), sempre com confirmação.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const definirNascimento = vi.fn()
const nascimentoDoMembro = vi.fn()
vi.mock('../services/usuarios.js', async (orig) => ({
  ...(await orig()),
  definirNascimento: (...a) => definirNascimento(...a),
  nascimentoDoMembro: (...a) => nascimentoDoMembro(...a),
}))
const cancelarClasse = vi.fn()
const carregarClassesDoMembro = vi.fn()
vi.mock('../services/classes.js', () => ({
  cancelarClasse: (...a) => cancelarClasse(...a),
  carregarClassesDoMembro: (...a) => carregarClassesDoMembro(...a),
}))
vi.mock('../lib/dados.js', () => ({ cancelarClasse: (...a) => cancelarClasse(...a) }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), confirmar: vi.fn() } }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu' } }) }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))

const { default: EditarNascimento } = await import('../components/EditarNascimento.jsx')
const { validarNascimento } = await import('../services/usuarios.js')
const { ModalClassesDoMembro } = await import('./Usuarios.jsx')
const { CancelarClasse } = await import('./MinhaClasse.jsx')

beforeEach(() => {
  for (const f of [definirNascimento, nascimentoDoMembro, cancelarClasse, carregarClassesDoMembro]) f.mockReset()
  definirNascimento.mockResolvedValue({ ok: true, alterado: true })
  cancelarClasse.mockResolvedValue({ ok: true, status: 'cancelada' })
})

describe('validarNascimento', () => {
  const hoje = new Date(2026, 8, 26)
  it('recusa vazio, futuro, data inexistente e mais de 100 anos', () => {
    expect(validarNascimento('', hoje)).toMatch(/Informe/)
    expect(validarNascimento('2026-09-27', hoje)).toMatch(/futuro/)
    expect(validarNascimento('2015-02-30', hoje)).toMatch(/inválida/)
    expect(validarNascimento('1900-01-01', hoje)).toMatch(/ano/)
  })
  it('aceita data real no passado (inclusive hoje)', () => {
    expect(validarNascimento('2014-03-10', hoje)).toBeNull()
    expect(validarNascimento('2026-09-26', hoje)).toBeNull()
  })
})

describe('EditarNascimento', () => {
  it('própria pessoa: escolhe, revisa e só grava depois de confirmar', async () => {
    const onSalvo = vi.fn()
    render(<EditarNascimento usuarioId="eu" proprio valorAtual="2014-03-10" onFechar={() => {}} onSalvo={onSalvo} />)
    expect(nascimentoDoMembro).not.toHaveBeenCalled()
    const campo = screen.getByLabelText('Nova data')
    await userEvent.clear(campo)
    await userEvent.type(campo, '2013-03-10')
    await userEvent.click(screen.getByTestId('revisar-nascimento'))
    expect(definirNascimento).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirmacao-nascimento')).toHaveTextContent('de 10/03/2014 para 10/03/2013')
    await userEvent.click(screen.getByTestId('confirmar-nascimento'))
    expect(definirNascimento).toHaveBeenCalledWith('eu', '2013-03-10')
    expect(onSalvo).toHaveBeenCalled()
  })

  it('data no futuro: mostra o motivo e não chama o servidor', async () => {
    render(<EditarNascimento usuarioId="eu" proprio valorAtual={null} onFechar={() => {}} />)
    await userEvent.type(screen.getByLabelText('Nova data'), '2999-01-01')
    await userEvent.click(screen.getByTestId('revisar-nascimento'))
    expect(screen.getByRole('alert')).toHaveTextContent('futuro')
    expect(definirNascimento).not.toHaveBeenCalled()
  })

  it('liderança: busca o nascimento atual do membro ao abrir e grava para o membro', async () => {
    nascimentoDoMembro.mockResolvedValue('2012-05-01')
    render(<EditarNascimento usuarioId="m1" nome="Ana Souza" onFechar={() => {}} />)
    expect(await screen.findByDisplayValue('2012-05-01')).toBeInTheDocument()
    expect(nascimentoDoMembro).toHaveBeenCalledWith('m1')
    expect(screen.getByText(/de Ana/)).toBeInTheDocument()
    const campo = screen.getByLabelText('Nova data')
    await userEvent.clear(campo)
    await userEvent.type(campo, '2012-06-01')
    await userEvent.click(screen.getByTestId('revisar-nascimento'))
    await userEvent.click(screen.getByTestId('confirmar-nascimento'))
    expect(definirNascimento).toHaveBeenCalledWith('m1', '2012-06-01')
  })

  it('erro do servidor aparece e nada fecha', async () => {
    definirNascimento.mockRejectedValue(new Error('Sem permissão (apenas a própria pessoa ou a liderança do clube dela).'))
    const onSalvo = vi.fn()
    render(<EditarNascimento usuarioId="eu" proprio valorAtual={null} onFechar={() => {}} onSalvo={onSalvo} />)
    await userEvent.type(screen.getByLabelText('Nova data'), '2014-01-01')
    await userEvent.click(screen.getByTestId('revisar-nascimento'))
    await userEvent.click(screen.getByTestId('confirmar-nascimento'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSalvo).not.toHaveBeenCalled()
  })
})

describe('Cancelar matrícula: a própria pessoa (Minha Classe)', () => {
  it('pede confirmação dizendo que o progresso fica guardado, e só então cancela', async () => {
    const onCancelada = vi.fn()
    render(<CancelarClasse memberClassId="mc1" nome="Amigo" onCancelada={onCancelada} />)
    await userEvent.click(screen.getByTestId('cancelar-classe'))
    expect(cancelarClasse).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirmar-cancelar-classe')).toHaveTextContent('O progresso fica guardado no histórico')
    await userEvent.click(screen.getByTestId('confirmar-cancelar'))
    expect(cancelarClasse).toHaveBeenCalledWith('mc1')
    expect(onCancelada).toHaveBeenCalled()
  })

  it('Voltar não cancela', async () => {
    render(<CancelarClasse memberClassId="mc1" nome="Amigo" />)
    await userEvent.click(screen.getByTestId('cancelar-classe'))
    await userEvent.click(screen.getByText('Voltar'))
    expect(cancelarClasse).not.toHaveBeenCalled()
    expect(screen.getByTestId('cancelar-classe')).toBeInTheDocument()
  })
})

describe('Cancelar matrícula: a liderança (gestão de membros)', () => {
  it('só a classe em andamento tem botão; cancelar pede confirmação e tira da lista', async () => {
    carregarClassesDoMembro.mockResolvedValue([
      { member_class_id: 'mc1', nome: 'Amigo', status: 'em_andamento', percentual: 40 },
      { member_class_id: 'mc2', nome: 'Companheiro', status: 'investida', percentual: 100 },
    ])
    render(<ModalClassesDoMembro usuario={{ id: 'm1', nome: 'Ana Souza' }} onFechar={() => {}} />)
    const itens = await screen.findAllByTestId('classe-do-membro')
    expect(carregarClassesDoMembro).toHaveBeenCalledWith('m1')
    expect(within(itens[1]).queryByTestId('cancelar-classe-membro')).toBeNull()
    await userEvent.click(within(itens[0]).getByTestId('cancelar-classe-membro'))
    expect(cancelarClasse).not.toHaveBeenCalled()
    expect(within(itens[0]).getByText(/O progresso fica guardado no histórico/)).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('confirmar-cancelar-membro'))
    expect(cancelarClasse).toHaveBeenCalledWith('mc1')
    expect(await screen.findAllByTestId('classe-do-membro')).toHaveLength(1)
  })
})
