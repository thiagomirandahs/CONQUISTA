import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.mock('./supabase.js', () => ({ definirRedeComoNoTransporte: () => {} }))
const { lembrarOrigemDaRede, destinoDeSaidaDaRede } = await import('./redeModo.js')

beforeEach(() => { try { sessionStorage.clear() } catch { /* */ } })

describe('voltar da Rede DBV', () => {
  it('volta para a tela do app de onde a pessoa veio (com a busca da URL)', () => {
    lembrarOrigemDaRede('/meu-clube')
    expect(destinoDeSaidaDaRede(false)).toBe('/meu-clube')
    lembrarOrigemDaRede('/gestao/inscricoes?aba=pendentes')
    expect(destinoDeSaidaDaRede(false)).toBe('/gestao/inscricoes?aba=pendentes')
  })
  it('sem origem, ou origem inválida/de fora do app: Início', () => {
    expect(destinoDeSaidaDaRede(false)).toBe('/inicio')
    for (const ruim of ['/rede/perfil', '//evil.com', 'https://x.com', '/login', '/cadastro?x=1', '/', '/a b']) lembrarOrigemDaRede(ruim)
    expect(destinoDeSaidaDaRede(false)).toBe('/inicio')
  })
  it('coordenação sempre volta ao portal', () => {
    lembrarOrigemDaRede('/meu-clube')
    expect(destinoDeSaidaDaRede(true)).toBe('/institucional')
  })
})
