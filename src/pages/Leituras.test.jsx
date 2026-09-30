import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const carregar = vi.fn()
vi.mock('../services/leituras.js', () => ({ carregarLeituras: (...a) => carregar(...a), salvarProgressoLeitura: vi.fn().mockResolvedValue({}) }))
vi.mock('../services/audiolivros.js', () => ({ audiolivros: () => Promise.resolve([]) }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
const { default: Leituras } = await import('./Leituras.jsx')

const base = { autor: null, descricao: null, tipo: 'livro_classe', classe_manifesto: 'amigo', ano: null, capa_url: null, tem_audio: false,
  audiolivro_id: null, audio_url: null, book_url: null, book_rotulo: 'Ver livro', pdf_url: null, na_minha_classe: false, progresso: null }
const VASO = { ...base, id: 'a', chave: 'vaso', titulo: 'Vaso de Barro', autor: 'Fulano', descricao: 'Um livro sobre barro.', book_url: 'https://loja.exemplo/vaso', book_rotulo: 'Comprar', tem_audio: true, audiolivro_id: 'al1' }
const SEM_NADA = { ...base, id: 'b', chave: 'sem', titulo: 'Livro Sem Link', classe_manifesto: 'guia' }
const COM_PDF = { ...base, id: 'c', chave: 'pdf', titulo: 'Livro com PDF', pdf_url: 'https://fonte.exemplo/livro.pdf', capa_url: 'https://img.exemplo/capa.png' }
const FEITO = { ...base, id: 'd', chave: 'feito', titulo: 'Livro Terminado', book_url: 'https://x.exemplo/l', progresso: { capitulo: 6, posicao_seg: 10, duracao_seg: 10, concluido: true, ultima_em: '2026-09-01T00:00:00Z' } }
const COMECOU = { ...base, id: 'e', chave: 'comecou', titulo: 'Livro Começado', book_url: 'https://x.exemplo/m', progresso: { capitulo: 2, posicao_seg: 30, duracao_seg: 100, concluido: false, ultima_em: '2026-09-01T00:00:00Z' } }

beforeEach(() => { carregar.mockReset().mockResolvedValue([VASO, SEM_NADA, COM_PDF, FEITO, COMECOU]) })

describe('/leituras', () => {
  it('lista os materiais e chama a RPC do filtro escolhido, uma vez por filtro', async () => {
    render(<Leituras />)
    expect(await screen.findByText('Vaso de Barro')).toBeInTheDocument()
    expect(carregar).toHaveBeenCalledTimes(1)
    expect(carregar).toHaveBeenLastCalledWith('todos')
    await userEvent.click(screen.getByRole('button', { name: /Minha Classe/ }))
    expect(carregar).toHaveBeenLastCalledWith('minha_classe')
    await userEvent.click(screen.getByRole('button', { name: /Curso de Leitura/ }))
    expect(carregar).toHaveBeenLastCalledWith('curso')
    await userEvent.click(screen.getByRole('button', { name: /Com áudio/ }))
    expect(carregar).toHaveBeenLastCalledWith('com_audio')
    await userEvent.click(screen.getByRole('button', { name: /Concluídos/ }))
    expect(carregar).toHaveBeenLastCalledWith('concluidos')
    const chamadas = carregar.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: /Todos/ }))   // já carregado: não chama de novo
    expect(carregar).toHaveBeenCalledTimes(chamadas)
  })

  it('card sem capa usa placeholder; com capa usa a imagem', async () => {
    render(<Leituras />)
    await screen.findByText('Vaso de Barro')
    expect(screen.getAllByTestId('capa-placeholder').length).toBeGreaterThan(0)
    expect(screen.getByAltText('Capa de Livro com PDF')).toHaveAttribute('src', 'https://img.exemplo/capa.png')
  })

  it('"🎧 Audiobook disponível" só com tem_audio; selo Concluído; CONTINUAR só com progresso', async () => {
    render(<Leituras />)
    await screen.findByText('Vaso de Barro')
    expect(screen.getAllByText(/Audiobook disponível/)).toHaveLength(1)
    const feito = screen.getByRole('button', { name: /Livro Terminado/ })
    expect(within(feito).getByText('Concluído')).toBeInTheDocument()
    expect(within(feito).getByText('VER LIVRO')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Livro Começado/ })).getByText('CONTINUAR')).toBeInTheDocument()
    expect(screen.getAllByText('CONTINUAR')).toHaveLength(1)
  })

  it('sem nenhum link mostra "A versão digital não está disponível."', async () => {
    render(<Leituras />)
    await userEvent.click(await screen.findByRole('button', { name: /Livro Sem Link/ }))
    expect(await screen.findByText('A versão digital não está disponível.')).toBeInTheDocument()
    expect(screen.queryByText('Abrir PDF')).toBeNull()
  })

  it('detalhe: link do livro com rótulo do servidor em nova aba; PDF só quando vem; áudio só com tem_audio', async () => {
    render(<Leituras />)
    await userEvent.click(await screen.findByRole('button', { name: /Vaso de Barro/ }))
    const comprar = await screen.findByRole('link', { name: /Comprar/ })
    expect(comprar).toHaveAttribute('href', 'https://loja.exemplo/vaso')
    expect(comprar).toHaveAttribute('target', '_blank')
    expect(comprar).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Um livro sobre barro.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ouvir audiobook/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Abrir PDF/ })).toBeNull()
    expect(screen.queryByText('A versão digital não está disponível.')).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: 'Fechar', hidden: true }).pop())
    await userEvent.click(await screen.findByRole('button', { name: /Livro com PDF/ }))
    const pdf = await screen.findByRole('link', { name: /Abrir PDF/ })
    expect(pdf).toHaveAttribute('href', 'https://fonte.exemplo/livro.pdf')
    expect(screen.queryByRole('button', { name: /Ouvir audiobook/ })).toBeNull()
  })

  it('erro mostra mensagem e "Tentar de novo"; vazio mostra aviso', async () => {
    carregar.mockRejectedValueOnce(new Error('falhou'))
    render(<Leituras />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    carregar.mockResolvedValueOnce([])
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Nada por aqui ainda')).toBeInTheDocument()
  })
})
