import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { listar: vi.fn(), csv: vi.fn() }
vi.mock('../../services/pagamento.js', () => ({ pagamentosRecebidos: (...a) => f.listar(...a) }))
vi.mock('../../lib/csv.js', () => ({ baixarCSV: (...a) => f.csv(...a) }))
const { default: PagamentosRecebidos } = await import('./PagamentosRecebidos.jsx')

const DADOS = {
  itens: [
    { tipo: 'licenca', clube: 'Everest', valor_centavos: 22000, metodo: 'pix', pago_em: '2026-10-16T14:00:00Z', transacao: 'a', promocao: true },
    { tipo: 'teste', clube: 'Clube Pinheiros', valor_centavos: 100, metodo: 'pix', pago_em: '2026-10-16T14:27:00Z', transacao: 't', promocao: false },
  ],
  totais: {
    licencas_mes_centavos: 22000, licencas_mes_quantidade: 1, licencas_total_centavos: 22000, licencas_quantidade: 1,
    pix_centavos: 22000, cartao_centavos: 0, testes_total_centavos: 100, testes_quantidade: 1,
  },
}
beforeEach(() => { f.listar.mockReset(); f.csv.mockReset() })

describe('PagamentosRecebidos', () => {
  it('mostra os totais (o teste fica fora) e a lista com o tipo de cada pagamento', async () => {
    f.listar.mockResolvedValue(DADOS)
    render(<PagamentosRecebidos />)
    expect(await screen.findByTestId('recebido-mes')).toHaveTextContent('R$ 220,00')
    expect(screen.getByTestId('recebido-total')).toHaveTextContent('R$ 220,00')
    expect(screen.getByTestId('recebido-testes')).toHaveTextContent('R$ 1,00 em 1 pagamento(s) — fora dos totais')
    const lista = screen.getByTestId('recebidos-lista')
    expect(lista).toHaveTextContent('Everest')
    expect(lista).toHaveTextContent('Lançamento')
    expect(lista).toHaveTextContent('Teste')
  })

  it('exporta a planilha com os pagamentos', async () => {
    f.listar.mockResolvedValue(DADOS)
    render(<PagamentosRecebidos />)
    await userEvent.click(await screen.findByTestId('recebidos-csv'))
    const [nome, cab, linhas] = f.csv.mock.calls[0]
    expect(nome).toBe('pagamentos-recebidos.csv')
    expect(cab).toContain('Valor (R$)')
    expect(linhas[0]).toEqual(expect.arrayContaining(['Everest', 'Licença (lançamento)', 'Pix', '220,00']))
  })

  it('falha: "Tentar de novo" (nunca zeros falsos); sem pagamentos: aviso amigável', async () => {
    f.listar.mockRejectedValueOnce(new Error('offline'))
    f.listar.mockResolvedValueOnce({ itens: [], totais: {} })
    render(<PagamentosRecebidos />)
    expect(await screen.findByText(/Não consegui carregar o histórico/)).toBeInTheDocument()
    expect(screen.queryByTestId('recebido-mes')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Nenhum pagamento confirmado ainda.')).toBeInTheDocument()
  })
})
