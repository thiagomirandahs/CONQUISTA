import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
vi.mock('../lib/upload.js', () => ({ subirComprovacao: vi.fn(), comComprovacao: vi.fn() }))
const { buscarEspecialidades } = await import('./especialidades.js')
const dados = await import('../lib/dados.js')

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { itens: [], proximo: null, total: 0, areas: [] }, error: null }))

describe('buscarEspecialidades', () => {
  it('envia os parâmetros certos à RPC (busca aparada, cursor opaco repassado)', async () => {
    await buscarEspecialidades({ busca: '  nós  ', area: 'Artes', situacao: 'iniciadas', limite: 20, depois: 'Artes|AR-010' })
    expect(rpc).toHaveBeenCalledWith('especialidades_buscar', { p_busca: 'nós', p_area: 'Artes', p_situacao: 'iniciadas', p_limite: 20, p_depois: 'Artes|AR-010' })
  })
  it('padrões: sem busca/área/cursor viram null, situação "todas", limite 30', async () => {
    await buscarEspecialidades()
    expect(rpc).toHaveBeenCalledWith('especialidades_buscar', { p_busca: null, p_area: null, p_situacao: 'todas', p_limite: 30, p_depois: null })
    await buscarEspecialidades({ busca: '   ', area: '' })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_busca: null, p_area: null })
  })
  it('sanea o limite: máximo 50, mínimo 1, lixo vira 30', async () => {
    for (const [entrada, saida] of [[500, 50], [0, 1], [-4, 1], ['abc', 30], [12.9, 12], [null, 1]]) {
      rpc.mockClear()
      await buscarEspecialidades({ limite: entrada })
      expect(rpc.mock.calls[0][1].p_limite, String(entrada)).toBe(saida)
    }
  })
  it('erro da RPC vira Error; resposta vazia vira estrutura vazia; sai por dados.js', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Situação inválida.' } })
    await expect(buscarEspecialidades({})).rejects.toThrow('Situação inválida.')
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await buscarEspecialidades({})).toEqual({ itens: [], proximo: null, total: 0, areas: [] })
    expect(dados.buscarEspecialidades).toBe(buscarEspecialidades)
  })
})
