import { describe, it, expect, vi } from 'vitest'
import {
  validarImagem, detectarMime, processarImagem, caminhoSeguro, caminhoDoClube, montarUpload, removerComSeguranca,
  PERFIS, FINALIDADES, perfilDe, sha256Hex,
} from './index.js'
import { comprimirImagem } from '../imagem.js'

const arq = (bytes, nome = 'x.jpg', type = 'image/jpeg') => new File([new Uint8Array(bytes)], nome, { type })
const ascii = (s) => [...s].map((c) => c.charCodeAt(0))

function png(w, h) {
  const b = [0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR')]
  b.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 2, 0, 0, 0)
  return b
}
function jpeg(w, h, exifLen = 0) {
  const b = [0xff, 0xd8]
  if (exifLen) b.push(0xff, 0xe1, (exifLen + 2) >> 8, (exifLen + 2) & 255, ...new Array(exifLen).fill(0x41))
  b.push(0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1)
  return b
}
function webpVp8x(w, h) {
  const b = [...ascii('RIFF'), 30, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0]
  b.push((w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255)
  return b
}
const webpLossy = (w, h) => [...ascii('RIFF'), 30, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 '), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8].concat([0, 0])

describe('validarImagem (magic bytes)', () => {
  it('aceita JPEG, PNG e WebP reais e devolve dimensões', async () => {
    expect(await validarImagem(arq(jpeg(800, 600)))).toMatchObject({ mime: 'image/jpeg', ext: 'jpg', largura: 800, altura: 600 })
    expect(await validarImagem(arq(png(1000, 500), 'a.png', 'image/png'))).toMatchObject({ mime: 'image/png', ext: 'png', largura: 1000, altura: 500 })
    expect(await validarImagem(arq(webpVp8x(640, 480), 'a.webp', 'image/webp'))).toMatchObject({ mime: 'image/webp', largura: 640, altura: 480 })
  })
  it('lê dimensões de JPEG com EXIF grande antes do SOF', async () => {
    expect(await validarImagem(arq(jpeg(300, 200, 40000)))).toMatchObject({ largura: 300, altura: 200 })
  })
  it('ignora file.type e extensão: JPEG com nome .svg e type image/svg+xml passa; SVG com type image/jpeg cai', async () => {
    expect((await validarImagem(arq(jpeg(10, 10), 'f.svg', 'image/svg+xml'))).mime).toBe('image/jpeg')
    const svg = arq(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'f.jpg', 'image/jpeg')
    await expect(validarImagem(svg)).rejects.toThrow(/não é uma foto válida/)
  })
  it.each([
    ['GIF', ascii('GIF89a') .concat(new Array(20).fill(0))],
    ['HTML', ascii('<!doctype html><html><body>oi</body></html>')],
    ['PDF', ascii('%PDF-1.7\n1 0 obj<<>>endobj').concat(new Array(10).fill(0))],
    ['HEIC', [0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, 0, 0, 0, 0]],
    ['RIFF que não é WebP', [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE'), 0, 0]],
    ['PNG com assinatura falsa', [0x89, ...ascii('PNG'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])('recusa %s', async (_n, bytes) => {
    await expect(validarImagem(arq(bytes, 'foto.jpg', 'image/jpeg'))).rejects.toThrow(/foto válida/)
  })
  it('recusa arquivo vazio, nulo e truncado', async () => {
    await expect(validarImagem(null)).rejects.toThrow(/Escolha/)
    await expect(validarImagem(arq([]))).rejects.toThrow(/vazio/)
    await expect(validarImagem(arq([0xff, 0xd8, 0xff]))).rejects.toThrow(/foto válida/)
  })
  it('recusa JPEG sem cabeçalho de tamanho (corrompido)', async () => {
    await expect(validarImagem(arq([0xff, 0xd8, 0xff, 0xda, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).rejects.toThrow(/corrompida/)
  })
  it('recusa arquivo gigante pelo tamanho sem ler conteúdo', async () => {
    const f = { size: 50 * 1024 * 1024, slice: vi.fn() }
    await expect(validarImagem(f)).rejects.toThrow(/muito pesada/)
    expect(f.slice).not.toHaveBeenCalled()
  })
  it('respeita maxBytes customizado', async () => {
    await expect(validarImagem(arq(jpeg(10, 10)), { maxBytes: 10 })).rejects.toThrow(/muito pesada/)
  })
  it('recusa dimensões absurdas (bomba de descompressão)', async () => {
    await expect(validarImagem(arq(png(60000, 60000), 'a.png'))).rejects.toThrow(/dimensões grandes/)
    await expect(validarImagem(arq(png(12000, 9000), 'a.png'))).rejects.toThrow(/dimensões grandes/)
  })
  it('lê WebP lossy (VP8)', async () => {
    expect(await validarImagem(arq(webpLossy(320, 240), 'a.webp'))).toMatchObject({ largura: 320, altura: 240 })
  })
  it('detectarMime devolve null para lixo', () => {
    expect(detectarMime(new Uint8Array(3))).toBeNull()
    expect(detectarMime(null)).toBeNull()
  })
})

describe('perfis', () => {
  it('existem todos e evidência/documento não comprimem agressivo', () => {
    expect(FINALIDADES).toEqual(['avatar', 'feed', 'miniatura', 'mural', 'evidencia', 'documento'])
    for (const f of FINALIDADES) expect(perfilDe(f).maxLado).toBeGreaterThan(0)
    for (const f of ['evidencia', 'documento']) {
      expect(PERFIS[f].comprimir).toBe(false)
      expect(PERFIS[f].qualidadeMin).toBeGreaterThanOrEqual(0.8)
      expect(PERFIS[f].maxLado).toBeGreaterThanOrEqual(2048)
    }
  })
  it('feed = mesmos números da foto da Rede (1080/150 KB)', () => {
    expect(PERFIS.feed).toMatchObject({ maxLado: 1080, alvoBytes: 150 * 1024, saida: 'webp' })
    expect(PERFIS.feed.alvoBytes).toBeLessThan(300 * 1024)
  })
  it('finalidade desconhecida (inclusive __proto__) lança', () => {
    expect(() => perfilDe('xyz')).toThrow()
    expect(() => perfilDe('__proto__')).toThrow()
    expect(() => perfilDe('toString')).toThrow()
  })
})

describe('caminhoSeguro', () => {
  const base = { clubId: 'c1', usuarioId: 'u1', finalidade: 'feed', extensao: 'webp' }
  it('formato <clube>/<usuario>/<finalidade>/<uuid>.<ext>', () => {
    const p = caminhoSeguro(base)
    expect(p).toMatch(/^c1\/u1\/feed\/[0-9a-f-]{36}\.webp$/)
    expect(caminhoSeguro(base)).not.toBe(p)
  })
  it('aceita UUID como clubId e ".JPG"', () => {
    const c = '123e4567-e89b-12d3-a456-426614174000'
    expect(caminhoSeguro({ ...base, clubId: c, extensao: '.JPG' })).toMatch(new RegExp(`^${c}/u1/feed/[0-9a-f-]{36}\\.jpg$`))
  })
  it('clubId ausente/vazio lança', () => {
    expect(() => caminhoSeguro({ ...base, clubId: undefined })).toThrow(/clubId/)
    expect(() => caminhoSeguro({ ...base, clubId: '' })).toThrow(/clubId/)
    expect(() => caminhoSeguro({ ...base, clubId: null })).toThrow(/clubId/)
    expect(() => caminhoSeguro({ ...base, usuarioId: '' })).toThrow(/usuarioId/)
    expect(() => caminhoSeguro()).toThrow()
  })
  it.each(['..', '../x', 'a/b', 'a\\b', 'a b', 'ação', '.hidden', 'a%2e', 'a?b', 'a#b', '\0x'])('recusa id perigoso %j', (v) => {
    expect(() => caminhoSeguro({ ...base, clubId: v })).toThrow(/inseguro/)
    expect(() => caminhoSeguro({ ...base, usuarioId: v })).toThrow(/inseguro/)
  })
  it('recusa finalidade e extensão fora da lista (svg, php, traversal)', () => {
    expect(() => caminhoSeguro({ ...base, finalidade: '../feed' })).toThrow()
    for (const e of ['svg', 'html', 'php', 'jpg/../x', '']) expect(() => caminhoSeguro({ ...base, extensao: e })).toThrow()
  })
  it('caminhoDoClube', () => {
    expect(caminhoDoClube('c1/u1/feed/a.webp', 'c1')).toBe(true)
    expect(caminhoDoClube('c2/u1/feed/a.webp', 'c1')).toBe(false)
    expect(caminhoDoClube('c1/../c2/a.webp', 'c1')).toBe(false)
    expect(caminhoDoClube('/c1/a.webp', 'c1')).toBe(false)
    expect(caminhoDoClube('c1//a.webp', 'c1')).toBe(false)
    expect(caminhoDoClube('c1', 'c1')).toBe(false)
    expect(caminhoDoClube('c1/a.webp', '')).toBe(false)
    expect(caminhoDoClube('c1x/a.webp', 'c1')).toBe(false)
    expect(caminhoDoClube(null, 'c1')).toBe(false)
  })
})

function depsFalsas({ webp = true, tamanhos } = {}) {
  let i = 0
  const criarCanvas = () => {
    const c = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb, tipo, q) => {
        const tam = tamanhos ? tamanhos[Math.min(i++, tamanhos.length - 1)] : 1000
        const t = tipo === 'image/webp' && !webp ? 'image/png' : tipo
        cb(new Blob([new Uint8Array(tam)], { type: t }))
        c.ultimaQ = q
      },
    }
    return c
  }
  return { createImageBitmap: vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })), criarCanvas }
}

describe('processarImagem', () => {
  const foto = () => arq(jpeg(4000, 3000, 100))
  it('feed: WebP, lado máx. 1080, principal + miniatura, metadados', async () => {
    const r = await processarImagem(foto(), 'feed', { deps: depsFalsas() })
    expect(r.mime).toBe('image/webp')
    expect(Math.max(r.largura, r.altura)).toBe(1080)
    expect(r.principal).toBeInstanceOf(Blob)
    expect(r.miniatura).toBeInstanceOf(Blob)
    expect(r).toMatchObject({ finalidade: 'feed', bytes: 1000 })
  })
  it('cai para JPEG se o navegador não exporta WebP', async () => {
    const r = await processarImagem(foto(), 'feed', { deps: depsFalsas({ webp: false }) })
    expect(r.mime).toBe('image/jpeg')
  })
  it('evidência sai em JPEG e sem passar do lado 2048 nem qualidade < 0,8', async () => {
    const deps = depsFalsas({ tamanhos: [5_000_000] })
    const qs = []
    const cc = deps.criarCanvas
    deps.criarCanvas = () => { const c = cc(); const tb = c.toBlob; c.toBlob = (cb, t, q) => { qs.push(q); tb(cb, t, q) }; return c }
    const r = await processarImagem(foto(), 'evidencia', { deps })
    expect(r.mime).toBe('image/jpeg')
    expect(Math.max(r.largura, r.altura)).toBeGreaterThanOrEqual(1600)
    expect(Math.min(...qs)).toBeGreaterThanOrEqual(0.4) // miniatura pode ser menor; principal não
    expect(r.principal.size).toBe(5_000_000) // não foi estrangulada além do piso
  })
  it('recusa arquivo inválido antes de decodificar', async () => {
    const deps = depsFalsas()
    await expect(processarImagem(arq(ascii('<svg></svg>          ')), 'feed', { deps })).rejects.toThrow(/foto válida/)
    expect(deps.createImageBitmap).not.toHaveBeenCalled()
  })
  it('falha (nunca devolve original) se decodificar falhar', async () => {
    const deps = depsFalsas()
    deps.createImageBitmap = vi.fn(async () => { throw new Error('x') })
    await expect(processarImagem(foto(), 'feed', { deps })).rejects.toThrow(/Não consegui preparar/)
  })
  it('perfil inválido lança', async () => {
    await expect(processarImagem(foto(), 'nada', { deps: depsFalsas() })).rejects.toThrow(/desconhecida/)
  })
})

describe('montarUpload', () => {
  it('devolve principal + miniatura com caminhos seguros e metadata serializável', async () => {
    const res = await processarImagem(arq(jpeg(2000, 1000)), 'feed', { deps: depsFalsas() })
    const { uploads, metadata } = await montarUpload(res, { clubId: 'c1', usuarioId: 'u1', comHash: true })
    expect(uploads).toHaveLength(2)
    expect(uploads[0].path).toMatch(/^c1\/u1\/feed\/[0-9a-f-]{36}\.webp$/)
    expect(uploads[1].path).toMatch(/^c1\/u1\/feed\/[0-9a-f-]{36}-min\.webp$/)
    expect(uploads[0]).toMatchObject({ contentType: 'image/webp' })
    expect(uploads[0].blob).toBe(res.principal)
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata)
    expect(metadata).toMatchObject({ finalidade: 'feed', bytes: 1000, mime: 'image/webp' })
    expect(metadata.sha256 === null || /^[0-9a-f]{64}$/.test(metadata.sha256)).toBe(true)
  })
  it('sem clubId lança', async () => {
    const res = await processarImagem(arq(jpeg(2000, 1000)), 'feed', { deps: depsFalsas() })
    await expect(montarUpload(res, { usuarioId: 'u1' })).rejects.toThrow(/clubId/)
  })
  it('sha256Hex de blob conhecido', async () => {
    const h = await sha256Hex(new Blob(['abc']))
    if (h) expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('removerComSeguranca', () => {
  const mk = (erro = null) => {
    const remove = vi.fn(async () => ({ error: erro }))
    return { supabase: { storage: { from: vi.fn(() => ({ remove })) } }, remove }
  }
  it('remove caminhos do próprio clube', async () => {
    const { supabase, remove } = mk()
    const r = await removerComSeguranca('comunidade', ['c1/u1/feed/a.webp', 'c1/u1/feed/a-min.webp'], { supabase, clubId: 'c1' })
    expect(remove).toHaveBeenCalledWith(['c1/u1/feed/a.webp', 'c1/u1/feed/a-min.webp'])
    expect(r.removidos).toHaveLength(2)
  })
  it('recusa TUDO se houver 1 caminho de outro clube (nada é removido)', async () => {
    const { supabase, remove } = mk()
    await expect(removerComSeguranca('b', ['c1/u/a.webp', 'c2/u/b.webp'], { supabase, clubId: 'c1' })).rejects.toThrow(/não pertencem/)
    expect(remove).not.toHaveBeenCalled()
  })
  it('recusa traversal e prefixo parecido', async () => {
    const { supabase, remove } = mk()
    await expect(removerComSeguranca('b', ['c1/../c2/x.webp'], { supabase, clubId: 'c1' })).rejects.toThrow()
    await expect(removerComSeguranca('b', ['c10/u/x.webp'], { supabase, clubId: 'c1' })).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
  })
  it('sem clubId (lote) recusa', async () => {
    const { supabase, remove } = mk()
    await expect(removerComSeguranca('b', ['c1/u/x.webp'], { supabase })).rejects.toThrow(/clubId/)
    await expect(removerComSeguranca('b', ['c1/u/x.webp'], { supabase, clubId: '' })).rejects.toThrow(/clubId/)
    expect(remove).not.toHaveBeenCalled()
  })
  it('sem supabase recusa; erro do storage vira mensagem; lista vazia não chama', async () => {
    await expect(removerComSeguranca('b', ['c1/u/x.webp'], { clubId: 'c1' })).rejects.toThrow(/storage/)
    const m = mk({ message: 'boom' })
    await expect(removerComSeguranca('b', 'c1/u/x.webp', { supabase: m.supabase, clubId: 'c1' })).rejects.toThrow(/boom/)
    const v = mk()
    await removerComSeguranca('b', [], { supabase: v.supabase, clubId: 'c1' })
    expect(v.remove).not.toHaveBeenCalled()
  })
})

describe('compat com comprimirImagem (legado intocado)', () => {
  it('continua devolvendo o mesmo arquivo para não-imagem e GIF', async () => {
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    expect(await comprimirImagem(pdf)).toBe(pdf)
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' })
    expect(await comprimirImagem(gif)).toBe(gif)
  })
  it('em erro de decodificação devolve o original (sem quebrar)', async () => {
    const f = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    expect(await comprimirImagem(f)).toBe(f)
  })
})
