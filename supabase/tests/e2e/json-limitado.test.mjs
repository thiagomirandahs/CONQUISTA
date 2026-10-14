import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerJsonLimitado } from '../../functions/_compartilhado/json-limitado.js'
const req = body => new Request('https://teste.invalid', { method: 'POST', body })
test('aceita objeto JSON pequeno', async () => assert.deepEqual(await lerJsonLimitado(req('{"acao":"situacao"}')), { acao: 'situacao' }))
test('recusa excesso sem Content-Length', async () => assert.rejects(lerJsonLimitado(req('{"x":"' + 'a'.repeat(20000) + '"}')), /grande/))
test('recusa Content-Length falso pequeno pelo tamanho real', async () => {
  const r = new Request('https://teste.invalid', { method: 'POST', headers: { 'content-length': '1' }, body: '{"x":"' + 'a'.repeat(20000) + '"}' })
  await assert.rejects(lerJsonLimitado(r), /grande/)
})
test('recusa arrays e JSON inválido', async () => {
  await assert.rejects(lerJsonLimitado(req('[]')), /inválido/)
  await assert.rejects(lerJsonLimitado(req('{')))
})
test('limita leitura de um fluxo que nunca termina', async () => {
  const body = new ReadableStream({ start() {} })
  const r = new Request('https://teste.invalid', { method: 'POST', body, duplex: 'half' })
  await assert.rejects(lerJsonLimitado(r, 16384, 20), /Tempo de leitura/)
})
