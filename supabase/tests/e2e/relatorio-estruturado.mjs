// =============================================================================
//  E2E LOCAL do motor de RELATÓRIO ESTRUTURADO (fase 7) — por HTTP, contra o Supabase LOCAL de verdade.
//  Cada chamada usa o mecanismo REAL do app: login por senha, header x-clube-atual, Storage real.
//
//  Classes:  formulários numa chamada · rascunho/autosave · envio (validado no servidor) · anexos reais no bucket
//            privado · devolução com comentário · correção · reenvio · histórico com a tentativa antiga preservada ·
//            avaliação · progresso · permissões · multiclube · anexo visível só à liderança do clube certo.
//  Especialidades: a especialidade FICTÍCIA TE-001 (gerada do manifesto de teste) importada SÓ neste banco local e
//            APAGADA no fim: N de M, dependência, meta, vários anexos, prazo, progresso, conclusão, histórico.
//
//  Pré-requisitos: stack local no ar + `node supabase/tests/e2e/_seed_homologacao.mjs` (contas hml-*).
//  Uso:  node supabase/tests/e2e/relatorio-estruturado.mjs
//  NUNCA toca em produção: a URL é fixa em 127.0.0.1 e o SQL vai por `docker exec` no container local.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA = 'senha-homologacao-123'
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const aqui = dirname(fileURLToPath(import.meta.url))

