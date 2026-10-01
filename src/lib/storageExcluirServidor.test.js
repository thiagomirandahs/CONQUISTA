// @vitest-environment node
// Núcleo puro da Edge Function `storage-excluir` (migration 532): segunda trava antes do remove() e tradução da resposta da API.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BUCKETS_ELEGIVEIS, bucketElegivel, caminhoSeguro, itemAceitavel, interpretarRemocao } from '../../supabase/functions/_compartilhado/storage-excluir.ts'

describe('bucketElegivel', () => {
  it('aceita só os 4 buckets do escopo do GC', () => {
    expect([...BUCKETS_ELEGIVEIS].sort()).toEqual(['comprovacoes', 'comunidade', 'imagens', 'suporte-anexos'])
    for (const b of BUCKETS_ELEGIVEIS) expect(bucketElegivel(b)).toBe(true)
  })
  it('NUNCA aceita bucket protegido, desconhecido ou valor que não é texto', () => {
    for (const b of ['publico', 'parceiros', 'documentos-emitidos', 'assinaturas-desenhadas', 'outro', '', 'Imagens', 'imagens ', null, undefined, 1, {}]) {
      expect(bucketElegivel(b)).toBe(false)
    }
  })
})

describe('caminhoSeguro', () => {
  it('aceita os formatos reais do app', () => {
    for (const c of ['perfis/3f2a-1700000000.jpg', 'mural/abc-1.webp', 'u/atividades/1.png', 'c/u/requisitos/x.jpg', 'unidades/id-emblema-1.png']) expect(caminhoSeguro(c)).toBe(true)
  })
  it('recusa traversal, absoluto, barra dupla, barra no fim, controle, contrabarra, vazio e gigante', () => {
    for (const c of ['../publico/x.png', 'a/../b', 'a/./b', '/etc/passwd', 'a//b', 'a/b/', 'a\\b', 'a/b\nc', 'a\u0000b', '', 'x'.repeat(513), null, undefined, 5]) {
      expect(caminhoSeguro(c)).toBe(false)
    }
  })
  it('512 caracteres ainda passa; 513 não', () => {
    expect(caminhoSeguro('a'.repeat(512))).toBe(true)
    expect(caminhoSeguro('a'.repeat(513))).toBe(false)
  })
})

describe('itemAceitavel', () => {
  it('exige bucket elegível E caminho seguro', () => {
    expect(itemAceitavel({ bucket: 'imagens', caminho: 'perfis/a-1.jpg' })).toBe(true)
    expect(itemAceitavel({ bucket: 'publico', caminho: 'clube/logo.png' })).toBe(false)
    expect(itemAceitavel({ bucket: 'imagens', caminho: '../publico/clube/logo.png' })).toBe(false)
    expect(itemAceitavel({ bucket: 'imagens' })).toBe(false)
    expect(itemAceitavel(null)).toBe(false)
    expect(itemAceitavel(undefined)).toBe(false)
  })
})

describe('interpretarRemocao', () => {
  it('removeu: ok', () => expect(interpretarRemocao({ data: [{ name: 'x' }], error: null })).toEqual({ ok: true, msg: 'removido' }))
  it('lista vazia: a API confirmou que não existe mais (ok, ja_ausente)', () => expect(interpretarRemocao({ data: [], error: null })).toEqual({ ok: true, msg: 'ja_ausente' }))
  it('erro: NÃO ok e a mensagem traz só o status, nunca o texto do erro (pode ter caminho)', () => {
    const r = interpretarRemocao({ data: null, error: { statusCode: '502', message: 'falha em perfis/uuid-secreto.jpg' } })
    expect(r).toEqual({ ok: false, msg: 'erro_api 502' })
    expect(JSON.stringify(r)).not.toMatch(/perfis|uuid/)
  })
  it('erro sem status: código genérico', () => expect(interpretarRemocao({ data: null, error: {} })).toEqual({ ok: false, msg: 'erro_api' }))
  it('resposta ausente ou inválida NUNCA conta como excluído', () => {
    expect(interpretarRemocao(null).ok).toBe(false)
    expect(interpretarRemocao(undefined).ok).toBe(false)
    expect(interpretarRemocao({ data: null, error: null }).ok).toBe(false)
    expect(interpretarRemocao({ data: 'x', error: null }).ok).toBe(false)
  })
})

describe('contrato da Edge Function (arquivos)', () => {
  const fn = readFileSync('supabase/functions/storage-excluir/index.ts', 'utf8')
  it('falha fechada: confere o segredo no header x-storage-excluir-secret antes de qualquer coisa', () => {
    expect(fn).toMatch(/x-storage-excluir-secret/)
    expect(fn.indexOf('igualSeguro(req')).toBeLessThan(fn.indexOf("await sb.rpc('_storage_exclusao_processar'"))
    expect(fn).toMatch(/status: 401/)
  })
  it('só apaga o que o banco devolveu: nunca lê caminho do corpo da requisição', () => {
    expect(fn).not.toMatch(/req\.(json|text|formData)\(/)
    expect(fn).toMatch(/_storage_exclusao_processar/)
    expect(fn).toMatch(/_storage_exclusao_confirmar/)
  })
  it('lote pequeno (8) e log sem caminho', () => {
    expect(fn).toMatch(/const LOTE = 8\b/)
    expect(fn).not.toMatch(/console\.(log|error)\([^)]*caminho/)
  })
  it('config.toml: verify_jwt = false (a fechadura é o segredo)', () => {
    const cfg = readFileSync('supabase/config.toml', 'utf8')
    expect(cfg).toMatch(/\[functions\.storage-excluir\]\s*\nverify_jwt = false/)
  })
})
