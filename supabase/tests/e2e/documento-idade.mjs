// =============================================================================
// E2E (Supabase LOCAL): foto do documento no requisito de idade (migration 380).
// Mecanismo REAL do app: login por senha, header x-clube-atual, upload e REMOÇÃO pela API do Storage
// (o teste SQL 98 só consegue simular a remoção). Prova que, depois de aprovado, o ARQUIVO some de
// verdade do armazenamento e fica só o registro "conferido por".
// Antes: node supabase/tests/e2e/_seed_homologacao.mjs
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

const API_URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SENHA = 'senha-homologacao-123'
const CONT = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_CONQUISTA'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const sql = (t) => execFileSync('docker', ['exec', '-i', CONT, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: t, encoding: 'utf8' }).trim()
let total = 0, reprovados = 0
const ok = (nome, cond, detalhe = '') => { total++; if (!cond) { reprovados++; console.log(`   FALHOU ${nome}  [${detalhe}]`) } else console.log(`   ok     ${nome}`) }

async function logar(email, clube) {
  const f = (input, init) => { const o = { ...(init || {}) }; const h = new Headers(o.headers || {}); h.set('x-clube-atual', clube); o.headers = h; return fetch(input, o) }
  const c = createClient(API_URL, ANON, { auth: { persistSession: false }, global: { fetch: f } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { c, uid: data.user.id }
}
const existe = (path) => sql(`select count(*) from storage.objects where bucket_id='comprovacoes' and name='${path}';`) === '1'

const clubeA = sql(`select id from public.organizational_units where slug='hml-clube-a';`)
if (!clubeA) throw new Error('rode antes: node supabase/tests/e2e/_seed_homologacao.mjs')
sql(`delete from public.member_classes where usuario_id = md5('hml:desbravador')::uuid;
     insert into public.club_features (club_id, feature, enabled) values ('${clubeA}', 'classes', true) on conflict (club_id, feature) do update set enabled = true;`)

const desb = await logar('hml-desbravador@teste.local', clubeA)
const instr = await logar('hml-instrutor@teste.local', clubeA)
const cons = await logar('hml-conselheiro@teste.local', clubeA)

// 519: classe já concluída não é oferecida de novo; conquistas que outro E2E (personas) deixou para o mesmo hml-desbravador não podem valer aqui
sql(`delete from public.curriculum_achievements where usuario_id in (select id from auth.users where email like 'hml-%@teste.local')`)
const amigo = sql(`select c.id from public.classes c join public.curriculum_versions v on v.id=c.curriculum_version_id where v.origem='oficial' and v.status='publicado' and c.manifesto_id='amigo';`)
const reqIdade = sql(`select r.id from public.class_requirements r join public.class_sections s on s.id=r.section_id where s.class_id='${amigo}' and r.manifesto_id='amigo.I.1';`)
ok('desbravador inicia Amigo', !(await desb.c.rpc('classe_iniciar', { p_class_id: amigo })).error)

const semDoc = await desb.c.rpc('requisito_enviar', { p_requirement_id: reqIdade })
ok('sem documento o envio é recusado', /foto do documento/.test(semDoc.error?.message || ''), semDoc.error?.message)

const p1 = `${desb.uid}/documentos/e2e-1.png`, p2 = `${desb.uid}/documentos/e2e-2.png`
for (const p of [p1, p2]) await desb.c.storage.from('comprovacoes').remove([p])
ok('upload da 1ª foto', !(await desb.c.storage.from('comprovacoes').upload(p1, PNG, { contentType: 'image/png' })).error)
ok('registra a 1ª foto', !(await desb.c.rpc('documento_enviar', { p_requirement_id: reqIdade, p_path: p1 })).error)
ok('upload da 2ª foto (troca)', !(await desb.c.storage.from('comprovacoes').upload(p2, PNG, { contentType: 'image/png' })).error)
const troca = await desb.c.rpc('documento_enviar', { p_requirement_id: reqIdade, p_path: p2 })
ok('troca devolve o caminho antigo', troca.data?.caminho_antigo === p1, JSON.stringify(troca))
ok('dono apaga a foto antiga pela API', !(await desb.c.storage.from('comprovacoes').remove([p1])).error && !existe(p1))
ok('envia para avaliação com o documento', !(await desb.c.rpc('requisito_enviar', { p_requirement_id: reqIdade })).error)

const mr = sql(`select id from public.member_requirements where usuario_id='${desb.uid}' and requirement_id='${reqIdade}';`)
const urlInstr = await instr.c.storage.from('comprovacoes').createSignedUrl(p2, 60)
ok('instrutor abre o documento', !!urlInstr.data?.signedUrl, urlInstr.error?.message)
const urlCons = await cons.c.storage.from('comprovacoes').createSignedUrl(p2, 60)
ok('conselheiro NÃO abre o documento', !urlCons.data?.signedUrl)
await cons.c.storage.from('comprovacoes').remove([p2]); ok('conselheiro NÃO apaga o documento', existe(p2))
await instr.c.storage.from('comprovacoes').remove([p2]); ok('instrutor NÃO apaga antes de aprovar', existe(p2))
ok('foto não entrou no histórico', sql(`select count(*) from public.requirement_submissions where member_requirement_id='${mr}' and evidencia_path is not null;`) === '0')

ok('instrutor aprova', !(await instr.c.rpc('requisito_avaliar', { p_member_requirement_id: mr, p_decisao: 'aprovado' })).error)
ok('documento conferido pelo instrutor', sql(`select status||'|'||(conferido_por = md5('hml:instrutor')::uuid)::text from public.comprovacoes_documento where member_requirement_id='${mr}';`) === 'conferido|true')
// o que o app faz depois de aprovar (services/classes.js → apagarDocumentoConferido)
ok('instrutor apaga o arquivo pela API', !(await instr.c.storage.from('comprovacoes').remove([p2])).error)
ok('o ARQUIVO sumiu do armazenamento', !existe(p2))
ok('marca como apagado', !(await instr.c.rpc('documento_marcar_apagado', { p_member_requirement_id: mr })).error)
ok('fica só o registro', sql(`select (evidencia_path is null)::text||'|'||(foto_apagada_em is not null)::text from public.comprovacoes_documento where member_requirement_id='${mr}';`) === 'true|true')
const visto = await desb.c.rpc('documento_do_requisito', { p_member_requirement_id: mr })
ok('desbravador vê "conferido por"', visto.data?.documento?.status === 'conferido' && !!visto.data?.documento?.conferido_por_nome, JSON.stringify(visto.data))

console.log(`\n${total - reprovados}/${total} ok`)
process.exit(reprovados ? 1 : 0)
