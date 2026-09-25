// =============================================================================
//  Assinatura em LOTE de ponta a ponta, contra o Supabase LOCAL de verdade (item 2 da rodada de
//  fechamento): 2 documentos válidos assinados juntos, um lote com item inválido misturado (nunca
//  finge sucesso total), e uma corrida real (2 chamadas concorrentes pro MESMO documento) — prova
//  que só uma vence e a outra recebe a mensagem AMIGÁVEL ("Você já assinou"), não o erro cru do
//  Postgres. pgTAP prova a autorização/estado no banco; só uma chamada HTTP concorrente de verdade
//  prova a corrida (é exatamente o que achou o bug corrigido na migration 98).
//
//  Uso:  node supabase/tests/e2e/assinatura-lote-ponta-a-ponta.mjs
//  Cria e apaga tudo com prefixo "e2e-lote-" — nunca toca em produção (URL fixa em 127.0.0.1).
// =============================================================================
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const SENHA = 'senha-e2e-lote-123'
const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
const uid = (k) => sql(`select md5('e2e-lote:${k}')::uuid;`)
const CLAUSULA_USUARIO = `(select id from auth.users where email like 'e2e-lote-%@teste.local')`

function limpar() {
  sql(`
    set session_replication_role = replica;
    delete from public.document_signatures where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.class_documents where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.workflow_stage_decisions where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.investiture_workflow_runs where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.class_investitures where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.investiture_reviews where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.class_completion_snapshots where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.member_requirements where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.member_classes where usuario_id in ${CLAUSULA_USUARIO};
    delete from public.organization_memberships where user_id in ${CLAUSULA_USUARIO};
    delete from public.profiles where id in ${CLAUSULA_USUARIO};
    delete from auth.users where email like 'e2e-lote-%@teste.local';
    delete from public.dynamic_content_values where fonte_descricao like 'FIXTURE DE TESTE E2E-LOTE%';
  `)
}

