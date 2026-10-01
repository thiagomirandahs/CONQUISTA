// Relato complementar (520) em Minhas Especialidades: mesmo bloco, mesmos componentes; sem a 520 nada aparece.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ m: { div: () => <div /> } }))
const carregarMinhaEspecialidade = vi.fn()
const buscarEspecialidades = vi.fn()
const enviarRequisitoEspecialidade = vi.fn()
const salvarRelatoEspecialidade = vi.fn()
const ordem = []
vi.mock('../lib/dados.js', () => ({
  carregarMinhaEspecialidade: (...a) => carregarMinhaEspecialidade(...a),
  buscarEspecialidades: (...a) => buscarEspecialidades(...a),
  iniciarEspecialidade: vi.fn(),
  salvarRequisitoEspecialidade: vi.fn(),
  enviarRequisitoEspecialidade: (...a) => enviarRequisitoEspecialidade(...a),
  salvarRelatorioEspecialidade: vi.fn(),
  salvarRelatoEspecialidade: (...a) => salvarRelatoEspecialidade(...a),
  carregarHistoricoEspecialidade: vi.fn(),
  subirAnexoDeRelatorio: vi.fn(),
}))
const { default: MinhasEspecialidades } = await import('./MinhasEspecialidades.jsx')

const req = (over) => ({
  id: 'r', codigo: '1', descricao: 'Requisito', tipo_evidencia: 'nenhuma', status: 'nao_iniciado', avaliacoes: [], bloqueios: [], anexos: [], rascunho: null,
  modelo: null, grupo: null, depende_de: null, prazo_dias: null, prazo_em: null, tentativas: 0, member_specialty_requirement_id: null, relato: null, rascunho_em: null, ...over,
})
const dados = (requisitos) => ({
  member_specialty: { id: 'ms1', status: 'em_andamento', iniciada_em: '2026-09-01T10:00:00Z', percentual: 25 },
  especialidade: { nome: 'Especialidade Teste' }, curriculum_version: { origem: 'oficial' }, oferta: null, grupos: [], requisitos,
})
const card = (cod) => screen.getAllByTestId('requisito-especialidade').find((n) => n.textContent.includes(`${cod}. `))

beforeEach(() => {
  ordem.length = 0
  localStorage.clear()
  buscarEspecialidades.mockReset().mockResolvedValue({ itens: [{ specialty_id: 'a', codigo: 'A', nome: 'Espec a', categoria: 'Artes', nivel: 1, total_requisitos: 3, situacao: 'em_andamento', member_specialty_id: 'ms-a', percentual: 30, dependencias_pendentes: [] }], proximo: null, total: 1, areas: [] })
  carregarMinhaEspecialidade.mockReset().mockResolvedValue(dados([
    req({ id: 'a', codigo: '1', descricao: 'Sem evidência.' }),
    req({ id: 'b', codigo: '2', descricao: 'Aguardando.', status: 'aguardando_avaliacao', relato: 'Meu relato enviado' }),
  ]))
  salvarRelatoEspecialidade.mockReset().mockImplementation(async () => { ordem.push('relato') })
  enviarRequisitoEspecialidade.mockReset().mockImplementation(async () => { ordem.push('enviar') })
})

describe('MinhasEspecialidades — relato complementar', () => {
  it('requisito sem evidência ganha o bloco; sem relato envia direto', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    const c = card('1')
    expect(within(c).getByLabelText('Relato / comprovação (opcional)')).toBeInTheDocument()
    await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'Enviar para avaliação' })) })
    expect(salvarRelatoEspecialidade).not.toHaveBeenCalled()
    expect(enviarRequisitoEspecialidade).toHaveBeenCalledWith('a')
  })

  it('enviar COM relato grava o relato antes de enviar', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    const c = card('1')
    fireEvent.change(within(c).getByLabelText('Relato / comprovação (opcional)'), { target: { value: 'Pesquisei com o instrutor' } })
    await act(async () => { fireEvent.click(within(c).getByRole('button', { name: 'Enviar para avaliação' })) })
    expect(salvarRelatoEspecialidade).toHaveBeenCalledWith({ requirementId: 'a', relato: 'Pesquisei com o instrutor' })
    expect(ordem).toEqual(['relato', 'enviar'])
  })

  it('aguardando avaliação: só leitura do relato', async () => {
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    const c = card('2')
    expect(within(c).queryByTestId('relato-complementar')).toBeNull()
    expect(within(c).getByTestId('relato-do-membro')).toHaveTextContent('Meu relato enviado')
  })

  it('banco sem a 520 (sem a chave): nenhum bloco', async () => {
    carregarMinhaEspecialidade.mockResolvedValue(dados([req({ id: 'a', codigo: '1', descricao: 'Sem evidência.', relato: undefined, rascunho_em: undefined })].map(({ relato, rascunho_em, ...r }) => r))) // eslint-disable-line no-unused-vars
    render(<MinhasEspecialidades />)
    await screen.findAllByTestId('requisito-especialidade')
    expect(within(card('1')).queryByTestId('relato-complementar')).toBeNull()
  })
})
