// Experiências (fase 6): a tela NÃO interpreta regra nenhuma — mostra o que o servidor devolveu e
// envia o que a pessoa preencheu. Quem decide conclusão e recompensa é o banco.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

let clube
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }))
const subirComprovacao = vi.fn()
vi.mock('../lib/upload.js', () => ({ subirComprovacao: (...a) => subirComprovacao(...a) }))
const carregarExperiencias = vi.fn()
const carregarExperiencia = vi.fn()
const participar = vi.fn()
const enviarEtapa = vi.fn()
vi.mock('../services/experiencias.js', async () => {
  const real = await vi.importActual('../services/experiencias.js')
  return {
    ...real,
    carregarExperiencias: (...a) => carregarExperiencias(...a),
    carregarExperiencia: (...a) => carregarExperiencia(...a),
    participar: (...a) => participar(...a),
    enviarEtapa: (...a) => enviarEtapa(...a),
  }
})
const { default: Experiencias } = await import('./Experiencias.jsx')

const LISTA = [{
  id: 'e1', titulo: 'Desafio da leitura', descricao: 'Leia e conte', tipo: 'desafio_individual',
  alvo: 'individual', status: 'publicada', etapas: 2, recompensa: { tipo: 'pontos', valor: 10 },
  minha_participacao: null, temporada: { id: 's1', titulo: 'Temporada piloto' },
}]
const DETALHE = {
  id: 'e1', titulo: 'Desafio da leitura', descricao: 'Leia e conte', tipo: 'desafio_individual',
  status: 'publicada', vigente: true, recompensa: { tipo: 'pontos', valor: 10 }, participacao: null,
  etapas: [
    { id: 'st1', ordem: 1, titulo: 'Li o capítulo', evidencia: 'confirmacao', pontos: 5, regra: {}, meu_envio: null },
    { id: 'st2', ordem: 2, titulo: 'O que achei', evidencia: 'texto', pontos: 5, regra: { min_caracteres: 20 }, meu_envio: null },
  ],
}
const renderT = () => render(<MemoryRouter><Experiencias /></MemoryRouter>)

beforeEach(() => {
  clube = { podeGerir: false }
  carregarExperiencias.mockReset().mockResolvedValue(LISTA)
  carregarExperiencia.mockReset().mockResolvedValue(DETALHE)
  participar.mockReset().mockResolvedValue({})
  subirComprovacao.mockReset().mockResolvedValue('u1/experiencias/foto.jpg')
  enviarEtapa.mockReset().mockResolvedValue({})
})

describe('Experiencias', () => {
  it('lista o que a liderança publicou, com tipo, recompensa e temporada', async () => {
    renderT()
    expect(await screen.findByText('Desafio da leitura')).toBeInTheDocument()
    expect(screen.getByText(/Desafio individual · 2 etapas/)).toBeInTheDocument()
    expect(screen.getByText(/10 pontos/)).toBeInTheDocument()
    expect(screen.getByText(/Temporada piloto/)).toBeInTheDocument()
  })

  it('membro comum não vê o botão de criar; a liderança vê', async () => {
    renderT()
    await screen.findByText('Desafio da leitura')
    expect(screen.queryByTestId('ir-construtor')).not.toBeInTheDocument()
    clube = { podeGerir: true }
    renderT()
    expect(await screen.findAllByTestId('ir-construtor')).toHaveLength(1)
  })

  it('a liderança pede os rascunhos; o membro, não', async () => {
    renderT()
    await screen.findByText('Desafio da leitura')
    expect(carregarExperiencias).toHaveBeenCalledWith(false)
    clube = { podeGerir: true }
    carregarExperiencias.mockClear()
    renderT()
    await screen.findAllByText('Desafio da leitura')
    expect(carregarExperiencias).toHaveBeenCalledWith(true)
  })

  it('abre o detalhe e permite participar', async () => {
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    expect(await screen.findByRole('button', { name: 'Participar' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    expect(participar).toHaveBeenCalledWith('e1')
  })

  it('só oferece o envio da etapa depois de participar', async () => {
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    await screen.findByText(/1\. Li o capítulo/)
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument()
    carregarExperiencia.mockResolvedValue({ ...DETALHE, participacao: { id: 'p1', status: 'em_andamento' } })
    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    expect(await screen.findAllByRole('button', { name: 'Enviar' })).toHaveLength(2)
  })

  it('envia a etapa de texto com o que a pessoa escreveu (o servidor é quem valida a regra)', async () => {
    carregarExperiencia.mockResolvedValue({ ...DETALHE, participacao: { id: 'p1', status: 'em_andamento' } })
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    const campo = await screen.findByLabelText('Resposta da etapa O que achei')
    await userEvent.type(campo, 'gostei muito da leitura')
    await userEvent.click(screen.getAllByRole('button', { name: 'Enviar' })[1])
    expect(enviarEtapa).toHaveBeenCalledWith('st2', { texto: 'gostei muito da leitura' })
  })

  it('erro do servidor (ex.: regra do vocabulário) aparece como veio', async () => {
    carregarExperiencia.mockResolvedValue({ ...DETALHE, participacao: { id: 'p1', status: 'em_andamento' } })
    enviarEtapa.mockRejectedValue(new Error('Escreva um pouco mais nesta etapa.'))
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    await userEvent.click((await screen.findAllByRole('button', { name: 'Enviar' }))[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(/Escreva um pouco mais/)
  })

  it('concluída: diz que a recompensa foi lançada UMA vez e some o botão de participar', async () => {
    carregarExperiencia.mockResolvedValue({ ...DETALHE, participacao: { id: 'p1', status: 'concluida' } })
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    expect(await screen.findByTestId('concluida')).toHaveTextContent(/uma única vez/)
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
  })

  it('etapa com validação da liderança fica "aguardando" e não conclui sozinha', async () => {
    carregarExperiencia.mockResolvedValue({
      ...DETALHE, participacao: { id: 'p1', status: 'em_andamento' },
      etapas: [{ id: 'st9', ordem: 1, titulo: 'Foto', evidencia: 'foto', exige_aprovacao: true, pontos: 50, regra: {}, meu_envio: { id: 'x', status: 'enviada' } }],
    })
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    expect(await screen.findByText('aguardando')).toBeInTheDocument()
    expect(screen.getByText(/a liderança valida/)).toBeInTheDocument()
  })

  it('etapa de foto usa o bucket PRIVADO de comprovações que já existe (nada de infra nova)', async () => {
    carregarExperiencia.mockResolvedValue({
      ...DETALHE, participacao: { id: 'p1', status: 'em_andamento' },
      etapas: [{ id: 'st9', ordem: 1, titulo: 'Foto do mutirão', evidencia: 'foto', exige_aprovacao: true, pontos: 50, regra: {}, meu_envio: null }],
    })
    renderT()
    await userEvent.click(await screen.findByText('Desafio da leitura'))
    const input = await screen.findByLabelText('Arquivo da etapa Foto do mutirão')
    await userEvent.upload(input, new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))
    expect(subirComprovacao).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'experiencias', userId: 'u1' }))
    expect(await screen.findByText(/Arquivo pronto para enviar/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(enviarEtapa).toHaveBeenCalledWith('st9', { arquivo_path: 'u1/experiencias/foto.jpg' })
  })

  it('sem experiência nenhuma, explica em vez de mostrar lista vazia', async () => {
    carregarExperiencias.mockResolvedValue([])
    renderT()
    expect(await screen.findByText('Nenhuma experiência por aqui')).toBeInTheDocument()
  })
})
