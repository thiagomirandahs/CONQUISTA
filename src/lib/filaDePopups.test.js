import { describe, it, expect } from 'vitest'
import { criarFilaDePopups } from './filaDePopups.js'

const tique = () => new Promise((r) => setTimeout(r, 0))

describe('filaDePopups: um popup por vez', () => {
  it('o primeiro a pedir entra na hora; o segundo espera a liberação', async () => {
    const f = criarFilaDePopups()
    let bAbriu = false
    await f.pedir('a')
    expect(f.emExibicao()).toBe('a')
    f.pedir('b').then(() => { bAbriu = true })
    await tique()
    expect(bAbriu).toBe(false)
    expect(f.esperando()).toBe(1)
    f.liberar('a')
    await tique()
    expect(bAbriu).toBe(true)
    expect(f.emExibicao()).toBe('b')
  })

  it('prioridade maior passa na frente; empate respeita a ordem de chegada', async () => {
    const f = criarFilaDePopups()
    await f.pedir('atual')
    const ordem = []
    f.pedir('baixo1', 1).then(() => ordem.push('baixo1'))
    f.pedir('baixo2', 1).then(() => ordem.push('baixo2'))
    f.pedir('alto', 10).then(() => ordem.push('alto'))
    f.liberar('atual'); await tique()
    f.liberar('alto'); await tique()
    f.liberar('baixo1'); await tique()
    expect(ordem).toEqual(['alto', 'baixo1', 'baixo2'])
  })

  it('pedir duas vezes o mesmo id não duplica na fila', async () => {
    const f = criarFilaDePopups()
    await f.pedir('a')
    const p1 = f.pedir('b')
    const p2 = f.pedir('b')
    expect(p1).toBe(p2)
    expect(f.esperando()).toBe(1)
  })

  it('quem já está na vez e pede de novo resolve na hora', async () => {
    const f = criarFilaDePopups()
    await f.pedir('a')
    await f.pedir('a')
    expect(f.emExibicao()).toBe('a')
  })

  it('desistir antes da vez tira da fila sem mexer no atual', async () => {
    const f = criarFilaDePopups()
    await f.pedir('a')
    f.pedir('b')
    f.cancelar('b')
    expect(f.esperando()).toBe(0)
    expect(f.emExibicao()).toBe('a')
  })

  it('liberar um id que não é o atual nem está na fila é inofensivo', async () => {
    const f = criarFilaDePopups()
    await f.pedir('a')
    f.liberar('zzz')
    expect(f.emExibicao()).toBe('a')
  })

  it('assinar recebe cada troca do popup atual', async () => {
    const f = criarFilaDePopups()
    const vistos = []
    const parar = f.assinar((id) => vistos.push(id))
    await f.pedir('a')
    f.liberar('a')
    parar()
    await f.pedir('b')
    expect(vistos).toEqual(['a', null])
  })

  it('exige um id', () => {
    const f = criarFilaDePopups()
    expect(() => f.pedir()).toThrow()
  })
})
