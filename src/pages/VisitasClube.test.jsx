// Visitas da coordenação, lado da diretoria (migration 141): confirmar, sugerir outra data e ler o relatório.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'c1' }) }))
const carregarVisitasDoClube = vi.fn()
const responderVisita = vi.fn()
const avaliarVisita = vi.fn()
vi.mock('../services/institucional.js', () => ({
  carregarVisitasDoClube: (...a) => carregarVisitasDoClube(...a),
  responderVisita: (...a) => responderVisita(...a),
  avaliarVisita: (...a) => avaliarVisita(...a),
}))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), info: vi.fn() } }))
const { default: VisitasClube } = await import('./VisitasClube.jsx')

const VISITA = {
  id: 'v1', club_id: 'c1', agendada_para: '2026-10-01T12:00:00Z', objetivo: 'Conhecer a diretoria', status: 'agendada',
  agendada_por: { nome: 'Coord', unidade: { nome: 'Distrito Centro' } },
}
const renderT = () => render(<MemoryRouter><VisitasClube /></MemoryRouter>)
beforeEach(() => {
  carregarVisitasDoClube.mockReset().mockResolvedValue([VISITA])
  responderVisita.mockReset().mockResolvedValue({ ok: true })
  avaliarVisita.mockReset().mockResolvedValue({ ok: true, nova: true })
})

describe('VisitasClube', () => {
  it('lista a visita do clube e confirma', async () => {
    renderT()
    expect(await screen.findByText('Conhecer a diretoria')).toBeInTheDocument()
    expect(carregarVisitasDoClube).toHaveBeenCalledWith('c1')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(responderVisita).toHaveBeenCalledWith('v1', true, { sugestao: null, obs: null })
  })

  it('sugerir outra data exige data e envia a sugestão', async () => {
    renderT()
    await userEvent.click(await screen.findByRole('button', { name: 'Sugerir outra data' }))
    const enviar = screen.getByRole('button', { name: 'Enviar' })
    expect(enviar).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Data e hora que funcionam para o clube'), '2026-10-05T09:30')
    await userEvent.click(enviar)
    expect(responderVisita).toHaveBeenCalledWith('v1', false, expect.objectContaining({ sugestao: expect.stringMatching(/^2026-10-05T/) }))
  })

  it('visita realizada mostra o relatório e não tem mais ações', async () => {
    carregarVisitasDoClube.mockResolvedValue([{ ...VISITA, status: 'realizada', relatorio: 'Tudo certo com as unidades.' }])
    renderT()
    expect(await screen.findByText('Tudo certo com as unidades.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  })

  it('visita futura não mostra "Avaliar visita"', async () => {
    renderT()
    await screen.findByText('Conhecer a diretoria')
    expect(screen.queryByRole('button', { name: /Avaliar visita/ })).not.toBeInTheDocument()
  })

  it('diretoria avalia a visita realizada com estrelas e observação', async () => {
    carregarVisitasDoClube.mockResolvedValue([{ ...VISITA, status: 'realizada', avaliavel: true, avaliacao: null }])
    renderT()
    await userEvent.click(await screen.findByRole('button', { name: /Avaliar visita/ }))
    const enviar = screen.getByRole('button', { name: 'Enviar avaliação' })
    expect(enviar).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: '4 estrelas — Nota geral da visita' }))
    await userEvent.click(screen.getByRole('radio', { name: '5 estrelas — Pontualidade' }))
    await userEvent.type(screen.getByLabelText('Observação (opcional)'), 'Ajudou muito')
    await userEvent.click(enviar)
    expect(avaliarVisita).toHaveBeenCalledWith('v1', {
      geral: 4, pontualidade: 5, orientacao: null, relacionamento: null, observacao: 'Ajudou muito',
    })
  })

  it('avaliação existente aparece e, passado o prazo de 7 dias, não pode mais ser editada', async () => {
    const avaliacao = { geral: 3, observacao: 'Chegou atrasado', editavel_ate: '2020-01-01T00:00:00Z' }
    carregarVisitasDoClube.mockResolvedValue([{ ...VISITA, status: 'realizada', avaliavel: true, avaliacao }])
    renderT()
    expect(await screen.findByText('Chegou atrasado')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '3 de 5 estrelas' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /avaliação/i })).not.toBeInTheDocument()
  })

  it('dentro do prazo mostra "Editar avaliação"', async () => {
    const avaliacao = { geral: 5, editavel_ate: '2999-01-01T00:00:00Z' }
    carregarVisitasDoClube.mockResolvedValue([{ ...VISITA, status: 'realizada', avaliavel: true, avaliacao }])
    renderT()
    expect(await screen.findByRole('button', { name: 'Editar avaliação' })).toBeInTheDocument()
  })
})
