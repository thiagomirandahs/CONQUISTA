// Feed da Rede DBV: abas Todos · Meu clube, nome + sobrenome + clube, foto grande com alt, duplo toque curte,
// salvar, denunciar some com o post, foto expirada, compositor leva à tela de publicar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  carregarFeed: vi.fn(), curtir: vi.fn(), salvar: vi.fn(), denunciar: vi.fn(), compartilhar: vi.fn(), apagar: vi.fn(),
  carregarComentarios: vi.fn(), comentar: vi.fn(), urlDaFoto: vi.fn(),
}
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../../ui/avisos.jsx', () => ({ avisar: avisos }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Eu Mesmo' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a', papel: 'desbravador' }) }))

const { post, renderRede, STATUS } = await import('./_testeRede.jsx')
const { default: RedeFeed } = await import('./RedeFeed.jsx')

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  for (const fn of Object.values(avisos)) fn.mockClear()
  f.carregarFeed.mockResolvedValue({ itens: [post()], proximo: null })
  f.urlDaFoto.mockResolvedValue('blob:foto')
  f.carregarComentarios.mockResolvedValue({ itens: [] })
})

describe('Rede DBV — feed', () => {
  it('mostra Nome Sobrenome e o clube embaixo, com link para o perfil', async () => {
    renderRede(<RedeFeed />)
    const card = await screen.findByTestId('post')
    expect(within(card).getByRole('link', { name: 'Ana Souza' })).toHaveAttribute('href', '/rede/perfil/u-ana')
    expect(within(card).getByText(/Clube Águias/)).toBeInTheDocument()
  })

  it('aba "Meu clube" recarrega o feed com o filtro', async () => {
    const u = userEvent.setup()
    renderRede(<RedeFeed />)
    await screen.findByTestId('post')
    expect(f.carregarFeed).toHaveBeenLastCalledWith('todos')
    await u.click(screen.getByRole('tab', { name: 'Meu clube' }))
    expect(f.carregarFeed).toHaveBeenLastCalledWith('meu_clube')
  })

  it('compositor "No que você está pensando?" leva à tela de publicar', async () => {
    renderRede(<RedeFeed />)
    expect(await screen.findByRole('link', { name: /No que você está pensando/ })).toHaveAttribute('href', '/rede/publicar')
  })

  it('responsável (não publica): sem compositor', async () => {
    renderRede(<RedeFeed />, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    await screen.findByTestId('post')
    expect(screen.queryByText('No que você está pensando?')).toBeNull()
  })

  it('foto grande com a descrição (alt) e DUPLO TOQUE curte com o coração', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ tipo: 'foto', foto: 'c/u/x.webp', foto_alt: 'Barraca montada' })], proximo: null })
    f.curtir.mockResolvedValue({ curtidas: 3, eu_curti: true })
    renderRede(<RedeFeed />)
    const img = await screen.findByAltText('Barraca montada')
    const area = screen.getByTestId('foto-post')
    fireEvent.click(area); fireEvent.click(area)
    expect(await screen.findByTestId('coracao')).toBeInTheDocument()
    expect(f.curtir).toHaveBeenCalledWith('p1', true)
    expect(img.getAttribute('loading')).toBe('lazy')
  })

  it('duplo toque em post já curtido não descurte', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ foto: 'c/u/x.webp', eu_curti: true })], proximo: null })
    renderRede(<RedeFeed />)
    await screen.findByAltText('Foto da publicação')
    const area = screen.getByTestId('foto-post')
    fireEvent.click(area); fireEvent.click(area)
    expect(f.curtir).not.toHaveBeenCalled()
  })

  it('salvar marca o post', async () => {
    const u = userEvent.setup()
    f.salvar.mockResolvedValue({ ok: true, eu_salvei: true })
    renderRede(<RedeFeed />)
    await u.click(await screen.findByRole('button', { name: 'Salvar' }))
    expect(f.salvar).toHaveBeenCalledWith('p1', true)
    expect(await screen.findByRole('button', { name: 'Tirar dos salvos' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('denunciar: o post some na hora', async () => {
    const u = userEvent.setup()
    f.denunciar.mockResolvedValue({ ok: true, ocultou: true, mensagem: 'Obrigado!' })
    renderRede(<RedeFeed />)
    await u.click(await screen.findByRole('button', { name: 'Denunciar' }))
    await u.click(await screen.findByRole('button', { name: 'Ofensivo ou desrespeitoso' }))
    expect(f.denunciar).toHaveBeenCalledWith('post', 'p1', 'ofensivo')
    expect(screen.queryByTestId('post')).toBeNull()
  })

  it('foto expirada: o post continua, com o aviso', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ foto: null, foto_expirada: true })], proximo: null })
    renderRede(<RedeFeed />)
    expect(await screen.findByText(/Foto expirada/)).toBeInTheDocument()
  })

  it('desafio e conquista ganham etiqueta', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [
      post({ id: 'a', tipo: 'desafio', desafio: { id: 'd1', titulo: 'Nó de escota' } }),
      post({ id: 'b', tipo: 'conquista', conquista: 'classe' }),
    ], proximo: null })
    renderRede(<RedeFeed />)
    expect(await screen.findByText(/Desafio: Nó de escota/)).toBeInTheDocument()
    expect(screen.getByText(/Conquista · 🎖️ Classe/)).toBeInTheDocument()
  })
})
