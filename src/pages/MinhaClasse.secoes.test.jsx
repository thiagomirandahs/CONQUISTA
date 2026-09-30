// Minha Classe: abas em andamento/concluídas e o painel "Iniciar outra classe" em seções
// (Disponíveis / Classes anteriores disponíveis / Bloqueadas). Os campos `bloqueio` e `anterior` são
// aditivos (migration 518): sem eles (banco 517) a tela tem de continuar igual e nunca quebrar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ m: { div: (p) => <div {...Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'transition'].includes(k)))} /> } }))

const carregarMinhaClasse = vi.fn()
const carregarClassesDisponiveis = vi.fn()
const carregarMinhasClasses = vi.fn()
const iniciarClasse = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarMinhasClasses: (...a) => carregarMinhasClasses(...a),
  carregarClassesDisponiveis: (...a) => carregarClassesDisponiveis(...a),
  iniciarClasse: (...a) => iniciarClasse(...a),
  salvarRequisito: vi.fn(), enviarRequisito: vi.fn(), escolherOpcoesRequisito: vi.fn(),
  carregarOrigemRequisito: vi.fn(), carregarHistoricoRequisito: vi.fn(),
}))

const { default: MinhaClasse, ListaDisponiveis, agruparDisponiveis } = await import('./MinhaClasse.jsx')

const cv = { origem: 'oficial', versao: '2026.4' }
const DISP = (id, nome, over = {}) => ({ class_id: id, nome, idade_minima: 10, elegivel: true, motivo_inelegivel: null, curriculum_version: cv, ...over })

const COM_CAMPOS = [
  DISP('c1', 'Amigo'),
  DISP('c2', 'Companheiro', { anterior: true }),
  DISP('c3', 'Guia', { elegivel: false, bloqueio: 'idade', motivo_inelegivel: 'Esta classe é a partir de 15 anos.' }),
  DISP('c4', 'Amigo da Natureza', { avancada: true, elegivel: false, bloqueio: 'pre_requisito', motivo_inelegivel: 'Comece a classe Amigo primeiro: a Classe Avançada é feita junto com ela ou depois dela.' }),
]

const MINHA = {
  member_class: { id: 'mc1', status: 'em_andamento', percentual: 11 },
  classe: { id: 'k1', nome: 'Amigo', idade_minima: 10 },
  curriculum_version: { origem: 'oficial', versao: '2026.4' },
  conclusao: { snapshot: null, revisao: null, investidura: null },
  secoes: [],
}

beforeEach(() => {
  carregarMinhaClasse.mockReset().mockResolvedValue(null)
  carregarMinhasClasses.mockReset().mockResolvedValue([])
  carregarClassesDisponiveis.mockReset().mockResolvedValue([])
  iniciarClasse.mockReset().mockResolvedValue({ ok: true })
})

const renderLista = (disponiveis, onIniciar = vi.fn()) => render(<ListaDisponiveis disponiveis={disponiveis} onIniciar={onIniciar} />)

