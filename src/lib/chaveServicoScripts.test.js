// @vitest-environment node
// scripts/lib/chaveServico.mjs: prefere a chave NOVA (secret/publishable) e só cai na legacy com aviso; nunca vaza o valor.
// A Management API é SIMULADA (fetch injetado): nenhum teste fala com a rede. Valores fictícios, montados em tempo de execução.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { escolherChave, obterChaveServico, obterChavePublica, cabecalhosServico, API_GESTAO } from '../../scripts/lib/chaveServico.mjs'

const SEC = 'sb_' + 'secret_' + 'ficticiaAAAA1111'
const SEC2 = 'sb_' + 'secret_' + 'ficticiaBBBB2222'
const PUB = 'sb_' + 'publishable_' + 'ficticiaCCCC3333'
const JWT = (n) => [n, 'bbbbbbbb', 'cccccccc'].join('.')
const REF = 'abcdefghijklmnopqrst'

const tudo = [
  { name: 'anon', type: 'legacy', api_key: JWT('aaaaaaaa') },
  { name: 'service_role', type: 'legacy', api_key: JWT('dddddddd') },
  { name: 'default', type: 'publishable', api_key: PUB },
  { name: 'default', type: 'secret', api_key: SEC },
]
const resposta = (corpo, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo })

describe('escolherChave (pura)', () => {
  it('serviço: prefere a secret (type=secret); a "default" vence as demais', () => {
    const lista = [{ name: 'ci', type: 'secret', api_key: SEC2 }, ...tudo]
    const r = escolherChave(lista, 'servico')
    expect(r.chave.origem).toBe('nova'); expect(r.chave.valor).toBe(SEC); expect(r.aviso).toBeNull()
  })
  it('serviço: sem secret, cai na service_role legacy COM aviso (que não traz o valor)', () => {
    const r = escolherChave(tudo.filter((k) => k.type !== 'secret'), 'servico')
    expect(r.chave.origem).toBe('legacy'); expect(r.chave.valor).toBe(JWT('dddddddd'))
    expect(r.aviso).toMatch(/LEGACY/); expect(r.aviso).not.toContain(JWT('dddddddd'))
  })
  it('serviço: com exigirNova, a legacy é PROIBIDA (falha fechada, mensagem sem valor)', () => {
    expect(() => escolherChave(tudo.filter((k) => k.type !== 'secret'), 'servico', { exigirNova: true })).toThrow(/legacy foi proibido/)
    expect(escolherChave(tudo, 'servico', { exigirNova: true }).chave.origem).toBe('nova')
  })
  it('secret com valor MASCARADO pela API (sem reveal) é descartada; sobra a legacy ou o erro', () => {
    const mascarada = [{ name: 'default', type: 'secret', api_key: 'sb_' + 'secret_' + 'ab••••••••' }, { name: 'service_role', type: 'legacy', api_key: JWT('dddddddd') }]
    expect(escolherChave(mascarada, 'servico').chave.origem).toBe('legacy')
    expect(() => escolherChave(mascarada.slice(0, 1), 'servico')).toThrow(/Nenhuma chave/)
  })
  it('secret sem api_key (null) ou de outro tipo não é usada; uma publishable nunca vira chave de serviço', () => {
    expect(() => escolherChave([{ name: 'default', type: 'secret', api_key: null }], 'servico')).toThrow()
    expect(() => escolherChave([{ name: 'default', type: 'publishable', api_key: PUB }], 'servico')).toThrow()
    expect(() => escolherChave([{ name: 'default', type: 'secret', api_key: SEC }], 'publica')).toThrow()
  })
  it('pública: publishable -> anon legacy', () => {
    expect(escolherChave(tudo, 'publica').chave.valor).toBe(PUB)
    const r = escolherChave(tudo.filter((k) => k.type !== 'publishable'), 'publica')
    expect(r.chave.origem).toBe('legacy'); expect(r.aviso).toMatch(/anon LEGACY/)
  })
  it('lista inválida/vazia -> erro genérico', () => {
    for (const l of [null, undefined, {}, []]) expect(() => escolherChave(l, 'servico')).toThrow(/Nenhuma chave/)
  })
})

