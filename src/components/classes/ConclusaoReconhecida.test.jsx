import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const carregar = vi.fn()
vi.mock('../../services/classes.js', () => ({ carregarConclusaoReconhecida: (...a) => carregar(...a) }))
const { default: ConclusaoReconhecida } = await import('./ConclusaoReconhecida.jsx')

describe('ConclusaoReconhecida (525)', () => {
  it('mostra o texto de proveniência montado pelo servidor', async () => {
    carregar.mockResolvedValueOnce({ reconhecida: true, texto: 'Conclusão já reconhecida (registro anterior em Clube B, 10/05/2020)' })
    render(<ConclusaoReconhecida memberClassId="m1" />)
    expect(await screen.findByTestId('conclusao-reconhecida')).toHaveTextContent('registro anterior em Clube B')
  })
  it('sem reconhecimento, sem 525 (erro/null) ou inativo: não mostra nada e não quebra', async () => {
    carregar.mockResolvedValueOnce({ reconhecida: false })
    const a = render(<ConclusaoReconhecida memberClassId="m1" />)
    await new Promise((r) => setTimeout(r, 10)); expect(a.container.textContent).toBe(''); a.unmount()
    carregar.mockRejectedValueOnce(new Error('RPC inexistente'))
    const b = render(<ConclusaoReconhecida memberClassId="m1" />)
    await new Promise((r) => setTimeout(r, 10)); expect(b.container.textContent).toBe(''); b.unmount()
    carregar.mockClear()
    const c = render(<ConclusaoReconhecida memberClassId="m1" ativo={false} />)
    await new Promise((r) => setTimeout(r, 10)); expect(c.container.textContent).toBe(''); expect(carregar).not.toHaveBeenCalled()
  })
})
