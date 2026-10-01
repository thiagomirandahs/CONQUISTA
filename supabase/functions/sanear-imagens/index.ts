// Edge Function: sanear-imagens  (migration 529)
// Tira EXIF/GPS/miniaturas/XMP/IPTC/comentários das imagens que o app enviou ao Storage e regrava o arquivo no MESMO caminho.
// Fila: public.imagem_saneamento (alimentada pelo app, best-effort, e pela varredura do cron). Núcleo puro e testado:
// ../_compartilhado/sanear-imagem.ts (não recodifica pixels: sem perda de qualidade; só regrava se algo saiu).
//
// Quem chama: o pg_cron (public.imagem_saneamento_rotina, a cada 10 min) por pg_net com o header `x-saneamento-secret`;
// também pode ser chamada à mão (curl) com o mesmo header. "Verify JWT" desligado; a fechadura é o segredo SANEAMENTO_SECRET.
// Sem o segredo configurado, ou errado: 401 e NADA é tocado (falha fechada).
//
// Secrets: SANEAMENTO_SECRET (o mesmo valor do Vault 'saneamento_secret'). SUPABASE_URL vem sozinha; a chave de serviço vem de ../_compartilhado/chaves.ts (secret nova, com fallback legacy).
// Privacidade nos logs: só contagens e códigos de motivo; NUNCA caminho do objeto (tem o id da pessoa) nem conteúdo.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { chaveServico, urlProjeto, resumoDasChaves } from '../_compartilhado/chaves.ts'
import { sanearImagem, MAX_BYTES_PADRAO } from '../_compartilhado/sanear-imagem.ts'

const SUPABASE_URL = urlProjeto()
// chave de serviço: secret nova (SB_SECRET_KEY / SUPABASE_SECRET_KEYS) com fallback legacy — ver _compartilhado/chaves.ts
const SERVICE_ROLE = chaveServico().valor
const SEGREDO = Deno.env.get('SANEAMENTO_SECRET') ?? ''

const LOTE = 8                        // itens reservados por vez
const MAX_LOTES = 1                   // 1 lote por chamada = no máximo 8 itens a cada 10 min (decisão do dono, Fase 9); o resto fica para o próximo ciclo
const MAX_BYTES_POR_ITEM = MAX_BYTES_PADRAO
const ORCAMENTO_BYTES = 24 * 1024 * 1024   // teto de bytes baixados por chamada (CPU/memória da Edge Function)
const ORCAMENTO_MS = 100_000               // pára de pegar item novo depois disso

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
console.log('chaves', resumoDasChaves())

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

type Pendente = { id: string; bucket: string; caminho: string; versao: string | null; bytes: number | null }
type Contagem = { ok: number; saneadas: number; ignoradas: number; falhas: number; mudou: number; bytes_liberados: number }

const MIME: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

async function marcar(p: Pendente, estado: 'ok' | 'ignorado' | 'falhou', motivo: string, extra: { antes?: number; depois?: number; reescrito?: boolean } = {}): Promise<string> {
  const { data, error } = await sb.rpc('imagem_saneamento_marcar', {
    p_id: p.id, p_estado: estado, p_motivo: motivo, p_versao: p.versao,
    p_bytes_antes: extra.antes ?? null, p_bytes_depois: extra.depois ?? null, p_reescrito: extra.reescrito ?? false,
  })
  if (error) { console.error('sanear-imagens: marcar falhou', error.code ?? 'erro'); return 'erro' }
  return String(data)
}

