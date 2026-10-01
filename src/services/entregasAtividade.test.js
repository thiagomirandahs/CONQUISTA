import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsert = vi.fn()
const remove = vi.fn()
vi.mock('../lib/supabase.js', () => ({
  supabase: { from: () => ({ upsert }), storage: { from: () => ({ remove }) } },
}))
const { registrarEntregaAtividade } = await import('./entregasAtividade.js')

const base = { atividadeId: 'a1', userId: 'u1', texto: 'feito' }
beforeEach(() => { upsert.mockReset(); remove.mockReset(); remove.mockResolvedValue({ error: null }) })

describe('registrarEntregaAtividade', () => {
  it('registro ok: grava a entrega pendente e NÃO apaga o arquivo', async () => {
    upsert.mockResolvedValue({ error: null })
    await registrarEntregaAtividade({ ...base, fotoUrl: 'u1/atividades/1.mp4' })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ atividade_id: 'a1', usuario_id: 'u1', foto_url: 'u1/atividades/1.mp4', status: 'pendente' }), { onConflict: 'atividade_id,usuario_id' })
    expect(remove).not.toHaveBeenCalled()
  })

  it('registro falhou: descarta o arquivo que acabou de subir e repassa o erro', async () => {
    upsert.mockResolvedValue({ error: { message: 'rede caiu' } })
    await expect(registrarEntregaAtividade({ ...base, fotoUrl: 'u1/atividades/1.mp4' })).rejects.toThrow('rede caiu')
    expect(remove).toHaveBeenCalledWith(['u1/atividades/1.mp4'])
  })

  it('tentar de novo após falha não acumula cópia: cada falha apaga o seu arquivo', async () => {
    upsert.mockResolvedValue({ error: { message: 'x' } })
    for (const n of [1, 2, 3]) await expect(registrarEntregaAtividade({ ...base, fotoUrl: `u1/atividades/${n}.mp4` })).rejects.toThrow()
    expect(remove).toHaveBeenCalledTimes(3)
  })

  it('sem arquivo: só registra, e falha sem tentar apagar nada', async () => {
    upsert.mockResolvedValue({ error: { message: 'x' } })
    await expect(registrarEntregaAtividade({ ...base, fotoUrl: null })).rejects.toThrow('x')
    expect(remove).not.toHaveBeenCalled()
  })

  it('falha ao apagar não esconde o erro do registro', async () => {
    upsert.mockResolvedValue({ error: { message: 'erro real' } })
    remove.mockRejectedValue(new Error('offline'))
    await expect(registrarEntregaAtividade({ ...base, fotoUrl: 'u1/atividades/1.jpg' })).rejects.toThrow('erro real')
  })
})
