// @vitest-environment node
// Leitura centralizada das chaves nas Edge Functions (supabase/functions/_compartilhado/chaves.ts):
// ordem nova -> legacy, modos, formato do pacote JSON da plataforma, e a garantia de nunca vazar o valor.
// Os valores abaixo são FICTÍCIOS e montados em tempo de execução (nenhum literal de chave no arquivo).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chaveServico, chavePublica, urlProjeto, resumoDasChaves } from '../../supabase/functions/_compartilhado/chaves.ts'

const SEC = 'sb_' + 'secret_' + 'ficticia0001'
const SEC2 = 'sb_' + 'secret_' + 'ficticia0002'
const PUB = 'sb_' + 'publishable_' + 'ficticia0001'
const JWT_SERV = ['aaaa', 'bbbb', 'cccc'].join('.')   // três partes: parece um JWT legacy, mas é lixo
const JWT_ANON = ['dddd', 'eeee', 'ffff'].join('.')
const env = (o) => (n) => o[n]

describe('chaveServico', () => {
  it('prefere SB_SECRET_KEY, depois SUPABASE_SECRET_KEYS, depois a legacy', () => {
    const todas = { SB_SECRET_KEY: SEC, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC2 }), SUPABASE_SERVICE_ROLE_KEY: JWT_SERV }
    expect(chaveServico(env(todas))).toMatchObject({ origem: 'nova', fonte: 'SB_SECRET_KEY' })
    expect(chaveServico(env(todas)).valor).toBe(SEC)
    const semPropria = { SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC2 }), SUPABASE_SERVICE_ROLE_KEY: JWT_SERV }
    expect(chaveServico(env(semPropria))).toMatchObject({ origem: 'nova', fonte: 'SUPABASE_SECRET_KEYS' })
    expect(chaveServico(env(semPropria)).valor).toBe(SEC2)
    const soLegacy = { SUPABASE_SERVICE_ROLE_KEY: JWT_SERV }
    expect(chaveServico(env(soLegacy))).toMatchObject({ origem: 'legacy', fonte: 'SUPABASE_SERVICE_ROLE_KEY' })
    expect(chaveServico(env(soLegacy)).valor).toBe(JWT_SERV)
  })

  it('só as novas (legacy ausente) funciona: é o cenário "legacy desativada"', () => {
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC }) })).origem).toBe('nova')
  })

  it('pacote JSON: usa "default" se houver, senão a primeira sb_secret_; aceita lista e objeto {api_key}', () => {
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ outra: SEC2, default: SEC }) })).valor).toBe(SEC)
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ a: 'lixo', b: SEC2 }) })).valor).toBe(SEC2)
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: JSON.stringify([SEC]) })).valor).toBe(SEC)
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: { api_key: SEC } }) })).valor).toBe(SEC)
  })

  it('apara espaço e quebra de linha nas pontas', () => {
    expect(chaveServico(env({ SB_SECRET_KEY: `  ${SEC}\n` })).valor).toBe(SEC)
  })

  it('valor em formato errado é IGNORADO (um JWT em SB_SECRET_KEY não vira chave nova; cai na legacy)', () => {
    const k = chaveServico(env({ SB_SECRET_KEY: JWT_SERV, SUPABASE_SERVICE_ROLE_KEY: JWT_SERV }))
    expect(k.origem).toBe('legacy')
    expect(() => chaveServico(env({ SB_SECRET_KEY: JWT_SERV }))).toThrow()
    expect(() => chaveServico(env({ SUPABASE_SECRET_KEYS: '{json quebrado' }))).toThrow()
    // a chave PÚBLICA nunca serve de chave de serviço
    expect(() => chaveServico(env({ SB_SECRET_KEY: PUB }))).toThrow()
    // e uma legacy sem cara de JWT é configuração errada
    expect(() => chaveServico(env({ SUPABASE_SERVICE_ROLE_KEY: 'qualquer-coisa' }))).toThrow()
  })

  it('CHAVES_MODO=nova ignora a legacy (falha fechada); CHAVES_MODO=legacy ignora as novas', () => {
    const ambas = { SB_SECRET_KEY: SEC, SUPABASE_SERVICE_ROLE_KEY: JWT_SERV }
    expect(chaveServico(env({ ...ambas, CHAVES_MODO: 'nova' })).origem).toBe('nova')
    expect(() => chaveServico(env({ SUPABASE_SERVICE_ROLE_KEY: JWT_SERV, CHAVES_MODO: 'nova' }))).toThrow()
    expect(chaveServico(env({ ...ambas, CHAVES_MODO: 'legacy' })).origem).toBe('legacy')
    expect(() => chaveServico(env({ SB_SECRET_KEY: SEC, CHAVES_MODO: 'legacy' }))).toThrow()
    // valor desconhecido de modo = auto
    expect(chaveServico(env({ ...ambas, CHAVES_MODO: 'sei-la' })).origem).toBe('nova')
  })

  it('sem nenhuma chave: erro GENÉRICO, sem nome de variável nem valor', () => {
    let msg = ''
    try { chaveServico(env({})) } catch (e) { msg = e.message }
    expect(msg).toMatch(/indispon/i)
    expect(msg).not.toMatch(/SB_|SUPABASE_|sb_|service_role/i)
  })
})

