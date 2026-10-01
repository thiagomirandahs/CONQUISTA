import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let papel = 'diretoria'
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ papel, clubeId: 'club1' }) }))
const membrosDoClube = vi.fn()
vi.mock('../services/membros.js', () => ({ membrosDoClube: (...a) => membrosDoClube(...a) }))
const carregarClassesOficiais = vi.fn()
const carregarConclusoesDoMembro = vi.fn()
const registrarClasseAnterior = vi.fn()
const revogarRegistroAnterior = vi.fn()
vi.mock('../services/classesAnteriores.js', () => ({
  carregarClassesOficiais: (...a) => carregarClassesOficiais(...a),
  carregarConclusoesDoMembro: (...a) => carregarConclusoesDoMembro(...a),
  registrarClasseAnterior: (...a) => registrarClasseAnterior(...a),
  revogarRegistroAnterior: (...a) => revogarRegistroAnterior(...a),
  urlComprovanteAnterior: vi.fn(),
}))

const { default: Pagina } = await import('./ClasseConcluidaAnterior.jsx')

const MEMBRO = { id: 'm1', nome: 'Pedro Lima', papel: 'desbravador' }
const CLASSES = [
  { id: 'k1', codigo: 'AMIGO', nome: 'Amigo', avancada: false },
  { id: 'k2', codigo: 'AMIGO_AV', nome: 'Amigo da Natureza', avancada: true },
]
const ITENS = [
  { achievement_id: 'a1', class_id: 'k1', nome: 'Amigo', origem: 'registro_anterior', status: 'ativa', concluida_em: '2024-05-10', data_desconhecida: false,
    registrado_em: '2026-09-30T10:00:00Z', registrado_por_nome: 'Ana', observacao: 'Cartão da classe', pode_revogar: true, tem_comprovante: false },
  { achievement_id: 'a2', class_id: 'k3', nome: 'Companheiro', origem: 'outro_clube', status: 'ativa', concluida_em: null, data_desconhecida: true, clube_nome: 'Aurora', pode_revogar: false },
  { achievement_id: 'a3', class_id: 'k4', nome: 'Pesquisador', origem: 'conclusao_no_app', status: 'ativa', concluida_em: '2025-01-02', neste_clube: true, pode_revogar: false },
  { achievement_id: 'a4', class_id: 'k5', nome: 'Explorador', origem: 'registro_anterior', status: 'revogada', revogada_em: '2026-09-30T12:00:00Z', revogada_motivo: 'lançado no membro errado', pode_revogar: false },
]

beforeEach(() => {
  papel = 'diretoria'
  for (const f of [membrosDoClube, carregarClassesOficiais, carregarConclusoesDoMembro, registrarClasseAnterior, revogarRegistroAnterior]) f.mockReset()
  membrosDoClube.mockResolvedValue([MEMBRO, { id: 'p1', nome: 'Mae', papel: 'pais' }])
  carregarClassesOficiais.mockResolvedValue(CLASSES)
  carregarConclusoesDoMembro.mockResolvedValue({ disponivel: true, itens: ITENS })
})

