// Relato complementar (520) em Minha Classe: bloco COMPROVAÇÃO em TODO requisito editável, junto da foto/texto/formulário,
// envio sem relato permitido, relato gravado ANTES do envio, e banco sem a 520 sem o bloco.
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
const salvarRelatoRequisito = vi.fn()
const salvarRequisito = vi.fn()
const enviarRequisito = vi.fn()
const ordem = []
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarMinhasClasses: vi.fn().mockResolvedValue([]),
  carregarClassesDisponiveis: vi.fn().mockResolvedValue([]),
  iniciarClasse: vi.fn(),
  salvarRequisito: (...a) => salvarRequisito(...a),
  enviarRequisito: (...a) => enviarRequisito(...a),
  escolherOpcoesRequisito: vi.fn(),
  carregarOrigemRequisito: vi.fn(),
  carregarHistoricoRequisito: vi.fn(),
  carregarFormularioRequisito: (...a) => carregarFormularioRequisito(...a),
  carregarFormulariosDaClasse: (...a) => carregarFormulariosDaClasse(...a),
  salvarRelatorioRequisito: (...a) => salvarRelatorioRequisito(...a),
  salvarRelatoRequisito: (...a) => salvarRelatoRequisito(...a),
  subirAnexoDeRelatorio: vi.fn(),
}))

const { default: MinhaClasse } = await import('./MinhaClasse.jsx')

const base = (over) => ({ tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null, conteudo_dinamico: null, bloqueios: [], status: 'nao_iniciado', relato: null, rascunho_em: null, ...over })
const requisitos = () => [
  base({ id: 'rn', codigo: '1', descricao: 'Sem evidência.', member_requirement_id: 'mrn' }),
  base({ id: 'rf', codigo: '2', descricao: 'Com foto.', tipo_evidencia: 'foto', member_requirement_id: 'mrf' }),
  base({ id: 'rt', codigo: '3', descricao: 'Com texto.', tipo_evidencia: 'texto', evidencia_obrigatoria: false, member_requirement_id: 'mrt' }),
  base({ id: 'rm', codigo: '4', descricao: 'Com formulário.', member_requirement_id: 'mrm' }),
  base({ id: 'rr', codigo: '5', descricao: 'Aguardando.', status: 'aguardando_avaliacao', relato: 'Meu relato enviado', member_requirement_id: 'mrr' }),
]
const minha = (reqs) => ({
  member_class: { id: 'mc1', status: 'em_andamento', iniciada_em: '2026-09-01', percentual: 0 },
  classe: { id: 'c1', nome: 'Classe Teste 1' },
  curriculum_version: { origem: 'oficial', versao: '9.9' },
  conclusao: { snapshot: null, revisao: null, investidura: null },
  secoes: [{ id: 's1', codigo: 'I', nome: 'Seção', ordem: 1, requisitos: reqs }],
})
const MODELO = { versao: 1, familia: 'T1', nota: null, schema: { versao: 1, campos: [{ chave: 'resumo', tipo: 'texto_longo', rotulo: 'Conte o que fez', obrigatorio: true }] } }

const abrir = (a) => { const t = within(a).getByTestId('abrir-requisito'); if (t.getAttribute('aria-expanded') === 'false') fireEvent.click(t); return a }
const card = (codigo) => abrir(screen.getAllByTestId('requisito').find((a) => within(a).getByTestId('requisito-texto').textContent.startsWith(codigo + '. ')))
const montar = async () => { render(<MemoryRouter><MinhaClasse /></MemoryRouter>); await screen.findAllByTestId('requisito') }

beforeEach(() => {
  ordem.length = 0
  localStorage.clear()
  carregarMinhaClasse.mockReset().mockResolvedValue(minha(requisitos()))
  carregarFormularioRequisito.mockReset().mockResolvedValue({ status: 'em_andamento', relato: null, rascunho_em: null })
  carregarFormulariosDaClasse.mockReset().mockResolvedValue({ rm: { modelo: MODELO, member_requirement_id: 'mrm', status: 'nao_iniciado', rascunho: null, anexos: [], tentativas: 0 } })
  salvarRelatorioRequisito.mockReset().mockImplementation(async () => { ordem.push('form') })
  salvarRelatoRequisito.mockReset().mockImplementation(async () => { ordem.push('relato') })
  salvarRequisito.mockReset().mockResolvedValue()
  enviarRequisito.mockReset().mockImplementation(async () => { ordem.push('enviar') })
})

