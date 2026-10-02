// STORIES PARA TODOS NA COMUNIDADE (migration 535, decisão do dono de 02/10/2026).
// Regra: qualquer participante publica um story para todos os clubes da Rede pela aba Comunidade; NÃO existe módulo de
// amigos nem "seguir"; não há aprovação prévia (moderação por denúncia). A faixa do Meu Clube continua como era.
// Aqui: a faixa na aba Comunidade (uma chamada, com o alcance), "Seu story" + "+" publicando com alcance comunidade e a
// confirmação clara, nome + clube de cada pessoa, visto/não visto, viewer reutilizado (denunciar, apagar o próprio,
// teclado), mídia sob demanda (assina só o story aberto e pré-carrega só o próximo), degradação com banco sem a 535 e
// alvos de toque/rolagem para celular.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const f = {
  carregarFeed: vi.fn(), urlDaFoto: vi.fn(), carregarStories: vi.fn(), marcarStoryVisto: vi.fn(), apagarStory: vi.fn(),
  denunciar: vi.fn(), prepararFotoStory: vi.fn(), publicarStory: vi.fn(), carregarComentarios: vi.fn(),
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

const { renderRede, STATUS } = await import('./_testeRede.jsx')
const { default: RedeFeed } = await import('./RedeFeed.jsx')
const { FileiraStories, ViewerStories, NovoStory } = await import('./Stories.jsx')
const { CONFIRMAR_STORY, CONFIRMAR_STORY_COMUNIDADE, confirmacaoDeStory, QUEM_VE_STORY } = await import('../../services/rede.js')

const agora = new Date().toISOString()
const DO_CLUBE = [
  { meu: false, todos_vistos: false, autor: { id: 'u-caio', nome: 'Caio Pereira', clube: 'Clube A' }, stories: [
    { id: 'k1', foto: 'a/caio/1.webp', texto: 'Só do clube', criado_em: agora, visto: false, alcance: 'clube' }] },
]
const DA_COMUNIDADE = [
  { meu: true, todos_vistos: true, autor: { id: 'eu', nome: 'Eu Mesmo', clube: 'Clube A' }, stories: [
    { id: 'm0', foto: 'a/eu/0.webp', texto: 'Meu', criado_em: agora, visto: false, alcance: 'comunidade', status: 'publicado' }] },
  { meu: false, todos_vistos: false, autor: { id: 'u-ana', nome: 'Ana S.', clube: 'Clube Águias' }, stories: [
    { id: 'a1', foto: 'b/ana/1.webp', texto: 'Primeiro', criado_em: agora, visto: false, alcance: 'comunidade' },
    { id: 'a2', foto: 'b/ana/2.webp', texto: 'Segundo', criado_em: agora, visto: false, alcance: 'comunidade' }] },
  { meu: false, todos_vistos: true, autor: { id: 'u-bia', nome: 'Bia Lima', clube: 'Clube Leões do Norte' }, stories: [
    { id: 'b1', foto: 'c/bia/1.webp', texto: 'Da Bia', criado_em: agora, visto: true, alcance: 'comunidade' }] },
]
const porAlcance = (alcance) => (alcance === 'comunidade' ? DA_COMUNIDADE : DO_CLUBE)
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  for (const fn of Object.values(avisos)) fn.mockClear()
  avisos.confirmar.mockImplementation(async () => true)
  f.carregarFeed.mockResolvedValue({ itens: [], proximo: null })
  f.carregarComentarios.mockResolvedValue({ itens: [] })
  f.carregarStories.mockImplementation(async (alcance) => porAlcance(alcance))
  f.urlDaFoto.mockImplementation(async (p) => `blob:${p}`)
  f.marcarStoryVisto.mockResolvedValue({ ok: true })
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:previa')
  globalThis.URL.revokeObjectURL = vi.fn()
})

async function abrirComunidade(u, opcoes) {
  renderRede(<RedeFeed />, opcoes)
  await screen.findByRole('list', { name: 'Stories' })
  await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
  return screen.findByRole('list', { name: 'Stories da Comunidade' })
}

