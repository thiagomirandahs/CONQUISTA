import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachePrivadoValido, VALIDADE_URL_PRIVADA_S } from '../../../src/lib/imagens/politica.js'
import { limparSessaoLocal } from '../../../src/lib/limparSessaoLocal.js'

test('URL privada antiga de 24 horas não é reutilizada', () => {
  const agora = 1000000
  assert.equal(cachePrivadoValido(agora + 24 * 3600 * 1000, agora), false)
})
test('URL ainda válida pode ser reutilizada e é renovada perto do vencimento', () => {
  const agora = 1000000
  assert.equal(cachePrivadoValido(agora + VALIDADE_URL_PRIVADA_S * 1000, agora), true)
  assert.equal(cachePrivadoValido(agora + 59000, agora), false)
  assert.equal(cachePrivadoValido(agora - 1, agora), false)
  assert.equal(cachePrivadoValido(NaN, agora), false)
})
test('limpeza remove credencial e retorno sem apagar configurações não relacionadas', () => {
  const localAntes = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const sessaoAntes = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const itens = new Map([['sessao', 'credencial'], ['preferencia', 'valor']])
  const retornos = new Map([['pos-login-retorno', '/entrar?codigo=segredo'], ['outra', 'valor']])
  let imagens = false, rascunhos = false
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { removeItem: k => itens.delete(k) } })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { removeItem: k => retornos.delete(k) } })
    limparSessaoLocal({ chaveSessao: 'sessao', limparImagens: () => { imagens = true }, limparRascunhos: () => { rascunhos = true } })
    assert.equal(itens.has('sessao'), false)
    assert.equal(itens.has('preferencia'), true)
    assert.equal(retornos.has('pos-login-retorno'), false)
    assert.equal(retornos.has('outra'), true)
    assert.equal(imagens && rascunhos, true)
  } finally {
    if (localAntes) Object.defineProperty(globalThis, 'localStorage', localAntes); else delete globalThis.localStorage
    if (sessaoAntes) Object.defineProperty(globalThis, 'sessionStorage', sessaoAntes); else delete globalThis.sessionStorage
  }
})
test('falha em storage e cache não impede apagar rascunhos', () => {
  const antes = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let limpou = false
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('bloqueado') } })
    assert.doesNotThrow(() => limparSessaoLocal({ chaveSessao: 'sessao', limparImagens() { throw new Error('cache') }, limparRascunhos() { limpou = true } }))
    assert.equal(limpou, true)
  } finally {
    if (antes) Object.defineProperty(globalThis, 'localStorage', antes); else delete globalThis.localStorage
  }
})
