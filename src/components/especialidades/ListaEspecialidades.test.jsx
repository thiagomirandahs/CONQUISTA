import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

const buscar = vi.fn()
vi.mock('../../lib/dados.js', () => ({ buscarEspecialidades: (...a) => buscar(...a) }))
const { default: ListaEspecialidades } = await import('./ListaEspecialidades.jsx')

const item = (n, over = {}) => ({
  specialty_id: `s${n}`, codigo: `AR-${String(n).padStart(3, '0')}`, nome: `Especialidade ${n}`, categoria: 'Artes', nivel: 1, total_requisitos: 5,
  situacao: 'disponivel', member_specialty_id: null, percentual: null, dependencias_pendentes: [], ...over,
})
const pagina = (itens, proximo = null, total = itens.length, areas = [{ categoria: 'Artes', total: 10 }, { categoria: 'Natureza', total: 20 }]) => ({ itens, proximo, total, areas })
const passar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const abas = () => screen.getAllByRole('tab').map((t) => t.textContent)

beforeEach(() => { vi.useFakeTimers(); buscar.mockReset().mockResolvedValue(pagina([item(1), item(2)], null, 2)) })
afterEach(() => { vi.useRealTimers() })

describe('ListaEspecialidades', () => {
  it('carrega a 1ª página (com o limite pedido), mostra contador, áreas com total e as quatro abas', async () => {
    render(<ListaEspecialidades limite={30} />)
    await passar(10)
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(buscar).toHaveBeenCalledWith({ busca: '', area: null, situacao: 'todas', limite: 30, depois: null })
    expect(screen.getAllByTestId('cartao-especialidade')).toHaveLength(2)
    expect(screen.getByTestId('contador-especialidades')).toHaveTextContent('Mostrando 2 de 2')
    expect(screen.getByRole('option', { name: 'Natureza (20)' })).toBeInTheDocument()
    expect(abas()).toEqual(['Todas', 'Disponíveis', 'Em andamento', 'Concluídas'])
  })

  it('a busca espera ~350 ms e dispara UMA chamada, mesmo digitando rápido', async () => {
    render(<ListaEspecialidades />)
    await passar(10)
    buscar.mockClear()
    const caixa = screen.getByRole('searchbox')
    for (const v of ['n', 'nó', 'nós']) { fireEvent.change(caixa, { target: { value: v } }); await passar(100) }
    expect(buscar).not.toHaveBeenCalled()
    await passar(400)
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(buscar.mock.calls[0][0]).toMatchObject({ busca: 'nós', depois: null })
  })

  it('limpar a busca volta à consulta sem texto', async () => {
    render(<ListaEspecialidades />)
    await passar(10)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'abc' } })
    await passar(400)
    buscar.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar a busca' }))
    await passar(10)
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(buscar.mock.calls[0][0]).toMatchObject({ busca: '' })
  })

  it('filtro por área e por situação trocam a consulta e reiniciam o cursor', async () => {
    buscar.mockResolvedValue(pagina([item(1)], 'Artes|AR-001', 5))
    render(<ListaEspecialidades />)
    await passar(10)
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais' }))
    await passar(10)
    expect(buscar.mock.calls[1][0].depois).toBe('Artes|AR-001')
    buscar.mockClear()
    fireEvent.change(screen.getByLabelText('Filtrar por área'), { target: { value: 'Natureza' } })
    await passar(10)
    expect(buscar).toHaveBeenLastCalledWith({ busca: '', area: 'Natureza', situacao: 'todas', limite: 30, depois: null })
    fireEvent.click(screen.getByRole('tab', { name: 'Concluídas' }))
    await passar(10)
    expect(buscar).toHaveBeenLastCalledWith({ busca: '', area: 'Natureza', situacao: 'concluidas', limite: 30, depois: null })
    expect(screen.getByRole('tab', { name: 'Concluídas' })).toHaveAttribute('aria-selected', 'true')
  })

  it('"Ver mais" concatena sem duplicar e some quando não há próximo', async () => {
    buscar.mockResolvedValueOnce(pagina([item(1), item(2)], 'Artes|AR-002', 3))
      .mockResolvedValueOnce(pagina([item(2), item(3)], null, 3))
    render(<ListaEspecialidades limite={2} />)
    await passar(10)
    expect(screen.getAllByTestId('cartao-especialidade')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Ver mais' }))
    await passar(10)
    expect(buscar.mock.calls[1][0]).toMatchObject({ depois: 'Artes|AR-002', limite: 2 })
    expect(screen.getAllByTestId('cartao-especialidade').map((c) => within(c).getByRole('heading').textContent)).toEqual(['Especialidade 1', 'Especialidade 2', 'Especialidade 3'])
    expect(screen.queryByRole('button', { name: 'Ver mais' })).toBeNull()
    expect(screen.getByTestId('contador-especialidades')).toHaveTextContent('Mostrando 3 de 3')
  })

  it('resposta velha é ignorada quando a busca mudou; a lista anterior fica com "Buscando…"', async () => {
    let soltarVelha
    buscar.mockReset()
    buscar.mockResolvedValueOnce(pagina([item(1)], null, 1))
      .mockImplementationOnce(() => new Promise((res) => { soltarVelha = () => res(pagina([item(90, { nome: 'RESPOSTA VELHA' })], null, 1)) }))
      .mockResolvedValueOnce(pagina([item(2, { nome: 'Resposta nova' })], null, 1))
    render(<ListaEspecialidades />)
    await passar(10)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })
    await passar(400) // 2ª consulta, ainda pendente
    expect(screen.getByTestId('contador-especialidades')).toHaveTextContent('Buscando…')
    expect(screen.getByText('Especialidade 1')).toBeInTheDocument() // lista anterior mantida
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ab' } })
    await passar(400) // 3ª consulta responde primeiro
    expect(screen.getByText('Resposta nova')).toBeInTheDocument()
    await act(async () => { soltarVelha(); await vi.advanceTimersByTimeAsync(10) }) // a velha chega DEPOIS
    expect(screen.queryByText('RESPOSTA VELHA')).toBeNull()
    expect(screen.getByText('Resposta nova')).toBeInTheDocument()
  })

  it('erro mostra "Tentar de novo" e repete a mesma consulta', async () => {
    buscar.mockReset().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(pagina([item(1)], null, 1))
    render(<ListaEspecialidades />)
    await passar(10)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await passar(10)
    expect(buscar).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Especialidade 1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('vazio: mensagem diferente para busca sem resultado × nada iniciado', async () => {
    buscar.mockResolvedValue(pagina([], null, 0, []))
    const { unmount } = render(<ListaEspecialidades abas={[{ valor: 'iniciadas', rotulo: 'Em andamento' }, { valor: 'concluidas', rotulo: 'Concluídas' }]} />)
    await passar(10)
    expect(screen.getByTestId('vazio-especialidades')).toHaveTextContent('Você ainda não começou nenhuma especialidade.')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyz' } })
    await passar(400)
    expect(screen.getByTestId('vazio-especialidades')).toHaveTextContent('Nenhuma especialidade encontrada.')
    expect(screen.getByRole('button', { name: 'Limpar busca e filtro' })).toBeInTheDocument()
    unmount()
  })

  it('dependência pendente desativa "Começar" e mostra o motivo; sem dependência chama aoComecar', async () => {
    buscar.mockResolvedValue(pagina([item(1, { dependencias_pendentes: ['Nós e amarras'] }), item(2)], null, 2))
    const aoComecar = vi.fn().mockResolvedValue()
    render(<ListaEspecialidades aoComecar={aoComecar} />)
    await passar(10)
    const bloqueado = screen.getByRole('button', { name: 'Começar Especialidade 1' })
    expect(bloqueado).toBeDisabled()
    expect(screen.getByText(/Falta concluir: Nós e amarras/)).toBeInTheDocument()
    expect(bloqueado).toHaveAccessibleDescription(/Falta concluir: Nós e amarras/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Começar Especialidade 2' })) })
    expect(aoComecar).toHaveBeenCalledWith(expect.objectContaining({ specialty_id: 's2' }))
  })

  it('em andamento mostra a barra de progresso e abre; concluída mostra o selo', async () => {
    buscar.mockResolvedValue(pagina([
      item(1, { situacao: 'em_andamento', member_specialty_id: 'ms1', percentual: 40 }),
      item(2, { situacao: 'concluida', member_specialty_id: 'ms2', percentual: 100 }),
    ], null, 2))
    const aoAbrir = vi.fn()
    render(<ListaEspecialidades aoAbrir={aoAbrir} />)
    await passar(10)
    const [a, b] = screen.getAllByTestId('cartao-especialidade')
    expect(within(a).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    expect(within(b).getByText('✓ Concluída')).toBeInTheDocument()
    expect(within(b).queryByRole('progressbar')).toBeNull()
    fireEvent.click(within(a).getByRole('button', { name: 'Abrir Especialidade 1' }))
    expect(aoAbrir).toHaveBeenCalledWith(expect.objectContaining({ member_specialty_id: 'ms1' }))
  })

  it('nunca pede mais que o limite e uma aba única não mostra a barra de abas', async () => {
    render(<ListaEspecialidades limite={30} abas={[{ valor: 'disponiveis', rotulo: 'Disponíveis' }]} />)
    await passar(10)
    for (const [args] of buscar.mock.calls) expect(args.limite).toBeLessThanOrEqual(30)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(buscar.mock.calls[0][0].situacao).toBe('disponiveis')
  })
})
