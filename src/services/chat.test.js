import { describe, it, expect, vi, beforeEach } from 'vitest'

// Construtor de consulta "thenable": cada método devolve ele mesmo; await devolve o resultado combinado.
function consulta(resultado) {
  const c = { chamadas: {} }
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'maybeSingle']) {
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

const { carregarChatGeral } = await import('./chat.js')

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