describe('MinhaClasse — bloco COMPROVAÇÃO (relato complementar)', () => {
  it('requisito SEM tipo de evidência passa a ter o campo, e o botão de enviar segue lá', async () => {
    await montar()
    const c = card('1')
    expect(within(c).getByTestId('relato-complementar')).toBeInTheDocument()
    expect(within(c).getByLabelText('Relato / comprovação (opcional)')).toBeInTheDocument()
    expect(within(c).getByText('Conte ao instrutor como você cumpriu este requisito.')).toBeInTheDocument()
    expect(within(c).getByTestId('botao-enviar')).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Salvar rascunho' })).toBeInTheDocument()
  })

  it('requisito com FOTO: o bloco aparece JUNTO da zona de foto (nada some)', async () => {
    await montar()
    const c = card('2')
    expect(within(c).getByTestId('relato-complementar')).toBeInTheDocument()
    expect(within(c).getByText(/Foto de comprovação/)).toBeInTheDocument()
  })

  it('requisito com TEXTO: continua a "Sua resposta" e o relato é complementar', async () => {
    await montar()
    const c = card('3')
    expect(within(c).getByLabelText(/Sua resposta/)).toBeInTheDocument()
    expect(within(c).getByTestId('relato-complementar')).toBeInTheDocument()
  })

  it('requisito com FORMULÁRIO: campo à parte, junto do formulário', async () => {
    await montar()
    const c = card('4')
    expect(within(c).getByTestId('formulario-relatorio')).toBeInTheDocument()
    expect(within(c).getByTestId('relato-complementar')).toBeInTheDocument()
    expect(within(c).getByLabelText(/Conte o que fez/)).toBeInTheDocument()
  })

  it('enviar SEM relato continua permitido (não vira obrigação) e não chama o relato', async () => {
    await montar()
    const c = card('1')
    await act(async () => { fireEvent.click(within(c).getByTestId('botao-enviar')) })
    expect(salvarRelatoRequisito).not.toHaveBeenCalled()
    expect(enviarRequisito).toHaveBeenCalledWith('rn')
  })

  it('enviar COM relato: grava o relato ANTES de enviar; nada é enviado só por digitar', async () => {
    await montar()
    const c = card('1')
    fireEvent.change(within(c).getByLabelText('Relato / comprovação (opcional)'), { target: { value: 'Fizemos juntos no sábado' } })
    expect(enviarRequisito).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(c).getByTestId('botao-enviar')) })
    expect(salvarRelatoRequisito).toHaveBeenCalledWith({ requirementId: 'rn', relato: 'Fizemos juntos no sábado' })
    expect(enviarRequisito).toHaveBeenCalledWith('rn')
    expect(ordem).toEqual(['relato', 'enviar'])
  })

  it('formulário + relato: relato, depois rascunho do formulário, depois o envio', async () => {
    await montar()
    const c = card('4')
    fireEvent.change(within(c).getByLabelText(/Conte o que fez/), { target: { value: 'Fiz tudo' } })
    fireEvent.change(within(c).getByLabelText('Relato / comprovação (opcional)'), { target: { value: 'Com a minha unidade' } })
    await act(async () => { fireEvent.click(within(c).getByTestId('botao-enviar-relatorio')) })
    expect(ordem).toEqual(['relato', 'form', 'enviar'])
  })

  it('"Salvar rascunho" grava o relato sem enviar', async () => {
    await montar()
    const c = card('1')
    fireEvent.change(within(c).getByLabelText('Relato / comprovação (opcional)'), { target: { value: 'rascunho' } })
    await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'Salvar rascunho' })) })
    expect(salvarRelatoRequisito).toHaveBeenCalledWith({ requirementId: 'rn', relato: 'rascunho' })
    expect(salvarRequisito).not.toHaveBeenCalled() // sem evidência: nada de requisito_salvar
    expect(enviarRequisito).not.toHaveBeenCalled()
  })

  it('relato já salvo volta preenchido', async () => {
    carregarMinhaClasse.mockResolvedValue(minha([base({ id: 'rn', codigo: '1', descricao: 'Sem evidência.', status: 'em_andamento', relato: 'texto salvo', member_requirement_id: 'mrn' })]))
    await montar()
    expect(within(card('1')).getByLabelText('Relato / comprovação (opcional)')).toHaveValue('texto salvo')
  })

  it('requisito aguardando avaliação: sem campo, mostra "Seu relato" só leitura', async () => {
    await montar()
    const c = card('5')
    expect(within(c).queryByTestId('relato-complementar')).toBeNull()
    expect(within(c).getByTestId('relato-do-membro')).toHaveTextContent('Meu relato enviado')
  })

  it('banco SEM a 520 (payload sem `relato`): nenhum bloco e tudo como antes', async () => {
    carregarMinhaClasse.mockResolvedValue(minha(requisitos().map(({ relato, rascunho_em, ...r }) => r))) // eslint-disable-line no-unused-vars
    await montar()
    for (const n of ['1', '2', '3', '4']) expect(within(card(n)).queryByTestId('relato-complementar')).toBeNull()
    const c = card('1')
    await act(async () => { fireEvent.click(within(c).getByTestId('botao-enviar')) })
    expect(enviarRequisito).toHaveBeenCalledWith('rn')
    expect(salvarRelatoRequisito).not.toHaveBeenCalled()
  })
})
