import { describe, it, expect, vi, beforeEach } from 'vitest'

// Assinatura falsa e estável por caminho; o bucket chega como 1º argumento para checarmos que é 'comunidade'.
let createSignedUrls
vi.mock('./supabase.js', () => ({
  supabase: { storage: { from: (bucket) => ({ createSignedUrls: (...a) => createSignedUrls(bucket, ...a) }) } },
}))

let m
beforeEach(async () => {
  vi.resetModules()
  createSignedUrls = vi.fn(async (_bucket, caminhos) => ({
    data: caminhos.map((p) => ({ path: p, signedUrl: `sign/${p}?token=T-${p}`, error: null })),
    error: null,
  }))
  m = await import('./fotosComunidade.js')
  m._reiniciarFotosComunidade()
  m.definirUsuarioComunidade('u1')
})

describe('fotosComunidade', () => {
  it('assina no bucket "comunidade" por 10 min e devolve a URL assinada', async () => {
    const url = await m.resolverFotoComunidade('clube-a/u1/x.jpg')
    expect(url).toBe('sign/clube-a/u1/x.jpg?token=T-clube-a/u1/x.jpg')
    expect(createSignedUrls).toHaveBeenCalledWith('comunidade', ['clube-a/u1/x.jpg'], 600)
  })

  it('caminho vazio não pede assinatura', async () => {
    expect(await m.resolverFotoComunidade(null)).toBeNull()
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('pedidos do mesmo instante viram UMA chamada em lote', async () => {
    const [a, b] = await Promise.all([m.resolverFotoComunidade('p1.jpg'), m.resolverFotoComunidade('p2.jpg')])
    expect(a).toContain('T-p1.jpg'); expect(b).toContain('T-p2.jpg')
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls).toHaveBeenCalledWith('comunidade', ['p1.jpg', 'p2.jpg'], 600)
  })

  it('a 2ª vez do mesmo caminho vem do cache (sem nova assinatura)', async () => {
    await m.resolverFotoComunidade('p1.jpg')
    await m.resolverFotoComunidade('p1.jpg')
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(m.urlComunidadeEmCache('p1.jpg')).toContain('T-p1.jpg')
  })

  it('trocar de usuário ZERA o cache (aparelho compartilhado não reaproveita URL de outra conta)', async () => {
    await m.resolverFotoComunidade('p1.jpg')
    expect(m.urlComunidadeEmCache('p1.jpg')).not.toBeNull()
    m.definirUsuarioComunidade('u2')
    expect(m.urlComunidadeEmCache('p1.jpg')).toBeNull()
    await m.resolverFotoComunidade('p1.jpg')
    expect(createSignedUrls).toHaveBeenCalledTimes(2)   // assinou de novo, agora para o novo usuário
  })

  it('falha de assinatura não devolve URL (e fica lembrada)', async () => {
    createSignedUrls = vi.fn(async () => ({ data: null, error: { message: 'nope' } }))
    expect(await m.resolverFotoComunidade('p1.jpg')).toBeNull()
    expect(m.urlComunidadeEmCache('p1.jpg')).toBeNull()
  })
})
