#!/usr/bin/env node
// BACKFILL CONTROLADO do saneamento de imagens em PRODUÇÃO (Fase 9). Usa o pipeline já validado (fila `imagem_saneamento` + Edge Function
// `sanear-imagens`); este script só PREPARA, ENFILEIRA e VERIFICA — quem regrava o arquivo é a função. Para tudo na primeira anomalia.
//
//   --fase inventario [--rotulo x]        baixa as imagens de produção, classifica (A GPS · B metadados · C limpo · D inválida · E não suportada)
//   --fase preparar --grupo gps|outros    para os candidatos do grupo: copia de recuperação (+sha256), foto do estado (owner_id, mimetype, visibilidade, policies)
//   --fase enfileirar --grupo gps|outros  coloca SÓ esses objetos na fila (não varre o Storage)
//   --fase lote [--grupo g]               chama a função UMA vez (lote de 8) e VERIFICA tudo que ficou pronto; sai com código 3 se algo violar o esperado
//   --fase verificar                      só verifica o que já foi processado (cron ou lote)
//
// NUNCA imprime coordenadas, caminhos completos, URL do banco, senha, token nem chave. Variáveis (NOMES): DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF.
// Saída local (fora do Git): ~/.desbravaclube-backups/backfill-AAAA-MM-DD/
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { classificar, SUPORTADOS } from './lib/analisarImagem.mjs'
import { obterChaveServico, cabecalhosServico } from './lib/chaveServico.mjs'

const args = process.argv.slice(2)
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const fase = val('--fase'), grupo = val('--grupo'), rotulo = val('--rotulo') || 'inventario'
const DB = process.env.DB_URL_PRODUCAO, TOKEN = process.env.SUPABASE_ACCESS_TOKEN, REF = process.env.PROJECT_REF
if (!fase || !DB || !TOKEN || !REF) { console.error('Uso: --fase inventario|preparar|enfileirar|lote|verificar [--grupo gps|outros]; env: DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF'); process.exit(2) }
if (['preparar', 'enfileirar'].includes(fase) && !['gps', 'outros'].includes(grupo)) { console.error('--grupo gps|outros é obrigatório'); process.exit(2) }

const PASTA = join(homedir(), '.desbravaclube-backups', 'backfill-2026-10-01'); mkdirSync(PASTA, { recursive: true })
const BUCKETS_SANEADOS = ['imagens', 'comprovacoes', 'comunidade', 'suporte-anexos']
const BASE = `https://${REF}.supabase.co`

