// Jornada da Minha Classe: cabeçalho (contagens + CONTINUAR), seções colapsáveis com progresso e detalhe do requisito.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('../components/leitura/CardLivroDaClasse.jsx', () => ({ default: ({ classeManifesto }) => <div data-testid="card-livro-mock">{classeManifesto}</div> }))
vi.mock('framer-motion', () => ({ m: { div: () => <div /> } }))

const carregarMinhaClasse = vi.fn()
const carregarFormulariosDaClasse = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarMinhasClasses: vi.fn().mockResolvedValue([]),
  carregarClassesDisponiveis: vi.fn().mockResolvedValue([]),
  iniciarClasse: vi.fn(),
  salvarRequisito: vi.fn(),
  enviarRequisito: vi.fn(),
  escolherOpcoesRequisito: vi.fn(),
  carregarOrigemRequisito: vi.fn(),
  carregarHistoricoRequisito: vi.fn().mockResolvedValue({ tentativas: [] }),
  carregarFormularioRequisito: vi.fn(),
  carregarFormulariosDaClasse: (...a) => carregarFormulariosDaClasse(...a),
  salvarRelatorioRequisito: vi.fn(),
  subirAnexoDeRelatorio: vi.fn(),
}))

const { default: MinhaClasse } = await import('./MinhaClasse.jsx')

