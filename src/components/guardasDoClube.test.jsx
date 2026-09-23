import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { permissoesDoPapel } from '../lib/clube.js'

// dublê do contexto do clube: cada teste escolhe quem a pessoa é
let clube
const sair = vi.fn()
const recarregar = vi.fn()
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ sair }) }))
// fase 7: o guarda passou a oferecer as jornadas de quem NÃO tem clube (portal e criar clube)
let escopo = { temEscopo: false, escopos: [], carregando: false }
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => escopo }))
// fase 5: quando o recurso é barrado, o guarda pergunta ao servidor QUAL camada barrou
const verificarOperacao = vi.fn()
vi.mock('../services/comercial.js', () => ({ verificarOperacao: (...a) => verificarOperacao(...a) }))

const { default: RotaRestrita } = await import('./RotaRestrita.jsx')
const { default: RecursoOpcional } = await import('./RecursoOpcional.jsx')
const { default: ClubeGuard } = await import('./ClubeGuard.jsx')

const marca = { nome: 'Clube B', sigla: 'CB', logoUrl: null }
// contexto de quem tem um vínculo ativo com este papel e estes recursos
function como(papel, recursos = {}, extra = {}) {
  clube = {
    carregando: false, erro: null, semVinculo: false, vinculos: [], marca, recarregar,
    ...permissoesDoPapel(papel), recursos, temRecurso: (c) => recursos[c] === true, ...extra,
  }
}
const naRota = (rota, ui) => render(<MemoryRouter initialEntries={[rota]}>{ui}</MemoryRouter>)

beforeEach(() => {
  sair.mockReset(); recarregar.mockReset()
  verificarOperacao.mockReset().mockResolvedValue({ permitido: false, bloqueio: 'clube' })
  escopo = { temEscopo: false, escopos: [], carregando: false }
})

