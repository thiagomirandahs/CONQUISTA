// Plano do clube (fase 5): preço e composição vêm do CATÁLOGO DO BANCO — nada escrito no React.
// A tela informa, avisa que os valores são provisórios e deixa claro que trocar de plano não é ato
// da diretoria. Suspensão nunca é anunciada como perda de dados.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const carregarPlanos = vi.fn()
const carregarAssinaturaDoClube = vi.fn()
vi.mock('../services/comercial.js', async () => {
  const real = await vi.importActual('../services/comercial.js')
  return {
    ...real,
    carregarPlanos: (...a) => carregarPlanos(...a),
    carregarAssinaturaDoClube: (...a) => carregarAssinaturaDoClube(...a),
  }
})
const { default: Planos } = await import('./Planos.jsx')

const CATALOGO = [
  {
    chave: 'essencial', versao: 1, nome: 'Essencial', descricao: 'O dia a dia do clube', provisorio: true,
    recursos: ['agenda', 'mural', 'jogos'], limites: { membros: 80 },
    precos: [{ ciclo: 'mensal', moeda: 'BRL', valor_centavos: 4900, provisorio: true }],
  },
  {
    chave: 'completo', versao: 1, nome: 'Completo', descricao: 'Tudo', provisorio: true,
    recursos: null, limites: {}, precos: [{ ciclo: 'mensal', moeda: 'BRL', valor_centavos: 9900, provisorio: true }],
  },
]
const ASSINATURA = {
  tem_assinatura: true, status: 'trial',
  plano: { chave: 'essencial', versao: 1, nome: 'Essencial', provisorio: true },
  limites: {
    membros: { limite: 80, uso: 12, medicao: 'ok' },
    armazenamento_mb: { limite: 2048, uso: null, medicao: 'pendente' },
  },
  pode_mudar_plano: false,
}

const renderT = () => render(<MemoryRouter><Planos /></MemoryRouter>)

beforeEach(() => {
  carregarPlanos.mockReset().mockResolvedValue(CATALOGO)
  carregarAssinaturaDoClube.mockReset().mockResolvedValue(ASSINATURA)
})

describe('Planos', () => {
  it('mostra o preço que veio do banco, formatado — e nenhum valor fixo de tela', async () => {
    renderT()
    expect(await screen.findByText(/Inclui: Agenda/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s?49,00/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s?99,00/)).toBeInTheDocument()
  })

  it('avisa que os valores são provisórios e que nada está sendo cobrado', async () => {
    renderT()
    expect(await screen.findByText(/Valores provisórios/)).toBeInTheDocument()
    expect(screen.getByText(/Nada está sendo cobrado/)).toBeInTheDocument()
  })

  it('lista a composição do plano a partir dos recursos do catálogo (null = todos)', async () => {
    renderT()
    expect(await screen.findByText(/Inclui: Agenda, Mural de fotos, Jogos\./)).toBeInTheDocument()
    expect(screen.getByText(/Inclui todos os recursos do DesbravaClube\./)).toBeInTheDocument()
  })

  it('mostra o uso do plano e diz quando a plataforma ainda não mede um limite', async () => {
    renderT()
    expect(await screen.findByText('Membros')).toBeInTheDocument()
    expect(screen.getByText('12 / 80')).toBeInTheDocument()
    expect(screen.getByText('Armazenamento (MB)').parentElement).toHaveTextContent('—')
  })

  it('deixa claro que trocar de plano não é ato da diretoria, e que nada é apagado', async () => {
    renderT()
    await screen.findByText('Membros')
    expect(screen.getByText(/A troca de plano não é feita por aqui/)).toBeInTheDocument()
    expect(screen.getByText(/Nenhuma\s+mudança de plano apaga dados/)).toBeInTheDocument()
  })

  it('suspensa: explica que a criação parou, NUNCA que os dados sumiram', async () => {
    carregarAssinaturaDoClube.mockResolvedValue({ ...ASSINATURA, status: 'suspensa' })
    renderT()
    expect(await screen.findByText('Suspensa')).toBeInTheDocument()
    expect(screen.getByText(/Nada foi apagado/)).toBeInTheDocument()
  })

  it('clube sem assinatura (Tenant 001): diz que nenhum limite comercial se aplica', async () => {
    carregarAssinaturaDoClube.mockResolvedValue({ tem_assinatura: false })
    renderT()
    expect(await screen.findByTestId('sem-assinatura')).toHaveTextContent(/nenhum limite comercial se aplica/i)
  })
})
