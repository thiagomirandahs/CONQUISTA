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

describe('ambiente HOSPEDADO real: a variável de nome legado carrega a chave NOVA (incidente de 02/10/2026)', () => {
  // produção: SUPABASE_SERVICE_ROLE_KEY = sb_secret_… (default), SUPABASE_ANON_KEY = sb_publishable_…, e os pacotes {"default": "…"}
  const hospedado = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SEC, SUPABASE_ANON_KEY: PUB,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }) }
  it('CHAVES_MODO=legacy NÃO derruba a função: usa a chave da variável legada e informa origem nova', () => {
    const k = chaveServico(env({ ...hospedado, CHAVES_MODO: 'legacy' }))
    expect(k.valor).toBe(SEC)
    expect(k).toMatchObject({ origem: 'nova', fonte: 'SUPABASE_SERVICE_ROLE_KEY' })
    expect(chavePublica(env({ ...hospedado, CHAVES_MODO: 'legacy' }))).toMatchObject({ origem: 'nova', fonte: 'SUPABASE_ANON_KEY' })
    expect(resumoDasChaves(env({ ...hospedado, CHAVES_MODO: 'legacy' }), true)).toBe('{"servico":"nova:SUPABASE_SERVICE_ROLE_KEY","publica":"nova:SUPABASE_ANON_KEY","modo":"legacy"}')
  })
  it('auto e nova continuam preferindo o pacote; só com as variáveis legadas (sem pacote) também funciona, nos três modos', () => {
    expect(chaveServico(env(hospedado))).toMatchObject({ origem: 'nova', fonte: 'SUPABASE_SECRET_KEYS' })
    expect(chaveServico(env({ ...hospedado, CHAVES_MODO: 'nova' }))).toMatchObject({ origem: 'nova', fonte: 'SUPABASE_SECRET_KEYS' })
    const soApelido = { SUPABASE_SERVICE_ROLE_KEY: SEC, SUPABASE_ANON_KEY: PUB }
    for (const modo of [undefined, 'auto', 'nova', 'legacy']) {
      expect(chaveServico(env({ ...soApelido, CHAVES_MODO: modo })).valor).toBe(SEC)
      expect(chavePublica(env({ ...soApelido, CHAVES_MODO: modo })).valor).toBe(PUB)
    }
  })
  it('prefixo trocado não passa (publishable na variável de serviço; secret na pública) e o valor nunca aparece', () => {
    expect(() => chaveServico(env({ SUPABASE_SERVICE_ROLE_KEY: PUB }))).toThrow(/indispon/i)
    expect(() => chavePublica(env({ SUPABASE_ANON_KEY: SEC }))).toThrow(/indispon/i)
    expect(JSON.stringify(chaveServico(env(hospedado))) + resumoDasChaves(env(hospedado), true)).not.toContain(SEC)
  })
  it('com SB_SECRET_NOME pedido e ausente do pacote, o apelido genérico NÃO substitui a chave pedida (auto/nova falham fechado; legacy usa o apelido)', () => {
    const base = { ...hospedado, SB_SECRET_NOME: 'infra-edge' }
    expect(() => chaveServico(env(base))).toThrow(/indispon/i)
    expect(() => chaveServico(env({ ...base, CHAVES_MODO: 'nova' }))).toThrow(/indispon/i)
    expect(chaveServico(env({ ...base, CHAVES_MODO: 'legacy' })).valor).toBe(SEC)
  })
})

