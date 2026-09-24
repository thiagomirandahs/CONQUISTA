import { describe, it, expect, vi, beforeEach } from 'vitest'

// Construtor de consulta "thenable": cada método devolve ele mesmo; await devolve o resultado combinado.
function consulta(resultado) {
  const c = { chamadas: {} }
  for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'maybeSingle']) {
    c[m] = vi.fn((...args) => { c.chamadas[m] = args; return c })
  }
  c.then = (res, rej) => Promise.resolve(resultado).then(res, rej)
  return c
}

let qConversa, qMensagens, qPerfis
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (tabela) => ({ chat_conversas: qConversa, chat_mensagens_visiveis: qMensagens, profiles: qPerfis }[tabela]),
  },
}))

const { carregarChatGeral, carregarMensagensDesde, ultimoCarimbo } = await import('./chat.js')

beforeEach(() => {
  qConversa = consulta({ data: { id: 'c1' }, error: null })
  qPerfis = consulta({ data: [{ id: 'u1', nome: 'Ana', foto: null }], error: null })
})

describe('chat — carrega as mensagens MAIS RECENTES (o limite de 1000 linhas do PostgREST mostrava as mais antigas)', () => {
  it('pede em ordem decrescente com limite e devolve em ordem de leitura (antiga -> nova)', async () => {
    qMensagens = consulta({
      data: [
        { id: 'm3', autor_id: 'u1', texto: 'terceira', created_at: '2026-01-03', apagada: false },
        { id: 'm2', autor_id: 'u1', texto: 'segunda', created_at: '2026-01-02', apagada: false },
        { id: 'm1', autor_id: 'u1', texto: 'primeira', created_at: '2026-01-01', apagada: false },
      ],
      error: null,
    })
    const { conversaId, mensagens } = await carregarChatGeral()
    expect(conversaId).toBe('c1')
    expect(qMensagens.chamadas.order).toEqual(['created_at', { ascending: false }])
    expect(qMensagens.chamadas.limit).toEqual([300])
    expect(mensagens.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(mensagens[0].autor.nome).toBe('Ana')
  })

  it('autor que o membro não enxerga vira "?" (sem quebrar a tela)', async () => {
    qMensagens = consulta({ data: [{ id: 'm1', autor_id: 'u-inativo', texto: 'oi', created_at: '2026-01-01', apagada: false }], error: null })
    qPerfis = consulta({ data: [], error: null })
    const { mensagens } = await carregarChatGeral()
    expect(mensagens[0].autor.nome).toBe('?')
  })

  it('sem conversa ainda: lista vazia', async () => {
    qConversa = consulta({ data: null, error: null })
    qMensagens = consulta({ data: [], error: null })
    expect(await carregarChatGeral()).toEqual({ conversaId: null, mensagens: [] })
  })

  it('erro do banco aparece para a pessoa', async () => {
    qMensagens = consulta({ data: null, error: { message: 'boom' } })
    await expect(carregarChatGeral()).rejects.toThrow('boom')
  })
})

// Achado F-R4 da revisão da fase 9.1: o reforço do tempo real relia as 300 mensagens mais recentes
// a cada 15 s (~68 KB por vez numa conversa cheia). A releitura agora pede só o que é novo.
describe('chat — releitura INCREMENTAL da conversa aberta', () => {
  it('pede a partir da última mensagem da tela (com 30 s de folga), em ordem de leitura', async () => {
    qMensagens = consulta({ data: [{ id: 'm9', autor_id: 'u1', texto: 'nova', created_at: '2026-09-24T12:00:10.000Z', apagada: false }], error: null })
    const lidas = await carregarMensagensDesde('c1', '2026-09-24T12:00:00.123456+00:00', { u1: { id: 'u1', nome: 'Ana', foto: null } })
    expect(qMensagens.chamadas.eq).toEqual(['conversa_id', 'c1'])
    // a folga cobre a mensagem de carimbo menor que fica visível DEPOIS (transações concorrentes)
    expect(qMensagens.chamadas.gte).toEqual(['created_at', '2026-09-24T11:59:30.123Z'])
    expect(qMensagens.chamadas.order).toEqual(['created_at', { ascending: true }])
    expect(lidas.map((m) => m.id)).toEqual(['m9'])
    expect(lidas[0].autor.nome).toBe('Ana')
  })

  it('autor que a tela já conhece não gera consulta de perfil; só o autor novo é buscado', async () => {
    qMensagens = consulta({
      data: [
        { id: 'm1', autor_id: 'u1', texto: 'a', created_at: '2026-09-24T12:00:01Z', apagada: false },
        { id: 'm2', autor_id: 'u2', texto: 'b', created_at: '2026-09-24T12:00:02Z', apagada: false },
      ],
      error: null,
    })
    qPerfis = consulta({ data: [{ id: 'u2', nome: 'Bia', foto: null }], error: null })
    const lidas = await carregarMensagensDesde('c1', '2026-09-24T12:00:00Z', { u1: { id: 'u1', nome: 'Ana' } })
    expect(qPerfis.chamadas.in).toEqual(['id', ['u2']])
    expect(lidas.map((m) => m.autor.nome)).toEqual(['Ana', 'Bia'])
  })

  it('nada novo: nenhuma consulta de perfil', async () => {
    qMensagens = consulta({ data: [], error: null })
    qPerfis = consulta({ data: [], error: null })
    expect(await carregarMensagensDesde('c1', '2026-09-24T12:00:00Z', {})).toEqual([])
    expect(qPerfis.chamadas.in).toBeUndefined()
  })

  it('sem mensagem na tela (desde vazio): leitura completa, a de sempre', async () => {
    qMensagens = consulta({ data: [], error: null })
    await carregarMensagensDesde('c1', null, {})
    expect(qMensagens.chamadas.gte).toBeUndefined()
    expect(qMensagens.chamadas.order).toEqual(['created_at', { ascending: false }])
    expect(qMensagens.chamadas.limit).toEqual([300])
  })

  it('erro do banco sobe (quem chama decide se mostra)', async () => {
    qMensagens = consulta({ data: null, error: { message: 'boom' } })
    await expect(carregarMensagensDesde('c1', '2026-09-24T12:00:00Z', {})).rejects.toThrow('boom')
  })

  it('ultimoCarimbo: o mais recente pelo VALOR (a do tempo real entra no fim sem reordenar)', () => {
    expect(ultimoCarimbo([
      { created_at: '2026-09-24T12:00:05Z' },
      { created_at: '2026-09-24T12:00:09Z' },
      { created_at: '2026-09-24T12:00:07Z' },
    ])).toBe('2026-09-24T12:00:09Z')
    expect(ultimoCarimbo([])).toBeNull()
    expect(ultimoCarimbo(undefined)).toBeNull()
    expect(ultimoCarimbo([{ created_at: 'lixo' }])).toBeNull()
  })
})
