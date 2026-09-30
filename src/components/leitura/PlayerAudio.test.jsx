import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const salvar = vi.fn()
vi.mock('../../services/leituras.js', () => ({ salvarProgressoLeitura: (...a) => salvar(...a) }))
const LIVRO = {
  id: 'al1', titulo: 'Vaso de Barro', autor: 'X', canal: 'Canal Y',
  capitulos: [1, 2, 3].map((n) => ({ ordem: n, titulo: `Capítulo ${n}`, video_id: `video${String(n).padStart(6, '0')}` })),
}
vi.mock('../../services/audiolivros.js', () => ({ audiolivros: () => Promise.resolve([LIVRO]) }))
const { default: PlayerAudio } = await import('./PlayerAudio.jsx')
const ORIGEM = 'https://www.youtube-nocookie.com'

const MAT = { id: 'm1', titulo: 'Vaso de Barro', audiolivro_id: 'al1', audio_url: null, progresso: null }
const espiados = new WeakSet()
const spies = []
function iframe() {
  const el = document.querySelector('iframe')
  if (el && !espiados.has(el)) { espiados.add(el); const s = vi.spyOn(el.contentWindow, 'postMessage'); spies.push(s) }
  return el
}
const comandos = (el) => el.contentWindow.postMessage.mock.calls.map((c) => JSON.parse(c[0])).filter((c) => c.event === 'command')
function info(dados, { origin = ORIGEM, fonte } = {}) {
  const el = document.querySelector('iframe')
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin, source: fonte || el.contentWindow, data: JSON.stringify({ event: 'infoDelivery', info: dados }) }))
  })
}
const iniciar = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Ouvir' })); await waitFor(() => expect(iframe()).toBeTruthy()) }

beforeEach(() => { salvar.mockReset().mockResolvedValue({ ok: true }); localStorage.clear(); spies.length = 0 })

