// Painel do coordenador ("Como estão meus clubes"): simples para idosos no celular, só agregados,
// período em botões, relatórios de um toque e ajuda pelo WhatsApp sempre visível.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { gerarCSV, gerarTextoWhatsApp, gerarHTMLImpressao, linkAjudaWhatsApp } from '../lib/relatorioCoordenador.js'

let escopo
vi.mock('../context/Escopo.jsx', () => ({ useEscopo: () => escopo }))
const carregarResumo = vi.fn()
const carregarInvestiduras = vi.fn()
vi.mock('../services/institucional.js', () => ({
  carregarResumoCoordenador: (...a) => carregarResumo(...a),
  carregarInvestidurasDoEscopo: (...a) => carregarInvestiduras(...a),
}))
const { default: PainelCoordenador } = await import('./PainelCoordenador.jsx')

const CAP = { ver_painel: true }
const ESC = { escopo_id: 'e1', nome: 'Distrito Norte', tipo: 'distrito', papel: 'coordenador_distrital', capacidades: CAP }
const ATIVO = {
  club_id: 'c1', nome: 'Clube Águia', desbravadores_em_classe: 12, requisitos_total: 200, requisitos_aprovados: 90,
  requisitos_pct: 45, aprovados_no_periodo: 8, ultimo_avanco: '2026-09-27', dias_sem_avancar: 1, parado: false,
  visitas_ano: 2, visitas_periodo: 1, ultima_visita: '2026-09-10', proxima_visita: '2026-10-05',
}
const PARADO = {
  club_id: 'c2', nome: 'Clube Leão; "Sul"', desbravadores_em_classe: 3, requisitos_total: 40, requisitos_aprovados: 4,
  requisitos_pct: 10, aprovados_no_periodo: 0, ultimo_avanco: '2026-08-01', dias_sem_avancar: 58, parado: true,
  visitas_ano: 0, visitas_periodo: 0, ultima_visita: null, proxima_visita: null,
}
const RESUMO = {
  periodo: 'mes', desde: '2026-09-01', hoje: '2026-09-28', escopo: { id: 'e1', nome: 'Distrito Norte', tipo: 'distrito' },
  clubes: [ATIVO, PARADO],
  totais: { clubes: 2, desbravadores_em_classe: 15, requisitos_pct: 39, aprovados_no_periodo: 8, clubes_parados: 1,
            visitados_ano: 1, faltando_visitar_ano: 1, visitas_periodo: 1 },
}
const renderT = () => render(<MemoryRouter><PainelCoordenador /></MemoryRouter>)

beforeEach(() => {
  escopo = { carregando: false, erro: null, escopos: [ESC], escopo: ESC, temEscopo: true, capacidades: CAP, trocarEscopo: vi.fn() }
  carregarResumo.mockReset().mockResolvedValue(RESUMO)
  carregarInvestiduras.mockReset().mockResolvedValue([])
})

