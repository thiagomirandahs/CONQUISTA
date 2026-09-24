// Achado F-S2 da revisão da fase 9.1: a data de nascimento completa de toda criança do clube era
// legível pela API por qualquer colega. A migration 86 tira `nascimento` do SELECT direto em
// profiles (um select('*') passa a dar "permission denied") e entrega a linha da PRÓPRIA pessoa pela
// RPC meu_perfil(). O Auth é quem carrega esse perfil: se ele continuasse no select('*'), ninguém
// mais conseguiria entrar no app depois da 86.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/pushNativo.js', () => ({ registrarPushNativo: () => {}, desassociarPushNativo: async () => {} }))
vi.mock('../lib/push.js', () => ({ sincronizarPush: async () => {}, desassociarPush: async () => {} }))
vi.mock('../lib/imagens.js', () => ({ definirUsuarioImagens: () => {} }))

const rpc = vi.fn()
const from = vi.fn()
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'eu' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: (...a) => rpc(...a),
    from: (...a) => from(...a),
  },
}))
const { AuthProvider, useAuth } = await import('./Auth.jsx')

function Mostra() {
  const { profile, perfilPronto } = useAuth()
  if (!perfilPronto) return <p>carregando</p>
  return <p data-testid="perfil">{profile ? `${profile.nome}|${profile.nascimento ?? 'sem-nascimento'}` : 'sem-perfil'}</p>
}
const montar = () => render(<AuthProvider><Mostra /></AuthProvider>)

// consulta "thenable" do supabase-js: cada método devolve ela mesma
function consulta(resultado) {
  const c = { chamadas: {} }
  for (const m of ['select', 'eq', 'maybeSingle', 'single']) c[m] = vi.fn((...a) => { c.chamadas[m] = a; return c })
  c.then = (res, rej) => Promise.resolve(resultado).then(res, rej)
  return c
}

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('Auth: o perfil da própria pessoa vem da RPC meu_perfil', () => {
  it('usa a RPC (com o nascimento) e NÃO lê a tabela profiles', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'eu', nome: 'Ana', nascimento: '2014-05-05' }], error: null })
    montar()
    expect(await screen.findByTestId('perfil')).toHaveTextContent('Ana|2014-05-05')
    expect(rpc).toHaveBeenCalledWith('meu_perfil')
    expect(from).not.toHaveBeenCalled()
  })

  it('RPC sem linha: a pessoa não tem perfil (sem spinner eterno)', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    montar()
    expect(await screen.findByTestId('perfil')).toHaveTextContent('sem-perfil')
  })

  it('banco anterior à 86 (RPC ausente): lê colunas EXPLÍCITAS, sem * e sem nascimento, e entra', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.meu_perfil' } })
    const q = consulta({ data: { id: 'eu', nome: 'Ana' }, error: null })
    from.mockReturnValue(q)
    montar()
    expect(await screen.findByTestId('perfil')).toHaveTextContent('Ana|sem-nascimento')
    expect(from).toHaveBeenCalledWith('profiles')
    const colunas = q.chamadas.select[0].split(',')
    expect(colunas).toContain('nome')
    expect(colunas).not.toContain('*')
    expect(colunas).not.toContain('nascimento')
    expect(q.chamadas.eq).toEqual(['id', 'eu'])
  })

  it('outro erro da RPC não cai no fallback (é rede/servidor: tenta de novo e desiste sem perfil)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'caiu' } })
    montar()
    // a nova tentativa espera 1,5 s de verdade (rede móvel soluça)
    expect(await screen.findByTestId('perfil', {}, { timeout: 4000 })).toHaveTextContent('sem-perfil')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(from).not.toHaveBeenCalled()
  }, 8000)
})
