// Portal da coordenação: só o que o escopo justifica — clubes abaixo (agregado), página do clube,
// visitas e classes — e NADA comercial (plano/assinatura/teste). Nunca expõe dado pessoal do clube.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

let escopo
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => escopo }))
const carregarPainel = vi.fn()
const carregarInvestidurasDoEscopo = vi.fn()
const carregarVisitasDoEscopo = vi.fn()
const carregarClubeDetalhe = vi.fn()
const agendarVisita = vi.fn()
const atualizarVisita = vi.fn()
vi.mock('../services/institucional.js', () => ({
  carregarPainelAnalitico: (...a) => carregarPainel(...a),
  carregarInvestidurasDoEscopo: (...a) => carregarInvestidurasDoEscopo(...a),
  carregarVisitasDoEscopo: (...a) => carregarVisitasDoEscopo(...a),
  carregarClubeDetalhe: (...a) => carregarClubeDetalhe(...a),
  agendarVisita: (...a) => agendarVisita(...a),
  atualizarVisita: (...a) => atualizarVisita(...a),
}))
const { default: PortalInstitucional } = await import('./PortalInstitucional.jsx')

const CAPACIDADES = { ver_clubes: true, ver_painel: true, decidir_workflow: true }
const ESCOPO_DIST = { escopo_id: 'e1', nome: 'Distrito Teste', tipo: 'distrito', papel: 'coordenador_distrital', em_uso: true, capacidades: CAPACIDADES }
const CLUBE = {
  club_id: 'c1', nome: 'Clube Teste', status: 'ativo', marca: { logo_url: null, sigla: 'CT', cor: '#112233' },
  distrito: { id: 'e1', nome: 'Distrito Teste' }, regiao: { id: 'r1', nome: 'Região Norte' },
  membros: { total: 23, por_papel: { desbravador: 18, diretoria: 2, conselheiro: 3 } }, unidades: 4,
  classes: { em_andamento: 7, concluidas: 3, investidas: 5, por_classe: [{ classe: 'Amigo', em_andamento: 4, concluidas: 1, investidas: 2 }] },
  avaliacoes_pendentes: 12, investiduras: { previstas: 2, realizadas_mes: 1 },
  atividade: { ativos_7d: 10, ativos_30d: 20, ultimo_uso: '2026-09-25', dias_sem_uso: 1, envios_30d: 12 },
  presenca: { media_pct_30d: 82, reunioes_30d: 4 },
  pendencias: { cadastros: 1, pedido_regiao: false }, proxima_visita: null,
}
const PARADO = { ...CLUBE, club_id: 'c2', nome: 'Clube Parado', avaliacoes_pendentes: 0, atividade: { ativos_7d: 0, ativos_30d: 0, ultimo_uso: '2026-09-01', dias_sem_uso: 25 } }
const PAINEL = {
  escopo: { id: 'e1', nome: 'Distrito Teste', tipo: 'distrito' }, filtros: [], clubes: [CLUBE, PARADO],
  totais: { clubes: 2, membros: 46, unidades: 8, classes_em_andamento: 7, classes_concluidas: 3, classes_investidas: 5,
            avaliacoes_pendentes: 12, ativos_30d: 20, cadastros_pendentes: 1, visitas_agendadas: 0, presenca_media_pct: 82,
            investiduras_mes: 1, investiduras_previstas: 2, por_papel: {} },
}
const DETALHE = {
  clube: { club_id: 'c1', nome: 'Clube Teste', status: 'ativo', marca: CLUBE.marca, distrito: CLUBE.distrito, regiao: CLUBE.regiao },
  membros: { total: 23, desbravadores: 18, lideranca: 5, por_papel: { desbravador: 18, diretoria: 2, conselheiro: 3 }, inicio_do_mes: 20, entraram_no_mes: 3 },
  unidades: [{ id: 'u1', nome: 'Águias', cor: '#ff0000', membros: 6 }, { id: 'u2', nome: 'Leões', cor: '#00ff00', membros: 5 }],
  classes: [{ classe: 'Amigo', tipo: 'regular', em_andamento: 4, concluidas: 1, investidas: 2 },
            { classe: 'Amigo da Natureza', tipo: 'avancada', em_andamento: 1, concluidas: 0, investidas: 0 }],
  avaliacoes_pendentes: 12, cadastros_pendentes: 1,
  presenca: { reunioes: [{ dia: '2026-09-20', presentes: 15, total: 20, pct: 75 }], media_pct: 75, mes_atual_pct: 75, mes_anterior_pct: 70 },
  atividade: { ativos_7d: 10, ativos_30d: 20, ultimo_uso: '2026-09-25', envios_30d: 12 },
  agenda: { proximo_evento: '2026-10-03', eventos_30d: 2 },
  investiduras: { previstas: 2, realizadas_mes: 1, realizadas_ano: 9, ultima: '2026-09-10' },
  pendencias: { pedido_regiao: false },
}
const trocarEscopo = vi.fn()
const renderT = () => render(<MemoryRouter><PortalInstitucional /></MemoryRouter>)

