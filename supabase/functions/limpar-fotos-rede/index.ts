// Edge Function: limpar-fotos-rede  (migration 472)
// Apaga do Storage as fotos da REDE DBV que o banco marcou em public.rede_fotos_para_apagar:
//   * foto de post com mais de 90 dias (o post continua, sem a foto);
//   * foto recusada/removida pela moderação, de post apagado ou retirado pelo responsável;
//   * arquivo órfão (subiu e não virou post em 1 dia).
// Por que aqui e não no SQL: o Supabase não deixa apagar arquivo por SQL (storage.protect_objects_delete);
// só a API do Storage remove o arquivo físico.
//
// Quem chama: o pg_cron (public.rede_limpeza_rotina, diário) por pg_net, com o header
// `x-rede-limpeza-secret`. "Verify JWT" desligado; a fechadura é o segredo REDE_LIMPEZA_SECRET.
// Sem ele (ou errado): 401 e nada é tocado.
//
// Secrets: REDE_LIMPEZA_SECRET (o mesmo valor do Vault 'rede_limpeza_secret').
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SEGREDO = Deno.env.get('REDE_LIMPEZA_SECRET') ?? ''
const LOTE = 100          // a API remove até 100 caminhos por chamada com folga
const MAX_POR_RODADA = 2000

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

async function igualSeguro(a: string, b: string): Promise<boolean> {
  if (!b) return false
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const x = new Uint8Array(ha), y = new Uint8Array(hb)
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

type Pendente = { id: string; bucket: string; caminho: string; bytes: number | null }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405 })
  if (!(await igualSeguro(req.headers.get('x-rede-limpeza-secret') ?? '', SEGREDO))) {
    return new Response('não autorizado', { status: 401 })
  }

  const { data, error } = await sb.rpc('rede_fotos_pendentes', { p_limite: MAX_POR_RODADA })
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })
  const pendentes = (data ?? []) as Pendente[]

  let arquivos = 0, bytes = 0, erros = 0
  for (let i = 0; i < pendentes.length; i += LOTE) {
    const lote = pendentes.slice(i, i + LOTE)
    const porBucket = new Map<string, Pendente[]>()
    for (const p of lote) porBucket.set(p.bucket, [...(porBucket.get(p.bucket) ?? []), p])
    for (const [bucket, itens] of porBucket) {
      const { error: e } = await sb.storage.from(bucket).remove(itens.map((p) => p.caminho))
      // remove() de caminho que já não existe NÃO é erro: conta como apagado (a fila fica limpa)
      const ids = itens.map((p) => p.id)
      const { data: r, error: e2 } = await sb.rpc('rede_fotos_confirmar', {
        p_apagadas: e ? [] : ids,
        p_falhas: e ? ids : [],
        p_erro: e ? e.message : null,
      })
      if (e || e2) { erros += itens.length; continue }
      arquivos += Number(r?.arquivos ?? 0)
      bytes += Number(r?.bytes ?? 0)
    }
  }
  return Response.json({ ok: true, pendentes: pendentes.length, arquivos, bytes, erros })
})
