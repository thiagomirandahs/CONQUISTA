// REGRESSÃO (02/10/2026): "Publicar para todos os clubes" não respondia ao clique real. Aqui o provedor de avisos/confirmação é o REAL
// (os outros testes mockam `avisar`, por isso o defeito passava): a confirmação abre de verdade e o usuário clica no botão VISÍVEL
// dela, com user-event (clique de verdade, sem element.click()/dispatchEvent). jsdom não faz teste de sobreposição, então a
// camada (z-index) de cada diálogo é lida do próprio DOM renderizado e comparada: a confirmação TEM de ficar acima do overlay do story.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { urlDaFoto: vi.fn(), marcarStoryVisto: vi.fn(), apagarStory: vi.fn(), denunciar: vi.fn(), prepararFotoStory: vi.fn(), publicarStory: vi.fn() }
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Eu Mesmo' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a' }) }))

const { AvisosProvider } = await import('../../ui/avisos.jsx')
const { NovoStory, ViewerStories } = await import('./Stories.jsx')

const pronta = { arquivo: new File(['x'], 'foto.webp', { type: 'image/webp' }), antes: 4_000_000, depois: 140_000 }
const arquivo = () => new File(['y'], 'IMG.jpg', { type: 'image/jpeg' })

// camada do diálogo = z-index do ancestral `fixed` mais próximo (Tailwind: z-50 / z-[70]); sem CSS no jsdom, lê a classe
const camada = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const c = n.getAttribute('class') || ''
    if (/\bfixed\b/.test(c)) { const m = c.match(/\bz-\[(\d+)\]/) || c.match(/\bz-(\d+)\b/); return m ? Number(m[1]) : 0 }
  }
  return 0
}

