import { describe, it, expect, vi, beforeEach } from 'vitest'

// dublê do supabase-js: o teste controla o que a RPC e as tabelas respondem
let respostas
const chamadas = []
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: (nome, args) => { chamadas.push(['rpc', nome, args]); return Promise.resolve(respostas.rpc[nome]) },
    from: (tabela) => {
      const q = { tabela }
      for (const m of ['select', 'eq', 'order']) q[m] = () => q
      q.maybeSingle = () => Promise.resolve(respostas.tabelas[tabela])
      q.then = (res, rej) => Promise.resolve(respostas.tabelas[tabela]).then(res, rej)
      chamadas.push(['from', tabela])
      return q
    },
    storage: {
      from: (b) => ({
        upload: (caminho, arq, opc) => { chamadas.push(['upload', b, caminho, opc]); return Promise.resolve(respostas.upload || { error: null }) },
        getPublicUrl: (c) => ({ data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/${b}/${c}` } }),
      }),
    },
  },
}))
const validarImagem = vi.fn()
vi.mock('../lib/upload.js', () => ({ validarImagem: (...a) => validarImagem(...a) }))
vi.mock('../lib/imagem.js', () => ({ comprimirImagem: async (f) => f }))

const { carregarContexto, gravarMarca, definirRecurso, carregarCatalogoRecursos, subirLogoDoClube, rpcAusente } = await import('./clubes.js')

const SEM_FUNCAO = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.meu_contexto without parameters in the schema cache' } }

beforeEach(() => {
  chamadas.length = 0
  validarImagem.mockReset()
  respostas = { rpc: {}, tabelas: {}, upload: null }
})

describe('rpcAusente', () => {
  it('reconhece "função não existe" (PostgREST e Postgres), e só isso', () => {
    expect(rpcAusente({ code: 'PGRST202' })).toBe(true)
    expect(rpcAusente({ code: '42883' })).toBe(true)
    expect(rpcAusente({ message: 'Could not find the function public.x in the schema cache' })).toBe(true)
    expect(rpcAusente({ message: 'function public.x() does not exist' })).toBe(true)
    expect(rpcAusente({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(rpcAusente({ message: 'Failed to fetch' })).toBe(false)
    expect(rpcAusente(null)).toBe(false)
  })
})

describe('carregarContexto', () => {
  it('com o SQL aplicado: normaliza a resposta de meu_contexto (papel e unidade do VÍNCULO)', async () => {
    respostas.rpc.meu_contexto = { data: { usuario_id: 'u', clube_atual_id: 'A', vinculos: [{ club_id: 'A', nome: 'Clube A', papel: 'diretoria', status: 'ativo', selecionavel: true, unidade_id: 'x', marca: { nome: 'Clube A' }, recursos: { chat: true } }] }, error: null }
    const c = await carregarContexto('u')
    expect(c.legado).toBe(false)
    expect(c.vinculos[0]).toMatchObject({ clubeId: 'A', papel: 'diretoria', unidadeId: 'x' })
    expect(chamadas.filter((x) => x[0] === 'from')).toEqual([])            // não lê profiles nem club_features
  })

  it('front ANTES do SQL (função inexistente): monta o contexto do perfil, como o app sempre fez', async () => {
    respostas.rpc.meu_contexto = SEM_FUNCAO
    respostas.tabelas.profiles = { data: { id: 'u', papel: 'instrutor', unidade_id: 'u9', status: 'ativo' }, error: null }
    respostas.tabelas.club_features = { data: [{ feature: 'leilao', enabled: true }], error: null }
    const c = await carregarContexto('u')
    expect(c.legado).toBe(true)
    expect(c.vinculos[0]).toMatchObject({ papel: 'instrutor', unidadeId: 'u9', status: 'ativo' })
    expect(c.vinculos[0].recursos.leilao).toBe(true)
  })

  it('modo antigo com a tabela de recursos também ausente: leilão ligado (banco de um clube só)', async () => {
    respostas.rpc.meu_contexto = SEM_FUNCAO
    respostas.tabelas.profiles = { data: { id: 'u', papel: 'desbravador', status: 'ativo' }, error: null }
    respostas.tabelas.club_features = { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }
    expect((await carregarContexto('u')).vinculos[0].recursos.leilao).toBe(true)
  })

  it('erro que NÃO é "função ausente" (rede, permissão, 500) SOBE — nunca cai no modo antigo com papel global', async () => {
    respostas.rpc.meu_contexto = { data: null, error: { code: '500', message: 'Failed to fetch' } }
    await expect(carregarContexto('u')).rejects.toThrow('Failed to fetch')
    expect(chamadas.filter((x) => x[0] === 'from')).toEqual([])
  })

  it('modo antigo sem perfil: sem vínculos', async () => {
    respostas.rpc.meu_contexto = SEM_FUNCAO
    respostas.tabelas.profiles = { data: null, error: null }
    respostas.tabelas.club_features = { data: [], error: null }
    expect((await carregarContexto('u')).vinculos).toEqual([])
  })

  it('modo antigo com erro ao ler o perfil: sobe o erro', async () => {
    respostas.rpc.meu_contexto = SEM_FUNCAO
    respostas.tabelas.profiles = { data: null, error: { message: 'boom' } }
    respostas.tabelas.club_features = { data: [], error: null }
    await expect(carregarContexto('u')).rejects.toThrow('boom')
  })
})

describe('gravarMarca e definirRecurso', () => {
  it('gravarMarca chama a RPC com os campos e devolve a marca efetiva', async () => {
    respostas.rpc.clube_marca_gravar = { data: { nome: 'Novo' }, error: null }
    expect(await gravarMarca({ nome: 'Novo' })).toEqual({ nome: 'Novo' })
    expect(chamadas).toContainEqual(['rpc', 'clube_marca_gravar', { p_marca: { nome: 'Novo' } }])
  })
  it('erro do servidor chega com a mensagem clara', async () => {
    respostas.rpc.clube_marca_gravar = { data: null, error: { message: 'Cor inválida em cor_primaria: use o formato #rrggbb.' } }
    await expect(gravarMarca({ cor_primaria: 'x' })).rejects.toThrow('Cor inválida')
  })
  it('SQL ainda não aplicado: mensagem que explica o que falta', async () => {
    respostas.rpc.clube_marca_gravar = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(gravarMarca({ nome: 'x' })).rejects.toThrow(/20260921000033/)
    respostas.rpc.recurso_definir = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(definirRecurso('chat', false)).rejects.toThrow(/20260921000033/)
  })
  it('definirRecurso chama a RPC e devolve o mapa; erro de negócio sobe', async () => {
    respostas.rpc.recurso_definir = { data: { chat: false }, error: null }
    expect(await definirRecurso('chat', false)).toEqual({ chat: false })
    expect(chamadas).toContainEqual(['rpc', 'recurso_definir', { p_feature: 'chat', p_enabled: false }])
    respostas.rpc.recurso_definir = { data: null, error: { message: 'Há leilão aberto: encerre ou cancele antes de desligar o leilão.' } }
    await expect(definirRecurso('leilao', false)).rejects.toThrow('leilão aberto')
  })
  it('catálogo: lista as linhas; erro sobe', async () => {
    respostas.tabelas.recursos_catalogo = { data: [{ chave: 'chat' }], error: null }
    expect(await carregarCatalogoRecursos()).toEqual([{ chave: 'chat' }])
    respostas.tabelas.recursos_catalogo = { data: null, error: { message: 'negado' } }
    await expect(carregarCatalogoRecursos()).rejects.toThrow('negado')
  })
})

describe('subirLogoDoClube: só no bucket publico, na pasta do PRÓPRIO clube', () => {
  const arquivo = { name: 'logo.png' }
  it('sobe em publico/<clube>/logo-<ts>.<ext> e devolve a URL pública', async () => {
    validarImagem.mockResolvedValue({ midia: 'imagem', ext: 'png' })
    const url = await subirLogoDoClube({ clubeId: 'clube-1', file: arquivo })
    const up = chamadas.find((c) => c[0] === 'upload')
    expect(up[1]).toBe('publico')
    expect(up[2]).toMatch(/^clube-1\/logo-\d+\.png$/)
    expect(url).toMatch(/\/storage\/v1\/object\/public\/publico\/clube-1\/logo-\d+\.png$/)
    expect(validarImagem).toHaveBeenCalledWith(arquivo, { maxMB: 5 })
  })
  it('HEIC não vale para a logo (o bucket público não aceita)', async () => {
    validarImagem.mockResolvedValue({ midia: 'imagem', ext: 'heic' })
    await expect(subirLogoDoClube({ clubeId: 'c', file: arquivo })).rejects.toThrow('JPG, PNG, WebP ou GIF')
    expect(chamadas.some((c) => c[0] === 'upload')).toBe(false)
  })
  it('arquivo inválido (validarImagem recusa) não sobe nada', async () => {
    validarImagem.mockRejectedValue(new Error('Esse arquivo não é uma foto válida'))
    await expect(subirLogoDoClube({ clubeId: 'c', file: arquivo })).rejects.toThrow('não é uma foto')
    expect(chamadas.some((c) => c[0] === 'upload')).toBe(false)
  })
  it('sem clube não sobe', async () => {
    await expect(subirLogoDoClube({ clubeId: null, file: arquivo })).rejects.toThrow('Clube não identificado')
  })
  it('erro do Storage vira mensagem em português', async () => {
    validarImagem.mockResolvedValue({ midia: 'imagem', ext: 'png' })
    respostas.upload = { error: { message: 'new row violates row-level security policy' } }
    await expect(subirLogoDoClube({ clubeId: 'c', file: arquivo })).rejects.toThrow('Não foi possível enviar a logo')
  })
})
