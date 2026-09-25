// Edge Function: gerar-documento-pdf
//
// Gera o PDF AUTORITATIVO de um documento de classe (Caderno de acompanhamento ou Documento
// Final) já emitido (public.class_documents, via documento_emitir). O SERVIDOR é quem decide o
// conteúdo — nunca "React renderiza HTML e a pessoa imprime". Fase 4 (Bloco 1) desta rodada.
//
// Fluxo (cada passo reaproveita o que já existia; nenhuma sanitização de privacidade é reescrita
// aqui — quem decide o que pode aparecer é documento_conteudo, já auditado):
//   1. recebe { token } com o JWT de quem pediu (o app já está autenticado; Verify JWT ligado);
//   2. chama documento_pdf_dados(token) REPASSANDO esse JWT — é o Postgres quem decide se esta
//      pessoa pode ver este documento (dono OU liderança com autoridade), a função nunca decide
//      autorização sozinha;
//   3. monta o PDF com pdf-lib (puro JS, sem dependência nativa — roda no Deno da Edge Function);
//   4. calcola SHA-256 dos BYTES do PDF (Web Crypto nativo do Deno — não é o hash do snapshot);
//   5. sobe o arquivo pro bucket privado 'documentos-emitidos' com a CHAVE DE SERVIÇO (só ela tem
//      permissão de escrita nesse bucket — o cliente nunca escreve Storage sensível direto);
//   6. registra hash+caminho chamando documento_pdf_registrar(token, hash, path), de novo com o
//      JWT de quem pediu — essa RPC recusa se já houver assinatura registrada (imutabilidade
//      pós-assinatura), senão incrementa pdf_versao.
//
// Segredos necessários (painel Supabase -> Edge Functions -> Secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (as três já injetadas por padrão).
//
// Versões FIXADAS de propósito (função colada no painel, sem lockfile) — mesmo padrão de
// enviar-push/index.ts. Para atualizar: mude aqui, rode supabase/tests/e2e/edge-bundle-pdf.sh,
// cole de novo.
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

