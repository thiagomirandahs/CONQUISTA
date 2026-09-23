// Construtor no-code (fase 6): a liderança escolhe de LISTAS FECHADAS. A tela nunca monta expressão
// e nunca inventa um campo — ela envia a configuração e mostra o erro do servidor quando ele recusa.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const salvarExperiencia = vi.fn()
const salvarEtapa = vi.fn()
const definirPublico = vi.fn()
const mudarEstado = vi.fn()
const carregarExperiencia = vi.fn()
const carregarModelos = vi.fn()
const copiarModelo = vi.fn()
const carregarPendentes = vi.fn()
const avaliarEnvio = vi.fn()
vi.mock('../services/experiencias.js', async () => {
  const real = await vi.importActual('../services/experiencias.js')
  return {
    ...real,
    salvarExperiencia: (...a) => salvarExperiencia(...a),
    salvarEtapa: (...a) => salvarEtapa(...a),
    definirPublico: (...a) => definirPublico(...a),
    mudarEstado: (...a) => mudarEstado(...a),
    carregarExperiencia: (...a) => carregarExperiencia(...a),
    carregarModelos: (...a) => carregarModelos(...a),
    copiarModelo: (...a) => copiarModelo(...a),
    carregarPendentes: (...a) => carregarPendentes(...a),
    avaliarEnvio: (...a) => avaliarEnvio(...a),
  }
})
vi.mock('../lib/supabase.js', () => ({
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [{ id: 'u1', nome: 'Unidade A1' }] }) }) }) },
}))
const { default: ExperienciaEditor } = await import('./ExperienciaEditor.jsx')

const RASCUNHO = { id: 'e1', titulo: 'Novo desafio', tipo: 'desafio_individual', status: 'rascunho', etapas: [] }
const renderT = () => render(<MemoryRouter><ExperienciaEditor /></MemoryRouter>)

beforeEach(() => {
  salvarExperiencia.mockReset().mockResolvedValue({ id: 'e1' })
  salvarEtapa.mockReset().mockResolvedValue({ id: 'st1' })
  definirPublico.mockReset().mockResolvedValue({ ok: true })
  mudarEstado.mockReset().mockResolvedValue({ ok: true, status: 'publicada' })
  carregarExperiencia.mockReset().mockResolvedValue(RASCUNHO)
  carregarModelos.mockReset().mockResolvedValue([])
  copiarModelo.mockReset().mockResolvedValue({ id: 'e9' })
  carregarPendentes.mockReset().mockResolvedValue([])
  avaliarEnvio.mockReset().mockResolvedValue({})
})

describe('ExperienciaEditor', () => {
  it('só oferece tipos, regras e recompensas do vocabulário fechado', async () => {
    renderT()
    const tipo = await screen.findByLabelText('Tipo')
    const valores = [...tipo.querySelectorAll('option')].map((o) => o.value)
    expect(valores).toEqual(expect.arrayContaining(['desafio_individual', 'quiz', 'meta_quantitativa', 'checkin']))
    // nada de campo livre pra "regra": só as três opções que o servidor conhece
    const conclusao = screen.getByLabelText('Conclui quando')
    expect([...conclusao.querySelectorAll('option')].map((o) => o.value))
      .toEqual(['todas_etapas', 'minimo_etapas', 'aprovacao_lideranca'])
  })

  it('cria o rascunho mandando regra e recompensa como DADO declarativo', async () => {
    renderT()
    await userEvent.type(await screen.findByLabelText('Título'), 'Novo desafio')
    await userEvent.selectOptions(screen.getByLabelText('Recompensa'), 'pontos')
    await userEvent.clear(screen.getByLabelText('Pontos'))
    await userEvent.type(screen.getByLabelText('Pontos'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }))
    expect(salvarExperiencia).toHaveBeenCalledWith(null, expect.objectContaining({
      titulo: 'Novo desafio',
      regra_conclusao: { tipo: 'todas_etapas' },
      recompensa: { tipo: 'pontos', valor: 30 },
    }))
  })

  it('erro do servidor (vocabulário) aparece na tela, como veio', async () => {
    salvarExperiencia.mockRejectedValue(new Error('O campo "título" não aceita HTML (os sinais < e >). Escreva só texto.'))
    renderT()
    await userEvent.type(await screen.findByLabelText('Título'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/não aceita HTML/)
  })

  it('com o rascunho aberto, adiciona etapa escolhendo a evidência de uma lista fechada', async () => {
    renderT()
    await userEvent.type(await screen.findByLabelText('Título'), 'Novo desafio')
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }))
    await screen.findByTestId('editor-aberto')
    const evid = screen.getByLabelText('O que a pessoa entrega')
    expect([...evid.querySelectorAll('option')].map((o) => o.value))
      .toEqual(['nenhuma', 'confirmacao', 'texto', 'foto', 'arquivo', 'quiz', 'contagem', 'checkin'])
    await userEvent.type(screen.getByLabelText('Título da etapa'), 'Marque quando ler')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar etapa' }))
    expect(salvarEtapa).toHaveBeenCalledWith('e1', null, expect.objectContaining({
      titulo: 'Marque quando ler', evidencia: 'confirmacao', regra: {},
    }))
  })

  it('define o público de forma declarativa e publica', async () => {
    renderT()
    await userEvent.type(await screen.findByLabelText('Título'), 'Novo desafio')
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }))
    await screen.findByTestId('editor-aberto')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar público' }))
    expect(definirPublico).toHaveBeenCalledWith('e1', [{ tipo: 'todos' }])
    await userEvent.click(screen.getByTestId('publicar'))
    expect(mudarEstado).toHaveBeenCalledWith('e1', 'publicada')
  })

  it('avisa que publicado não muda mais de estrutura', async () => {
    renderT()
    await userEvent.type(await screen.findByLabelText('Título'), 'Novo desafio')
    await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }))
    expect(await screen.findByText(/Depois de publicada, a estrutura não muda mais/)).toBeInTheDocument()
    expect(screen.getByText(/crie uma versão nova/i)).toBeInTheDocument()
  })

  it('modelo da plataforma é COPIADO e a tela diz que mudar o modelo depois não muda o publicado', async () => {
    carregarModelos.mockResolvedValue([{ chave: 'leitura-da-semana', versao: 1, titulo: 'Leitura da semana', tipo: 'desafio_individual' }])
    renderT()
    expect(await screen.findByText(/se a plataforma\s+mudar o modelo depois, o que você publicou não muda/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(copiarModelo).toHaveBeenCalledWith('leitura-da-semana')
  })

  it('mostra a fila de validação da liderança e aprova', async () => {
    carregarPendentes.mockResolvedValue([{ id: 's1', quem: 'Unidade A1', experiencia: 'Mutirão', etapa: 'Foto', texto: null }])
    renderT()
    expect(await screen.findByText(/Esperando a sua validação \(1\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(avaliarEnvio).toHaveBeenCalledWith('s1', 'aprovada')
  })
})
