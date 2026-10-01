// Edge Function: storage-excluir  (migration 532)
// Apaga do Storage os arquivos que ficaram órfãos de verdade, SÓ depois da carência e da reverificação feitas pelo BANCO.
// Fila: public.storage_exclusao_fila (alimentada por gatilhos AFTER DELETE/UPDATE nas tabelas que guardam arquivo do usuário).
//
// Fluxo por chamada (1 lote, no máximo 8 itens):
//   1) pede o lote ao banco: rpc('_storage_exclusao_processar') — o banco reserva, reverifica (sem outra referência, objeto com mais de
//      7 dias, bucket elegível, dono do caminho = dono da linha) e devolve SÓ o que pode ser apagado;
//   2) apaga pelo caminho que o BANCO devolveu (service_role, remove) — nunca por parâmetro de requisição (o corpo é ignorado);
//   3) confirma cada resultado ao banco: rpc('_storage_exclusao_confirmar'). 'excluido' só depois que a API confirmou;
//      falha vira tentativa+1 com recuo (teto de 5 -> 'falhou', visível ao admin e em infra_falhas).
//
// Quem chama: pg_cron (public.storage_exclusao_rotina, a cada 15 min — NASCE DESLIGADO) por pg_net com o header
// `x-storage-excluir-secret`; também à mão (curl). "Verify JWT" desligado; a fechadura é o segredo STORAGE_EXCLUIR_SECRET
// (comparação em tempo constante). Sem segredo configurado, ou errado: 401 e NADA é tocado (falha fechada).
//
// Secrets: STORAGE_EXCLUIR_SECRET (o mesmo valor do Vault 'storage_excluir_secret'). SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY vêm sozinhos.
// Privacidade nos logs: só contagens; NUNCA caminho do objeto (tem o id da pessoa) nem mensagem de erro da API.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { itemAceitavel, interpretarRemocao } from '../_compartilhado/storage-excluir.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SEGREDO = Deno.env.get('STORAGE_EXCLUIR_SECRET') ?? ''

const LOTE = 8                       // itens por chamada (o resto fica para o próximo ciclo)
const ORCAMENTO_MS = 100_000         // pára de apagar item novo depois disso (a reserva dos demais expira e eles voltam)

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

async function confirmar(bucket: string, caminho: string, ok: boolean, msg: string): Promise<string> {
  const { data, error } = await sb.rpc('_storage_exclusao_confirmar', { p_bucket: bucket, p_caminho: caminho, p_ok: ok, p_msg: msg })
  if (error) { console.error('storage-excluir: confirmar falhou', error.code ?? 'erro'); return 'erro_confirmar' }
  return String(data)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405 })
  if (!(await igualSeguro(req.headers.get('x-storage-excluir-secret') ?? '', SEGREDO))) {
    return new Response('não autorizado', { status: 401 })
  }

  const inicio = Date.now()
  const c = { reservados: 0, excluidos: 0, ausentes: 0, falhas: 0, recusados: 0, erro_confirmar: 0 }

  const { data, error } = await sb.rpc('_storage_exclusao_processar', { p_limite: LOTE })
  if (error) {
    console.error('storage-excluir: fila indisponível', error.code ?? 'erro')
    return Response.json({ ok: false, erro: 'fila_indisponivel' }, { status: 500 })
  }
  const itens = (Array.isArray(data) ? data : []) as Array<{ bucket?: unknown; caminho?: unknown }>
  c.reservados = itens.length

  for (const it of itens) {
    if (Date.now() - inicio > ORCAMENTO_MS) break     // sem confirmar: a reserva expira e o item volta no próximo ciclo
    // segunda trava (o banco já filtrou): bucket protegido/caminho estranho nunca chega ao remove()
    if (!itemAceitavel(it)) { c.recusados++; continue }
    try {
      const res = interpretarRemocao(await sb.storage.from(it.bucket).remove([it.caminho]))
      const est = await confirmar(it.bucket, it.caminho, res.ok, res.msg)
      if (est === 'erro_confirmar') c.erro_confirmar++
      else if (res.ok && res.msg === 'ja_ausente') c.ausentes++
      else if (res.ok) c.excluidos++
      else c.falhas++
    } catch (e) {
      // nunca derruba o lote por um item; só o NOME do erro vai ao log
      console.error('storage-excluir: item falhou', e instanceof Error ? e.name : 'erro')
      await confirmar(it.bucket, it.caminho, false, 'erro_api excecao')
      c.falhas++
    }
  }
  console.log('storage-excluir', JSON.stringify(c))
  return Response.json({ ok: true, ...c })
})
