import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const BASE = 'https://proj.supabase.co/storage/v1/object'
const pub = (caminho) => `${BASE}/public/imagens/${caminho}`

let createSignedUrls
vi.mock('./supabase.js', () => ({
  supabase: { storage: { from: (bucket) => ({ createSignedUrls: (...a) => createSignedUrls(bucket, ...a) }) } },
}))

let m
beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  // por padrão o Storage assina tudo (assinatura falsa e estável por caminho)
  createSignedUrls = vi.fn(async (_bucket, caminhos) => ({
    data: caminhos.map((p) => ({ path: p, signedUrl: `${BASE}/sign/imagens/${p}?token=T-${p}`, error: null })),
    error: null,
  }))
  m = await import('./imagens.js')
  m._reiniciarImagens()
})
afterEach(() => { vi.useRealTimers() })

describe('caminhoDaImagem: só arquivo do bucket "imagens" tem caminho', () => {
  it('extrai o caminho de URL pública, assinada e autenticada (sem query string)', () => {
    expect(m.caminhoDaImagem(pub('perfis/u1-1.jpg'))).toBe('perfis/u1-1.jpg')
    expect(m.caminhoDaImagem(`${BASE}/sign/imagens/mural/u1-2.jpg?token=abc`)).toBe('mural/u1-2.jpg')
    expect(m.caminhoDaImagem(`${BASE}/authenticated/imagens/unidades/x-emblema-1.png`)).toBe('unidades/x-emblema-1.png')
  })
  it('decodifica nomes com caracteres especiais', () => {
    expect(m.caminhoDaImagem(pub('mural/foto%20boa.jpg'))).toBe('mural/foto boa.jpg')
  })
  it('outro bucket, URL externa, blob:, data: e vazio NÃO são do bucket', () => {
    expect(m.caminhoDaImagem(`${BASE}/public/comprovacoes/x.jpg`)).toBeNull()
    expect(m.caminhoDaImagem(`${BASE}/public/publico/clube/logo.png`)).toBeNull()
    expect(m.caminhoDaImagem('https://exemplo.com/a.jpg')).toBeNull()
    expect(m.caminhoDaImagem('blob:http://localhost/abc')).toBeNull()
    expect(m.caminhoDaImagem('data:image/png;base64,AAAA')).toBeNull()
    expect(m.caminhoDaImagem('')).toBeNull()
    expect(m.caminhoDaImagem(null)).toBeNull()
    expect(m.caminhoDaImagem(undefined)).toBeNull()
  })
})

describe('resolverImagem', () => {
  it('URL que não é do bucket volta como está, sem pedir assinatura', async () => {
    expect(await m.resolverImagem('https://exemplo.com/a.jpg')).toBe('https://exemplo.com/a.jpg')
    expect(await m.resolverImagem(`${BASE}/public/publico/c/logo.png`)).toBe(`${BASE}/public/publico/c/logo.png`)
    expect(await m.resolverImagem(null)).toBeNull()
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('assina a URL do bucket (24 h) e devolve a assinada', async () => {
    const url = await m.resolverImagem(pub('perfis/u1-1.jpg'))
    expect(url).toBe(`${BASE}/sign/imagens/perfis/u1-1.jpg?token=T-perfis/u1-1.jpg`)
    expect(createSignedUrls).toHaveBeenCalledWith('imagens', ['perfis/u1-1.jpg'], 24 * 60 * 60)
  })

  it('pedidos do mesmo instante viram UMA chamada, sem repetir o mesmo caminho', async () => {
    const [a, b, c, d] = await Promise.all([
      m.resolverImagem(pub('perfis/a.jpg')), m.resolverImagem(pub('perfis/b.jpg')),
      m.resolverImagem(pub('perfis/a.jpg')), m.resolverImagem(pub('mural/c.jpg')),
    ])
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls.mock.calls[0][1].sort()).toEqual(['mural/c.jpg', 'perfis/a.jpg', 'perfis/b.jpg'])
    expect(a).toBe(c)
    expect(a).toContain('perfis/a.jpg')
    expect(b).toContain('perfis/b.jpg')
    expect(d).toContain('mural/c.jpg')
  })

  it('a URL assinada é reaproveitada (cache HTTP do navegador precisa de URL estável): sem 2º pedido', async () => {
    const u1 = await m.resolverImagem(pub('perfis/u1-1.jpg'))
    const u2 = await m.resolverImagem(pub('perfis/u1-1.jpg'))
    expect(u2).toBe(u1)
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
  })

  it('lotes de no máximo 100 caminhos', async () => {
    const pedidos = Array.from({ length: 230 }, (_, i) => m.resolverImagem(pub(`perfis/u${i}-1.jpg`)))
    await Promise.all(pedidos)
    expect(createSignedUrls).toHaveBeenCalledTimes(3)
    expect(createSignedUrls.mock.calls.map((c) => c[1].length).sort((x, y) => x - y)).toEqual([30, 100, 100])
  })

  it('URL assinada perto de vencer (menos de 2 h) é pedida de novo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
    await m.resolverImagem(pub('perfis/u1-1.jpg'))
    vi.setSystemTime(new Date('2026-09-22T07:00:00Z'))      // 21 h depois: ainda restam 3 h
    await m.resolverImagem(pub('perfis/u1-1.jpg'))
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-22T08:30:00Z'))      // 22h30 depois: restam 1h30 (< 2 h)
    await m.resolverImagem(pub('perfis/u1-1.jpg'))
    expect(createSignedUrls).toHaveBeenCalledTimes(2)
  })
})

