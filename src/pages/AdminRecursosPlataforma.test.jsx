import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
// Fase 6: ligar/desligar passa pelo modal do app (avisar.confirmar), nunca por window.confirm.
const confirmar = vi.fn()
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn(), confirmar: (...a) => confirmar(...a) } }))
const { default: Recursos } = await import('./AdminRecursosPlataforma.jsx')

describe('Admin: recursos liberados pela plataforma', () => {
  beforeEach(() => { rpc.mockReset().mockResolvedValue({ error: null }); confirmar.mockReset().mockResolvedValue(true) })

  it('mostra Comunidade e Especialidades com o estado do clube', () => {
    render(<Recursos clubId="c1" recursos={[{ recurso: 'comunidade', ligado: true }]} />)
    expect(screen.getByTestId('recurso-comunidade')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('recurso-especialidades')).toHaveAttribute('aria-checked', 'false')
  })

  it('liberar: confirmação neutra com clube, Desligado → Liberado e impacto; confirmou → chama o servidor', async () => {
    const onFeito = vi.fn()
    render(<Recursos clubId="c1" clube="Exército da colina" recursos={[]} onFeito={onFeito} />)
    await userEvent.click(screen.getByTestId('recurso-comunidade'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.titulo).toContain('Liberar "Comunidade"')
    expect(pedido.perigo).toBe(false)
    expect(pedido.descricao).toContain('Clube: Exército da colina')
    expect(pedido.descricao).toContain('Situação atual: Desligado → nova: Liberado')
    expect(pedido.descricao).toContain('passa a ver e usar Comunidade')
    expect(rpc).toHaveBeenCalledWith('admin_recurso_do_clube_definir', { p_club_id: 'c1', p_feature: 'comunidade', p_enabled: true })
    expect(onFeito).toHaveBeenCalled()
  })

  it('desligar: confirmação de perigo com Liberado → Desligado e "nada é apagado"; recusou → servidor não é chamado', async () => {
    render(<Recursos clubId="c1" clube="Exército da colina" recursos={[{ recurso: 'comunidade', ligado: true }]} />)
    confirmar.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByTestId('recurso-comunidade'))
    expect(confirmar).toHaveBeenCalledTimes(1)
    const pedido = confirmar.mock.calls[0][0]
    expect(pedido.titulo).toContain('Desligar "Comunidade"')
    expect(pedido.perigo).toBe(true)
    expect(pedido.rotulo).toBe('Desligar Comunidade')
    expect(pedido.descricao).toContain('Clube: Exército da colina')
    expect(pedido.descricao).toContain('Situação atual: Liberado → nova: Desligado')
    expect(pedido.descricao).toContain('Nada é apagado')
    expect(rpc).not.toHaveBeenCalled()

    confirmar.mockResolvedValueOnce(true)
    await userEvent.click(screen.getByTestId('recurso-comunidade'))
    expect(rpc).toHaveBeenCalledWith('admin_recurso_do_clube_definir', { p_club_id: 'c1', p_feature: 'comunidade', p_enabled: false })
  })
})