describe('SB_SECRET_NOME (secret dedicada escolhida por nome no dicionário injetado)', () => {
  const pacote = JSON.stringify({ default: SEC, 'infra-edge': SEC2 })
  it('usa a secret do NOME indicado, e não a default; a origem mostra só o nome', () => {
    const k = chaveServico(env({ SUPABASE_SECRET_KEYS: pacote, SB_SECRET_NOME: 'infra-edge' }))
    expect(k.valor).toBe(SEC2)
    expect(k).toMatchObject({ origem: 'nova', fonte: 'SUPABASE_SECRET_KEYS[infra-edge]' })
    expect(JSON.stringify(k)).not.toContain(SEC2)
  })
  it('sem SB_SECRET_NOME continua usando a default', () => {
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: pacote })).valor).toBe(SEC)
  })
  it('nome inexistente NÃO cai em outra secret: auto -> legacy; modo nova -> falha fechada', () => {
    const base = { SUPABASE_SECRET_KEYS: pacote, SB_SECRET_NOME: 'nao-existe', SUPABASE_SERVICE_ROLE_KEY: JWT_SERV }
    expect(chaveServico(env(base))).toMatchObject({ origem: 'legacy' })
    expect(() => chaveServico(env({ ...base, CHAVES_MODO: 'nova' }))).toThrow(/indispon/i)
  })
  it('valor do nome com prefixo errado (ex. publishable) é ignorado; SB_SECRET_KEY continua tendo precedência; modo legacy ignora o nome', () => {
    expect(() => chaveServico(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ x: PUB }), SB_SECRET_NOME: 'x' }))).toThrow()
    expect(chaveServico(env({ SB_SECRET_KEY: SEC, SUPABASE_SECRET_KEYS: pacote, SB_SECRET_NOME: 'infra-edge' })).valor).toBe(SEC)
    expect(chaveServico(env({ SUPABASE_SECRET_KEYS: pacote, SB_SECRET_NOME: 'infra-edge', CHAVES_MODO: 'legacy', SUPABASE_SERVICE_ROLE_KEY: JWT_SERV })).origem).toBe('legacy')
  })
  it('nome não afeta a chave PÚBLICA e o resumo de log não mostra valor', () => {
    expect(chavePublica(env({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }), SB_SECRET_NOME: 'infra-edge' })).valor).toBe(PUB)
    const r = resumoDasChaves(env({ SUPABASE_SECRET_KEYS: pacote, SB_SECRET_NOME: 'infra-edge' }))
    expect(r).toContain('SUPABASE_SECRET_KEYS[infra-edge]')
    expect(r).not.toContain(SEC2)
  })
})

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
  it('existem as 9 funções esperadas', () => {
    expect(funcoes.sort()).toEqual(['admin-comunidade-foto', 'enviar-push', 'gerar-documento-pdf', 'gerar-documento-pdf-final', 'limpar-fotos-rede', 'pagamento-checkout', 'pagamento-webhook', 'sanear-imagens', 'storage-excluir'])
  })
  for (const f of ['admin-comunidade-foto', 'enviar-push', 'gerar-documento-pdf', 'gerar-documento-pdf-final', 'limpar-fotos-rede', 'pagamento-checkout', 'pagamento-webhook', 'sanear-imagens', 'storage-excluir']) {
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
  it('o verify_jwt de cada função no config.toml não mudou (enviar-push/sanear/storage-excluir = false; PDF e admin-comunidade-foto = true; limpar-fotos-rede = false, declarado de forma explicita: o cron chama sem JWT de usuario)', () => {
    const toml = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8')
    const vj = (n) => (toml.match(new RegExp(`\\[functions\\.${n}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`)) || [])[1]
    expect(vj('enviar-push')).toBe('false')
    expect(vj('sanear-imagens')).toBe('false')
    expect(vj('storage-excluir')).toBe('false')
    expect(vj('limpar-fotos-rede')).toBe('false')
    expect(vj('gerar-documento-pdf')).toBe('true')
    expect(vj('gerar-documento-pdf-final')).toBe('true')
    expect(vj('admin-comunidade-foto')).toBe('true')
  })
  it('limpar-fotos-rede com verify_jwt=false NAO e endpoint publico: sem o segredo x-rede-limpeza-secret (comparacao em tempo constante) responde 401 antes de tocar em qualquer coisa', () => {
    const src = readFileSync(join(__dirname, '../../supabase/functions/limpar-fotos-rede/index.ts'), 'utf8')
    const posSegredo = src.indexOf("igualSeguro(req.headers.get('x-rede-limpeza-secret')")
    const pos401 = src.indexOf("status: 401", posSegredo)
    const posChave = src.search(/createClient\(|chaves\(|rpc\(|\.storage\b/)
    expect(posSegredo).toBeGreaterThan(-1)
    expect(pos401).toBeGreaterThan(posSegredo)
    // a checagem do segredo vem antes de qualquer uso de cliente/RPC/Storage dentro do handler
    const handler = src.slice(src.indexOf('Deno.serve'))
    expect(handler.indexOf('x-rede-limpeza-secret')).toBeLessThan(handler.search(/createClient\(|\.rpc\(|\.storage\b/))
    expect(posChave).toBeGreaterThan(-1)
  })
})
