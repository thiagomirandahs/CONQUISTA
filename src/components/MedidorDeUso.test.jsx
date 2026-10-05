import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

const enviarSinal = vi.fn()
vi.mock('../lib/metricas.js', async (orig) => ({ ...(await orig()), enviarSinal: (...a) => enviarSinal(...a) }))
vi.mock('../context/Auth.jsx', () => ({ useAuth: () => ({ session: { user: { id: 'u' } } }) }))
const { default: MedidorDeUso } = await import('./MedidorDeUso.jsx')

let ir
function Nav() { ir = useNavigate(); return null }
const r = (caminho) => render(<MemoryRouter initialEntries={[caminho]}><MedidorDeUso /><Nav /></MemoryRouter>)

beforeEach(() => { vi.useFakeTimers(); enviarSinal.mockReset(); vi.stubEnv('DEV', false) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('MedidorDeUso', () => {
  it('conta a página ao abrir e a cada troca de tela, e dá sinal de vida a cada minuto', () => {
    r('/inicio')
    expect(enviarSinal).toHaveBeenCalledWith({ pagina: true, logado: true })
    act(() => { ir('/jornada') })
    expect(enviarSinal).toHaveBeenCalledTimes(2)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(enviarSinal).toHaveBeenLastCalledWith({ logado: true })
  })
  it('não conta a administração', () => {
    r('/admin')
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(enviarSinal).not.toHaveBeenCalled()
  })
  it('em desenvolvimento não mede', () => {
    vi.stubEnv('DEV', true)
    r('/inicio')
    expect(enviarSinal).not.toHaveBeenCalled()
  })
})
