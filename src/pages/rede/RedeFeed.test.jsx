// Feed da Rede DBV (estilo Instagram, 29/09/2026): abas Todos · Meu clube, nome + sobrenome + clube, foto grande
// com alt, duplo toque curte, salvar, denunciar (no menu ⋮) some com o post, foto expirada, post só de texto em
// bloco, #hashtags em azul, legenda com "mais", fileira de stories no topo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  carregarFeed: vi.fn(), curtir: vi.fn(), salvar: vi.fn(), denunciar: vi.fn(), compartilhar: vi.fn(), apagar: vi.fn(),
  carregarComentarios: vi.fn(), comentar: vi.fn(), urlDaFoto: vi.fn(), carregarStories: vi.fn(), marcarStoryVisto: vi.fn(),
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
  f.carregarStories.mockResolvedValue([])
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

  // MUDANÇA DE UI (29/09/2026): o compositor "No que você está pensando?" saiu do feed (estilo Instagram);
  // publicar fica no ➕ do topo/barra (LayoutRede) e o story na bolinha "Seu story". A regra testada
  // continua: quem publica tem por onde criar; responsável (não publica) não tem.
  it('quem publica vê "Seu story" com o + para criar', async () => {
    renderRede(<RedeFeed />)
    expect(await screen.findByRole('button', { name: 'Adicionar story' })).toBeInTheDocument()
    expect(screen.getByText('Seu story')).toBeInTheDocument()
  })

  it('responsável (não publica): sem "Seu story"', async () => {
    renderRede(<RedeFeed />, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    await screen.findByTestId('post')
    expect(screen.queryByText('Seu story')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar story' })).toBeNull()
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
    // MUDANÇA DE UI: denunciar agora fica no menu ⋮ ("Mais opções") do post
    await u.click(await screen.findByRole('button', { name: 'Mais opções' }))
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

  it('post sem foto: texto maior em bloco, sem espaço de imagem vazio; #hashtag em azul', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ legenda: 'Reunião top #acampamento' })], proximo: null })
    renderRede(<RedeFeed />)
    const bloco = await screen.findByTestId('post-texto')
    expect(bloco).toHaveTextContent('Reunião top #acampamento')
    expect(screen.getByText('#acampamento').className).toContain('text-[#3b5bff]')
    expect(screen.queryByTestId('foto-post')).toBeNull()
  })

  it('legenda longa com foto abre com "mais"', async () => {
    const u = userEvent.setup()
    const longa = 'A'.repeat(90) + ' fim da história que ninguém via ' + 'B'.repeat(40)
    f.carregarFeed.mockResolvedValue({ itens: [post({ foto: 'c/u/x.webp', legenda: longa })], proximo: null })
    renderRede(<RedeFeed />)
    await u.click(await screen.findByRole('button', { name: 'mais' }))
    expect(screen.getByText(/fim da história que ninguém via/)).toBeInTheDocument()
  })

  it('nome sem sublinhado (visual do dono)', async () => {
    renderRede(<RedeFeed />)
    const card = await screen.findByTestId('post')
    expect(within(card).getByRole('link', { name: 'Ana Souza' }).className).toContain('no-underline')
  })
})

describe('Rede DBV — fileira de stories', () => {
  const grupos = [
    { meu: true, todos_vistos: true, autor: { id: 'eu', nome: 'Eu Mesmo', clube: 'Clube A' }, stories: [{ id: 's0', foto: 'a/eu/0.webp', criado_em: new Date().toISOString(), visto: false }] },
    { meu: false, todos_vistos: false, autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias' }, stories: [{ id: 's1', foto: 'b/ana/1.webp', criado_em: new Date().toISOString(), visto: false }] },
    { meu: false, todos_vistos: true, autor: { id: 'u-bia', nome: 'Bia Lima', clube: 'Clube Leões' }, stories: [{ id: 's2', foto: 'b/bia/2.webp', criado_em: new Date().toISOString(), visto: true }] },
  ]

  it('meus primeiro ("Seu story"), anel colorido = não visto e cinza = visto', async () => {
    f.carregarStories.mockResolvedValue(grupos)
    renderRede(<RedeFeed />)
    const fileira = await screen.findByTestId('fileira-stories')
    const itens = within(fileira).getAllByRole('listitem')
    expect(itens[0]).toHaveTextContent('Seu story')
    expect(within(fileira).getByRole('button', { name: 'Story de Ana Souza' })).toHaveAttribute('data-visto', 'nao')
    expect(within(fileira).getByRole('button', { name: 'Story de Bia Lima (visto)' })).toHaveAttribute('data-visto', 'sim')
    expect(within(fileira).getByText('Ana')).toBeInTheDocument()
  })

  it('tocar numa bolinha abre o viewer e marca visto', async () => {
    const u = userEvent.setup()
    f.carregarStories.mockResolvedValue(grupos)
    f.marcarStoryVisto.mockResolvedValue({ ok: true })
    renderRede(<RedeFeed />)
    await u.click(await screen.findByRole('button', { name: 'Story de Ana Souza' }))
    expect(await screen.findByTestId('viewer-story')).toBeInTheDocument()
    expect(f.marcarStoryVisto).toHaveBeenCalledWith('s1')
  })
})
