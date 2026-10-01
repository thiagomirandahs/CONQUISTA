// @vitest-environment node
// Contrato da comparação de segredo "igualSeguro" das Edge Functions de gatilho (enviar-push, sanear-imagens, storage-excluir, limpar-fotos-rede):
// tempo constante (digest SHA-256 de tamanho fixo + XOR acumulado, sem saída antecipada que dependa do conteúdo/tamanho do que o chamador mandou),
// falha fechada com segredo não configurado, e o comportamento correto. Os valores são fictícios.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(__dirname, '../../supabase/functions')
const FUNCOES = ['enviar-push', 'sanear-imagens', 'storage-excluir', 'limpar-fotos-rede']

function extrair(fn) {
  const src = readFileSync(join(raiz, fn, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
  const ini = src.indexOf('async function igualSeguro(')
  expect(ini, `${fn}: igualSeguro existe`).toBeGreaterThan(-1)
  const fim = src.indexOf('\n}\n', ini)
  const texto = src.slice(ini, fim + 2)
  return texto
}
// tira só as anotações de tipo (o corpo é JS válido) e devolve a função executável
function compilar(texto) {
  const js = texto.replace('async function igualSeguro(a: string, b: string): Promise<boolean>', 'async function igualSeguro(a, b)')
  return new Function(`return (${js.replace('async function igualSeguro', 'async function')}\n)`)()
}

describe.each(FUNCOES)('igualSeguro de %s', (fn) => {
  const texto = extrair(fn)

  it('é comparação por digest de tamanho fixo + XOR acumulado, sem comparação direta nem saída antecipada dependente do conteúdo', () => {
    expect(texto).toMatch(/crypto\.subtle\.digest\('SHA-256'/)
    expect((texto.match(/crypto\.subtle\.digest\(/g) || []).length).toBe(2)   // os DOIS lados passam pelo digest (tamanho fixo, tempo igual)
    expect(texto).toMatch(/\|=\s*\w+\[i\]\s*\^\s*\w+\[i\]/)                   // acumula a diferença byte a byte
    expect(texto).not.toMatch(/\b[ab]\s*[!=]==?\s*[ab]\b/)                    // nada de a === b
    expect(texto).not.toMatch(/localeCompare|startsWith|includes\(|indexOf\(/)
    expect(texto).not.toMatch(/\bbreak\b/)
    const laco = texto.slice(texto.indexOf('for ('), texto.indexOf('return', texto.indexOf('for (')))
    expect(laco).not.toMatch(/\breturn\b/)                                    // o laço percorre os 32 bytes SEMPRE
    // a única saída antecipada é "segredo do servidor não cadastrado" (b), que não depende do que o chamador mandou
    const retornosAntes = texto.slice(0, texto.indexOf('crypto.subtle')).match(/return false/g) || []
    expect(retornosAntes.length).toBe(1)
    expect(texto).toMatch(/if \(!b\) return false/)
  })

  it('comportamento: igual -> true; diferente (inclusive 1 char, prefixo, tamanho) -> false; segredo do servidor vazio -> false (falha fechada)', async () => {
    const igual = compilar(texto)
    const S = 'segredo-ficticio-0123456789abcdef'
    expect(await igual(S, S)).toBe(true)
    expect(await igual(S + 'x', S)).toBe(false)
    expect(await igual(S.slice(0, -1), S)).toBe(false)
    expect(await igual(S.slice(0, -1) + 'X', S)).toBe(false)
    expect(await igual('', S)).toBe(false)
    expect(await igual(S, '')).toBe(false)
    expect(await igual('', '')).toBe(false)   // nada configurado + nada enviado NÃO autoriza
    expect(await igual('x'.repeat(5000), S)).toBe(false)
  })

  it('os dois digests são calculados SEMPRE que há segredo configurado (mesma quantidade de trabalho para tamanhos e conteúdos diferentes)', async () => {
    const igual = compilar(texto)
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest')
    const S = 'segredo-ficticio-0123456789abcdef'
    for (const a of ['', 'x', S, S + 'y', 'y'.repeat(4096)]) {
      spy.mockClear()
      await igual(a, S)
      expect(spy).toHaveBeenCalledTimes(2)
    }
    spy.mockRestore()
  })
})

describe('limpar-fotos-rede: a fechadura é o segredo, validado ANTES de qualquer cliente/RPC/Storage', () => {
  const src = readFileSync(join(raiz, 'limpar-fotos-rede/index.ts'), 'utf8')
  const handler = src.slice(src.indexOf('Deno.serve'))
  it('o handler valida método e segredo e responde 401 antes da primeira chamada ao banco/Storage; sem segredo configurado nunca autoriza', () => {
    const posMetodo = handler.indexOf("!== 'POST'")
    const posSegredo = handler.indexOf("igualSeguro(req.headers.get('x-rede-limpeza-secret') ?? '', SEGREDO)")
    const pos401 = handler.indexOf('status: 401')
    const primeiroAcesso = handler.search(/\bsb\.|\.rpc\(|\.storage\b|fetch\(/)
    expect(posMetodo).toBeGreaterThan(-1)
    expect(posSegredo).toBeGreaterThan(posMetodo)
    expect(pos401).toBeGreaterThan(posSegredo)
    expect(primeiroAcesso).toBeGreaterThan(pos401)
    // o JWT do Authorization nunca é lido: a autorização não depende dele
    expect(handler).not.toMatch(/authorization/i)
    // o segredo vem do ambiente da função e o padrão é vazio (=> falha fechada em igualSeguro)
    expect(src).toMatch(/const SEGREDO = Deno\.env\.get\('REDE_LIMPEZA_SECRET'\) \?\? ''/)
  })
  it('config.toml: verify_jwt = false declarado (o cron chama sem JWT de usuário; a fechadura é o segredo)', () => {
    const toml = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8')
    expect(toml).toMatch(/\[functions\.limpar-fotos-rede\]\s*\n\s*verify_jwt\s*=\s*false/)
  })
})
