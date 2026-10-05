import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { chaveServico, chavePublica, urlProjeto } from '../_compartilhado/chaves.ts'
import { chamarInfinitePay, checkoutSeguro, validarPagamento, UUID } from '../_compartilhado/infinitepay.ts'

// Uma única função: compras autenticadas e notificações públicas do provedor.
// Verify JWT desligado; getUser autentica compras. Webhook é conferido no payment_check.
const origens = new Set(['https://app.desbravaclube.com.br', 'https://desbravaclube.com.br', 'https://www.desbravaclube.com.br',
  'https://localhost', 'capacitor://localhost'])
Deno.serve(async req => {
  const origem = req.headers.get('origin')
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-clube-atual, x-escopo-atual, x-rede-como', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  if (origem && origens.has(origem)) headers['Access-Control-Allow-Origin'] = origem
  const responder = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers })
  if (req.method === 'OPTIONS') return responder({})
  if (req.method !== 'POST') return responder({ erro: 'Método não permitido.' }, 405)
  if (Number(req.headers.get('content-length') || 0) > 16384) return responder({ erro: 'Pedido muito grande.' }, 413)
  const body = await req.json().catch(() => null)
  if (!body || JSON.stringify(body).length > 16384) return responder({ erro: 'Pedido inválido.' }, 400)
  const webhook = new URL(req.url).searchParams.get('webhook') === '1'
  const handle = (Deno.env.get('INFINITEPAY_HANDLE') || '').trim().replace(/^\$/, '')
  const habilitado = Deno.env.get('INFINITEPAY_HABILITADO') === 'true' && /^[a-zA-Z0-9_.-]{1,100}$/.test(handle)
  if (!habilitado) return responder(webhook ? { erro: 'Integração indisponível.' } : { habilitado: false }, webhook ? 503 : 200)
  try {
    const servico = createClient(urlProjeto(), chaveServico().valor)
    let usuario: SupabaseClient | null = null
    if (!webhook) {
      const auth = req.headers.get('authorization') || ''
      if (!auth.startsWith('Bearer ')) return responder({ erro: 'Entre na sua conta.' }, 401)
      usuario = createClient(urlProjeto(), chavePublica().valor, { global: { headers: { Authorization: auth,
        'x-clube-atual': req.headers.get('x-clube-atual') || '' } } })
      const { data, error } = await usuario.auth.getUser(auth.slice(7))
      if (error || !data.user) return responder({ erro: 'Sessão inválida.' }, 401)
      if (body.acao === 'situacao') {
        const { data: ctx, error: e } = await usuario.rpc('licenca_checkout_contexto')
        if (e) return responder({ erro: 'Não foi possível consultar a licença.' }, 400)
        return responder({ habilitado: true, ...ctx })
      }
      if (body.acao === 'criar') {
        const { data: o, error: e } = await usuario.rpc('licenca_checkout_criar')
        if (e) return responder({ erro: e.message }, 403)
        if (o.url) return responder({ url: checkoutSeguro(o.url) })
        // Desconto Pix e taxas assumidas são configurados/homologados no provedor,
        // NÃO por campos não documentados nesta API. Pedido nasce com preço cheio.
        const d = await chamarInfinitePay('/links', { handle, order_nsu: o.id,
          items: [{ quantity: 1, price: o.cartao_centavos, description: 'Licença Anual DesbravaClube' }],
          redirect_url: 'https://app.desbravaclube.com.br/planos',
          webhook_url: `${urlProjeto()}/functions/v1/licenca-infinitepay?webhook=1` })
        const url = checkoutSeguro(d.url)
        const { error: gravar } = await servico.from('licenca_pedidos').update({ onde_pagar: url }).eq('id', o.id).eq('status', 'pendente')
        if (gravar) throw new Error('Não foi possível salvar a cobrança. Tente novamente.')
        return responder({ url })
      }
      if (body.acao !== 'confirmar') return responder({ erro: 'Ação inválida.' }, 400)
    }
    const id = body.order_nsu
    const transacao = body.transaction_nsu
    const slug = body.invoice_slug || body.slug
    if (!UUID.test(id || '') || typeof transacao !== 'string' || transacao.length < 1 || transacao.length > 120
      || typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(slug)) return responder({ erro: 'Referência inválida.' }, 400)
    if (usuario) {
      const { error } = await usuario.rpc('licenca_pedido_consultar', { p_pedido: id })
      if (error) return responder({ erro: 'Pedido indisponível para esta conta.' }, 403)
    }
    const { data: pedido, error } = await servico.from('licenca_pedidos').select('id, status, transaction_nsu, cartao_centavos, pix_centavos, parcelas').eq('id', id).maybeSingle()
    if (error || !pedido) return responder({ erro: 'Pedido indisponível.' }, 400)
    if (pedido.status === 'pago' && pedido.transaction_nsu === transacao) return responder({ ok: true, duplicado: true })
    const confirmado = await chamarInfinitePay('/payment_check', { handle, order_nsu: id, transaction_nsu: transacao, slug })
    const p = validarPagamento(confirmado, pedido)
    const { data, error: falha } = await servico.rpc('licenca_infinitepay_confirmar', {
      p_pedido: id, p_transacao: transacao, p_metodo: p.metodo, p_valor: p.valor, p_parcelas: p.parcelas })
    if (falha) return responder({ erro: 'Pagamento recebido exige conciliação. Procure o suporte antes de pagar novamente.' }, 400)
    return responder(data)
  } catch (e) {
    return responder({ erro: e instanceof Error ? e.message : 'Não foi possível processar o pagamento.' }, 400)
  }
})
