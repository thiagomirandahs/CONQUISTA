// Minha Classe consumindo o currículo OFICIAL: tudo vem do banco (nomes, seções, requisitos, regras)
// — a tela não sabe o que é "Amigo" nem quantas seções existem. Fixtures aqui são sintéticas.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ motion: { div: (p) => <div {...Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'transition'].includes(k)))} /> } }))

const carregarMinhaClasse = vi.fn()
const carregarClassesDisponiveis = vi.fn()
const iniciarClasse = vi.fn()
const carregarOrigemRequisito = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarClassesDisponiveis: (...a) => carregarClassesDisponiveis(...a),
  iniciarClasse: (...a) => iniciarClasse(...a),
  salvarRequisito: vi.fn(),
  enviarRequisito: vi.fn(),
  carregarOrigemRequisito: (...a) => carregarOrigemRequisito(...a),
}))

const { default: MinhaClasse } = await import('./MinhaClasse.jsx')

const DISPONIVEIS = [
  { class_id: 'c1', nome: 'Classe Teste 1', idade_minima: 10, elegivel: true, motivo_inelegivel: null, curriculum_version: { origem: 'oficial', versao: '9.9' } },
  { class_id: 'c2', nome: 'Classe Teste 2', idade_minima: 13, elegivel: false, motivo_inelegivel: 'Esta classe é a partir de 13 anos.', curriculum_version: { origem: 'oficial', versao: '9.9' } },
]

const MINHA = {
  member_class: { id: 'mc1', status: 'em_andamento', iniciada_em: '2026-09-01', percentual: 0 },
  classe: { id: 'c1', nome: 'Classe Teste 1', idade_minima: 10, vigente_desde: '2026-01-01' },
  curriculum_version: { origem: 'oficial', identificador: 'teste', versao: '9.9' },
  investidura: null,
  secoes: [{
    id: 's1', nome: 'Seção de Teste', ordem: 10,
    requisitos: [
      { id: 'r1', codigo: '1', descricao: 'Requisito simples de teste.', status: 'nao_iniciado', tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null, conteudo_dinamico: null },
      { id: 'r2', codigo: '2', descricao: 'Requisito anual de teste.', status: 'nao_iniciado', tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null,
        conteudo_dinamico: { chave: 'slot_teste', valor: 'Conteúdo do ano [TESTE]' } },
      { id: 'r3', codigo: '3', descricao: 'Requisito anual sem valor.', status: 'nao_iniciado', tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null,
        conteudo_dinamico: { chave: 'slot_teste_2', valor: null } },
      { id: 'r4', codigo: '4', descricao: 'Requisito de escolha.', status: 'nao_iniciado', tipo_evidencia: 'nenhuma', avaliacoes: [], conteudo_dinamico: null,
        escolha: { grupo_id: 'g1', n_minimo: 1, sem_repeticao: true, pool_sem_repeticao: 'pool', satisfeitas_automaticamente: 0,
          opcoes: [{ id: 'o1', rotulo: 'Opção A' }, { id: 'o2', rotulo: 'Opção B' }, { id: 'o3', rotulo: 'Opção C' }] } },
    ],
  }],
}

beforeEach(() => {
  carregarMinhaClasse.mockReset()
  carregarClassesDisponiveis.mockReset().mockResolvedValue(DISPONIVEIS)
  iniciarClasse.mockReset().mockResolvedValue({ ok: true })
  carregarOrigemRequisito.mockReset()
})

describe('MinhaClasse — seleção de classe', () => {
  it('lista o que o servidor manda, com idade mínima, e só deixa iniciar a elegível', async () => {
    carregarMinhaClasse.mockResolvedValue(null)
    render(<MinhaClasse />)
    expect(await screen.findByText('Classe Teste 1')).toBeInTheDocument()
    expect(screen.getByText('A partir de 10 anos')).toBeInTheDocument()
    expect(screen.getByText('Esta classe é a partir de 13 anos.')).toBeInTheDocument()
    const botoes = screen.getAllByRole('button', { name: 'Iniciar' })
    expect(botoes[0]).toBeEnabled()
    expect(botoes[1]).toBeDisabled()
    await userEvent.click(botoes[0])
    expect(iniciarClasse).toHaveBeenCalledWith('c1')
  })
})

describe('MinhaClasse — requisitos do currículo oficial', () => {
  beforeEach(() => { carregarMinhaClasse.mockResolvedValue(MINHA) })

  it('renderiza seções/requisitos vindos do banco e a linha da versão oficial', async () => {
    render(<MinhaClasse />)
    expect(await screen.findByText('Seção de Teste')).toBeInTheDocument()
    expect(screen.getByText('1. Requisito simples de teste.')).toBeInTheDocument()
    expect(screen.getByText(/Currículo oficial 9\.9/)).toBeInTheDocument()
  })

  it('conteúdo dinâmico: mostra o valor resolvido pelo servidor, ou avisa que o ano não foi cadastrado (não inventa)', async () => {
    render(<MinhaClasse />)
    await screen.findByText('Seção de Teste')
    expect(screen.getByText('Conteúdo do ano [TESTE]')).toBeInTheDocument()
    expect(screen.getByText(/ainda não foi cadastrado/)).toBeInTheDocument()
  })

  it('escolha N-de-M: apresenta n, as opções na ordem e o aviso de não repetir — sem interpretar texto', async () => {
    render(<MinhaClasse />)
    await screen.findByText('Seção de Teste')
    expect(screen.getByText(/Escolha 1 de 3/)).toBeInTheDocument()
    expect(screen.getByText(/não vale repetir/)).toBeInTheDocument()
    const itens = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(itens).toEqual(['Opção A', 'Opção B', 'Opção C'])
  })

  it('"Origem do requisito" busca a proveniência sob demanda e mostra OMD, página oficial e hash', async () => {
    carregarOrigemRequisito.mockResolvedValue({
      requisito: { codigo: '1', descricao: 'Requisito simples de teste.', manifesto_id: 'teste.I.1', status_fonte: 'ALTERADO_POR_OMD',
        alterado_por_omd: { id: 'OMD-999-2020', titulo: 'OMD de teste', data: '2020-01-01', url: 'https://exemplo.test/omd.pdf' } },
      classe: { nome: 'Classe Teste 1', idade_minima: 10, fonte_url: 'https://exemplo.test/classe/', fonte_publicado_em: '2017-01-01', vigente_desde: '2026-01-01' },
      versao: { identificador: 'teste', versao: '9.9', origem: 'oficial', status: 'publicado', fonte_hash: 'abc123', manifesto_versao: '9.9', gerado_em: '2026-09-22', importado_em: '2026-09-22' },
    })
    render(<MinhaClasse />)
    await screen.findByText('Seção de Teste')
    await userEvent.click(screen.getAllByRole('button', { name: 'Origem do requisito' })[0])
    expect(carregarOrigemRequisito).toHaveBeenCalledWith('r1')
    const dialog = await screen.findByRole('dialog', { name: 'Origem do requisito' })
    expect(within(dialog).getByText(/OMD-999-2020/)).toBeInTheDocument()
    expect(within(dialog).getByText(/teste\.I\.1/)).toBeInTheDocument()
    expect(within(dialog).getByText('abc123')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'https://exemplo.test/classe/' })).toHaveAttribute('href', 'https://exemplo.test/classe/')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
