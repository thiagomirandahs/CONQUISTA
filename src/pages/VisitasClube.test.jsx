// Visitas da coordenação, lado da diretoria (migration 141): confirmar, sugerir outra data e ler o relatório.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'c1' }) }))
const carregarVisitasDoClube = vi.fn()
const responderVisita = vi.fn()
vi.mock('../services/institucional.js', () => ({
  carregarVisitasDoClube: (...a) => carregarVisitasDoClube(...a),
  responderVisita: (...a) => responderVisita(...a),
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
})
