// @vitest-environment node
// Pagamento (Edge Functions pagamento-checkout / pagamento-webhook): as regras vivem em supabase/functions/_compartilhado/pagamento/*.ts
// e rodam aqui SEM Deno e SEM rede (o banco entra por parâmetro). Provam: falha fechada sem provedor, mock só com a variável, valor nunca
// vindo do navegador, cobrança única por fatura, webhook autenticado e idempotente, e o contrato do modelo de adaptador.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tratarCheckout, tratarWebhook, statusDoErroDoBanco } from '../../supabase/functions/_compartilhado/pagamento/handlers.ts'
import { adaptadorDoAmbiente, chavesRegistradas } from '../../supabase/functions/_compartilhado/pagamento/registro.ts'
import { adaptadorMock } from '../../supabase/functions/_compartilhado/pagamento/mock.ts'
import { adaptadorModelo } from '../../supabase/functions/_compartilhado/pagamento/_modelo.ts'
import { igualSeguro, hmacSha256Hex, centavosParaReais, eventoValido } from '../../supabase/functions/_compartilhado/pagamento/comum.ts'

const RAIZ = join(__dirname, '..', '..')
const env = (o) => (n) => o[n]
const FATURA = { fatura_id: 'f-1', valor_centavos: 19990, moeda: 'BRL', forma: 'pix', vence_em: '2026-10-05', provedor: 'mock', descricao: 'Licença Anual (anual)', checkout_url: null, pix_copia_cola: null, provider_ref: null }
const AMB = { PAGAMENTO_PROVEDOR: 'mock', PAGAMENTO_MOCK_HABILITADO: 'sim', PAGAMENTO_URL_RETORNO: 'https://app.exemplo.com/', PAGAMENTO_WEBHOOK_SEGREDO: 'segredo-de-teste' }

function checkout({ ambiente = AMB, corpo = { forma: 'pix' }, prep = { data: FATURA, error: null }, vinc = { data: { ok: true }, error: null }, adaptador } = {}) {
  const rpcUsuario = vi.fn(async () => prep)
  const rpcServico = vi.fn(async () => vinc)
  const ad = adaptador === undefined ? adaptadorDoAmbiente(env(ambiente)) : adaptador
  const run = () => tratarCheckout({ corpo, env: env(ambiente), adaptador: ad, usuario: { nome: 'Diretoria', email: 'd@x.com' }, rpcUsuario, rpcServico })
  return { run, rpcUsuario, rpcServico }
}

describe('registro de adaptadores (falha fechada)', () => {
  it('sem PAGAMENTO_PROVEDOR, provedor desconhecido, ou mock sem a habilitação → nenhum adaptador', () => {
    expect(adaptadorDoAmbiente(env({}))).toBeNull()
    expect(adaptadorDoAmbiente(env({ PAGAMENTO_PROVEDOR: 'naoexiste' }))).toBeNull()
    expect(adaptadorDoAmbiente(env({ PAGAMENTO_PROVEDOR: 'mock' }))).toBeNull()
    expect(adaptadorDoAmbiente(env({ PAGAMENTO_PROVEDOR: 'mock', PAGAMENTO_MOCK_HABILITADO: 'nao' }))).toBeNull()
    expect(adaptadorDoAmbiente(env({ PAGAMENTO_PROVEDOR: 'MOCK ', PAGAMENTO_MOCK_HABILITADO: 'sim' }))?.chave).toBe('mock')
    expect(chavesRegistradas()).toContain('mock')
  })
})