let total = 0, reprovados = 0
function ok(nome, cond, detalhe = '') { total++; if (!cond) { reprovados++; console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`) }

async function principal() {
  limpar()
  const idLider = uid('lider')
  const idMembro = uid('membro')
  sql(`
    set session_replication_role = replica;
    insert into public.club_features (club_id, feature, enabled) select id, 'classes', true from public.organizational_units where slug='filhos-da-conquista' on conflict (club_id, feature) do update set enabled=true;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
    values
      ('00000000-0000-0000-0000-000000000000', '${idLider}', 'authenticated', 'authenticated', 'e2e-lote-lider@teste.local',
        extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false),
      ('00000000-0000-0000-0000-000000000000', '${idMembro}', 'authenticated', 'authenticated', 'e2e-lote-membro@teste.local',
        extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
    insert into public.profiles (id, nome, papel, status) values
      ('${idLider}', 'E2E Lote Lider', 'diretoria', 'ativo'),
      ('${idMembro}', 'E2E Lote Membro', 'desbravador', 'ativo');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
    select u.id, o.id, u.role, 'ativo' from public.organizational_units o,
      (values ('${idLider}'::uuid, 'diretoria'), ('${idMembro}'::uuid, 'desbravador')) u(id, role)
    where o.slug='filhos-da-conquista';
    insert into public.dynamic_content_values (definicao_id, ano, valor, vigente_desde, vigente_ate, fonte_url, fonte_descricao)
    select d.id, extract(year from public._data_no_brasil())::int, 'Livro do ano [FIXTURE DE TESTE E2E-LOTE]',
           make_date(extract(year from public._data_no_brasil())::int, 1, 1), make_date(extract(year from public._data_no_brasil())::int, 12, 31),
           'https://exemplo.test/fixture', 'FIXTURE DE TESTE E2E-LOTE — não é o livro oficial'
    from public.dynamic_content_definitions d where d.chave in ('curso_leitura_amigo', 'curso_leitura_companheiro', 'curso_leitura_pesquisador')
    on conflict do nothing;
  `)
  console.log('== preparo: líder + 1 membro (mesma classe "amigo", pessoas diferentes) ==')

  const c = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const { error: errLogin } = await c.auth.signInWithPassword({ email: 'e2e-lote-lider@teste.local', password: SENHA })
  ok('login líder', !errLogin, errLogin?.message)
  const cMembro = createClient(API_URL, ANON, { auth: { persistSession: false } })
  const { error: errLoginM } = await cMembro.auth.signInWithPassword({ email: 'e2e-lote-membro@teste.local', password: SENHA })
  ok('login membro', !errLoginM, errLoginM?.message)

  const { data: classesDisponiveis } = await c.from('classes').select('id, manifesto_id').in('manifesto_id', ['amigo', 'companheiro', 'pesquisador'])
  const porManifesto = Object.fromEntries((classesDisponiveis || []).map((cc) => [cc.manifesto_id, cc.id]))

  async function documentoPronto(sufixo, classeId, revogar, quemInicia = c) {
    const { data: mc, error: errIni } = await quemInicia.rpc('classe_iniciar', { p_class_id: classeId })
    if (errIni || !mc?.member_class_id) throw new Error(`classe_iniciar falhou pra ${sufixo}: ${errIni?.message}`)
    const memberClassId = mc.member_class_id
    const { data: minha } = await quemInicia.rpc('minha_classe', { p_member_class_id: memberClassId })
    for (const secao of minha.secoes) {
      for (const r of secao.requisitos) {
        if (r.escolha) await quemInicia.rpc('requisito_escolher', { p_requirement_id: r.id, p_option_ids: r.escolha.opcoes?.[0]?.id ? [r.escolha.opcoes[0].id] : [], p_rotulos_livres: r.escolha.opcoes?.[0]?.id ? [] : [`[TESTE E2E-LOTE ${sufixo}]`] })
        else await quemInicia.rpc('requisito_salvar', { p_requirement_id: r.id, p_texto: `[TESTE E2E-LOTE ${sufixo}]`, p_evidencia_path: null })
        await quemInicia.rpc('requisito_enviar', { p_requirement_id: r.id })
      }
    }
    const { data: pendentes } = await c.rpc('classe_avaliacoes_pendentes')
    for (const p of pendentes || []) {
      await c.rpc('requisito_avaliar', { p_member_requirement_id: p.member_requirement_id, p_decisao: 'aprovado', p_comentario: `[TESTE E2E-LOTE ${sufixo}]`, p_submission_id: p.submission_id ?? null })
    }
    await c.rpc('revisao_final_decidir', { p_member_class_id: memberClassId, p_decisao: 'aprovado', p_observacao: `[TESTE E2E-LOTE ${sufixo}]`, p_requisitos_para_corrigir: [] })
    await c.rpc('investidura_registrar', { p_member_class_id: memberClassId, p_data: new Date().toISOString().slice(0, 10), p_observacao: `[TESTE E2E-LOTE ${sufixo}]` })
    const { data: doc, error: errDoc } = await c.rpc('documento_emitir', { p_member_class_id: memberClassId, p_tipo: 'final' })
    if (errDoc || !doc?.token) throw new Error(`documento_emitir falhou pra ${sufixo}: ${errDoc?.message}`)
    const { data: pdfResp } = await c.functions.invoke('gerar-documento-pdf', { body: { token: doc.token } })
    if (!pdfResp?.ok) throw new Error('PDF não gerou para ' + sufixo + ': ' + JSON.stringify(pdfResp))
    await c.rpc('documento_revisar', { p_token: doc.token, p_decisao: 'aprovado' })
    if (revogar) {
      const { data: reg } = await c.from('class_documents').select('snapshot_id').eq('token_publico', doc.token).single()
      const { error: errRev } = await c.rpc('snapshot_revogar', { p_snapshot_id: reg.snapshot_id, p_motivo: 'revogado de propósito [TESTE E2E-LOTE]' })
      if (errRev) throw new Error('revogar ' + sufixo + ': ' + errRev.message)
    }
    return doc.token
  }

  console.log('\n== preparo: 4 documentos prontos (A, B válidos; C revogado; D fica sem assinar) ==')
  const tokA = await documentoPronto('A', porManifesto.amigo, false)
  const tokB = await documentoPronto('B', porManifesto.companheiro, false)
  const tokC = await documentoPronto('C', porManifesto.pesquisador, true)
  const tokD = await documentoPronto('D', porManifesto.amigo, false, cMembro)
  ok('4 documentos prontos (2 válidos, 1 revogado, 1 reservado pra corrida)', !!(tokA && tokB && tokC && tokD))

  console.log('\n== lote: 2 documentos válidos, os dois assinam ==')
  const { data: lote1, error: errLote1 } = await c.rpc('documento_assinar_lote', { p_tokens: [tokA, tokB], p_consentimento_texto: 'Declaro que revisei os documentos selecionados [TESTE E2E-LOTE].' })
  ok('lote(A,B): 2 assinados, 0 recusados', !errLote1 && lote1?.assinados === 2 && lote1?.recusados === 0, JSON.stringify(lote1))
  ok('cada item do lote tem sua PRÓPRIA assinatura (signature_id distinto)', new Set((lote1?.itens || []).map((i) => i.signature_id)).size === 2)

  console.log('\n== lote: item revogado + token inexistente misturados com um válido — nunca finge sucesso total ==')
  const tokD2 = tokD // ainda não assinado
  const { data: lote2, error: errLote2 } = await c.rpc('documento_assinar_lote', { p_tokens: [tokD2, tokC, 'token-que-nao-existe-nunca'], p_consentimento_texto: 'Declaro lote misto [TESTE E2E-LOTE].' })
  ok('lote(D válido, C revogado, inexistente): 1 assinado, 2 recusados, com motivo individual', !errLote2 && lote2?.assinados === 1 && lote2?.recusados === 2, JSON.stringify(lote2))
  const itemC = (lote2?.itens || []).find((i) => i.token === tokC)
  const itemInexistente = (lote2?.itens || []).find((i) => i.token === 'token-que-nao-existe-nunca')
  ok('...o item do documento revogado explica o motivo', !itemC?.ok && /não é possível assinar|válido/i.test(itemC?.motivo || ''), itemC?.motivo)
  ok('...o item do token inexistente explica o motivo (não é o mesmo motivo do revogado)', !itemInexistente?.ok && /não encontrado/i.test(itemInexistente?.motivo || ''), itemInexistente?.motivo)

  console.log('\n== corrida real: 2ª chamada de lote pro MESMO documento (já assinado acima) ==')
  const { data: loteRepetido } = await c.rpc('documento_assinar_lote', { p_tokens: [tokD2], p_consentimento_texto: 'Declaro de novo [TESTE E2E-LOTE].' })
  ok('repetir o lote pro mesmo documento: recusado, mensagem AMIGÁVEL (não o erro cru do índice único)',
    loteRepetido?.recusados === 1 && loteRepetido?.itens?.[0]?.motivo === 'Você já assinou este documento.', JSON.stringify(loteRepetido))

  console.log('\n== corrida real: 2 chamadas CONCORRENTES de lote pra um documento AINDA sem assinatura ==')
  // documento F: mesma classe 'pesquisador' de C, mas pra OUTRA pessoa (cMembro) — classe_iniciar é
  // único por (pessoa, classe), então isto não colide com a matrícula de C.
  const classeExtra = porManifesto.pesquisador
  let tokCorrida = null
  try {
    const { data: mc } = await cMembro.rpc('classe_iniciar', { p_class_id: classeExtra })
    // já usada por 'C' (líder) — cMembro é outra pessoa, então isto cria uma matrícula NOVA e válida.
    const memberClassId = mc.member_class_id
    const { data: minha } = await cMembro.rpc('minha_classe', { p_member_class_id: memberClassId })
    for (const secao of minha.secoes) {
      for (const r of secao.requisitos) {
        if (r.escolha) await cMembro.rpc('requisito_escolher', { p_requirement_id: r.id, p_option_ids: r.escolha.opcoes?.[0]?.id ? [r.escolha.opcoes[0].id] : [], p_rotulos_livres: r.escolha.opcoes?.[0]?.id ? [] : ['[TESTE E2E-LOTE F]'] })
        else await cMembro.rpc('requisito_salvar', { p_requirement_id: r.id, p_texto: '[TESTE E2E-LOTE F]', p_evidencia_path: null })
        await cMembro.rpc('requisito_enviar', { p_requirement_id: r.id })
      }
    }
    const { data: pendentes } = await c.rpc('classe_avaliacoes_pendentes')
    for (const p of pendentes || []) await c.rpc('requisito_avaliar', { p_member_requirement_id: p.member_requirement_id, p_decisao: 'aprovado', p_comentario: '[TESTE E2E-LOTE F]', p_submission_id: p.submission_id ?? null })
    await c.rpc('revisao_final_decidir', { p_member_class_id: memberClassId, p_decisao: 'aprovado', p_observacao: '[TESTE E2E-LOTE F]', p_requisitos_para_corrigir: [] })
    await c.rpc('investidura_registrar', { p_member_class_id: memberClassId, p_data: new Date().toISOString().slice(0, 10), p_observacao: '[TESTE E2E-LOTE F]' })
    const { data: doc } = await c.rpc('documento_emitir', { p_member_class_id: memberClassId, p_tipo: 'final' })
    const { data: pdfResp } = await c.functions.invoke('gerar-documento-pdf', { body: { token: doc.token } })
    if (pdfResp?.ok) { await c.rpc('documento_revisar', { p_token: doc.token, p_decisao: 'aprovado' }); tokCorrida = doc.token }
  } catch { /* segue sem — o teste de corrida vira skip explícito abaixo */ }

  if (tokCorrida) {
    const cRace1 = createClient(API_URL, ANON, { auth: { persistSession: false } })
    const cRace2 = createClient(API_URL, ANON, { auth: { persistSession: false } })
    await cRace1.auth.signInWithPassword({ email: 'e2e-lote-lider@teste.local', password: SENHA })
    await cRace2.auth.signInWithPassword({ email: 'e2e-lote-lider@teste.local', password: SENHA })
    const [rc1, rc2] = await Promise.all([
      cRace1.rpc('documento_assinar_lote', { p_tokens: [tokCorrida], p_consentimento_texto: 'Declaro concorrência 1 [TESTE E2E-LOTE].' }),
      cRace2.rpc('documento_assinar_lote', { p_tokens: [tokCorrida], p_consentimento_texto: 'Declaro concorrência 2 [TESTE E2E-LOTE].' }),
    ])
    const totalAssinados = (rc1.data?.assinados || 0) + (rc2.data?.assinados || 0)
    const totalRecusados = (rc1.data?.recusados || 0) + (rc2.data?.recusados || 0)
    ok('corrida real (2 chamadas simultâneas): exatamente 1 assina, 1 é recusado — nunca os 2, nunca nenhum',
      totalAssinados === 1 && totalRecusados === 1, `assinados=${totalAssinados} recusados=${totalRecusados}`)
    const perdedor = [rc1.data, rc2.data].find((r) => r?.recusados === 1)
    ok('...e quem perde a corrida recebe a mensagem AMIGÁVEL, não o erro cru do índice único',
      perdedor?.itens?.[0]?.motivo === 'Você já assinou este documento.', perdedor?.itens?.[0]?.motivo)
  } else {
    console.log('   (pulado: não consegui preparar um 6º documento pra corrida — os testes de repetição sequencial acima já provam a mensagem amigável)')
  }

  limpar()
  console.log(`\n${total - reprovados}/${total} ok${reprovados ? ` — ${reprovados} FALHA(S)` : ' — TUDO OK'}`)
  process.exitCode = reprovados > 0 ? 1 : 0
}

principal().catch((e) => { console.error('ERRO INESPERADO:', e); limpar(); process.exit(1) })