describe('PlayerAudio (YouTube por postMessage)', () => {
  it('só monta o iframe depois do toque em Ouvir; play/pausa enviam comando', async () => {
    render(<PlayerAudio material={MAT} userId="u1" />)
    await screen.findByText(/Capítulo 1/)
    expect(document.querySelector('iframe')).toBeNull()
    await iniciar()
    const el = iframe()
    expect(el.src).toContain('youtube-nocookie.com/embed/video000001')
    expect(el.src).toContain('enablejsapi=1')
    info({ currentTime: 3, duration: 2400, playerState: 1 })
    const pausar = await screen.findByRole('button', { name: 'Pausar' })
    await userEvent.click(pausar)
    expect(comandos(el).map((c) => c.func)).toContain('pauseVideo')
    await userEvent.click(await screen.findByRole('button', { name: 'Ouvir' }))
    expect(comandos(el).map((c) => c.func)).toContain('playVideo')
  })

  it('voltar/avançar 15 s e barra com aria-valuetext', async () => {
    render(<PlayerAudio material={MAT} userId="u1" />)
    await iniciar()
    const el = iframe()
    info({ currentTime: 80, duration: 2400, playerState: 1 })
    const barra = await screen.findByRole('slider', { name: /Posição/ })
    expect(barra).toHaveAttribute('aria-valuetext', '1 minuto e 20 de 40 minutos')
    await userEvent.click(screen.getByRole('button', { name: 'Avançar 15 segundos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Voltar 15 segundos' }))
    const seeks = comandos(el).filter((c) => c.func === 'seekTo')
    expect(seeks[0].args).toEqual([95, true])
    expect(seeks[1].args).toEqual([80, true])
    fireEvent.change(barra, { target: { value: '600' } })
    expect(comandos(el).filter((c) => c.func === 'seekTo').pop().args).toEqual([600, true])
  })

  it('velocidade envia setPlaybackRate', async () => {
    render(<PlayerAudio material={MAT} userId="u1" />)
    await iniciar()
    await userEvent.click(screen.getByRole('button', { name: '1,5×' }))
    expect(comandos(iframe()).find((c) => c.func === 'setPlaybackRate').args).toEqual([1.5])
    expect(screen.getByRole('button', { name: '1,5×' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('CONTINUAR OUVINDO retoma no capítulo e na posição salvos (seekTo depois do ready)', async () => {
    const progresso = { capitulo: 2, posicao_seg: 1122, duracao_seg: 2000, concluido: false, ultima_em: '2026-09-29T10:00:00Z' }
    render(<PlayerAudio material={{ ...MAT, progresso }} userId="u1" />)
    expect(await screen.findByText(/Você parou em: Capítulo 2 · 18:42/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'CONTINUAR OUVINDO' }))
    await waitFor(() => expect(iframe()).toBeTruthy())
    expect(iframe().src).toContain('video000002')
    expect(comandos(iframe()).some((c) => c.func === 'seekTo')).toBe(false)
    info({ currentTime: 0, duration: 2000, playerState: 3 })
    expect(comandos(iframe()).find((c) => c.func === 'seekTo').args).toEqual([1122, true])
  })

  it('usa a cópia local quando é mais recente que a do servidor', async () => {
    localStorage.setItem('leitura:u1:m1', JSON.stringify({ capitulo: 3, posicao_seg: 61, concluido: false, ouvidos: [1, 2], em: Date.now() }))
    const progresso = { capitulo: 1, posicao_seg: 10, concluido: false, ultima_em: '2020-01-01T00:00:00Z' }
    render(<PlayerAudio material={{ ...MAT, progresso }} userId="u1" />)
    expect(await screen.findByText(/Você parou em: Capítulo 3 · 1:01/)).toBeInTheDocument()
  })

  it('capítulo termina: vai ao próximo, marca ✓ e salva o progresso', async () => {
    render(<PlayerAudio material={MAT} userId="u1" />)
    await iniciar()
    info({ currentTime: 5, duration: 100, playerState: 1 })
    info({ currentTime: 100, duration: 100, playerState: 0 })
    await waitFor(() => expect(iframe().src).toContain('video000002'))
    expect(screen.getByRole('button', { name: 'Capítulo 1, ouvido' })).toBeInTheDocument()
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ materialId: 'm1', capitulo: 2, concluido: false })))
    expect(JSON.parse(localStorage.getItem('leitura:u1:m1')).capitulo).toBe(2)
  })

  it('o último capítulo terminando marca concluido:true', async () => {
    render(<PlayerAudio material={MAT} userId="u1" />)
    await screen.findByText(/Capítulo 1/)
    await userEvent.click(screen.getByRole('button', { name: /^Capítulo 3/ }))
    await waitFor(() => expect(iframe().src).toContain('video000003'))
    info({ currentTime: 50, duration: 50, playerState: 0 })
    await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ materialId: 'm1', capitulo: 3, concluido: true })))
  })

  it('mensagem de origem errada ou de outra janela é ignorada', async () => {
    render(<PlayerAudio material={MAT} userId="u1" />)
    await iniciar()
    info({ currentTime: 9, duration: 50, playerState: 0 }, { origin: 'https://evil.example' })
    info({ currentTime: 9, duration: 50, playerState: 0 }, { fonte: window })
    expect(iframe().src).toContain('video000001')
    expect(screen.getByRole('slider', { name: /Posição/ })).toBeDisabled()
    expect(salvar).not.toHaveBeenCalledWith(expect.objectContaining({ concluido: true }))
  })

  it('falha de rede ao salvar não quebra o player', async () => {
    salvar.mockRejectedValue(new Error('Failed to fetch'))
    render(<PlayerAudio material={MAT} userId="u1" />)
    await iniciar()
    info({ currentTime: 5, duration: 100, playerState: 1 })
    info({ currentTime: 6, duration: 100, playerState: 2 })
    await waitFor(() => expect(salvar).toHaveBeenCalled())
    expect(screen.getByTestId('player-audio')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('leitura:u1:m1')).posicao_seg).toBe(6)
  })
})

describe('PlayerAudio (<audio> direto)', () => {
  it('sem audiolivro e com audio_url usa o elemento audio', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
    window.HTMLMediaElement.prototype.pause = vi.fn()
    render(<PlayerAudio material={{ id: 'm2', titulo: 'Curso', audiolivro_id: null, audio_url: 'https://exemplo.org/a.mp3', progresso: null }} userId="u1" />)
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByTestId('audio-nativo')).toHaveAttribute('src', 'https://exemplo.org/a.mp3')
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir' }))
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled())
  })
  it('se o áudio não tocar mostra a mensagem simples', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('bloqueado'))
    render(<PlayerAudio material={{ id: 'm2', titulo: 'Curso', audiolivro_id: null, audio_url: 'https://exemplo.org/a.mp3', progresso: null }} userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Ouvir' }))
    expect(await screen.findByText('Não foi possível tocar este áudio aqui.')).toBeInTheDocument()
  })
})