describe('obterChaveServico / obterChavePublica (Management API simulada)', () => {
  it('chama SÓ GET na API fixa, com o token no Authorization e reveal=true', async () => {
    const fetchImpl = vi.fn(async () => resposta(tudo))
    const k = await obterChaveServico({ ref: REF, token: 'tok-ficticio-1234567890', env: {}, fetchImpl, avisar: () => {} })
    expect(k.origem).toBe('nova')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${API_GESTAO}/v1/projects/${REF}/api-keys?reveal=true`)
    expect(init.method).toBe('GET'); expect(init.headers.Authorization).toBe('Bearer tok-ficticio-1234567890')
    expect(init.body).toBeUndefined()
  })
  it('usa SB_SECRET_KEY do ambiente sem chamar a API (Supabase local)', async () => {
    const fetchImpl = vi.fn()
    const k = await obterChaveServico({ ref: REF, token: 'x', env: { SB_SECRET_KEY: ` ${SEC}\n` }, fetchImpl })
    expect(k.valor).toBe(SEC); expect(k.nome).toBe('env:SB_SECRET_KEY'); expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('SB_SECRET_KEY em formato errado (um JWT) é ignorada', async () => {
    const fetchImpl = vi.fn(async () => resposta(tudo))
    const k = await obterChaveServico({ ref: REF, token: 'x', env: { SB_SECRET_KEY: JWT('zzzzzzzz') }, fetchImpl, avisar: () => {} })
    expect(k.valor).toBe(SEC); expect(fetchImpl).toHaveBeenCalled()
  })
  it('só legacy disponível: avisa UMA vez, sem o valor, e CHAVES_EXIGIR_NOVA=1 recusa', async () => {
    const fetchImpl = async () => resposta(tudo.filter((k) => k.type === 'legacy'))
    const avisos = []
    const k = await obterChaveServico({ ref: REF, token: 'x', env: {}, fetchImpl, avisar: (m) => avisos.push(m) })
    expect(k.origem).toBe('legacy'); expect(avisos).toHaveLength(1); expect(avisos[0]).not.toContain(JWT('dddddddd'))
    await expect(obterChaveServico({ ref: REF, token: 'x', env: { CHAVES_EXIGIR_NOVA: '1' }, fetchImpl, avisar: () => {} })).rejects.toThrow(/proibido/)
  })
  it('se a API recusar reveal (400), tenta de novo sem o parâmetro', async () => {
    const fetchImpl = vi.fn(async (url) => (url.includes('reveal') ? resposta({}, 400) : resposta(tudo)))
    const k = await obterChaveServico({ ref: REF, token: 'x', env: {}, fetchImpl, avisar: () => {} })
    expect(k.origem).toBe('nova'); expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toBe(`${API_GESTAO}/v1/projects/${REF}/api-keys`)
  })
  it('erro HTTP: mensagem só com o status (nunca o corpo da resposta, que pode ter chaves)', async () => {
    const corpoComSegredo = { message: `falhou ${SEC}` }
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => corpoComSegredo, text: async () => JSON.stringify(corpoComSegredo) })
    let msg = ''
    try { await obterChaveServico({ ref: REF, token: 'x', env: {}, fetchImpl }) } catch (e) { msg = e.message }
    expect(msg).toMatch(/HTTP 401/); expect(msg).not.toContain(SEC)
  })
  it('valida a referência do projeto e exige o token', async () => {
    await expect(obterChaveServico({ ref: '../x', token: 'x', env: {}, fetchImpl: vi.fn() })).rejects.toThrow(/Referência/)
    await expect(obterChaveServico({ ref: REF, token: '', env: {}, fetchImpl: vi.fn() })).rejects.toThrow(/token/)
  })
  it('pública: SB_PUBLISHABLE_KEY, publishable da API, anon legacy', async () => {
    expect((await obterChavePublica({ ref: REF, token: 'x', env: { SB_PUBLISHABLE_KEY: PUB }, fetchImpl: vi.fn() })).valor).toBe(PUB)
    expect((await obterChavePublica({ ref: REF, token: 'x', env: {}, fetchImpl: async () => resposta(tudo), avisar: () => {} })).valor).toBe(PUB)
    const k = await obterChavePublica({ ref: REF, token: 'x', env: {}, fetchImpl: async () => resposta(tudo.filter((x) => x.type === 'legacy')), avisar: () => {} })
    expect(k.origem).toBe('legacy')
  })
})

describe('o valor nunca vaza e os cabeçalhos seguem o tipo da chave', () => {
  it('JSON, template e console mostram só origem e nome', () => {
    const { chave } = escolherChave(tudo, 'servico')
    expect(JSON.stringify(chave)).not.toContain(SEC); expect(`${chave}`).not.toContain(SEC); expect(Object.keys(chave)).toEqual(['origem', 'nome'])
  })
  it('chave nova: SÓ apikey; legacy: apikey + Authorization Bearer (como os scripts faziam)', () => {
    expect(cabecalhosServico(escolherChave(tudo, 'servico').chave, { 'content-type': 'x' })).toEqual({ apikey: SEC, 'content-type': 'x' })
    const leg = escolherChave(tudo.filter((k) => k.type !== 'secret'), 'servico').chave
    expect(cabecalhosServico(leg)).toEqual({ apikey: JWT('dddddddd'), Authorization: `Bearer ${JWT('dddddddd')}` })
  })
})

// ---------------------------------------------------------------- contrato: nenhum script volta a buscar a chave legacy por conta própria
function mjsDe(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...mjsDe(p))
    else if (n.endsWith('.mjs')) out.push(p)
  }
  return out
}

describe('scripts/ não buscam service_role/anon legacy fora do helper (contrato)', () => {
  const raiz = join(__dirname, '../../scripts')
  const arquivos = mjsDe(raiz).filter((p) => !p.endsWith('chaveServico.mjs'))
  it('nenhum script usa a rota api-keys nem procura name === service_role/anon por conta própria', () => {
    for (const p of arquivos) {
      const src = readFileSync(p, 'utf8')
      expect(src, p).not.toMatch(/\/api-keys/)
      expect(src, p).not.toMatch(/name\s*===\s*['"](service_role|anon)['"]/)
    }
  })
  it('os scripts de manutenção/teste que usam a chave de serviço importam o helper', () => {
    for (const n of ['janela-fase8/backup-storage.mjs', 'saneamento-teste-controlado-producao.mjs', 'storage-backfill-saneamento.mjs', 'storage-exclusao-teste-controlado-producao.mjs', 'storage-gc-excluir-lote.mjs', 'storage-gc-manifesto.mjs']) {
      const src = readFileSync(join(raiz, n), 'utf8')
      expect(src, n).toMatch(/obterChaveServico/)
      expect(src, n).toMatch(/cabecalhosServico/)
    }
    expect(readFileSync(join(raiz, 'auth/testar-recuperacao-producao.mjs'), 'utf8')).toMatch(/obterChavePublica/)
  })
})