function erroJson(mensagem: string, status: number) {
  return new Response(JSON.stringify({ erro: mensagem }), { status, headers: { 'content-type': 'application/json' } })
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Desenha o QR como retângulos vetoriais direto no PDF — MESMA biblioteca (qrcode-generator) que
// src/lib/qr.js já usa pro SVG da tela; aqui só o "desenho" muda (retângulo em vez de <path>), a
// matriz é a mesma. Sem PNG, sem canvas, sem dependência a mais.
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

async function montarPdf(dados: any, origem: string, token: string): Promise<Uint8Array> {
  const c = dados.conteudo
  const doc = c.documento
  const tituloTipo = TITULO_TIPO[doc.tipo] ?? 'Documento de Classe'

  const pdf = await PDFDocument.create()
  const fonte = await pdf.embedFont(StandardFonts.Helvetica)
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage([595.28, 841.89]) // A4 em pontos
  const margem = 50
  let y = 841.89 - margem

  const linha = (texto: string, opts: { negrito?: boolean; tamanho?: number; cor?: [number, number, number] } = {}) => {
    if (y < margem + 60) { page = pdf.addPage([595.28, 841.89]); y = 841.89 - margem }
    const f = opts.negrito ? fonteNegrito : fonte
    const tamanho = opts.tamanho ?? 10
    page.drawText(texto, { x: margem, y, size: tamanho, font: f, color: opts.cor ? rgb(...opts.cor) : rgb(0.1, 0.1, 0.1) })
    y -= tamanho + 6
  }

  linha('DESBRAVACLUBE', { negrito: true, tamanho: 18 })
  linha(tituloTipo.toUpperCase(), { negrito: true, tamanho: 13, cor: [0.35, 0.1, 0.55] })
  y -= 6

  linha(`Titular: ${c.pessoa?.nome ?? '—'}`)
  linha(`Clube: ${c.clube_emissor?.nome ?? '—'}`)
  linha(`Classe: ${c.classe?.nome ?? '—'}`)
  linha(`Versão curricular: ${c.curriculum_version?.identificador ?? ''} ${c.curriculum_version?.versao ?? ''}`)
  linha(`Período: iniciada em ${c.periodo?.iniciada_em ?? '—'} · concluída em ${c.periodo?.concluida_em ?? '—'}`)
  if (c.periodo?.investidura) {
    linha(`Investidura: ${c.periodo.investidura.data} — registrada por ${c.periodo.investidura.registrado_por_nome} (${c.periodo.investidura.registrado_papel})`)
  }
  y -= 8

  linha('RESUMO CURRICULAR', { negrito: true, tamanho: 12 })
  const secoes = c.secoes ?? []
  const totalReq = secoes.reduce((n: number, s: any) => n + (s.requisitos?.length ?? 0), 0)
  const aprovados = secoes.reduce((n: number, s: any) => n + (s.requisitos?.filter((r: any) => r.situacao === 'aprovado').length ?? 0), 0)
  linha(`${secoes.length} seção(ões), ${aprovados}/${totalReq} requisitos aprovados (${c.percentual ?? ''}%)`)
  for (const s of secoes) {
    linha(`${s.codigo}. ${s.nome} — ${(s.requisitos ?? []).filter((r: any) => r.situacao === 'aprovado').length}/${(s.requisitos ?? []).length}`, { tamanho: 9 })
  }
  y -= 8

  if (c.revisao) {
    linha('REVISÃO FINAL', { negrito: true, tamanho: 12 })
    linha(`Revisado em ${c.revisao.revisado_em} por ${c.revisao.revisado_por_nome} (${c.revisao.revisado_papel})`)
    y -= 8
  }

  linha('ASSINATURAS ELETRÔNICAS', { negrito: true, tamanho: 12 })
  linha('Nenhuma assinatura eletrônica registrada ainda.', { tamanho: 9, cor: [0.5, 0.5, 0.5] })
  y -= 8

  // Rodapé de verificação: código + QR + URL pública + template + paginação — igual em toda página.
  // O token é o mesmo que o chamador já tinha (é o parâmetro de entrada desta função) — não é
  // segredo: é exatamente o que já vai em /verificar/<token> hoje na tela DocumentoClasse.jsx.
  const paginas = pdf.getPages()
  const urlBase = origem.replace(/\/$/, '')
  const urlVerificacao = `${urlBase}/verificar/${token}`
  paginas.forEach((p, i) => {
    const yRodape = 70
    p.drawLine({ start: { x: margem, y: yRodape + 14 }, end: { x: 595.28 - margem, y: yRodape + 14 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
    p.drawText(`Verificação: ${urlVerificacao}`, { x: margem, y: yRodape, size: 8, font: fonte, color: rgb(0.4, 0.4, 0.4) })
    p.drawText(`Código de conferência: ${doc.conferencia}`, { x: margem, y: yRodape - 12, size: 8, font: fonte, color: rgb(0.4, 0.4, 0.4) })
    p.drawText(`Template: ${doc.template?.chave}/${doc.template?.versao} · Página ${i + 1} de ${paginas.length}`, { x: margem, y: yRodape - 24, size: 8, font: fonte, color: rgb(0.4, 0.4, 0.4) })
    desenharQr(p, urlVerificacao, 595.28 - margem - 60, 841.89 - 30, 60)
  })

  return pdf.save()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return erroJson('Método não permitido.', 405)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return erroJson('Sem sessão.', 401)

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) return erroJson('Informe o token do documento.', 400)

  // Cliente "como o usuário" — é ele quem decide se este JWT pode isto, via RLS/checagem interna
  // das RPCs. A Edge Function nunca decide autorização por conta própria.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: dados, error: erroDados } = await comoUsuario.rpc('documento_pdf_dados', { p_token: token })
  if (erroDados) return erroJson(erroDados.message, 400)
  if (!dados) return erroJson('Documento não encontrado ou sem permissão.', 403)
  if (dados.ja_assinado) return erroJson('Este documento já tem assinatura registrada — gere um novo documento em vez de substituir o PDF.', 409)

  let bytes: Uint8Array
  try {
    bytes = await montarPdf(dados, req.headers.get('origin') ?? SUPABASE_URL, token)
  } catch (e) {
    return erroJson(`Falha ao montar o PDF: ${e instanceof Error ? e.message : String(e)}`, 500)
  }

  const hash = await sha256Hex(bytes)
  const proximaVersao = (dados.pdf_versao_atual ?? 0) + 1
  const path = `${dados.club_id_origem}/${dados.usuario_id}/${dados.documento_id}/${proximaVersao}.pdf`

  // Upload SÓ com a chave de serviço — o bucket 'documentos-emitidos' não tem policy de INSERT
  // para `authenticated` (migration 88), de propósito.
  const comoServico = createClient(SUPABASE_URL, SERVICE_ROLE)
  // upsert:true por segurança operacional (um retry de rede não pode falhar por já existir) — o
  // path já é único por versão (pdf_versao incrementa a cada chamada), então isto nunca sobrescreve
  // um PDF de uma versão ANTERIOR, só re-tenta a mesma.
  const { error: erroUpload } = await comoServico.storage.from('documentos-emitidos').upload(path, bytes, {
    contentType: 'application/pdf', upsert: true,
  })
  if (erroUpload) return erroJson(`Falha ao salvar o PDF: ${erroUpload.message}`, 500)

  // Registrar de novo COMO O USUÁRIO: a RPC reconfere permissão e a trava de imutabilidade
  // pós-assinatura de forma independente desta função.
  const { data: registrado, error: erroRegistrar } = await comoUsuario.rpc('documento_pdf_registrar', {
    p_token: token, p_hash: hash, p_storage_path: path,
  })
  if (erroRegistrar) return erroJson(erroRegistrar.message, 409)

  return new Response(JSON.stringify({ ok: true, hash, storage_path: path, pdf_versao: registrado?.pdf_versao }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
})
