// Placar: a liderança apaga um recorde suspeito só depois do modal do app (avisar.confirmar, Fase 6),
// nunca por window.confirm — recusou, nada vai ao servidor; confirmou, chama excluirRecorde.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const dados = { carregarRecordesSemana: vi.fn(), excluirRecorde: vi.fn() }
vi.mock('../../lib/dados.js', () => ({ carregarRecordesSemana: (...a) => dados.carregarRecordesSemana(...a), excluirRecorde: (...a) => dados.excluirRecorde(...a) }))
vi.mock('./registry.jsx', () => ({ JOGOS: { reflexo: { emoji: '⚡', curto: 'Reflexo' } }, ARCADE: new Set(['reflexo']) }))
vi.mock('../../components/Avatar.jsx', () => ({ default: () => <span /> }))
const confirmar = vi.fn()
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))
const { default: RankingTrilha } = await import('./RankingTrilha.jsx')

beforeEach(() => {
  for (const fn of Object.values(dados)) fn.mockReset()
  confirmar.mockReset().mockResolvedValue(true)
  dados.carregarRecordesSemana.mockResolvedValue([{ id: 'u1', nome: 'Ana', foto: null, pontos: 9999 }])
  dados.excluirRecorde.mockResolvedValue({ ok: true })
})

describe('RankingTrilha › apagar recorde (liderança)', () => {
  it('confirmação de perigo com membro, recorde e impacto; recusou → nada; confirmou → excluirRecorde', async () => {
    render(<RankingTrilha dados={{}} carregando={false} meuId="eu" ehAdmin />)
    await userEvent.click(screen.getByText(/Reflexo/))
    const lixeira = await screen.findByTitle('Apagar recorde suspeito')

    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(lixeira)
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(true)
    expect(pedido.titulo).toBe('Apagar o recorde de Ana?')
    expect(pedido.rotulo).toBe('Apagar recorde')
    expect(pedido.descricao).toContain('⚡ 9999 em Reflexo')
    expect(pedido.descricao).toContain('no placar da semana → nova: apagado')
    expect(pedido.descricao).toContain('não dá para desfazer')
    expect(dados.excluirRecorde).not.toHaveBeenCalled()

    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(lixeira)
    expect(dados.excluirRecorde).toHaveBeenCalledWith('u1', 'reflexo')
  })

  it('sem ehAdmin não há lixeira', async () => {
    render(<RankingTrilha dados={{}} carregando={false} meuId="eu" ehAdmin={false} />)
    await userEvent.click(screen.getByText(/Reflexo/))
    await screen.findByText(/Ana/)
    expect(screen.queryByTitle('Apagar recorde suspeito')).toBeNull()
  })
})
