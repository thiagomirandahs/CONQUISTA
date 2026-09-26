import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  enfileirar, itensDaFila, enviarFila, limparExpirados, ehErroDeRede, mensagemDoErroDeJogo,
  semanaSP, MAX_ITENS, VALIDADE_MS, PREFIXO_FILA,
} from './filaJogos.js'

const AGORA = new Date('2026-09-23T15:00:00Z') // quarta, 12h em São Paulo
const REDE = () => new TypeError('Failed to fetch')
const REGRA = (m) => new Error(m)

beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())

describe('fila offline — isolamento por usuário e clube', () => {
  it('cada conta (e cada clube) tem a sua fila; um nunca vê o do outro', () => {
    enfileirar({ uid: 'A', clube: 'C1', tipo: 'recorde', jogo: 'reflexo', valor: 50 }, AGORA)
    enfileirar({ uid: 'B', clube: 'C1', tipo: 'recorde', jogo: 'reflexo', valor: 70 }, AGORA)
    enfileirar({ uid: 'A', clube: 'C2', tipo: 'recorde', jogo: 'reflexo', valor: 90 }, AGORA)
    expect(itensDaFila('A', 'C1').map((i) => i.valor)).toEqual([50])
    expect(itensDaFila('B', 'C1').map((i) => i.valor)).toEqual([70])
    expect(itensDaFila('A', 'C2').map((i) => i.valor)).toEqual([90])
  })

  it('reenvio só manda o que é do usuário+clube atual; item forjado de outro uid é descartado', async () => {
    enfileirar({ uid: 'A', clube: 'C1', tipo: 'recorde', jogo: 'reflexo', valor: 50 }, AGORA)
    enfileirar({ uid: 'B', clube: 'C1', tipo: 'recorde', jogo: 'reflexo', valor: 70 }, AGORA)
    // alguém enfia na chave de A um item de B
    const k = `${PREFIXO_FILA}A:C1`
    const v = JSON.parse(localStorage.getItem(k)); v.push({ ...v[0], id: 'x', uid: 'B', valor: 99 })
    localStorage.setItem(k, JSON.stringify(v))
    const enviar = vi.fn().mockResolvedValue({})
    const r = await enviarFila({ uid: 'A', clube: 'C1', enviar, agora: AGORA })
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(enviar.mock.calls[0][0]).toMatchObject({ uid: 'A', valor: 50 })
    expect(r).toMatchObject({ enviados: 1, descartados: 1, restantes: 0 })
    expect(itensDaFila('B', 'C1')).toHaveLength(1) // a fila do irmão continua lá
  })

  it('sem uid ou sem clube não guarda nada', () => {
    expect(enfileirar({ uid: null, clube: 'C1', tipo: 'recorde', jogo: 'reflexo', valor: 5 })).toBe(false)
    expect(enfileirar({ uid: 'A', clube: null, tipo: 'recorde', jogo: 'reflexo', valor: 5 })).toBe(false)
  })
})

describe('fila offline — reenvio', () => {
  it('recorde: guarda só o melhor por jogo/semana', () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 30, partida: 'p1' }, AGORA)
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 20, partida: 'p1' }, AGORA)
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45, partida: 'p1' }, AGORA)
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'corrida', valor: 10 }, AGORA)
    expect(itensDaFila('A', 'C').map((i) => [i.jogo, i.valor])).toEqual([['reflexo', 45], ['corrida', 10]])
  })

  it('envia com a partida; se ela expirou, tenta UMA vez sem partida', async () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45, partida: 'p1' }, AGORA)
    const enviar = vi.fn()
      .mockRejectedValueOnce(REGRA('Partida inválida ou expirada — abra o jogo de novo. 🙂'))
      .mockResolvedValueOnce({ recorde: 45 })
    const r = await enviarFila({ uid: 'A', clube: 'C', enviar, agora: AGORA })
    expect(enviar.mock.calls.map((c) => c[1])).toEqual(['p1', null])
    expect(r).toMatchObject({ enviados: 1, restantes: 0 })
  })

  it('erro de REGRA descarta o item (não repete para sempre)', async () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'jogo', jogo: 'memoria', valor: 3, partida: 'p9' }, AGORA)
    const enviar = vi.fn().mockRejectedValue(REGRA('Você já jogou esse jogo hoje! Escolha outro 🙂'))
    const r = await enviarFila({ uid: 'A', clube: 'C', enviar, agora: AGORA })
    expect(r).toMatchObject({ enviados: 0, descartados: 1, restantes: 0 })
    expect(itensDaFila('A', 'C')).toHaveLength(0)
    await enviarFila({ uid: 'A', clube: 'C', enviar, agora: AGORA })
    expect(enviar).toHaveBeenCalledTimes(1) // não tentou de novo
  })

  it('partida expirada + sem partida recusada por regra = descarta', async () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45, partida: 'p1' }, AGORA)
    const enviar = vi.fn()
      .mockRejectedValueOnce(REGRA('Partida inválida ou expirada — abra o jogo de novo. 🙂'))
      .mockRejectedValueOnce(REGRA('Feche e abra o app pra atualizar, aí é só jogar de novo. 🙂'))
    const r = await enviarFila({ uid: 'A', clube: 'C', enviar, agora: AGORA })
    expect(r).toMatchObject({ descartados: 1, restantes: 0 })
  })

  it('rede caiu no meio: para e mantém o resto para depois', async () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45 }, AGORA)
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'corrida', valor: 12 }, AGORA)
    const enviar = vi.fn().mockRejectedValue(REDE())
    const r = await enviarFila({ uid: 'A', clube: 'C', enviar, agora: AGORA })
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ enviados: 0, descartados: 0, restantes: 2 })
  })

  it('recorde de outra semana / jogo de outro dia não entra (cairia no período errado)', async () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45 }, AGORA)
    enfileirar({ uid: 'A', clube: 'C', tipo: 'jogo', jogo: 'memoria', valor: 2 }, AGORA)
    const depois = new Date(AGORA.getTime() + 6 * 24 * 3600 * 1000) // outra semana
    expect(semanaSP(depois)).not.toBe(semanaSP(AGORA))
    const enviar = vi.fn().mockResolvedValue({})
    const r = await enviarFila({ uid: 'A', clube: 'C', enviar, agora: depois })
    expect(enviar).not.toHaveBeenCalled()
    expect(r).toMatchObject({ descartados: 2, restantes: 0 })
  })
})

