// /admin — Administração da Plataforma. O guard real é o servidor (eh_admin_plataforma()); estes
// testes garantem que o FRONT nunca desenha o painel antes da confirmação, que a visão é por CLUBE
// (inclusive o fundador, sem conta comercial) e que as ações chamam as RPCs auditadas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'

const f = {
  souAdminPlataforma: vi.fn(), visaoGeral: vi.fn(), clubesListar: vi.fn(), clubeDetalhe: vi.fn(),
  planosAdminListar: vi.fn(), assinaturasListar: vi.fn(), onboardingListar: vi.fn(), planoMudar: vi.fn(),
  provisionamentoPendencias: vi.fn(), provisionamentoReexecutar: vi.fn(), assinaturaTransicionar: vi.fn(),
  suporteListar: vi.fn(), suporteRevogar: vi.fn(), auditoriaListar: vi.fn(),
  trialPadrao: vi.fn(), trialPadraoDefinir: vi.fn(), trialEstender: vi.fn(), trialEncerrar: vi.fn(),
}
vi.mock('../services/admin.js', () => Object.fromEntries(Object.keys(f).map((k) => [k, (...a) => f[k](...a)])))
// "Precisa da sua atenção" conta as pendências de hierarquia — nunca ir à rede no teste.
vi.mock('../services/hierarquia.js', async (original) => ({
  ...(await original()),
  hierarquiaAdmin: () => Promise.resolve({ pedidos_clube: [], coordenadores_pendentes: [] }),
}))
vi.mock('../services/avisoInstitucional.js', () => ({
  alcanceAvisoInstitucional: () => Promise.resolve({ pode: true, clubes: 4, origem: 'DesbravaClube', plataforma: true }),
  enviarAvisoInstitucional: vi.fn(),
}))
// Decisões destrutivas passam pelo modal de confirmação (avisar.confirmar); sem provider ele responde
// `false`, então o teste controla a resposta aqui e nunca chega numa RPC sem confirmação explícita.
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), info: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))

const { default: Admin, formatarBytes, diasRestantes, diasParado, ABAS, SECOES } = await import('./Admin.jsx')

// A seção do painel vive na URL (?aba=) — o Admin precisa de um Router. `UrlAtual` expõe a URL do
// MemoryRouter para o teste ler.
function UrlAtual() {
  const l = useLocation(); const navegar = useNavigate()
  return <><span data-testid="url-atual">{l.pathname}{l.search}</span><button type="button" data-testid="voltar-teste" onClick={() => navegar(-1)}>voltar</button></>
}
const renderAdmin = (entrada = '/admin') => render(<MemoryRouter initialEntries={[entrada]}><Admin /><UrlAtual /></MemoryRouter>)

const FUNDADOR = {
  club_id: 'c1', nome: 'Filhos da Conquista', slug: 'filhos-da-conquista', status: 'ativo', criado_em: '2026-09-24T21:00:00Z',
  assinatura_id: null, armazenamento_bytes: 700 * 1048576, armazenamento_objetos: 397,
  armazenamento_limite_mb: null, armazenamento_pct: null, armazenamento_situacao: 'sem_limite', membros: 30,
  onboarding_status: null, provisionamento: 'ok',
}
const NOVO = {
  club_id: 'c2', nome: 'Exército da colina', slug: 'exercito-da-colina', status: 'ativo', criado_em: '2026-09-25T11:29:00Z',
  assinatura_id: 's2', assinatura_status: 'trial', ciclo: 'mensal', plano_chave: 'gratuito', plano_versao: 1,
  plano_nome: 'Gratuito', provider: 'mock', armazenamento_bytes: 0, armazenamento_objetos: 0, armazenamento_limite_mb: 10,
  armazenamento_pct: 0, armazenamento_situacao: 'normal', membros: 0, onboarding_status: 'em_andamento', onboarding_etapa: 'identidade',
}
const DETALHE = {
  clube: NOVO, hierarquia: null, limites: [{ chave: 'membros', teto: '20', uso: 0 }], recursos: [],
  vinculos_por_papel: [], assinatura_eventos: [], onboarding: [{ status: 'em_andamento', etapa: 'identidade', atualizado_em: '2026-09-25T11:30:00Z' }],
  provisionamento: { status: 'ok' }, auditoria: [],
}
const PLANOS = [
  { id: 'p1', chave: 'anual', versao: 1, nome: 'Licença Anual', publico: true, status: 'publicado', ativo: true, provisorio: false, limites: { membros: 300 }, recursos: null, assinaturas: 0, precos: [{ ciclo: 'anual', moeda: 'BRL', valor_centavos: 22990, ativo: true, vigente_de: '2026-09-25' }] },
  { id: 'p2', chave: 'gratuito', versao: 1, nome: 'Gratuito', publico: false, status: 'publicado', ativo: true, provisorio: true, limites: { membros: 20 }, recursos: ['chat'], assinaturas: 1, precos: [] },
]

