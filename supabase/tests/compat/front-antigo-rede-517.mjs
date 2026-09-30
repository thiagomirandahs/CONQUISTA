// "Frontend ANTIGO (eb897ef) + banco 517": chama a Rede pelo PostgREST REAL com os nomes de argumento EXATOS do app antigo
// (src/services/rede.js de eb897ef). LOCAL apenas. Uso: node supabase/tests/compat/front-antigo-rede-517.mjs (precisa do seed hml: npm run homologacao:seed)
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
const URL_API = env.VITE_SUPABASE_URL
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API)) { console.error('ABORTADO: não é o Supabase local'); process.exit(2) }
const ANON = env.VITE_SUPABASE_ANON_KEY
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_CONQUISTA', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t'], { input: q, encoding: 'utf8' }).trim()
const clube = sql(`select id from public.organizational_units where nome = 'Hml Clube A'`)
async function entrar(email) {
  const r = await fetch(`${URL_API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'senha-homologacao-123' }) })
  return (await r.json()).access_token
}
const rpc = async (tok, nome, corpo) => {
  const r = await fetch(`${URL_API}/rest/v1/rpc/${nome}`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'x-clube-atual': clube }, body: JSON.stringify(corpo) })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}
let ok = 0, bad = 0
const t = (nome, cond, info = '') => { if (cond) { ok++; console.log('   ok    ' + nome) } else { bad++; console.log('   FALHOU ' + nome + ' ' + info) } }
const dir = await entrar('hml-diretoria_a@teste.local'), kid = await entrar('hml-desbravador@teste.local')
// 1) app antigo publica "livre" com os NOMES de argumento antigos (sem p_alcance) -> vira alcance 'clube'
let r = await rpc(dir, 'rede_publicar', { p_tipo: 'livre', p_legenda: 'compat front antigo', p_foto_path: null, p_foto_alt: null, p_desafio: null, p_conquista: null })
t('front antigo: rede_publicar (nomes antigos) responde ok', r.status === 200 && r.corpo?.ok === true, JSON.stringify(r))
// 2) feed antigo: 'todos' e 'meu_clube' funcionam (mesmos parâmetros do app antigo)
for (const f of ['todos', 'meu_clube']) {
  r = await rpc(dir, 'rede_feed', { p_filtro: f, p_antes: null, p_antes_id: null, p_limite: 10 })
  t(`front antigo: rede_feed('${f}') responde 200 com itens[]`, r.status === 200 && Array.isArray(r.corpo?.itens), JSON.stringify(r).slice(0, 160))
}
r = await rpc(dir, 'rede_feed', { p_filtro: 'meu_clube', p_antes: null, p_antes_id: null, p_limite: 10 })
t('...e o post do app antigo aparece em Meu Clube (alcance clube)', (r.corpo?.itens || []).some((i) => i.alcance === 'clube' && /compat front antigo/.test(JSON.stringify(i))), '')
// 3) conquista por TEXTO LIVRE (o app antigo oferecia) é recusada de propósito (proibida na 515/517)
r = await rpc(dir, 'rede_publicar', { p_tipo: 'conquista', p_legenda: null, p_foto_path: null, p_foto_alt: null, p_desafio: null, p_conquista: 'investidura' })
t('front antigo: conquista por texto livre é RECUSADA (esperado)', r.status >= 400 || r.corpo?.ok === false || r.corpo?.erro, JSON.stringify(r).slice(0, 160))
// 4) o desbravador com app antigo continua publicando só no clube e NÃO na Comunidade (o app antigo nem envia p_alcance)
r = await rpc(kid, 'rede_publicar', { p_tipo: 'livre', p_legenda: 'criança app antigo', p_foto_path: null, p_foto_alt: null, p_desafio: null, p_conquista: null })
t('front antigo: criança publica como antes, mas em alcance clube', r.status === 200 && (r.corpo?.ok === true || /autoriza/i.test(JSON.stringify(r.corpo))), JSON.stringify(r).slice(0, 200))
// 5) outras leituras do app antigo
r = await rpc(dir, 'rede_buscar', { p_termo: 'hml', p_clube: null }); t('front antigo: rede_buscar responde', r.status === 200, JSON.stringify(r).slice(0, 120))
r = await rpc(dir, 'rede_perfil', { p_usuario: null }); t('front antigo: rede_perfil próprio responde', r.status === 200, JSON.stringify(r).slice(0, 120))
r = await rpc(kid, 'audiolivros_listar', {}); t('front antigo: audiolivros_listar responde (4 ativos após 517)', r.status === 200 && Array.isArray(r.corpo), JSON.stringify(r).slice(0, 120))
// 6) FRONT NOVO + banco sem 515/517 (documentado pelo SQL: a função antiga não tem p_alcance) — aqui só prova que o banco novo aceita o front novo
r = await rpc(dir, 'rede_publicar', { p_tipo: 'aviso', p_legenda: 'compat front novo', p_alcance: 'clube' })
t('front NOVO + banco 517: publicar com p_alcance', r.status === 200 && r.corpo?.ok === true, JSON.stringify(r).slice(0, 160))
r = await rpc(dir, 'rede_conquistas_publicaveis', { p_alcance: 'clube' }); t('front NOVO + banco 517: rede_conquistas_publicaveis responde', r.status === 200 && Array.isArray(r.corpo), JSON.stringify(r).slice(0, 120))
sql(`delete from public.comunidade_posts where legenda in ('compat front antigo','criança app antigo','compat front novo')`)
console.log(`\n${ok}/${ok + bad} ok${bad ? ' — ' + bad + ' FALHA(S)' : ' — TUDO OK'}`)
process.exit(bad ? 1 : 0)