async function processar(p: Pendente, c: Contagem): Promise<number> {
  // 1) muito grande? nem baixa (o banco sabe o tamanho pelo metadata do objeto)
  if (p.bytes != null && p.bytes > MAX_BYTES_POR_ITEM) {
    await marcar(p, 'ignorado', 'grande'); c.ignoradas++; return 0
  }
  // 2) baixa
  const { data: blob, error: eDown } = await sb.storage.from(p.bucket).download(p.caminho)
  if (eDown || !blob) {
    const naoExiste = /not found|404|does not exist/i.test(String(eDown?.message ?? ''))
    if (naoExiste) { await marcar(p, 'ignorado', 'sumiu'); c.ignoradas++ }
    else { await marcar(p, 'falhou', 'erro_download'); c.falhas++ }
    return 0
  }
  const original = new Uint8Array(await blob.arrayBuffer())
  const r = sanearImagem(original, { maxBytes: MAX_BYTES_POR_ITEM })

  if (r.estado === 'ignorado') { await marcar(p, 'ignorado', r.motivo ?? 'ignorado'); c.ignoradas++; return original.length }
  if (r.estado === 'invalida') { await marcar(p, 'falhou', 'invalida'); c.falhas++; return original.length }
  if (r.estado === 'limpa') { await marcar(p, 'ok', 'ja_limpa', { antes: original.length, depois: original.length }); c.ok++; return original.length }

  // 3) saneada: confere a saída ANTES de regravar (nunca maior; o próprio saneador reconhece como limpa)
  const de = sanearImagem(r.bytes, { maxBytes: MAX_BYTES_POR_ITEM })
  if (r.bytes.length > original.length || de.estado !== 'limpa') {
    await marcar(p, 'falhou', 'saida_nao_confere'); c.falhas++; return original.length
  }
  // 4) não pisar num upload mais novo (cliente que regravou o arquivo desde a reserva)
  const { data: igual, error: eConf } = await sb.rpc('imagem_saneamento_conferir', { p_id: p.id, p_versao: p.versao })
  if (eConf) { await marcar(p, 'falhou', 'erro_conferir'); c.falhas++; return original.length }
  if (!igual) { c.mudou++; return original.length }   // fica reservado; volta ao lote quando a reserva expirar e o app/varredura reenfileirar
  // 5) regrava no MESMO caminho
  // PRESERVA o mimetype que o objeto já tinha (ex.: arquivo JPEG enviado com rótulo image/png continua com o rótulo dele); só cai no do formato detectado se o original não era imagem
  const mimeOriginal = typeof blob.type === 'string' && blob.type.toLowerCase().startsWith('image/') ? blob.type.toLowerCase() : null
  const { error: eUp } = await sb.storage.from(p.bucket).upload(p.caminho, r.bytes, { upsert: true, contentType: mimeOriginal ?? MIME[r.formato] ?? 'application/octet-stream' })
  if (eUp) { await marcar(p, 'falhou', 'erro_upload'); c.falhas++; return original.length }
  const s = await marcar(p, 'ok', 'saneada', { antes: original.length, depois: r.bytes.length, reescrito: true })
  if (s === 'ok') { c.saneadas++; c.bytes_liberados += original.length - r.bytes.length } else c.mudou++
  return original.length
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405 })
  if (!(await igualSeguro(req.headers.get('x-saneamento-secret') ?? '', SEGREDO))) {
    return new Response('não autorizado', { status: 401 })
  }

  const inicio = Date.now()
  const c: Contagem = { ok: 0, saneadas: 0, ignoradas: 0, falhas: 0, mudou: 0, bytes_liberados: 0 }
  let reservados = 0
  let baixados = 0
  // Drena a fila em lotes pequenos até esgotar, estourar o orçamento de bytes/tempo ou o teto de lotes por chamada.
  for (let lote = 0; lote < MAX_LOTES; lote++) {
    if (baixados >= ORCAMENTO_BYTES || Date.now() - inicio > ORCAMENTO_MS) break
    const { data, error } = await sb.rpc('imagem_saneamento_pendentes', { p_limite: LOTE })
    if (error) {
      if (lote === 0) return Response.json({ ok: false, erro: 'fila_indisponivel' }, { status: 500 })
      break
    }
    const pendentes = (data ?? []) as Pendente[]
    if (pendentes.length === 0) break
    reservados += pendentes.length
    for (const p of pendentes) {
      if (baixados >= ORCAMENTO_BYTES || Date.now() - inicio > ORCAMENTO_MS) break   // o resto da reserva expira e volta no próximo ciclo
      try {
        baixados += await processar(p, c)
      } catch (e) {
        // nunca derruba o lote por um item; o motivo vai por código, sem caminho nem conteúdo
        console.error('sanear-imagens: item falhou', e instanceof Error ? e.name : 'erro')
        await marcar(p, 'falhou', 'erro_inesperado'); c.falhas++
      }
    }
    if (pendentes.length < LOTE) break
  }
  console.log('sanear-imagens', JSON.stringify({ reservados, ...c }))
  return Response.json({ ok: true, reservados, ...c })
})