function cena(props = {}) {
  const aoFechar = vi.fn(); const aoPublicado = vi.fn()
  render(<AvisosProvider><NovoStory arquivo={arquivo()} clubeId="clube-a" userId="eu" alcance="comunidade" aoFechar={aoFechar} aoPublicado={aoPublicado} {...props} /></AvisosProvider>)
  return { aoFechar, aoPublicado }
}
const abrirConfirmacao = async (u) => {
  await screen.findByTestId('tamanho-story')
  await u.click(screen.getByRole('button', { name: 'Publicar' }))
  return screen.findByRole('dialog', { name: 'Publicar este story na Comunidade?' })
}
const botaoConfirmar = (dlg) => within(dlg).getByRole('button', { name: 'Publicar para todos os clubes' })

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.prepararFotoStory.mockResolvedValue(pronta)
  f.urlDaFoto.mockImplementation(async (p) => `blob:${p}`)
  f.marcarStoryVisto.mockResolvedValue({ ok: true })
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:previa')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('Stories — confirmação REAL "Publicar para todos os clubes"', () => {
  it('a confirmação abre ACIMA da tela de novo story (antes: z-50 atrás de z-70, clique real caía no overlay)', async () => {
    const u = userEvent.setup()
    cena()
    const confirmacao = await abrirConfirmacao(u)
    const criador = screen.getByRole('dialog', { name: 'Novo story na Comunidade' })
    expect(camada(confirmacao)).toBeGreaterThan(camada(criador))
  })

  it('clique no botão visível publica EXATAMENTE uma vez, com alcance comunidade, e ao terminar fecha e avisa', async () => {
    const u = userEvent.setup()
    const { aoPublicado } = cena()
    f.publicarStory.mockResolvedValue({ ok: true, status: 'publicado', mensagem: 'Story publicado para todos os clubes da Rede! Fica no ar por 24 h ✨' })
    const dlg = await abrirConfirmacao(u)
    expect(within(dlg).getByText('Todos os clubes da Rede vão ver por 24 horas.')).toBeInTheDocument()
    await u.click(botaoConfirmar(dlg))
    await waitFor(() => expect(aoPublicado).toHaveBeenCalledTimes(1))
    expect(f.publicarStory).toHaveBeenCalledTimes(1)
    expect(f.publicarStory).toHaveBeenCalledWith({ foto: pronta, texto: '', clubeId: 'clube-a', userId: 'eu', alcance: 'comunidade' })
    expect(await screen.findByText(/Story publicado para todos os clubes da Rede/)).toBeInTheDocument()   // o aviso (toast) aparece
  })

  it('durante o envio o botão mostra "Publicando…" e fica desabilitado; no fim volta ao normal', async () => {
    const u = userEvent.setup()
    let fim
    f.publicarStory.mockImplementation(() => new Promise((res) => { fim = res }))
    cena()
    await u.click(await botaoConfirmar(await abrirConfirmacao(u)))
    const enviando = await screen.findByRole('button', { name: 'Publicando…' })
    expect(enviando).toBeDisabled()
    fim({ ok: true, status: 'publicado', mensagem: 'ok' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Publicando…' })).not.toBeInTheDocument())
  })

  it('recusa do servidor (ok:false): mostra a mensagem, NÃO fica bloqueado e dá para tentar de novo', async () => {
    const u = userEvent.setup()
    const { aoPublicado } = cena()
    f.publicarStory.mockResolvedValueOnce({ ok: false, mensagem: 'Calma! Espere um minutinho antes de publicar de novo 🙂' })
    await u.click(botaoConfirmar(await abrirConfirmacao(u)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Calma! Espere um minutinho')
    expect(aoPublicado).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeEnabled()
    f.publicarStory.mockResolvedValueOnce({ ok: true, status: 'publicado', mensagem: 'Publicado!' })
    await u.click(botaoConfirmar(await abrirConfirmacao(u)))
    await waitFor(() => expect(aoPublicado).toHaveBeenCalledTimes(1))
    expect(f.publicarStory).toHaveBeenCalledTimes(2)
  })

  it('falha de rede (promessa rejeitada): mostra erro amigável e o botão volta a funcionar', async () => {
    const u = userEvent.setup()
    cena()
    f.publicarStory.mockRejectedValueOnce(new Error('Failed to fetch'))
    await u.click(botaoConfirmar(await abrirConfirmacao(u)))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeEnabled()
  })

  it('"Voltar" na confirmação NÃO publica e devolve a tela de novo story', async () => {
    const u = userEvent.setup()
    cena()
    const dlg = await abrirConfirmacao(u)
    await u.click(within(dlg).getByRole('button', { name: 'Voltar' }))
    expect(f.publicarStory).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Novo story na Comunidade' })).toBeInTheDocument()
  })

  it('duplo clique no "Publicar" do criador e no botão da confirmação publica UMA vez só', async () => {
    const u = userEvent.setup()
    f.publicarStory.mockResolvedValue({ ok: true, status: 'publicado', mensagem: 'ok' })
    cena()
    await screen.findByTestId('tamanho-story')
    await u.dblClick(screen.getByRole('button', { name: 'Publicar' }))
    const dlg = await screen.findByRole('dialog', { name: 'Publicar este story na Comunidade?' })
    await u.dblClick(botaoConfirmar(dlg))
    await waitFor(() => expect(f.publicarStory).toHaveBeenCalled())
    expect(f.publicarStory).toHaveBeenCalledTimes(1)
  })

  it('toque (pointer) no botão da confirmação também publica uma vez', async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 })
    f.publicarStory.mockResolvedValue({ ok: true, status: 'publicado', mensagem: 'ok' })
    cena()
    const dlg = await abrirConfirmacao(u)
    await u.pointer([{ keys: '[TouchA>]', target: botaoConfirmar(dlg) }, { keys: '[/TouchA]' }])
    await waitFor(() => expect(f.publicarStory).toHaveBeenCalledTimes(1))
  })
})

describe('Stories — a mesma regra vale no visualizador (apagar o próprio story abre confirmação)', () => {
  const grupos = [{ meu: true, todos_vistos: true, autor: { id: 'eu', nome: 'Eu Mesmo', clube: 'Clube A' }, stories: [
    { id: 's1', foto: 'a/eu/1.webp', texto: '', criado_em: new Date().toISOString(), visto: true, alcance: 'comunidade', status: 'publicado' }] }]

  it('a confirmação "Apagar este story?" fica acima do visualizador e o clique no botão apaga uma vez', async () => {
    const u = userEvent.setup()
    f.apagarStory.mockResolvedValue({ ok: true })
    render(<AvisosProvider><ViewerStories grupos={grupos} inicio={0} aoFechar={vi.fn()} aoMudar={vi.fn()} /></AvisosProvider>)
    await u.click(await screen.findByRole('button', { name: 'Apagar story' }))
    const dlg = await screen.findByRole('dialog', { name: 'Apagar este story?' })
    expect(camada(dlg)).toBeGreaterThan(camada(screen.getByTestId('viewer-story')))
    await u.click(within(dlg).getByRole('button', { name: 'Apagar' }))
    await waitFor(() => expect(f.apagarStory).toHaveBeenCalledTimes(1))
    expect(f.apagarStory).toHaveBeenCalledWith('s1')
  })
})
