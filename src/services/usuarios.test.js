import { describe, it, expect, vi, beforeEach } from 'vitest'

// papel/status/unidade_id são do VÍNCULO agora (organization_memberships), não de profiles — a
// coluna não é mais gravável direto (migration 34); estas funções passam a chamar vinculo_gerir.
let respostaRpc
const chamadas = []
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: (nome, args) => { chamadas.push([nome, args]); return Promise.resolve(respostaRpc) },
  },
}))

const { mudarCargo, mudarUnidade, definirAtivoUsuario } = await import('./usuarios.js')

beforeEach(() => {
  chamadas.length = 0
  respostaRpc = { data: { ok: true }, error: null }
})

describe('mudarCargo', () => {
  it('promove a cargo de liderança: chama vinculo_gerir com o papel e limpa a unidade', async () => {
    const r = await mudarCargo('u1', 'diretoria')
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_papel: 'diretoria', p_limpar_unidade: true }]])
    expect(r).toEqual({ limpouUnidade: true })
  })

  it('muda pra desbravador/conselheiro: NÃO limpa a unidade (continua na mesma)', async () => {
    const r = await mudarCargo('u1', 'conselheiro')
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_papel: 'conselheiro' }]])
    expect(r).toEqual({ limpouUnidade: false })
  })

  it('erro da RPC (ex.: instrutor tentando mexer em cargo de liderança) sobe como Error', async () => {
    respostaRpc = { data: null, error: { message: 'Sem permissão: só a diretoria muda cargo ou status de diretoria, instrutor ou tesoureiro.' } }
    await expect(mudarCargo('u1', 'diretoria')).rejects.toThrow('só a diretoria')
  })
})

describe('mudarUnidade', () => {
  it('define a unidade: chama vinculo_gerir com p_unidade_id', async () => {
    await mudarUnidade('u1', 'unidA')
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_unidade_id: 'unidA' }]])
  })

  it('limpa a unidade (id vazio/null): chama vinculo_gerir com p_limpar_unidade', async () => {
    await mudarUnidade('u1', null)
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_limpar_unidade: true }]])
    chamadas.length = 0
    await mudarUnidade('u1', '')
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_limpar_unidade: true }]])
  })
})

describe('definirAtivoUsuario', () => {
  it('ativa: chama vinculo_gerir com status ativo', async () => {
    const r = await definirAtivoUsuario('u1', true)
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_status: 'ativo' }]])
    expect(r).toEqual({ id: 'u1', status: 'ativo' })
  })

  it('desativa: chama vinculo_gerir com status inativo (vocabulário que a tela já usa)', async () => {
    const r = await definirAtivoUsuario('u1', false)
    expect(chamadas).toEqual([['vinculo_gerir', { p_user_id: 'u1', p_status: 'inativo' }]])
    expect(r).toEqual({ id: 'u1', status: 'inativo' })
  })

  it('sem permissão: sobe como Error (a RPC recusa, não fica em silêncio)', async () => {
    respostaRpc = { data: null, error: { message: 'Sem permissão (apenas diretoria/instrutor do clube desta pessoa).' } }
    await expect(definirAtivoUsuario('u1', false)).rejects.toThrow('Sem permissão')
  })
})
