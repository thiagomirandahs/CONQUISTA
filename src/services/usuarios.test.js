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

const { mudarCargo, mudarUnidade, inativarMembro, reativarMembro, historicoDoMembro, listarInativos } = await import('./usuarios.js')
const { MOTIVOS_INATIVACAO, ROTULO_MOTIVO } = await import('../lib/motivosInativacao.js')

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

describe('inativar / reativar com motivo (migration 310)', () => {
  it('desativa: chama vinculo_inativar com a categoria e o texto', async () => {
    const r = await inativarMembro('u1', { categoria: 'outro', texto: '  mudou de escola  ' })
    expect(chamadas).toEqual([['vinculo_inativar', { p_user_id: 'u1', p_motivo_categoria: 'outro', p_motivo_texto: 'mudou de escola', p_acao: 'inativado' }]])
    expect(r).toEqual({ id: 'u1', status: 'inativo' })
  })

  it('reativa sem motivo: categoria e texto nulos', async () => {
    await reativarMembro('u1')
    expect(chamadas).toEqual([['vinculo_reativar', { p_user_id: 'u1', p_motivo_categoria: null, p_motivo_texto: null }]])
  })

  it('reativa com texto: vira "voltou ao clube"', async () => {
    await reativarMembro('u1', { texto: 'voltou' })
    expect(chamadas).toEqual([['vinculo_reativar', { p_user_id: 'u1', p_motivo_categoria: 'voltou_ao_clube', p_motivo_texto: 'voltou' }]])
  })

  it('histórico e inativos chamam as RPCs da diretoria', async () => {
    respostaRpc = { data: [{ acao: 'inativado' }], error: null }
    expect(await historicoDoMembro('u1')).toEqual([{ acao: 'inativado' }])
    expect(await listarInativos()).toEqual([{ acao: 'inativado' }])
    expect(chamadas).toEqual([['vinculo_historico_listar', { p_user_id: 'u1' }], ['membros_inativos', undefined]])
  })

  it('sem permissão: sobe como Error (a RPC recusa, não fica em silêncio)', async () => {
    respostaRpc = { data: null, error: { message: 'Sem permissão (apenas a diretoria deste clube).' } }
    await expect(inativarMembro('u1', { categoria: 'faltas' })).rejects.toThrow('Sem permissão')
  })

  it('a lista de motivos tem "outro" e rótulo para o que vem da rotina', () => {
    expect(MOTIVOS_INATIVACAO.map((m) => m.valor)).toContain('outro')
    expect(ROTULO_MOTIVO.nao_informado).toBe('Motivo não informado')
  })
})
