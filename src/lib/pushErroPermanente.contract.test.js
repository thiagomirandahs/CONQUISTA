// Contrato do tratamento de erro permanente de push (migration 534 + Edge Function enviar-push).
// Estático de propósito: o replay SQL e o E2E (supabase/tests/e2e/push-erro-permanente.mjs) rodam no Docker; aqui só travamos
// as decisões que não podem regredir. A classificação por status é testada de verdade em pushClassificacao.test.js.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const edge = readFileSync('supabase/functions/enviar-push/index.ts', 'utf8')
const cls = readFileSync('supabase/functions/_compartilhado/push-erro.ts', 'utf8')
const mig = readFileSync('supabase/migrations/20260930000534_push-erro-permanente-e-poda.sql', 'utf8')

describe('enviar-push: erro permanente', () => {
  it('só remove quando a classificação diz "remover", e só a credencial que falhou (RPC atômica)', () => {
    expect(edge).toMatch(/if \(c\.remover\) await remover\(s\.tentativa_id, s\.endpoint/)
    expect(edge).toMatch(/if \(c\.remover\) await remover\(k\.tentativa_id, k\.token/)
    expect(edge).toMatch(/rpc\('push_remover_inscricao'/)
  })
  it('nunca apaga direto por status (nada de delete fora da RPC, nada de if status 400/401/403)', () => {
    expect(edge).not.toMatch(/\.from\('push_subscriptions'\)\.delete/)
    expect(edge).not.toMatch(/\.from\('push_tokens'\)\.delete/)
    expect(edge).not.toMatch(/statusCode === 40[0-3]/)
    expect(edge).not.toMatch(/resp\.status === 40[0-3]/)
  })
  it('falha ao remover é registrada (infra_falhas), sem texto do provedor', () => {
    expect(edge).toMatch(/if \(error\) await registrarFalha\('push: não removeu credencial inválida/)
  })
  it('a mensagem de erro do FCM/OAuth não vaza (rótulo fixo)', () => {
    expect(edge).toMatch(/registrarFalha\('FCM: ' \+ rotuloErroFcm\(e\?\.message\)/)
    expect(edge).not.toMatch(/registrarFalha\('FCM: ' \+ \(e\?\.message/)
  })
  it('o corpo do erro do provedor só classifica: nunca é gravado nem logado', () => {
    expect(edge).not.toMatch(/console\.(log|error)\([^)]*corpoErro/)
    expect(edge).not.toMatch(/registrarFalha\([^)]*(corpoErro|e\?\.body|s\.endpoint|k\.token)/)
  })
})

describe('classificador: regra de ouro', () => {
  it('remove só por 404/410 (web), 404 UNREGISTERED/400 de token (FCM) e 400 que prova inscrição inválida', () => {
    expect(cls).toMatch(/status === 404 \|\| status === 410\) remover = true/)
    expect(cls).toMatch(/remover = f\.errorCode === 'UNREGISTERED'/)
    expect(cls).not.toMatch(/status === 40[13]\)[^\n]*remover = true/)
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
    expect(mig).toMatch(/revoke all on function public\._push_mortas\(int, int, uuid\) from public, authenticated, anon, service_role/)
    expect(mig).toMatch(/grant execute on function public\.push_podar_inscricoes_mortas\(boolean, int, int, uuid\) to service_role/)
    expect(mig).toMatch(/grant execute on function public\.push_remover_inscricao\(bigint, text\) to service_role/)
    expect(mig).not.toMatch(/grant execute[^;]*to (authenticated|anon)/)
  })
  it('falha temporária e não provada nunca é "permanente" (nem 400 genérico, nem 413, nem desconhecido)', () => {
    const bloco = mig.match(/permanentes\(codigo\) as \([\s\S]*?(values [^\n]*)\n/)?.[1] ?? ''
    expect(bloco).toContain("'410'")
    for (const nao of ['rede', 'timeout', '408', '429', '500', '502', '503', '504', 'oauth', 'desconhecido', "'400'", "'413'"]) expect(bloco).not.toContain(nao)
  })
  it('exige nunca-entregou-desde-o-registro, só tentativa posterior ao registro e prova de saúde do provedor nas 24 h da última falha', () => {
    expect(mig).toMatch(/where t\.ok = 0/)
    expect(mig).toMatch(/t\.quando > s\.registrada_em/)
    expect(mig).toMatch(/t\.quando > k\.registrada_em/)
    expect(mig).toMatch(/g\.quando >= t\.ultima - interval '1 day'/)
  })
  it('a poda confere registrada_em no DELETE (poda concorrente com nova inscrição)', () => {
    expect(mig).toMatch(/s\.registrada_em = m\.registrada_em/)
    expect(mig).toMatch(/k\.registrada_em = m\.registrada_em/)
  })
  it('toda função security definer tem search_path vazio', () => {
    for (const m of mig.matchAll(/create or replace function public\.([a-z_]+)\([\s\S]*?\bas \$\$/g)) {
      if (/security definer/.test(m[0])) expect(m[0], m[1]).toMatch(/set search_path = ''/)
    }
  })
})
