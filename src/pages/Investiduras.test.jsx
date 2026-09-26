// Tela da liderança (fase 4): revisar a conclusão, pedir correção de requisitos específicos e registrar a
// investidura. A tela só apresenta o que o servidor manda (estado, snapshot, bloqueios, requisitos) e
// nunca deixa registrar investidura com bloqueio — o servidor recusa de qualquer jeito.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let clube
vi.mock('../context/Clube.jsx', () => ({ useClube: () => clube }))
const carregarRevisoesPendentes = vi.fn()
const solicitarRevisaoFinal = vi.fn()
const decidirRevisaoFinal = vi.fn()
const registrarInvestidura = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarRevisoesPendentes: (...a) => carregarRevisoesPendentes(...a),
  solicitarRevisaoFinal: (...a) => solicitarRevisaoFinal(...a),
  decidirRevisaoFinal: (...a) => decidirRevisaoFinal(...a),
  registrarInvestidura: (...a) => registrarInvestidura(...a),
  emitirDocumento: vi.fn().mockResolvedValue({ token: 'TESTTOKEN' }),
}))
const { default: Investiduras } = await import('./Investiduras.jsx')

const base = (over) => ({
  member_class_id: 'mc1', status: 'aguardando_revisao', concluida_em: '2026-09-20', iniciada_em: '2026-03-01',
  usuario_id: 'u1', usuario_nome: 'Pessoa Teste', classe_nome: 'Classe Teste', percentual: 100,
  snapshot: { id: 's1', versao: 1, hash: 'ab'.repeat(32), selado_em: '2026-09-20', status: 'selado', manifesto_versao: '9.9' },
  revisao: { id: 'ir1', status: 'pendente' }, bloqueios: [], ultimo_evento: null,
  requisitos: [
    { member_requirement_id: 'mr1', secao: 'I', codigo: '1', descricao: 'Requisito um.', status: 'aprovado', aprovado_por: 'Líder A' },
    { member_requirement_id: 'mr2', secao: 'I', codigo: '2', descricao: 'Requisito dois.', status: 'aprovado', aprovado_por: 'Líder A' },
  ],
  ...over,
})

beforeEach(() => {
  clube = { papel: 'diretoria' }
  carregarRevisoesPendentes.mockReset()
  solicitarRevisaoFinal.mockReset().mockResolvedValue({ ok: true })
  decidirRevisaoFinal.mockReset().mockResolvedValue({ ok: true })
  registrarInvestidura.mockReset().mockResolvedValue({ ok: true })
})

