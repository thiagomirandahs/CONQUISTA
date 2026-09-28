// Stories (viewer: avança sozinho em 5 s, toque direita/esquerda, segurar pausa, denunciar; story novo com a
// confirmação do dono antes de publicar) e Buscar da Rede DBV.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = {
  urlDaFoto: vi.fn(), marcarStoryVisto: vi.fn(), apagarStory: vi.fn(), denunciar: vi.fn(),
  prepararFotoStory: vi.fn(), publicarStory: vi.fn(), buscarNaRede: vi.fn(),
}
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../../ui/avisos.jsx', () => ({ avisar: avisos }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Eu Mesmo' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a' }) }))

const { renderRede } = await import('./_testeRede.jsx')
const { ViewerStories, NovoStory, DURACAO_STORY_MS } = await import('./Stories.jsx')
const { default: RedeBuscar, ESPERA_BUSCA_MS } = await import('./RedeBuscar.jsx')
const { CONFIRMAR_STORY } = await import('../../services/rede.js')

const agora = new Date().toISOString()
const GRUPOS = [
  { meu: false, todos_vistos: false, autor: { id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias' }, stories: [
    { id: 'a1', foto: 'b/ana/1.webp', texto: 'Primeiro', criado_em: agora, visto: false },
    { id: 'a2', foto: 'b/ana/2.webp', texto: 'Segundo', criado_em: agora, visto: false },
  ] },
  { meu: false, todos_vistos: false, autor: { id: 'u-bia', nome: 'Bia Lima', clube: 'Clube Leões' }, stories: [
    { id: 'b1', foto: 'c/bia/1.webp', texto: 'Da Bia', criado_em: agora, visto: false },
  ] },
]

const texto = () => screen.getByTestId('viewer-story').querySelector('p.pointer-events-none')?.textContent
async function flush() { await act(async () => { await Promise.resolve() }) }
async function passar(ms) { await act(async () => { vi.advanceTimersByTime(ms) }) }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  for (const fn of Object.values(avisos)) fn.mockClear()
  avisos.confirmar.mockImplementation(async () => true)
  f.urlDaFoto.mockImplementation(async (p) => `blob:${p}`)
  f.marcarStoryVisto.mockResolvedValue({ ok: true })
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:previa')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('Rede DBV — viewer de story', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('abre com nome + clube + tempo e barras de progresso; avança sozinho em 5 s e passa para a próxima pessoa', async () => {
    const aoFechar = vi.fn()
    render(<ViewerStories grupos={GRUPOS} inicio={0} aoFechar={aoFechar} />)
    await flush()
    const v = screen.getByTestId('viewer-story')
    expect(within(v).getByText(/Ana Souza/)).toBeInTheDocument()
    expect(within(v).getByText('Clube Águias')).toBeInTheDocument()
    expect(within(v).getAllByTestId('barra-story')).toHaveLength(2)
    expect(texto()).toBe('Primeiro')
    expect(f.marcarStoryVisto).toHaveBeenCalledWith('a1')
    await passar(DURACAO_STORY_MS + 100); await flush()
    expect(texto()).toBe('Segundo')
    await passar(DURACAO_STORY_MS + 100); await flush()
    expect(texto()).toBe('Da Bia')
    await passar(DURACAO_STORY_MS + 100); await flush()
    expect(aoFechar).toHaveBeenCalled()
  })

  it('toque à direita avança, à esquerda volta', async () => {
    render(<ViewerStories grupos={GRUPOS} inicio={0} aoFechar={vi.fn()} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Próximo story' })); await flush()
    expect(texto()).toBe('Segundo')
    fireEvent.click(screen.getByRole('button', { name: 'Story anterior' })); await flush()
    expect(texto()).toBe('Primeiro')
  })

  it('segurar pausa (e soltar depois de segurar não conta como toque)', async () => {
    render(<ViewerStories grupos={GRUPOS} inicio={0} aoFechar={vi.fn()} />)
    await flush()
    const v = screen.getByTestId('viewer-story')
    fireEvent.pointerDown(v)
    expect(v).toHaveAttribute('data-pausado', 'sim')
    await passar(DURACAO_STORY_MS * 2)
    expect(texto()).toBe('Primeiro')
    fireEvent.pointerUp(v)
    fireEvent.click(screen.getByRole('button', { name: 'Próximo story' })); await flush()
    expect(texto()).toBe('Primeiro')
    expect(v).toHaveAttribute('data-pausado', 'nao')
    await passar(DURACAO_STORY_MS + 100); await flush()
    expect(texto()).toBe('Segundo')
  })

  it('✕ e Esc fecham', async () => {
    const aoFechar = vi.fn()
    render(<ViewerStories grupos={GRUPOS} inicio={0} aoFechar={aoFechar} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(aoFechar).toHaveBeenCalledTimes(2)
  })

  it('denunciar pausa, envia como "story" e pula o que foi escondido', async () => {
    vi.useRealTimers()
    const u = userEvent.setup()
    const aoMudar = vi.fn()
    f.denunciar.mockResolvedValue({ ok: true, ocultou: true, mensagem: 'Obrigado!' })
    render(<ViewerStories grupos={GRUPOS} inicio={0} aoFechar={vi.fn()} aoMudar={aoMudar} />)
    await u.click(await screen.findByRole('button', { name: 'Denunciar' }))
    expect(screen.getByTestId('viewer-story')).toHaveAttribute('data-pausado', 'sim')
    await u.click(await screen.findByRole('button', { name: 'Foto inadequada' }))
    expect(f.denunciar).toHaveBeenCalledWith('story', 'a1', 'imagem')
    expect(aoMudar).toHaveBeenCalledWith({ tipo: 'removido', id: 'a1' })
    expect(texto()).toBe('Segundo')
  })

  it('meu story: sem denunciar, com apagar', async () => {
    const meus = [{ ...GRUPOS[0], meu: true }]
    render(<ViewerStories grupos={meus} inicio={0} aoFechar={vi.fn()} />)
    await flush()
    expect(screen.queryByRole('button', { name: 'Denunciar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Apagar story' })).toBeInTheDocument()
    expect(f.marcarStoryVisto).not.toHaveBeenCalled()
  })
})