describe('Stories para todos na Comunidade — faixa na aba Comunidade', () => {
  it('uma chamada por aba, a da Comunidade só quando a aba abre; sem assinar nenhuma foto de story antes de abrir', async () => {
    const u = userEvent.setup()
    renderRede(<RedeFeed />)
    await screen.findByRole('list', { name: 'Stories' })
    expect(f.carregarStories.mock.calls).toEqual([[]])
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    await screen.findByRole('list', { name: 'Stories da Comunidade' })
    expect(f.carregarStories.mock.calls).toEqual([[], ['comunidade']])
    await u.click(screen.getByRole('tab', { name: 'Meu Clube' }))
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    expect(f.carregarStories.mock.calls).toEqual([[], ['comunidade']])   // voltar à aba não pede de novo
    expect(f.urlDaFoto).not.toHaveBeenCalled()                            // a faixa só traz caminhos: nada de mídia
  })

  it('"Seu story" primeiro; os demais com avatar, nome e CLUBE; anel de visto/não visto', async () => {
    const u = userEvent.setup()
    const fileira = await abrirComunidade(u)
    const itens = within(fileira).getAllByRole('listitem')
    expect(itens).toHaveLength(3)
    expect(itens[0]).toHaveTextContent('Seu story')
    expect(itens[1]).toHaveTextContent('Ana')
    expect(within(itens[1]).getByTestId('clube-do-story')).toHaveTextContent('Clube Águias')
    expect(within(itens[2]).getByTestId('clube-do-story')).toHaveTextContent('Clube Leões do Norte')
    expect(within(itens[1]).getByTestId('anel-story')).toHaveAttribute('data-estado', 'novo')
    expect(within(itens[2]).getByTestId('anel-story')).toHaveAttribute('data-estado', 'visto')
    expect(within(fileira).getByRole('button', { name: 'Story de Ana S., Clube Águias' })).toBeInTheDocument()
    expect(within(fileira).getByRole('button', { name: 'Story de Bia Lima, Clube Leões do Norte (visto)' })).toBeInTheDocument()
    // o story de alcance clube NÃO aparece na Comunidade
    expect(within(fileira).queryByRole('button', { name: /Caio/ })).toBeNull()
  })

  it('a faixa do Meu Clube continua sem o nome do clube embaixo e sem os stories de outros clubes', async () => {
    renderRede(<RedeFeed />)
    const fileira = await screen.findByRole('list', { name: 'Stories' })
    expect(within(fileira).getByRole('button', { name: 'Story de Caio Pereira' })).toBeInTheDocument()
    expect(within(fileira).queryByTestId('clube-do-story')).toBeNull()
    expect(within(fileira).queryByRole('button', { name: /Ana|Bia/ })).toBeNull()
  })

  it('mobile: rolagem lateral SÓ dentro da faixa, itens de largura fixa com texto truncado e toque ≥ 44px', async () => {
    const u = userEvent.setup()
    const fileira = await abrirComunidade(u)
    expect(fileira.className).toContain('overflow-x-auto')
    expect(fileira.className).toContain('overscroll-x-contain')
    for (const item of within(fileira).getAllByRole('listitem')) {
      expect(item.className).toContain('shrink-0')
      expect(item.className).toContain('w-[72px]')
    }
    expect(within(fileira).getAllByTestId('clube-do-story')[1].className).toContain('truncate')
    // a bolinha tocável tem 60px+ (avatar w-[60px]); nada de neon: só as variáveis do tema da Rede
    expect(fileira.innerHTML).toContain('w-[60px]')
    expect(fileira.innerHTML).not.toMatch(/shadow-\[0_0|animate-ping|neon/)
  })

  it('responsável (não publica): vê a faixa da Comunidade, sem "Seu story" nem "+"', async () => {
    const u = userEvent.setup()
    f.carregarStories.mockImplementation(async (a) => porAlcance(a).filter((g) => !g.meu))
    const fileira = await abrirComunidade(u, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    expect(within(fileira).queryByText('Seu story')).toBeNull()
    expect(screen.queryByRole('button', { name: /Adicionar story/ })).toBeNull()
    expect(within(fileira).getByRole('button', { name: /Story de Ana S\./ })).toBeInTheDocument()
  })

  it('enquanto a faixa da Comunidade carrega: bolinhas-esqueleto', async () => {
    const u = userEvent.setup()
    f.carregarStories.mockImplementation((a) => (a === 'comunidade' ? new Promise(() => {}) : Promise.resolve(DO_CLUBE)))
    renderRede(<RedeFeed />)
    await screen.findByRole('list', { name: 'Stories' })
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    expect(await screen.findByTestId('esqueleto-stories')).toBeInTheDocument()
  })

  it('banco ainda SEM a 535 (serviço devolve null): a aba Comunidade abre normal, só sem a faixa', async () => {
    const u = userEvent.setup()
    f.carregarStories.mockImplementation(async (a) => (a === 'comunidade' ? null : DO_CLUBE))
    renderRede(<RedeFeed />)
    await screen.findByRole('list', { name: 'Stories' })
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    await flush()
    expect(screen.queryByTestId('fileira-stories')).toBeNull()
    expect(screen.queryByTestId('esqueleto-stories')).toBeNull()
    expect(screen.queryByRole('button', { name: /Adicionar story/ })).toBeNull()
    expect(screen.getByTestId('subtitulo-aba')).toHaveTextContent('Todos os clubes da Rede')
    expect(screen.getByTestId('vazio-rede')).toBeInTheDocument()
  })

  it('erro ao carregar a faixa da Comunidade não derruba a tela', async () => {
    const u = userEvent.setup()
    f.carregarStories.mockImplementation(async (a) => { if (a === 'comunidade') throw new Error('rede caiu'); return DO_CLUBE })
    renderRede(<RedeFeed />)
    await screen.findByRole('list', { name: 'Stories' })
    await u.click(screen.getByRole('tab', { name: 'Comunidade' }))
    expect(await screen.findByRole('list', { name: 'Stories da Comunidade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar story na Comunidade' })).toBeInTheDocument()
  })
})

describe('Stories para todos na Comunidade — publicar', () => {
  const pronta = { arquivo: new File(['x'], 'foto.webp', { type: 'image/webp' }), antes: 4_000_000, depois: 140_000 }
  const escolherFoto = () => fireEvent.change(screen.getByLabelText('Foto do story'), { target: { files: [new File(['y'], 'IMG.jpg', { type: 'image/jpeg' })] } })

  it('textos: "Só o seu clube vê" × "Todos os clubes da Rede vão ver por 24 horas"', () => {
    expect(CONFIRMAR_STORY.descricao).toBe('Ele fica visível só para o seu clube por 24 horas.')
    expect(CONFIRMAR_STORY_COMUNIDADE.descricao).toBe('Todos os clubes da Rede vão ver por 24 horas.')
    expect(CONFIRMAR_STORY_COMUNIDADE.cancelar).toBe('Voltar')
    expect(confirmacaoDeStory('comunidade')).toBe(CONFIRMAR_STORY_COMUNIDADE)
    expect(confirmacaoDeStory('clube')).toBe(CONFIRMAR_STORY)
    expect(confirmacaoDeStory(undefined)).toBe(CONFIRMAR_STORY)
    expect(QUEM_VE_STORY.comunidade).toMatch(/Todos os clubes da Rede/)
    expect(QUEM_VE_STORY.clube).toMatch(/Só o seu clube/)
  })

  it('o "+" da aba Comunidade publica com alcance comunidade, depois da confirmação clara; recarrega as duas faixas', async () => {
    const u = userEvent.setup()
    f.prepararFotoStory.mockResolvedValue(pronta)
    f.publicarStory.mockResolvedValue({ ok: true, status: 'publicado', alcance: 'comunidade', mensagem: 'Story publicado para todos os clubes da Rede!' })
    f.carregarStories.mockImplementation(async (a) => porAlcance(a).filter((g) => !g.meu))
    const fileira = await abrirComunidade(u)
    expect(within(fileira).getByRole('button', { name: 'Adicionar story na Comunidade' })).toBeInTheDocument()
    expect(within(fileira).getByRole('button', { name: 'Criar o seu story para a Comunidade' })).toBeInTheDocument()
    escolherFoto()
    const dialogo = await screen.findByRole('dialog', { name: 'Novo story na Comunidade' })
    expect(within(dialogo).getByTestId('quem-ve-story')).toHaveTextContent('Todos os clubes da Rede vão ver por 24 horas')
    await screen.findByTestId('tamanho-story')
    await u.click(within(dialogo).getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(CONFIRMAR_STORY_COMUNIDADE)
    expect(f.publicarStory).toHaveBeenCalledWith({ foto: pronta, texto: '', clubeId: 'clube-a', userId: 'eu', alcance: 'comunidade' })
    expect(avisos.sucesso).toHaveBeenCalledWith('Story publicado para todos os clubes da Rede!')
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Novo story na Comunidade' })).toBeNull()
    expect(f.carregarStories.mock.calls.filter(([a]) => a === 'comunidade')).toHaveLength(2)
    expect(f.carregarStories.mock.calls.filter(([a]) => a === undefined)).toHaveLength(2)
  })

  it('"Voltar" na confirmação NÃO publica', async () => {
    const u = userEvent.setup()
    f.prepararFotoStory.mockResolvedValue(pronta)
    avisos.confirmar.mockImplementation(async () => false)
    f.carregarStories.mockImplementation(async (a) => porAlcance(a).filter((g) => !g.meu))
    await abrirComunidade(u)
    escolherFoto()
    await screen.findByTestId('tamanho-story')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(CONFIRMAR_STORY_COMUNIDADE)
    expect(f.publicarStory).not.toHaveBeenCalled()
  })

  it('o "+" da aba Meu Clube continua publicando SÓ para o clube', async () => {
    const u = userEvent.setup()
    f.prepararFotoStory.mockResolvedValue(pronta)
    f.publicarStory.mockResolvedValue({ ok: true, status: 'publicado', mensagem: 'Story publicado!' })
    renderRede(<RedeFeed />)
    await screen.findByRole('list', { name: 'Stories' })
    escolherFoto()
    const dialogo = await screen.findByRole('dialog', { name: 'Novo story' })
    expect(within(dialogo).getByTestId('quem-ve-story')).toHaveTextContent('Só o seu clube vê por 24 horas')
    await screen.findByTestId('tamanho-story')
    await u.click(within(dialogo).getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(CONFIRMAR_STORY)
    expect(f.publicarStory).toHaveBeenCalledWith(expect.objectContaining({ alcance: 'clube' }))
    await flush()
    expect(f.carregarStories.mock.calls.filter(([a]) => a === 'comunidade')).toHaveLength(0)   // faixa nunca pedida não é pedida agora
  })

  it('servidor recusa (ex.: banco sem a 535): mensagem amigável e a tela continua', async () => {
    const u = userEvent.setup()
    f.prepararFotoStory.mockResolvedValue(pronta)
    f.publicarStory.mockRejectedValue(new Error('Os stories da Comunidade ainda não estão disponíveis. Por enquanto, publique no Meu Clube 🙂'))
    render(<NovoStory arquivo={new File(['y'], 'IMG.jpg', { type: 'image/jpeg' })} alcance="comunidade" clubeId="clube-a" userId="eu" aoFechar={vi.fn()} />)
    await screen.findByTestId('tamanho-story')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ainda não estão disponíveis')
    expect(screen.getByRole('button', { name: 'Publicar' })).not.toBeDisabled()
  })
})

describe('Stories para todos na Comunidade — viewer reutilizado', () => {
  it('abre pela faixa da Comunidade: nome + clube + "Todos os clubes" + tempo; marca visto; denunciar', async () => {
    const u = userEvent.setup()
    f.denunciar.mockResolvedValue({ ok: true, ocultou: true, mensagem: 'Obrigado!' })
    const fileira = await abrirComunidade(u)
    await u.click(within(fileira).getByRole('button', { name: /Story de Ana S\./ }))
    const v = await screen.findByTestId('viewer-story')
    expect(within(v).getByText(/Ana S\./)).toBeInTheDocument()
    expect(within(v).getByText(/Clube Águias/)).toBeInTheDocument()
    expect(within(v).getByTestId('alcance-story')).toHaveTextContent('Todos os clubes')
    expect(within(v).getByText(/· agora/)).toBeInTheDocument()   // tempo desde a publicação
    expect(within(v).getAllByTestId('barra-story')).toHaveLength(2)
    expect(f.marcarStoryVisto).toHaveBeenCalledWith('a1')
    await u.click(within(v).getByRole('button', { name: 'Denunciar' }))
    await u.click(await screen.findByRole('button', { name: 'Foto inadequada' }))
    expect(f.denunciar).toHaveBeenCalledWith('story', 'a1', 'imagem')
  })

  it('story de alcance clube NÃO mostra "Todos os clubes"', async () => {
    render(<ViewerStories grupos={DO_CLUBE} inicio={0} aoFechar={vi.fn()} />)
    await flush()
    expect(screen.queryByTestId('alcance-story')).toBeNull()
  })

  it('o meu story da Comunidade: apagar (sem denunciar)', async () => {
    const u = userEvent.setup()
    f.apagarStory.mockResolvedValue({ ok: true })
    const aoFechar = vi.fn()
    render(<ViewerStories grupos={DA_COMUNIDADE} inicio={0} aoFechar={aoFechar} />)
    await flush()
    expect(screen.queryByRole('button', { name: 'Denunciar' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Apagar story' }))
    await flush()
    expect(f.apagarStory).toHaveBeenCalledWith('m0')
    expect(aoFechar).toHaveBeenCalled()
    expect(f.marcarStoryVisto).not.toHaveBeenCalled()
  })

  it('mídia sob demanda: assina só o story aberto e pré-carrega só o próximo; avançar reaproveita a URL', async () => {
    render(<ViewerStories grupos={DA_COMUNIDADE} inicio={1} aoFechar={vi.fn()} />)
    await flush()
    expect(f.urlDaFoto.mock.calls.map(([p]) => p)).toEqual(['b/ana/1.webp', 'b/ana/2.webp'])
    expect(screen.getByTestId('viewer-story').querySelector('img[src="blob:b/ana/1.webp"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Próximo story' }))
    await flush()
    expect(screen.getByTestId('viewer-story').querySelector('img[src="blob:b/ana/2.webp"]')).not.toBeNull()
    // o 2º já estava assinado (não assina de novo); agora só o próximo (da Bia) entra
    expect(f.urlDaFoto.mock.calls.map(([p]) => p)).toEqual(['b/ana/1.webp', 'b/ana/2.webp', 'c/bia/1.webp'])
    expect(f.urlDaFoto.mock.calls.map(([p]) => p)).not.toContain('a/eu/0.webp')
  })

  it('teclado (desktop): → avança, ← volta, Esc fecha; botões do topo com alvo de 44px', async () => {
    const aoFechar = vi.fn()
    render(<ViewerStories grupos={DA_COMUNIDADE} inicio={1} aoFechar={aoFechar} />)
    await flush()
    const texto = () => screen.getByTestId('viewer-story').querySelector('p.pointer-events-none')?.textContent
    expect(texto()).toBe('Primeiro')
    fireEvent.keyDown(document, { key: 'ArrowRight' }); await flush()
    expect(texto()).toBe('Segundo')
    fireEvent.keyDown(document, { key: 'ArrowLeft' }); await flush()
    expect(texto()).toBe('Primeiro')
    for (const nome of ['Denunciar', 'Fechar']) {
      expect(screen.getByRole('button', { name: nome }).className).toContain('w-11 h-11')
    }
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(aoFechar).toHaveBeenCalled()
  })

  it('foto que o servidor não libera (expirou/foi removida): "Foto indisponível", sem <img> quebrada', async () => {
    f.urlDaFoto.mockResolvedValue(null)
    render(<ViewerStories grupos={[DA_COMUNIDADE[2]]} inicio={0} aoFechar={vi.fn()} />)
    await flush()
    expect(screen.getByText('Foto indisponível')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-story').querySelector('img')).toBeNull()
  })

  it('a fileira isolada também serve à Comunidade (mesmo componente, sem estrutura paralela)', () => {
    render(<FileiraStories alcance="comunidade" grupos={DA_COMUNIDADE} eu={{ id: 'eu', nome: 'Eu Mesmo' }} podePublicar aoAbrir={vi.fn()} aoNovo={vi.fn()} />)
    expect(screen.getByTestId('fileira-stories')).toHaveAttribute('data-alcance', 'comunidade')
    expect(screen.getByRole('button', { name: 'Ver o seu story' })).toBeInTheDocument()
  })
})

// REGRA DE PRODUTO: "Stories para todos na Comunidade sem módulo de amigos".
describe('Stories para todos na Comunidade — sem módulo de amigos', () => {
  const raiz = join(process.cwd(), 'src')
  const arquivos = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(join(dir, e.name))
    : /\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name) ? [join(dir, e.name)] : []))

  it('o serviço da Rede não tem (nem chama) nada de amizade/seguir, e o story só conhece os alcances clube|comunidade', async () => {
    const rede = await vi.importActual('../../services/rede.js')
    expect(Object.keys(rede).filter((k) => /amig|amizade|seguir|seguidor|seguindo|follow|friend/i.test(k))).toEqual([])
    expect([...rede.ALCANCES]).toEqual(['clube', 'comunidade'])
    const fonte = readFileSync(join(raiz, 'services', 'rede.js'), 'utf8') + readFileSync(join(raiz, 'services', 'comunidade.js'), 'utf8')
    const rpcs = [...fonte.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1])
    expect(rpcs.length).toBeGreaterThan(10)
    expect(rpcs.filter((n) => /amig|amizade|segu(ir|idor|indo)|follow|friend/.test(n))).toEqual([])
  })

  it('nenhuma tela da Rede oferece "seguir", "adicionar amigo" ou "amigos"', () => {
    const telas = arquivos(join(raiz, 'pages', 'rede'))
    expect(telas.length).toBeGreaterThan(5)
    const achados = telas.filter((a) => /(Seguir|Seguindo|Seguidores|Adicionar amigo|Meus amigos|Só amigos|Melhores amigos)/.test(readFileSync(a, 'utf8')))
    expect(achados).toEqual([])
  })
})
