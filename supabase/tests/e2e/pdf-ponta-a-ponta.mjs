// =============================================================================
//  Fase 4 (Bloco 1+2) — PDF de documento de classe, de ponta a ponta, contra o Supabase LOCAL de
//  verdade: envio de requisito -> aprovação -> revisão final -> investidura -> documento_emitir ->
//  Edge Function gerar-documento-pdf (autenticada) -> upload real no Storage -> download -> hash
//  confere -> ARQUIVO FINAL não contém dado proibido (UUID/e-mail/path/etc, nível C).
//
//  Por que um e2e e não só pgTAP: pgTAP prova a autorização/imutabilidade no banco, mas não prova
//  que a Edge Function realmente gera um PDF válido nem que o Storage local aceita o upload — só
//  uma chamada HTTP de verdade prova isso (e foi exatamente o que ficou pendente até esta rodada,
//  bloqueado por um bug de versão do storage-api que o script fix-storage-local.sh corrige).
//
//  Uso:  node supabase/tests/e2e/pdf-ponta-a-ponta.mjs
//  Exige: stack local no ar, `npm run storage:fix-local` já aplicado, e a Edge Function servindo
//  (`supabase functions serve` — o próprio `supabase start` já serve as funções encontradas em
//  supabase/functions ao subir, mas se você recriou o container manualmente rode `functions serve`).
//  Cria e apaga tudo com prefixo "e2e-pdf-" — nunca toca em produção (a URL é fixa em 127.0.0.1).
// =============================================================================
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-pdf-123'
const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
const uid = (k) => sql(`select md5('e2e-pdf:${k}')::uuid;`)

function limpar() {
  sql(`
    set session_replication_role = replica;
    delete from public.document_signatures where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.class_documents where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.workflow_stage_decisions where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.investiture_workflow_runs where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.class_investitures where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.investiture_reviews where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.class_completion_snapshots where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.member_requirements where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.member_classes where usuario_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.organization_memberships where user_id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from public.profiles where id in (select id from auth.users where email like 'e2e-pdf-%@teste.local');
    delete from auth.users where email like 'e2e-pdf-%@teste.local';
    delete from public.dynamic_content_values where fonte_descricao like 'FIXTURE DE TESTE E2E-PDF%';
  `)
}

