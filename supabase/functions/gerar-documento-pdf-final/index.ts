// Edge Function: gerar-documento-pdf-final
//
// Monta o H2 — a representação FINAL assinada de um documento de classe: o mesmo conteúdo do H1
// (public.class_documents.pdf_hash/pdf_storage_path) mais a lista de signatários (nome, papel, data,
// desenho ou indicação de assinatura eletrônica) e o hash do H1 que foi efetivamente assinado.
//
// H1 NUNCA é alterado por esta função. A assinatura (document_signatures.pdf_hash) continua
// declarando H1 — o H2 só EXIBE essa relação, não a redefine. H2 tem hash PRÓPRIO, nunca embutido
// dentro de si mesmo (sem hash circular).
//
// Idempotência real: documento_pdf_final_dados(token) já devolve `render_existente` quando já existe
// uma linha pro estado ATUAL de assinaturas — aqui a função nem monta PDF nesse caso, só devolve o
// que já existia. O path no Storage é derivado do hash do ESTADO (não de um contador), então duas
// chamadas concorrentes pro mesmo estado convergem pro MESMO arquivo.
//
// Fluxo:
//   1. { token } com o JWT de quem pediu;
//   2. documento_pdf_final_dados(token) — o Postgres decide permissão, exige ao menos 1 assinatura
//      registrada, e já devolve o render existente (se houver) pro estado atual;
//   3. se não existir, busca (com a chave de serviço) os PNGs de assinatura desenhada referenciados;
//   4. monta o PDF (pdf-lib), calcula SHA-256, sobe pro MESMO bucket privado do H1
//      ('documentos-emitidos', pasta .../final/<hash-do-estado>.pdf);
//   5. documento_pdf_final_registrar(token, hash, path, pdf_versao_h1) — de novo com o JWT de quem
//      pediu, que reconfere tudo de forma independente.
//
// Versões FIXADAS de propósito (mesmo padrão de gerar-documento-pdf/index.ts).
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import qrcodeGenerator from 'npm:qrcode-generator@1.5.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const TITULO_TIPO: Record<string, string> = {
  final: 'Documento Final de Classe',
  acompanhamento: 'Caderno de Acompanhamento',
}

// O navegador chama esta função de OUTRA origem (app.desbravaclube.com.br → *.supabase.co) com o
// cabeçalho Authorization: sem responder ao preflight OPTIONS e sem estes cabeçalhos em TODA
// resposta, ele bloqueia a chamada. Origem liberada porque a autorização é o Bearer, não cookie.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function erroJson(mensagem: string, status: number) {
  return new Response(JSON.stringify({ erro: mensagem }), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function desenharQr(page: import('npm:pdf-lib@1.17.1').PDFPage, texto: string, x: number, yTopo: number, tamanhoPt: number) {
  const qr = qrcodeGenerator(0, 'M')
  qr.addData(texto)
  qr.make()
  const n = qr.getModuleCount()
  const modulo = tamanhoPt / n
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        page.drawRectangle({ x: x + c * modulo, y: yTopo - tamanhoPt - r * modulo, width: modulo, height: modulo, color: rgb(0, 0, 0) })
      }
    }
  }
}