describe('resolverImagem: quando a assinatura falha, cai na URL original (compat front novo antes do SQL)', () => {
  it('erro geral do Storage devolve a original e lembra a falha por 1 min (sem tempestade de pedidos)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
    createSignedUrls = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
    const original = pub('perfis/u1-1.jpg')
    expect(await m.resolverImagem(original)).toBe(original)
    expect(await m.resolverImagem(original)).toBe(original)
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-21T10:01:30Z'))       // passou 1 min: tenta de novo
    expect(await m.resolverImagem(original)).toBe(original)
    expect(createSignedUrls).toHaveBeenCalledTimes(2)
  })

  it('exceção de rede também devolve a original', async () => {
    createSignedUrls = vi.fn(async () => { throw new Error('offline') })
    const original = pub('mural/x.jpg')
    expect(await m.resolverImagem(original)).toBe(original)
  })

  it('erro de UM caminho (sem permissão/inexistente) só afeta aquele; os outros seguem assinados', async () => {
    createSignedUrls = vi.fn(async (_b, caminhos) => ({
      data: caminhos.map((p) => (p === 'mural/proibida.jpg'
        ? { path: p, signedUrl: null, error: 'Object not found' }
        : { path: p, signedUrl: `${BASE}/sign/imagens/${p}?token=ok`, error: null })),
      error: null,
    }))
    const [boa, ruim] = await Promise.all([m.resolverImagem(pub('perfis/ok.jpg')), m.resolverImagem(pub('mural/proibida.jpg'))])
    expect(boa).toContain('token=ok')
    expect(ruim).toBe(pub('mural/proibida.jpg'))
  })
})

describe('urlAssinadaEmCache (1º render sem piscar)', () => {
  it('devolve null antes de assinar e a assinada depois', async () => {
    const original = pub('perfis/u1-1.jpg')
    expect(m.urlAssinadaEmCache(original)).toBeNull()
    await m.resolverImagem(original)
    expect(m.urlAssinadaEmCache(original)).toContain('/sign/imagens/perfis/u1-1.jpg')
  })
  it('URL de fora do bucket sai na hora', () => {
    expect(m.urlAssinadaEmCache('https://exemplo.com/a.jpg')).toBe('https://exemplo.com/a.jpg')
    expect(m.urlAssinadaEmCache(null)).toBeNull()
  })
})

describe('cache POR USUÁRIO: aparelho compartilhado nunca reaproveita a URL de outra pessoa', () => {
  const esperarGravar = () => new Promise((r) => setTimeout(r, 700))

  it('persiste no localStorage para o mesmo usuário reabrir o app sem pedir de novo', async () => {
    m.definirUsuarioImagens('u1')
    const original = pub('perfis/u1-1.jpg')
    const assinada = await m.resolverImagem(original)
    await esperarGravar()
    expect(JSON.parse(localStorage.getItem('cq.imagens.v1')).uid).toBe('u1')

    // "reabre o app": módulo novo, mesmo localStorage
    vi.resetModules()
    const m2 = await import('./imagens.js')
    createSignedUrls.mockClear()
    m2.definirUsuarioImagens('u1')
    expect(m2.urlAssinadaEmCache(original)).toBe(assinada)         // sincrono: sem piscar
    expect(await m2.resolverImagem(original)).toBe(assinada)
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('OUTRO usuário no mesmo aparelho NÃO herda as URLs (e o armazenamento é apagado)', async () => {
    m.definirUsuarioImagens('u1')
    await m.resolverImagem(pub('perfis/u1-1.jpg'))
    await esperarGravar()
    expect(localStorage.getItem('cq.imagens.v1')).not.toBeNull()

    vi.resetModules()
    const m2 = await import('./imagens.js')
    m2.definirUsuarioImagens('u2')
    expect(localStorage.getItem('cq.imagens.v1')).toBeNull()
    expect(m2.urlAssinadaEmCache(pub('perfis/u1-1.jpg'))).toBeNull()
  })

  it('sair da conta apaga o cache em memória e o armazenamento local', async () => {
    m.definirUsuarioImagens('u1')
    await m.resolverImagem(pub('perfis/u1-1.jpg'))
    await esperarGravar()
    m.definirUsuarioImagens(null)
    expect(localStorage.getItem('cq.imagens.v1')).toBeNull()
    expect(m.urlAssinadaEmCache(pub('perfis/u1-1.jpg'))).toBeNull()
  })

  it('trocar de conta no MEIO de um pedido não guarda a URL do usuário anterior', async () => {
    let liberar
    createSignedUrls = vi.fn(() => new Promise((res) => { liberar = res }))
    m.definirUsuarioImagens('u1')
    const original = pub('perfis/u1-1.jpg')
    const p = m.resolverImagem(original)
    await new Promise((r) => setTimeout(r, 10))                   // o lote já saiu
    m.definirUsuarioImagens('u2')                                 // outra pessoa entrou
    liberar({ data: [{ path: 'perfis/u1-1.jpg', signedUrl: `${BASE}/sign/imagens/perfis/u1-1.jpg?token=de-u1`, error: null }], error: null })
    expect(await p).toBe(original)                                // quem esperava cai na original (não recebe a assinada)
    expect(m.urlAssinadaEmCache(original)).toBeNull()             // e nada ficou guardado para o usuário novo
  })

  it('localStorage bloqueado/corrompido não quebra nada', async () => {
    localStorage.setItem('cq.imagens.v1', '{lixo')
    m.definirUsuarioImagens('u1')
    expect(await m.resolverImagem(pub('perfis/u1-1.jpg'))).toContain('/sign/')
  })
})
