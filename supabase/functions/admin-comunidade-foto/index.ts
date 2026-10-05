// Edge Function: admin-comunidade-foto
//
// Assina (60 s) a foto de um item da Comunidade para o ADMIN DA PLATAFORMA, de forma MEDIADA (migration 530):
//   1. recebe { tipo: 'post' | 'story', id } com o JWT de quem pediu (Verify JWT ligado);
//   2. chama a RPC admin_comunidade_foto_assinar REPASSANDO esse JWT: é o Postgres quem decide (admin da plataforma,
//      item da Comunidade em análise/denunciado, arquivo existente) e quem grava EXATAMENTE 1 linha em
//      plataforma_acesso_log por chamada. Se a RPC recusa ou o log falha, nada é assinado;
//   3. só então assina o caminho que a RPC devolveu, com a chave de serviço (o admin não tem leitura direta
//      nesse bucket), e devolve a URL. A URL/token NUNCA são gravados em lugar nenhum.
//
// Chaves: lidas por ../_compartilhado/chaves.ts (SB_SECRET_KEY/SUPABASE_SECRET_KEYS e SB_PUBLISHABLE_KEY/SUPABASE_PUBLISHABLE_KEYS, com fallback
// para SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY enquanto as legacy existirem). SUPABASE_URL é injetada. Ver EDGE-FUNCTIONS-CHAVES-AUDITORIA.md.
// Versão do supabase-js FIXADA (função colada no painel, sem lockfile) — mesmo pin das funções de PDF.
// Para atualizar: mude aqui e rode `npm run test:edge:bundle:pdf` (que empacota esta função também).
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { chaveServico, chavePublica, urlProjeto, resumoDasChaves } from '../_compartilhado/chaves.ts'

const SUPABASE_URL = urlProjeto()
// chave pública do cliente "como o usuário" (o JWT dele vai no Authorization): publishable com fallback anon — ver _compartilhado/chaves.ts
const ANON_KEY = chavePublica().valor
// chave de serviço: secret nova (SB_SECRET_KEY / SUPABASE_SECRET_KEYS) com fallback legacy — ver _compartilhado/chaves.ts
const SERVICE_ROLE = chaveServico().valor
console.log('chaves', resumoDasChaves(undefined, true))

const TTL_SEGUNDOS = 60
const UUID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ORIGENS_PADRAO = [
  'https://app.desbravaclube.com.br', 'https://desbravaclube.com.br', 'https://www.desbravaclube.com.br',
  'https://localhost', 'capacitor://localhost',
]
const ORIGENS = new Set([
  ...ORIGENS_PADRAO,
  ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
])

function corsPara(origem: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-clube-atual, x-escopo-atual, x-rede-como',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origem && ORIGENS.has(origem)) h['Access-Control-Allow-Origin'] = origem
  return h
}

function json(corpo: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

Deno.serve(async (req) => {
  const cors = corsPara(req.headers.get('origin'))
  const erro = (m: string, st: number) => json({ erro: m }, st, cors)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return erro('Método não permitido.', 405)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return erro('Sem sessão.', 401)

  const body = await req.json().catch(() => null)
  const tipo = typeof body?.tipo === 'string' ? body.tipo : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (tipo !== 'post' && tipo !== 'story') return erro('Tipo inválido.', 400)
  if (!UUID_OK.test(id)) return erro('Identificador inválido.', 400)

  // "como o usuário": o banco decide e registra. A função nunca decide autorização sozinha.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: autorizado, error: erroRpc } = await comoUsuario.rpc('admin_comunidade_foto_assinar', { p_tipo: tipo, p_id: id })
  if (erroRpc || !autorizado?.ok || typeof autorizado.path !== 'string' || autorizado.bucket !== 'comunidade') {
    // mensagens da RPC são curtas e em português de propósito (sem detalhe interno)
    return erro(erroRpc?.message || 'Sem permissão.', 403)
  }

  const comoServico = createClient(SUPABASE_URL, SERVICE_ROLE)
  const { data, error } = await comoServico.storage.from(autorizado.bucket).createSignedUrl(autorizado.path, TTL_SEGUNDOS)
  if (error || !data?.signedUrl) {
    console.error('assinar', error?.message)
    return erro('Não foi possível abrir a foto agora. Tente de novo.', 500)
  }
  return json({ ok: true, url: data.signedUrl, expira_em_segundos: TTL_SEGUNDOS, contexto: autorizado.contexto }, 200, cors)
})
