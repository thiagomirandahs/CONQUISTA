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
const lerPagamentoDoClube = vi.fn()
const concederConsentimento = vi.fn()
const revogarConsentimento = vi.fn()
vi.mock('../lib/dados.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    carregarMeusFilhos: (...a) => carregarMeusFilhos(...a),
    meusPedidosVinculo: (...a) => meusPedidosVinculo(...a),
    pedirVinculo: (...a) => pedirVinculo(...a),
    lerPagamentoDoClube: (...a) => lerPagamentoDoClube(...a),
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
  lerPagamentoDoClube.mockResolvedValue({ formas: [], valor: null })
  confirmar.mockResolvedValue(true)
})

const PENDENTE = { ...SEM_CONSENTIMENTO, mensalidades_pendentes: [{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }] }

describe('MeuFilho — mensalidade e formas de pagamento', () => {
  it('mostra o valor, os meses e TODAS as formas: PIX copiável, dinheiro como texto, link https abre em aba nova', async () => {
    carregarMeusFilhos.mockResolvedValue([PENDENTE])
    lerPagamentoDoClube.mockResolvedValue({ valor: 30, formas: [
      { tipo: 'pix', rotulo: 'até dia 10', detalhe: '12.345.678/0001-90' },
      { tipo: 'dinheiro', rotulo: '', detalhe: 'Entregar ao tesoureiro' },
      { tipo: 'link', rotulo: '', detalhe: 'https://pague.exemplo.com/clube' },
    ] })
    render(<MeuFilho />)
    expect(await screen.findByTestId('valor-mensalidade')).toHaveTextContent('R$ 30 por mês (2 meses pendentes)')
    const formas = screen.getByTestId('formas-pagamento')
    expect(within(formas).getByRole('button', { name: /Copiar PIX: 12\.345/ })).toBeInTheDocument()
    expect(within(formas).getByText('Entregar ao tesoureiro')).toBeInTheDocument()
    const link = within(formas).getByRole('link', { name: /Abrir link de pagamento/ })
    expect(link).toHaveAttribute('href', 'https://pague.exemplo.com/clube')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
  it('sem nenhuma forma cadastrada: manda falar com a tesouraria; sem pendência, nada de pagamento', async () => {
    carregarMeusFilhos.mockResolvedValue([PENDENTE, { ...SEM_CONSENTIMENTO, id: 'f9', nome: 'Em Dia' }])
    render(<MeuFilho />)
    expect(await screen.findByText(/Fale com a tesouraria/)).toBeInTheDocument()
    expect(screen.queryByTestId('formas-pagamento')).not.toBeInTheDocument()
  })
  it('falha ao ler as formas não derruba a lista de filhos', async () => {
    carregarMeusFilhos.mockResolvedValue([PENDENTE])
    lerPagamentoDoClube.mockRejectedValue(new Error('offline'))
    render(<MeuFilho />)
    expect(await screen.findByText('Fulano')).toBeInTheDocument()
    expect(screen.getByText(/Fale com a tesouraria/)).toBeInTheDocument()
  })
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
