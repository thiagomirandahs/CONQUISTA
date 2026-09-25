// Minha Classe consumindo o currículo OFICIAL: tudo vem do banco (nomes, seções, requisitos, regras,
// bloqueios) — a tela não sabe o que é "Amigo" nem interpreta texto. Fixtures sintéticas. Cobre os 9
// estados pedidos na fase 3.1: simples, com evidência, dinâmico (com/sem conteúdo), bloqueado, escolha
// N-de-M, cumprido pelo histórico, aguardando avaliação, aprovado, correção solicitada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }))
vi.mock('../lib/juice.js', () => ({ vitoria: () => {} }))
vi.mock('../components/Comprovacao.jsx', () => ({ default: () => null }))
vi.mock('framer-motion', () => ({ motion: { div: (p) => <div {...Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'transition'].includes(k)))} /> } }))

const carregarMinhaClasse = vi.fn()
const carregarClassesDisponiveis = vi.fn()
const iniciarClasse = vi.fn()
const enviarRequisito = vi.fn()
const escolherOpcoesRequisito = vi.fn()
const carregarOrigemRequisito = vi.fn()
const carregarHistoricoRequisito = vi.fn()
vi.mock('../lib/dados.js', () => ({
  carregarMinhaClasse: (...a) => carregarMinhaClasse(...a),
  carregarClassesDisponiveis: (...a) => carregarClassesDisponiveis(...a),
  iniciarClasse: (...a) => iniciarClasse(...a),
  salvarRequisito: vi.fn(),
  enviarRequisito: (...a) => enviarRequisito(...a),
  escolherOpcoesRequisito: (...a) => escolherOpcoesRequisito(...a),
  carregarOrigemRequisito: (...a) => carregarOrigemRequisito(...a),
  carregarHistoricoRequisito: (...a) => carregarHistoricoRequisito(...a),
}))

const { default: MinhaClasse, situacaoDoRequisito, fmtData } = await import('./MinhaClasse.jsx')