const abrirMembro = async () => {
  render(<Pagina />)
  await userEvent.click(await screen.findByRole('button', { name: /Pedro Lima/ }))
}
const irAteDados = async () => {
  await abrirMembro()
  await userEvent.click(await screen.findByRole('button', { name: 'Registrar classe já concluída' }))
  await userEvent.click(await screen.findByRole('radio', { name: 'Amigo' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
}
const preencher = async () => {
  await userEvent.type(screen.getByLabelText('Data da conclusão'), '2024-05-10')
  await userEvent.type(screen.getByLabelText(/De onde vem esta informação/), 'Cartão da classe')
  await userEvent.click(screen.getByRole('button', { name: 'Revisar' }))
}

describe('visibilidade', () => {
  it('quem não é diretoria/instrutor não vê o fluxo nem busca membros', () => {
    papel = 'conselheiro'
    render(<Pagina />)
    expect(screen.getByText('Só a liderança')).toBeInTheDocument()
    expect(membrosDoClube).not.toHaveBeenCalled()
  })
  it('instrutor vê; pais não aparecem na lista', async () => {
    papel = 'instrutor'
    render(<Pagina />)
    expect(await screen.findByRole('button', { name: /Pedro Lima/ })).toBeInTheDocument()
    expect(screen.queryByText('Mae')).toBeNull()
  })
})

describe('lista de conclusões por origem', () => {
  it('mostra origem, data, observação, corrigidos discretos e botão só quando pode_revogar', async () => {
    await abrirMembro()
    const itens = await screen.findAllByTestId('conclusao-item')
    expect(itens).toHaveLength(3)
    expect(itens[0]).toHaveTextContent('Concluída anteriormente · Registrada em 30/09/2026 por Ana')
    expect(itens[0]).toHaveTextContent('Concluída em 10/05/2024')
    expect(itens[0]).toHaveTextContent('Observação: Cartão da classe')
    expect(itens[1]).toHaveTextContent('Concluída em outro clube (Aurora)')
    expect(itens[1]).toHaveTextContent('Data da conclusão desconhecida')
    expect(itens[2]).toHaveTextContent('Concluída no app')
    expect(screen.getAllByRole('button', { name: 'Corrigir registro' })).toHaveLength(1)
    expect(screen.getByTestId('registro-corrigido')).toHaveTextContent('Motivo: lançado no membro errado')
  })
  it('corrigir exige motivo com 5 letras, confirma e chama revogar com id e motivo', async () => {
    await abrirMembro()
    await userEvent.click(await screen.findByRole('button', { name: 'Corrigir registro' }))
    expect(screen.getByText(/nada é apagado/)).toBeInTheDocument()
    revogarRegistroAnterior.mockResolvedValue({ ok: true })
    await userEvent.type(screen.getByLabelText('Motivo da correção'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    expect(revogarRegistroAnterior).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/mínimo 5/)
    await userEvent.type(screen.getByLabelText('Motivo da correção'), 'de')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    await waitFor(() => expect(revogarRegistroAnterior).toHaveBeenCalledWith('a1', 'abcde'))
    await waitFor(() => expect(carregarConclusoesDoMembro).toHaveBeenCalledTimes(2))
  })
  it('banco sem a 521: sem botão de registrar, só o aviso', async () => {
    carregarConclusoesDoMembro.mockResolvedValue({ disponivel: false, itens: [] })
    await abrirMembro()
    expect(await screen.findByText(/ainda não está disponível/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar classe já concluída' })).toBeNull()
  })
})

describe('assistente de registro', () => {
  it('lista regulares e avançadas; exige escolher a classe', async () => {
    await abrirMembro()
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar classe já concluída' }))
    expect(await screen.findByText('Regulares')).toBeInTheDocument()
    expect(screen.getByText('Avançadas')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha a classe.')
  })
  it('observação curta ou data faltando bloqueia a revisão', async () => {
    await irAteDados()
    await userEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('confirmacao-texto')).toBeNull()
  })
  it('confirmação mostra membro, classe, data e impacto; confirmar envia payload e avisa', async () => {
    registrarClasseAnterior.mockResolvedValue({ ok: true })
    await irAteDados()
    await preencher()
    expect(screen.getByTestId('confirmacao-texto')).toHaveTextContent('Você está registrando que Pedro Lima já concluiu a classe Amigo.')
    expect(screen.getByTestId('confirmacao-data')).toHaveTextContent('10/05/2024')
    expect(screen.getByTestId('confirmacao-impacto')).toHaveTextContent('Não cria aprovações de requisitos nem documento.')
    expect(registrarClasseAnterior).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar registro' }))
    await waitFor(() => expect(registrarClasseAnterior).toHaveBeenCalledWith({
      usuarioId: 'm1', classId: 'k1', data: '2024-05-10', dataDesconhecida: false, observacao: 'Cartão da classe', arquivo: null, clubeId: 'club1',
    }))
    expect(await screen.findByText(/Registro feito/)).toBeInTheDocument()
    expect(screen.getByText(/Pedro Lima agora consta/)).toBeInTheDocument()
  })
  it('"Não sei a data" desabilita a data e a confirmação diz desconhecida', async () => {
    await irAteDados()
    await userEvent.click(screen.getByLabelText('Não sei a data'))
    expect(screen.getByLabelText('Data da conclusão')).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/De onde vem esta informação/), 'Relato do pai')
    await userEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    expect(screen.getByTestId('confirmacao-data')).toHaveTextContent('desconhecida')
  })
  it('Voltar na confirmação retorna aos dados sem perder o que foi digitado', async () => {
    await irAteDados()
    await preencher()
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByLabelText(/De onde vem esta informação/)).toHaveValue('Cartão da classe')
  })
  it('erro do servidor aparece em português simples e permanece na confirmação', async () => {
    registrarClasseAnterior.mockRejectedValue(new Error('Esta classe já consta como concluída por esta pessoa neste clube.'))
    await irAteDados()
    await preencher()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar registro' }))
    expect(await screen.findByText('Esta classe já consta como concluída por esta pessoa.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar registro' })).toBeInTheDocument()
  })
  it('explica que PDF não é aceito e que a foto é privada', async () => {
    await irAteDados()
    expect(screen.getByText(/PDF não é aceito/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /Registrar classe já concluída/ })).getByText(/área privada/)).toBeInTheDocument()
  })
})
