import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usuarioAutenticado } from '../../functions/_compartilhado/usuario-autenticado.js'
const req = auth => new Request('https://teste.invalid', { headers: auth ? { authorization: auth } : {} })
test('sem Bearer não consulta o Auth nem aceita sessão', async () => {
  let chamadas = 0
  const cliente = { auth: { getUser: async () => { chamadas++; return {} } } }
  assert.equal(await usuarioAutenticado(req(null), cliente), null)
  assert.equal(await usuarioAutenticado(req('Basic qualquer'), cliente), null)
  assert.equal(chamadas, 0)
})
test('token público ou de serviço sem usuário não é login', async () => {
  const cliente = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } }
  assert.equal(await usuarioAutenticado(req('Bearer publico'), cliente), null)
})
test('falha de validação fecha o acesso', async () => {
  const cliente = { auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: new Error('invalid') }) } }
  assert.equal(await usuarioAutenticado(req('Bearer invalido'), cliente), null)
})
test('usa o token recebido para validar o usuário no provedor', async () => {
  let token
  const cliente = { auth: { getUser: async t => { token = t; return { data: { user: { id: 'u' } }, error: null } } } }
  assert.deepEqual(await usuarioAutenticado(req('Bearer usuario'), cliente), { id: 'u' })
  assert.equal(token, 'usuario')
})
