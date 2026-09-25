// Onboarding de clube novo (fase 5): o ESTADO MORA NO SERVIDOR. A tela nunca decide em que etapa
// está — ela pergunta. Quem fecha na etapa 4 e volta depois continua dali, e repetir uma etapa é
// seguro porque o servidor é idempotente.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const recarregar = vi.fn()
vi.mock('../context/Clube.jsx', () => ({ useClube: () => ({ recarregar }) }))
const carregarOnboarding = vi.fn()
const iniciarOnboarding = vi.fn()
const salvarEtapaOnboarding = vi.fn()
vi.mock('../services/comercial.js', async () => {
  const real = await vi.importActual('../services/comercial.js')
  return {
    ...real,
    carregarOnboarding: (...a) => carregarOnboarding(...a),
    iniciarOnboarding: (...a) => iniciarOnboarding(...a),
    salvarEtapaOnboarding: (...a) => salvarEtapaOnboarding(...a),
  }
})
const { default: Onboarding } = await import('./Onboarding.jsx')

const PLANOS = [{ chave: 'essencial', nome: 'Essencial', precos: [{ ciclo: 'mensal', moeda: 'BRL', valor_centavos: 4900 }, { ciclo: 'anual', moeda: 'BRL', valor_centavos: 49000 }] }]
const sessao = (etapa, concluidas = []) => ({
  tem_sessao: true, id: 's1', status: 'em_andamento', etapa,
  etapas_concluidas: concluidas, planos: PLANOS, dados: {},
})

const renderT = () => render(<MemoryRouter><Onboarding /></MemoryRouter>)

beforeEach(() => {
  carregarOnboarding.mockReset(); recarregar.mockReset().mockResolvedValue()
  iniciarOnboarding.mockReset().mockResolvedValue({})
  salvarEtapaOnboarding.mockReset().mockResolvedValue({})
})

describe('Onboarding', () => {
  it('sem cadastro em andamento, oferece começar', async () => {
    carregarOnboarding.mockResolvedValue({ tem_sessao: false, concluido: false, planos: PLANOS })
    renderT()
    const botao = await screen.findByRole('button', { name: 'Começar' })
    await userEvent.click(botao)
    expect(iniciarOnboarding).toHaveBeenCalled()
  })

  it('quem JÁ CONCLUIU não reencontra o "começar" (evita abrir um segundo clube sem querer)', async () => {
    carregarOnboarding.mockResolvedValue({ tem_sessao: false, concluido: true, club_id: 'c1', planos: PLANOS })
    renderT()
    expect(await screen.findByTestId('concluido')).toHaveTextContent(/Seu clube está pronto/)
    expect(screen.getByRole('button', { name: 'Entrar no clube' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Começar' })).not.toBeInTheDocument()
    // abrir outro clube continua possível, mas como ato explícito
    expect(screen.getByRole('button', { name: /Preciso criar outro clube/ })).toBeInTheDocument()
  })

  it('"Entrar no clube" RECARREGA o contexto antes de navegar (fase 9: sem isso, a 1ª tela dizia "sem clube")', async () => {
    carregarOnboarding.mockResolvedValue({ tem_sessao: false, concluido: true, club_id: 'c1', planos: PLANOS })
    const ordem = []
    recarregar.mockImplementation(async () => { ordem.push('recarregou') })
    // um COMPONENTE (e não uma expressão no JSX da rota): só roda quando a rota é de fato desenhada
    function Inicio() { if (!ordem.includes('chegou em /')) ordem.push('chegou em /'); return <p>inicio</p> }
    render(<MemoryRouter initialEntries={['/criar-clube']}><Routes>
      <Route path="/criar-clube" element={<Onboarding />} />
      <Route path="/" element={<Inicio />} />
    </Routes></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar no clube' }))
    expect(await screen.findByText('inicio')).toBeInTheDocument()
    expect(ordem).toEqual(['recarregou', 'chegou em /'])
  })

  it('RETOMA exatamente na etapa que o servidor diz (fechou na 4, volta na 4)', async () => {
    carregarOnboarding.mockResolvedValue(sessao('identidade', ['conta', 'dados_basicos', 'clube']))
    renderT()
    expect(await screen.findByRole('heading', { name: /Identidade visual/ })).toBeInTheDocument()
    // a tela não "adivinha" a etapa: as anteriores aparecem como concluídas
    expect(screen.getByText(/✓ Sua conta/)).toBeInTheDocument()
    expect(screen.getByText(/✓ O clube/)).toBeInTheDocument()
  })

  it('envia a etapa pelo nome que o servidor usa, com os dados do formulário', async () => {
    carregarOnboarding.mockResolvedValue(sessao('conta'))
    renderT()
    await userEvent.type(await screen.findByLabelText(/Nome do responsável/), 'Cliente Um')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(salvarEtapaOnboarding).toHaveBeenCalledWith('conta', { nome: 'Cliente Um', email: '' })
  })

  it('a etapa do clube mostra o preço vindo do catálogo e avisa que é provisório', async () => {
    carregarOnboarding.mockResolvedValue(sessao('clube', ['conta', 'dados_basicos']))
    renderT()
    expect(await screen.findByLabelText(/Nome do clube/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Essencial — R\$\s?49,00\/mês/ })).toBeInTheDocument()
    expect(screen.getByText(/Valores provisórios: nada será cobrado/)).toBeInTheDocument()
  })

  it('a etapa do clube envia ciclo=mensal por padrão, e Anual muda o preço e o que é enviado', async () => {
    carregarOnboarding.mockResolvedValue(sessao('clube', ['conta', 'dados_basicos']))
    renderT()
    await userEvent.type(await screen.findByLabelText(/Nome do clube/), 'Meu Clube')
    expect(screen.getByText('R$ 49,00 por mês')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Anual' }))
    expect(screen.getByText('R$ 490,00 por ano')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Criar o clube' }))
    expect(salvarEtapaOnboarding).toHaveBeenCalledWith('clube', { nome: 'Meu Clube', plano: 'essencial', ciclo: 'anual' })
  })

  it('plano e ciclo vindos de /adquirir?plano=...&ciclo=... pré-preenchem a etapa (item 7)', async () => {
    carregarOnboarding.mockResolvedValue(sessao('clube', ['conta', 'dados_basicos']))
    render(<MemoryRouter initialEntries={['/criar-clube?plano=essencial&ciclo=anual']}>
      <Routes><Route path="/criar-clube" element={<Onboarding />} /></Routes>
    </MemoryRouter>)
    await screen.findByLabelText(/Nome do clube/)
    expect(screen.getByRole('button', { name: 'Anual', pressed: true })).toBeInTheDocument()
  })

  it('erro do servidor (ex.: tentativa de pular etapa) aparece pro usuário', async () => {
    carregarOnboarding.mockResolvedValue(sessao('conta'))
    salvarEtapaOnboarding.mockRejectedValue(new Error('Termine a etapa "conta" antes de ir para "clube".'))
    renderT()
    await userEvent.type(await screen.findByLabelText(/Nome do responsável/), 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Termine a etapa/)
  })

  it('a etapa da equipe transforma a lista de e-mails em array antes de enviar', async () => {
    carregarOnboarding.mockResolvedValue(sessao('equipe', ['conta', 'dados_basicos', 'clube', 'identidade', 'diretor', 'configuracao', 'recursos']))
    renderT()
    await userEvent.type(await screen.findByLabelText(/E-mails separados/), 'a@x.com, b@x.com')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(salvarEtapaOnboarding).toHaveBeenCalledWith('equipe', { emails: ['a@x.com', 'b@x.com'], papel: 'instrutor' })
  })
})
