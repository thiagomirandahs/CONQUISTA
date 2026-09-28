// Nova publicação da Rede DBV: contador de 300, aviso fixo de localização removida, foto otimizada com o
// tamanho final, descrição da imagem, desafio vindo da URL, conquista exige categoria, recusa gentil da triagem.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { carregarDesafios: vi.fn(), prepararFoto: vi.fn(), publicarNaRede: vi.fn() }
vi.mock('../../services/rede.js', async () => {
  const real = await vi.importActual('../../services/rede.js')
  return { ...real, ...Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])) }
})
vi.mock('../../lib/imagens.js', () => ({ useImagem: (v) => v }))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../../ui/avisos.jsx', () => ({ avisar: avisos }))
vi.mock('../../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'eu', nome: 'Eu' } }) }))
vi.mock('../../context/Clube.jsx', () => ({ useClube: () => ({ clubeId: 'clube-a' }) }))

const { renderRede, STATUS } = await import('./_testeRede.jsx')
const { default: RedePublicar } = await import('./RedePublicar.jsx')

const DESAFIOS = { semana: { id: 'd1', titulo: 'Foto na natureza', pontos: 50, participei: false }, outros: [{ id: 'd2', titulo: 'Nó', pontos: 20, participei: true }] }

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  f.carregarDesafios.mockResolvedValue(DESAFIOS)
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:previa')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('Rede DBV — publicar', () => {
  it('contador de 300 e o aviso fixo de localização removida', async () => {
    const u = userEvent.setup()
    renderRede(<RedePublicar />)
    expect(screen.getByText('✅ Localização removida da foto automaticamente')).toBeInTheDocument()
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Oi rede')
    expect(screen.getByText('7/300')).toBeInTheDocument()
    expect(screen.getByLabelText('No que você está pensando?')).toHaveAttribute('maxLength', '300')
  })

  it('foto: mostra o tamanho otimizado, pede descrição e publica como "foto" com o alt', async () => {
    const u = userEvent.setup()
    const pronta = { arquivo: new File(['x'], 'foto.webp', { type: 'image/webp' }), antes: 3_565_158, depois: 112_640 }
    f.prepararFoto.mockResolvedValue(pronta)
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Foto enviada!' })
    renderRede(<RedePublicar />)
    await u.upload(screen.getByLabelText(/Adicionar foto/), new File(['y'], 'IMG.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByTestId('tamanho-foto')).toHaveTextContent('Foto otimizada: 3,4 MB → 110 KB')
    await u.type(screen.getByLabelText('Descrição da imagem (para quem não consegue ver)'), 'Barraca')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'foto', foto: pronta, alt: 'Barraca', clubeId: 'clube-a', userId: 'eu' }))
    expect(avisos.sucesso).toHaveBeenCalledWith('Foto enviada!')
  })

  it('sem foto vira publicação de texto ("livre")', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Publicado!' })
    renderRede(<RedePublicar />)
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Reunião ótima')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'livre', legenda: 'Reunião ótima', foto: null }))
  })

  it('desafio vindo da URL já vem escolhido; só lista os que ainda não participei', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Participação registrada!' })
    renderRede(<RedePublicar />, { rota: '/rede/publicar?desafio=d1' })
    expect(await screen.findByRole('option', { name: /Foto na natureza/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Nó/ })).toBeNull()
    expect(screen.getByLabelText('Qual desafio?')).toHaveValue('d1')
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Fiz!')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'desafio', desafioId: 'd1' }))
  })

  it('conquista: só publica com categoria e texto', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Publicado!' })
    renderRede(<RedePublicar />)
    await u.click(screen.getByRole('tab', { name: /Conquista/ }))
    await u.type(screen.getByLabelText(/Conte a conquista/), 'Concluí a classe Amigo')
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    await u.click(screen.getByRole('button', { name: /Classe/ }))
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'conquista', conquista: 'classe' }))
  })

  it('recusa da triagem: mensagem gentil, continua na tela', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockResolvedValue({ ok: false, mensagem: 'Por segurança, não é permitido passar telefone 🙂' })
    renderRede(<RedePublicar />)
    await u.type(screen.getByLabelText('No que você está pensando?'), 'me chama no zap')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Por segurança')
  })

  // Decisão do dono (29/09/2026): publica direto, mas SEMPRE com a confirmação antes.
  it('confirmação antes de publicar: "Voltar" não publica; texto da confirmação', async () => {
    const u = userEvent.setup()
    avisos.confirmar.mockImplementationOnce(async () => false)
    renderRede(<RedePublicar />)
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Oi rede')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: 'Tem certeza que quer publicar?', descricao: 'Fica visível para todos os clubes da Rede DBV.', rotulo: 'Publicar', cancelar: 'Voltar',
    }))
    expect(f.publicarNaRede).not.toHaveBeenCalled()
  })

  it('responsável não publica', () => {
    renderRede(<RedePublicar />, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    expect(screen.getByText(/Responsáveis acompanham/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull()
  })
})
