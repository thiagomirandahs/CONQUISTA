// Rede DBV para a COORDENAÇÃO (migration 490): entrada pelo portal (modo da aba + header x-rede-como),
// "Minha área" no feed, subtítulo "Coordenação · <unidade>" com selo, caixa de comentário em post de
// criança não é escondida para a coordenação (o servidor decide pela área), "área sem rede" explicada e o
// "Sair" volta ao portal. Quem entra pelo clube continua exatamente como antes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const f = {
  carregarFeed: vi.fn(), curtir: vi.fn(), salvar: vi.fn(), denunciar: vi.fn(), compartilhar: vi.fn(), apagar: vi.fn(),
  carregarComentarios: vi.fn(), comentar: vi.fn(), urlDaFoto: vi.fn(), carregarStories: vi.fn(), marcarStoryVisto: vi.fn(),
  meuStatus: vi.fn(),
}
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
const transporte = vi.fn()
vi.mock('../../lib/supabase.js', () => ({ definirRedeComoNoTransporte: (...a) => transporte(...a), supabase: {} }))
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../../ui/avisos.jsx', () => ({ avisar: avisos }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Carla Mendes' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: null, papel: null }) }))
vi.mock('../../components/Notificacoes.jsx', () => ({ default: () => null }))

const { post, renderRede, STATUS } = await import('./_testeRede.jsx')
const { default: RedeFeed } = await import('./RedeFeed.jsx')
const { default: LayoutRede } = await import('./LayoutRede.jsx')
const modo = await import('../../lib/redeModo.js')

const COORD = { ...STATUS, papel: 'coordenador_distrital', modo: 'coordenacao', coordenacao: true, unidade_id: 'd-norte', unidade: 'Distrito Norte' }
const postCoord = (extra = {}) => post({
  id: 'pc', crianca: false, clube_id: 'd-norte',
  autor: { id: 'u-carla', nome: 'Carla Mendes', clube: 'Coordenação · Distrito Norte', coordenacao: true, foto: null }, ...extra,
})

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  transporte.mockClear()
  try { sessionStorage.clear() } catch { /* sem storage */ }
  f.carregarFeed.mockResolvedValue({ itens: [postCoord()], proximo: null })
  f.urlDaFoto.mockResolvedValue('blob:foto')
  f.carregarComentarios.mockResolvedValue({ itens: [] })
  f.carregarStories.mockResolvedValue([])
})

describe('modo "coordenação" da aba', () => {
  it('entrar pelo portal guarda o modo e manda o header; sair apaga', () => {
    expect(modo.redeComoCoordenacao()).toBe(false)
    modo.entrarNaRedeComoCoordenacao()
    expect(modo.redeComoCoordenacao()).toBe(true)
    expect(transporte).toHaveBeenLastCalledWith('coordenacao')
    expect(modo.destinoDeSaidaDaRede()).toBe('/institucional')
    modo.sairDoModoCoordenacao()
    expect(modo.redeComoCoordenacao()).toBe(false)
    expect(transporte).toHaveBeenLastCalledWith(null)
    expect(modo.destinoDeSaidaDaRede()).toBe('/inicio')
  })
})

describe('feed visto pela coordenação', () => {
  it('aba vira "Minha área" (e continua pedindo o filtro do servidor)', async () => {
    const u = userEvent.setup()
    renderRede(<RedeFeed />, { status: COORD })
    await screen.findByTestId('post')
    expect(screen.queryByRole('tab', { name: 'Meu Clube' })).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    await u.click(screen.getByRole('tab', { name: 'Minha área' }))
    expect(f.carregarFeed).toHaveBeenLastCalledWith('meu_clube')
  })

  it('para membro de clube, a aba continua "Meu clube"', async () => {
    renderRede(<RedeFeed />)
    await screen.findByTestId('post')
    expect(screen.getByRole('tab', { name: 'Meu Clube' })).toBeInTheDocument()
  })

  it('post da coordenação: nome, subtítulo "Coordenação · <unidade>" e selo', async () => {
    renderRede(<RedeFeed />, { status: COORD })
    const card = await screen.findByTestId('post')
    expect(within(card).getByText('Carla Mendes')).toBeInTheDocument()
    expect(within(card).getByText(/Coordenação · Distrito Norte/)).toBeInTheDocument()
    expect(within(card).getByTestId('selo-coordenacao')).toHaveAttribute('aria-label', 'Coordenação')
  })

  it('post de clube não ganha selo', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post()], proximo: null })
    renderRede(<RedeFeed />, { status: COORD })
    const card = await screen.findByTestId('post')
    expect(within(card).queryByTestId('selo-coordenacao')).toBeNull()
  })

  it('post de criança: a coordenação vê a caixa de comentário (a área é conferida no servidor)', async () => {
    const u = userEvent.setup()
    f.carregarFeed.mockResolvedValue({ itens: [post({ crianca: true, clube_id: 'clube-da-area' })], proximo: null })
    renderRede(<RedeFeed />, { status: COORD })
    const card = await screen.findByTestId('post')
    await u.click(within(card).getByRole('button', { name: /coment/i }))
    expect(await screen.findByRole('textbox', { name: /coment/i })).toBeInTheDocument()
  })
})

describe('LayoutRede na coordenação', () => {
  const renderLayout = () => render(
    <MemoryRouter initialEntries={['/rede']}>
      <Routes>
        <Route element={<LayoutRede />}><Route path="/rede" element={<p>feed</p>} /></Route>
        <Route path="/institucional" element={<p>portal da coordenação</p>} />
        <Route path="/inicio" element={<p>app do clube</p>} />
      </Routes>
    </MemoryRouter>,
  )

  it('área sem clube liberado: explica e volta ao portal', async () => {
    const u = userEvent.setup()
    modo.entrarNaRedeComoCoordenacao()
    f.meuStatus.mockResolvedValue({ pode_ver: false, motivo: 'area_sem_rede', modo: 'coordenacao' })
    renderLayout()
    expect(await screen.findByText('A Rede DBV ainda não está liberada na sua área')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Voltar ao portal da coordenação' }))
    expect(await screen.findByText('portal da coordenação')).toBeInTheDocument()
    expect(modo.redeComoCoordenacao()).toBe(false)
  })

  it('"Sair" do topo volta ao portal quando entrou como coordenação', async () => {
    const u = userEvent.setup()
    modo.entrarNaRedeComoCoordenacao()
    f.meuStatus.mockResolvedValue(COORD)
    renderLayout()
    await screen.findByText('feed')
    const sair = screen.getByTestId('rede-sair')
    expect(sair).toHaveAccessibleName('Sair da Rede DBV e voltar ao portal da coordenação')
    await u.click(sair)
    expect(await screen.findByText('portal da coordenação')).toBeInTheDocument()
  })

  it('"Sair" do topo volta ao app do clube para quem entrou pelo clube', async () => {
    const u = userEvent.setup()
    f.meuStatus.mockResolvedValue(STATUS)
    renderLayout()
    await screen.findByText('feed')
    await u.click(screen.getByTestId('rede-sair'))
    expect(await screen.findByText('app do clube')).toBeInTheDocument()
  })
})
