import { describe, it, expect, beforeEach } from 'vitest'
import { guardarRetorno, lerRetorno, limparRetorno } from './retornoPosLogin.js'

describe('retornoPosLogin', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('guarda e lê um caminho relativo', () => {
    guardarRetorno('/entrar?codigo=ABCD')
    expect(lerRetorno()).toBe('/entrar?codigo=ABCD')
  })

  it('limpa o retorno guardado', () => {
    guardarRetorno('/entrar?codigo=ABCD')
    limparRetorno()
    expect(lerRetorno()).toBeNull()
  })

  it('sem nada guardado, devolve null', () => {
    expect(lerRetorno()).toBeNull()
  })

  it('recusa proteger contra open-redirect: URL absoluta', () => {
    guardarRetorno('https://evil.example.com/phish')
    expect(lerRetorno()).toBeNull()
  })

  it('recusa protocolo-relativo (//host)', () => {
    guardarRetorno('//evil.example.com/phish')
    expect(lerRetorno()).toBeNull()
  })

  it('recusa valores que não são string', () => {
    guardarRetorno(null)
    guardarRetorno(undefined)
    guardarRetorno({ path: '/x' })
    expect(lerRetorno()).toBeNull()
  })

  it('aceita caminho simples sem query', () => {
    guardarRetorno('/gestao/inscricoes')
    expect(lerRetorno()).toBe('/gestao/inscricoes')
  })
})
