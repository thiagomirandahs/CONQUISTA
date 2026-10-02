// Edge Function: pagamento-checkout  (migration 540)
// A DIRETORIA do clube pede para pagar a licença: a função abre a fatura no banco (valor do catálogo), cria a cobrança no gateway
// do ambiente e devolve o link / Pix copia-e-cola. Quem é o gateway: ../_compartilhado/pagamento/registro.ts + secret PAGAMENTO_PROVEDOR.
// "Verify JWT" LIGADO (padrão): exige a sessão da pessoa; a autorização real (diretoria do clube em uso) é do BANCO.
// Secrets: PAGAMENTO_PROVEDOR, PAGAMENTO_URL_RETORNO (ex.: https://app.desbravaclube.com.br), PAGAMENTO_API_KEY (do gateway) e, só em teste,
// PAGAMENTO_MOCK_HABILITADO=sim. Privacidade nos logs: nunca corpo, e-mail nem chave.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { chavePublica, chaveServico, urlProjeto } from '../_compartilhado/chaves.ts'
import { adaptadorDoAmbiente } from '../_compartilhado/pagamento/registro.ts'
import { tratarCheckout } from '../_compartilhado/pagamento/handlers.ts'

// CORS por LISTA de origens (nunca "*"): o app web, o site e o APK (Capacitor).
const ORIGENS = new Set([
  'https://app.desbravaclube.com.br', 'https://desbravaclube.com.br', 'https://www.desbravaclube.com.br',
  'https://localhost', 'capacitor://localhost',
  ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
])
function corsPara(origem: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-clube-atual',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origem && ORIGENS.has(origem)) h['Access-Control-Allow-Origin'] = origem
  return h
}
const env = (n: string) => Deno.env.get(n)

Deno.serve(async (req) => {
  const CORS = corsPara(req.headers.get('origin'))
  const json = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { erro: 'método não permitido' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { erro: 'Sessão expirada.' })

  const url = urlProjeto()
  const clube = req.headers.get('x-clube-atual')
  const sbUsuario = createClient(url, chavePublica().valor, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth, ...(clube ? { 'x-clube-atual': clube } : {}) } },
  })
  const { data: u, error: eu } = await sbUsuario.auth.getUser(auth.slice(7))
  if (eu || !u?.user) return json(401, { erro: 'Sessão expirada.' })
  const sbServico = createClient(url, chaveServico().valor, { auth: { persistSession: false } })

  let corpo: unknown = {}
  try { corpo = await req.json() } catch { /* corpo vazio = pix */ }

  const r = await tratarCheckout({
    corpo, env, adaptador: adaptadorDoAmbiente(env),
    usuario: { nome: String(u.user.user_metadata?.nome ?? u.user.email ?? 'Clube'), email: String(u.user.email ?? '') },
    rpcUsuario: (n, a) => sbUsuario.rpc(n, a) as never,
    rpcServico: (n, a) => sbServico.rpc(n, a) as never,
  })
  if (r.status >= 500) console.error('pagamento-checkout', r.status)
  return json(r.status, r.corpo)
})
