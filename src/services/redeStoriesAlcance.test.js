// Stories para todos na Comunidade (535): o serviço fala com as MESMAS RPCs de sempre (rede_stories, rede_story_publicar),
// só acrescenta p_alcance quando é 'comunidade'. O alcance 'clube' continua chamando SEM argumento (idêntico ao app
// publicado) — assim o front novo funciona no banco antigo (534) e o banco novo (535) funciona com o front antigo.
// Com o banco sem a 535, a faixa da Comunidade degrada (null) e publicar lá dá mensagem amigável, apagando a foto subida.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const upload = vi.fn(async () => ({ error: null }))
const remove = vi.fn(async () => ({}))
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), storage: { from: () => ({ upload: (...a) => upload(...a), remove: (...a) => remove(...a) }) } } }))
vi.mock('../lib/saneamentoImagem.js', () => ({ solicitarSaneamento: vi.fn() }))

const { carregarStories, publicarStory, STORY_COMUNIDADE_INDISPONIVEL } = await import('./rede.js')
const foto = { arquivo: new File(['x'], 'a.webp', { type: 'image/webp' }) }
const semFuncao = { code: 'PGRST202', message: 'Could not find the function public.rede_stories(p_alcance) in the schema cache' }

beforeEach(() => { rpc.mockReset(); upload.mockClear(); remove.mockClear() })

describe('carregarStories', () => {
  it("'clube' (padrão) chama rede_stories SEM argumento, como o app antigo", async () => {
    rpc.mockResolvedValue({ data: [{ meu: true }], error: null })
    expect(await carregarStories()).toEqual([{ meu: true }])
    expect(await carregarStories('clube')).toEqual([{ meu: true }])
    expect(rpc.mock.calls).toEqual([['rede_stories', undefined], ['rede_stories', undefined]])
  })
  it("'comunidade' manda p_alcance", async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await carregarStories('comunidade')).toEqual([])
    expect(rpc).toHaveBeenCalledWith('rede_stories', { p_alcance: 'comunidade' })
  })
  it('banco ainda sem a 535: devolve null (a tela esconde a faixa), sem lançar', async () => {
    rpc.mockResolvedValue({ data: null, error: semFuncao })
    expect(await carregarStories('comunidade')).toBeNull()
  })
  it('outro erro do servidor continua sendo erro', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'A Comunidade não está liberada neste clube.' } })
    await expect(carregarStories('comunidade')).rejects.toThrow('não está liberada')
  })
  it('alcance inventado nem chega ao servidor', async () => {
    await expect(carregarStories('amigos')).rejects.toThrow('Alcance inválido')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('publicarStory', () => {
  it("alcance padrão 'clube': a RPC recebe só p_foto_path e p_texto (chamada idêntica à antiga)", async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'publicado' }, error: null })
    const r = await publicarStory({ foto, texto: 'oi', clubeId: 'c1', userId: 'u1' })
    expect(r.ok).toBe(true)
    const [nome, args] = rpc.mock.calls[0]
    expect(nome).toBe('rede_story_publicar')
    expect(Object.keys(args).sort()).toEqual(['p_foto_path', 'p_texto'])
    expect(args.p_foto_path).toMatch(/^c1\/u1\/.+\.webp$/)
  })
  it("'comunidade' acrescenta p_alcance", async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'publicado', alcance: 'comunidade' }, error: null })
    await publicarStory({ foto, texto: '', clubeId: 'c1', userId: 'u1', alcance: 'comunidade' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_alcance: 'comunidade', p_texto: null })
  })
  it('banco sem a 535: mensagem amigável e a foto que subiu é apagada', async () => {
    rpc.mockResolvedValue({ data: null, error: semFuncao })
    await expect(publicarStory({ foto, clubeId: 'c1', userId: 'u1', alcance: 'comunidade' })).rejects.toThrow(STORY_COMUNIDADE_INDISPONIVEL)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
  })
  it('recusa do servidor (triagem/limite) apaga a foto e devolve o motivo', async () => {
    rpc.mockResolvedValue({ data: { ok: false, motivo: 'limite', mensagem: 'Calma!' }, error: null })
    const r = await publicarStory({ foto, clubeId: 'c1', userId: 'u1', alcance: 'comunidade' })
    expect(r.motivo).toBe('limite')
    expect(remove).toHaveBeenCalledTimes(1)
  })
  it('alcance inventado falha antes de enviar qualquer coisa', async () => {
    await expect(publicarStory({ foto, clubeId: 'c1', userId: 'u1', alcance: 'amigos' })).rejects.toThrow('Alcance inválido')
    expect(upload).not.toHaveBeenCalled()
  })
})
