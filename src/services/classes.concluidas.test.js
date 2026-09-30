import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
vi.mock('./documentoIdade.js', () => ({ apagarDocumentoConferido: vi.fn() }))
vi.mock('../lib/upload.js', () => ({ subirComprovacao: vi.fn(), comComprovacao: vi.fn() }))

const { carregarClassesConcluidasAnteriormente } = await import('./classes.js')

beforeEach(() => rpc.mockReset())

describe('carregarClassesConcluidasAnteriormente', () => {
  it('devolve a lista da RPC', async () => {
    rpc.mockResolvedValue({ data: [{ class_id: 'a' }], error: null })
    expect(await carregarClassesConcluidasAnteriormente()).toEqual([{ class_id: 'a' }])
    expect(rpc).toHaveBeenCalledWith('classes_concluidas_anteriormente')
  })
  it('RPC inexistente (banco 518), erro ou retorno estranho = []', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    expect(await carregarClassesConcluidasAnteriormente()).toEqual([])
    rpc.mockRejectedValue(new Error('rede'))
    expect(await carregarClassesConcluidasAnteriormente()).toEqual([])
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await carregarClassesConcluidasAnteriormente()).toEqual([])
  })
})