function psqlSeguro(sql, { stderr = false } = {}) {
  const r = spawnSync('psql', [DB, '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('psql falhou: ' + String(r.stderr || '').split(String.fromCharCode(10)).filter(Boolean).slice(0, 2).join(' | ').replaceAll(DB, '<db>').slice(0, 240))
  return stderr ? { out: r.stdout.trim(), err: r.stderr } : r.stdout.trim()
}
const lin = (s) => (s ? s.split(String.fromCharCode(10)).map((l) => l.split(String.fromCharCode(13)).join('')).filter(Boolean).map((l) => l.split(String.fromCharCode(9))) : [])
const q = (s) => String(s).replaceAll("'", "''")

// secret nova (sb_secret_) preferida; a service_role legacy só como fallback com aviso — ver scripts/lib/chaveServico.mjs
let _chave
async function chaveServico() {
  return (_chave ??= await obterChaveServico({ ref: REF, token: TOKEN }))
}
async function baixar(bucket, nome) {
  const k = await chaveServico()
  const r = await fetch(`${BASE}/storage/v1/object/${encodeURIComponent(bucket)}/${nome.split('/').map(encodeURIComponent).join('/')}`, { headers: cabecalhosServico(k) })
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'
const ehVideo = (mime, nome) => /^video\//i.test(mime) || /\.(mp4|mov|webm|m4v)$/i.test(nome)

function listar() {
  return lin(psqlSeguro(`select bucket_id, name, coalesce((metadata->>'size')::bigint,0), coalesce(metadata->>'mimetype',''), coalesce(owner_id,''), coalesce(owner::text,''), coalesce(updated_at,created_at)::text from storage.objects order by 1,2`))
    .map(([bucket, nome, bytes, mime, owner_id, owner, versao]) => ({ bucket, nome, bytes: Number(bytes), mime, owner_id, owner, versao }))
}

// ---------- inventário ----------
async function inventario(tag) {
  const objs = listar(); const itens = []
  for (const o of objs) {
    if (ehVideo(o.mime, o.nome)) { itens.push({ ...o, formato: 'video', situacao: 'nao_suportado' }); continue }
    const b = await baixar(o.bucket, o.nome)
    if (!b) { itens.push({ ...o, formato: 'ausente', situacao: 'invalido' }); continue }
    const c = classificar(b)
    itens.push({ ...o, formato: c.formato, situacao: c.situacao, sha256: sha(b), bytes_reais: b.length })
  }
  const arq = join(PASTA, `inventario-${tag}.json`)
  writeFileSync(arq, JSON.stringify({ gerado_em: new Date().toISOString(), itens }, null, 1))
  const agg = (f) => { const o = {}; for (const i of itens) { const k = f(i); o[k] ??= { n: 0, b: 0 }; o[k].n++; o[k].b += i.bytes } return o }
  const imp = (t, o) => { console.log('\n' + t); for (const [k, v] of Object.entries(o).sort((a, b) => b[1].b - a[1].b)) console.log(`  ${k.padEnd(40)} ${String(v.n).padStart(4)} arq ${mb(v.b).padStart(10)}`) }
  console.log(`=== INVENTÁRIO DE PRODUÇÃO (${tag}) — ${itens.length} objetos, ${mb(itens.reduce((a, i) => a + i.bytes, 0))} ===`)
  imp('Por bucket', agg((i) => i.bucket)); imp('Por formato real', agg((i) => i.formato))
  imp('Por situação (A=com_gps · B=com_metadados · C=limpo · D=invalido · E=nao_suportado)', agg((i) => i.situacao))
  const saneaveis = itens.filter((i) => BUCKETS_SANEADOS.includes(i.bucket) && SUPORTADOS.includes(i.formato))
  imp('Imagens SUPORTADAS nos 4 buckets saneados, por situação', (() => { const o = {}; for (const i of saneaveis) { o[i.situacao] ??= { n: 0, b: 0 }; o[i.situacao].n++; o[i.situacao].b += i.bytes } return o })())
  imp('Não suportadas (HEIC/GIF/vídeo/outro) por formato e bucket', (() => { const o = {}; for (const i of itens.filter((x) => x.situacao === 'nao_suportado')) { const k = `${i.formato} · ${i.bucket}`; o[k] ??= { n: 0, b: 0 }; o[k].n++; o[k].b += i.bytes } return o })())
  const cand = saneaveis.filter((i) => ['com_gps', 'com_metadados'].includes(i.situacao))
  console.log(`\nCANDIDATOS AO BACKFILL (suportados, com metadados): ${cand.length} arquivos, ${mb(cand.reduce((a, i) => a + i.bytes, 0))} | com GPS: ${cand.filter((i) => i.situacao === 'com_gps').length}`)
  console.log('manifesto local:', arq.replace(homedir(), '~'))
  return itens
}

// ---------- estado global de segurança do Storage ----------
const estadoStorage = () => {
  const [[pol, rls]] = lin(psqlSeguro(`select md5(string_agg(policyname||cmd||coalesce(qual,'')||coalesce(with_check,''),'|' order by policyname)), (select relrowsecurity::text from pg_class where oid='storage.objects'::regclass) from pg_policies where schemaname='storage' and tablename='objects'`))
  return { policies: pol, rls }
}

// ---------- visibilidade (dono × outro × anon), avaliada no banco com as policies reais ----------
function visibilidade(itens) {
  const out = {}
  for (let i = 0; i < itens.length; i += 25) {
    const parte = itens.slice(i, i + 25)
    const valores = parte.map((o, k) => `(${i + k}, '${q(o.bucket)}', '${q(o.nome)}')`).join(',')
    const sql = `begin;
do $$ declare r record; d uuid; a int; o int; n int; outro uuid := gen_random_uuid();
begin
  for r in select * from (values ${valores}) v(i, b, nm) loop
    select coalesce(public.dono_do_objeto(x.owner, x.owner_id), gen_random_uuid()) into d from storage.objects x where x.bucket_id = r.b and x.name = r.nm;
    d := coalesce(d, gen_random_uuid());
    execute 'reset role'; execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
    select count(*) into a from storage.objects where bucket_id = r.b and name = r.nm;
    perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
    select count(*) into o from storage.objects where bucket_id = r.b and name = r.nm;
    execute 'reset role'; execute 'set local role anon';
    select count(*) into n from storage.objects where bucket_id = r.b and name = r.nm;
    execute 'reset role';
    raise notice 'V|%|%|%|%', r.i, a, o, n;
  end loop;
end $$;
rollback;`
    const { err } = psqlSeguro(sql, { stderr: true })
    for (const l of err.split(String.fromCharCode(10))) { const m = l.match(/V\|(\d+)\|(\d+)\|(\d+)\|(\d+)/); if (m) out[Number(m[1])] = `${m[2]}${m[3]}${m[4]}` }
  }
  return out
}
const categoriaGc = (itens) => {
  const mapa = {}
  for (let i = 0; i < itens.length; i += 100) {
    const parte = itens.slice(i, i + 100)
    const v = parte.map((o) => `('${q(o.bucket)}','${q(o.nome)}')`).join(',')
    for (const [b, n, c] of lin(psqlSeguro(`select f.bucket, f.name, f.categoria from public._storage_gc_fatos(null, 30) f join (values ${v}) v(b,n) on v.b = f.bucket and v.n = f.name`))) mapa[`${b}|${n}`] = c
  }
  return mapa
}

const ultimoInventario = () => {
  const f = readdirSync(PASTA).filter((x) => x.startsWith('inventario-')).sort().at(-1)
  if (!f) throw new Error('rode --fase inventario antes')
  return JSON.parse(readFileSync(join(PASTA, f), 'utf8')).itens
}

// ---------- preparar ----------
async function preparar() {
  const inv = ultimoInventario()
  const alvo = inv.filter((i) => BUCKETS_SANEADOS.includes(i.bucket) && SUPORTADOS.includes(i.formato) && i.situacao === (grupo === 'gps' ? 'com_gps' : 'com_metadados'))
  const rec = join(PASTA, 'recuperacao'); const itens = []
  for (const o of alvo) {
    const b = await baixar(o.bucket, o.nome)
    if (!b || sha(b) !== o.sha256) { console.log('  pulado (mudou desde o inventário ou ausente):', o.bucket, o.formato); continue }
    const dst = join(rec, o.bucket, ...o.nome.split('/')); mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, b)
    itens.push({ bucket: o.bucket, nome: o.nome, bytes: b.length, sha256: sha(b), formato: o.formato, situacao: o.situacao, owner_id: o.owner_id, owner: o.owner, mime: o.mime })
  }
  const vis = visibilidade(itens); const gc = categoriaGc(itens)
  itens.forEach((o, i) => { o.visibilidade = vis[i]; o.gc = gc[`${o.bucket}|${o.nome}`] ?? 'desconhecido' })
  const snap = { gerado_em: new Date().toISOString(), grupo, storage: estadoStorage(), itens }
  writeFileSync(join(PASTA, `snapshot-${grupo}.json`), JSON.stringify(snap, null, 1))
  writeFileSync(join(PASTA, `recuperacao-manifesto-${grupo}.tsv`), 'bucket\tcaminho\tbytes\tsha256\n' + itens.map((o) => `${o.bucket}\t${o.nome}\t${o.bytes}\t${o.sha256}`).join('\n') + '\n')
  console.log(`preparado grupo=${grupo}: ${itens.length} arquivos (${mb(itens.reduce((a, o) => a + o.bytes, 0))}); cópia de recuperação em ~/.desbravaclube-backups/backfill-2026-10-01/recuperacao (sha256 no manifesto)`)
  console.log('estado do Storage registrado: policies/RLS; visibilidade (dono×outro×anon):', JSON.stringify(Object.entries(itens.reduce((a, o) => ((a[o.visibilidade] = (a[o.visibilidade] || 0) + 1), a), {}))), '| categoria GC:', JSON.stringify(itens.reduce((a, o) => ((a[o.gc] = (a[o.gc] || 0) + 1), a), {})))
}

// ---------- enfileirar ----------
function enfileirar() {
  const snap = JSON.parse(readFileSync(join(PASTA, `snapshot-${grupo}.json`), 'utf8'))
  const v = snap.itens.map((o) => `('${q(o.bucket)}','${q(o.nome)}')`).join(',')
  const n = psqlSeguro(`with i as (insert into public.imagem_saneamento (club_id, bucket, caminho, dono_id, objeto_versao)
    select public._imagem_saneamento_clube(o.name), o.bucket_id, o.name, public.dono_do_objeto(o.owner, o.owner_id), coalesce(o.updated_at, o.created_at)
      from storage.objects o join (values ${v}) v(b, n) on o.bucket_id = v.b and o.name = v.n
    on conflict (bucket, caminho) do update set estado = 'pendente', motivo = null, tentativas = 0, proxima_em = now(), reservado_ate = null,
      objeto_versao = excluded.objeto_versao, dono_id = coalesce(excluded.dono_id, public.imagem_saneamento.dono_id), updated_at = now()
      where public.imagem_saneamento.objeto_versao is distinct from excluded.objeto_versao
    returning 1) select count(*) from i`)
  console.log(`enfileirados (grupo ${grupo}): ${n} de ${snap.itens.length}`)
}

// ---------- lote + verificação ----------
async function chamarFuncao() {
  const [[seg]] = lin(psqlSeguro(`select decrypted_secret from vault.decrypted_secrets where name = 'saneamento_secret'`))
  const r = await fetch(`${BASE}/functions/v1/sanear-imagens`, { method: 'POST', headers: { 'x-saneamento-secret': seg, 'content-type': 'application/json' }, body: '{}' })
  const txt = await r.text(); return { status: r.status, corpo: txt.slice(0, 200) }
}

async function verificar() {
  const arquivos = ['gps', 'outros'].filter((g) => existsSync(join(PASTA, `snapshot-${g}.json`)))
  const excecoes = existsSync(join(PASTA, 'excecoes.json')) ? JSON.parse(readFileSync(join(PASTA, 'excecoes.json'), 'utf8')) : {}
  const estado = existsSync(join(PASTA, 'verificados.json')) ? JSON.parse(readFileSync(join(PASTA, 'verificados.json'), 'utf8')) : {}
  const globalAgora = estadoStorage(); const violacoes = []; const cont = { saneada: 0, ja_limpa: 0, ignorado: 0, invalida: 0, falhou: 0, pendente: 0, retries: 0, verificados_agora: 0 }
  for (const g of arquivos) {
    const snap = JSON.parse(readFileSync(join(PASTA, `snapshot-${g}.json`), 'utf8'))
    if (snap.storage.policies !== globalAgora.policies || snap.storage.rls !== globalAgora.rls) violacoes.push(`policies/RLS de storage.objects MUDARAM (${g})`)
    const v = snap.itens.map((o) => `('${q(o.bucket)}','${q(o.nome)}')`).join(',')
    const fila = Object.fromEntries(lin(psqlSeguro(`select s.bucket||'|'||s.caminho, s.estado, coalesce(s.motivo,''), s.tentativas, coalesce(s.saneada_em::text,'') from public.imagem_saneamento s join (values ${v}) v(b,n) on v.b = s.bucket and v.n = s.caminho`)).map(([k, e, m, t, s]) => [k, { estado: e, motivo: m, tentativas: Number(t), saneada: s }]))
    const pendentesVerificar = []
    snap.itens.forEach((o, idx) => {
      const f = fila[`${o.bucket}|${o.nome}`]
      if (!f) { cont.pendente++; return }
      if (f.tentativas > 0) cont.retries += f.tentativas
      if (f.estado === 'pendente') { cont.pendente++; return }
      if (f.estado === 'falhou' || f.estado === 'invalida') { cont.falhou++; violacoes.push(`item ${g}#${idx} (${o.formato}) ficou ${f.estado}/${f.motivo}`); return }
      if (f.estado === 'ignorado') { cont.ignorado++; violacoes.push(`item ${g}#${idx} (${o.formato}) foi IGNORADO pelo servidor (esperado processar)`); return }
      if (f.estado === 'ok') { cont[f.motivo === 'ja_limpa' ? 'ja_limpa' : 'saneada']++; if (!estado[`${o.bucket}|${o.nome}`]) pendentesVerificar.push({ o, idx, f }) }
    })
    if (pendentesVerificar.length) {
      const vis = visibilidade(pendentesVerificar.map((x) => x.o)); const gcm = categoriaGc(pendentesVerificar.map((x) => x.o))
      const atual = Object.fromEntries(lin(psqlSeguro(`select o.bucket_id||'|'||o.name, coalesce(o.owner_id,''), coalesce(o.owner::text,''), coalesce(o.metadata->>'mimetype','') from storage.objects o join (values ${pendentesVerificar.map((x) => `('${q(x.o.bucket)}','${q(x.o.nome)}')`).join(',')}) v(b,n) on o.bucket_id = v.b and o.name = v.n`)).map(([k, a, b, c]) => [k, { owner_id: a, owner: b, mime: c }]))
      for (let k = 0; k < pendentesVerificar.length; k++) {
        const { o, idx, f } = pendentesVerificar[k]; const rot = `${g}#${idx}`
        const a = atual[`${o.bucket}|${o.nome}`]
        if (!a) { violacoes.push(`${rot}: objeto SUMIU do Storage`); continue }
        if (a.owner_id !== o.owner_id || a.owner !== o.owner) violacoes.push(`${rot}: owner_id/owner MUDOU`)
        if (a.mime !== o.mime && !excecoes[`${o.bucket}|${o.nome}`]) violacoes.push(`${rot}: mimetype mudou (${o.mime} -> ${a.mime})`)
        const b = await baixar(o.bucket, o.nome)
        if (!b) { violacoes.push(`${rot}: não consegui baixar`); continue }
        const c = classificar(b)
        if (c.formato !== o.formato) violacoes.push(`${rot}: formato mudou (${o.formato} -> ${c.formato})`)
        if (c.situacao !== 'limpo') violacoes.push(`${rot}: continua ${c.situacao} depois do saneamento`)
        if (f.motivo === 'ja_limpa' ? sha(b) !== o.sha256 : sha(b) === o.sha256) violacoes.push(`${rot}: sha256 incoerente com o resultado '${f.motivo}'`)
        if (b.length > o.bytes + 16) violacoes.push(`${rot}: arquivo CRESCEU (${o.bytes} -> ${b.length})`)
        if (vis[k] !== o.visibilidade) violacoes.push(`${rot}: visibilidade (dono/outro/anon) mudou ${o.visibilidade} -> ${vis[k]}`)
        if ((gcm[`${o.bucket}|${o.nome}`] ?? 'desconhecido') !== o.gc) violacoes.push(`${rot}: categoria GC mudou ${o.gc} -> ${gcm[`${o.bucket}|${o.nome}`]}`)
        if (!violacoes.some((x) => x.startsWith(rot))) { estado[`${o.bucket}|${o.nome}`] = { em: new Date().toISOString(), motivo: f.motivo }; cont.verificados_agora++ }
      }
    }
  }
  writeFileSync(join(PASTA, 'verificados.json'), JSON.stringify(estado))
  console.log('verificação:', JSON.stringify(cont), '| total verificados até agora:', Object.keys(estado).length)
  if (violacoes.length) { console.log('\n*** VIOLAÇÕES — PARE ***'); violacoes.forEach((x) => console.log('  -', x)); process.exit(3) }
  console.log('OK: sem violações (owner_id, mimetype, formato, limpeza, visibilidade, policies/RLS, categoria GC)')
}

try {
  if (fase === 'inventario') await inventario(rotulo)
  else if (fase === 'preparar') await preparar()
  else if (fase === 'enfileirar') enfileirar()
  else if (fase === 'lote') { const r = await chamarFuncao(); console.log('função sanear-imagens: HTTP', r.status, r.corpo); if (r.status !== 200) process.exit(3)
    // a CDN do Storage mantém a versão ANTIGA por até ~1 min depois de regravar: só verifica os bytes depois disso
    console.log('aguardando 90 s para a CDN do Storage refletir a regravação…'); await new Promise((res) => setTimeout(res, 90000)); await verificar() }
  else if (fase === 'verificar') await verificar()
  else { console.error('fase desconhecida'); process.exit(2) }
} catch (e) { console.error('ERRO:', String(e.message || e).replaceAll(DB, '<db>').slice(0, 300)); process.exit(1) }
