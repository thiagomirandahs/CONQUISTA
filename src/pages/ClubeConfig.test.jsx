import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let clube
const recarregar = vi.fn()
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
const gravarMarca = vi.fn()
const definirRecurso = vi.fn()
const carregarCatalogoRecursos = vi.fn()
const subirLogoDoClube = vi.fn()
vi.mock('../services/clubes.js', () => ({
  gravarMarca: (...a) => gravarMarca(...a),
  definirRecurso: (...a) => definirRecurso(...a),
  carregarCatalogoRecursos: (...a) => carregarCatalogoRecursos(...a),
  subirLogoDoClube: (...a) => subirLogoDoClube(...a),
}))

const { default: ClubeConfig } = await import('./ClubeConfig.jsx')

const CATALOGO = [
  { chave: 'chat', nome: 'Chat', descricao: 'Conversas do clube', icone: '💬', padrao: true, ordem: 60 },
  { chave: 'leilao', nome: 'Leilão', descricao: 'Lances com pontos', icone: '🏛️', padrao: false, ordem: 50 },
]
const marcaB = { nome: 'Clube B', sigla: 'CB', lema: 'Lema B', descricao: null, desde: 2010, corPrimaria: '#112233', corSecundaria: null, logoUrl: null }

function comoLideranca(extra = {}) {
  clube = { podeGerir: true, marca: marcaB, recursos: { chat: true, leilao: false }, clubeId: 'clube-b', recarregar, ...extra }
}

beforeEach(() => {
  gravarMarca.mockReset().mockResolvedValue({})
  definirRecurso.mockReset().mockResolvedValue({})
  carregarCatalogoRecursos.mockReset().mockResolvedValue(CATALOGO)
  subirLogoDoClube.mockReset()
  recarregar.mockReset().mockResolvedValue()
  comoLideranca()
})

const salvar = () => screen.getByRole('button', { name: /Salvar identidade/ })

describe('acesso', () => {
  it('quem não é liderança vê só o aviso — sem formulário nem recursos', () => {
    comoLideranca({ podeGerir: false })
    render(<ClubeConfig />)
    expect(screen.getByText('Só a liderança')).toBeInTheDocument()
    expect(screen.queryByLabelText('Identidade do clube')).toBeNull()
    expect(carregarCatalogoRecursos).not.toHaveBeenCalled()
  })
})

