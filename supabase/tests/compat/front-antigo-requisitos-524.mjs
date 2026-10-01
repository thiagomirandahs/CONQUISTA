// "Frontend ANTIGO (eb897ef/f59aa51) + banco 524" pelo PostgREST REAL, LOCAL apenas: o fluxo de requisitos que o app antigo usa
// (nomes de argumento antigos, sem relato) continua funcionando e os payloads antigos só GANHAM campos.
// Uso: node supabase/tests/compat/front-antigo-requisitos-524.mjs   (precisa do seed hml: npm run homologacao:seed)
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const URL_API = env.VITE_SUPABASE_URL
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API)) { console.error('ABORTADO: não é o Supabase local'); process.exit(2) }
const ANON = env.VITE_SUPABASE_ANON_KEY
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_CONQUISTA', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t'], { input: q, encoding: 'utf8' }).trim()
const clube = sql(`select id from public.organizational_units where nome = 'Hml Clube A'`)
const tokenDe = async (email) => (await (await fetch(`${URL_API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'senha-homologacao-123' }) })).json()).access_token
const rpc = async (tok, nome, corpo = {}) => { const r = await fetch(`${URL_API}/rest/v1/rpc/${nome}`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'x-clube-atual': clube }, body: JSON.stringify(corpo) }); return { status: r.status, corpo: await r.json().catch(() => null) } }
let ok = 0, bad = 0
const t = (n, c, i = '') => { if (c) { ok++; console.log('   ok    ' + n) } else { bad++; console.log('   FALHOU ' + n + ' ' + i) } }
const reqId = sql(`select r.id from public.class_requirements r join public.class_sections s on s.id = r.section_id join public.classes c on c.id = s.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id where r.manifesto_id = 'amigo.II.1' and v.origem = 'oficial' and v.status = 'publicado'`)
const amigo = sql(`select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where c.manifesto_id = 'amigo' and v.origem = 'oficial' and v.status = 'publicado' and c.tipo_classe = 'regular'`)
const kid = await tokenDe('hml-desbravador@teste.local'), ins = await tokenDe('hml-instrutor@teste.local')
sql(`delete from public.member_requirements where member_class_id in (select mc.id from public.member_classes mc join auth.users u on u.id = mc.usuario_id where u.email = 'hml-desbravador@teste.local' and mc.class_id = '${amigo}'); delete from public.member_classes mc using auth.users u where u.id = mc.usuario_id and u.email = 'hml-desbravador@teste.local' and mc.class_id = '${amigo}'`)
let r = await rpc(kid, 'classe_iniciar', { p_class_id: amigo }); t('front antigo: classe_iniciar (nome antigo p_class_id)', r.status === 200 && r.corpo?.ok === true, JSON.stringify(r).slice(0, 140))
r = await rpc(kid, 'requisito_salvar', { p_requirement_id: reqId, p_texto: 'texto do app antigo', p_evidencia_path: null }); t('front antigo: requisito_salvar com os 3 argumentos antigos', r.status === 200, JSON.stringify(r).slice(0, 140))
r = await rpc(kid, 'requisito_formulario', { p_requirement_id: reqId }); t('front antigo: requisito_formulario mantém as chaves antigas (e só ganha relato)', r.status === 200 && r.corpo && 'rascunho_em' in r.corpo && 'relato' in r.corpo, JSON.stringify(r).slice(0, 140))
r = await rpc(kid, 'requisito_enviar', { p_requirement_id: reqId }); t('front antigo: requisito_enviar (1 argumento) envia SEM relato', r.status === 200, JSON.stringify(r).slice(0, 160))
r = await rpc(ins, 'classe_avaliacoes_pendentes'); const fila = Array.isArray(r.corpo) ? r.corpo : []
const it = fila.find((x) => x.usuario_nome === 'Hml Desbravador')
t('front antigo (instrutor): fila traz as chaves antigas + relato', !!it && ['member_requirement_id', 'submission_id', 'tentativa_numero', 'usuario_nome', 'requisito_descricao', 'tipo_evidencia', 'evidencia_texto'].every((k) => k in it) && 'relato' in it, JSON.stringify(it || fila[0] || r).slice(0, 160))
r = await rpc(ins, 'fila_avaliacao_unificada', {}); t('front antigo: fila unificada responde e as linhas ganham relato', r.status === 200 && Array.isArray(r.corpo) && r.corpo.every((x) => 'relato' in x), JSON.stringify(r).slice(0, 120))
const mrId = it?.member_requirement_id
r = await rpc(ins, 'requisito_avaliar', { p_member_requirement_id: mrId, p_decisao: 'aprovado', p_comentario: null, p_submission_id: it?.submission_id }); t('front antigo: requisito_avaliar (4 argumentos) funciona', r.status === 200, JSON.stringify(r).slice(0, 140))
r = await rpc(kid, 'requisito_historico', { p_member_requirement_id: mrId }); t('front antigo: requisito_historico traz tentativas com as chaves antigas + relato', r.status === 200 && (r.corpo?.tentativas || []).length >= 1 && 'relato' in r.corpo.tentativas[0] && 'tentativa_numero' in r.corpo.tentativas[0], JSON.stringify(r).slice(0, 140))
const mcId = sql(`select mc.id from public.member_classes mc join auth.users u on u.id = mc.usuario_id where u.email = 'hml-desbravador@teste.local' and mc.class_id = '${amigo}'`)
r = await rpc(kid, 'minha_classe', { p_member_class_id: mcId }); t('front antigo: minha_classe responde (requisitos ganham relato)', r.status === 200, JSON.stringify(r).slice(0, 100))
r = await rpc(kid, 'classes_disponiveis'); t('front antigo: classes_disponiveis responde', r.status === 200 && Array.isArray(r.corpo), '')
sql(`delete from public.requirement_approvals where member_requirement_id = '${mrId}'`)
console.log(`\n${ok}/${ok + bad} ok${bad ? ' — ' + bad + ' FALHA(S)' : ' — TUDO OK'}`)
process.exit(bad ? 1 : 0)
