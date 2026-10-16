import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { definirDonoDasFotos, fotoLocal, fotoLocalPronta, guardarFoto, _reiniciarCacheDeFotos } from './cacheDeFotos.js'

// Cache Storage falso (o jsdom não tem): nome -> Map(url -> Response)
function instalarCaches() {
  const lojas = new Map()
  const loja = (nome) => {
    if (!lojas.has(nome)) lojas.set(nome, new Map())
    const m = lojas.get(nome)
    return {
      match: async (req) => m.get(req.url),
      put: async (req, resp) => { m.set(req.url, resp) },
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (req) => m.delete(req.url),
    }
  }
  globalThis.caches = {
    open: async (nome) => loja(nome),
    keys: async () => [...lojas.keys()],
    delete: async (nome) => lojas.delete(nome),
  }
  return lojas
}

// resposta de fetch falsa (o Response do Node não lê o Blob do jsdom)
function resposta(tipo = 'image/webp', bytes = 10, status = 200) {
  const r = {
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? tipo : null) },
    blob: async () => ({ size: bytes, type: tipo }),
  }
  r.clone = () => ({ ...r })
  return r
}

let lojas
beforeEach(async () => {
  _reiniciarCacheDeFotos()
  lojas = instalarCaches()
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:foto-${++n}`)
  URL.revokeObjectURL = vi.fn()
  globalThis.fetch = vi.fn(async () => resposta())
  await definirDonoDasFotos('ana')
})
afterEach(() => { delete globalThis.caches })

describe('cacheDeFotos', () => {
  it('baixa UMA vez: depois a foto sai do aparelho, mesmo ao reabrir o app (outra sessão)', async () => {
    const u1 = await guardarFoto('comunidade', 'c1/p1.webp', 'https://x.supabase.co/sign/a?token=1')
    expect(u1).toMatch(/^blob:/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fotoLocalPronta('comunidade', 'c1/p1.webp')).toBe(u1)
    // "reabrir o app": a memória zera, o Cache Storage fica
    _reiniciarCacheDeFotos()
    await definirDonoDasFotos('ana')
    expect(fotoLocalPronta('comunidade', 'c1/p1.webp')).toBeNull()
    expect(await fotoLocal('comunidade', 'c1/p1.webp')).toMatch(/^blob:/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('vídeo (ou resposta que não é imagem) e arquivo grande demais nunca entram', async () => {
    fetch.mockResolvedValueOnce(resposta('video/mp4'))
    expect(await guardarFoto('comprovacoes', 'u/atividades/v.mp4', 'https://x/sign/v')).toBeNull()
    fetch.mockResolvedValueOnce(resposta('image/jpeg', 4 * 1024 * 1024))
    expect(await guardarFoto('imagens', 'mural/g.jpg', 'https://x/sign/g')).toBeNull()
    fetch.mockResolvedValueOnce(resposta('image/jpeg', 10, 403))
    expect(await guardarFoto('imagens', 'mural/h.jpg', 'https://x/sign/h')).toBeNull()
    expect(await fotoLocal('comprovacoes', 'u/atividades/v.mp4')).toBeNull()
  })

  it('trocar de conta apaga as fotos da conta anterior (celular compartilhado)', async () => {
    await guardarFoto('imagens', 'perfis/ana.jpg', 'https://x/sign/ana')
    expect([...lojas.keys()]).toEqual(['dbv-fotos-ana'])
    await definirDonoDasFotos('bia')
    expect([...lojas.keys()]).not.toContain('dbv-fotos-ana')
    expect(await fotoLocal('imagens', 'perfis/ana.jpg')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    await definirDonoDasFotos(null)            // saiu da conta
    expect(await fotoLocal('imagens', 'perfis/ana.jpg')).toBeNull()
  })

  it('sem Cache Storage (navegador antigo/modo privado): devolve null e o app segue com a URL assinada', async () => {
    delete globalThis.caches
    expect(await guardarFoto('imagens', 'mural/a.jpg', 'https://x/sign/a')).toBeNull()
    expect(await fotoLocal('imagens', 'mural/a.jpg')).toBeNull()
  })
})