describe('identidade do clube', () => {
  it('mostra a marca do clube em uso e o botão só liga quando algo mudou', async () => {
    render(<ClubeConfig />)
    expect(screen.getByLabelText('Nome do clube')).toHaveValue('Clube B')
    expect(screen.getByLabelText('Sigla')).toHaveValue('CB')
    expect(salvar()).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nome do clube'), ' Oficial')
    expect(salvar()).toBeEnabled()
  })

  it('salva SÓ o que mudou e recarrega o contexto (a marca nova aparece no app)', async () => {
    render(<ClubeConfig />)
    const nome = screen.getByLabelText('Nome do clube')
    await userEvent.clear(nome)
    await userEvent.type(nome, 'Clube B Oficial')
    await userEvent.click(salvar())
    await waitFor(() => expect(gravarMarca).toHaveBeenCalledTimes(1))
    expect(gravarMarca).toHaveBeenCalledWith({ nome: 'Clube B Oficial' })
    expect(recarregar).toHaveBeenCalled()
    expect(await screen.findByText('Identidade salva ✅')).toBeInTheDocument()
  })

  it('esvaziar o lema volta ao padrão (envia null)', async () => {
    render(<ClubeConfig />)
    await userEvent.clear(screen.getByLabelText('Lema'))
    await userEvent.click(salvar())
    await waitFor(() => expect(gravarMarca).toHaveBeenCalledWith({ lema: null }))
  })

  it('cor clara demais é avisada e NÃO envia (o texto branco ficaria ilegível para o clube todo)', async () => {
    render(<ClubeConfig />)
    const cor = screen.getAllByPlaceholderText('#rrggbb')[0]
    await userEvent.clear(cor)
    await userEvent.type(cor, '#ffff00')
    expect(screen.getByRole('alert')).toHaveTextContent(/clara demais/)
    expect(salvar()).toBeDisabled()
    expect(gravarMarca).not.toHaveBeenCalled()
  })

  it('cor fora do formato é avisada', async () => {
    render(<ClubeConfig />)
    const cor = screen.getAllByPlaceholderText('#rrggbb')[1]
    await userEvent.type(cor, 'azul')
    expect(screen.getByRole('alert')).toHaveTextContent(/#rrggbb/)
    expect(salvar()).toBeDisabled()
  })

  it('erro do servidor aparece e nada é dado como salvo', async () => {
    gravarMarca.mockRejectedValue(new Error('Sem permissão (apenas a liderança do clube).'))
    render(<ClubeConfig />)
    await userEvent.type(screen.getByLabelText('Nome do clube'), 'x')
    await userEvent.click(salvar())
    expect(await screen.findByText(/Sem permissão/)).toBeInTheDocument()
    expect(screen.queryByText('Identidade salva ✅')).toBeNull()
    expect(recarregar).not.toHaveBeenCalled()
  })

  it('envia a logo para a pasta DESTE clube, mostra na prévia e salva a URL', async () => {
    subirLogoDoClube.mockResolvedValue('https://p.supabase.co/storage/v1/object/public/publico/clube-b/logo-1.png')
    render(<ClubeConfig />)
    const arquivo = new File(['x'], 'logo.png', { type: 'image/png' })
    await userEvent.upload(document.querySelector('input[type="file"]'), arquivo)
    await waitFor(() => expect(subirLogoDoClube).toHaveBeenCalledWith({ clubeId: 'clube-b', file: arquivo }))
    const previa = within(screen.getByLabelText('Prévia'))
    await waitFor(() => expect(document.querySelector('[aria-label="Prévia"] img')).toHaveAttribute('src', expect.stringContaining('/publico/clube-b/logo-1.png')))
    expect(previa.getByText('Clube B')).toBeInTheDocument()
    await userEvent.click(salvar())
    await waitFor(() => expect(gravarMarca).toHaveBeenCalledWith({ logo_url: 'https://p.supabase.co/storage/v1/object/public/publico/clube-b/logo-1.png' }))
  })

  it('falha no envio da logo mostra o erro e não altera nada', async () => {
    subirLogoDoClube.mockRejectedValue(new Error('Para a logo use JPG, PNG, WebP ou GIF.'))
    render(<ClubeConfig />)
    await userEvent.upload(document.querySelector('input[type="file"]'), new File(['x'], 'a.heic', { type: 'image/heic' }))
    expect(await screen.findByText(/JPG, PNG, WebP ou GIF/)).toBeInTheDocument()
    expect(salvar()).toBeDisabled()
  })

  it('a prévia mostra a sigla quando o clube não tem logo', () => {
    render(<ClubeConfig />)
    expect(within(screen.getByLabelText('Prévia')).getByText('CB')).toBeInTheDocument()
  })
})

describe('recursos (feature flags) do clube', () => {
  it('lista o catálogo com o estado ligado/desligado DESTE clube', async () => {
    render(<ClubeConfig />)
    const chat = await screen.findByRole('switch', { name: 'Chat: ligado' })
    expect(chat).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Leilão: desligado' })).toHaveAttribute('aria-checked', 'false')
  })

  it('desligar um recurso chama o servidor e recarrega o contexto', async () => {
    render(<ClubeConfig />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Chat: ligado' }))
    await waitFor(() => expect(definirRecurso).toHaveBeenCalledWith('chat', false))
    expect(recarregar).toHaveBeenCalled()
  })

  it('ligar o leilão manda ligar', async () => {
    render(<ClubeConfig />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Leilão: desligado' }))
    await waitFor(() => expect(definirRecurso).toHaveBeenCalledWith('leilao', true))
  })

  it('recusa do servidor (ex.: leilão aberto) aparece na tela', async () => {
    definirRecurso.mockRejectedValue(new Error('Há leilão aberto: encerre ou cancele antes de desligar o leilão.'))
    comoLideranca({ recursos: { chat: true, leilao: true } })
    render(<ClubeConfig />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Leilão: ligado' }))
    expect(await screen.findByText(/Há leilão aberto/)).toBeInTheDocument()
  })

  it('catálogo que não carrega: mostra o erro em vez de travar', async () => {
    carregarCatalogoRecursos.mockRejectedValue(new Error('negado'))
    render(<ClubeConfig />)
    expect(await screen.findByText('negado')).toBeInTheDocument()
  })
})
