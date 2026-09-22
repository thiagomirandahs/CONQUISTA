// Fase 4: os estados da conclusão em Minha Classe — 100% aprovado NÃO é "investido". Cada etapa
// (requisitos concluídos, aguardando revisão final, apto para investidura, investida, correção
// pedida na revisão) vem do servidor e é apresentada com ícone + texto.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ motion: { div: (p) => <div {...Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'transition'].includes(k)))} /> } }))
const carregarMinhaClasse = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarClassesDisponiveis: vi.fn().mockResolvedValue([]),
  iniciarClasse: vi.fn(), salvarRequisito: vi.fn(), enviarRequisito: vi.fn(), escolherOpcoesRequisito: vi.fn(), carregarOrigemRequisito: vi.fn(),
}))
const { default: MinhaClasse } = await import('./MinhaClasse.jsx')

const payload = (status, conclusao = {}) => ({
  member_class: { id: 'mc1', status, iniciada_em: '2026-09-01', percentual: 100, investida_em: null },
  classe: { id: 'c1', nome: 'Classe Teste', idade_minima: 10, vigente_desde: '2026-01-01' },
  curriculum_version: { origem: 'oficial', identificador: 'teste', versao: '9.9' },
  conclusao: { snapshot: null, revisao: null, investidura: null, ...conclusao },
  secoes: [{ id: 's1', codigo: 'I', nome: 'Seção', ordem: 10, requisitos: [
    { id: 'r1', codigo: '1', descricao: 'Requisito de teste.', status: 'aprovado', tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null, conteudo_dinamico: null, bloqueios: [] },
  ] }],
})

beforeEach(() => carregarMinhaClasse.mockReset())

describe('MinhaClasse — etapas da conclusão', () => {
  it('requisitos_concluidos: "sendo validada", sem dizer investido', async () => {
    carregarMinhaClasse.mockResolvedValue(payload('requisitos_concluidos'))
    render(<MinhaClasse />)
    const etapa = await screen.findByTestId('etapa')
    expect(etapa).toHaveAttribute('data-etapa', 'requisitos_concluidos')
    expect(etapa).toHaveTextContent(/sendo validada/)
    expect(screen.queryByText(/Investido/)).not.toBeInTheDocument()
  })
  it('aguardando_revisao: aguardando a revisão final', async () => {
    carregarMinhaClasse.mockResolvedValue(payload('aguardando_revisao', { snapshot: { id: 's', versao: 1, hash: 'a'.repeat(64), status: 'selado' }, revisao: { status: 'pendente' } }))
    render(<MinhaClasse />)
    expect(await screen.findByTestId('etapa')).toHaveTextContent(/Aguardando a revisão final/)
  })
  it('apto_investidura: apto ≠ investido; mostra quem aprovou a revisão', async () => {
    carregarMinhaClasse.mockResolvedValue(payload('apto_investidura', { revisao: { status: 'aprovado', revisado_em: '2026-09-20T10:00:00Z', revisado_por_nome: 'Líder A' } }))
    render(<MinhaClasse />)
    const etapa = await screen.findByTestId('etapa')
    expect(etapa).toHaveTextContent(/apto\(a\) para a investidura/)
    expect(etapa).toHaveTextContent(/por Líder A/)
    expect(screen.queryByText(/Investido\(a\) nesta classe/)).not.toBeInTheDocument()
  })
  it('investida: com a data do evento de investidura', async () => {
    carregarMinhaClasse.mockResolvedValue(payload('investida', { investidura: { data: '2026-09-21', status: 'registrada', registrado_por_nome: 'Líder A' } }))
    render(<MinhaClasse />)
    expect(await screen.findByTestId('etapa')).toHaveTextContent('Investido(a) nesta classe em 21/09/2026!')
  })
  it('correção pedida na revisão final: aviso com o comentário e volta a em_andamento', async () => {
    carregarMinhaClasse.mockResolvedValue(payload('em_andamento', { revisao: { status: 'correcao_solicitada', comentario: 'Refaça o I.2' } }))
    render(<MinhaClasse />)
    expect(await screen.findByText(/A revisão final pediu correção: "Refaça o I.2"/)).toBeInTheDocument()
    expect(screen.queryByTestId('etapa')).not.toBeInTheDocument()
  })
})