describe('fila offline — limite e expiração', () => {
  it(`guarda no máximo ${MAX_ITENS} itens (os mais novos)`, () => {
    for (let i = 0; i < MAX_ITENS + 5; i++) {
      enfileirar({ uid: 'A', clube: 'C', tipo: 'jogo', jogo: 'j' + i, valor: 1 }, AGORA)
    }
    const itens = itensDaFila('A', 'C')
    expect(itens).toHaveLength(MAX_ITENS)
    expect(itens[0].jogo).toBe('j5')
  })

  it('itens com mais de 7 dias somem (de qualquer conta)', () => {
    enfileirar({ uid: 'A', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45 }, AGORA)
    enfileirar({ uid: 'B', clube: 'C', tipo: 'recorde', jogo: 'reflexo', valor: 45 }, AGORA)
    limparExpirados(new Date(AGORA.getTime() + VALIDADE_MS + 1))
    expect(itensDaFila('A', 'C')).toHaveLength(0)
    expect(itensDaFila('B', 'C')).toHaveLength(0)
    expect(Object.keys(localStorage).filter((k) => k.startsWith(PREFIXO_FILA))).toHaveLength(0)
  })
})

describe('mensagem na tela', () => {
  it('mostra a mensagem REAL do servidor quando é regra', () => {
    expect(mensagemDoErroDeJogo(REGRA('Rápido demais — jogue de verdade! 🙂'))).toBe('Rápido demais — jogue de verdade! 🙂')
    expect(mensagemDoErroDeJogo(REGRA('Partida inválida ou expirada — abra o jogo de novo. 🙂'))).toMatch(/Partida inválida/)
  })
  it('"sem internet" só quando é rede de verdade', () => {
    expect(mensagemDoErroDeJogo(REDE())).toMatch(/sem internet/)
    expect(mensagemDoErroDeJogo(REGRA('TypeError: Failed to fetch'))).toMatch(/sem internet/)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(mensagemDoErroDeJogo(REGRA('qualquer coisa'))).toMatch(/sem internet/)
  })
  it('ehErroDeRede não confunde regra com rede', () => {
    expect(ehErroDeRede(REGRA('Esse resultado não bate com o tempo de jogo. 🙂'))).toBe(false)
    expect(ehErroDeRede(REGRA('Não autenticado.'))).toBe(false)
  })
})

describe('registrarRecorde — integra a fila', () => {
  it('rede caiu: guarda e devolve { guardado }; regra: sobe a mensagem', async () => {
    vi.resetModules()
    const rpc = vi.fn()
    vi.doMock('../lib/supabase.js', () => ({
      supabase: { rpc: (...a) => rpc(...a), auth: { getSession: async () => ({ data: { session: { user: { id: 'U1' } } } }) } },
      clubeAtivoNoTransporte: () => 'CL1',
    }))
    vi.doMock('./config.js', () => ({ gravarConfig: vi.fn() }))
    vi.doMock('./membros.js', () => ({ membrosDoClube: vi.fn() }))
    const { registrarRecorde } = await import('./jogos.js')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    await expect(registrarRecorde('reflexo', 122)).resolves.toMatchObject({ guardado: true })
    expect(itensDaFila('U1', 'CL1')).toHaveLength(1)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Rápido demais — jogue de verdade! 🙂' } })
    await expect(registrarRecorde('reflexo', 5)).rejects.toThrow(/Rápido demais/)
    vi.doUnmock('../lib/supabase.js'); vi.doUnmock('./config.js'); vi.doUnmock('./membros.js')
  })
})