describe('RotaRestrita: papel do VÍNCULO no clube em uso', () => {
  it('diretoria abre /aprovacoes', () => {
    como('diretoria')
    naRota('/aprovacoes', <RotaRestrita><p>tela de aprovações</p></RotaRestrita>)
    expect(screen.getByText('tela de aprovações')).toBeInTheDocument()
  })
  it('desbravador NÃO abre /aprovacoes (digitando a URL)', () => {
    como('desbravador')
    naRota('/aprovacoes', <RotaRestrita><p>tela de aprovações</p></RotaRestrita>)
    expect(screen.queryByText('tela de aprovações')).toBeNull()
    expect(screen.getByText('Área restrita')).toBeInTheDocument()
  })
  it('responsável NÃO abre nenhuma ferramenta de gestão', () => {
    como('pais')
    naRota('/mensalidades', <RotaRestrita><p>mensalidades</p></RotaRestrita>)
    expect(screen.queryByText('mensalidades')).toBeNull()
  })
  it('tesoureiro abre /mensalidades (com o recurso ligado) mas não /temporada', () => {
    como('tesoureiro', { mensalidades: true })
    const a = naRota('/mensalidades', <RotaRestrita><p>mensalidades</p></RotaRestrita>)
    expect(screen.getByText('mensalidades')).toBeInTheDocument()
    a.unmount()
    naRota('/temporada', <RotaRestrita><p>temporada</p></RotaRestrita>)
    expect(screen.queryByText('temporada')).toBeNull()
  })
  it('sem papel (sem vínculo ativo) = bloqueado (falha fechada), até para a rota mais liberal', () => {
    como(null)
    naRota('/aprovacoes', <RotaRestrita><p>tela de aprovações</p></RotaRestrita>)
    expect(screen.queryByText('tela de aprovações')).toBeNull()
  })
  it('rota embrulhada mas fora da matriz = bloqueia', () => {
    como('diretoria')
    naRota('/inventada', <RotaRestrita><p>x</p></RotaRestrita>)
    expect(screen.queryByText('x')).toBeNull()
  })
  it('barra final e maiúsculas na URL não bloqueiam a liderança à toa', () => {
    como('diretoria')
    naRota('/Aprovacoes/', <RotaRestrita><p>tela de aprovações</p></RotaRestrita>)
    expect(screen.getByText('tela de aprovações')).toBeInTheDocument()
  })
  it('enquanto o contexto carrega não decide (nem libera nem bloqueia)', () => {
    como('diretoria', {}, { carregando: true })
    naRota('/aprovacoes', <RotaRestrita><p>tela de aprovações</p></RotaRestrita>)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
    expect(screen.queryByText('Área restrita')).toBeNull()
  })
  it('a rota também respeita o RECURSO do clube: liderança de clube que desligou o chat NÃO abre a moderação', () => {
    como('diretoria', { chat: false })
    naRota('/chat-moderacao', <RotaRestrita><p>moderação</p></RotaRestrita>)
    expect(screen.queryByText('moderação')).toBeNull()
    expect(screen.getByText('Recurso não habilitado')).toBeInTheDocument()
  })
  it('fase 5 — quando quem barra é o PLANO, o aviso diz isso (e não culpa a diretoria)', async () => {
    verificarOperacao.mockResolvedValue({ permitido: false, bloqueio: 'plano' })
    como('diretoria', { leilao: false })
    naRota('/leilao', <RecursoOpcional recurso="leilao"><p>leilão</p></RecursoOpcional>)
    expect(await screen.findByText('Fora do plano deste clube')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver o plano' })).toBeInTheDocument()
    expect(screen.queryByText('leilão')).toBeNull()
  })
  it('...e abre quando o clube usa o chat', () => {
    como('diretoria', { chat: true })
    naRota('/chat-moderacao', <RotaRestrita><p>moderação</p></RotaRestrita>)
    expect(screen.getByText('moderação')).toBeInTheDocument()
  })
})

describe('RecursoOpcional (feature flag do clube)', () => {
  it('mostra a tela quando o clube liga o recurso', () => {
    como('desbravador', { leilao: true })
    naRota('/leilao', <RecursoOpcional recurso="leilao"><p>leilão</p></RecursoOpcional>)
    expect(screen.getByText('leilão')).toBeInTheDocument()
  })
  it('esconde e avisa quando o clube NÃO usa (mesmo digitando a URL)', () => {
    como('diretoria', { leilao: false })
    naRota('/leilao', <RecursoOpcional recurso="leilao"><p>leilão</p></RecursoOpcional>)
    expect(screen.queryByText('leilão')).toBeNull()
    expect(screen.getByText('Este clube não utiliza este recurso.')).toBeInTheDocument()
  })
  it('recurso que o clube nunca definiu e o catálogo não conhece = desligado', () => {
    como('diretoria', {})
    naRota('/x', <RecursoOpcional recurso="qualquer"><p>tela</p></RecursoOpcional>)
    expect(screen.queryByText('tela')).toBeNull()
  })
  it('carregando: espera', () => {
    como('diretoria', {}, { carregando: true })
    naRota('/x', <RecursoOpcional recurso="chat"><p>tela</p></RecursoOpcional>)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })
})

describe('ClubeGuard: só entra quem tem vínculo ATIVO com um clube em uso', () => {
  it('com vínculo ativo: mostra o app', () => {
    como('desbravador')
    render(<ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.getByText('o app')).toBeInTheDocument()
  })
  it('carregando: tela de espera, sem o app', () => {
    como('desbravador', {}, { carregando: true })
    render(<ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.queryByText('o app')).toBeNull()
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })
  it('conta sem clube: NADA do app, e a saída é criar o próprio clube (fase 7)', () => {
    como(null, {}, { semVinculo: true, vinculos: [] })
    naRota('/x', <ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.queryByText('o app')).toBeNull()
    expect(screen.getByText('Você ainda não está em um clube')).toBeInTheDocument()
    // antes desta fase o onboarding não tinha NENHUM link no app inteiro
    expect(screen.getByTestId('ir-criar-clube')).toHaveAttribute('href', '/criar-clube')
    screen.getByRole('button', { name: 'Sair' }).click()
    expect(sair).toHaveBeenCalledTimes(1)
  })
  it('coordenador institucional sem clube é mandado para o PORTAL, não para a porta de saída', () => {
    escopo = { temEscopo: true, escopos: [{ nome: 'Distrito Central' }], carregando: false }
    como(null, {}, { semVinculo: true, vinculos: [] })
    naRota('/x', <ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.queryByText('o app')).toBeNull()
    expect(screen.getByText('Sua jornada é institucional')).toBeInTheDocument()
    expect(screen.getByTestId('ir-portal')).toHaveAttribute('href', '/institucional')
  })
  it('cadastro pendente: diz que aguarda aprovação do clube (pelo nome do clube dele)', () => {
    como(null, {}, { semVinculo: true, vinculos: [{ status: 'pendente', marca: { nome: 'Clube Pendente' } }] })
    render(<ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.queryByText('o app')).toBeNull()
    expect(screen.getByText('Seu cadastro aguarda aprovação')).toBeInTheDocument()
    expect(screen.getByText(/Clube Pendente/)).toBeInTheDocument()
  })
  // FASE 8.5, item 3: nada de fallback silencioso de seguranca. Quando o clube que a aba usava
  // deixa de valer e a pessoa tem outros, o app NAO escolhe um sozinho — ele para e devolve a
  // escolha a ela. Antes, o vinculo encerrado num clube fazia a pessoa reaparecer dentro de outro,
  // mesma sessao, sem aviso nenhum.
  it('clube perdido com outros disponiveis: pede nova escolha em vez de entrar em outro sozinho', () => {
    const trocarClube = vi.fn()
    como(null, {}, {
      semVinculo: false, precisaEscolher: true, trocarClube,
      vinculos: [
        { clubeId: 'A', status: 'ativo', selecionavel: true, nome: 'Clube A', marca: { nome: 'Clube A' } },
        { clubeId: 'B', status: 'suspenso', selecionavel: false, nome: 'Clube B', marca: { nome: 'Clube B' } },
      ],
    })
    naRota('/x', <ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.queryByText('o app')).toBeNull()
    expect(screen.getByText('Escolha em qual clube continuar')).toBeInTheDocument()
    // so os utilizaveis viram botao — o suspenso nao e oferecido
    expect(screen.getByTestId('escolher-A')).toBeInTheDocument()
    expect(screen.queryByTestId('escolher-B')).toBeNull()
    screen.getByTestId('escolher-A').click()
    expect(trocarClube).toHaveBeenCalledWith('A')
  })

  it('erro de rede/servidor: "tentar de novo", app bloqueado (não assume papel nem clube)', () => {
    como(null, {}, { erro: new Error('caiu') })
    render(<ClubeGuard><p>o app</p></ClubeGuard>)
    expect(screen.queryByText('o app')).toBeNull()
    screen.getByRole('button', { name: 'Tentar de novo' }).click()
    expect(recarregar).toHaveBeenCalledTimes(1)
  })
})
