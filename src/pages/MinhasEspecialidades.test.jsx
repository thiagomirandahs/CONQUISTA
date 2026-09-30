// Minhas Especialidades com o motor de relatório: formulário por requisito com modelo, bloqueios, prazo,
// grupos N de M; requisito sem modelo segue com a caixa de texto de sempre.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ m: { div: () => <div /> } }))
const carregarMinhaEspecialidade = vi.fn()
const buscarEspecialidades = vi.fn()
const iniciarEspecialidade = vi.fn()
const salvarRelatorioEspecialidade = vi.fn()
const enviarRequisitoEspecialidade = vi.fn()
const carregarHistoricoEspecialidade = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaEspecialidade: (...a) => carregarMinhaEspecialidade(...a),
  buscarEspecialidades: (...a) => buscarEspecialidades(...a),
  iniciarEspecialidade: (...a) => iniciarEspecialidade(...a),
  salvarRequisitoEspecialidade: vi.fn(),
  enviarRequisitoEspecialidade: (...a) => enviarRequisitoEspecialidade(...a),
  salvarRelatorioEspecialidade: (...a) => salvarRelatorioEspecialidade(...a),
  carregarHistoricoEspecialidade: (...a) => carregarHistoricoEspecialidade(...a),
  subirAnexoDeRelatorio: vi.fn(),
}))
const { default: MinhasEspecialidades } = await import('./MinhasEspecialidades.jsx')

const MODELO = { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte a técnica', obrigatorio: true }] }
const req = (over) => ({
  id: 'r', codigo: '1', descricao: 'Requisito', tipo_evidencia: 'texto', status: 'nao_iniciado', avaliacoes: [], bloqueios: [], anexos: [], rascunho: null,
  modelo: null, grupo: null, depende_de: null, prazo_dias: null, prazo_em: null, tentativas: 0, member_specialty_requirement_id: null, ...over,
})
const DADOS = {
  member_specialty: { id: 'ms1', status: 'em_andamento', iniciada_em: '2026-09-01T10:00:00Z', percentual: 25 },
  especialidade: { nome: 'Especialidade Teste' }, curriculum_version: { origem: 'oficial' }, oferta: null,
  grupos: [{ chave: 'tec', rotulo: 'Faça 2 das 4 técnicas', minimo: 2, aprovados: 1 }],
  requisitos: [
    req({ id: 'a', codigo: '1', descricao: 'Com formulário.', modelo: MODELO, grupo: 'tec', member_specialty_requirement_id: 'msr-a', prazo_em: '2026-10-15T10:00:00Z', tentativas: 1 }),
    req({ id: 'b', codigo: '2', descricao: 'Bloqueado.', modelo: MODELO, bloqueios: ['Conclua antes o requisito 1.'], member_specialty_requirement_id: 'msr-b' }),
    req({ id: 'c', codigo: '3', descricao: 'Antigo sem modelo.' }),
  ],
}
const card = (cod) => screen.getAllByTestId('requisito-especialidade').find((n) => n.textContent.includes(`${cod}. `))

const cartao = (id, over = {}) => ({ specialty_id: id, codigo: id.toUpperCase(), nome: `Espec ${id}`, categoria: 'Artes', nivel: 1, total_requisitos: 3, situacao: 'em_andamento', member_specialty_id: `ms-${id}`, percentual: 30, dependencias_pendentes: [], ...over })
const respostaBusca = (itens, total = itens.length) => ({ itens, proximo: null, total, areas: [{ categoria: 'Artes', total: 5 }] })

beforeEach(() => {
  // por padrão: UMA especialidade em andamento → abre direto nela, como antes
  buscarEspecialidades.mockReset().mockResolvedValue(respostaBusca([cartao('a')]))
  iniciarEspecialidade.mockReset().mockResolvedValue({ ok: true, member_specialty_id: 'ms-nova' })
  carregarMinhaEspecialidade.mockReset().mockResolvedValue(DADOS)
  salvarRelatorioEspecialidade.mockReset().mockResolvedValue()
  enviarRequisitoEspecialidade.mockReset().mockResolvedValue()
  carregarHistoricoEspecialidade.mockReset().mockResolvedValue({ modelo: MODELO, tentativas: [{ submission_id: 's1', tentativa_numero: 1, conteudo: { resumo: 'Tentativa antiga' }, anexos: [], decisao: null }] })
})

describe('MinhasEspecialidades — relatório estruturado', () => {
  it('mostra o grupo N de M com o progresso', async () => {
    render(<MinhasEspecialidades />)
    const g = await screen.findByTestId('grupo')
    expect(g).toHaveTextContent('Faça 2 das 4 técnicas')
    expect(g).toHaveTextContent('1 de 2 feitas')
  })

  it('requisito com modelo usa o formulário; sem modelo, a caixa de sempre', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    expect(within(card('1')).getByTestId('formulario-relatorio')).toBeInTheDocument()
    expect(within(card('3')).queryByTestId('formulario-relatorio')).toBeNull()
    expect(within(card('3')).getByPlaceholderText('Escreva aqui...')).toBeInTheDocument()
  })

  it('mostra o prazo e os bloqueios (com o envio travado)', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    expect(within(card('1')).getByTestId('prazo')).toHaveTextContent('Até 15/10')
    expect(within(card('2')).getByTestId('bloqueios')).toHaveTextContent('Conclua antes o requisito 1.')
    expect(within(card('2')).getByTestId('botao-enviar-relatorio')).toBeDisabled()
  })

  it('histórico de tentativas sob demanda mostra o que foi enviado em cada vez', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    const c = card('1')
    fireEvent.click(within(c).getByTestId('ver-tentativas'))
    expect(await within(c).findByText('Tentativa antiga')).toBeInTheDocument()
    expect(carregarHistoricoEspecialidade).toHaveBeenCalledWith('msr-a')
  })

  it('enviar salva o relatório e depois envia', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    const c = card('1')
    fireEvent.change(within(c).getByLabelText(/Conte a técnica/), { target: { value: 'Fiz o nó' } })
    await act(async () => { fireEvent.click(within(c).getByTestId('botao-enviar-relatorio')) })
    expect(salvarRelatorioEspecialidade).toHaveBeenCalledWith({ requirementId: 'a', conteudo: { resumo: 'Fiz o nó' }, anexos: [] })
    expect(enviarRequisitoEspecialidade).toHaveBeenCalledWith('a')
  })
})

