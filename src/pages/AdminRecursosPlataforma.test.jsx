import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
vi.mock('../ui/avisos.jsx', () => ({ avisar: { sucesso: vi.fn(), erro: vi.fn() } }))
const { default: Recursos } = await import('./AdminRecursosPlataforma.jsx')

describe('Admin: recursos liberados pela plataforma', () => {
  beforeEach(() => { rpc.mockReset().mockResolvedValue({ error: null }); vi.spyOn(window, 'confirm').mockReturnValue(true) })

  it('mostra Comunidade e Especialidades com o estado do clube', () => {
    render(<Recursos clubId="c1" recursos={[{ recurso: 'comunidade', ligado: true }]} />)
    expect(screen.getByTestId('recurso-comunidade')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('recurso-especialidades')).toHaveAttribute('aria-checked', 'false')
  })

  it('liberar chama o servidor com o clube certo, depois de confirmar', async () => {
    const onFeito = vi.fn()
    render(<Recursos clubId="c1" recursos={[]} onFeito={onFeito} />)
    await userEvent.click(screen.getByTestId('recurso-comunidade'))
    expect(rpc).toHaveBeenCalledWith('admin_recurso_do_clube_definir', { p_club_id: 'c1', p_feature: 'comunidade', p_enabled: true })
    expect(onFeito).toHaveBeenCalled()
  })
})
