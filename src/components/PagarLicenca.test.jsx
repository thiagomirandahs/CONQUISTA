// Pagar a licença (migration 540): some quando o pagamento está desligado ou a pessoa não é diretoria; mostra Pix e link; clique duplo
// cria uma só cobrança; erro do servidor vira aviso; lista as faturas; renovação só perto do fim do período.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { disponivel: vi.fn(), faturas: vi.fn(), iniciar: vi.fn() }
vi.mock('../services/comercial.js', async (orig) => ({
  ...(await orig()),
  pagamentoDisponivel: (...a) => f.disponivel(...a), faturasDoClube: (...a) => f.faturas(...a), iniciarPagamento: (...a) => f.iniciar(...a),
}))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn() }
vi.mock('../ui/avisos.jsx', () => ({ avisar: avisos }))
const { default: PagarLicenca, precisaPagar } = await import('./PagarLicenca.jsx')

const PENDENTE = { tem_assinatura: true, status: 'pagamento_pendente', periodo_fim: null }
const COBRANCA = { fatura_id: 'f1', valor_centavos: 19990, vence_em: '2026-10-05', pix_copia_cola: '000201MOCKABC', checkout_url: 'https://pague.exemplo/f1' }

beforeEach(() => {
  for (const fn of [...Object.values(f), ...Object.values(avisos)]) fn.mockReset()
  f.disponivel.mockResolvedValue(true); f.faturas.mockResolvedValue([])
})

describe('precisaPagar', () => {
  it('trial, pendente, inadimplente e suspensa precisam; cancelada e sem assinatura não; ativa só perto do fim', () => {
    const agora = Date.parse('2026-10-02T12:00:00Z'); const dias = (n) => new Date(agora + n * 86400000).toISOString()
    for (const s of ['trial', 'pagamento_pendente', 'inadimplente', 'suspensa']) expect(precisaPagar({ tem_assinatura: true, status: s }, agora), s).toBe(true)
    expect(precisaPagar({ tem_assinatura: true, status: 'cancelada' }, agora)).toBe(false)
    expect(precisaPagar({ tem_assinatura: false }, agora)).toBe(false)
    expect(precisaPagar({ tem_assinatura: true, status: 'ativa', periodo_fim: dias(300) }, agora)).toBe(false)
    expect(precisaPagar({ tem_assinatura: true, status: 'ativa', periodo_fim: dias(30) }, agora)).toBe(true)
    expect(precisaPagar({ tem_assinatura: true, status: 'ativa', periodo_fim: null }, agora)).toBe(false)
  })
})

describe('PagarLicenca', () => {
  it('pagamento desligado: não desenha nada', async () => {
    f.disponivel.mockResolvedValue(false)
    const { container } = render(<PagarLicenca assinatura={PENDENTE} />)
    await waitFor(() => expect(f.disponivel).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
  it('quem não é diretoria (o banco recusa a lista de faturas): não desenha nada', async () => {
    f.faturas.mockRejectedValue(new Error('Sem permissão.'))
    const { container } = render(<PagarLicenca assinatura={PENDENTE} />)
    await waitFor(() => expect(f.faturas).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
  it('pendente: mostra Pix e Cartão; Pix gera a cobrança e mostra o código e o link', async () => {
    const u = userEvent.setup()
    f.iniciar.mockResolvedValue(COBRANCA)
    render(<PagarLicenca assinatura={PENDENTE} />)
    await u.click(await screen.findByRole('button', { name: 'Pagar com Pix' }))
    expect(f.iniciar).toHaveBeenCalledWith('pix')
    expect(await screen.findByLabelText('Pix copia e cola')).toHaveValue('000201MOCKABC')
    expect(screen.getByRole('link', { name: 'Abrir página de pagamento' })).toHaveAttribute('href', 'https://pague.exemplo/f1')
    expect(screen.getByText(/R\$\s*199,90/)).toBeInTheDocument()
  })
  it('cartão chama com "cartao"', async () => {
    const u = userEvent.setup()
    f.iniciar.mockResolvedValue({ ...COBRANCA, pix_copia_cola: null })
    render(<PagarLicenca assinatura={PENDENTE} />)
    await u.click(await screen.findByRole('button', { name: 'Cartão' }))
    expect(f.iniciar).toHaveBeenCalledWith('cartao')
    expect(screen.queryByLabelText('Pix copia e cola')).not.toBeInTheDocument()
  })
  it('clique duplo no Pix gera UMA cobrança só', async () => {
    const u = userEvent.setup()
    f.iniciar.mockImplementation(() => new Promise((r) => setTimeout(() => r(COBRANCA), 30)))
    render(<PagarLicenca assinatura={PENDENTE} />)
    await u.dblClick(await screen.findByRole('button', { name: 'Pagar com Pix' }))
    await screen.findByLabelText('Pix copia e cola')
    expect(f.iniciar).toHaveBeenCalledTimes(1)
  })
  it('erro do servidor: aviso com a mensagem e os botões continuam', async () => {
    const u = userEvent.setup()
    f.iniciar.mockRejectedValue(new Error('O pagamento online ainda não está disponível.'))
    render(<PagarLicenca assinatura={PENDENTE} />)
    await u.click(await screen.findByRole('button', { name: 'Pagar com Pix' }))
    await waitFor(() => expect(avisos.erro).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Pagar com Pix' })).toBeEnabled()
  })
  it('ativa e em dia: sem botões de pagar, só a data; lista as faturas com o status em português', async () => {
    f.faturas.mockResolvedValue([{ id: 'a', competencia: '2026-10-01', valor_centavos: 19990, moeda: 'BRL', status: 'paga' }])
    render(<PagarLicenca assinatura={{ tem_assinatura: true, status: 'ativa', periodo_fim: '2027-10-02T00:00:00Z' }} />)
    expect(await screen.findByText(/Licença em dia até/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pagar com Pix' })).not.toBeInTheDocument()
    expect(screen.getByText(/Paga/)).toBeInTheDocument()
  })
})