beforeEach(() => {
  for (const fn of Object.values(f)) fn.mockReset()
  confirmar.mockReset().mockResolvedValue(true)
  f.visaoGeral.mockResolvedValue({ clubes_total: 2, clubes_ativos: 2, clubes_inativos: 0, onboarding_em_andamento: 1, onboarding_concluidos: 0,
    assinaturas_por_status: { trial: 1 }, planos_total: 6, planos_publicos: 1, armazenamento_total_bytes: 700 * 1048576,
    clubes_proximos_do_limite: 0, clubes_no_limite: 0, provisionamentos_pendentes: 0, eventos_admin_7d: 0, eventos_assinatura_7d: 1 })
  f.clubesListar.mockResolvedValue([FUNDADOR, NOVO])
  f.clubeDetalhe.mockResolvedValue(DETALHE)
  f.planosAdminListar.mockResolvedValue(PLANOS)
  f.assinaturasListar.mockResolvedValue([])
  f.onboardingListar.mockResolvedValue([])
  f.provisionamentoPendencias.mockResolvedValue([])
  f.suporteListar.mockResolvedValue([])
  f.auditoriaListar.mockResolvedValue([])
  f.trialPadrao.mockResolvedValue({ trial_dias: 30, politica_versao: 1 })
  f.trialPadraoDefinir.mockResolvedValue({ ok: true })
  f.trialEstender.mockResolvedValue({ ok: true })
  f.trialEncerrar.mockResolvedValue({ ok: true })
})

// a navegação do painel é um menu em lista: abre o menu e toca na área
const abrirAba = async (nome) => { await userEvent.click(screen.getByTestId('admin-menu')); await userEvent.click(screen.getByRole('tab', { name: nome })) }
const abrirComoAdmin = async (entrada) => { f.souAdminPlataforma.mockResolvedValue(true); renderAdmin(entrada); await screen.findByRole('heading', { name: 'Administração' }) }
// detalhe do clube: leitura no "Resumo"; assinatura/plano/teste gratuito ficam na sub-aba "Assinatura"
const abrirClubeNaAssinatura = async (nome = /Exército da colina/) => {
  await abrirAba(/Clubes/)
  await userEvent.click(await screen.findByText(nome))
  await userEvent.click(await screen.findByTestId('clube-sub-assinatura'))
}

describe('Admin: guard — nunca mostra o painel sem confirmação do servidor', () => {
  it('não-admin: vê "área restrita" e nenhuma RPC administrativa é chamada', async () => {
    f.souAdminPlataforma.mockResolvedValue(false)
    renderAdmin()
    expect(await screen.findByText('Área restrita')).toBeInTheDocument()
    for (const k of ['visaoGeral', 'clubesListar', 'planosAdminListar', 'assinaturasListar', 'onboardingListar']) expect(f[k]).not.toHaveBeenCalled()
  })

  it('erro ao verificar: trata como NÃO-admin', async () => {
    f.souAdminPlataforma.mockRejectedValue(new Error('falhou'))
    renderAdmin()
    expect(await screen.findByText('Área restrita')).toBeInTheDocument()
  })

  it('admin: abre na Visão geral com as métricas do servidor', async () => {
    await abrirComoAdmin()
    expect(await screen.findByTestId('visao-clubes')).toHaveTextContent('2')
    expect(screen.getByText('Em onboarding')).toBeInTheDocument()
  })
})

