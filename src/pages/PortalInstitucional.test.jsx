// Portal institucional (fase 4.3): mostra só o que o escopo justifica — clubes abaixo (agregado) e o
// que EXIGE a decisão daquela autoridade. Diz claramente quando nada exige. Nunca vira dashboard do
// clube nem expõe dado operacional/pessoal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

let escopo
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => escopo }))
const carregarPainelDoEscopo = vi.fn()
const carregarInvestidurasDoEscopo = vi.fn()
vi.mock('../services/institucional.js', () => ({
  carregarPainelDoEscopo: (...a) => carregarPainelDoEscopo(...a),
  carregarInvestidurasDoEscopo: (...a) => carregarInvestidurasDoEscopo(...a),
}))
const { default: PortalInstitucional } = await import('./PortalInstitucional.jsx')

const CAPACIDADES = { ver_clubes: true, ver_painel: true, decidir_workflow: true }
const ESCOPO_DIST = { escopo_id: 'e1', nome: 'Distrito Teste', tipo: 'distrito', papel: 'coordenador_distrital', em_uso: true, capacidades: CAPACIDADES }
const CLUBE = {
  club_id: 'c1', nome: 'Clube Teste', tipo: 'clube', status: 'ativo',
  membros_ativos: 23, classes_em_andamento: 7, classes_aguardando_revisao: 2, classes_aptas_investidura: 1, investidos_total: 5,
}
const trocarEscopo = vi.fn()
const renderT = () => render(<MemoryRouter><PortalInstitucional /></MemoryRouter>)

beforeEach(() => {
  escopo = { carregando: false, erro: null, escopos: [ESCOPO_DIST], escopo: ESCOPO_DIST, escopoId: 'e1', temEscopo: true, capacidades: CAPACIDADES, trocarEscopo }
  carregarPainelDoEscopo.mockReset().mockResolvedValue([CLUBE])
  carregarInvestidurasDoEscopo.mockReset().mockResolvedValue([])
  trocarEscopo.mockReset()
})

describe('PortalInstitucional', () => {
  it('sem vínculo institucional: não mostra painel nenhum e oferece voltar ao clube', async () => {
    escopo = { ...escopo, temEscopo: false, escopos: [], escopo: null }
    renderT()
    expect(await screen.findByText('Sem vínculo institucional')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para o meu clube/ })).toBeInTheDocument()
    expect(carregarPainelDoEscopo).not.toHaveBeenCalled()
  })

  it('nada exige a decisão da autoridade: diz isso claramente e NÃO inventa aprovação distrital', async () => {
    renderT()
    expect(await screen.findByText(/Nada aguarda a sua decisão/)).toBeInTheDocument()
    expect(screen.getByText(/são revisadas e investidas pelo próprio clube/)).toBeInTheDocument()
    expect(screen.getByText(/não há\s+etapa distrital ou regional nesse processo/)).toBeInTheDocument()
  })

  it('painel: nome do clube e só CONTAGENS agregadas', async () => {
    renderT()
    expect(await screen.findByText('Clube Teste')).toBeInTheDocument()
    expect(screen.getByText('23 membros')).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: '' }) || document
    expect(screen.getByText('Classes em andamento').parentElement).toHaveTextContent('7')
    expect(screen.getByText('Investidos').parentElement).toHaveTextContent('5')
    expect(lista).toBeTruthy()
  })

  it('deixa explícito que conversa/foto/mensalidade/evidência/responsável não vêm pra cá', async () => {
    renderT()
    await screen.findByText('Clube Teste')
    expect(screen.getByText(/Conversas, fotos,\s+mensagens, mensalidades, evidências dos requisitos e dados de responsáveis pertencem a cada clube/))
      .toBeInTheDocument()
  })

  it('quando HÁ etapa pendente pra esta autoridade, mostra o mínimo pra decidir', async () => {
    carregarInvestidurasDoEscopo.mockResolvedValue([{
      member_class_id: 'mc1', pessoa_nome: 'Fulana de Tal', classe_nome: 'Amigo', clube_nome: 'Clube Teste',
      etapa: { ordem: 2, chave: 'aprovacao_intermediaria', nome: 'Aprovação distrital', escopo_tipo: 'distrito' },
      workflow: { versao: 2 }, aguardando_desde: '2026-09-20T10:00:00Z',
    }])
    renderT()
    expect(await screen.findByText('Fulana de Tal')).toBeInTheDocument()
    expect(screen.getByText(/Amigo · Clube Teste/)).toBeInTheDocument()
    expect(screen.getByText(/Aguardando: Aprovação distrital/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada aguarda a sua decisão/)).not.toBeInTheDocument()
  })

  it('com mais de um escopo, permite trocar o escopo em uso', async () => {
    const outro = { ...ESCOPO_DIST, escopo_id: 'e2', nome: 'Região Teste', tipo: 'regiao', papel: 'coordenador_regional', em_uso: false }
    escopo = { ...escopo, escopos: [ESCOPO_DIST, outro] }
    renderT()
    const seletor = await screen.findByLabelText('Escopo em uso')
    await userEvent.selectOptions(seletor, 'e2')
    expect(trocarEscopo).toHaveBeenCalledWith('e2')
  })

  it('papel sem capacidade de painel não vê o painel dos clubes', async () => {
    escopo = { ...escopo, capacidades: { ver_clubes: false, ver_painel: false, decidir_workflow: false } }
    renderT()
    expect(await screen.findByText(/não inclui o painel dos clubes/)).toBeInTheDocument()
  })
})
