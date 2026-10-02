// Editor de planos: abre com os dados da versão, converte reais em centavos, valida em português, grava RASCUNHO e avisa; plano novo gera a chave pelo nome.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const salvar = vi.fn()
vi.mock('../../services/admin.js', () => ({ planoRascunhoSalvar: (...a) => salvar(...a) }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn() }
vi.mock('../../ui/avisos.jsx', () => ({ avisar: avisos }))
const { default: EditorDePlano } = await import('./EditorDePlano.jsx')

const PLANO = { id: 'p1', chave: 'anual', versao: 1, status: 'publicado', nome: 'Licença Anual', descricao: 'Tudo incluso', publico: true,
  limites: { membros: 300, clubes: 3 }, precos: [{ ciclo: 'anual', valor_centavos: 22990, ativo: true, metadata: { pix_centavos: 19990, parcelas_cartao: 12 } }] }

beforeEach(() => { salvar.mockReset(); for (const f of Object.values(avisos)) f.mockReset() })

describe('EditorDePlano', () => {
  it('nova versão de um plano publicado: mostra os dados, explica que quem assinou não muda e salva um rascunho com centavos', async () => {
    const u = userEvent.setup(); const aoSalvar = vi.fn()
    salvar.mockResolvedValue([])
    render(<EditorDePlano plano={PLANO} aoFechar={() => {}} aoSalvar={aoSalvar} />)
    expect(screen.getByText(/versão nova/)).toBeInTheDocument()
    expect(screen.getByLabelText('Nome do plano')).toHaveValue('Licença Anual')
    expect(screen.getByLabelText('Valor (R$)')).toHaveValue('229,90')
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor); await u.type(valor, '249,90')
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1))
    const args = salvar.mock.calls[0][0]
    expect(args.chave).toBe('anual')
    expect(args.precos).toEqual([{ ciclo: 'anual', valor_centavos: 24990, pix_centavos: 19990, parcelas_cartao: 12, parcela_centavos: 2083 }])
    expect(args.limites).toMatchObject({ membros: 300, clubes: 3, fotos: null })
    expect(avisos.sucesso).toHaveBeenCalled()
    expect(aoSalvar).toHaveBeenCalled()
  })

  it('valor inválido: mensagem em português, nada é enviado', async () => {
    const u = userEvent.setup()
    render(<EditorDePlano plano={PLANO} aoFechar={() => {}} aoSalvar={() => {}} />)
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor); await u.type(valor, 'abc')
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/valor anual/)
    expect(salvar).not.toHaveBeenCalled()
  })

  it('Pix maior que o valor cheio é recusado antes de ir ao servidor', async () => {
    const u = userEvent.setup()
    render(<EditorDePlano plano={PLANO} aoFechar={() => {}} aoSalvar={() => {}} />)
    const pix = screen.getByLabelText('No Pix (R$, opcional)')
    await u.clear(pix); await u.type(pix, '999,00')
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Pix/)
    expect(salvar).not.toHaveBeenCalled()
  })

  it('plano novo: a chave sai do nome; ciclo mensal pode ser oferecido; limite vazio = ilimitado', async () => {
    const u = userEvent.setup()
    salvar.mockResolvedValue([])
    render(<EditorDePlano plano={null} aoFechar={() => {}} aoSalvar={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Nome do plano'), 'Plano Básico 2027')
    await u.click(screen.getByRole('checkbox', { name: 'Oferecer o ciclo mensal' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '29,90')
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(salvar).toHaveBeenCalled())
    const args = salvar.mock.calls[0][0]
    expect(args.chave).toBe('plano-basico-2027')
    expect(args.precos).toEqual([{ ciclo: 'mensal', valor_centavos: 2990 }])
    expect(args.limites.membros).toBeNull()
  })

  it('erro do servidor aparece no formulário e o botão volta a funcionar', async () => {
    const u = userEvent.setup()
    salvar.mockRejectedValue(new Error('O nome do plano precisa ter de 3 a 60 caracteres.'))
    render(<EditorDePlano plano={PLANO} aoFechar={() => {}} aoSalvar={() => {}} />)
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('3 a 60 caracteres')
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled()
  })
})