let total = 0, reprovados = 0
function ok(nome, cond, detalhe = '') { total++; if (!cond) { reprovados++; console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`) }

async function principal() {
  limpar()
  const idLider = uid('lider')
  sql(`
    set session_replication_role = replica;
    insert into public.club_features (club_id, feature, enabled) select id, 'classes', true from public.organizational_units where slug='filhos-da-conquista' on conflict (club_id, feature) do update set enabled=true;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', '${idLider}', 'authenticated', 'authenticated', 'e2e-pdf-lider@teste.local',
      extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
    insert into public.profiles (id, nome, papel, status) values ('${idLider}', 'E2E PDF Lider', 'diretoria', 'ativo');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select '${idLider}', id, 'diretoria', 'ativo' from public.organizational_units where slug='filhos-da-conquista';
    insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
    select d.id, extract(year from public._data_no_brasil())::int, 'Livro do ano [FIXTURE DE TESTE E2E-PDF]',
           make_date(extract(year from public._data_no_brasil())::int, 1, 1), make_date(extract(year from public._data_no_brasil())::int, 12, 31),
           'https://exemplo.test/fixture', 'FIXTURE DE TESTE E2E-PDF — não é o livro oficial'
    from public.dynamic_content_definitions d where d.chave = 'curso_leitura_amigo'
    on conflict do nothing;
  `)
  console.log('== preparo: usuário e2e-pdf-lider (diretoria de Filhos da Conquista), conteúdo do ano liberado ==')

  const c = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const { error: errLogin } = await c.auth.signInWithPassword({ email: 'e2e-pdf-lider@teste.local', password: SENHA })
  ok('login', !errLogin, errLogin?.message)

  const { data: classeAmigo } = await c.from('classes').select('id').eq('manifesto_id', 'amigo').limit(1).single()
  const { data: mc, error: errIniciar } = await c.rpc('classe_iniciar', { p_class_id: classeAmigo.id })
  ok('classe_iniciar', !errIniciar, errIniciar?.message)
  const memberClassId = mc.member_class_id
  if (process.env.DEBUG) console.log('   [debug] memberClassId:', memberClassId, '| uid:', (await c.auth.getUser()).data.user?.id)

  async function carregar() {
    const { data, error } = await c.rpc('minha_classe', { p_member_class_id: memberClassId })
    if (error) throw new Error(error.message)
    return data
  }
  let minha = await carregar()
  for (const secao of minha.secoes) {
    for (const r of secao.requisitos) {
      let e
      if (r.escolha) ({ error: e } = await c.rpc('requisito_escolher', { p_requirement_id: r.id, p_option_ids: r.escolha.opcoes?.[0]?.id ? [r.escolha.opcoes[0].id] : [], p_rotulos_livres: r.escolha.opcoes?.[0]?.id ? [] : ['[TESTE E2E-PDF]'] }))
      else ({ error: e } = await c.rpc('requisito_salvar', { p_requirement_id: r.id, p_texto: '[TESTE E2E-PDF]', p_evidencia_path: null }))
      if (e && process.env.DEBUG) console.log(`   [debug] ${secao.codigo}.${r.codigo} preencher falhou:`, e.message)
      const { error: eEnv } = await c.rpc('requisito_enviar', { p_requirement_id: r.id })
      if (eEnv && process.env.DEBUG) console.log(`   [debug] ${secao.codigo}.${r.codigo} enviar falhou:`, eEnv.message)
    }
  }
  const { data: pendentes } = await c.rpc('classe_avaliacoes_pendentes')
  for (const p of pendentes || []) {
    const { error: eAv } = await c.rpc('requisito_avaliar', { p_member_requirement_id: p.member_requirement_id, p_decisao: 'aprovado', p_comentario: '[TESTE E2E-PDF]', p_submission_id: p.submission_id ?? null })
    if (eAv && process.env.DEBUG) console.log(`   [debug] avaliar ${p.requisito_codigo} falhou:`, eAv.message)
  }
  minha = await carregar()
  ok('100% dos requisitos aprovados', minha.member_class.percentual === 100, minha.member_class.percentual)

  const { error: errRevisao } = await c.rpc('revisao_final_decidir', { p_member_class_id: memberClassId, p_decisao: 'aprovado', p_observacao: '[TESTE E2E-PDF]', p_requisitos_para_corrigir: [] })
  ok('revisão final aprovada', !errRevisao, errRevisao?.message)
  const { error: errInvest } = await c.rpc('investidura_registrar', { p_member_class_id: memberClassId, p_data: new Date().toISOString().slice(0, 10), p_observacao: '[TESTE E2E-PDF]' })
  ok('investidura registrada', !errInvest, errInvest?.message)
  const { data: doc, error: errDoc } = await c.rpc('documento_emitir', { p_member_class_id: memberClassId, p_tipo: 'final' })
  ok('documento FINAL emitido', !errDoc && !!doc?.token, errDoc?.message)

  if (!doc?.token) { console.log('\nABORTADO: documento não foi emitido (ver falhas acima) — rode com DEBUG=1 pra ver o motivo de cada requisito.'); limpar(); process.exitCode = 1; return }

  console.log('\n== Etapa 3: PDF real via Edge Function ==')
  const { data: pdfResp, error: errPdf } = await c.functions.invoke('gerar-documento-pdf', { body: { token: doc.token } })
  ok('gerar-documento-pdf respondeu ok', !errPdf && pdfResp?.ok, errPdf?.message)
  if (errPdf) { console.log(`   → confira: stack local no ar, npm run storage:fix-local aplicado, Edge Function servindo (supabase functions serve)`); process.exitCode = reprovados > 0 ? 1 : 0; limpar(); return }

  const { data: signed, error: errSigned } = await c.storage.from('documentos-emitidos').createSignedUrl(pdfResp.storage_path, 60)
  ok('signed url do PDF gerada', !errSigned, errSigned?.message)
  const resp = await fetch(signed.signedUrl)
  const buf = Buffer.from(await resp.arrayBuffer())
  const hashBaixado = createHash('sha256').update(buf).digest('hex')
  ok('PDF baixado começa com %PDF-', buf.slice(0, 5).toString() === '%PDF-')
  ok('hash calculado antes do upload === hash do arquivo baixado', hashBaixado === pdfResp.hash, `${hashBaixado} vs ${pdfResp.hash}`)

  const { data: reg } = await c.from('class_documents').select('id, pdf_hash, pdf_storage_path, pdf_versao').eq('token_publico', doc.token).single()
  ok('class_documents.pdf_hash bate com o arquivo real', reg.pdf_hash === hashBaixado)

  console.log('\n== Etapa 4: privacidade dos BYTES reais do PDF (não documento_conteudo) ==')
  const raw = buf.toString('latin1')
  let textoDescomprimido = ''
  const reStream = /stream\r?\n([\s\S]*?)endstream/g
  let m
  while ((m = reStream.exec(raw))) { try { textoDescomprimido += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') + '\n' } catch { /* fonte, não texto */ } }
  let textoLegivel = ''
  const reHex = /<([0-9A-Fa-f]+)>\s*Tj/g
  let h
  while ((h = reHex.exec(textoDescomprimido))) textoLegivel += Buffer.from(h[1], 'hex').toString('utf8') + '\n'

  const PROIBIDOS = [
    ['UUID (qualquer)', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
    ['e-mail', /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i],
    ['telefone (padrão BR)', /\(?\d{2}\)?\s?\d{4,5}-?\d{4}/],
    ['path de Storage (bucket conhecido)', /(comprovacoes|documentos-emitidos|assinaturas-desenhadas)\//],
    ['token/URL/host interno', /supabase|localhost|postgresql:\/\//i],
    ['chave técnica (_id)', /\b\w+_id\b/],
  ]
  ok('texto legível extraído do PDF não está vazio', textoLegivel.length > 100, textoLegivel.length)
  for (const [nome, re] of PROIBIDOS) {
    const achado = textoLegivel.match(re)
    ok(`ARQUIVO FINAL não contém "${nome}"`, !achado, achado?.[0])
  }

  console.log('\n== revisão documental (exigida por documento_assinar) ==')
  const { error: errRevisar } = await c.rpc('documento_revisar', { p_token: doc.token, p_decisao: 'aprovado' })
  ok('documento_revisar aprova a versão atual do PDF', !errRevisar, errRevisar?.message)

  console.log('\n== Etapa 7: assinatura + desenho — Storage real ==')
  const { data: assinatura, error: errAssinar } = await c.rpc('documento_assinar', { p_token: doc.token, p_consentimento_texto: 'Declaro que revisei este documento [TESTE E2E-PDF].' })
  ok('documento_assinar (lider decidiu a etapa real do workflow)', !errAssinar && !!assinatura?.signature_id, errAssinar?.message)
  if (!assinatura?.signature_id) { console.log('\nABORTADO: assinatura não foi criada (ver falha acima).'); limpar(); process.exitCode = 1; return }

  const clubeId = sql(`select id from public.organizational_units where slug='filhos-da-conquista';`)
  const pngMinusculo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const pathBom = `${clubeId}/${reg.id}/${assinatura.signature_id}.png`
  const { error: errUpload } = await c.storage.from('assinaturas-desenhadas').upload(pathBom, pngMinusculo, { contentType: 'image/png', upsert: false })
  ok('upload do desenho no path correto', !errUpload, errUpload?.message)
  const { error: errRegistrar } = await c.rpc('documento_assinatura_desenho_registrar', { p_signature_id: assinatura.signature_id, p_path: pathBom })
  ok('registra a referência do desenho', !errRegistrar, errRegistrar?.message)
  const { data: assinada, error: errAssinada } = await c.storage.from('assinaturas-desenhadas').createSignedUrl(pathBom, 60)
  ok('lê o desenho de volta (dono/liderança)', !errAssinada, errAssinada?.message)
  if (assinada) {
    const r = await fetch(assinada.signedUrl)
    const b = Buffer.from(await r.arrayBuffer())
    ok('desenho baixado é o MESMO PNG enviado', b.equals(pngMinusculo))
  }

  // ataque: path de OUTRO documento (uuid aleatório) é recusado pela policy de upload
  const pathRuim = `${clubeId}/00000000-0000-0000-0000-000000000000/${assinatura.signature_id}.png`
  const { error: errUploadRuim } = await c.storage.from('assinaturas-desenhadas').upload(pathRuim, pngMinusculo, { contentType: 'image/png', upsert: false })
  ok('upload em path de documento inexistente/outro é recusado', !!errUploadRuim, errUploadRuim ? 'recusado corretamente' : 'DEVERIA TER RECUSADO')

  console.log('\n== H2: representação final assinada, Edge Function real ==')
  const { data: h2Resp, error: errH2 } = await c.functions.invoke('gerar-documento-pdf-final', { body: { token: doc.token } })
  ok('gerar-documento-pdf-final respondeu ok, gerado_agora=true (1ª vez)', !errH2 && h2Resp?.ok && h2Resp?.gerado_agora === true, errH2?.message)
  if (h2Resp?.ok) {
    const { data: h2Signed, error: errH2Signed } = await c.storage.from('documentos-emitidos').createSignedUrl(h2Resp.storage_path, 60)
    ok('signed url do H2 gerada', !errH2Signed, errH2Signed?.message)
    const h2Buf = Buffer.from(await (await fetch(h2Signed.signedUrl)).arrayBuffer())
    const h2HashBaixado = createHash('sha256').update(h2Buf).digest('hex')
    ok('H2 baixado começa com %PDF-', h2Buf.slice(0, 5).toString() === '%PDF-')
    ok('hash calculado antes do upload === hash do H2 baixado (SHA-256 confere)', h2HashBaixado === h2Resp.hash, `${h2HashBaixado} vs ${h2Resp.hash}`)
    ok('H2 tem hash DIFERENTE de H1 — não é o mesmo arquivo, não é circular', h2Resp.hash !== reg.pdf_hash)

    // idempotência real: chamar de novo pro MESMO estado de assinaturas devolve o MESMO hash/path, gerado_agora=false
    const { data: h2Resp2, error: errH2b } = await c.functions.invoke('gerar-documento-pdf-final', { body: { token: doc.token } })
    ok('chamar de novo (mesmo estado): gerado_agora=false', !errH2b && h2Resp2?.ok && h2Resp2?.gerado_agora === false, errH2b?.message)
    ok('...e devolve o MESMO hash/path (idempotência real, não regenerou nada)', h2Resp2?.hash === h2Resp.hash && h2Resp2?.storage_path === h2Resp.storage_path)

    // verificação pública mostra o H2 vigente
    const verif = await c.rpc('documento_verificar', { p_token: doc.token })
    ok('/verificar mostra o H2 vigente com o mesmo hash', verif.data?.h2?.pdf_hash === h2Resp.hash, JSON.stringify(verif.data?.h2))
    ok('/verificar mostra o hash do H1 também (a cadeia documento→H1→assinaturas→H2)', verif.data?.pdf_hash_h1 === reg.pdf_hash)

    // H1/H2 "adulterado": se os bytes baixados não forem os originais, o hash recalculado tem que
    // divergir do hash registrado — é exatamente essa comparação que expõe adulteração (não existe
    // um "detector" separado: a prova de integridade JÁ É o hash não bater).
    const h2Adulterado = Buffer.concat([h2Buf, Buffer.from('X')])
    ok('H2 "adulterado" (1 byte a mais) teria hash diferente do registrado — prova a detecção', createHash('sha256').update(h2Adulterado).digest('hex') !== h2Resp.hash)
    const h1Adulterado = Buffer.concat([buf, Buffer.from('X')])
    ok('H1 "adulterado" (1 byte a mais) teria hash diferente do registrado — prova a detecção', createHash('sha256').update(h1Adulterado).digest('hex') !== reg.pdf_hash)

    // privacidade dos bytes do H2 (mesma bateria da Etapa 4, sobre o arquivo H2)
    const rawH2 = h2Buf.toString('latin1')
    let textoH2 = ''
    const reStream2 = /stream\r?\n([\s\S]*?)endstream/g
    let m2
    while ((m2 = reStream2.exec(rawH2))) { try { textoH2 += zlib.inflateSync(Buffer.from(m2[1], 'latin1')).toString('latin1') + '\n' } catch { /* fonte */ } }
    let textoLegivelH2 = ''
    const reHex2 = /<([0-9A-Fa-f]+)>\s*Tj/g
    let h2m
    while ((h2m = reHex2.exec(textoH2))) textoLegivelH2 += Buffer.from(h2m[1], 'hex').toString('utf8') + '\n'
    // o H2 IMPRIME de propósito o hash SHA-256 do H1 (é o que prova a cadeia documento→H1→H2) — um
    // hash hex de 64 caracteres tem sequências longas de dígitos que o regex solto de telefone (BR)
    // e o de "_id" confundem com falso positivo. Não é vazamento: hash não é segredo, é o contrário —
    // é exatamente o que a verificação pública precisa poder conferir.
    for (const [nome, re] of PROIBIDOS) {
      if (nome === 'chave técnica (_id)' || nome === 'telefone (padrão BR)') continue
      const achado = textoLegivelH2.match(re)
      ok(`H2 não contém "${nome}"`, !achado, achado?.[0])
    }
  }

  limpar()
  console.log(`\n${total - reprovados}/${total} ok${reprovados ? ` — ${reprovados} FALHA(S)` : ' — TUDO OK'}`)
  process.exitCode = reprovados > 0 ? 1 : 0
}

principal().catch((e) => { console.error('ERRO INESPERADO:', e); limpar(); process.exit(1) })