describe('Admin: seção ⇄ URL (?aba=)', () => {
  it('link direto abre a seção da URL', async () => {
    await abrirComoAdmin('/admin?aba=planos')
    expect(await screen.findAllByTestId('plano-item')).toHaveLength(2)
    expect(screen.getByTestId('admin-menu')).toHaveTextContent('Planos')
  })

  it('TODA aba de TODA seção é reconhecida pela página (achado de 02/10/2026: "Aviso geral" estava no menu e voltava para a Visão geral)', () => {
    const chaves = new Set(ABAS.map((a) => a.chave))
    for (const s of SECOES) for (const a of s.abas) expect(chaves.has(a), `aba "${a}" da seção "${s.chave}" não existe em ABAS`).toBe(true)
  })

  it('link direto para ?aba=avisos abre o formulário do Aviso geral da plataforma', async () => {
    await abrirComoAdmin('/admin?aba=avisos')
    expect(await screen.findByText(/Aviso geral da plataforma/)).toBeInTheDocument()
    expect(screen.queryByTestId('visao-clubes')).not.toBeInTheDocument()
    expect(screen.getByText('Chega em 4 clubes ativos.')).toBeInTheDocument()
  })

  it('aba desconhecida cai na Visão geral', async () => {
    await abrirComoAdmin('/admin?aba=nao-existe')
    expect(await screen.findByTestId('visao-clubes')).toBeInTheDocument()
  })

  it('trocar de seção escreve ?aba= na URL (e a Visão geral limpa o parâmetro)', async () => {
    await abrirComoAdmin()
    await abrirAba(/Clubes/)
    expect(screen.getByTestId('url-atual')).toHaveTextContent('/admin?aba=clubes')
    // a seção Suporte agrupa Chamados + Acessos: abre em chamados, a sub-aba leva a ?aba=suporte
    await abrirAba(/Suporte/)
    expect(screen.getByTestId('url-atual')).toHaveTextContent('/admin?aba=chamados')
    await userEvent.click(screen.getByTestId('subaba-suporte'))
    expect(screen.getByTestId('url-atual')).toHaveTextContent('/admin?aba=suporte')
    await abrirAba(/Visão geral/)
    expect(screen.getByTestId('url-atual')).toHaveTextContent(/^\/admin$/)
  })

  it('voltar do navegador volta para a seção anterior (replace: false)', async () => {
    await abrirComoAdmin()
    await abrirAba(/Clubes/)
    await abrirAba(/Planos/)
    expect(await screen.findAllByTestId('plano-item')).toHaveLength(2)
    // MemoryRouter: history.back() não existe; o `navigate(-1)` é o que o botão do navegador dispara.
    // Simulamos pelo próprio Router — voltar 1 entrada leva a ?aba=clubes.
    await userEvent.click(screen.getByTestId('voltar-teste'))
    expect(screen.getByTestId('url-atual')).toHaveTextContent('/admin?aba=clubes')
    expect(await screen.findAllByTestId('clube-item')).toHaveLength(2)
  })
})