describe('fmtData', () => {
  it('data sem hora é calendário (não vira "31/12" no fuso local); timestamp segue o caminho normal', () => {
    expect(fmtData('2018-01-01')).toBe('01/01/2018')
    expect(fmtData('2026-01-01')).toBe('01/01/2026')
    expect(fmtData('')).toBe('')
    expect(fmtData(null)).toBe('')
    expect(fmtData('2026-09-22T15:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/2026$/)
  })
})

const DISPONIVEIS = [
  { class_id: 'c1', nome: 'Classe Teste 1', idade_minima: 10, elegivel: true, motivo_inelegivel: null, curriculum_version: { origem: 'oficial', versao: '9.9' } },
  { class_id: 'c2', nome: 'Classe Teste 2', idade_minima: 13, elegivel: false, motivo_inelegivel: 'Esta classe é a partir de 13 anos.', curriculum_version: { origem: 'oficial', versao: '9.9' } },
]

const base = (over) => ({ tipo_evidencia: 'nenhuma', avaliacoes: [], escolha: null, conteudo_dinamico: null, bloqueios: [], status: 'nao_iniciado', ...over })
const escolhaBase = (over) => ({ grupo_id: 'g', n_minimo: 1, sem_repeticao: false, pool_sem_repeticao: null, total_opcoes: 3, aceita_texto_livre: false,
  escolhidas: [], satisfeitas_automaticamente: 0, opcoes_automaticas: [], violacoes_sem_repeticao: [], validas: 0, satisfeito: false,
  opcoes: [{ id: 'o1', rotulo: 'Opção A' }, { id: 'o2', rotulo: 'Opção B' }, { id: 'o3', rotulo: 'Opção C' }], ...over })

const MINHA = {
  member_class: { id: 'mc1', status: 'em_andamento', iniciada_em: '2026-09-01', percentual: 11 },
  classe: { id: 'c1', nome: 'Classe Teste 1', idade_minima: 10, vigente_desde: '2026-01-01' },
  curriculum_version: { origem: 'oficial', identificador: 'teste', versao: '9.9' },
  conclusao: { snapshot: null, revisao: null, investidura: null },
  secoes: [{
    id: 's1', codigo: 'I', nome: 'Seção de Teste', ordem: 10,
    requisitos: [
      base({ id: 'r1', codigo: '1', descricao: 'Requisito simples de teste.' }),
      base({ id: 'r2', codigo: '2', descricao: 'Requisito com evidência de texto.', tipo_evidencia: 'texto', status: 'em_andamento', evidencia_texto: 'rascunho' }),
      base({ id: 'r3', codigo: '3', descricao: 'Requisito anual com conteúdo.', conteudo_dinamico: { chave: 'slot', valor: 'Conteúdo do ano [TESTE]', ano: 2026 } }),
      base({ id: 'r4', codigo: '4', descricao: 'Requisito anual sem conteúdo.', conteudo_dinamico: { chave: 'slot2', valor: null },
        bloqueios: ['O conteúdo oficial deste período (Slot 2) ainda não está disponível.'] }),
      base({ id: 'r5', codigo: '5', descricao: 'Requisito de escolha.', escolha: escolhaBase({ sem_repeticao: true }), bloqueios: ['Escolha pelo menos 1 das 3 opções (0 de 1 até agora).'] }),
      base({ id: 'r6', codigo: '6', descricao: 'Requisito cumprido pelo histórico.', escolha: escolhaBase({ satisfeitas_automaticamente: 1, opcoes_automaticas: ['o2'], validas: 1, satisfeito: true }) }),
      base({ id: 'r7', codigo: '7', descricao: 'Requisito aguardando.', status: 'aguardando_avaliacao' }),
      base({ id: 'r8', codigo: '8', descricao: 'Requisito aprovado.', status: 'aprovado', avaliacoes: [{ decisao: 'aprovado', avaliado_por_nome: 'Líder', avaliado_papel: 'diretoria', created_at: '2026-09-02' }] }),
      base({ id: 'r9', codigo: '9', descricao: 'Requisito com correção.', status: 'correcao_solicitada', member_requirement_id: 'mr9', avaliacoes: [{ decisao: 'correcao_solicitada', avaliado_por_nome: 'Líder', avaliado_papel: 'diretoria', comentario: 'Refaça', created_at: '2026-09-02' }] }),
      base({ id: 'r10', codigo: '10', descricao: 'Escolha aberta (sem lista).', escolha: escolhaBase({ total_opcoes: 0, aceita_texto_livre: true, opcoes: [], sem_repeticao: true }), bloqueios: ['Escolha pelo menos 1 e informe qual foi (0 de 1 até agora).'] }),
    ],
  }],
}

beforeEach(() => {
  carregarMinhaClasse.mockReset()
  carregarClassesDisponiveis.mockReset().mockResolvedValue(DISPONIVEIS)
  iniciarClasse.mockReset().mockResolvedValue({ ok: true })
  enviarRequisito.mockReset().mockResolvedValue()
  escolherOpcoesRequisito.mockReset().mockResolvedValue({ ok: true })
  carregarOrigemRequisito.mockReset()
})

const card = (codigo) => screen.getAllByTestId('requisito').find((a) => within(a).getByTestId('requisito-texto').textContent.startsWith(codigo + '. '))
const situacao = (codigo) => within(card(codigo)).getByTestId('situacao').getAttribute('data-situacao')

describe('situacaoDoRequisito (lógica pura)', () => {
  it('prioriza o status operacional final, depois bloqueio, depois histórico, depois o status', () => {
    expect(situacaoDoRequisito(base({ status: 'aprovado', bloqueios: ['x'] }))).toBe('aprovado')
    expect(situacaoDoRequisito(base({ status: 'correcao_solicitada', bloqueios: ['x'] }))).toBe('correcao_solicitada')
    expect(situacaoDoRequisito(base({ bloqueios: ['x'] }))).toBe('bloqueado')
    expect(situacaoDoRequisito(base({ escolha: escolhaBase({ satisfeitas_automaticamente: 1 }) }))).toBe('pronto_pelo_historico')
    expect(situacaoDoRequisito(base({ status: 'em_andamento' }))).toBe('em_andamento')
    expect(situacaoDoRequisito(base({}))).toBe('nao_iniciado')
  })
})

describe('MinhaClasse — seleção de classe', () => {
  it('lista o que o servidor manda, com idade mínima; a inelegível vem desabilitada COM o motivo ligado ao botão', async () => {
    carregarMinhaClasse.mockResolvedValue(null)
    render(<MinhaClasse />)
    expect(await screen.findByRole('heading', { name: 'Classe Teste 1' })).toBeInTheDocument()
    expect(screen.getByText('A partir de 10 anos')).toBeInTheDocument()
    const botoes = screen.getAllByRole('button', { name: 'Iniciar' })
    expect(botoes[0]).toBeEnabled()
    expect(botoes[1]).toBeDisabled()
    expect(botoes[1]).toHaveAccessibleDescription('🔒 Esta classe é a partir de 13 anos.')
    await userEvent.click(botoes[0])
    expect(iniciarClasse).toHaveBeenCalledWith('c1')
  })
})

describe('MinhaClasse — os estados de requisito', () => {
  beforeEach(() => { carregarMinhaClasse.mockResolvedValue(MINHA) })

  it('hierarquia: h2 página → h3 classe → h4 seção → h5 requisito; barra de progresso acessível', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4, name: 'I. Seção de Teste' })
    expect(screen.getByRole('heading', { level: 2, name: /Minha Classe/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Classe Teste 1' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 5 })).toHaveLength(10)
    expect(screen.getByRole('progressbar', { name: 'Progresso na classe' })).toHaveAttribute('aria-valuenow', '11')
    expect(screen.getByText(/Currículo oficial 9\.9/)).toBeInTheDocument()
  })

  it('cada situação tem ícone E texto (não só cor) e o data-situacao certo', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    expect(situacao('1')).toBe('nao_iniciado')
    expect(situacao('2')).toBe('em_andamento')
    expect(situacao('3')).toBe('nao_iniciado')
    expect(situacao('4')).toBe('bloqueado')
    expect(situacao('5')).toBe('bloqueado')
    expect(situacao('6')).toBe('pronto_pelo_historico')
    expect(situacao('7')).toBe('aguardando_avaliacao')
    expect(situacao('8')).toBe('aprovado')
    expect(situacao('9')).toBe('correcao_solicitada')
    expect(within(card('4')).getByTestId('situacao')).toHaveTextContent('Bloqueado')
    expect(within(card('6')).getByTestId('situacao')).toHaveTextContent('Cumprido pelo seu histórico')
    expect(within(card('8')).getByTestId('situacao')).toHaveTextContent('Aprovado')
  })

  it('simples: envia direto; com evidência: tem label e rascunho', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    const c1 = card('1')
    expect(within(c1).queryByText('Salvar rascunho')).not.toBeInTheDocument()
    await userEvent.click(within(c1).getByRole('button', { name: 'Enviar para avaliação' }))
    expect(enviarRequisito).toHaveBeenCalledWith('r1')
    const c2 = card('2')
    expect(within(c2).getByLabelText('Sua resposta')).toHaveValue('rascunho')
    expect(within(c2).getByRole('button', { name: 'Salvar rascunho' })).toBeInTheDocument()
  })

  it('dinâmico: mostra o conteúdo resolvido; sem conteúdo avisa claramente e BLOQUEIA o envio com o motivo ligado ao botão', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    expect(within(card('3')).getByText('Conteúdo do ano [TESTE]')).toBeInTheDocument()
    expect(within(card('3')).getByText(/Conteúdo de 2026/)).toBeInTheDocument() // o ano do conteúdo vem do servidor (migration 84)
    expect(within(card('3')).getByRole('button', { name: 'Enviar para avaliação' })).toBeEnabled()
    const c4 = card('4')
    expect(within(c4).getAllByText(/ainda não está disponível/)).toHaveLength(1) // o motivo aparece UMA vez (na lista de bloqueios), não duplicado
    const btn = within(c4).getByRole('button', { name: /Enviar para avaliação/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription(/ainda não está disponível/)
    expect(within(c4).getByTestId('bloqueios')).toHaveTextContent('Slot 2')
  })

  it('escolha N-de-M: opções na ordem como checkboxes, aviso de não repetir, salva a escolha pelo servidor', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    const c5 = card('5')
    const grupo = within(c5).getByRole('group', { name: /Escolha 1 de 3/ })
    expect(within(grupo).getByText(/não vale especialidade já realizada/)).toBeInTheDocument()
    const caixas = within(grupo).getAllByRole('checkbox')
    expect(caixas.map((c) => c.closest('label').textContent)).toEqual(['Opção A', 'Opção B', 'Opção C'])
    expect(within(c5).getByRole('button', { name: /Enviar para avaliação/ })).toBeDisabled()
    expect(within(c5).queryByText('Salvar escolha')).not.toBeInTheDocument()
    await userEvent.click(caixas[1])
    await userEvent.click(within(c5).getByRole('button', { name: 'Salvar escolha' }))
    expect(escolherOpcoesRequisito).toHaveBeenCalledWith('r5', ['o2'], [])
  })

  it('escolha aberta (cartão sem lista): aceita texto livre com label', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    const c10 = card('10')
    await userEvent.type(within(c10).getByLabelText('Qual especialidade você fez?'), 'Cestaria')
    await userEvent.click(within(c10).getByRole('button', { name: 'Adicionar' }))
    await userEvent.click(within(c10).getByRole('button', { name: 'Salvar escolha' }))
    expect(escolherOpcoesRequisito).toHaveBeenCalledWith('r10', [], ['Cestaria'])
  })

  it('cumprido pelo histórico: a opção vem marcada/desabilitada com o aviso, e o envio está liberado', async () => {
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    const c6 = card('6')
    const caixaB = within(c6).getAllByRole('checkbox')[1]
    expect(caixaB).toBeChecked()
    expect(caixaB).toBeDisabled()
    expect(within(c6).getByText(/cumprida pelo seu histórico/)).toBeInTheDocument()
    expect(within(c6).getByRole('button', { name: 'Enviar para avaliação' })).toBeEnabled()
  })

  it('aguardando/aprovado/correção: sem formulário, com o histórico e o pedido de correção', async () => {
    carregarHistoricoRequisito.mockResolvedValue({
      status_atual: 'correcao_solicitada',
      tentativas: [{ submission_id: 's1', tentativa_numero: 1, evidencia_texto: null, evidencia_path: null, enviado_em: '2026-09-01', decisao: 'correcao_solicitada', avaliado_por_nome: 'Líder', avaliado_papel: 'diretoria', comentario: 'Refaça', avaliado_em: '2026-09-02' }],
    })
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    expect(within(card('7')).getByText(/Aguardando a liderança avaliar/)).toBeInTheDocument()
    expect(within(card('7')).queryByRole('button', { name: /Enviar/ })).not.toBeInTheDocument()
    expect(within(card('8')).queryByRole('button', { name: /Enviar/ })).not.toBeInTheDocument()
    const c9 = card('9')
    expect(within(c9).getByText(/A liderança pediu correção/)).toBeInTheDocument()
    await userEvent.click(within(c9).getByRole('button', { name: /histórico/ }))
    expect(await within(c9).findByText('"Refaça"')).toBeInTheDocument()
  })

  it('"Origem do requisito" é secundária (um link por card) e abre a proveniência sob demanda', async () => {
    carregarOrigemRequisito.mockResolvedValue({
      requisito: { codigo: '1', descricao: 'Requisito simples de teste.', manifesto_id: 'teste.I.1', status_fonte: 'ALTERADO_POR_OMD',
        alterado_por_omd: { id: 'OMD-999-2020', titulo: 'OMD de teste', data: '2020-01-01', url: 'https://exemplo.test/omd.pdf' } },
      classe: { nome: 'Classe Teste 1', idade_minima: 10, fonte_url: 'https://exemplo.test/classe/', fonte_publicado_em: '2017-01-01', vigente_desde: '2026-01-01' },
      versao: { identificador: 'teste', versao: '9.9', origem: 'oficial', status: 'publicado', fonte_hash: 'abc123', manifesto_versao: '9.9', gerado_em: '2026-09-22', importado_em: '2026-09-22' },
    })
    render(<MinhaClasse />)
    await screen.findByRole('heading', { level: 4 })
    expect(screen.queryByText(/OMD-999/)).not.toBeInTheDocument()
    expect(screen.queryByText('abc123')).not.toBeInTheDocument()
    await userEvent.click(within(card('1')).getByRole('button', { name: 'Origem do requisito' }))
    expect(carregarOrigemRequisito).toHaveBeenCalledWith('r1')
    const dialog = await screen.findByRole('dialog', { name: 'Origem do requisito' })
    expect(within(dialog).getByText(/OMD-999-2020/)).toBeInTheDocument()
    expect(within(dialog).getByText('abc123')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