describe('Investiduras — acesso e estados', () => {
  it('330: cartão com o DISTRITO — mostra a etapa e a linha do tempo, sem botões de decisão do clube', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base({
      revisao: { id: 'ir1', status: 'aprovado' },
      etapa_atual: { ordem: 2, chave: 'aprovacao_intermediaria', nome: 'Aprovação do distrito', escopo_tipo: 'distrito' },
      linha_do_tempo: { etapa_atual_ordem: 2, etapas: [
        { ordem: 1, chave: 'revisao_clube', nome: 'Revisão do clube', escopo_tipo: 'clube', decisao: { decisao: 'aprovado', decisor_nome: 'Líder A', decidido_em: '2026-09-21T10:00:00Z' } },
        { ordem: 2, chave: 'aprovacao_intermediaria', nome: 'Aprovação do distrito', escopo_tipo: 'distrito', decisao: null },
        { ordem: 3, chave: 'aprovacao_intermediaria', nome: 'Aprovação da região', escopo_tipo: 'regiao', decisao: null },
        { ordem: 4, chave: 'investidura', nome: 'Investidura', escopo_tipo: 'clube', decisao: null },
      ] },
    })])
    render(<Investiduras />)
    const card = await screen.findByRole('article', { name: 'Pessoa Teste: Classe Teste' })
    expect(within(card).getByTestId('estado')).toHaveTextContent('Aguardando distrito')
    expect(within(card).getAllByTestId('etapa-linha').map((e) => e.dataset.situacao)).toEqual(['aprovada', 'atual', 'futura', 'futura'])
    expect(within(card).queryByRole('button', { name: /Aprovar revisão final/ })).not.toBeInTheDocument()
  })

  it('330: devolvido pela coordenação — o clube vê o motivo', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base({
      etapa_atual: { ordem: 1, chave: 'revisao_clube', nome: 'Revisão do clube', escopo_tipo: 'clube' },
      devolucao: { etapa: 'Aprovação do distrito', motivo: 'Falta assinatura', em: '2026-09-22T10:00:00Z' },
    })])
    render(<Investiduras />)
    expect(await screen.findByTestId('devolucao')).toHaveTextContent('Falta assinatura')
    expect(screen.getByRole('button', { name: /Aprovar revisão final/ })).toBeInTheDocument()
  })

  it('quem não gere o clube vê a área trancada', async () => {
    clube = { papel: 'desbravador' }
    render(<Investiduras />)
    expect(await screen.findByText('Área da diretoria')).toBeInTheDocument()
    expect(carregarRevisoesPendentes).not.toHaveBeenCalled()
  })

  it('lista vazia', async () => {
    carregarRevisoesPendentes.mockResolvedValue([])
    render(<Investiduras />)
    expect(await screen.findByText('Nenhuma conclusão pendente')).toBeInTheDocument()
  })

  it('aguardando revisão: mostra snapshot (versão/hash), aprova a revisão final', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base()])
    render(<Investiduras />)
    const card = await screen.findByRole('article', { name: 'Pessoa Teste: Classe Teste' })
    expect(within(card).getByTestId('estado')).toHaveAttribute('data-estado', 'aguardando_revisao')
    expect(within(card).getByText(/Snapshot v1 selado/)).toBeInTheDocument()
    await userEvent.type(within(card).getByLabelText(/Observação da revisão/), 'Tudo certo')
    await userEvent.click(within(card).getByRole('button', { name: /Aprovar revisão final/ }))
    expect(decidirRevisaoFinal).toHaveBeenCalledWith('mc1', 'aprovado', 'Tudo certo')
  })

  it('pedir correção exige marcar requisitos E escrever a observação; envia os ids marcados', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base()])
    render(<Investiduras />)
    const card = await screen.findByRole('article', { name: 'Pessoa Teste: Classe Teste' })
    await userEvent.click(within(card).getByRole('button', { name: /Pedir correção/ }))
    const confirmar = within(card).getByRole('button', { name: /Confirmar correção/ })
    expect(confirmar).toBeDisabled()
    await userEvent.click(within(card).getByRole('checkbox', { name: /I\.2 Requisito dois/ }))
    expect(confirmar).toBeDisabled() // ainda sem observação
    await userEvent.type(within(card).getByLabelText(/Observação da revisão/), 'Refaça o dois')
    expect(confirmar).toBeEnabled()
    await userEvent.click(confirmar)
    expect(decidirRevisaoFinal).toHaveBeenCalledWith('mc1', 'correcao_solicitada', 'Refaça o dois', ['mr2'])
  })

  it('apto para investidura: registra com data (não futura) e observação; "apto ainda não é investido"', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base({ status: 'apto_investidura', revisao: { status: 'aprovado', revisado_em: '2026-09-21' } })])
    render(<Investiduras />)
    const card = await screen.findByRole('article', { name: 'Pessoa Teste: Classe Teste' })
    expect(within(card).getByTestId('estado')).toHaveAttribute('data-estado', 'apto_investidura')
    expect(within(card).getByText(/Apto ainda não é investido/)).toBeInTheDocument()
    const data = within(card).getByLabelText('Data da investidura')
    expect(data).toHaveAttribute('max')
    await userEvent.type(within(card).getByLabelText(/Observação \(opcional\)/), 'Cerimônia')
    await userEvent.click(within(card).getByRole('button', { name: /Registrar investidura/ }))
    expect(registrarInvestidura).toHaveBeenCalledWith('mc1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'Cerimônia')
  })

  it('com bloqueio atual, o botão de investidura fica desabilitado com o motivo ligado a ele', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base({ status: 'apto_investidura', bloqueios: [{ codigo: '4', bloqueios: ['O conteúdo oficial deste período (X) ainda não está disponível.'] }] })])
    render(<Investiduras />)
    const card = await screen.findByRole('article', { name: 'Pessoa Teste: Classe Teste' })
    const btn = within(card).getByRole('button', { name: /Registrar investidura/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription(/ainda não está disponível/)
  })

  it('requisitos concluídos sem selar: mostra bloqueios e permite tentar de novo; erro do servidor aparece', async () => {
    carregarRevisoesPendentes.mockResolvedValue([base({ status: 'requisitos_concluidos', snapshot: null, revisao: null, bloqueios: [{ codigo: '2', bloqueios: ['Escolha pelo menos 1 das 4 opções (0 de 1 até agora).'] }] })])
    solicitarRevisaoFinal.mockResolvedValue({ ok: false })
    render(<Investiduras />)
    const card = await screen.findByRole('article', { name: 'Pessoa Teste: Classe Teste' })
    expect(within(card).getByText(/Escolha pelo menos 1/)).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /Tentar selar a conclusão de novo/ }))
    expect(solicitarRevisaoFinal).toHaveBeenCalledWith('mc1')
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent(/Ainda não deu pra selar/))
  })
})