async function montarH2(dados: any, desenhos: Map<string, Uint8Array>, origem: string, token: string): Promise<Uint8Array> {
  const c = dados.conteudo
  const doc = c.documento
  const tituloTipo = TITULO_TIPO[doc.tipo] ?? 'Documento de Classe'

  const pdf = await PDFDocument.create()
  const fonte = await pdf.embedFont(StandardFonts.Helvetica)
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage([595.28, 841.89])
  const margem = 50
  let y = 841.89 - margem

  const linha = (texto: string, opts: { negrito?: boolean; tamanho?: number; cor?: [number, number, number] } = {}) => {
    if (y < margem + 100) { page = pdf.addPage([595.28, 841.89]); y = 841.89 - margem }
    const f = opts.negrito ? fonteNegrito : fonte
    const tamanho = opts.tamanho ?? 10
    page.drawText(texto, { x: margem, y, size: tamanho, font: f, color: opts.cor ? rgb(...opts.cor) : rgb(0.1, 0.1, 0.1) })
    y -= tamanho + 6
  }

  linha('DESBRAVACLUBE', { negrito: true, tamanho: 18 })
  linha('REPRESENTAÇÃO FINAL ASSINADA', { negrito: true, tamanho: 13, cor: [0.35, 0.1, 0.55] })
  linha(tituloTipo, { tamanho: 10, cor: [0.4, 0.4, 0.4] })
  y -= 6

  linha(`Titular: ${c.pessoa?.nome ?? '—'}`)
  linha(`Clube: ${c.clube_emissor?.nome ?? '—'}`)
  linha(`Classe: ${c.classe?.nome ?? '—'}`)
  linha(`Documento: versão ${dados.pdf_versao_h1} — código de conferência ${doc.conferencia}`)
  y -= 4
  linha('Esta página NÃO é o documento assinado — é uma representação, gerada depois das assinaturas,', { tamanho: 8, cor: [0.5, 0.5, 0.5] })
  linha('pra facilitar a conferência. Quem assinou declarou o PDF BASE, identificado pelo hash abaixo.', { tamanho: 8, cor: [0.5, 0.5, 0.5] })
  linha(`Hash SHA-256 do PDF base (H1): ${dados.pdf_hash_h1}`, { tamanho: 8, cor: [0.5, 0.5, 0.5] })
  y -= 10

  linha('SIGNATÁRIOS', { negrito: true, tamanho: 12 })
  const assinaturas = dados.assinaturas ?? []
  if (assinaturas.length === 0) linha('Nenhuma assinatura registrada.', { tamanho: 9, cor: [0.5, 0.5, 0.5] })
  for (const a of assinaturas) {
    linha(`${a.nome} — ${a.papel}`, { negrito: true, tamanho: 10 })
    linha(`Assinado em ${a.assinado_em}`, { tamanho: 8, cor: [0.4, 0.4, 0.4] })
    const png = a.tem_desenho && a.desenho_path ? desenhos.get(a.desenho_path) : null
    if (png) {
      try {
        const img = await pdf.embedPng(png)
        const largura = 100, altura = (img.height / img.width) * largura
        if (y < margem + altura + 20) { page = pdf.addPage([595.28, 841.89]); y = 841.89 - margem }
        page.drawImage(img, { x: margem, y: y - altura, width: largura, height: altura })
        y -= altura + 8
      } catch {
        linha('(assinatura eletrônica registrada — desenho não pôde ser incorporado)', { tamanho: 8, cor: [0.5, 0.5, 0.5] })
      }
    } else {
      linha('Assinatura eletrônica registrada (sem desenho).', { tamanho: 8, cor: [0.5, 0.5, 0.5] })
    }
    y -= 6
  }

  const paginas = pdf.getPages()
  const urlBase = origem.replace(/\/$/, '')
  const urlVerificacao = `${urlBase}/verificar/${token}`
  paginas.forEach((p, i) => {
    const yRodape = 70
    p.drawLine({ start: { x: margem, y: yRodape + 14 }, end: { x: 595.28 - margem, y: yRodape + 14 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
    p.drawText(`Verificação: ${urlVerificacao}`, { x: margem, y: yRodape, size: 8, font: fonte, color: rgb(0.4, 0.4, 0.4) })
    p.drawText(`Código de conferência: ${doc.conferencia}`, { x: margem, y: yRodape - 12, size: 8, font: fonte, color: rgb(0.4, 0.4, 0.4) })
    p.drawText(`Página ${i + 1} de ${paginas.length}`, { x: margem, y: yRodape - 24, size: 8, font: fonte, color: rgb(0.4, 0.4, 0.4) })
    desenharQr(p, urlVerificacao, 595.28 - margem - 60, 841.89 - 30, 60)
  })

  return pdf.save()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return erroJson('Método não permitido.', 405)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return erroJson('Sem sessão.', 401)

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) return erroJson('Informe o token do documento.', 400)

  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: dados, error: erroDados } = await comoUsuario.rpc('documento_pdf_final_dados', { p_token: token })
  if (erroDados) return erroJson(erroDados.message, 400)
  if (!dados) return erroJson('Documento não encontrado ou sem permissão.', 403)

  // Idempotência: já existe uma linha pro estado ATUAL de assinaturas — devolve direto, sem montar nada.
  if (dados.render_existente) {
    return new Response(JSON.stringify({
      ok: true, hash: dados.render_existente.pdf_hash, storage_path: dados.render_existente.storage_path, gerado_agora: false,
    }), { status: 200, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  const comoServico = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Busca os PNGs de assinatura desenhada (bucket privado; só a chave de serviço lê aqui, fora do
  // caminho normal — igual ao upload do H1, é a Edge Function quem tem esse acesso, nunca o cliente).
  const desenhos = new Map<string, Uint8Array>()
  for (const a of dados.assinaturas ?? []) {
    if (a.tem_desenho && a.desenho_path) {
      const { data: arq } = await comoServico.storage.from('assinaturas-desenhadas').download(a.desenho_path)
      if (arq) desenhos.set(a.desenho_path, new Uint8Array(await arq.arrayBuffer()))
    }
  }

  let bytes: Uint8Array
  try {
    bytes = await montarH2(dados, desenhos, req.headers.get('origin') ?? SUPABASE_URL, token)
  } catch (e) {
    return erroJson(`Falha ao montar a representação final: ${e instanceof Error ? e.message : String(e)}`, 500)
  }

  const hash = await sha256Hex(bytes)
  // Path derivado do HASH DO ESTADO (não de um contador) — duas chamadas concorrentes pro mesmo
  // estado de assinaturas convergem pro mesmo arquivo, e o upsert é seguro (mesmos bytes).
  const estadoCurto = String(dados.estado_assinaturas_hash).slice(0, 16)
  const path = `${dados.club_id_origem}/${dados.usuario_id}/${dados.documento_id}/final/${estadoCurto}.pdf`

  const { error: erroUpload } = await comoServico.storage.from('documentos-emitidos').upload(path, bytes, {
    contentType: 'application/pdf', upsert: true,
  })
  if (erroUpload) return erroJson(`Falha ao salvar a representação final: ${erroUpload.message}`, 500)

  const { data: registrado, error: erroRegistrar } = await comoUsuario.rpc('documento_pdf_final_registrar', {
    p_token: token, p_hash: hash, p_storage_path: path, p_pdf_versao_h1: dados.pdf_versao_h1,
  })
  if (erroRegistrar) return erroJson(erroRegistrar.message, 409)

  return new Response(JSON.stringify({
    ok: true, hash, storage_path: path, gerado_agora: registrado?.gerado_agora ?? true,
  }), { status: 200, headers: { ...CORS, 'content-type': 'application/json' } })
})
