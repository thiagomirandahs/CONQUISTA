import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Contrato de segurança da Edge Function admin-comunidade-foto (Deno; não roda no vitest) e da migration 530.
const raiz = process.cwd()
const fonte = readFileSync(join(raiz, 'supabase', 'functions', 'admin-comunidade-foto', 'index.ts'), 'utf8')
const cfg = readFileSync(join(raiz, 'supabase', 'config.toml'), 'utf8')
const mig = readFileSync(join(raiz, 'supabase', 'migrations', '20260930000530_admin-storage-log-mediado.sql'), 'utf8')

describe('Edge Function admin-comunidade-foto', () => {
  it('exige JWT (verify_jwt) e CORS por lista de origens, nunca "*"', () => {
    expect(cfg).toMatch(/\[functions\.admin-comunidade-foto\]\s*\r?\nverify_jwt = true/)
    expect(fonte).not.toMatch(/Access-Control-Allow-Origin':\s*'\*'/)
    expect(fonte).toMatch(/ORIGENS\.has\(origem\)/)
  })
  it('a autorização e o log vêm da RPC chamada COM o JWT do usuário, ANTES de assinar', () => {
    const iRpc = fonte.indexOf("rpc('admin_comunidade_foto_assinar'")
    const iAssina = fonte.indexOf('createSignedUrl')
    expect(iRpc).toBeGreaterThan(0)
    expect(iAssina).toBeGreaterThan(iRpc)
    expect(fonte).toMatch(/createClient\(SUPABASE_URL, ANON_KEY, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/)
  })
  it('assina SÓ o caminho devolvido pela RPC (nada vindo do cliente) e com TTL curto', () => {
    expect(fonte).toMatch(/createSignedUrl\(autorizado\.path, TTL_SEGUNDOS\)/)
    expect(fonte).toMatch(/TTL_SEGUNDOS = 60/)
    expect(fonte).not.toMatch(/body\??\.(path|caminho|bucket)/)
  })
  it('valida tipo e UUID; não devolve erro interno do Storage nem grava a URL/token', () => {
    expect(fonte).toMatch(/UUID_OK\.test\(id\)/)
    expect(fonte).not.toMatch(/error\.message\}/)
    expect(fonte).not.toMatch(/insert|\.from\('plataforma_acesso_log'\)/)
    expect(fonte).toMatch(/no-store/)
  })
})

describe('migration 530: contrato', () => {
  it('a RPC é security definer, search_path vazio, sem EXECUTE para anon', () => {
    expect(mig).toMatch(/admin_comunidade_foto_assinar\(p_tipo text, p_id uuid\)[\s\S]*security definer set search_path = ''/)
    expect(mig).toMatch(/revoke all on function public\.admin_comunidade_foto_assinar\(text, uuid\) from public, anon/)
  })
  it('a policy de leitura não chama mais o registro do admin nem o confere (sem efeito colateral)', () => {
    const corpoPolicy = mig.slice(mig.indexOf('function public._comunidade_pode_ver_foto'))
    expect(corpoPolicy).toMatch(/language plpgsql stable/)
    expect(corpoPolicy).not.toMatch(/_plataforma_acesso_registrar|eh_admin_plataforma/)
  })
  it('só ADICIONA (colunas nullable) e não mexe em migrations antigas nem no front antigo', () => {
    expect(mig).toMatch(/add column if not exists bucket text;/)
    expect(mig).toMatch(/add column if not exists contexto text;/)
    expect(mig).not.toMatch(/drop (table|function|column)/i)
  })
})
