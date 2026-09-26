// Foto órfã (migration 173): se gravar o requisito falhar DEPOIS do upload, a foto é descartada.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const remove = vi.fn()
vi.mock('./supabase.js', () => ({ supabase: { storage: { from: () => ({ remove }) } } }))

const { descartarComprovacao, comComprovacao } = await import('./upload.js')

beforeEach(() => { remove.mockReset(); remove.mockResolvedValue({ data: [{}], error: null }) })

describe('comComprovacao', () => {
  it('etapa falhou: apaga a foto recém-enviada e repassa o erro original', async () => {
    await expect(comComprovacao('u1/requisitos/1.jpg', async () => { throw new Error('Failed to fetch') }))
      .rejects.toThrow('Failed to fetch')
    expect(remove).toHaveBeenCalledWith(['u1/requisitos/1.jpg'])
  })

  it('etapa deu certo: não apaga nada', async () => {
    await expect(comComprovacao('u1/requisitos/1.jpg', async () => 'ok')).resolves.toBe('ok')
    expect(remove).not.toHaveBeenCalled()
  })

  it('sem foto: só repassa o erro', async () => {
    await expect(comComprovacao(null, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(remove).not.toHaveBeenCalled()
  })

  it('falha ao apagar não esconde o erro da etapa', async () => {
    remove.mockRejectedValue(new Error('offline'))
    await expect(comComprovacao('u1/requisitos/1.jpg', async () => { throw new Error('rede caiu') })).rejects.toThrow('rede caiu')
  })
})

describe('descartarComprovacao', () => {
  it('ignora URL pública (bucket legado) e caminho vazio', async () => {
    expect(await descartarComprovacao('https://x.supabase.co/storage/v1/object/public/imagens/a.jpg')).toBe(false)
    expect(await descartarComprovacao('')).toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })
})