describe('PainelCoordenador', () => {
  it('título simples e no máximo 3 botões principais (Meus clubes, Aprovações, Visitas)', async () => {
    renderT()
    expect(await screen.findByRole('heading', { name: 'Como estão meus clubes' })).toBeInTheDocument()
    const nav = screen.getByTestId('botoes-principais')
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links.map((l) => l.textContent)).toEqual([expect.stringMatching(/Meus clubes/), expect.stringMatching(/Aprovações/), expect.stringMatching(/Visitas/)])
    links.forEach((l) => expect(l.className).toMatch(/min-h-\[56px\]/))
    expect(links[0]).toHaveAttribute('href', '/institucional/detalhes?aba=clubes')
  })

  it('cartão por clube com frases simples: fazendo classe, % aprovados, último avanço e visitas', async () => {
    renderT()
    const [c1] = await screen.findAllByTestId('cartao-clube')
    expect(within(c1).getByText('Clube Águia')).toBeInTheDocument()
    expect(c1).toHaveTextContent('12 desbravadores fazendo classe')
    expect(c1).toHaveTextContent('45% dos requisitos aprovados')
    expect(c1).toHaveTextContent('Avançou ontem (27/09/2026)')
    expect(c1).toHaveTextContent('Visitado 2 vezes este ano — última em 10/09/2026')
    expect(screen.getByTestId('visitas-ano')).toHaveTextContent('1 visitados, 1 faltando')
  })

  it('destaca clube parado há mais de 30 dias', async () => {
    renderT()
    expect(await screen.findByText(/⚠️ Clube Leão; "Sul" não avança há 58 dias/)).toBeInTheDocument()
    expect(screen.queryByText(/Clube Águia não avança/)).not.toBeInTheDocument()
  })

  it('filtro de período em botões grandes recarrega com o período', async () => {
    renderT()
    await screen.findAllByTestId('cartao-clube')
    expect(carregarResumo).toHaveBeenLastCalledWith('mes')
    const tri = screen.getByRole('button', { name: 'Este trimestre' })
    expect(tri.className).toMatch(/min-h-\[56px\]/)
    await userEvent.click(tri)
    expect(carregarResumo).toHaveBeenLastCalledWith('trimestre')
    await userEvent.click(screen.getByRole('button', { name: 'Este ano' }))
    expect(carregarResumo).toHaveBeenLastCalledWith('ano')
    expect(screen.getByRole('button', { name: 'Este ano' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('botão fixo "Preciso de ajuda" abre o WhatsApp do suporte', async () => {
    renderT()
    const ajuda = await screen.findByTestId('preciso-de-ajuda')
    expect(ajuda.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5581989499469\?text=/)
    expect(ajuda.className).toMatch(/fixed/)
  })

  it('resumo para WhatsApp: usa o compartilhar do celular; sem ele, copia', async () => {
    const share = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    renderT()
    await userEvent.click(await screen.findByRole('button', { name: /Resumo para o WhatsApp/ }))
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining('Como estão meus clubes — Distrito Norte') })
    delete navigator.share
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await userEvent.click(screen.getByRole('button', { name: /Resumo para o WhatsApp/ }))
    expect(writeText).toHaveBeenCalled()
    expect(await screen.findByText(/Resumo copiado/)).toBeInTheDocument()
  })

  it('sem capacidade de painel: não pede números', async () => {
    escopo = { ...escopo, capacidades: { ver_painel: false } }
    renderT()
    expect(await screen.findByText(/não inclui os números dos clubes/)).toBeInTheDocument()
    expect(carregarResumo).not.toHaveBeenCalled()
  })

  it('sem vínculo institucional: volta para o clube', async () => {
    escopo = { ...escopo, temEscopo: false, escopo: null, escopos: [] }
    renderT()
    expect(await screen.findByText('Sem vínculo institucional')).toBeInTheDocument()
  })

  it('nada de dado pessoal nem comercial na tela', async () => {
    renderT()
    await screen.findAllByTestId('cartao-clube')
    expect(document.body.textContent).not.toMatch(/assinatura|plano|trial|mensalidade|telefone|e-mail/i)
  })
})

describe('relatórios do coordenador', () => {
  it('CSV: BOM UTF-8, ponto e vírgula, aspas escapadas', () => {
    const csv = gerarCSV(RESUMO)
    expect(csv.startsWith('﻿')).toBe(true)
    const linhas = csv.slice(1).trim().split('\r\n')
    expect(linhas).toHaveLength(3)
    expect(linhas[0].split(';')[0]).toBe('Clube')
    expect(linhas[1]).toBe('Clube Águia;12;45;8;27/09/2026;1;Não;2;1;10/09/2026;05/10/2026')
    expect(linhas[2].startsWith('"Clube Leão; ""Sul""";3;10;0;01/08/2026;58;Sim;0')).toBe(true)
  })

  it('texto do WhatsApp: totais, atenção e por clube', () => {
    const txt = gerarTextoWhatsApp(RESUMO)
    expect(txt).toContain('Este mês (desde 01/09/2026)')
    expect(txt).toContain('Visitas do ano: 1 visitados, 1 faltando')
    expect(txt).toContain('• Clube Leão; "Sul": não avança há 58 dias')
    expect(txt).toContain('• Clube Águia: 12 fazendo classe, 45% aprovados')
  })

  it('página imprimível escapa HTML do nome do clube', () => {
    const html = gerarHTMLImpressao({ ...RESUMO, clubes: [{ ...ATIVO, nome: '<script>x</script>' }] })
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('link de ajuda leva o nome da coordenação', () => {
    expect(decodeURIComponent(linkAjudaWhatsApp('Distrito Norte'))).toContain('(Distrito Norte)')
  })
})
