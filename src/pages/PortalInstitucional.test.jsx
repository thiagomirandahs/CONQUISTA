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
const carregarVisitasDoEscopo = vi.fn()
const agendarVisita = vi.fn()
const atualizarVisita = vi.fn()
vi.mock('../services/institucional.js', () => ({
  carregarPainelAnalitico: (...a) => carregarPainelDoEscopo(...a),
  carregarInvestidurasDoEscopo: (...a) => carregarInvestidurasDoEscopo(...a),
  carregarVisitasDoEscopo: (...a) => carregarVisitasDoEscopo(...a),
  agendarVisita: (...a) => agendarVisita(...a),
  atualizarVisita: (...a) => atualizarVisita(...a),
}))
const { default: PortalInstitucional } = await import('./PortalInstitucional.jsx')

const CAPACIDADES = { ver_clubes: true, ver_painel: true, decidir_workflow: true }
const ESCOPO_DIST = { escopo_id: 'e1', nome: 'Distrito Teste', tipo: 'distrito', papel: 'coordenador_distrital', em_uso: true, capacidades: CAPACIDADES }
const CLUBE = {
  club_id: 'c1', nome: 'Clube Teste', status: 'ativo',
  distrito: { id: 'e1', nome: 'Distrito Teste' }, regiao: null,
  membros: { total: 23, por_papel: { desbravador: 18, diretoria: 2, conselheiro: 3 } }, unidades: 4,
  classes: { em_andamento: 7, concluidas: 3, investidas: 5, por_classe: [{ classe: 'Amigo', em_andamento: 4, concluidas: 1, investidas: 2 }] },
  avaliacoes_pendentes: 2, atividade: { ativos_7d: 10, ativos_30d: 20, ultimo_uso: '2026-09-25', envios_30d: 12 },
  cadastro: { status_clube: 'ativo', assinatura: 'ativa', valida_ate: '2027-01-01' },
  pendencias: { cadastros: 1, pedido_regiao: false }, proxima_visita: null,
}
const PAINEL = {
  escopo: { id: 'e1', nome: 'Distrito Teste', tipo: 'distrito' }, filtros: [], clubes: [CLUBE],
  totais: { clubes: 1, membros: 23, unidades: 4, classes_em_andamento: 7, classes_concluidas: 3, classes_investidas: 5,
            avaliacoes_pendentes: 2, ativos_30d: 20, cadastros_pendentes: 1, visitas_agendadas: 0, por_papel: {} },
}
const trocarEscopo = vi.fn()
const renderT = () => render(<MemoryRouter><PortalInstitucional /></MemoryRouter>)

beforeEach(() => {
  escopo = { carregando: false, erro: null, escopos: [ESCOPO_DIST], escopo: ESCOPO_DIST, escopoId: 'e1', temEscopo: true, capacidades: CAPACIDADES, trocarEscopo }
  carregarPainelDoEscopo.mockReset().mockResolvedValue(PAINEL)
  carregarVisitasDoEscopo.mockReset().mockResolvedValue([])
  agendarVisita.mockReset().mockResolvedValue({ ok: true })
  atualizarVisita.mockReset().mockResolvedValue({ ok: true })
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

  it('painel: nome do clube, totais e só CONTAGENS agregadas', async () => {
    renderT()
    expect(await screen.findByText('Clube Teste')).toBeInTheDocument()
    expect(screen.getByText('23 membros')).toBeInTheDocument()
    const totais = screen.getByTestId('painel-totais')
    expect(within(totais).getByText('Classes em andamento').parentElement).toHaveTextContent('7')
    expect(within(totais).getByText('Investidos').parentElement).toHaveTextContent('5')
    expect(screen.getByText('Assinatura ativa')).toBeInTheDocument()
  })

  it('abrir o clube mostra papéis e classes e permite agendar visita', async () => {
    renderT()
    await userEvent.click(await screen.findByRole('button', { name: /Clube Teste/ }))
    expect(screen.getByText('Desbravadores').parentElement).toHaveTextContent('18')
    expect(screen.getByText('Amigo').parentElement).toHaveTextContent('4 · 1 · 2')
    await userEvent.click(screen.getByRole('button', { name: 'Agendar visita' }))
    expect(screen.getByTestId('agendar-visita')).toHaveTextContent('Agendar visita — Clube Teste')
  })

  it('com filtros no escopo, trocar o filtro recarrega o painel com a unidade', async () => {
    carregarPainelDoEscopo.mockResolvedValue({ ...PAINEL, filtros: [{ id: 'd9', nome: 'Distrito 9', tipo: 'distrito' }] })
    renderT()
    const sel = await screen.findByLabelText('Filtrar por região/distrito')
    await userEvent.selectOptions(sel, 'd9')
    expect(carregarPainelDoEscopo).toHaveBeenLastCalledWith('d9')
  })

  it('visita: quem agendou vê o relatório e pode registrar a realização', async () => {
    carregarVisitasDoEscopo.mockResolvedValue([{
      id: 'v1', club_id: 'c1', clube: 'Clube Teste', agendada_para: '2026-10-01T12:00:00Z', objetivo: 'Conhecer', status: 'confirmada',
      agendada_por: { nome: 'Coord', papel: 'coordenador_distrital', unidade: { nome: 'Distrito Teste' } }, pode_editar: true,
    }])
    renderT()
    await userEvent.click(await screen.findByRole('button', { name: 'Realizada' }))
    await userEvent.type(screen.getByLabelText('Relatório curto da visita'), 'Clube muito organizado.')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(atualizarVisita).toHaveBeenCalledWith('v1', 'realizada', { quando: null, texto: 'Clube muito organizado.' })
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
