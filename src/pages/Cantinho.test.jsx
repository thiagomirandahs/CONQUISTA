// Cantinho da unidade (migration 260). O servidor decide quem vê o quê; aqui garantimos que a tela desenha o
// que veio, mostra os botões só para quem edita, destaca o domingo e chama as RPCs certas.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const f = {
  cantinhoMinhasUnidades: vi.fn(), cantinhoVer: vi.fn(), cantinhoMuralEnviar: vi.fn(), cantinhoAjudaConfirmar: vi.fn(),
  cantinhoAjudaRegistrar: vi.fn(), cantinhoCaixaLancar: vi.fn(), cantinhoMeditacaoSalvar: vi.fn(), cantinhoJustificar: vi.fn(),
}
vi.mock('../services/cantinho.js', async () => {
  const real = await vi.importActual('../services/cantinho.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))

const { default: Cantinho } = await import('./Cantinho.jsx')
const { paraCentavos, formatarReal, ehDomingo, diaMes } = await vi.importActual('../services/cantinho.js')

const base = (extra = {}) => ({
  unidade: { id: 'U1', nome: 'Águias', cor: '#1e3a8a', lema: 'Sempre alerta' },
  papel: 'lider', pode_editar: true, pode_caixa: true, eu: 'cons', domingo: '2026-09-20', hoje: '2026-09-22',
  membros: [
    { id: 'cons', nome: 'Carla Conselheira', role: 'conselheiro' },
    { id: 'lia', nome: 'Lia', role: 'desbravador' },
    { id: 'rui', nome: 'Rui', role: 'desbravador' },
  ],
  chamada: [{ data: '2026-09-20', itens: [
    { usuario_id: 'lia', status: 'falta', igreja: false }, { usuario_id: 'rui', status: 'presente', igreja: true }] }],
  resumo: [{ usuario_id: 'lia', reunioes: 1, faltas: 1, justificadas: 0, culto: 0 }, { usuario_id: 'rui', reunioes: 1, faltas: 0, justificadas: 0, culto: 1 }],
  caixa: { saldo_centavos: 1500, lancamentos: [{ id: 'c1', data: '2026-09-21', descricao: 'Rifa', tipo: 'entrada', valor_centavos: 1500 }] },
  meditacao: { id: 'm1', domingo: '2026-09-20', texto: 'O Senhor é o meu pastor.', referencia: 'Sl 23:1' },
  meditacoes_anteriores: [], mural: [{ id: 'p1', tipo: 'pedido', texto: 'Pela vovó', privado: false, oculto: false, meu: false, autor: 'Lia' }],
  mural_historico: [], ajuda_pontos: 10, ajuda: [], reunioes: [], agenda_clube: [], plano: [{ id: 'pl1', titulo: 'Acampar', status: 'a_fazer', prazo: null }],
  ...extra,
})

const abrir = (rota = '/cantinho') => render(
  <MemoryRouter initialEntries={[rota]}>
    <Routes><Route path="/cantinho" element={<Cantinho />} /><Route path="/cantinho/:unidadeId" element={<Cantinho />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.cantinhoMinhasUnidades.mockResolvedValue([{ unidade_id: 'U1', nome: 'Águias', cor: '#1e3a8a', papel: 'lider' }])
  f.cantinhoVer.mockResolvedValue(base())
  f.cantinhoMuralEnviar.mockResolvedValue('novo')
  f.cantinhoAjudaConfirmar.mockResolvedValue({ ok: true, pontos: 10 })
  f.cantinhoAjudaRegistrar.mockResolvedValue('a1')
})

describe('Cantinho da unidade — conselheiro', () => {
  it('abre direto a única unidade e mostra as seções', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Águias' })).toBeInTheDocument()
    expect(f.cantinhoVer).toHaveBeenCalledWith('U1')
    expect(screen.getByText('O Senhor é o meu pastor.')).toBeInTheDocument()
    expect(screen.getByText('Pela vovó')).toBeInTheDocument()
    expect(screen.getByTestId('saldo')).toHaveTextContent('15,00')
    expect(screen.getByRole('heading', { name: /Planejamento/ })).toBeInTheDocument()
    expect(screen.getByTestId('resumo-culto')).toHaveTextContent('1/2')
    expect(screen.queryByTestId('faixa-domingo')).not.toBeInTheDocument()
  })

  it('confirma a ajuda em casa de um desbravador', async () => {
    const u = userEvent.setup()
    abrir()
    const lista = await screen.findByTestId('ajuda-lista')
    const linhaLia = within(lista).getByText('Lia').closest('li')
    await u.click(within(linhaLia).getByRole('button', { name: /Ajudou/ }))
    expect(f.cantinhoAjudaConfirmar).toHaveBeenCalledWith('U1', 'lia')
  })

  it('envia pedido de oração privado', async () => {
    const u = userEvent.setup()
    abrir()
    await screen.findByRole('heading', { name: 'Águias' })
    await u.type(screen.getByLabelText('Pelo que vamos orar?'), 'Pela prova')
    await u.click(screen.getByLabelText('Só o(a) conselheiro(a) pode ler'))
    await u.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(f.cantinhoMuralEnviar).toHaveBeenCalledWith('U1', 'pedido', 'Pela prova', true)
  })

  it('domingo aparece destacado', async () => {
    f.cantinhoVer.mockResolvedValue(base({ hoje: '2026-09-27', domingo: '2026-09-27' }))
    abrir()
    expect(await screen.findByTestId('faixa-domingo')).toHaveTextContent('domingo')
  })
})

describe('Cantinho da unidade — membro', () => {
  it('não vê planejamento nem botões de edição; registra a própria ajuda', async () => {
    const u = userEvent.setup()
    f.cantinhoVer.mockResolvedValue(base({ papel: 'membro', pode_editar: false, pode_caixa: false, eu: 'lia', plano: [],
      caixa: { saldo_centavos: 1500, lancamentos: [] } }))
    abrir()
    await screen.findByRole('heading', { name: 'Águias' })
    expect(screen.queryByRole('heading', { name: /Planejamento/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Esconder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Lançar' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('ajuda-lista')).not.toBeInTheDocument()
    await u.type(screen.getByLabelText('Como você ajudou em casa esta semana?'), 'Lavei a louça')
    await u.click(screen.getByRole('button', { name: 'Registrar minha ajuda' }))
    expect(f.cantinhoAjudaRegistrar).toHaveBeenCalledWith('U1', 'Lavei a louça')
  })

  it('outra unidade (servidor recusa) vê a tela fechada', async () => {
    f.cantinhoVer.mockRejectedValue(new Error('Sem permissão (este cantinho é só da unidade).'))
    abrir('/cantinho/U2')
    expect(await screen.findByText('Este cantinho é só da unidade')).toBeInTheDocument()
  })

  it('sem unidade: explica', async () => {
    f.cantinhoMinhasUnidades.mockResolvedValue([])
    abrir()
    expect(await screen.findByText('Você ainda não está numa unidade')).toBeInTheDocument()
  })
})

describe('Cantinho — diretoria escolhe a unidade', () => {
  it('lista as unidades e abre a escolhida', async () => {
    const u = userEvent.setup()
    f.cantinhoMinhasUnidades.mockResolvedValue([
      { unidade_id: 'U1', nome: 'Águias', papel: 'diretoria' }, { unidade_id: 'U2', nome: 'Falcões', papel: 'diretoria' }])
    abrir()
    await u.click(await screen.findByRole('button', { name: /Falcões/ }))
    expect(f.cantinhoVer).toHaveBeenCalledWith('U2')
  })
})

describe('helpers do cantinho', () => {
  it('converte valores e datas', () => {
    expect(paraCentavos('12,50')).toBe(1250)
    expect(paraCentavos('R$ 1.234,56')).toBe(123456)
    expect(paraCentavos('7')).toBe(700)
    expect(paraCentavos('0')).toBeNull()
    expect(paraCentavos('abc')).toBeNull()
    expect(formatarReal(1500)).toMatch(/15,00/)
    expect(ehDomingo('2026-09-27')).toBe(true)
    expect(ehDomingo('2026-09-26')).toBe(false)
    expect(diaMes('2026-09-27')).toBe('27/09')
  })
})
