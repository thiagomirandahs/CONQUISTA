// Aviso institucional (migration 536): cartão só aparece para quem PODE; confirmação diz quantos clubes; envia com os argumentos certos;
// a coordenação nunca escolhe "todos os membros" (só a plataforma); limite do dia e erro do servidor viram aviso, sem travar o botão.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const f = { alcance: vi.fn(), enviar: vi.fn() }
vi.mock('../services/avisoInstitucional.js', () => ({
  alcanceAvisoInstitucional: (...a) => f.alcance(...a), enviarAvisoInstitucional: (...a) => f.enviar(...a),
}))
const avisos = { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: vi.fn(async () => true) }
vi.mock('../ui/avisos.jsx', () => ({ avisar: avisos }))

const { default: AvisoInstitucional } = await import('./AvisoInstitucional.jsx')

beforeEach(() => {
  for (const fn of [...Object.values(f), ...Object.values(avisos)]) fn.mockReset()
  avisos.confirmar.mockImplementation(async () => true)
})

describe('AvisoInstitucional', () => {
  it('quem não pode (sem escopo de coordenação) não vê o cartão', async () => {
    f.alcance.mockResolvedValue({ pode: false, clubes: 0 })
    const { container } = render(<AvisoInstitucional />)
    await waitFor(() => expect(f.alcance).toHaveBeenCalledWith(false))
    expect(container).toBeEmptyDOMElement()
  })

  it('erro ao consultar o alcance: some, sem quebrar a tela', async () => {
    f.alcance.mockRejectedValue(new Error('rede'))
    const { container } = render(<AvisoInstitucional />)
    await waitFor(() => expect(f.alcance).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('coordenação: mostra a área, não oferece "todos os membros", confirma com o número de clubes e envia só para a liderança', async () => {
    const u = userEvent.setup()
    f.alcance.mockResolvedValue({ pode: true, clubes: 3, origem: 'Distrito Norte', plataforma: false })
    f.enviar.mockResolvedValue({ ok: true, clubes: 3, falhas: 0, mensagem: 'Aviso enviado para 3 clubes.' })
    render(<AvisoInstitucional />)
    expect(await screen.findByText(/Chega só para a liderança de 3 clubes da sua área \(Distrito Norte\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Todos os membros/ })).not.toBeInTheDocument()
    const enviar = screen.getByRole('button', { name: 'Enviar aviso' })
    expect(enviar).toBeDisabled()
    await u.type(screen.getByLabelText('Título'), 'Reunião do distrito')
    await u.type(screen.getByLabelText('Mensagem (opcional)'), 'Sábado às 15h')
    await u.click(enviar)
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Enviar para a liderança de 3 clubes?', rotulo: 'Enviar aviso', cancelar: 'Voltar' }))
    expect(f.enviar).toHaveBeenCalledTimes(1)
    expect(f.enviar).toHaveBeenCalledWith({ titulo: 'Reunião do distrito', corpo: 'Sábado às 15h', destino: 'lideranca', plataforma: false })
    expect(avisos.sucesso).toHaveBeenCalledWith('Aviso enviado para 3 clubes.')
    expect(screen.getByLabelText('Título')).toHaveValue('')
  })

  it('"Voltar" na confirmação NÃO envia e não perde o texto', async () => {
    const u = userEvent.setup()
    f.alcance.mockResolvedValue({ pode: true, clubes: 1, origem: 'Distrito', plataforma: false })
    avisos.confirmar.mockImplementation(async () => false)
    render(<AvisoInstitucional />)
    await u.type(await screen.findByLabelText('Título'), 'Aviso qualquer')
    await u.click(screen.getByRole('button', { name: 'Enviar aviso' }))
    expect(f.enviar).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Título')).toHaveValue('Aviso qualquer')
  })

  it('plataforma: oferece liderança ou todos os membros e envia com plataforma:true e o destino escolhido', async () => {
    const u = userEvent.setup()
    f.alcance.mockResolvedValue({ pode: true, clubes: 4, origem: 'DesbravaClube', plataforma: true })
    f.enviar.mockResolvedValue({ ok: true, clubes: 4, falhas: 0, mensagem: 'Aviso enviado para 4 clubes.' })
    render(<AvisoInstitucional plataforma />)
    expect(await screen.findByText('Chega em 4 clubes ativos.')).toBeInTheDocument()
    expect(f.alcance).toHaveBeenCalledWith(true)
    await u.click(screen.getByRole('button', { name: /Todos os membros/ }))
    await u.type(screen.getByLabelText('Título'), 'Manutenção geral')
    await u.click(screen.getByRole('button', { name: 'Enviar aviso' }))
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Enviar para todos os membros de 4 clubes?' }))
    expect(f.enviar).toHaveBeenCalledWith({ titulo: 'Manutenção geral', corpo: '', destino: 'todos', plataforma: true })
  })

  it('limite do dia (ok:false): mostra a mensagem do servidor e o botão continua utilizável', async () => {
    const u = userEvent.setup()
    f.alcance.mockResolvedValue({ pode: true, clubes: 2, origem: 'D', plataforma: false })
    f.enviar.mockResolvedValue({ ok: false, motivo: 'limite', mensagem: 'Você já enviou 5 avisos nas últimas 24 horas.' })
    render(<AvisoInstitucional />)
    await u.type(await screen.findByLabelText('Título'), 'Mais um aviso')
    await u.click(screen.getByRole('button', { name: 'Enviar aviso' }))
    await waitFor(() => expect(avisos.info).toHaveBeenCalledWith('Você já enviou 5 avisos nas últimas 24 horas.'))
    expect(avisos.sucesso).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enviar aviso' })).toBeEnabled()
    expect(screen.getByLabelText('Título')).toHaveValue('Mais um aviso')
  })

  it('erro do servidor: avisa e não trava', async () => {
    const u = userEvent.setup()
    f.alcance.mockResolvedValue({ pode: true, clubes: 2, origem: 'D', plataforma: false })
    f.enviar.mockRejectedValue(new Error('Sem permissão'))
    render(<AvisoInstitucional />)
    await u.type(await screen.findByLabelText('Título'), 'Aviso de teste')
    await u.click(screen.getByRole('button', { name: 'Enviar aviso' }))
    await waitFor(() => expect(avisos.erro).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Enviar aviso' })).toBeEnabled()
  })

  it('duplo clique em "Enviar aviso" envia uma vez só', async () => {
    const u = userEvent.setup()
    f.alcance.mockResolvedValue({ pode: true, clubes: 2, origem: 'D', plataforma: false })
    f.enviar.mockResolvedValue({ ok: true, clubes: 2, falhas: 0, mensagem: 'ok' })
    render(<AvisoInstitucional />)
    await u.type(await screen.findByLabelText('Título'), 'Aviso duplo')
    await u.dblClick(screen.getByRole('button', { name: 'Enviar aviso' }))
    await waitFor(() => expect(f.enviar).toHaveBeenCalled())
    expect(f.enviar).toHaveBeenCalledTimes(1)
  })
})
