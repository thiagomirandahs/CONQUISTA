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

  // MUDANÇA DE PROPÓSITO (515): abas "Meu Clube" (padrão) | "Comunidade"; "Todos" saiu.
  it('abas Meu Clube (padrão) e Comunidade recarregam o feed com o filtro', async () => {
    const u = userEvent.setup()
    renderRede(<RedeFeed />)
    await screen.findByTestId('post')
    expect(screen.getByRole('tablist', { name: 'Filtro do feed' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Meu Clube' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: /Todos/ })).toBeNull()
    expect(f.carregarFeed).toHaveBeenLastCalledWith('meu_clube')
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    expect(f.carregarFeed).toHaveBeenLastCalledWith('comunidade')
    expect(screen.getByRole('tab', { name: 'Comunidade' })).toHaveAttribute('aria-selected', 'true')
    await u.click(screen.getByRole('tab', { name: 'Meu Clube' }))
    expect(f.carregarFeed).toHaveBeenLastCalledWith('meu_clube')
  })

  it('teclado: seta alterna as abas e só a aba ativa entra na ordem do Tab', async () => {
    const u = userEvent.setup()
    renderRede(<RedeFeed />)
    await screen.findByTestId('post')
    expect(screen.getByRole('tab', { name: 'Comunidade' })).toHaveAttribute('tabindex', '-1')
    screen.getByRole('tab', { name: 'Meu Clube' }).focus()
    await u.keyboard('{ArrowRight}')
    expect(f.carregarFeed).toHaveBeenLastCalledWith('comunidade')
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

  it('desafio e conquista ganham etiqueta: desafio MARINHO 🎯, conquista DOURADA 🏅 (identidade Fase 6)', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [
      post({ id: 'a', tipo: 'desafio', desafio: { id: 'd1', titulo: 'Nó de escota' } }),
      post({ id: 'b', tipo: 'conquista', conquista: 'classe' }),
    ], proximo: null })
    renderRede(<RedeFeed />)
    const desafio = await screen.findByText(/Desafio: Nó de escota/)
    const conquista = screen.getByText(/Conquista · 🎖️ Classe/)
    expect(desafio).toHaveAttribute('data-tipo', 'desafio')
    expect(desafio).toHaveTextContent('🎯')
    expect(desafio.className).toContain('var(--rede-acao)')
    expect(conquista).toHaveAttribute('data-tipo', 'conquista')
    expect(conquista).toHaveTextContent('🏅')
    expect(conquista.className).toContain('var(--rede-destaque')
    // nenhum roxo/verde fixo: só variáveis da rede
    expect(desafio.className + conquista.className).not.toMatch(/#[0-9a-f]{6}/i)
  })

  it('post sem foto: texto maior em bloco, sem espaço de imagem vazio; #hashtag na cor de ação (marinho)', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ legenda: 'Reunião top #acampamento' })], proximo: null })
    renderRede(<RedeFeed />)
    const bloco = await screen.findByTestId('post-texto')
    expect(bloco).toHaveTextContent('Reunião top #acampamento')
    expect(screen.getByText('#acampamento').className).toContain('text-[var(--rede-acao)]')
    expect(screen.queryByTestId('foto-post')).toBeNull()
  })

  it('contadores com rótulo: "1 curtida" / "12 curtidas" / "3 comentários"; zero não aparece', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [
      post({ id: 'a', curtidas: 1, comentarios: 3 }),
      post({ id: 'b', curtidas: 12, comentarios: 0 }),
    ], proximo: null })
    renderRede(<RedeFeed />)
    const [a, b] = await screen.findAllByTestId('post')
    expect(within(a).getByTestId('contador-curtidas')).toHaveTextContent('1 curtida')
    expect(within(a).getByTestId('contador-comentarios')).toHaveTextContent('3 comentários')
    expect(within(b).getByTestId('contador-curtidas')).toHaveTextContent('12 curtidas')
    expect(within(b).queryByTestId('contador-comentarios')).toBeNull()
    // o botão continua com o nome acessível de sempre
    expect(within(b).getByRole('button', { name: 'Curtir, 12 curtidas' })).toBeInTheDocument()
  })

  it('cabeça do post: nome em negrito e "Clube · Unidade · há x"; a unidade só entra quando o servidor mandar (502)', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [
      post({ id: 'a' }),
      post({ id: 'b', autor: { id: 'u-bia', nome: 'Bia Lima', clube: 'Clube Leões', unidade: 'Unidade Falcão', foto: null } }),
      post({ id: 'c', autor: { id: 'u-cid', nome: 'Cid Melo', clube: 'Clube Leões', unidade: null, foto: null } }),
    ], proximo: null })
    renderRede(<RedeFeed />)
    const [a, b, c] = await screen.findAllByTestId('post')
    expect(within(a).getByTestId('autor-subtitulo')).toHaveTextContent(/^Clube Águias · (agora|há )/)
    expect(within(b).getByTestId('autor-subtitulo')).toHaveTextContent(/^Clube Leões · Unidade Falcão · (agora|há )/)
    expect(within(c).getByTestId('autor-subtitulo')).toHaveTextContent(/^Clube Leões · (agora|há )/)
    expect(within(a).getByText('Ana Souza', { selector: 'span' }).className).toContain('font-bold')
  })

  it('enquanto carrega: esqueleto no formato do post (e da fileira de stories), não "Carregando…" solto', async () => {
    let soltar
    f.carregarFeed.mockImplementation(() => new Promise((r) => { soltar = r }))
    f.carregarStories.mockImplementation(() => new Promise(() => {}))
    renderRede(<RedeFeed />)
    expect(screen.getByTestId('esqueleto-feed')).toBeInTheDocument()
    expect(screen.getAllByTestId('esqueleto-post').length).toBeGreaterThan(0)
    expect(screen.getByTestId('esqueleto-stories')).toBeInTheDocument()
    expect(screen.queryByTestId('esqueleto-tela')).toBeNull()
    soltar({ itens: [post()], proximo: null })
    await screen.findByTestId('post')
    expect(screen.queryByTestId('esqueleto-feed')).toBeNull()
  })

  it('feed vazio: quem publica ganha o botão "Publicar"; responsável não', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [], proximo: null })
    const { unmount } = renderRede(<RedeFeed />)
    expect(await screen.findByText('Ainda não há publicações')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Publicar' })).toHaveAttribute('href', '/rede/publicar')
    unmount()
    renderRede(<RedeFeed />, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    expect(await screen.findByText('Ainda não há publicações')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Publicar' })).toBeNull()
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

// Avatar na rede (migration 500): personagem (desenho) > foto autorizada > iniciais; nunca <img> quebrada.
describe('Rede DBV — avatar do autor', () => {
  const PERSONAGEM = { pele: '#f1c27d', cabelo: 'curto', corCabelo: '#2b1d0e', roupa: 'lisa', corRoupa: '#1e3a8a', acessorio: 'nenhum', corAcessorio: '#1e3a8a' }

  it('quem escolheu o personagem aparece com o DESENHO, sem <img> de rosto', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias', foto: null, avatar_tipo: 'personagem', avatar: PERSONAGEM } })], proximo: null })
    renderRede(<RedeFeed />)
    const card = await screen.findByTestId('post')
    expect(within(card).getByTestId('avatar-personagem').querySelector('svg')).not.toBeNull()
    expect(within(card).queryByRole('img')).toBeNull()
    expect(within(card).queryByTestId('avatar-iniciais')).toBeNull()
  })

  it('foto do servidor (só vem com a autorização de imagem): renderiza a <img>', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias', foto: 'http://x/storage/v1/object/public/imagens/perfis/u-ana-1.jpg' } })], proximo: null })
    const { container } = renderRede(<RedeFeed />)
    await screen.findByTestId('post')
    expect(container.querySelector('header img[src*="perfis/u-ana-1.jpg"]')).not.toBeNull()
    expect(screen.queryByTestId('avatar-personagem')).toBeNull()
  })

  it('sem personagem e sem foto: iniciais', async () => {
    renderRede(<RedeFeed />)
    const card = await screen.findByTestId('post')
    expect(within(card).getByTestId('avatar-iniciais')).toHaveTextContent('AS')
    expect(within(card).queryByRole('img')).toBeNull()
  })

  it('a foto falhou ao carregar: cai nas iniciais, nunca fica uma <img> quebrada', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias', foto: 'http://x/storage/v1/object/public/imagens/perfis/u-ana-1.jpg' } })], proximo: null })
    const { container } = renderRede(<RedeFeed />)
    const card = await screen.findByTestId('post')
    const img = container.querySelector('header img[src*="perfis/u-ana-1.jpg"]')
    fireEvent.error(img)
    expect(container.querySelector('header img')).toBeNull()
    expect(within(card).getByTestId('avatar-iniciais')).toHaveTextContent('AS')
  })

  it('"Seu story" usa o MEU perfil gateado (contexto), nunca a foto do profile do Auth', async () => {
    // o profile mockado do Auth não tem foto; o contexto (rede_perfil) diz personagem → personagem
    renderRede(<RedeFeed />, { eu: { id: 'eu', nome: 'Eu Mesmo', foto: null, avatar_tipo: 'personagem', avatar: PERSONAGEM } })
    const fileira = await screen.findByTestId('fileira-stories')
    expect(within(fileira).getByTestId('avatar-personagem')).toBeInTheDocument()
  })

  it('"Seu story" sem foto autorizada: iniciais (mesmo que o Auth tivesse foto)', async () => {
    renderRede(<RedeFeed />, { eu: { id: 'eu', nome: 'Eu Mesmo', foto: null } })
    const fileira = await screen.findByTestId('fileira-stories')
    expect(within(fileira).getByTestId('avatar-iniciais')).toHaveTextContent('EM')
    expect(within(fileira).queryByRole('img')).toBeNull()
  })
})

