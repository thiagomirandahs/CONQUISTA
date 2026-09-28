// Comunidade (migrations 430–432). O servidor decide tudo; aqui garantimos que a tela explica quando não
// pode entrar, mostra a recusa gentil da triagem SEM publicar, desenha perfil mínimo (primeiro nome + clube),
// esconde a caixa de comentário do adulto de outro clube em post de criança, some com o denunciado e
// compartilha por dentro do app.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const f = {
  meuStatus: vi.fn(), carregarFeed: vi.fn(), curtir: vi.fn(), carregarComentarios: vi.fn(), comentar: vi.fn(),
  compartilhar: vi.fn(), denunciar: vi.fn(), apagar: vi.fn(), publicar: vi.fn(), urlDaFoto: vi.fn(),
}
vi.mock('../services/comunidade.js', async () => {
  const real = await vi.importActual('../services/comunidade.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../ui/avisos.jsx', () => ({ avisar: avisos }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu' } }) }))
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a' }) }))

const { default: Comunidade } = await import('./Comunidade.jsx')

const STATUS = { pode_ver: true, papel: 'desbravador', pode_publicar: true, suspenso_ate: null }
const post = (extra = {}) => ({
  id: 'p1', legenda: 'Acampamento incrível!', foto: null, autor: { nome: 'Ana', clube: 'Clube Águias' }, clube_id: 'clube-b',
  crianca: true, meu: false, criado_em: new Date().toISOString(), curtidas: 2, comentarios: 0, eu_curti: false, repost: null, ...extra,
})
const abrir = () => render(<MemoryRouter><Comunidade /></MemoryRouter>)

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  for (const fn of Object.values(avisos)) fn.mockClear()
  f.meuStatus.mockResolvedValue(STATUS)
  f.carregarFeed.mockResolvedValue({ itens: [post()], proximo: null })
  f.carregarComentarios.mockResolvedValue({ itens: [] })
  f.urlDaFoto.mockResolvedValue('blob:foto')
})

describe('Comunidade — acesso', () => {
  it('sem autorização do responsável: explica e não carrega o feed', async () => {
    f.meuStatus.mockResolvedValue({ pode_ver: false, motivo: 'sem_autorizacao' })
    abrir()
    expect(await screen.findByText('Falta a autorização do responsável')).toBeInTheDocument()
    expect(f.carregarFeed).not.toHaveBeenCalled()
  })

  it('responsável (pode ver, não publica): sem caixa de publicar', async () => {
    f.meuStatus.mockResolvedValue({ ...STATUS, papel: 'pais', pode_publicar: false })
    abrir()
    expect(await screen.findByText('Acampamento incrível!')).toBeInTheDocument()
    expect(screen.queryByLabelText('O que você quer compartilhar?')).toBeNull()
  })
})

describe('Comunidade — feed e publicação', () => {
  it('perfil público: primeiro nome + clube', async () => {
    abrir()
    const card = await screen.findByTestId('post')
    expect(within(card).getByText('Ana')).toBeInTheDocument()
    expect(within(card).getByText(/Clube Águias/)).toBeInTheDocument()
  })

  it('recusa da triagem: mostra a mensagem gentil e não entra no feed', async () => {
    const u = userEvent.setup()
    f.publicar.mockResolvedValue({ ok: false, motivo: 'ofensa', mensagem: 'Essa publicação não pode ser publicada. Vamos manter o respeito 🙂' })
    abrir()
    await screen.findByTestId('post')
    await u.type(screen.getByLabelText('O que você quer compartilhar?'), 'texto ruim')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vamos manter o respeito')
    expect(screen.getAllByTestId('post')).toHaveLength(1)
    expect(f.publicar).toHaveBeenCalledWith({ legenda: 'texto ruim', file: null, clubeId: 'clube-a', userId: 'eu' })
  })

  it('publicação aceita entra no topo', async () => {
    const u = userEvent.setup()
    f.publicar.mockResolvedValue({ ok: true, mensagem: 'Publicado! 🎉', post: post({ id: 'novo', legenda: 'Oi, Comunidade!', meu: true, autor: { nome: 'Eu', clube: 'Meu clube' } }) })
    abrir()
    await screen.findByTestId('post')
    await u.type(screen.getByLabelText('O que você quer compartilhar?'), 'Oi, Comunidade!')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    const posts = await screen.findAllByTestId('post')
    expect(posts).toHaveLength(2)
    expect(within(posts[0]).getByText('Oi, Comunidade!')).toBeInTheDocument()
  })

  it('foto em análise aparece só para o autor, com o aviso', async () => {
    f.carregarFeed.mockResolvedValue({ itens: [post({ meu: true, status: 'em_analise', foto: 'c/u/f.jpg' })], proximo: null })
    abrir()
    expect(await screen.findByText('Em análise')).toBeInTheDocument()
    expect(screen.getByText(/assim que a diretoria do seu clube aprovar/)).toBeInTheDocument()
    expect(await screen.findByAltText('Foto de Ana')).toHaveAttribute('src', 'blob:foto')
  })

  it('curtir chama o servidor e atualiza a contagem', async () => {
    const u = userEvent.setup()
    f.curtir.mockResolvedValue({ curtidas: 3, eu_curti: true })
    abrir()
    await screen.findByTestId('post')
    await u.click(screen.getByRole('button', { name: /2 curtidas/ }))
    expect(f.curtir).toHaveBeenCalledWith('p1', true)
    expect(await screen.findByRole('button', { name: /3 curtidas/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('compartilhar é repost DENTRO do app', async () => {
    const u = userEvent.setup()
    f.compartilhar.mockResolvedValue({ ok: true, mensagem: 'Compartilhado', post: post({ id: 'rp', legenda: null, repost: post() }) })
    abrir()
    await screen.findByTestId('post')
    await u.click(screen.getByRole('button', { name: 'Compartilhar na Comunidade' }))
    expect(f.compartilhar).toHaveBeenCalledWith('p1')
    expect(await screen.findByTestId('repost')).toBeInTheDocument()
  })

  it('denúncia que esconde tira o post da tela', async () => {
    const u = userEvent.setup()
    f.denunciar.mockResolvedValue({ ok: true, ocultou: true, mensagem: 'Obrigado!' })
    abrir()
    await screen.findByTestId('post')
    await u.click(screen.getByRole('button', { name: /Denunciar/ }))
    await u.click(await screen.findByRole('button', { name: 'Ofensivo ou desrespeitoso' }))
    expect(f.denunciar).toHaveBeenCalledWith('post', 'p1', 'ofensivo')
    await vi.waitFor(() => expect(screen.queryByTestId('post')).toBeNull())
  })
})

describe('Comunidade — comentários', () => {
  it('comentário recusado mostra a mensagem pedida pelo dono', async () => {
    const u = userEvent.setup()
    f.meuStatus.mockResolvedValue({ ...STATUS })
    f.carregarFeed.mockResolvedValue({ itens: [post({ clube_id: 'clube-a' })], proximo: null })
    f.comentar.mockResolvedValue({ ok: false, mensagem: 'Esse comentário não pode ser publicado. Vamos manter o respeito 🙂' })
    abrir()
    await screen.findByTestId('post')
    await u.click(screen.getByRole('button', { name: /comentários/ }))
    await u.type(await screen.findByLabelText('Escreva um comentário'), 'feio')
    await u.click(screen.getByRole('button', { name: 'Comentar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esse comentário não pode ser publicado. Vamos manter o respeito 🙂')
  })

  it('adulto de OUTRO clube não tem caixa de comentário em post de criança', async () => {
    const u = userEvent.setup()
    f.meuStatus.mockResolvedValue({ ...STATUS, papel: 'diretoria' })
    abrir()
    await screen.findByTestId('post')
    await u.click(screen.getByRole('button', { name: /comentários/ }))
    expect(await screen.findByText(/Adultos de outro clube não comentam/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Escreva um comentário')).toBeNull()
  })
})
