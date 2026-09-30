// Motor de relatório em Minha Classe: requisito COM formulário usa o formulário novo; requisito SEM
// formulário (ou servidor sem a RPC) segue com a caixa de texto/foto de sempre.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ m: { div: () => <div /> } }))

const carregarMinhaClasse = vi.fn()
const carregarFormulariosDaClasse = vi.fn()
const carregarFormularioRequisito = vi.fn()
const salvarRelatorioRequisito = vi.fn()
const enviarRequisito = vi.fn()
const carregarHistoricoRequisito = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarMinhasClasses: vi.fn().mockResolvedValue([]),
  carregarClassesDisponiveis: vi.fn().mockResolvedValue([]),
  iniciarClasse: vi.fn(),
  salvarRequisito: vi.fn(),
  enviarRequisito: (...a) => enviarRequisito(...a),
  escolherOpcoesRequisito: vi.fn(),
  carregarOrigemRequisito: vi.fn(),
  carregarHistoricoRequisito: (...a) => carregarHistoricoRequisito(...a),
  carregarFormularioRequisito: (...a) => carregarFormularioRequisito(...a),
  carregarFormulariosDaClasse: (...a) => carregarFormulariosDaClasse(...a),
  salvarRelatorioRequisito: (...a) => salvarRelatorioRequisito(...a),
  subirAnexoDeRelatorio: vi.fn(),
}))

const { default: MinhaClasse } = await import('./MinhaClasse.jsx')

const base = (over) => ({ tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null, conteudo_dinamico: null, bloqueios: [], status: 'nao_iniciado', ...over })
const MINHA = {
  member_class: { id: 'mc1', status: 'em_andamento', iniciada_em: '2026-09-01', percentual: 0 },
  classe: { id: 'c1', nome: 'Classe Teste 1' },
  curriculum_version: { origem: 'oficial', versao: '9.9' },
  conclusao: { snapshot: null, revisao: null, investidura: null },
  secoes: [{
    id: 's1', codigo: 'I', nome: 'Seção', ordem: 1,
    requisitos: [
      base({ id: 'rf', codigo: '1', descricao: 'Requisito com formulário.', member_requirement_id: 'mrf' }),
      base({ id: 'ra', codigo: '2', descricao: 'Requisito antigo de texto.', tipo_evidencia: 'texto' }),
      base({ id: 'rc', codigo: '3', descricao: 'Requisito devolvido.', status: 'correcao_solicitada', member_requirement_id: 'mrc',
        avaliacoes: [{ decisao: 'correcao_solicitada', comentario: 'Conte mais detalhes', avaliado_por_nome: 'Ana', avaliado_papel: 'instrutor', created_at: '2026-09-02' }] }),
    ],
  }],
}
const MODELO = { versao: 1, familia: 'T1', nota: null, schema: { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte o que fez', obrigatorio: true }] } }

const card = (codigo) => screen.getAllByTestId('requisito').find((a) => within(a).getByTestId('requisito-texto').textContent.startsWith(codigo + '. '))

beforeEach(() => {
  carregarMinhaClasse.mockReset().mockResolvedValue(MINHA)
  carregarFormularioRequisito.mockReset()
  const form = (rascunho) => ({ modelo: MODELO, member_requirement_id: 'm', status: 'nao_iniciado', rascunho, anexos: [], tentativas: 0 })
  carregarFormulariosDaClasse.mockReset().mockResolvedValue({ rf: form(null), rc: form({ resumo: 'primeira versão' }) })
  salvarRelatorioRequisito.mockReset().mockResolvedValue()
  enviarRequisito.mockReset().mockResolvedValue()
  carregarHistoricoRequisito.mockReset().mockResolvedValue({ requirement_id: 'rf', status_atual: 'x', modelo: MODELO, tentativas: [
    { submission_id: 's1', tentativa_numero: 1, conteudo: { resumo: 'Versão 1 enviada' }, anexos: [], decisao: 'correcao_solicitada', comentario: 'Conte mais detalhes', avaliado_por_nome: 'Ana', avaliado_papel: 'instrutor' },
  ] })
})

describe('MinhaClasse — relatório estruturado', () => {
  it('formulário vem renderizado de imediato, com UMA chamada por carga e nenhuma por requisito', async () => {
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    expect(within(card('1')).getByTestId('formulario-relatorio')).toBeInTheDocument() // síncrono: sem findBy
    expect(carregarFormulariosDaClasse).toHaveBeenCalledTimes(1)
    expect(carregarFormulariosDaClasse).toHaveBeenCalledWith('mc1')
    expect(carregarFormularioRequisito).not.toHaveBeenCalled()
  })

  it('requisito com formulário usa o formulário novo (e não a caixa de texto antiga)', async () => {
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    const c = card('1')
    expect(within(c).getByTestId('formulario-relatorio')).toBeInTheDocument()
    expect(within(c).getByLabelText(/Conte o que fez/)).toBeInTheDocument()
    expect(within(c).queryByLabelText(/Sua resposta/)).toBeNull()
    expect(within(c).queryByTestId('botao-enviar')).toBeNull()
  })

  it('requisito SEM formulário continua exatamente com a UI antiga', async () => {
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    const c = card('2')
    expect(within(c).queryByTestId('formulario-relatorio')).toBeNull()
    expect(within(c).getByLabelText(/Sua resposta/)).toBeInTheDocument()
    expect(within(c).getByTestId('botao-enviar')).toBeInTheDocument()
  })

  it('servidor sem a RPC (carregarFormulariosDaClasse rejeita) cai na UI antiga, sem quebrar', async () => {
    carregarFormulariosDaClasse.mockRejectedValue(new Error('function classe_formularios does not exist'))
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    expect(within(card('2')).getByLabelText(/Sua resposta/)).toBeInTheDocument()
    expect(within(card('1')).queryByTestId('formulario-relatorio')).toBeNull()
  })

  it('enviar salva o rascunho e só então envia; nada é enviado antes do toque', async () => {
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    const c = card('1')
    fireEvent.change(within(c).getByLabelText(/Conte o que fez/), { target: { value: 'Fiz tudo' } })
    expect(enviarRequisito).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(c).getByTestId('botao-enviar-relatorio')) })
    expect(salvarRelatorioRequisito).toHaveBeenCalledWith({ requirementId: 'rf', conteudo: { resumo: 'Fiz tudo' }, anexos: [] })
    expect(enviarRequisito).toHaveBeenCalledWith('rf')
  })

  it('requisito devolvido mostra o comentário em destaque e o que já tinha sido escrito', async () => {
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    const c = card('3')
    expect(within(c).getByTestId('comentario-devolucao')).toHaveTextContent('Conte mais detalhes')
    expect(within(c).getByLabelText(/Conte o que fez/)).toHaveValue('primeira versão')
  })

  it('"Ver histórico" de um requisito com modelo mostra o conteúdo de cada tentativa', async () => {
    render(<MemoryRouter><MinhaClasse /></MemoryRouter>)
    await screen.findAllByTestId('requisito')
    const c = card('3')
    fireEvent.click(within(c).getByRole('button', { name: 'Mais sobre este requisito' }))
    fireEvent.click(await screen.findByRole('button', { name: /Ver histórico \(1 avaliaç/ }))
    expect(await within(c).findByText('Versão 1 enviada')).toBeInTheDocument()
    expect(carregarHistoricoRequisito).toHaveBeenCalledWith('mrc')
  })
})