describe('Rede DBV — fileira de stories', () => {
  const grupos = [
    { meu: true, todos_vistos: true, autor: { id: 'eu', nome: 'Eu Mesmo', clube: 'Clube A' }, stories: [{ id: 's0', foto: 'a/eu/0.webp', criado_em: new Date().toISOString(), visto: false }] },
    { meu: false, todos_vistos: false, autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias' }, stories: [{ id: 's1', foto: 'b/ana/1.webp', criado_em: new Date().toISOString(), visto: false }] },
    { meu: false, todos_vistos: true, autor: { id: 'u-bia', nome: 'Bia Lima', clube: 'Clube Leões' }, stories: [{ id: 's2', foto: 'b/bia/2.webp', criado_em: new Date().toISOString(), visto: true }] },
  ]

  it('meus primeiro ("Seu story"), anel dourado→âmbar = não visto e cor de linha = visto', async () => {
    f.carregarStories.mockResolvedValue(grupos)
    renderRede(<RedeFeed />)
    const fileira = await screen.findByTestId('fileira-stories')
    const itens = within(fileira).getAllByRole('listitem')
    expect(itens[0]).toHaveTextContent('Seu story')
    const ana = within(fileira).getByRole('button', { name: 'Story de Ana Souza' })
    const bia = within(fileira).getByRole('button', { name: 'Story de Bia Lima (visto)' })
    expect(ana).toHaveAttribute('data-visto', 'nao')
    expect(bia).toHaveAttribute('data-visto', 'sim')
    expect(within(fileira).getByText('Ana')).toBeInTheDocument()
    const anelAna = within(ana).getByTestId('anel-story')
    const anelBia = within(bia).getByTestId('anel-story')
    expect(anelAna.className).toContain('from-[var(--rede-destaque)]')
    expect(anelAna.className).toContain('to-[var(--rede-ambar)]')
    expect(anelBia.className).toContain('bg-[var(--rede-linha)]')
    // nada de azul→roxo do Instagram
    expect(anelAna.className).not.toMatch(/3b5bff|8b5cf6|purple|violet/)
    // o "+" de criar story é marinho (cor de ação), não dourado
    expect(within(fileira).getByRole('button', { name: 'Adicionar story' }).className).toContain('bg-[var(--rede-acao)]')
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
