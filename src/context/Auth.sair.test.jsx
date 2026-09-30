// Privacidade: rascunhos de relatório (de criança) não ficam no aparelho depois de sair da conta.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('../lib/pushNativo.js', () => ({ registrarPushNativo: () => {}, desassociarPushNativo: async () => {} }))
vi.mock('../lib/push.js', () => ({ sincronizarPush: async () => {}, desassociarPush: async () => {} }))
vi.mock('../lib/imagens.js', () => ({ definirUsuarioImagens: () => {} }))
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'eu' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({}),
    },
    rpc: async () => ({ data: [{ id: 'eu', nome: 'Ana' }], error: null }),
    from: vi.fn(),
  },
}))
const { AuthProvider, useAuth } = await import('./Auth.jsx')

let api
function Captura() { api = useAuth(); return api.perfilPronto ? <p data-testid="ok">ok</p> : null }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('cq.rel.eu.classe.r1', '{"v":1,"conteudo":{"a":"texto da criança"},"anexos":[],"base":"x","editadoEm":1,"sincronizado":false}')
  localStorage.setItem('cq.rel.eu.classe.r1.backup', '{"v":1,"conteudo":{},"anexos":[]}')
  localStorage.setItem('outra.coisa', 'fica')
})

describe('Auth: sair limpa os rascunhos locais do relatório', () => {
  it('sair()', async () => {
    render(<AuthProvider><Captura /></AuthProvider>)
    await screen.findByTestId('ok')
    await act(async () => { await api.sair() })
    expect(Object.keys(localStorage).filter((k) => k.startsWith('cq.rel.'))).toEqual([])
    expect(localStorage.getItem('outra.coisa')).toBe('fica')
  })
  it('sairSemRede()', async () => {
    render(<AuthProvider><Captura /></AuthProvider>)
    await screen.findByTestId('ok')
    await act(async () => { await api.sairSemRede() })
    expect(Object.keys(localStorage).filter((k) => k.startsWith('cq.rel.'))).toEqual([])
  })
})
