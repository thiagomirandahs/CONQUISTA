import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const metricas = vi.fn()
vi.mock('../../services/metricas.js', () => ({ metricasDeUso: (...a) => metricas(...a) }))
const { default: PainelDeUso } = await import('./PainelDeUso.jsx')

const DADOS = {
  agora: { site: 3, app: 5, apk: 7, app_logados: 9, total: 15 },
  visitas: {
    hoje: { site: { visitantes: 40, paginas: 90 }, app: { sessoes: 60, paginas: 300 } },
    d7: { site: { visitantes: 200, paginas: 500 }, app: { sessoes: 350, paginas: 900 } },
    d30: { site: { visitantes: 1200, paginas: 3000 }, app: { sessoes: 1500, paginas: 4000 } },
  },
  serie: Array.from({ length: 14 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, '0')}`, site: i, app: i * 2 })),
}
beforeEach(() => { metricas.mockReset() })

describe('PainelDeUso', () => {
  it('mostra quem está no app/site agora (APK + navegador somados) e as visitas de hoje, 7 e 30 dias', async () => {
    metricas.mockResolvedValue(DADOS)
    render(<PainelDeUso />)
    expect(await screen.findByTestId('uso-app-agora')).toHaveTextContent('12')
    expect(screen.getByTestId('painel-uso')).toHaveTextContent('7 no APK · 5 no navegador · 9 logado(s)')
    expect(screen.getByTestId('uso-site-agora')).toHaveTextContent('3')
    expect(screen.getByTestId('uso-site-hoje')).toHaveTextContent('40')
    expect(screen.getByTestId('painel-uso')).toHaveTextContent('200 em 7 dias · 1.200 em 30 dias')
    expect(screen.getByTestId('uso-app-hoje')).toHaveTextContent('60')
    expect(screen.getByTestId('uso-grafico')).toBeInTheDocument()
  })
  it('falha: aviso com "Tentar de novo" (nunca zeros falsos); tentar de novo carrega', async () => {
    metricas.mockRejectedValueOnce(new Error('offline'))
    metricas.mockResolvedValueOnce(DADOS)
    render(<PainelDeUso />)
    expect(await screen.findByText(/Não consegui carregar as métricas/)).toBeInTheDocument()
    expect(screen.queryByTestId('uso-app-agora')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByTestId('uso-app-agora')).toHaveTextContent('12')
  })
})