describe('checkout', () => {
  it('sem adaptador: 503 e NADA é chamado', async () => {
    const c = checkout({ adaptador: null })
    expect((await c.run()).status).toBe(503)
    expect(c.rpcUsuario).not.toHaveBeenCalled()
  })
  it('forma inválida: 400 antes de qualquer chamada', async () => {
    const c = checkout({ corpo: { forma: 'boleto' } })
    expect((await c.run()).status).toBe(400)
    expect(c.rpcUsuario).not.toHaveBeenCalled()
  })
  it('o valor NUNCA vem do corpo: o banco decide (corpo com valor é ignorado)', async () => {
    const c = checkout({ corpo: { forma: 'pix', valor_centavos: 1, valor: 0.01 } })
    const r = await c.run()
    expect(r.status).toBe(200)
    expect(c.rpcUsuario).toHaveBeenCalledWith('pagamento_fatura_preparar', { p_forma: 'pix' })
    expect(r.corpo.valor_centavos).toBe(19990)
  })
  it('caminho feliz: cria a cobrança, vincula no banco e devolve link e Pix; retorno vem do ambiente (não do corpo)', async () => {
    const c = checkout({ corpo: { forma: 'pix', urlRetorno: 'https://malicioso.com' } })
    const r = await c.run()
    expect(r.status).toBe(200)
    expect(r.corpo.pix_copia_cola).toMatch(/^000201MOCK/)
    expect(r.corpo.checkout_url).toContain('https://app.exemplo.com/planos')
    expect(r.corpo.checkout_url).not.toContain('malicioso')
    expect(c.rpcServico).toHaveBeenCalledWith('pagamento_fatura_vincular', expect.objectContaining({ p_fatura: 'f-1', p_provider: 'mock', p_ref: 'mock_f-1' }))
  })
  it('já existe cobrança desta fatura: devolve a MESMA e não cria outra no gateway', async () => {
    const criar = vi.spyOn(adaptadorMock, 'criarCobranca')
    const c = checkout({ prep: { data: { ...FATURA, provider_ref: 'mock_f-1', pix_copia_cola: '000201X', checkout_url: 'https://x' }, error: null } })
    const r = await c.run()
    expect(r.corpo.reaproveitada).toBe(true)
    expect(criar).not.toHaveBeenCalled()
    expect(c.rpcServico).not.toHaveBeenCalled()
    criar.mockRestore()
  })
  it('provedor habilitado no banco diferente do adaptador do ambiente: 503 (não cria cobrança no gateway errado)', async () => {
    const c = checkout({ prep: { data: { ...FATURA, provedor: 'asaas' }, error: null } })
    expect((await c.run()).status).toBe(503)
    expect(c.rpcServico).not.toHaveBeenCalled()
  })
  it('erros do banco viram o status certo, com a mensagem em português do próprio banco', async () => {
    for (const [msg, st] of [['Sessão expirada.', 401], ['Sem permissão: só a diretoria paga a licença do clube.', 403], ['O pagamento online ainda não está disponível. Fale com a administração.', 503], ['A licença deste período já está paga.', 400]]) {
      const c = checkout({ prep: { data: null, error: { message: msg } } })
      const r = await c.run()
      expect(r.status, msg).toBe(st)
      expect(r.corpo.erro).toBe(msg)
      expect(statusDoErroDoBanco(msg)).toBe(st)
    }
  })
  it('gateway fora do ar: 502 sem gravar nada como pago; falha ao vincular: 500', async () => {
    const quebra = { ...adaptadorMock, criarCobranca: async () => { throw new Error('timeout') } }
    const c1 = checkout({ adaptador: quebra })
    expect((await c1.run()).status).toBe(502)
    expect(c1.rpcServico).not.toHaveBeenCalled()
    const c2 = checkout({ vinc: { data: null, error: { message: 'x' } } })
    expect((await c2.run()).status).toBe(500)
  })
})

describe('webhook', () => {
  const corpo = (o = {}) => JSON.stringify({ evento_id: 'ev-1', tipo: 'pagamento_aprovado', cobranca_ref: 'mock_f-1', ...o })
  const hook = ({ ambiente = AMB, texto = corpo(), segredo = 'segredo-de-teste', rpc = { data: { ok: true, duplicado: false, status: 'processado' }, error: null }, adaptador } = {}) => {
    const rpcServico = vi.fn(async () => rpc)
    const ad = adaptador === undefined ? adaptadorDoAmbiente(env(ambiente)) : adaptador
    const headers = new Headers(segredo === null ? {} : { 'x-pagamento-segredo': segredo })
    return { run: () => tratarWebhook({ corpoTexto: texto, headers, env: env(ambiente), adaptador: ad, rpcServico }), rpcServico }
  }
  it('sem adaptador: 503 e nada é tocado', async () => {
    const h = hook({ adaptador: null })
    expect((await h.run()).status).toBe(503)
    expect(h.rpcServico).not.toHaveBeenCalled()
  })
  it('segredo errado, ausente ou vazio: 401 e NADA é processado (falha fechada)', async () => {
    for (const segredo of ['errado', null, '']) {
      const h = hook({ segredo })
      expect((await h.run()).status, String(segredo)).toBe(401)
      expect(h.rpcServico).not.toHaveBeenCalled()
    }
    const h2 = hook({ ambiente: { ...AMB, PAGAMENTO_WEBHOOK_SEGREDO: '' }, segredo: '' })
    expect((await h2.run()).status).toBe(401)
  })
  it('corpo que não é JSON: 400', async () => {
    expect((await hook({ texto: '{lixo' }).run()).status).toBe(400)
  })
  it('evento que não interessa (tipo desconhecido): 200 e ignorado, sem chamar o banco', async () => {
    const h = hook({ texto: corpo({ tipo: 'qualquer_coisa' }) })
    const r = await h.run()
    expect(r.status).toBe(200)
    expect(r.corpo.ignorado).toBe(true)
    expect(h.rpcServico).not.toHaveBeenCalled()
  })
  it('evento válido: entrega ao banco com o provedor, o id do evento e o tipo interno', async () => {
    const h = hook()
    const r = await h.run()
    expect(r.status).toBe(200)
    expect(h.rpcServico).toHaveBeenCalledWith('billing_webhook_receber', { p_provider: 'mock', p_evento_id: 'ev-1', p_tipo: 'pagamento_aprovado', p_payload: { cobranca_ref: 'mock_f-1', motivo: undefined } })
  })
  it('reentrega (duplicado) responde 200 para o gateway parar de reenviar; erro do banco responde 500 para ele tentar de novo', async () => {
    const r = await hook({ rpc: { data: { ok: true, duplicado: true, status: 'processado' }, error: null } }).run()
    expect(r.status).toBe(200)
    expect(r.corpo.duplicado).toBe(true)
    expect((await hook({ rpc: { data: null, error: { message: 'x' } } }).run()).status).toBe(500)
  })
  it('eventoValido recusa tipo fora do vocabulário, id vazio e id enorme', () => {
    expect(eventoValido({ eventoId: 'a', tipo: 'pagamento_aprovado', payload: {} })).toBe(true)
    expect(eventoValido({ eventoId: '', tipo: 'pagamento_aprovado', payload: {} })).toBe(false)
    expect(eventoValido({ eventoId: 'a', tipo: 'qualquer', payload: {} })).toBe(false)
    expect(eventoValido({ eventoId: 'x'.repeat(201), tipo: 'cancelamento', payload: {} })).toBe(false)
    expect(eventoValido(null)).toBe(false)
  })
})