const base = (over) => ({ tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null, conteudo_dinamico: null, bloqueios: [], status: 'nao_iniciado', ...over })
const MODELO = { versao: 1, familia: 'L1', nota: null, schema: { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte o que leu' }] } }
const form = (rascunho = null) => ({ modelo: MODELO, member_requirement_id: 'm', status: 'nao_iniciado', rascunho, anexos: [], tentativas: 0 })

const montar = (secoes, percentual = 40) => ({
  member_class: { id: 'mc1', status: 'em_andamento', iniciada_em: '2026-09-01', percentual },
  classe: { id: 'c1', nome: 'Classe Teste' },
  curriculum_version: { origem: 'oficial', versao: '9.9' },
  conclusao: { snapshot: null, revisao: null, investidura: null },
  secoes,
})

const SECOES = [
  { id: 's1', codigo: 'I', nome: 'Feita', ordem: 1, requisitos: [
    base({ id: 'a1', codigo: '1', descricao: 'Requisito aprovado A.', status: 'aprovado' }),
    base({ id: 'a2', codigo: '2', descricao: 'Requisito aprovado B.', status: 'aprovado' }),
  ] },
  { id: 's2', codigo: 'II', nome: 'Em curso', ordem: 2, requisitos: [
    base({ id: 'b1', codigo: '1', descricao: 'Requisito aguardando.', status: 'aguardando_avaliacao' }),
    base({ id: 'b2', codigo: '2', descricao: 'Requisito bloqueado.', bloqueios: ['Faça o 3 antes.'], tipo_evidencia: 'texto', prazo_em: '2026-10-15' }),
    base({ id: 'b3', codigo: '3', descricao: 'Requisito livre.', tipo_evidencia: 'texto' }),
    base({ id: 'b4', codigo: '4', descricao: 'Requisito com rascunho.', status: 'em_andamento', tipo_evidencia: 'texto', evidencia_texto: 'rasc' }),
    base({ id: 'b5', codigo: '5', descricao: 'Requisito com correção.', status: 'correcao_solicitada', member_requirement_id: 'mr5',
      avaliacoes: [{ decisao: 'correcao_solicitada', comentario: 'Refaça', avaliado_por_nome: 'Ana', avaliado_papel: 'instrutor', created_at: '2026-09-02' }] }),
  ] },
]

beforeEach(() => {
  carregarMinhaClasse.mockReset().mockResolvedValue(montar(SECOES, 78))
  carregarFormulariosDaClasse.mockReset().mockResolvedValue({})
})
const abrirTela = async () => { render(<MemoryRouter><MinhaClasse /></MemoryRouter>); await screen.findByTestId('jornada') }
const linha = (id) => document.getElementById(`abrir-${id}`)

describe('MinhaClasse — cabeçalho da jornada', () => {
  it('barra de progresso (percentual do servidor) e contagens com ícone + texto', async () => {
    await abrirTela()
    expect(screen.getByRole('progressbar', { name: 'Progresso na classe' })).toHaveAttribute('aria-valuenow', '78')
    expect(screen.getByTestId('jornada-contagem')).toHaveTextContent('2 de 7 requisitos aprovados')
    const resumo = screen.getByTestId('jornada-resumo')
    expect(resumo).toHaveTextContent('✓ 2 aprovados')
    expect(resumo).toHaveTextContent('⏳ 1 aguardando avaliação')
    expect(resumo).toHaveTextContent('⚠ 1 precisa de correção')
  })

  it('[CONTINUAR] leva à correção solicitada (prioridade máxima), abre a seção e o detalhe, e foca a linha', async () => {
    await abrirTela()
    expect(linha('b5')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByTestId('continuar'))
    expect(linha('b5')).toHaveAttribute('aria-expanded', 'true')
    expect(document.activeElement).toBe(linha('b5'))
    expect(screen.getByTestId('continuar')).toHaveTextContent('Continuar')
  })

  it('sem correção: rascunho antes de não iniciado; bloqueado nunca', async () => {
    const s = structuredClone(SECOES)
    s[1].requisitos = s[1].requisitos.filter((r) => r.id !== 'b5')
    carregarMinhaClasse.mockResolvedValue(montar(s))
    await abrirTela()
    fireEvent.click(screen.getByTestId('continuar'))
    expect(linha('b4')).toHaveAttribute('aria-expanded', 'true') // rascunho
    expect(linha('b3')).toHaveAttribute('aria-expanded', 'false')
    expect(linha('b2')).toHaveAttribute('aria-expanded', 'false') // bloqueado
  })

  it('rascunho estruturado (classe_formularios) conta como rascunho', async () => {
    const s = [{ id: 's', codigo: 'I', nome: 'X', ordem: 1, requisitos: [base({ id: 'n1', codigo: '1', descricao: 'Livre.' }), base({ id: 'f1', codigo: '2', descricao: 'Com relatório.' })] }]
    carregarMinhaClasse.mockResolvedValue(montar(s))
    carregarFormulariosDaClasse.mockResolvedValue({ f1: form({ resumo: 'comecei' }) })
    await abrirTela()
    fireEvent.click(screen.getByTestId('continuar'))
    expect(linha('f1')).toHaveAttribute('aria-expanded', 'true')
  })

  it('tudo enviado/aprovado: "Nada pendente por aqui", sem botão', async () => {
    const s = [{ id: 's', codigo: 'I', nome: 'X', ordem: 1, requisitos: [base({ id: 'x1', codigo: '1', descricao: 'A.', status: 'aprovado' }), base({ id: 'x2', codigo: '2', descricao: 'B.', status: 'aguardando_avaliacao' })] }]
    carregarMinhaClasse.mockResolvedValue(montar(s, 50))
    await abrirTela()
    expect(screen.getByTestId('nada-pendente')).toHaveTextContent('Nada pendente por aqui')
    expect(screen.queryByTestId('continuar')).toBeNull()
  })
})

describe('MinhaClasse — seções', () => {
  it('cada seção mostra "aprovados/total" e uma mini-barra; abre só a que tem pendência', async () => {
    await abrirTela()
    const [s1, s2] = screen.getAllByTestId('secao')
    expect(within(s1).getByTestId('progresso-secao')).toHaveTextContent('2/2')
    expect(within(s2).getByTestId('progresso-secao')).toHaveTextContent('0/5')
    expect(within(s1).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(within(s2).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(within(s1).getByTestId('alternar-secao')).toHaveAttribute('aria-expanded', 'false')
    expect(within(s1).queryAllByTestId('requisito')).toHaveLength(0)
    expect(within(s2).getByTestId('alternar-secao')).toHaveAttribute('aria-expanded', 'true')
    expect(within(s2).getAllByTestId('requisito')).toHaveLength(5)
  })

  it('a seção colapsada abre e fecha pelo botão (teclado/toque)', async () => {
    await abrirTela()
    const [s1] = screen.getAllByTestId('secao')
    fireEvent.click(within(s1).getByTestId('alternar-secao'))
    expect(within(s1).getAllByTestId('requisito')).toHaveLength(2)
    fireEvent.click(within(s1).getByTestId('alternar-secao'))
    expect(within(s1).queryAllByTestId('requisito')).toHaveLength(0)
  })
})

describe('MinhaClasse — status e detalhe do requisito', () => {
  it('cada requisito mostra o status com ícone + texto', async () => {
    await abrirTela()
    const st = (id) => within(linha(id)).getByTestId('situacao')
    expect(st('b1')).toHaveTextContent('⏳Aguardando avaliação')
    expect(st('b2')).toHaveTextContent('🔒Bloqueado')
    expect(st('b3')).toHaveTextContent('○Não iniciado')
    expect(st('b4')).toHaveTextContent('✎Rascunho')
    expect(st('b5')).toHaveTextContent('⚠Correção solicitada')
  })

  it('o detalhe abre e fecha (botão, Esc e "Fechar detalhes") e devolve o foco à linha', async () => {
    await abrirTela()
    expect(screen.queryAllByTestId('detalhe-requisito')).toHaveLength(0) // nada montado antes de abrir
    fireEvent.click(linha('b3'))
    const det = screen.getByTestId('detalhe-requisito')
    expect(linha('b3')).toHaveAttribute('aria-expanded', 'true')
    expect(det).toBeVisible()
    fireEvent.keyDown(det, { key: 'Escape' })
    expect(linha('b3')).toHaveAttribute('aria-expanded', 'false')
    expect(det).not.toBeVisible() // continua montado (o que foi digitado não se perde), só escondido
    expect(document.activeElement).toBe(linha('b3'))
    fireEvent.click(linha('b3'))
    fireEvent.click(screen.getByTestId('fechar-requisito'))
    expect(linha('b3')).toHaveAttribute('aria-expanded', 'false')
  })

  it('o detalhe mostra tipo, dependência e prazo', async () => {
    await abrirTela()
    fireEvent.click(linha('b2'))
    const det = screen.getByTestId('detalhe-requisito')
    expect(within(det).getByTestId('tipos-requisito')).toHaveTextContent('Seção II. Em curso')
    expect(within(det).getByText('Entrega')).toBeInTheDocument()
    expect(within(det).getByText('Dependência')).toBeInTheDocument()
    expect(within(det).getByTestId('bloqueios')).toHaveTextContent('Faça o 3 antes.')
    expect(within(det).getByTestId('prazo')).toHaveTextContent('Prazo: 15/10/2026')
  })

  it('o tipo vem da família do formulário (leitura) e sem prazo/dependência não aparecem', async () => {
    const s = [{ id: 's', codigo: 'I', nome: 'X', ordem: 1, requisitos: [base({ id: 'f1', codigo: '1', descricao: 'Ler um livro.' })] }]
    carregarMinhaClasse.mockResolvedValue(montar(s))
    carregarFormulariosDaClasse.mockResolvedValue({ f1: form() })
    await abrirTela()
    fireEvent.click(linha('f1'))
    const det = screen.getByTestId('detalhe-requisito')
    expect(within(det).getByText('Leitura')).toBeInTheDocument()
    expect(within(det).queryByTestId('prazo')).toBeNull()
    expect(within(det).queryByTestId('bloqueios')).toBeNull()
  })

  it('requisito SEM formulário continua com a UI antiga (texto + enviar); COM formulário, o formulário', async () => {
    const s = [{ id: 's', codigo: 'I', nome: 'X', ordem: 1, requisitos: [
      base({ id: 'antigo', codigo: '1', descricao: 'Escrever.', tipo_evidencia: 'texto' }),
      base({ id: 'novo', codigo: '2', descricao: 'Ler.' }),
      base({ id: 'simples', codigo: '3', descricao: 'Só confirmar.' }),
    ] }]
    carregarMinhaClasse.mockResolvedValue(montar(s))
    carregarFormulariosDaClasse.mockResolvedValue({ novo: form() })
    await abrirTela()
    fireEvent.click(linha('antigo'))
    fireEvent.click(linha('novo'))
    fireEvent.click(linha('simples'))
    const [a, n, sm] = screen.getAllByTestId('detalhe-requisito')
    expect(within(a).getByLabelText(/Sua resposta/)).toBeInTheDocument()
    expect(within(a).getByTestId('botao-enviar')).toBeInTheDocument()
    expect(within(a).queryByTestId('formulario-relatorio')).toBeNull()
    expect(within(n).getByTestId('formulario-relatorio')).toBeInTheDocument()
    expect(within(n).queryByLabelText(/Sua resposta/)).toBeNull()
    expect(within(sm).queryByTestId('formulario-relatorio')).toBeNull() // sem formulário de relatório onde não precisa
    expect(within(sm).queryByLabelText(/Sua resposta/)).toBeNull()
  })

  it('requisito só de confirmação usa "Marcar como feito"', async () => {
    const s = [{ id: 's', codigo: 'I', nome: 'X', ordem: 1, requisitos: [base({ id: 'v1', codigo: '1', descricao: 'Participar da reunião.' })] }]
    carregarMinhaClasse.mockResolvedValue(montar(s))
    carregarFormulariosDaClasse.mockResolvedValue({ v1: { ...form(), modelo: { versao: 1, familia: 'V1', schema: { versao: 1, campos: [{ chave: 'fiz', tipo: 'confirmacao', rotulo: 'Participei' }] } } } })
    await abrirTela()
    fireEvent.click(linha('v1'))
    expect(screen.getByRole('button', { name: 'Marcar como feito' })).toBeInTheDocument()
    expect(within(screen.getByTestId('detalhe-requisito')).getByText('Participação')).toBeInTheDocument()
  })

  it('requisito de leitura mostra o card do livro da classe (pelo manifesto_id); outro tipo não', async () => {
    const s = [{ id: 's', codigo: 'I', nome: 'X', ordem: 1, requisitos: [base({ id: 'l1', codigo: '1', descricao: 'Ler um livro.' }), base({ id: 'o1', codigo: '2', descricao: 'Outro.' })] }]
    carregarMinhaClasse.mockResolvedValue({ ...montar(s), classe: { id: 'c1', nome: 'Classe Teste', manifesto_id: 'amigo' } })
    carregarFormulariosDaClasse.mockResolvedValue({ l1: form() })
    await abrirTela()
    fireEvent.click(linha('l1'))
    fireEvent.click(linha('o1'))
    const [l, o] = screen.getAllByTestId('detalhe-requisito')
    expect(within(l).getByTestId('card-livro-mock')).toHaveTextContent('amigo')
    expect(within(o).queryByTestId('card-livro-mock')).toBeNull()
  })
})
