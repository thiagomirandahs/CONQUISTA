// Contrato do tratamento de erro permanente de push (migration 534 + Edge Function enviar-push).
// Estático de propósito: o replay SQL roda no agente principal; aqui só travamos as decisões que não podem regredir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const edge = readFileSync('supabase/functions/enviar-push/index.ts', 'utf8')
const mig = readFileSync('supabase/migrations/20260930000534_push-erro-permanente-e-poda.sql', 'utf8')

describe('enviar-push: erro permanente', () => {
  it('remove a inscrição web só em 404/410 e só a do endpoint que falhou', () => {
    expect(edge).toMatch(/statusCode === 404 \|\| e\?\.statusCode === 410/)
    expect(edge).toMatch(/from\('push_subscriptions'\)\.delete\(\)\.eq\('endpoint', s\.endpoint\)/)
  })
  it('nunca apaga por 400/401/403 (pode ser a chave do servidor, não o aparelho)', () => {
    expect(edge).not.toMatch(/statusCode === 40[0-3]/)
    expect(edge).not.toMatch(/resp\.status === 40[0-3]/)
  })
  it('falha ao remover é registrada (infra_falhas), sem texto do provedor', () => {
    expect(edge).toMatch(/erroRemocao\) await registrarFalha\('push: não removeu inscrição expirada/)
  })
})

describe('migration 534: poda segura', () => {
  it('o padrão da poda é ENSAIO', () => {
    expect(mig).toMatch(/p_aplicar boolean default false/)
  })
  it('não agenda nada sozinha (poda é decisão do dono)', () => {
    expect(mig).not.toMatch(/cron\.schedule/)
  })
  it('só service_role executa; a função que devolve credencial crua não é executável por ninguém', () => {
    expect(mig).toMatch(/revoke all on function public\._push_mortas\(int, int\) from public, authenticated, anon, service_role/)
    expect(mig).toMatch(/grant execute on function public\.push_podar_inscricoes_mortas\(boolean, int, int\) to service_role/)
    expect(mig).not.toMatch(/grant execute[^;]*to (authenticated|anon)/)
  })
  it('falha temporária nunca é "permanente"', () => {
    const bloco = mig.match(/permanentes\(codigo\) as \(\s*values([^)]*)\)\s*\)/s)?.[1] || mig.match(/permanentes\(codigo\) as \(\s*values (.*)/)?.[1] || ''
    for (const temp of ['rede', 'timeout', '429', '500', '502', '503', '504', 'oauth']) expect(bloco).not.toContain(`'${temp}'`)
    expect(bloco).toContain("'410'")
  })
  it('exige prova de que o provedor funciona para outros aparelhos e nunca entrega prévia', () => {
    expect(mig).toMatch(/where t\.ok = 0/)
    expect(mig).toMatch(/exists \(select 1 from saudaveis/)
  })
})
