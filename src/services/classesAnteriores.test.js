import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const upload = vi.fn()
const remove = vi.fn()
const from = vi.fn(() => ({ upload: (...a) => upload(...a), remove: (...a) => remove(...a), createSignedUrl: vi.fn() }))
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), storage: { from: (...a) => from(...a) } } }))
const processarImagem = vi.fn()
vi.mock('../lib/imagens/processar.js', () => ({ processarImagem: (...a) => processarImagem(...a) }))

const { registrarClasseAnterior, revogarRegistroAnterior, carregarConclusoesDoMembro } = await import('./classesAnteriores.js')

const CLUBE = '11111111-1111-4111-8111-111111111111'
const MEMBRO = '22222222-2222-4222-8222-222222222222'
const base = { usuarioId: MEMBRO, classId: 'cls1', data: '2024-05-10', dataDesconhecida: false, observacao: ' Cartão conferido ', clubeId: CLUBE }

beforeEach(() => {
  for (const f of [rpc, upload, remove, processarImagem, from]) f.mockClear()
  processarImagem.mockResolvedValue({ principal: new Blob(['x']), mime: 'image/jpeg' })
  upload.mockResolvedValue({ error: null })
  remove.mockResolvedValue({ error: null })
})

describe('registrarClasseAnterior', () => {
  it('payload só com ids, data, observação e caminho; sem arquivo não sobe nada', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await registrarClasseAnterior(base)
    expect(rpc).toHaveBeenCalledWith('classe_concluida_anteriormente_registrar', {
      p_usuario_id: MEMBRO, p_class_id: 'cls1', p_concluida_em: '2024-05-10', p_data_desconhecida: false,
      p_observacao: 'Cartão conferido', p_comprovante_path: null,
    })
    expect(upload).not.toHaveBeenCalled()
  })
  it('data desconhecida manda data nula', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await registrarClasseAnterior({ ...base, dataDesconhecida: true, data: '2024-05-10' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_concluida_em: null, p_data_desconhecida: true })
  })
  it('comprovante: sobe em clube/membro/conclusao-anterior/uuid.jpg e manda o caminho do upload', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await registrarClasseAnterior({ ...base, arquivo: new File(['x'], 'foto.jpg') })
    expect(processarImagem.mock.calls[0][1]).toBe('evidencia')
    expect(from).toHaveBeenCalledWith('comprovacoes')
    const path = upload.mock.calls[0][0]
    expect(path).toMatch(new RegExp(`^${CLUBE}/${MEMBRO}/conclusao-anterior/[0-9a-f-]{36}\\.jpg$`))
    expect(rpc.mock.calls[0][1].p_comprovante_path).toBe(path)
  })
  it('se o registro falhar, o arquivo enviado é apagado', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Esta classe já consta como concluída por esta pessoa.' } })
    await expect(registrarClasseAnterior({ ...base, arquivo: new File(['x'], 'f.jpg') })).rejects.toThrow(/já consta/)
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]])
  })
  it('ok:false também apaga o arquivo', async () => {
    rpc.mockResolvedValue({ data: { ok: false }, error: null })
    await expect(registrarClasseAnterior({ ...base, arquivo: new File(['x'], 'f.jpg') })).rejects.toThrow()
    expect(remove).toHaveBeenCalledTimes(1)
  })
  it('falha de upload não chama o registro', async () => {
    upload.mockResolvedValue({ error: { message: 'boom' } })
    await expect(registrarClasseAnterior({ ...base, arquivo: new File(['x'], 'f.jpg') })).rejects.toThrow(/comprovante/)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('revogar e listar', () => {
  it('revoga com id e motivo', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await revogarRegistroAnterior('a1', ' lançado errado ')
    expect(rpc).toHaveBeenCalledWith('classe_concluida_anteriormente_revogar', { p_achievement_id: 'a1', p_motivo: 'lançado errado' })
  })
  it('lista: banco sem a 521 = indisponível, sem lançar', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.classe_concluidas_do_membro in the schema cache' } })
    expect(await carregarConclusoesDoMembro(MEMBRO)).toEqual({ disponivel: false, itens: [] })
  })
  it('lista: outro erro lança', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Sem permissão' } })
    await expect(carregarConclusoesDoMembro(MEMBRO)).rejects.toThrow()
  })
})