describe('Rede DBV — story novo', () => {
  const pronta = { arquivo: new File(['x'], 'foto.webp', { type: 'image/webp' }), antes: 4_000_000, depois: 140_000 }

  it('confirmação do dono antes de publicar: "Voltar" não publica', async () => {
    const u = userEvent.setup()
    f.prepararFotoStory.mockResolvedValue(pronta)
    avisos.confirmar.mockImplementation(async () => false)
    render(<NovoStory arquivo={new File(['y'], 'IMG.jpg', { type: 'image/jpeg' })} clubeId="clube-a" userId="eu" aoFechar={vi.fn()} />)
    expect(await screen.findByTestId('tamanho-story')).toHaveTextContent('3,8 MB → 137 KB')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(CONFIRMAR_STORY)
    expect(CONFIRMAR_STORY.titulo).toBe('Tem certeza que quer publicar este story?')
    expect(CONFIRMAR_STORY.descricao).toBe('Ele fica visível para todos os clubes da Rede DBV por 24 horas.')
    expect(CONFIRMAR_STORY.cancelar).toBe('Voltar')
    expect(f.publicarStory).not.toHaveBeenCalled()
  })

  it('confirmou: publica com o texto (até 120)', async () => {
    const u = userEvent.setup()
    const aoPublicado = vi.fn()
    f.prepararFotoStory.mockResolvedValue(pronta)
    f.publicarStory.mockResolvedValue({ ok: true, status: 'publicado', mensagem: 'Story publicado!' })
    render(<NovoStory arquivo={new File(['y'], 'IMG.jpg', { type: 'image/jpeg' })} clubeId="clube-a" userId="eu" aoFechar={vi.fn()} aoPublicado={aoPublicado} />)
    await screen.findByTestId('tamanho-story')
    expect(screen.getByLabelText('Texto do story (opcional)')).toHaveAttribute('maxLength', '120')
    await u.type(screen.getByLabelText('Texto do story (opcional)'), 'Pôr do sol')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarStory).toHaveBeenCalledWith({ foto: pronta, texto: 'Pôr do sol', clubeId: 'clube-a', userId: 'eu' })
    expect(avisos.sucesso).toHaveBeenCalledWith('Story publicado!')
    expect(aoPublicado).toHaveBeenCalled()
  })

  it('recusa da triagem: mensagem e continua na tela', async () => {
    const u = userEvent.setup()
    f.prepararFotoStory.mockResolvedValue(pronta)
    f.publicarStory.mockResolvedValue({ ok: false, mensagem: 'Por segurança, não é permitido passar telefone 🙂' })
    render(<NovoStory arquivo={new File(['y'], 'IMG.jpg', { type: 'image/jpeg' })} clubeId="clube-a" userId="eu" aoFechar={vi.fn()} />)
    await screen.findByTestId('tamanho-story')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Por segurança')
  })
})

describe('Rede DBV — buscar', () => {
  it('menos de 2 letras não busca; depois busca e o resultado abre o perfil', async () => {
    const u = userEvent.setup()
    f.buscarNaRede.mockResolvedValue({ clubes: [], pessoas: [{ id: 'u-ana', nome: 'Ana Souza', clube: 'Clube Águias', foto: null }] })
    renderRede(<RedeBuscar />)
    expect(screen.getByText(/pelo menos 2 letras/)).toBeInTheDocument()
    await u.type(screen.getByLabelText('Buscar clubes e pessoas'), 'a')
    await new Promise((r) => setTimeout(r, ESPERA_BUSCA_MS + 50))
    expect(f.buscarNaRede).not.toHaveBeenCalled()
    await u.type(screen.getByLabelText('Buscar clubes e pessoas'), 'na')
    const link = await screen.findByRole('link', { name: /Ana Souza/ })
    expect(f.buscarNaRede).toHaveBeenLastCalledWith('ana', null)
    expect(link).toHaveAttribute('href', '/rede/perfil/u-ana')
    expect(link).toHaveTextContent('Clube Águias')
  })

  it('clube no resultado: tocar lista as pessoas do clube', async () => {
    const u = userEvent.setup()
    f.buscarNaRede.mockImplementation(async (termo, clube) => (clube
      ? { clubes: [], pessoas: [{ id: 'u-bia', nome: 'Bia Lima', clube: 'Clube Águias', foto: null }] }
      : { clubes: [{ id: 'c1', nome: 'Clube Águias', membros: 12 }], pessoas: [] }))
    renderRede(<RedeBuscar />)
    await u.type(screen.getByLabelText('Buscar clubes e pessoas'), 'águias')
    await u.click(await screen.findByRole('button', { name: /Clube Águias/ }))
    expect(await screen.findByRole('link', { name: /Bia Lima/ })).toHaveAttribute('href', '/rede/perfil/u-bia')
    expect(f.buscarNaRede).toHaveBeenLastCalledWith(null, 'c1')
  })

  it('nada encontrado', async () => {
    const u = userEvent.setup()
    f.buscarNaRede.mockResolvedValue({ clubes: [], pessoas: [] })
    renderRede(<RedeBuscar />)
    await u.type(screen.getByLabelText('Buscar clubes e pessoas'), 'zzz')
    expect(await screen.findByText(/Ninguém encontrado/)).toBeInTheDocument()
  })
})
