// Classes (migration 518) pelo PostgREST REAL, LOCAL apenas: o front ANTIGO continua funcionando com o banco 518 (campos antigos
// intactos, novos só acrescentados) e o front NOVO recebe os campos novos. Uso: node supabase/tests/compat/front-classes-518.mjs
// (precisa do seed hml: npm run homologacao:seed)
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
const ANTIGOS = ['class_id', 'codigo', 'nome', 'faixa_etaria', 'idade_minima', 'manifesto_id', 'vigente_desde', 'avancada', 'classe_regular_codigo', 'elegivel', 'motivo_inelegivel', 'curriculum_version']
const meu = sql(`select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'hml-desbravador@teste.local'`)
sql(`update public.profiles set nascimento = (current_date - interval '13 years 2 months')::date where id = '${meu}'`)
try {
  const tok = await tokenDe('hml-desbravador@teste.local')
  let r = await rpc(tok, 'classes_disponiveis')
  const lista = Array.isArray(r.corpo) ? r.corpo : []
  t('front antigo: classes_disponiveis responde 200 com lista', r.status === 200 && lista.length > 0, JSON.stringify(r).slice(0, 120))
  t('front antigo: TODOS os campos antigos continuam em todas as linhas', lista.every((c) => ANTIGOS.every((k) => k in c)))
  t('front novo: campos novos bloqueio/anterior presentes', lista.every((c) => 'bloqueio' in c && 'anterior' in c))
  t('regra: elegivel == (bloqueio é nulo) em todas as linhas', lista.every((c) => c.elegivel === (c.bloqueio === null)))
  const por = Object.fromEntries(lista.map((c) => [c.nome, c]))
  t('13 anos: Pioneiro disponível (não anterior)', por.Pioneiro?.elegivel === true && por.Pioneiro?.anterior === false)
  t('13 anos: Companheiro/Pesquisador são ANTERIORES e elegíveis', ['Companheiro', 'Pesquisador'].every((n) => por[n]?.elegivel && por[n]?.anterior))
  t('13 anos: Excursionista e Guia bloqueados por IDADE', ['Excursionista', 'Guia'].every((n) => por[n]?.bloqueio === 'idade'))
  t('13 anos: avançada sem a regular bloqueada por PRÉ-REQUISITO (Companheiro de Excursionismo)', por['Companheiro de Excursionismo']?.bloqueio === 'pre_requisito' && /primeiro/i.test(por['Companheiro de Excursionismo']?.motivo_inelegivel || ''))
  // servidor é a autoridade: iniciar a bloqueada pelo RPC (como um front adulterado faria) é recusado
  r = await rpc(tok, 'classe_iniciar', { p_class_id: por.Guia.class_id })
  t('burlar: classe_iniciar de classe por idade é RECUSADA', r.status >= 400 && /a partir de 15/.test(JSON.stringify(r.corpo)), JSON.stringify(r).slice(0, 160))
  r = await rpc(tok, 'classe_iniciar', { p_class_id: por['Companheiro de Excursionismo'].class_id })
  t('burlar: avançada sem a regular é RECUSADA pelo servidor', r.status >= 400, JSON.stringify(r).slice(0, 160))
  r = await rpc(tok, 'classe_iniciar', { p_class_id: por.Companheiro.class_id, p_idade: 11 })
  t('burlar: parâmetro extra (p_idade) não existe', r.status >= 400, JSON.stringify(r).slice(0, 120))
} finally {
  sql(`update public.profiles set nascimento = null where id = '${meu}'`)
}
console.log(`\n${ok}/${ok + bad} ok${bad ? ' — ' + bad + ' FALHA(S)' : ' — TUDO OK'}`)
process.exit(bad ? 1 : 0)