describe('painel de classes — seções', () => {
  it('mostra as 3 seções com títulos curtos (h3), o apoio das anteriores e cada classe na sua seção', () => {
    renderLista(COM_CAMPOS)
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['Disponíveis', 'Classes anteriores disponíveis', 'Bloqueadas'])
    const disp = screen.getByRole('region', { name: 'Disponíveis' })
    const ant = screen.getByRole('region', { name: 'Classes anteriores disponíveis' })
    const blo = screen.getByRole('region', { name: 'Bloqueadas' })
    expect(within(disp).getByRole('heading', { name: 'Amigo' })).toBeInTheDocument()
    expect(within(ant).getByRole('heading', { name: 'Companheiro' })).toBeInTheDocument()
    expect(within(ant).getByText('Você já tem idade para estas classes. Dá para fazer as que ficaram pendentes.')).toBeInTheDocument()
    expect(within(blo).getByRole('heading', { name: 'Guia' })).toBeInTheDocument()
    expect(within(blo).getByRole('heading', { name: 'Amigo da Natureza' })).toBeInTheDocument()
    // nenhuma classe some
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('anterior elegível e disponível inicia pelo botão Iniciar (e só por ele)', async () => {
    const onIniciar = vi.fn()
    renderLista(COM_CAMPOS, onIniciar)
    expect(onIniciar).not.toHaveBeenCalled()
    const ant = screen.getByRole('region', { name: 'Classes anteriores disponíveis' })
    const botao = within(ant).getByRole('button', { name: 'Iniciar' })
    expect(botao).toBeEnabled()
    await userEvent.click(botao)
    expect(onIniciar).toHaveBeenCalledWith('c2')
  })

  it('bloqueadas: motivo do servidor em português, botão desabilitado ligado ao motivo, sem chamar iniciar', async () => {
    const onIniciar = vi.fn()
    renderLista(COM_CAMPOS, onIniciar)
    const blo = screen.getByRole('region', { name: 'Bloqueadas' })
    const itens = within(blo).getAllByRole('listitem')
    const idade = within(itens[0]).getByRole('button', { name: 'Iniciar' })
    expect(idade).toBeDisabled()
    expect(idade).toHaveAccessibleDescription('🎂 Esta classe é a partir de 15 anos.')
    expect(within(itens[0]).getByTestId('rotulo-bloqueio')).toHaveTextContent('Por idade')
    await userEvent.click(idade)
    expect(onIniciar).not.toHaveBeenCalled()
  })

  it('avançada bloqueada mostra o motivo do pré-requisito, com rótulo diferente do de idade', () => {
    renderLista(COM_CAMPOS)
    const av = screen.getByRole('heading', { name: 'Amigo da Natureza' }).closest('li')
    expect(av).toHaveAttribute('data-bloqueio', 'pre_requisito')
    expect(within(av).getByTestId('selo-avancada')).toBeInTheDocument()
    expect(within(av).getByTestId('rotulo-bloqueio')).toHaveTextContent('Falta uma classe antes')
    const iniciar = within(av).getByRole('button', { name: 'Iniciar' })
    expect(iniciar).toBeDisabled()
    expect(iniciar).toHaveAccessibleDescription('🔗 Comece a classe Amigo primeiro: a Classe Avançada é feita junto com ela ou depois dela.')
  })

  it('banco antigo (sem `bloqueio`/`anterior`): elegível = Disponíveis, inelegível = Bloqueadas com 🔒, sem seção de anteriores', () => {
    renderLista([
      DISP('c1', 'Amigo'),
      DISP('c2', 'Companheiro', { elegivel: false, motivo_inelegivel: 'Esta classe é a partir de 13 anos.' }),
    ])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Disponíveis', 'Bloqueadas'])
    expect(screen.queryByText('Classes anteriores disponíveis')).toBeNull()
    expect(screen.queryByTestId('rotulo-bloqueio')).toBeNull()
    const botao = within(screen.getByRole('region', { name: 'Bloqueadas' })).getByRole('button', { name: 'Iniciar' })
    expect(botao).toBeDisabled()
    expect(botao).toHaveAccessibleDescription('🔒 Esta classe é a partir de 13 anos.')
  })

  it('nunca mostra seção vazia', () => {
    const { unmount } = renderLista([DISP('c1', 'Amigo')])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Disponíveis'])
    unmount()
    renderLista([DISP('c3', 'Guia', { elegivel: false, bloqueio: 'idade', motivo_inelegivel: 'Esta classe é a partir de 15 anos.' })])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Bloqueadas'])
  })

  it('lista vazia mantém o estado vazio de sempre', () => {
    renderLista([])
    expect(screen.getByText('Nenhuma classe disponível ainda')).toBeInTheDocument()
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
  })

  it('agruparDisponiveis tolera entrada inválida', () => {
    expect(agruparDisponiveis(undefined)).toEqual({ disponiveis: [], anteriores: [], bloqueadas: [] })
  })
})

describe('Minha Classe — em andamento e concluídas', () => {
  const LISTA = [
    { member_class_id: 'mcA', class_id: 'k0', nome: 'Amigo', status: 'requisitos_concluidos', percentual: 100 },
    { member_class_id: 'mcB', class_id: 'k1', nome: 'Companheiro', status: 'em_andamento', percentual: 40 },
    { member_class_id: 'mcC', class_id: 'k2', nome: 'Pesquisador', status: 'investida', percentual: 100 },
  ]

  it('abas em andamento vêm primeiro, com rótulos, e a concluída mostra "✓ Concluída"', async () => {
    carregarMinhasClasses.mockResolvedValue(LISTA)
    carregarMinhaClasse.mockResolvedValue({ ...MINHA, member_class: { ...MINHA.member_class, id: 'mcB' } })
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findByRole('tablist', { name: 'Minhas classes' })
    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Companheiro'), expect.stringContaining('Amigo'), expect.stringContaining('Pesquisador'),
    ])
    expect(abas[0]).toHaveTextContent('40%')
    expect(abas[1]).toHaveTextContent('✓ Concluída')
    expect(abas[2]).toHaveTextContent('Investido')
    expect(abas[0]).toHaveAttribute('data-concluida', 'false')
    expect(abas[1]).toHaveAttribute('data-concluida', 'true')
    expect(screen.getAllByTestId('rotulo-grupo').map((r) => r.textContent)).toEqual(['Em andamento', 'Concluídas'])
  })

  it('o painel "+ Iniciar outra classe" usa as seções e só inicia pelo botão', async () => {
    carregarMinhasClasses.mockResolvedValue([LISTA[1]])
    carregarMinhaClasse.mockResolvedValue({ ...MINHA, member_class: { ...MINHA.member_class, id: 'mcB' } })
    carregarClassesDisponiveis.mockResolvedValue(COM_CAMPOS)
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findByRole('tablist', { name: 'Minhas classes' })
    await userEvent.click(screen.getByRole('button', { name: '+ Iniciar outra classe' }))
    const outras = await screen.findByTestId('outras-classes')
    expect(within(outras).getByRole('heading', { level: 3, name: 'Bloqueadas' })).toBeInTheDocument()
    expect(iniciarClasse).not.toHaveBeenCalled()
  })
})