function sql(texto) {
  return execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: texto, encoding: 'utf8' }).trim()
}
let total = 0, reprovados = 0
function ok(nome, cond, detalhe = '') { total++; if (!cond) { reprovados++; console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`) }
const msg = (r) => r?.error?.message || ''
const recusou = (r, trecho) => !!r.error && (!trecho || new RegExp(trecho, 'i').test(r.error.message))

async function logar(email) {
  let clube = null
  const f = (input, init) => { const o = { ...(init || {}) }; const h = new Headers(o.headers || {}); if (clube) h.set('x-clube-atual', clube); o.headers = h; return fetch(input, o) }
  const c = createClient(API_URL, ANON, { auth: { persistSession: false }, global: { fetch: f } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { c, uid: data.user.id, clube: (id) => { clube = id } }
}
let seq = 0
async function subir(p, pasta = 'requisitos') {
  const path = `${p.uid}/${pasta}/e2e-rel-${Date.now()}-${++seq}.png`
  const r = await p.c.storage.from('comprovacoes').upload(path, PNG, { contentType: 'image/png' })
  if (r.error) throw new Error('upload: ' + r.error.message)
  return path
}
const podeAbrir = async (p, path) => !(await p.c.storage.from('comprovacoes').download(path)).error

function limpar() {
  sql(`
    set session_replication_role = replica;
    delete from public.requirement_approvals where member_specialty_requirement_id in (select id from public.member_specialty_requirements where specialty_requirement_id in (select r.id from public.specialty_requirements r join public.specialties s on s.id = r.specialty_id where s.codigo in ('TE-001', 'TE-002')));
    delete from public.specialty_requirement_submissions where specialty_requirement_id in (select r.id from public.specialty_requirements r join public.specialties s on s.id = r.specialty_id where s.codigo in ('TE-001', 'TE-002'));
    delete from public.member_specialty_requirements where specialty_requirement_id in (select r.id from public.specialty_requirements r join public.specialties s on s.id = r.specialty_id where s.codigo in ('TE-001', 'TE-002'));
    delete from public.member_specialties where specialty_id in (select id from public.specialties where codigo in ('TE-001', 'TE-002'));
    delete from public.specialty_requirements where specialty_id in (select id from public.specialties where codigo in ('TE-001', 'TE-002'));
    delete from public.specialty_requirement_groups where specialty_id in (select id from public.specialties where codigo in ('TE-001', 'TE-002'));
    delete from public.specialties where codigo in ('TE-001', 'TE-002');
    delete from public.curriculum_versions where identificador = 'especialidades-teste-local';
    delete from public.requirement_approvals where member_requirement_id in (select id from public.member_requirements where usuario_id in (md5('hml:desbravador')::uuid, md5('hml:desbravador2')::uuid, md5('hml:instrutor')::uuid, md5('hml:multi')::uuid, md5('hml:diretoria_a')::uuid));
    delete from public.requirement_submissions where member_requirement_id in (select id from public.member_requirements where usuario_id in (md5('hml:desbravador')::uuid, md5('hml:desbravador2')::uuid, md5('hml:instrutor')::uuid, md5('hml:multi')::uuid, md5('hml:diretoria_a')::uuid));
    -- session_replication_role = replica DESLIGA os ON DELETE CASCADE: apagar os filhos explicitamente (senão sobram linhas órfãs)
    delete from public.member_requirements where usuario_id in (md5('hml:desbravador')::uuid, md5('hml:desbravador2')::uuid, md5('hml:instrutor')::uuid, md5('hml:multi')::uuid, md5('hml:diretoria_a')::uuid);
    delete from public.member_classes where usuario_id in (md5('hml:desbravador')::uuid, md5('hml:desbravador2')::uuid, md5('hml:instrutor')::uuid, md5('hml:multi')::uuid, md5('hml:diretoria_a')::uuid);
  `)
}

async function principal() {
  const id = (slug) => sql(`select id from public.organizational_units where slug='${slug}';`)
  const clubeA = id('hml-clube-a'), clubeB = id('hml-clube-b')
  if (!clubeA || !clubeB) throw new Error('rode antes: node supabase/tests/e2e/_seed_homologacao.mjs')
  console.log('== preparo (só banco local): recursos ligados, limpeza de rodadas anteriores, contas hml-* ==')
  limpar()
  sql(`insert into public.club_features (club_id, feature, enabled) values ('${clubeA}', 'classes', true), ('${clubeB}', 'classes', true), ('${clubeA}', 'especialidades', true), ('${clubeB}', 'especialidades', true)
       on conflict (club_id, feature) do update set enabled = true;`)

  const desb = await logar('hml-desbravador@teste.local'); desb.clube(clubeA)
  const desb2 = await logar('hml-desbravador2@teste.local'); desb2.clube(clubeB)      // outra criança, de OUTRO clube
  const est = await logar('hml-multi@teste.local'); est.clube(clubeA)                 // pessoa em 2 clubes (desbravador no A, conselheiro no B)
  const instr = await logar('hml-instrutor@teste.local'); instr.clube(clubeA)
  const dirA = await logar('hml-diretoria_a@teste.local'); dirA.clube(clubeA)
  const dirB = await logar('hml-diretoria_b@teste.local'); dirB.clube(clubeB)
  const coord = await logar('hml-coord_dist@teste.local')

  // a classe da versão PUBLICADA (as anteriores ficam arquivadas e não servem para matrícula nova)
  const classe = async (m) => sql(`select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.manifesto_id = '${m}' and v.origem = 'oficial' and v.status = 'publicado' limit 1;`)
  const reqId = (m) => sql(`select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = '${m}' and v.origem = 'oficial' and v.status = 'publicado' limit 1;`)

  // ===================================================================================== CLASSES
  console.log('\n== 1) Classe Amigo: formulários numa chamada, rascunho, autosave, envio ==')
  const mcA = (await desb.c.rpc('classe_iniciar', { p_class_id: await classe('amigo') })).data?.member_class_id
  ok('desbravador inicia a classe Amigo', !!mcA)
  const forms = await desb.c.rpc('classe_formularios', { p_member_class_id: mcA })
  const reqIV1 = reqId('amigo.IV.1')
  ok('classe_formularios traz os requisitos com formulário numa chamada só', !forms.error && !!forms.data?.[reqIV1] && Object.keys(forms.data).length >= 6, msg(forms))
  ok('...e não traz requisito sem formulário (amigo.I.1)', !forms.data?.[reqId('amigo.I.1')])

  const c10 = (p) => ({ qualidades: Array.from({ length: 10 }, (_, i) => `${p} qualidade ${i + 1}`), situacoes: Array.from({ length: 4 }, (_, i) => `${p} situação ${i + 1}`) })
  // AUTOSAVE: vários rascunhos seguidos (é o que o formulário faz a cada pausa de digitação); vale o último
  for (const n of [2, 5, 8]) ok(`autosave: rascunho com ${n} qualidades`, !(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: { qualidades: c10('x').qualidades.slice(0, n) }, p_anexos: [] })).error)
  const f1 = await desb.c.rpc('requisito_formulario', { p_requirement_id: reqIV1 })
  ok('o último rascunho ficou no servidor (8) e o requisito está em andamento', f1.data?.rascunho?.qualidades?.length === 8 && f1.data?.status === 'em_andamento', JSON.stringify(f1.data?.rascunho)?.slice(0, 80))
  ok('rascunho NÃO cria tentativa', f1.data?.tentativas === 0)
  ok('servidor recusa campo desconhecido', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: { hack: 1 }, p_anexos: [] }), 'desconhecido'))
  ok('envio incompleto é recusado e diz o que falta', recusou(await desb.c.rpc('requisito_enviar', { p_requirement_id: reqIV1 }), 'Formulário incompleto'))
  ok('rascunho completo', !(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: c10('primeira'), p_anexos: [] })).error)
  const e1 = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqIV1 })
  ok('envio (tentativa 1)', !e1.error && e1.data?.tentativa_numero === 1, msg(e1))
  ok('não edita enquanto aguarda avaliação', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: c10('x'), p_anexos: [] }), 'Aguarde'))

  console.log('\n== 2) avaliação: devolução com comentário → correção → reenvio → histórico → aprovação ==')
  const fila = async (p) => (await p.c.rpc('classe_avaliacoes_pendentes')).data || []
  let linha = (await fila(instr)).find((l) => l.requisito_id === reqIV1 && l.usuario_id === desb.uid)
  ok('a fila do instrutor traz o CONTEÚDO estruturado e o modelo', linha?.conteudo?.qualidades?.[0] === 'primeira qualidade 1' && linha?.modelo?.familia === 'A2', JSON.stringify(linha)?.slice(0, 120))
  const mrIV1 = linha?.member_requirement_id
  ok('devolver sem comentário é recusado', recusou(await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: mrIV1, p_decisao: 'correcao_solicitada', p_comentario: null, p_submission_id: linha.submission_id }), 'Explique'))
  ok('instrutor devolve com comentário', !(await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: mrIV1, p_decisao: 'correcao_solicitada', p_comentario: 'Troque as 3 últimas qualidades.', p_submission_id: linha.submission_id })).error)
  const f2 = await desb.c.rpc('requisito_formulario', { p_requirement_id: reqIV1 })
  ok('o desbravador vê o comentário e o status "correção solicitada"', f2.data?.status === 'correcao_solicitada' && f2.data?.ultima_avaliacao?.comentario === 'Troque as 3 últimas qualidades.', JSON.stringify(f2.data?.ultima_avaliacao))
  ok('corrige o rascunho', !(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: c10('CORRIGIDA'), p_anexos: [] })).error)
  const e2 = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqIV1 })
  ok('reenvio (tentativa 2)', !e2.error && e2.data?.tentativa_numero === 2, msg(e2))
  const hist = await desb.c.rpc('requisito_historico', { p_member_requirement_id: mrIV1 })
  const t = hist.data?.tentativas || []
  ok('HISTÓRICO: 2 tentativas, a 1ª PRESERVADA com o conteúdo original', t.length === 2 && t[0].conteudo?.qualidades?.[0] === 'primeira qualidade 1' && t[1].conteudo?.qualidades?.[0] === 'CORRIGIDA qualidade 1', JSON.stringify(t.map((x) => x.conteudo?.qualidades?.[0])))
  ok('...com decisão, avaliador (papel) e comentário na 1ª', t[0]?.decisao === 'correcao_solicitada' && t[0]?.avaliado_papel === 'instrutor' && t[0]?.comentario === 'Troque as 3 últimas qualidades.', JSON.stringify(t[0]))
  ok('...e a 2ª ainda sem decisão', t[1]?.decisao == null)
  linha = (await fila(dirA)).find((l) => l.requisito_id === reqIV1 && l.usuario_id === desb.uid)
  ok('avaliar a tentativa ANTIGA (1) é recusado (só a mais recente)', recusou(await dirA.c.rpc('requisito_avaliar', { p_member_requirement_id: mrIV1, p_decisao: 'aprovado', p_comentario: null, p_submission_id: t[0].submission_id }), 'mais recente'))
  ok('diretoria aprova a tentativa 2', !(await dirA.c.rpc('requisito_avaliar', { p_member_requirement_id: mrIV1, p_decisao: 'aprovado', p_comentario: 'Ótimo', p_submission_id: linha.submission_id })).error)
  ok('a mesma tentativa não é decidida de novo por outra pessoa', recusou(await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: mrIV1, p_decisao: 'correcao_solicitada', p_comentario: 'tarde', p_submission_id: linha.submission_id }), 'já foi avaliada|mais recente'))
  const hist2 = await instr.c.rpc('requisito_historico', { p_member_requirement_id: mrIV1 })
  ok('histórico final: correção (instrutor) + aprovado (diretoria)', hist2.data?.tentativas?.map((x) => x.decisao + ':' + x.avaliado_papel).join() === 'correcao_solicitada:instrutor,aprovado:diretoria', JSON.stringify(hist2.data?.tentativas?.map((x) => x.decisao)))
  const mc1 = await desb.c.rpc('minha_classe', { p_member_class_id: mcA })
  ok('PROGRESSO: a classe subiu de 0 (1 requisito aprovado)', (mc1.data?.member_class?.percentual ?? 0) > 0, JSON.stringify(mc1.data?.member_class?.percentual))
  ok('reenvio/edição depois de aprovado é recusado', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: c10('y'), p_anexos: [] }), 'já foi aprovado'))

  console.log('\n== 3) Classe Companheiro: relato com anexos reais no Storage; visibilidade só do clube certo ==')
  const mcC = (await desb.c.rpc('classe_iniciar', { p_class_id: await classe('companheiro') })).data?.member_class_id
  const reqAc = reqId('companheiro.VIII.2')
  const fa = await subir(desb), fb = await subir(desb)
  const relato = { data: '2026-01-10', data_fim: '2026-01-11', local: 'Sítio Bom Pastor', descricao: 'Montamos barracas e fizemos fogueira.', aprendizado: 'Aprendi a trabalhar em equipe.' }
  const anx = [{ campo: 'fotos', path: fa }, { campo: 'fotos', path: fb }]
  const foto3 = [...anx, { campo: 'fotos', path: fa }]
  ok('mais anexos que o máximo (2) é recusado', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqAc, p_conteudo: relato, p_anexos: foto3 }), 'no máximo'))
  const alheio = await subir(desb2)
  ok('arquivo de OUTRA pessoa é recusado', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqAc, p_conteudo: relato, p_anexos: [{ campo: 'fotos', path: alheio }] }), 'não é seu'))
  ok('arquivo inexistente é recusado', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqAc, p_conteudo: relato, p_anexos: [{ campo: 'fotos', path: `${desb.uid}/requisitos/fantasma.png` }] }), 'não encontrado'))
  ok('arquivo de OUTRO clube (caminho novo <clube_b>/<eu>/…) é recusado', recusou(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqAc, p_conteudo: relato, p_anexos: [{ campo: 'fotos', path: `${clubeB}/${desb.uid}/requisitos/x.png` }] }), 'não é seu|outro clube|não encontrado'))
  ok('relato com 2 fotos: rascunho', !(await desb.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqAc, p_conteudo: relato, p_anexos: anx })).error)
  const ea = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqAc })
  ok('relato enviado com os anexos', !ea.error, msg(ea))
  ok('a liderança do clube A ABRE os anexos', (await podeAbrir(dirA, fa)) && (await podeAbrir(dirA, fb)))
  ok('a liderança de OUTRO clube NÃO abre', !(await podeAbrir(dirB, fa)))
  ok('outro desbravador do mesmo clube NÃO abre', !(await podeAbrir(desb2, fa)))
  const mrAc = (await fila(dirA)).find((l) => l.requisito_id === reqAc)?.member_requirement_id
  const hAc = await dirA.c.rpc('requisito_historico', { p_member_requirement_id: mrAc })
  ok('o histórico da liderança traz os 2 anexos da tentativa', hAc.data?.tentativas?.[0]?.anexos?.length === 2, JSON.stringify(hAc.data?.tentativas?.[0]?.anexos))

  console.log('\n== 4) permissões e multiclube (Classes) ==')
  ok('OUTRO desbravador não lê o histórico', recusou(await desb2.c.rpc('requisito_historico', { p_member_requirement_id: mrIV1 }), 'não encontrado'))
  ok('liderança de OUTRO clube não lê o histórico', recusou(await dirB.c.rpc('requisito_historico', { p_member_requirement_id: mrIV1 }), 'não encontrado'))
  ok('...nem avalia (UUID de outro clube)', recusou(await dirB.c.rpc('requisito_avaliar', { p_member_requirement_id: mrAc, p_decisao: 'aprovado', p_comentario: null, p_submission_id: null }), 'não encontrado'))
  ok('...e a fila do clube B não traz nada do A', (await fila(dirB)).every((l) => l.usuario_id !== desb.uid))
  const multiB = await logar('hml-multi@teste.local'); multiB.clube(clubeB)
  ok('MULTICLUBE: a mesma pessoa, operando no OUTRO clube, não lê o histórico do clube A', recusou(await multiB.c.rpc('requisito_historico', { p_member_requirement_id: mrIV1 }), 'não encontrado'))
  ok('coordenação distrital não lê histórico de clube abaixo', recusou(await coord.c.rpc('requisito_historico', { p_member_requirement_id: mrIV1 })))
  ok('coordenação não enxerga tentativas pelas tabelas', ((await coord.c.from('requirement_submissions').select('id').limit(5)).data || []).length === 0)
  ok('desbravador não avalia (sem permissão)', recusou(await desb.c.rpc('requisito_avaliar', { p_member_requirement_id: mrAc, p_decisao: 'aprovado', p_comentario: null, p_submission_id: null })))
  ok('desbravador não abre formulário de requisito de quem não é ele (desb2 sem matrícula)', recusou(await desb2.c.rpc('requisito_formulario', { p_requirement_id: reqIV1 }), 'não encontrado'))
  // ninguém avalia o próprio requisito: a liderança faz a própria classe
  const ci = await instr.c.rpc('classe_iniciar', { p_class_id: await classe('amigo') })
  ok('instrutor inicia a própria classe', !ci.error, msg(ci))
  await instr.c.rpc('requisito_relatorio_salvar', { p_requirement_id: reqIV1, p_conteudo: c10('do instrutor'), p_anexos: [] })
  ok('instrutor envia o próprio relatório', !(await instr.c.rpc('requisito_enviar', { p_requirement_id: reqIV1 })).error)
  const mrInstr = sql(`select mr.id from public.member_requirements mr where mr.usuario_id = '${instr.uid}' and mr.requirement_id = '${reqIV1}'`)
  ok('instrutor NÃO aprova o próprio requisito', recusou(await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: mrInstr, p_decisao: 'aprovado', p_comentario: null, p_submission_id: null }), 'próprio requisito'))
  ok('...mas a diretoria aprova o requisito do instrutor', !(await dirA.c.rpc('requisito_avaliar', { p_member_requirement_id: mrInstr, p_decisao: 'aprovado', p_comentario: null, p_submission_id: null })).error)

  // ===================================================================================== ESPECIALIDADE FICTÍCIA
  console.log('\n== 5) Especialidade FICTÍCIA TE-001 (só neste banco local; apagada no fim) ==')
  sql(readFileSync(join(aqui, '..', '_fixture_especialidade_teste.sql'), 'utf8'))
  const esp = sql(`select id from public.specialties where codigo = 'TE-001';`)
  ok('TE-001 importada do manifesto de teste', !!esp)
  const sr = (o) => sql(`select r.id from public.specialty_requirements r where r.specialty_id = '${esp}' and r.codigo = '${o}';`)
  const ini = await est.c.rpc('especialidade_iniciar', { p_specialty_id: esp })
  ok('desbravador inicia a especialidade', !ini.error, msg(ini))
  const msId = ini.data?.member_specialty_id
  const minha = async () => (await est.c.rpc('minha_especialidade', { p_member_specialty_id: msId })).data
  let m = await minha()
  ok('14 requisitos, 0%, grupo N de M com mínimo 2', m?.requisitos?.length === 14 && m?.member_specialty?.percentual === 0 && m?.grupos?.[0]?.minimo === 2, JSON.stringify(m?.member_specialty))
  ok('requisito dependente (9) vem bloqueado', m?.requisitos?.find((r) => r.codigo === '9')?.bloqueios?.[0]?.includes('requisito 2'))
  const salvarEnviar = async (ordem, conteudo, anexos = []) => {
    const a = await est.c.rpc('especialidade_requisito_relatorio_salvar', { p_specialty_requirement_id: sr(ordem), p_conteudo: conteudo, p_anexos: anexos })
    if (a.error) return a
    return est.c.rpc('especialidade_requisito_enviar', { p_specialty_requirement_id: sr(ordem) })
  }
  const pend = async (p) => (await p.c.rpc('especialidade_avaliacoes_pendentes')).data || []
  const decidir = async (avaliador, ordem, decisao, comentario = null) => {
    const l = (await pend(avaliador)).find((x) => x.requisito_codigo === String(ordem) && x.usuario_id === est.uid)
    return avaliador.c.rpc('especialidade_requisito_avaliar', { p_member_specialty_requirement_id: l?.member_specialty_requirement_id, p_decisao: decisao, p_comentario: comentario, p_submission_id: l?.submission_id ?? null })
  }
  ok('requisito 9 bloqueado até o 2 ser aprovado', recusou(await salvarEnviar(9, { resposta: 'x' }), 'bloqueado'))
  ok('resposta: rascunho + envio (tentativa 1)', !(await salvarEnviar(2, { resposta: 'rascunho' })).error)
  ok('instrutor devolve com comentário', !(await decidir(instr, 2, 'correcao_solicitada', 'Escreva mais.')).error)
  ok('corrige e reenvia (tentativa 2)', !(await salvarEnviar(2, { resposta: 'resposta detalhada' })).error)
  ok('diretoria aprova', !(await decidir(dirA, 2, 'aprovado', 'Ótimo')).error)
  const msr2 = sql(`select id from public.member_specialty_requirements where member_specialty_id = '${msId}' and specialty_requirement_id = '${sr(2)}'`)
  const hs = (await est.c.rpc('especialidade_historico', { p_member_specialty_requirement_id: msr2 })).data
  ok('HISTÓRICO da especialidade: 2 tentativas com conteúdo, decisão, papel e comentário', hs?.tentativas?.length === 2 && hs.tentativas[0].conteudo.resposta === 'rascunho' && hs.tentativas[0].decisao === 'correcao_solicitada' && hs.tentativas[0].avaliado_papel === 'instrutor' && hs.tentativas[1].decisao === 'aprovado', JSON.stringify(hs?.tentativas?.map((x) => x.decisao)))
  ok('dependente (9) libera depois do 2 aprovado', !(await salvarEnviar(9, { resposta: 'aprendi' })).error)
  ok('leitura (1)', !(await salvarEnviar(1, { li: true })).error)
  const g1 = await subir(est, 'especialidades'), g2 = await subir(est, 'especialidades'), g3 = await subir(est, 'especialidades')
  ok('relatório com 3 fotos (múltiplos anexos)', !(await salvarEnviar(3, { data: '2026-01-10', local: 'Praça', descricao: 'Fui' }, [g1, g2, g3].map((p) => ({ campo: 'fotos', path: p })))).error)
  ok('foto obrigatória: sem anexo é recusado', recusou(await salvarEnviar(4, {}), 'pelo menos'))
  ok('arquivos: 1 (mínimo 2) recusado', recusou(await salvarEnviar(5, {}, [{ campo: 'arquivos', path: g1 }]), 'pelo menos'))
  ok('meta: 3 dias < 4 recusado', recusou(await salvarEnviar(8, { dias: 3, fiz: true }), 'mínimo'))
  ok('meta: 4 dias ok', !(await salvarEnviar(8, { dias: 4, fiz: true })).error)
  ok('atividade (6) e validação (7)', !(await salvarEnviar(6, { fiz: true })).error && !(await salvarEnviar(7, { demonstrei: true })).error)
  ok('a liderança do clube A abre os anexos da especialidade', await podeAbrir(dirA, g1))
  ok('a liderança de OUTRO clube não abre', !(await podeAbrir(dirB, g1)))
  const multiB2 = await logar('hml-multi@teste.local'); multiB2.clube(clubeB)
  ok('MULTICLUBE: operando no clube B a pessoa não vê a especialidade que faz no A', (await multiB2.c.rpc('minha_especialidade', { p_member_specialty_id: msId })).data == null)
  ok('liderança de OUTRO clube não avalia nem lê', (await pend(dirB)).length === 0 && recusou(await dirB.c.rpc('especialidade_historico', { p_member_specialty_requirement_id: msr2 }), 'não encontrado'))
  ok('coordenação não lê o histórico da especialidade', recusou(await coord.c.rpc('especialidade_historico', { p_member_specialty_requirement_id: msr2 })))
  for (const o of [1, 3, 6, 7, 8, 9]) if ((await decidir(dirA, o, 'aprovado')).error) ok(`aprova requisito ${o}`, false)
  m = await minha()
  ok('progresso depois das aprovações (avulsos)', m.member_specialty.percentual > 0 && m.member_specialty.percentual < 100, m.member_specialty.percentual)
  console.log('   (o 4 e o 5 ficam pendentes de propósito — faltam anexos; completa agora)')
  ok('foto (4) agora com 1 anexo', !(await salvarEnviar(4, {}, [{ campo: 'foto', path: g1 }])).error)
  ok('arquivos (5) com 3 anexos', !(await salvarEnviar(5, {}, [g1, g2, g3].map((p) => ({ campo: 'arquivos', path: p })))).error)
  for (const o of [4, 5]) ok(`aprova ${o}`, !(await decidir(dirA, o, 'aprovado')).error)
  for (const o of [10, 11, 12]) ok(`técnica ${o} enviada`, !(await salvarEnviar(o, { fiz: true })).error)
  ok('aprova técnica 10', !(await decidir(dirA, 10, 'aprovado')).error)
  const p1 = (await minha()).member_specialty.percentual
  ok('grupo N de M: 1 de 2 técnicas conta', p1 > 0, p1)
  ok('aprova técnica 11 (mínimo do grupo)', !(await decidir(dirA, 11, 'aprovado')).error)
  const p2 = (await minha()).member_specialty.percentual
  ok('grupo N de M: 2 de 2 → progresso maior', p2 > p1, `${p1} → ${p2}`)
  ok('técnica 12 (extra) aprovada NÃO passa do mínimo', !(await decidir(dirA, 12, 'aprovado')).error && (await minha()).member_specialty.percentual === p2)
  ok('ainda em andamento (falta o requisito 14)', (await minha()).member_specialty.status === 'em_andamento')
  ok('requisito 14 dentro do prazo', !(await salvarEnviar(14, { resposta: 'final' })).error)
  ok('diretoria aprova o último → CONCLUÍDA automaticamente', !(await decidir(dirA, 14, 'aprovado')).error && (await minha()).member_specialty.status === 'concluida' && (await minha()).member_specialty.percentual === 100)
  // prazo: outra pessoa começa e o prazo vence sem entrega
  const ini2 = await desb.c.rpc('especialidade_iniciar', { p_specialty_id: esp })
  sql(`update public.member_specialties set iniciada_em = now() - interval '40 days' where id = '${ini2.data?.member_specialty_id}'`)
  const semPrazo = await desb.c.rpc('especialidade_requisito_relatorio_salvar', { p_specialty_requirement_id: sr(14), p_conteudo: { resposta: 'atrasada' }, p_anexos: [] })
  const envAtrasado = semPrazo.error ? semPrazo : await desb.c.rpc('especialidade_requisito_enviar', { p_specialty_requirement_id: sr(14) })
  ok('PRAZO: depois de 30 dias, sem entrega anterior, o envio é bloqueado', recusou(envAtrasado, 'prazo'), msg(envAtrasado))
  ok('quem NÃO iniciou não envia (UUID de requisito de especialidade)', recusou(await dirB.c.rpc('especialidade_requisito_enviar', { p_specialty_requirement_id: sr(2) }), 'não encontrado'))
  // ninguém avalia o próprio requisito (especialidade)
  const iniI = await dirA.c.rpc('especialidade_iniciar', { p_specialty_id: esp })
  await dirA.c.rpc('especialidade_requisito_relatorio_salvar', { p_specialty_requirement_id: sr(1), p_conteudo: { li: true }, p_anexos: [] })
  await dirA.c.rpc('especialidade_requisito_enviar', { p_specialty_requirement_id: sr(1) })
  const msrDir = sql(`select id from public.member_specialty_requirements where member_specialty_id = '${iniI.data?.member_specialty_id}' and specialty_requirement_id = '${sr(1)}'`)
  ok('diretoria NÃO aprova o próprio requisito de especialidade', recusou(await dirA.c.rpc('especialidade_requisito_avaliar', { p_member_specialty_requirement_id: msrDir, p_decisao: 'aprovado', p_comentario: null, p_submission_id: null }), 'próprio requisito'))
  ok('instrutor avalia o da diretoria normalmente', !(await instr.c.rpc('especialidade_requisito_avaliar', { p_member_specialty_requirement_id: msrDir, p_decisao: 'aprovado', p_comentario: null, p_submission_id: null })).error)

  console.log('\n== limpeza: TE-001 e o que os testes criaram (só banco local) ==')
  limpar()
  ok('TE-001 removida', sql(`select count(*) from public.specialties where codigo in ('TE-001', 'TE-002')`) === '0')
  console.log(`\n${total - reprovados}/${total} ok${reprovados ? ` — ${reprovados} FALHA(S)` : ' — TUDO OK'}`)
  process.exitCode = reprovados ? 1 : 0
}

principal().catch((e) => { console.error('ERRO INESPERADO:', e); try { limpar() } catch { /* ok */ } process.exit(1) })
