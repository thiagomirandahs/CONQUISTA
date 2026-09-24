// Início contextual (fase 7): responde "o que é mais importante para mim agora?".
// Antes, a pessoa entrava no Ranking — um placar — e nada dizia o que ela precisava fazer.
// A tela NÃO prioriza nada: quem prioriza é o servidor (motor declarativo). Aqui só se desenha.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { nome: 'Ana Clara Souza' } }) }))
// os recursos ligados NESTE clube (cada teste pode trocar): um card que leva a tela de recurso desligado não aparece
let recursos
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ marca: { nome: 'Clube Teste' }, temRecurso: (c) => recursos[c] === true }) }))
const carregarInicio = vi.fn()
vi.mock('../services/inicio.js', () => ({ carregarInicio: (...a) => carregarInicio(...a) }))
const { default: Inicio } = await import('./Inicio.jsx')

const item = (chave, peso, titulo, rota = '/x') =>
  ({ chave, peso, icone: '✏️', titulo, descricao: `descrição de ${titulo}`, rota, contador: 1 })

const renderT = () => render(<MemoryRouter><Inicio /></MemoryRouter>)
beforeEach(() => {
  carregarInicio.mockReset().mockResolvedValue([])
  recursos = { classes: true }
})

describe('Inicio', () => {
  it('cumprimenta pelo primeiro nome e mostra o clube em uso', async () => {
    renderT()
    expect(await screen.findByText(/, Ana 👋/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Clube Teste' })).toBeInTheDocument()
  })

  it('sem pendência nenhuma, comemora em vez de mostrar uma lista vazia', async () => {
    renderT()
    expect(await screen.findByText('Você está em dia!')).toBeInTheDocument()
  })

  it('mostra no máximo 3 ações — o resto fica em "ver mais" (não é dashboard)', async () => {
    carregarInicio.mockResolvedValue([
      item('a', 100, 'Correção pedida'), item('b', 90, 'Avaliações esperando'),
      item('c', 80, 'Falta pouco'), item('d', 50, 'Vem aí'), item('e', 30, 'Você conquistou'),
    ])
    renderT()
    const lista = await screen.findByTestId('prioridades')
    expect(lista.querySelectorAll('li')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Ver mais 2' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver mais 2' }))
    expect(screen.getByTestId('prioridades').querySelectorAll('li')).toHaveLength(5)
  })

  it('respeita a ordem de prioridade que o SERVIDOR mandou — não reordena nada', async () => {
    carregarInicio.mockResolvedValue([
      item('a', 100, 'Primeira'), item('b', 90, 'Segunda'), item('c', 80, 'Terceira'),
    ])
    renderT()
    const lista = await screen.findByTestId('prioridades')
    expect([...lista.querySelectorAll('li')].map((li) => li.textContent))
      .toEqual([expect.stringContaining('Primeira'), expect.stringContaining('Segunda'), expect.stringContaining('Terceira')])
  })

  it('cada ação leva direto para onde se resolve (progressive disclosure)', async () => {
    carregarInicio.mockResolvedValue([item('a', 100, 'Correção pedida', '/minha-classe')])
    renderT()
    expect(await screen.findByRole('link', { name: /Correção pedida/ })).toHaveAttribute('href', '/minha-classe')
  })

  it('fala em português, não em linguagem de banco', async () => {
    carregarInicio.mockResolvedValue([
      { ...item('a', 100, 'Seu instrutor pediu uma correção'), descricao: 'Tem um item da classe Amigo para refazer.' },
    ])
    renderT()
    expect(await screen.findByText('Seu instrutor pediu uma correção')).toBeInTheDocument()
    expect(screen.getByText('Tem um item da classe Amigo para refazer.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/needs_revision|status=|member_requirement|club_id/)
  })

  it('falha no servidor vira mensagem humana, nunca o erro cru', async () => {
    carregarInicio.mockRejectedValue(new Error('PGRST116: JSON object requested, multiple rows returned'))
    renderT()
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Não deu certo agora|Tente de novo/)
    expect(alerta).not.toHaveTextContent(/PGRST/)
  })
})

// Fase 9, item 9: especialidades fora do piloto. O servidor montava os cards de especialidade sob o recurso 'classes'; o
// convidado via "Você está fazendo a especialidade [PILOTO/TESTE] ..." no primeiro card. A tela filtra pela rota de destino.
describe('Inicio — especialidades desligadas neste clube', () => {
  const especialidade = { ...item('especialidade', 40, 'Continue de onde parou', '/minhas-especialidades'), descricao: 'Você está fazendo a especialidade [PILOTO/TESTE] Primeiros Socorros.' }
  const correcao = item('especialidade_correcao', 96, 'Correção em uma especialidade', '/minhas-especialidades')
  const classe = item('classe', 60, 'Falta pouco na sua classe', '/minha-classe')

  it('com "classes" ligado e "especialidades" desligado: o card da classe aparece e os de especialidade NÃO', async () => {
    recursos = { classes: true, especialidades: false }
    carregarInicio.mockResolvedValue([correcao, classe, especialidade])
    renderT()
    const lista = await screen.findByTestId('prioridades')
    expect(lista.querySelectorAll('li')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Falta pouco na sua classe/ })).toHaveAttribute('href', '/minha-classe')
    expect(document.body.textContent).not.toMatch(/especialidade|PILOTO/i)   // ('Clube Teste' é o nome do clube no dublê)
    expect(document.querySelector('a[href="/minhas-especialidades"]')).toBeNull()
  })

  it('se só sobrou especialidade, a pessoa vê "em dia" — e o "ver mais" não conta o que foi escondido', async () => {
    recursos = { classes: true }
    carregarInicio.mockResolvedValue([correcao, especialidade])
    renderT()
    expect(await screen.findByText('Você está em dia!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ver mais/ })).toBeNull()
  })

  it('com o recurso "especialidades" ligado, o card volta', async () => {
    recursos = { classes: true, especialidades: true }
    carregarInicio.mockResolvedValue([correcao])
    renderT()
    expect(await screen.findByRole('link', { name: /Correção em uma especialidade/ })).toHaveAttribute('href', '/minhas-especialidades')
  })
})
