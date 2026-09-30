// Nova publicação da Rede DBV: contador de 300, aviso fixo de localização removida, foto otimizada com o
// tamanho final, descrição da imagem, desafio vindo da URL, conquista exige categoria, recusa gentil da triagem.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { carregarDesafios: vi.fn(), prepararFoto: vi.fn(), publicarNaRede: vi.fn(), publicarConquista: vi.fn() }
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
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'foto', alcance: 'clube', foto: pronta, alt: 'Barraca', clubeId: 'clube-a', userId: 'eu' }))
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
      titulo: 'Tem certeza que quer publicar?', descricao: 'Fica visível só para o seu clube.', rotulo: 'Publicar', cancelar: 'Voltar',
    }))
    expect(f.publicarNaRede).not.toHaveBeenCalled()
  })

  it('responsável não publica', () => {
    renderRede(<RedePublicar />, { status: { ...STATUS, papel: 'pais', pode_publicar: false } })
    expect(screen.getByText(/Responsáveis acompanham/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull()
  })

  // ---- 515: alcance, tipos novos, conquista pelo servidor ----
  const LIDER = { ...STATUS, papel: 'instrutor' }
  const DIRETORIA = { ...STATUS, papel: 'diretoria' }
  const ID1 = '11111111-1111-1111-1111-111111111111'
  const ID2 = '22222222-2222-2222-2222-222222222222'

  it('desbravador: sem seletor de alcance nem "Compartilhar conquista"; publica sempre em "clube"', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Publicado!' })
    renderRede(<RedePublicar />)
    expect(screen.queryByRole('radiogroup', { name: 'Alcance da publicação' })).toBeNull()
    expect(screen.queryByText(/Comunidade \(todos os clubes\)/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Compartilhar conquista/ })).toBeNull()
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Oi')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ alcance: 'clube' }))
  })

  it.each([['conselheiro'], ['tesoureiro'], ['pais']])('%s também não vê o alcance Comunidade', (papel) => {
    renderRede(<RedePublicar />, { status: { ...STATUS, papel } })
    expect(screen.queryByRole('radio', { name: /Comunidade/ })).toBeNull()
  })

  it('coordenação não vê alcance Comunidade (publica só na área)', () => {
    renderRede(<RedePublicar />, { status: { ...DIRETORIA, coordenacao: true } })
    expect(screen.queryByRole('radio', { name: /Comunidade/ })).toBeNull()
  })

  it.each([['instrutor', LIDER], ['diretoria', DIRETORIA]])('%s vê o seletor, "Só meu clube" é o padrão', (_n, st) => {
    renderRede(<RedePublicar />, { status: st })
    expect(screen.getByRole('radio', { name: 'Só meu clube' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Comunidade (todos os clubes)' })).toHaveAttribute('aria-checked', 'false')
  })

  it('tipos: Atividade, Evento, Aviso e Foto do clube existem, além dos antigos (clube)', () => {
    renderRede(<RedePublicar />)
    for (const n of ['Foto', 'Desafio', 'Atividade', 'Evento', 'Aviso', 'Foto do clube']) {
      expect(screen.getByRole('tab', { name: n })).toBeInTheDocument()
    }
  })

  it('Comunidade: pede confirmação explícita, só tipos novos, e envia alcance "comunidade"', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Publicado!' })
    renderRede(<RedePublicar />, { status: LIDER })
    await u.click(screen.getByRole('radio', { name: 'Comunidade (todos os clubes)' }))
    expect(screen.getByRole('note')).toHaveTextContent('todos os clubes da Rede DBV')
    expect(screen.queryByRole('tab', { name: 'Desafio' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Foto' })).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Evento' }))
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Acampamento sábado')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: 'Publicar na Comunidade?', descricao: expect.stringContaining('Todos os clubes da Rede DBV'), cancelar: 'Voltar',
    }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'evento', alcance: 'comunidade' }))
  })

  it('Comunidade: "Voltar" na confirmação não publica', async () => {
    const u = userEvent.setup()
    avisos.confirmar.mockImplementationOnce(async () => false)
    renderRede(<RedePublicar />, { status: DIRETORIA })
    await u.click(screen.getByRole('radio', { name: 'Comunidade (todos os clubes)' }))
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Aviso geral')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).not.toHaveBeenCalled()
  })

  it('escolher Comunidade com tipo antigo selecionado troca para Atividade', async () => {
    const u = userEvent.setup()
    renderRede(<RedePublicar />, { status: LIDER, rota: '/rede/publicar?desafio=d1' })
    await u.click(screen.getByRole('radio', { name: 'Comunidade (todos os clubes)' }))
    expect(screen.getByRole('tab', { name: 'Atividade' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('Qual desafio?')).toBeNull()
  })

  it('Foto do clube: exige foto E descrição (alt)', async () => {
    const u = userEvent.setup()
    const pronta = { arquivo: new File(['x'], 'foto.webp', { type: 'image/webp' }), antes: 2000, depois: 1000 }
    f.prepararFoto.mockResolvedValue(pronta)
    f.publicarNaRede.mockResolvedValue({ ok: true, mensagem: 'Enviada!' })
    renderRede(<RedePublicar />)
    await u.click(screen.getByRole('tab', { name: 'Foto do clube' }))
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    await u.upload(screen.getByLabelText(/Adicionar foto/), new File(['y'], 'IMG.jpg', { type: 'image/jpeg' }))
    await screen.findByTestId('tamanho-foto')
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    await u.type(screen.getByLabelText(/Descrição da imagem/), 'Clube reunido')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarNaRede).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'foto_clube', alt: 'Clube reunido', alcance: 'clube' }))
  })

  it('erro do servidor (desbravador tentando Comunidade) aparece em português, sem erro técnico', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockRejectedValue(new Error('Só a diretoria e os instrutores do clube publicam na Comunidade. Você pode publicar no Meu Clube 🙂'))
    renderRede(<RedePublicar />)
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Oi')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Só a diretoria e os instrutores do clube publicam na Comunidade')
  })

  it('erro "Alcance inválido." do servidor também é mostrado como veio', async () => {
    const u = userEvent.setup()
    f.publicarNaRede.mockRejectedValue(new Error('Alcance inválido.'))
    renderRede(<RedePublicar />)
    await u.type(screen.getByLabelText('No que você está pensando?'), 'Oi')
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Alcance inválido.')
  })

  it('conquista não é texto livre: sem caixa de texto nem foto; usa rede_publicar_conquista com a origem real', async () => {
    const u = userEvent.setup()
    f.publicarConquista.mockResolvedValue({ ok: true, mensagem: 'Conquista publicada! 🎉' })
    renderRede(<RedePublicar />, { status: LIDER, rota: `/rede/publicar?origem_tipo=classe&origem_id=${ID1}` })
    expect(screen.getByTestId('conquista-origem')).toBeInTheDocument()
    expect(screen.queryByLabelText('No que você está pensando?')).toBeNull()
    expect(screen.queryByLabelText(/Adicionar foto/)).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(f.publicarConquista).toHaveBeenCalledWith({ origemTipo: 'classe', origemId: ID1, alcance: 'clube' })
    expect(f.publicarNaRede).not.toHaveBeenCalled()
    expect(avisos.sucesso).toHaveBeenCalledWith('Conquista publicada! 🎉')
  })

  it('conquista na Comunidade manda alcance "comunidade" (com confirmação)', async () => {
    const u = userEvent.setup()
    f.publicarConquista.mockResolvedValue({ ok: true, mensagem: 'Conquista publicada! 🎉' })
    renderRede(<RedePublicar />, { status: DIRETORIA, rota: `/rede/publicar?origem_tipo=especialidade&origem_id=${ID2}` })
    await u.click(screen.getByRole('radio', { name: 'Comunidade (todos os clubes)' }))
    await u.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Publicar na Comunidade?' }))
    expect(f.publicarConquista).toHaveBeenCalledWith(expect.objectContaining({ origemTipo: 'especialidade', alcance: 'comunidade' }))
  })

  it('conquista sem origem real: explica e não deixa publicar', async () => {
    const u = userEvent.setup()
    renderRede(<RedePublicar />, { status: LIDER })
    await u.click(screen.getByRole('button', { name: /Compartilhar conquista/ }))
    expect(screen.getByTestId('conquista-origem')).toHaveTextContent(/não é texto livre/)
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('desbravador com ?origem_... na URL não publica conquista (só liderança)', () => {
    renderRede(<RedePublicar />, { rota: `/rede/publicar?origem_tipo=classe&origem_id=${ID1}` })
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })
})
