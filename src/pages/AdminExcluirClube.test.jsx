// /admin: exclusão de clube (migration 280). O servidor confere tudo de novo; aqui garantimos a
// confirmação forte na tela: nome do clube digitado, motivo obrigatório, APAGAR para o expurgo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  clubeExcluir: vi.fn(), clubeRecuperar: vi.fn(), clubeExpurgarAgora: vi.fn(),
  clubesExcluidosListar: vi.fn(), exclusaoConfig: vi.fn(), exclusaoConfigDefinir: vi.fn(),
}
vi.mock('../services/adminExclusaoClube.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))

const { ZonaDePerigoClube, LixeiraDeClubes, nomeConfere } = await import('./AdminExcluirClube.jsx')

const CLUBE = { club_id: 'c1', nome: 'Clube Águias', fundador: false }
const LISTA = {
  dias_retencao: 30, permitir_excluir_fundador: false,
  clubes: [
    { id: 'e1', club_id: 'c1', nome: 'Clube Águias', status: 'excluido', motivo: 'encerrou', excluido_em: '2026-09-20T12:00:00Z',
      excluido_por: 'Admin', expurgo_previsto_em: '2026-10-20T12:00:00Z' },
    { id: 'e2', club_id: 'c2', nome: 'Clube Velho', status: 'expurgado', excluido_em: '2026-08-01T12:00:00Z', expurgado_em: '2026-08-31T12:00:00Z' },
  ],
}

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  confirmar.mockReset()
  f.clubeExcluir.mockResolvedValue({ ok: true, expurgo_previsto_em: '2026-10-26T12:00:00Z' })
  f.clubesExcluidosListar.mockResolvedValue(LISTA)
  f.clubeRecuperar.mockResolvedValue({ ok: true, vinculos_restaurados: 12, avisos: [] })
  f.clubeExpurgarAgora.mockResolvedValue({ ok: true })
})

describe('nomeConfere', () => {
  it('ignora espaços e maiúsculas, mas exige o nome', () => {
    expect(nomeConfere('  clube águias ', 'Clube Águias')).toBe(true)
    expect(nomeConfere('Clube Aguias', 'Clube Águias')).toBe(false)
    expect(nomeConfere('', '')).toBe(false)
  })
})

describe('Zona de perigo: excluir clube', () => {
  it('só libera o botão com o NOME do clube e um motivo', async () => {
    const u = userEvent.setup()
    const aoExcluir = vi.fn()
    render(<ZonaDePerigoClube clube={CLUBE} aoExcluir={aoExcluir} />)
    await u.click(screen.getByTestId('excluir-abrir'))
    const botao = screen.getByTestId('excluir-confirmar')
    expect(botao).toBeDisabled()

    await u.type(screen.getByLabelText(/Digite o nome do clube/), 'Clube Errado')
    await u.type(screen.getByLabelText(/Motivo da exclusão/), 'clube encerrou')
    expect(botao).toBeDisabled()
    expect(screen.getByText('O nome não confere.')).toBeInTheDocument()

    await u.clear(screen.getByLabelText(/Digite o nome do clube/))
    await u.type(screen.getByLabelText(/Digite o nome do clube/), 'Clube Águias')
    await u.clear(screen.getByLabelText(/Motivo da exclusão/))
    expect(botao).toBeDisabled()                                     // motivo obrigatório
    await u.type(screen.getByLabelText(/Motivo da exclusão/), 'ab')
    expect(botao).toBeDisabled()                                     // curto demais
    await u.type(screen.getByLabelText(/Motivo da exclusão/), 'andonou')
    expect(botao).toBeEnabled()

    await u.click(botao)
    expect(f.clubeExcluir).toHaveBeenCalledWith('c1', 'Clube Águias', 'abandonou')
    expect(aoExcluir).toHaveBeenCalled()
  })

  it('avisa quando é o clube fundador', async () => {
    render(<ZonaDePerigoClube clube={{ ...CLUBE, fundador: true }} />)
    expect(screen.getByText('Clube fundador protegido')).toBeInTheDocument()
  })
})

describe('Lixeira de clubes', () => {
  it('lista data, motivo, quem excluiu e expurgo previsto; recupera', async () => {
    const u = userEvent.setup()
    confirmar.mockResolvedValue(true)
    render(<LixeiraDeClubes />)
    expect(await screen.findByTestId('clube-excluido-e1')).toHaveTextContent('Motivo: encerrou')
    expect(screen.getByTestId('clube-excluido-e1')).toHaveTextContent('por Admin')
    expect(screen.getByTestId('clube-excluido-e1')).toHaveTextContent('Expurgo previsto: 20/10/2026')
    expect(screen.getByText(/Clube Velho/)).toBeInTheDocument()
    await u.click(screen.getByTestId('recuperar-e1'))
    expect(f.clubeRecuperar).toHaveBeenCalledWith('e1', 'recuperado pelo admin')
  })

  it('apagar definitivamente exige digitar APAGAR', async () => {
    const u = userEvent.setup()
    render(<LixeiraDeClubes />)
    await u.click(await screen.findByTestId('apagar-e1'))
    const botao = screen.getByTestId('apagar-confirmar')
    expect(botao).toBeDisabled()
    await u.type(screen.getByLabelText(/Digite APAGAR/), 'apagar')
    expect(botao).toBeDisabled()
    await u.clear(screen.getByLabelText(/Digite APAGAR/))
    await u.type(screen.getByLabelText(/Digite APAGAR/), 'APAGAR')
    await u.click(botao)
    expect(f.clubeExpurgarAgora).toHaveBeenCalledWith('e1', 'APAGAR')
  })
})