describe('Admin: Clubes', () => {
  it('lista TODOS os clubes, inclusive o fundador sem assinatura, com busca e filtro', async () => {
    await abrirComoAdmin()
    await abrirAba(/Clubes/)
    const todos = await screen.findAllByTestId('clube-item')
    expect(todos).toHaveLength(2)
    expect(within(todos[0]).getByText('Sem assinatura')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Buscar clube'), 'colina')
    expect(screen.getAllByTestId('clube-item')).toHaveLength(1)
    await userEvent.clear(screen.getByLabelText('Buscar clube'))
    await userEvent.selectOptions(screen.getByLabelText('Filtro'), 'onboarding')
    const itens = screen.getAllByTestId('clube-item')
    expect(itens).toHaveLength(1)
    expect(within(itens[0]).getByText(/Exército da colina/)).toBeInTheDocument()
  })

  it('cartão do clube mostra a logo (ou a sigla na cor do clube) e membros x limite', async () => {
    f.clubesListar.mockResolvedValue([
      { ...FUNDADOR, logo_url: 'https://x.test/logo.png', membros_limite: null },
      { ...NOVO, sigla: 'EDC', cor_primaria: '#7a1f1f', membros: 5, membros_limite: 20 },
    ])
    await abrirComoAdmin()
    await abrirAba(/Clubes/)
    const [a, b] = await screen.findAllByTestId('clube-item')
    expect(within(a).getByAltText('Logo do Filhos da Conquista')).toHaveAttribute('src', 'https://x.test/logo.png')
    expect(within(b).getByText('EDC')).toBeInTheDocument()
    expect(within(b).getByText('5 / 20')).toBeInTheDocument()
  })

  it('Visão geral: "Precisa da sua atenção" lista teste acabando em até 7 dias', async () => {
    const em3 = new Date(Date.now() + 3 * 86400000 - 3600000).toISOString()
    f.clubesListar.mockResolvedValue([FUNDADOR, { ...NOVO, trial_ate: em3 }])
    await abrirComoAdmin()
    const painel = await screen.findByTestId('visao-atencao')
    expect(await within(painel).findByText(/Teste acaba em 3 dia/)).toBeInTheDocument()
  })

  it('detalhe do clube: status da assinatura só muda com motivo (vai para a auditoria)', async () => {
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    expect(f.clubeDetalhe).toHaveBeenCalledWith('c2')
    expect(await screen.findByText('Sem gateway — combinado fora do sistema')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByTestId('assinatura-status'), 'ativa')
    await userEvent.click(screen.getByTestId('confirmar-transicao'))
    expect(f.assinaturaTransicionar).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Pagamento combinado fora do sistema')
    await userEvent.click(screen.getByTestId('confirmar-transicao'))
    // status neutro: sem modal de confirmação, botão neutro
    expect(confirmar).not.toHaveBeenCalled()
    expect(f.assinaturaTransicionar).toHaveBeenCalledWith('s2', 'ativa', 'Pagamento combinado fora do sistema')
  })

  it('suspender/cancelar/inadimplente: botão vermelho + confirmação com clube, status, impacto e motivo (P0)', async () => {
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    await screen.findByText('Sem gateway — combinado fora do sistema')
    await userEvent.selectOptions(screen.getByTestId('assinatura-status'), 'suspensa')
    const botao = screen.getByTestId('confirmar-transicao')
    expect(botao).toHaveClass('bg-rose-600')
    expect(botao).toHaveTextContent('Mudar para Suspensa')
    expect(screen.getByTestId('transicao-impacto')).toHaveTextContent('perde acesso às ferramentas')
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Pedido do próprio clube')

    // recusou no modal: nada vai ao servidor
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(botao)
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(true)
    expect(pedido.titulo).toContain('Suspensa')
    expect(pedido.descricao).toContain('Exército da colina')
    expect(pedido.descricao).toContain('Período de teste → novo: Suspensa')
    expect(pedido.descricao).toContain('perde acesso às ferramentas')
    expect(pedido.descricao).toContain('Pedido do próprio clube')
    expect(f.assinaturaTransicionar).not.toHaveBeenCalled()

    // confirmou: chama a RPC auditada
    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(botao)
    expect(f.assinaturaTransicionar).toHaveBeenCalledWith('s2', 'suspensa', 'Pedido do próprio clube')
  })

  it('cada status perigoso tem o seu impacto no modal', async () => {
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    await screen.findByText('Sem gateway — combinado fora do sistema')
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Motivo de teste')
    for (const [status, trecho] of [['cancelada', 'assinatura nova'], ['inadimplente', 'pagamento em atraso']]) {
      confirmar.mockResolvedValueOnce(false)
      await userEvent.selectOptions(screen.getByTestId('assinatura-status'), status)
      expect(screen.getByTestId('confirmar-transicao')).toHaveClass('bg-rose-600')
      await userEvent.click(screen.getByTestId('confirmar-transicao'))
      expect(confirmar.mock.calls.at(-1)[0].descricao).toContain(trecho)
    }
    expect(f.assinaturaTransicionar).not.toHaveBeenCalled()
  })

  it('alterar plano: excedente exige confirmação explícita antes de aplicar', async () => {
    f.planoMudar.mockResolvedValueOnce({ ok: false, precisa_confirmar: true, mensagem: 'O plano escolhido é menor que o uso atual.', excedentes: [{ clube: 'Exército da colina', limite: 'membros', uso: 30, teto: 20 }] })
      .mockResolvedValueOnce({ ok: true })
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    await userEvent.selectOptions(await screen.findByLabelText('Alterar plano'), 'anual|1')
    await userEvent.click(screen.getByText('Aplicar plano'))
    expect(f.planoMudar).toHaveBeenLastCalledWith('s2', 'anual', 1, false)
    expect(await screen.findByText('O plano novo é menor que o uso atual')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Confirmar mesmo assim'))
    expect(f.planoMudar).toHaveBeenLastCalledWith('s2', 'anual', 1, true)
  })
})

describe('Admin: Planos, Assinaturas, Armazenamento', () => {
  it('Planos mostra TODAS as versões (inclusive fora da vitrine) e não tem edição', async () => {
    await abrirComoAdmin()
    await abrirAba(/Planos/)
    expect(await screen.findAllByTestId('plano-item')).toHaveLength(2)
    expect(screen.getByText('Fora da vitrine')).toBeInTheDocument()
    expect(screen.queryByText('Salvar')).toBeNull()
    expect(screen.queryByText('Editar')).toBeNull()
  })

  it('Assinaturas nunca mostra pagamento confirmado sem gateway', async () => {
    f.assinaturasListar.mockResolvedValue([{ id: 's2', status: 'trial', ciclo: 'mensal', plano_nome: 'Gratuito', plano_versao: 1, criada_em: '2026-09-25', clubes: [{ club_id: 'c2', nome: 'Exército da colina' }], faturas_pagas_gateway: 0, faturas_abertas: 0 }])
    await abrirComoAdmin()
    await abrirAba(/Assinaturas/)
    expect(await screen.findByText('Pagamento não confirmado por gateway')).toBeInTheDocument()
  })

  it('Armazenamento põe quem está no limite primeiro', async () => {
    f.clubesListar.mockResolvedValue([NOVO, { ...FUNDADOR, club_id: 'c3', nome: 'Clube Cheio', armazenamento_situacao: 'atingido', armazenamento_limite_mb: 10, armazenamento_pct: 100 }])
    await abrirComoAdmin()
    await abrirAba(/Armazenamento/)
    const itens = await screen.findAllByTestId('armazenamento-item')
    expect(within(itens[0]).getByText('Clube Cheio')).toBeInTheDocument()
    expect(within(itens[0]).getByText('Limite atingido')).toBeInTheDocument()
  })
})

describe('Admin: Suporte — admin nunca autoriza o próprio pedido', () => {
  it('não existe botão Autorizar; revogar chama suporte_revogar', async () => {
    f.suporteListar.mockResolvedValue([{ id: 'g1', motivo: 'Investigar erro relatado', status: 'solicitado' }])
    await abrirComoAdmin()
    await abrirAba(/Suporte/)
    await userEvent.click(screen.getByTestId('subaba-suporte'))
    expect(await screen.findByText(/não concede acesso real/)).toBeInTheDocument()
    expect(screen.queryByText('Autorizar')).toBeNull()
    // recusou a confirmação: nada é revogado
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByText('Revogar'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(confirmar.mock.calls[0][0].descricao).toContain('Investigar erro relatado')
    expect(f.suporteRevogar).not.toHaveBeenCalled()
    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByText('Revogar'))
    expect(f.suporteRevogar).toHaveBeenCalledWith('g1', expect.any(String))
  })
})

describe('Admin: teste gratuito', () => {
  it('Planos mostra o padrão de dias e salva um novo valor (saiu da Visão geral)', async () => {
    await abrirComoAdmin()
    expect(screen.queryByTestId('trial-padrao-atual')).toBeNull()
    await abrirAba(/Planos/)
    expect(await screen.findByTestId('trial-padrao-atual')).toHaveTextContent('30 dia(s)')
    const campo = screen.getByLabelText('Dias de teste')
    await userEvent.clear(campo)
    await userEvent.type(campo, '14')
    await userEvent.click(screen.getByTestId('trial-padrao-salvar'))
    expect(f.trialPadraoDefinir).toHaveBeenCalledWith(14)
  })

  it('padrão inválido não chama o servidor', async () => {
    await abrirComoAdmin('/admin?aba=planos')
    const campo = await screen.findByLabelText('Dias de teste')
    await userEvent.clear(campo)
    await userEvent.type(campo, '400')
    await userEvent.click(screen.getByTestId('trial-padrao-salvar'))
    expect(f.trialPadraoDefinir).not.toHaveBeenCalled()
  })

  it('detalhe do clube em teste: +7/+15/+30 e data escolhida não pedem confirmação', async () => {
    f.clubeDetalhe.mockResolvedValue({ ...DETALHE, clube: { ...NOVO, trial_ate: '2026-10-10T12:00:00Z' } })
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    expect(await screen.findByTestId('teste-gratuito-situacao')).toHaveTextContent('Em teste até')
    await userEvent.click(screen.getByText('+15 dias'))
    expect(f.trialEstender).toHaveBeenLastCalledWith('c2', expect.objectContaining({ dias: 15 }))
    await userEvent.type(screen.getByLabelText('Ou escolha a data final'), '2026-11-30')
    await userEvent.click(screen.getByText('Definir data'))
    expect(f.trialEstender).toHaveBeenLastCalledWith('c2', expect.objectContaining({ ate: expect.stringMatching(/^2026-1[12]-/) }))
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('encerrar teste: botão vermelho + confirmação do app com clube, "Teste grátis (até data)" → Encerrado, impacto e motivo (Fase 6)', async () => {
    f.clubeDetalhe.mockResolvedValue({ ...DETALHE, clube: { ...NOVO, trial_ate: '2026-10-10T12:00:00Z' } })
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    const botao = await screen.findByTestId('trial-encerrar')
    expect(botao).toHaveClass('bg-rose-600')

    // recusou no modal: nada vai ao servidor
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(botao)
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.perigo).toBe(true)
    expect(pedido.titulo).toMatch(/Encerrar o teste/)
    expect(pedido.rotulo).toBe('Encerrar teste agora')
    expect(pedido.descricao).toContain('Clube: Exército da colina')
    expect(pedido.descricao).toMatch(/Teste grátis \(até 10\/10\/2026\) → nova: Encerrado/)
    expect(pedido.descricao).toContain('perde o acesso do teste')
    expect(pedido.descricao).toContain('licença')
    expect(pedido.descricao).toContain('Motivo (vai para a auditoria): teste gratuito encerrado pela administração')
    expect(f.trialEncerrar).not.toHaveBeenCalled()

    // confirmou: chama a RPC auditada com o mesmo motivo
    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(botao)
    expect(f.trialEncerrar).toHaveBeenCalledWith('c2', 'teste gratuito encerrado pela administração')
  })

  it('assinatura ativa: sem botões de teste', async () => {
    f.clubeDetalhe.mockResolvedValue({ ...DETALHE, clube: { ...NOVO, assinatura_status: 'ativa' } })
    await abrirComoAdmin()
    await abrirClubeNaAssinatura()
    await screen.findByTestId('teste-gratuito')
    expect(screen.queryByText('+7 dias')).toBeNull()
    expect(screen.queryByTestId('trial-encerrar')).toBeNull()
  })

  it('diasRestantes', () => {
    const agora = Date.parse('2026-09-25T12:00:00Z')
    expect(diasRestantes(null, agora)).toBeNull()
    expect(diasRestantes('2026-10-02T12:00:00Z', agora)).toBe(7)
    expect(diasRestantes('2026-09-24T12:00:00Z', agora)).toBe(-1)
  })
})

describe('Admin: Onboarding parado', () => {
  it('mostra há quantos dias está parado e em qual etapa, com destaque para mais de 7 dias', async () => {
    const dias = (n) => new Date(Date.now() - n * 86400000 - 3600000).toISOString()
    f.onboardingListar.mockResolvedValue([
      { id: 'o1', status: 'em_andamento', etapa: 'clube', etapas_concluidas: ['conta'], clube: 'Clube Recente', iniciado_em: dias(2), atualizado_em: dias(2) },
      { id: 'o2', status: 'em_andamento', etapa: 'dados_basicos', etapas_concluidas: ['conta'], clube: null, iniciado_em: dias(20), atualizado_em: dias(12) },
      { id: 'o3', status: 'concluido', etapa: 'concluido', etapas_concluidas: [], clube: 'Clube Pronto', iniciado_em: dias(30), atualizado_em: dias(30) },
    ])
    await abrirComoAdmin()
    await abrirAba(/Onboarding/)
    const itens = await screen.findAllByTestId('onboarding-item')
    expect(within(itens[0]).getByTestId('onboarding-parado')).toHaveTextContent('Parado há 12 dias na etapa “dados_basicos”')
    expect(within(itens[1]).getByTestId('onboarding-parado')).toHaveTextContent('Parado há 2 dias')
    expect(within(itens[2]).queryByTestId('onboarding-parado')).toBeNull()
    expect(screen.getByTestId('onboarding-parados')).toHaveTextContent('1 cadastro(s)')
  })

  it('diasParado', () => {
    const agora = Date.parse('2026-09-25T12:00:00Z')
    expect(diasParado(null, agora)).toBeNull()
    expect(diasParado('2026-09-17T11:00:00Z', agora)).toBe(8)
    expect(diasParado('2026-09-26T12:00:00Z', agora)).toBe(0)
  })
})

describe('formatarBytes', () => {
  it('formata em B/KB/MB/GB', () => {
    expect(formatarBytes(0)).toBe('0 B')
    expect(formatarBytes(2048)).toBe('2 KB')
    expect(formatarBytes(700 * 1048576)).toBe('700 MB')
    expect(formatarBytes(10 * 1024 ** 3)).toBe('10,0 GB')
  })
})

describe('Admin: Visão geral só com o que o servidor fornece (Fase 6, 5.3)', () => {
  it('KPIs só dos campos presentes no payload; nada de receita/MRR', async () => {
    f.visaoGeral.mockResolvedValue({ clubes_total: 5, clubes_ativos: 4, clubes_inativos: 1, provisionamentos_pendentes: 0, assinaturas_por_status: {} })
    await abrirComoAdmin()
    expect(await screen.findByTestId('visao-clubes')).toHaveTextContent('5')
    expect(screen.getByTestId('visao-ativos')).toHaveTextContent('4')
    expect(screen.getByTestId('visao-inativos')).toHaveTextContent('1')
    for (const t of ['visao-onboarding', 'visao-armazenamento', 'visao-planos', 'visao-eventos-admin', 'visao-eventos-assinatura']) {
      expect(screen.queryByTestId(t), t).toBeNull()
    }
    expect(document.body.textContent).not.toMatch(/MRR|receita|churn/i)
    expect(document.body.textContent).not.toMatch(/undefined|NaN/)
  })

  it('"Precisa da sua atenção" só lista o que está > 0', async () => {
    f.visaoGeral.mockResolvedValue({ clubes_total: 2, clubes_ativos: 2, clubes_inativos: 0, onboarding_em_andamento: 0,
      assinaturas_por_status: { inadimplente: 1, suspensa: 0, pagamento_pendente: 0 }, planos_total: 1, planos_publicos: 1,
      armazenamento_total_bytes: 0, clubes_proximos_do_limite: 0, clubes_no_limite: 0, provisionamentos_pendentes: 2,
      eventos_admin_7d: 0, eventos_assinatura_7d: 0 })
    await abrirComoAdmin()
    const painel = await screen.findByTestId('visao-atencao')
    expect(await within(painel).findByText('2 provisionamento(s) pendente(s)')).toBeInTheDocument()
    expect(within(painel).getByText('1 assinatura(s) com pagamento em atraso')).toBeInTheDocument()
    expect(within(painel).queryByText(/limite de armazenamento/)).toBeNull()
    expect(within(painel).queryByText(/perto do limite/)).toBeNull()
    expect(within(painel).queryByText(/suspensa/)).toBeNull()
    expect(within(painel).queryByText(/aguardando pagamento/)).toBeNull()
  })

  it('tudo zerado: "Tudo em dia"', async () => {
    f.clubesListar.mockResolvedValue([FUNDADOR])
    await abrirComoAdmin()
    const painel = await screen.findByTestId('visao-atencao')
    expect(await within(painel).findByText(/Tudo em dia/)).toBeInTheDocument()
  })
})

describe('Admin: Clubes — busca, chip de status e ordenação (tabela ≥ md)', () => {
  const ATIVA = { ...NOVO, club_id: 'c3', nome: 'Águias do Vale', slug: 'aguias', assinatura_id: 's3', assinatura_status: 'ativa', membros: 12 }
  beforeEach(() => {
    // ≥ md (tabela), mas < lg (menu ☰ continua sendo o caminho de navegação do teste)
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('768'), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    f.clubesListar.mockResolvedValue([FUNDADOR, NOVO, ATIVA])
  })
  afterEach(() => { delete window.matchMedia })

  // a 1ª célula tem o avatar (sigla em texto) + nome: lê só o nome (span em negrito)
  const nomesDasLinhas = () => screen.getAllByTestId('clube-item').map((tr) => within(tr).getAllByRole('cell')[0].querySelector('.font-bold').textContent)

  it('busca, chip de status e ordenação por coluna', async () => {
    await abrirComoAdmin()
    await abrirAba(/Clubes/)
    await screen.findByTestId('tabela')
    expect(screen.getAllByTestId('clube-item')).toHaveLength(3)

    const chips = screen.getByRole('group', { name: 'Status da assinatura' })
    await userEvent.click(within(chips).getByRole('button', { name: /Ativa/ }))
    expect(nomesDasLinhas()).toEqual([expect.stringContaining('Águias do Vale')])
    await userEvent.click(within(chips).getByRole('button', { name: /Sem assinatura/ }))
    expect(nomesDasLinhas()).toEqual([expect.stringContaining('Filhos da Conquista')])
    await userEvent.click(within(chips).getByRole('button', { name: /Todos/ }))

    await userEvent.type(screen.getByLabelText('Buscar clube'), 'aguias')
    expect(screen.getAllByTestId('clube-item')).toHaveLength(1)
    await userEvent.clear(screen.getByLabelText('Buscar clube'))

    const th = screen.getByRole('columnheader', { name: /Membros/ })
    await userEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'ascending')
    expect(nomesDasLinhas().map((n) => n.slice(0, 6))).toEqual(['Exérci', 'Águias', 'Filhos'])
    await userEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'descending')
    expect(nomesDasLinhas().map((n) => n.slice(0, 6))).toEqual(['Filhos', 'Águias', 'Exérci'])
  })
})
