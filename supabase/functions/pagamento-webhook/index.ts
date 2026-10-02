// Edge Function: pagamento-webhook  (migration 540)
// Recebe o AVISO do gateway ("pagamento aprovado/recusado/atrasado/cancelado"), confere que veio dele (cada adaptador sabe como),
// traduz para os eventos internos e entrega ao banco (billing_webhook_receber), que é IDEMPOTENTE: reenvio do mesmo evento não paga duas vezes.
// "Verify JWT" DESLIGADO de propósito (o gateway não tem sessão); a fechadura é validarWebhook do adaptador (segredo/assinatura em tempo
// constante). Sem PAGAMENTO_PROVEDOR configurado: 503 e nada é tocado. Logs: só o código HTTP, nunca corpo nem cabeçalhos.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { chaveServico, urlProjeto } from '../_compartilhado/chaves.ts'
import { adaptadorDoAmbiente } from '../_compartilhado/pagamento/registro.ts'
import { tratarWebhook } from '../_compartilhado/pagamento/handlers.ts'

const env = (n: string) => Deno.env.get(n)
const sb = createClient(urlProjeto(), chaveServico().valor, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405 })
  const corpoTexto = await req.text()
  if (corpoTexto.length > 200_000) return new Response('grande demais', { status: 413 })
  const r = await tratarWebhook({
    corpoTexto, headers: req.headers, env, adaptador: adaptadorDoAmbiente(env), rpcServico: (n, a) => sb.rpc(n, a) as never,
  })
  if (r.status >= 500) console.error('pagamento-webhook', r.status)
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
