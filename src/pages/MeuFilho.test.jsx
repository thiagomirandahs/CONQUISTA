// Meu Filho (responsável): garante que "Conceder consentimento" chama a RPC com o vinculo_id certo,
// que um filho já consentido mostra "Revogar" (chamando com o consentimento_id), e que nenhum dos dois
// aparece pro outro — sem misturar os dois estados no mesmo card.
// Fase 6: revogar pede confirmação (avisar.confirmar) e dá retorno (avisar.sucesso); erro nunca é cru.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const carregarMeusFilhos = vi.fn()
const meusPedidosVinculo = vi.fn()
const pedirVinculo = vi.fn()
const lerPix = vi.fn()
const concederConsentimento = vi.fn()
const revogarConsentimento = vi.fn()
vi.mock('../lib/dados.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    carregarMeusFilhos: (...a) => carregarMeusFilhos(...a),
    meusPedidosVinculo: (...a) => meusPedidosVinculo(...a),
    pedirVinculo: (...a) => pedirVinculo(...a),
    lerPix: (...a) => lerPix(...a),
    concederConsentimento: (...a) => concederConsentimento(...a),
    revogarConsentimento: (...a) => revogarConsentimento(...a),
  }
})
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'pai-1' } }) }))
// a autorização da Comunidade tem teste próprio (components/AutorizacaoComunidade.test.jsx)
vi.mock('../components/AutorizacaoComunidade.jsx', () => ({ default: () => null }))
// a ponte de avisos (toast/confirmação) é dublada: sem provider ela responderia `false` sempre
const confirmar = vi.fn()
const sucesso = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({
  avisar: { confirmar: (...a) => confirmar(...a), sucesso: (...a) => sucesso(...a), erro: vi.fn(), info: vi.fn() },
}))

const { default: MeuFilho } = await import('./MeuFilho.jsx')

const SEM_CONSENTIMENTO = {
  id: 'filho-1', vinculo_id: 'vinc-1', nome: 'Fulano', foto: null, unidade: 'Águias',
  pontos: 10, presencas: 2, faltas: 0, mensalidades_pendentes: [], consentimento_id: null,
}
const COM_CONSENTIMENTO = { ...SEM_CONSENTIMENTO, id: 'filho-2', vinculo_id: 'vinc-2', nome: 'Beltrana', consentimento_id: 'cons-2' }

beforeEach(() => {
  vi.clearAllMocks()
  meusPedidosVinculo.mockResolvedValue([])
  lerPix.mockResolvedValue('')
  confirmar.mockResolvedValue(true)
})

describe('MeuFilho — consentimento', () => {
  it('filho sem consentimento mostra botão de conceder, que chama a RPC com o vinculo_id e dá retorno', async () => {
    carregarMeusFilhos.mockResolvedValue([SEM_CONSENTIMENTO])
    concederConsentimento.mockResolvedValue({ ok: true })
    render(<MeuFilho />)
    const card = (await screen.findByText('Fulano')).closest('div.bg-surface')
    const botao = within(card).getByRole('button', { name: /conceder consentimento/i })
    await userEvent.click(botao)
    expect(concederConsentimento).toHaveBeenCalledWith('vinc-1')
    expect(sucesso).toHaveBeenCalled()
  })

  it('filho com consentimento mostra "Revogar": confirma primeiro, depois chama a RPC com o consentimento_id', async () => {
    carregarMeusFilhos.mockResolvedValue([COM_CONSENTIMENTO])
    revogarConsentimento.mockResolvedValue({ ok: true })
    render(<MeuFilho />)
    const card = (await screen.findByText('Beltrana')).closest('div.bg-surface')
    expect(within(card).queryByRole('button', { name: /conceder consentimento/i })).not.toBeInTheDocument()
    const botao = within(card).getByRole('button', { name: /revogar/i })
    await userEvent.click(botao)
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: expect.stringMatching(/Revogar/) }))
    expect(revogarConsentimento).toHaveBeenCalledWith('cons-2')
    expect(sucesso).toHaveBeenCalled()
  })

  it('se a pessoa desistir na confirmação, nada é revogado', async () => {
    carregarMeusFilhos.mockResolvedValue([COM_CONSENTIMENTO])
    confirmar.mockResolvedValue(false)
    render(<MeuFilho />)
    const card = (await screen.findByText('Beltrana')).closest('div.bg-surface')
    await userEvent.click(within(card).getByRole('button', { name: /revogar/i }))
    expect(confirmar).toHaveBeenCalled()
    expect(revogarConsentimento).not.toHaveBeenCalled()
  })

  it('dois filhos em estados diferentes não se misturam', async () => {
    carregarMeusFilhos.mockResolvedValue([SEM_CONSENTIMENTO, COM_CONSENTIMENTO])
    render(<MeuFilho />)
    await screen.findByText('Fulano')
    const cardSem = screen.getByText('Fulano').closest('div.bg-surface')
    const cardCom = screen.getByText('Beltrana').closest('div.bg-surface')
    expect(within(cardSem).getByRole('button', { name: /conceder consentimento/i })).toBeInTheDocument()
    expect(within(cardCom).getByRole('button', { name: /revogar/i })).toBeInTheDocument()
  })

  it('erro do servidor vira mensagem humana, nunca o texto cru', async () => {
    carregarMeusFilhos.mockResolvedValue([SEM_CONSENTIMENTO])
    concederConsentimento.mockRejectedValue(new Error('PGRST301: permission denied for table consents'))
    render(<MeuFilho />)
    const card = (await screen.findByText('Fulano')).closest('div.bg-surface')
    await userEvent.click(within(card).getByRole('button', { name: /conceder consentimento/i }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Não consegui registrar o consentimento/)
    expect(alerta).not.toHaveTextContent(/PGRST/)
  })
})
