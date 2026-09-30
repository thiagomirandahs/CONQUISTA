// Perfil e Desafios da Rede DBV.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { carregarPerfil: vi.fn(), carregarPostsDoPerfil: vi.fn(), carregarDesafios: vi.fn(), urlDaFoto: vi.fn() }
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
vi.mock('../../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) } }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a' }) }))

const { renderRede, post, STATUS } = await import('./_testeRede.jsx')
const { default: RedePerfil } = await import('./RedePerfil.jsx')
const { default: RedeDesafios } = await import('./RedeDesafios.jsx')

const PERFIL = { id: 'u-ana', eu: false, nome: 'Ana Souza', clube: 'Clube Águias', papel: 'desbravador', desde: 2023,
  foto: null, imagem_autorizada: false, publicacoes: 4, conquistas: 1, pontos: 70 }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.carregarPerfil.mockResolvedValue(PERFIL)
  f.carregarPostsDoPerfil.mockResolvedValue({ itens: [post()], proximo: null })
})

describe('Rede DBV — perfil', () => {
  it('perfil de outra pessoa: nome + clube, "desde", contadores; sem foto = iniciais; sem aba Salvos', async () => {
    renderRede(<RedePerfil />, { rota: '/rede/perfil/u-ana', caminho: '/rede/perfil/:id' })
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument()
    expect(f.carregarPerfil).toHaveBeenCalledWith('u-ana')
    expect(screen.getByText(/Clube Águias/)).toBeInTheDocument()
    expect(screen.getByText('Desbravador(a) desde 2023')).toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
    expect(screen.getAllByText('AS').length).toBeGreaterThan(0)
    expect(screen.queryByRole('img', { name: '' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Salvos' })).toBeNull()
  })

  it('identidade Fase 6: selo do papel em MARINHO, conquistas em DOURADO, aba ativa sublinhada de dourado; unidade só se vier', async () => {
    renderRede(<RedePerfil />, { rota: '/rede/perfil/u-ana', caminho: '/rede/perfil/:id' })
    await screen.findByRole('heading', { name: 'Ana Souza' })
    const selos = screen.getByTestId('selos-perfil')
    expect(within(selos).getByText('Desbravador(a)').className).toContain('var(--rede-acao)')
    expect(within(selos).getByText('🏅 1 conquista').className).toContain('var(--rede-destaque')
    expect(screen.getByTestId('perfil-clube')).toHaveTextContent(/^Clube Águias$/)
    const ativa = screen.getByRole('tab', { name: 'Publicações' })
    expect(ativa).toHaveAttribute('aria-selected', 'true')
    expect(ativa.className).toContain('border-[var(--rede-destaque)]')
    expect(screen.getByRole('tab', { name: 'Textos' }).className).toContain('border-transparent')
  })

  it('coordenação no perfil: selo DOURADO "Coordenação" no lugar do papel; unidade entra na linha do clube quando vier', async () => {
    f.carregarPerfil.mockResolvedValue({ ...PERFIL, coordenacao: true, papel: 'coordenador_distrital', clube: 'Coordenação · Distrito Norte', unidade: 'Unidade Falcão', conquistas: 0 })
    renderRede(<RedePerfil />, { rota: '/rede/perfil/u-ana', caminho: '/rede/perfil/:id' })
    await screen.findByRole('heading', { name: /Ana Souza/ })
    const selos = screen.getByTestId('selos-perfil')
    expect(within(selos).getByText('Coordenação').className).toContain('var(--rede-destaque')
    expect(within(selos).queryByText(/conquista/)).toBeNull()
    expect(screen.getByTestId('perfil-clube')).toHaveTextContent('Unidade Falcão · Coordenação · Distrito Norte')
  })

  it('meu perfil tem a aba Salvos (só eu vejo) e troca de aba pede ao servidor', async () => {
    const u = userEvent.setup()
    f.carregarPerfil.mockResolvedValue({ ...PERFIL, eu: true })
    renderRede(<RedePerfil />, { rota: '/rede/perfil', caminho: '/rede/perfil' })
    await u.click(await screen.findByRole('tab', { name: 'Salvos' }))
    expect(f.carregarPostsDoPerfil).toHaveBeenLastCalledWith(null, 'salvos')
    await u.click(screen.getByRole('tab', { name: 'Conquistas' }))
    expect(f.carregarPostsDoPerfil).toHaveBeenLastCalledWith(null, 'conquistas')
  })

  it('estilo Instagram: fotos em grade de 3 colunas; aba Textos lista os posts sem foto', async () => {
    const u = userEvent.setup()
    f.urlDaFoto.mockResolvedValue('blob:x')
    f.carregarPostsDoPerfil.mockResolvedValue({ itens: [post({ id: 'f1', foto: 'c/u/1.webp' }), post({ id: 't1', legenda: 'Só texto' })], proximo: null })
    renderRede(<RedePerfil />, { rota: '/rede/perfil/u-ana', caminho: '/rede/perfil/:id' })
    const grade = await screen.findByTestId('grade-fotos')
    expect(grade.className).toContain('grid-cols-3')
    expect(grade.querySelectorAll('button')).toHaveLength(1)
    await u.click(screen.getByRole('tab', { name: 'Textos' }))
    expect(await screen.findByText('Só texto')).toBeInTheDocument()
    expect(f.carregarPostsDoPerfil).toHaveBeenLastCalledWith('u-ana', 'publicacoes')
  })

  it('com autorização de imagem a foto aparece', async () => {
    // para OUTRA pessoa o servidor não manda imagem_autorizada (500) — a foto vir já diz tudo
    f.carregarPerfil.mockResolvedValue({ ...PERFIL, foto: 'http://x/storage/v1/object/public/imagens/perfis/a-1.webp', imagem_autorizada: null })
    const { container } = renderRede(<RedePerfil />, { rota: '/rede/perfil/u-ana', caminho: '/rede/perfil/:id' })
    await screen.findByRole('heading', { name: 'Ana Souza' })
    expect(container.querySelector('img[src*="perfis/a-1.webp"]')).not.toBeNull()
    expect(screen.queryByTestId('aviso-foto-eu')).toBeNull()
  })

  it('personagem (500): o desenho aparece em vez das iniciais, sem <img> de rosto', async () => {
    f.carregarPerfil.mockResolvedValue({ ...PERFIL, avatar_tipo: 'personagem', avatar: { cabelo: 'curto', roupa: 'lisa', pele: '#f1c27d' } })
    const { container } = renderRede(<RedePerfil />, { rota: '/rede/perfil/u-ana', caminho: '/rede/perfil/:id' })
    await screen.findByRole('heading', { name: 'Ana Souza' })
    expect(screen.getByTestId('avatar-personagem').querySelector('svg')).not.toBeNull()
    expect(screen.queryByTestId('avatar-iniciais')).toBeNull()
    expect(container.querySelector('section img')).toBeNull()
  })

  it('meu perfil sem autorização de imagem: aviso de uma linha explica; com personagem o aviso não aparece', async () => {
    f.carregarPerfil.mockResolvedValue({ ...PERFIL, eu: true, imagem_autorizada: false })
    const r = renderRede(<RedePerfil />, { rota: '/rede/perfil', caminho: '/rede/perfil' })
    expect(await screen.findByTestId('aviso-foto-eu')).toHaveTextContent(/diretoria do seu clube arquivar a autorização de uso de imagem/)
    r.unmount()
    f.carregarPerfil.mockResolvedValue({ ...PERFIL, eu: true, imagem_autorizada: false, avatar_tipo: 'personagem', avatar: { cabelo: 'curto' } })
    renderRede(<RedePerfil />, { rota: '/rede/perfil', caminho: '/rede/perfil' })
    await screen.findByRole('heading', { name: 'Ana Souza' })
    expect(screen.queryByTestId('aviso-foto-eu')).toBeNull()
  })
})

describe('Rede DBV — desafios', () => {
  const DADOS = {
    semana: { id: 'd1', titulo: 'Foto na natureza', descricao: 'Tire uma foto', pontos: 50, dias_restantes: 4, participantes: 12, participei: false },
    outros: [{ id: 'd2', titulo: 'Nó de escota', descricao: '', pontos: 20, dias_restantes: 1, participantes: 3, participei: true }],
  }

  it('desafio da semana em destaque com pontos, dias restantes e Participar', async () => {
    f.carregarDesafios.mockResolvedValue(DADOS)
    renderRede(<RedeDesafios />)
    expect(await screen.findByRole('heading', { name: 'Foto na natureza' })).toBeInTheDocument()
    expect(screen.getByText('+50 pontos')).toBeInTheDocument()
    expect(screen.getByText('faltam 4 dias')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Participar' })).toHaveAttribute('href', '/rede/publicar?desafio=d1')
    expect(screen.getByText('Você participou ✅')).toBeInTheDocument()
  })

  it('responsável vê, mas sem botão de participar', async () => {
    f.carregarDesafios.mockResolvedValue(DADOS)
    renderRede(<RedeDesafios />, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    await screen.findByRole('heading', { name: 'Foto na natureza' })
    expect(screen.queryByRole('link', { name: 'Participar' })).toBeNull()
  })

  it('sem desafio aberto: mensagem', async () => {
    f.carregarDesafios.mockResolvedValue({ semana: null, outros: [] })
    renderRede(<RedeDesafios />)
    expect(await screen.findByText('Nenhum desafio aberto agora')).toBeInTheDocument()
  })
})