describe('peças comuns', () => {
  it('igualSeguro: iguais verdadeiro, diferentes ou vazios falso', async () => {
    expect(await igualSeguro('abc', 'abc')).toBe(true)
    expect(await igualSeguro('abc', 'abd')).toBe(false)
    expect(await igualSeguro('', '')).toBe(false)
    expect(await igualSeguro('abc', '')).toBe(false)
  })
  it('HMAC-SHA256 (vetor conhecido) e dinheiro em centavos sem ponto flutuante', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
    expect(centavosParaReais(19990)).toBe('199.90')
    expect(centavosParaReais(5)).toBe('0.05')
    expect(centavosParaReais(100)).toBe('1.00')
  })
})

describe('modelo de adaptador e documentação (o caminho para plugar um gateway)', () => {
  it('o modelo falha FECHADO até ser preenchido (webhook sempre recusado, criarCobranca lança) e não está registrado', async () => {
    expect(await adaptadorModelo.validarWebhook({ headers: new Headers({ x: '1' }), corpo: '{}' }, env({}))).toBe(false)
    await expect(adaptadorModelo.criarCobranca({}, env({ PAGAMENTO_API_KEY: 'k' }))).rejects.toThrow()
    expect(chavesRegistradas()).not.toContain('modelo')
  })
  it('o guia existe e cita os passos essenciais', () => {
    const p = join(RAIZ, 'supabase', 'PAGAMENTOS-COMO-PLUGAR-GATEWAY.md')
    expect(existsSync(p)).toBe(true)
    const t = readFileSync(p, 'utf8')
    for (const x of ['_modelo.ts', 'registro.ts', 'PAGAMENTO_PROVEDOR', 'PAGAMENTO_WEBHOOK_SEGREDO', 'checkout_habilitado', 'billing_providers', 'sandbox']) expect(t, x).toContain(x)
  })
  it('config.toml: checkout exige JWT; webhook sem JWT (a fechadura é o adaptador); CORS do checkout por lista, nunca "*"', () => {
    const toml = readFileSync(join(RAIZ, 'supabase', 'config.toml'), 'utf8')
    const vj = (n) => (toml.match(new RegExp(`\\[functions\\.${n}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`)) || [])[1]
    expect(vj('pagamento-checkout')).toBe('true')
    expect(vj('pagamento-webhook')).toBe('false')
    const src = readFileSync(join(RAIZ, 'supabase', 'functions', 'pagamento-checkout', 'index.ts'), 'utf8')
    expect(src).not.toMatch(/Allow-Origin['"]\s*:\s*['"]\*['"]/)
    expect(src).toMatch(/ORIGENS\.has\(origem\)/)
  })
  it('as funções não escrevem corpo, cabeçalhos nem e-mail nos logs', () => {
    for (const f of ['pagamento-checkout', 'pagamento-webhook']) {
      const src = readFileSync(join(RAIZ, 'supabase', 'functions', f, 'index.ts'), 'utf8')
      const logs = src.split('\n').filter((l) => /console\.(log|error|warn)/.test(l)).join('\n')
      expect(logs, f).not.toMatch(/corpo|headers|email|req\.|authorization/i)
    }
  })
})