describe('chavePublica', () => {
  it('SB_PUBLISHABLE_KEY -> SUPABASE_PUBLISHABLE_KEYS -> SUPABASE_ANON_KEY (legacy)', () => {
    expect(chavePublica(env({ SB_PUBLISHABLE_KEY: PUB, SUPABASE_ANON_KEY: JWT_ANON }))).toMatchObject({ origem: 'nova', fonte: 'SB_PUBLISHABLE_KEY' })
    expect(chavePublica(env({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }), SUPABASE_ANON_KEY: JWT_ANON })).fonte).toBe('SUPABASE_PUBLISHABLE_KEYS')
    expect(chavePublica(env({ SUPABASE_ANON_KEY: JWT_ANON }))).toMatchObject({ origem: 'legacy', fonte: 'SUPABASE_ANON_KEY' })
    expect(() => chavePublica(env({}))).toThrow()
  })
  it('uma secret nunca é aceita como chave pública', () => {
    expect(() => chavePublica(env({ SB_PUBLISHABLE_KEY: SEC }))).toThrow()
  })
})

describe('urlProjeto', () => {
  it('lê SUPABASE_URL sem barra final e falha fechada se faltar', () => {
    expect(urlProjeto(env({ SUPABASE_URL: 'https://x.supabase.co/' }))).toBe('https://x.supabase.co')
    expect(() => urlProjeto(env({}))).toThrow()
  })
})

describe('o valor da chave nunca vaza', () => {
  it('JSON, template string, console e resumo mostram só origem e nome da variável', () => {
    const k = chaveServico(env({ SB_SECRET_KEY: SEC }))
    expect(JSON.stringify(k)).not.toContain(SEC)
    expect(`${k}`).not.toContain(SEC)
    expect(String(k)).not.toContain(SEC)
    expect(Object.keys(k)).toEqual(['origem', 'fonte'])
    expect(JSON.stringify(k)).toBe('{"origem":"nova","fonte":"SB_SECRET_KEY"}')
    const r = resumoDasChaves(env({ SB_SECRET_KEY: SEC, SB_PUBLISHABLE_KEY: PUB }), true)
    expect(r).not.toContain(SEC); expect(r).not.toContain(PUB)
    expect(JSON.parse(r)).toMatchObject({ servico: 'nova:SB_SECRET_KEY', publica: 'nova:SB_PUBLISHABLE_KEY', modo: 'auto' })
  })
})

describe('as 7 Edge Functions leem chaves SÓ pelo helper (contrato)', () => {
  const raiz = join(__dirname, '../../supabase/functions')
  const funcoes = readdirSync(raiz).filter((d) => d !== '_compartilhado' && statSync(join(raiz, d)).isDirectory())
  it('existem as 7 funções esperadas', () => {
    expect(funcoes.sort()).toEqual(['admin-comunidade-foto', 'enviar-push', 'gerar-documento-pdf', 'gerar-documento-pdf-final', 'limpar-fotos-rede', 'sanear-imagens', 'storage-excluir'])
  })
  for (const f of ['admin-comunidade-foto', 'enviar-push', 'gerar-documento-pdf', 'gerar-documento-pdf-final', 'limpar-fotos-rede', 'sanear-imagens', 'storage-excluir']) {
    it(`${f}: nenhum Deno.env.get de chave/URL do Supabase direto no index.ts`, () => {
      const src = readFileSync(join(raiz, f, 'index.ts'), 'utf8')
      expect(src).not.toMatch(/Deno\.env\.get\(\s*['"]SUPABASE_(SERVICE_ROLE_KEY|ANON_KEY|URL|SECRET_KEYS|PUBLISHABLE_KEYS)['"]/)
      expect(src).toContain("from '../_compartilhado/chaves.ts'")
      expect(src).toMatch(/chaveServico\(\)\.valor/)
    })
  }
  it('as que criam cliente "como o usuário" usam a chave PÚBLICA do helper (publishable com fallback), nunca a de serviço', () => {
    for (const f of ['admin-comunidade-foto', 'gerar-documento-pdf', 'gerar-documento-pdf-final']) {
      const src = readFileSync(join(raiz, f, 'index.ts'), 'utf8')
      expect(src).toMatch(/chavePublica\(\)\.valor/)
      expect(src).toMatch(/createClient\(SUPABASE_URL, ANON_KEY, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/)
    }
  })
  it('o verify_jwt de cada função no config.toml não mudou (enviar-push/sanear/storage-excluir = false; PDF e admin-comunidade-foto = true; limpar-fotos-rede segue o default da plataforma)', () => {
    const toml = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8')
    const vj = (n) => (toml.match(new RegExp(`\\[functions\\.${n}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`)) || [])[1]
    expect(vj('enviar-push')).toBe('false')
    expect(vj('sanear-imagens')).toBe('false')
    expect(vj('storage-excluir')).toBe('false')
    expect(vj('gerar-documento-pdf')).toBe('true')
    expect(vj('gerar-documento-pdf-final')).toBe('true')
    expect(vj('admin-comunidade-foto')).toBe('true')
  })
})