describe('MinhasEspecialidades — lista paginada', () => {
  it('uma só em andamento: abre direto no detalhe (consulta só 2 itens, nunca o catálogo)', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    expect(buscarEspecialidades).toHaveBeenCalledWith({ situacao: 'iniciadas', limite: 2 })
    expect(carregarMinhaEspecialidade).toHaveBeenCalledWith('ms-a')
  })

  it('várias em andamento: mostra a lista e abre a escolhida pelo member_specialty_id', async () => {
    buscarEspecialidades.mockImplementation(async ({ situacao, limite }) => (
      situacao === 'iniciadas' && limite === 2
        ? respostaBusca([cartao('a'), cartao('b')], 2)
        : respostaBusca([cartao('a'), cartao('b', { percentual: 60 })], 2)))
    render(<MinhasEspecialidades />)
    expect(await screen.findByRole('tab', { name: 'Minhas especialidades' })).toHaveAttribute('aria-selected', 'true')
    expect(carregarMinhaEspecialidade).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Espec b' }))
    await screen.findAllByTestId('requisito-especialidade')
    expect(carregarMinhaEspecialidade).toHaveBeenCalledWith('ms-b')
    // e dá para voltar para a lista
    fireEvent.click(screen.getByTestId('voltar-lista'))
    expect(await screen.findByRole('tab', { name: 'Minhas especialidades' })).toBeInTheDocument()
  })

  it('"Escolher uma especialidade": Começar inicia a disponível e abre a recém-iniciada', async () => {
    buscarEspecialidades.mockImplementation(async ({ situacao, limite }) => {
      if (limite === 2) return respostaBusca([], 0)
      if (situacao === 'disponiveis') return respostaBusca([cartao('z', { situacao: 'disponivel', member_specialty_id: null, percentual: null })])
      return respostaBusca([], 0)
    })
    render(<MinhasEspecialidades />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Escolher uma especialidade' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Começar Espec z' }))
    await screen.findAllByTestId('requisito-especialidade')
    expect(iniciarEspecialidade).toHaveBeenCalledWith('z')
    expect(carregarMinhaEspecialidade).toHaveBeenCalledWith('ms-nova')
  })

  it('falha ao consultar as iniciadas cai na lista (que mostra o erro), sem quebrar', async () => {
    buscarEspecialidades.mockRejectedValue(new Error('Failed to fetch'))
    render(<MinhasEspecialidades />)
    expect(await screen.findByRole('tab', { name: 'Minhas especialidades' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})