beforeEach(() => {
  escopo = { carregando: false, erro: null, escopos: [ESCOPO_DIST], escopo: ESCOPO_DIST, escopoId: 'e1', temEscopo: true, capacidades: CAPACIDADES, trocarEscopo }
  carregarPainel.mockReset().mockResolvedValue(PAINEL)
  carregarVisitasDoEscopo.mockReset().mockResolvedValue([])
  carregarClubeDetalhe.mockReset().mockResolvedValue(DETALHE)
  agendarVisita.mockReset().mockResolvedValue({ ok: true })
  atualizarVisita.mockReset().mockResolvedValue({ ok: true })
  carregarInvestidurasDoEscopo.mockReset().mockResolvedValue([])
  trocarEscopo.mockReset()
})

const irPara = async (aba) => userEvent.click(await screen.findByRole('tab', { name: new RegExp(aba) }))

describe('PortalInstitucional', () => {
  it('sem vínculo institucional: não mostra painel nenhum e oferece voltar ao clube', async () => {
    escopo = { ...escopo, temEscopo: false, escopos: [], escopo: null }
    renderT()
    expect(await screen.findByText('Sem vínculo institucional')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para o meu clube/ })).toBeInTheDocument()
    expect(carregarPainel).not.toHaveBeenCalled()
  })

  it('navegação clara: Visão geral, Clubes, Visitas e Classes', async () => {
    renderT()
    for (const a of ['Visão geral', 'Clubes', 'Visitas', 'Classes']) expect(await screen.findByRole('tab', { name: new RegExp(a) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Distrito Teste' })).toBeInTheDocument()
  })

  it('nada exige a decisão da autoridade: diz isso claramente e NÃO inventa aprovação distrital', async () => {
    renderT()
    expect(await screen.findByText(/Nada aguarda a sua decisão/)).toBeInTheDocument()
    expect(screen.getByText(/são revisadas e investidas pelo próprio clube/)).toBeInTheDocument()
  })

  it('visão geral: totais e destaques (sem atividade há 14+ dias, avaliações acumuladas)', async () => {
    renderT()
    const totais = await screen.findByTestId('painel-totais')
    expect(within(totais).getByText(/Membros ativos/).parentElement).toHaveTextContent('46')
    expect(within(totais).getByText(/Presença média/).parentElement).toHaveTextContent('82%')
    expect(screen.getByText('Sem atividade há 25 dias')).toBeInTheDocument()
    expect(screen.getByText('12 avaliações acumuladas')).toBeInTheDocument()
  })

  it('NADA comercial na tela: sem plano, assinatura, teste ou cobrança', async () => {
    renderT()
    await screen.findByTestId('painel-totais')
    await irPara('Clubes')
    await screen.findByText('Clube Teste')
    expect(document.body.textContent).not.toMatch(/assinatura|plano|em teste|sem assinatura|trial|cortesia|cobran/i)
  })

  it('lista de clubes: logo/sigla, nome, distrito · região e números', async () => {
    renderT()
    await irPara('Clubes')
    const cartao = (await screen.findAllByTestId('painel-clube'))[0]
    expect(within(cartao).getByText('Clube Teste')).toBeInTheDocument()
    expect(within(cartao).getByText('Distrito Teste · Região Norte')).toBeInTheDocument()
    expect(within(cartao).getByRole('img', { name: /Clube Clube Teste/ })).toHaveTextContent('CT')
    expect(within(cartao).getByText('82%')).toBeInTheDocument()
  })

  it('tocar no clube abre a página do clube com membros, unidades, classes, presença, agenda e visitas', async () => {
    renderT()
    await irPara('Clubes')
    await userEvent.click(await screen.findByRole('button', { name: /Abrir Clube Teste/ }))
    expect(carregarClubeDetalhe).toHaveBeenCalledWith('c1')
    const det = await screen.findByTestId('clube-detalhe')
    const nums = await within(det).findByTestId('clube-numeros')
    expect(within(nums).getByText(/Desbravadores/).parentElement).toHaveTextContent('18')
    expect(within(nums).getByText(/Liderança/).parentElement).toHaveTextContent('5')
    expect(within(det).getByText('Águias')).toBeInTheDocument()
    expect(within(det).getByText('Classes avançadas')).toBeInTheDocument()
    expect(within(det).getByText('Amigo da Natureza')).toBeInTheDocument()
    expect(within(det).getByText(/15 de 20/)).toBeInTheDocument()
    expect(within(det).getByText('03/10/2026')).toBeInTheDocument()
    expect(within(det).getByText(/▲ 5 p.p. vs mês anterior/)).toBeInTheDocument()
    expect(carregarVisitasDoEscopo).toHaveBeenCalledWith('c1')
    await userEvent.click(within(det).getByRole('button', { name: 'Agendar' }))
    expect(screen.getByTestId('agendar-visita')).toHaveTextContent('Agendar visita — Clube Teste')
  })

  it('clube fora do escopo: erro humano, sem texto cru do servidor', async () => {
    carregarClubeDetalhe.mockRejectedValue(new Error('Clube não encontrado.'))
    renderT()
    await irPara('Clubes')
    await userEvent.click(await screen.findByRole('button', { name: /Abrir Clube Teste/ }))
    expect(await screen.findByText('Não deu pra abrir este clube')).toBeInTheDocument()
  })

  it('com filtros no escopo, trocar o filtro recarrega o painel com a unidade', async () => {
    carregarPainel.mockResolvedValue({ ...PAINEL, filtros: [{ id: 'd9', nome: 'Distrito 9', tipo: 'distrito' }] })
    renderT()
    const sel = await screen.findByLabelText('Filtrar por região/distrito')
    await userEvent.selectOptions(sel, 'd9')
    expect(carregarPainel).toHaveBeenLastCalledWith('d9')
  })

  it('visita: quem agendou vê e pode registrar a realização', async () => {
    carregarVisitasDoEscopo.mockResolvedValue([{
      id: 'v1', club_id: 'c1', clube: 'Clube Teste', agendada_para: '2026-10-01T12:00:00Z', objetivo: 'Conhecer', status: 'confirmada',
      agendada_por: { nome: 'Coord', papel: 'coordenador_distrital', unidade: { nome: 'Distrito Teste' } }, pode_editar: true,
    }])
    renderT()
    await irPara('Visitas')
    await userEvent.click(await screen.findByRole('button', { name: 'Realizada' }))
    await userEvent.type(screen.getByLabelText('Relatório curto da visita'), 'Clube muito organizado.')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(atualizarVisita).toHaveBeenCalledWith('v1', 'realizada', { quando: null, texto: 'Clube muito organizado.' })
  })

  it('aba Classes: soma por classe e investiduras por clube', async () => {
    renderT()
    await irPara('Classes')
    expect(await screen.findByText('Por classe')).toBeInTheDocument()
    expect(screen.getByText('Amigo').closest('tr')).toHaveTextContent('Amigo824')
    expect(screen.getAllByText('2 previstas · 1 no mês').length).toBe(2)
  })

  it('deixa explícito que conversa/foto/mensalidade/evidência/responsável não vêm pra cá', async () => {
    renderT()
    await screen.findByTestId('painel-totais')
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
    expect(screen.getByText(/Aguardando: Aprovação distrital/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada aguarda a sua decisão/)).not.toBeInTheDocument()
  })

  it('com mais de um escopo, permite trocar o escopo em uso', async () => {
    const outro = { ...ESCOPO_DIST, escopo_id: 'e2', nome: 'Região Teste', tipo: 'regiao', papel: 'coordenador_regional', em_uso: false }
    escopo = { ...escopo, escopos: [ESCOPO_DIST, outro] }
    renderT()
    await userEvent.selectOptions(await screen.findByLabelText('Escopo em uso'), 'e2')
    expect(trocarEscopo).toHaveBeenCalledWith('e2')
  })

  it('papel sem capacidade de painel não vê o painel dos clubes', async () => {
    escopo = { ...escopo, capacidades: { ver_clubes: false, ver_painel: false, decidir_workflow: false } }
    renderT()
    expect(await screen.findByText(/não inclui o painel dos clubes/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Clubes/ })).not.toBeInTheDocument()
  })
})
