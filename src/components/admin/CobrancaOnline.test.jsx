import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const ler = vi.fn()
const definir = vi.fn()
const confirmar = vi.fn()
const sucesso = vi.fn()
vi.mock('../../services/pagamento.js', () => ({ lerCobranca: (...a) => ler(...a), definirCobranca: (...a) => definir(...a) }))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { confirmar: (...a) => confirmar(...a), sucesso: (...a) => sucesso(...a), erro: vi.fn(), info: vi.fn() } }))
vi.mock('./VendaDeTeste.jsx', () => ({ default: () => null }))
const { default: CobrancaOnline } = await import('./CobrancaOnline.jsx')

beforeEach(() => { vi.clearAllMocks(); confirmar.mockResolvedValue(true) })

describe('CobrancaOnline', () => {
  it('desligada: mostra "Desligada"; ligar pede confirmação, chama o serviço e vira "Ligada"', async () => {
    ler.mockResolvedValue({ ativo: false, atualizadoEm: null })
    definir.mockResolvedValue({ ativo: true, atualizadoEm: '2026-10-16T12:00:00Z' })
    render(<CobrancaOnline />)
    expect(await screen.findByTestId('cobranca-situacao')).toHaveTextContent('Desligada')
    await userEvent.click(screen.getByTestId('cobranca-ligar'))
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Ligar a cobrança agora?', perigo: false }))
    expect(definir).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Ligada')).toBeInTheDocument()
    expect(sucesso).toHaveBeenCalledWith('Cobrança LIGADA.')
  })

  it('ligada: desligar também pede confirmação (e se desistir, nada muda)', async () => {
    ler.mockResolvedValue({ ativo: true, atualizadoEm: '2026-10-16T12:00:00Z' })
    definir.mockResolvedValue({ ativo: false, atualizadoEm: '2026-10-16T13:00:00Z' })
    confirmar.mockResolvedValueOnce(false)
    render(<CobrancaOnline />)
    expect(await screen.findByTestId('cobranca-situacao')).toHaveTextContent('Ligada')
    await userEvent.click(screen.getByTestId('cobranca-desligar'))
    expect(definir).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('cobranca-desligar'))
    expect(definir).toHaveBeenCalledWith(false)
    expect(await screen.findByText('Desligada')).toBeInTheDocument()
  })

  it('falha ao ler: aviso com "Tentar de novo" — nunca finge que está ligada ou desligada', async () => {
    ler.mockRejectedValueOnce(new Error('offline'))
    ler.mockResolvedValueOnce({ ativo: false, atualizadoEm: null })
    render(<CobrancaOnline />)
    expect(await screen.findByText(/Não consegui ler a situação/)).toBeInTheDocument()
    expect(screen.queryByTestId('cobranca-situacao')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByTestId('cobranca-situacao')).toHaveTextContent('Desligada')
  })
})
