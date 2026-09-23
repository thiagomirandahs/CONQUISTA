// Onboarding de clube novo (fase 5): o ESTADO MORA NO SERVIDOR. A tela nunca decide em que etapa
// está — ela pergunta. Quem fecha na etapa 4 e volta depois continua dali, e repetir uma etapa é
// seguro porque o servidor é idempotente.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

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

const PLANOS = [{ chave: 'essencial', nome: 'Essencial', precos: [{ ciclo: 'mensal', moeda: 'BRL', valor_centavos: 4900 }] }]
const sessao = (etapa, concluidas = []) => ({
  tem_sessao: true, id: 's1', status: 'em_andamento', etapa,
  etapas_concluidas: concluidas, planos: PLANOS, dados: {},
})

const renderT = () => render(<MemoryRouter><Onboarding /></MemoryRouter>)

beforeEach(() => {
  carregarOnboarding.mockReset()
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
    expect(screen.getByRole('link', { name: 'Entrar no clube' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Começar' })).not.toBeInTheDocument()
    // abrir outro clube continua possível, mas como ato explícito
    expect(screen.getByRole('button', { name: /Preciso criar outro clube/ })).toBeInTheDocument()
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
