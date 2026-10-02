#!/usr/bin/env node
// EXCLUSÃO CONTROLADA dos órfãos JÁ CLASSIFICADOS COMO SEGUROS (classe A do manifesto), em lotes de no máximo 8, com verificação depois de CADA lote.
// Só toca em objeto que: (1) está no manifesto como A (os indeterminados C são PRESERVADOS e nunca entram), (2) continua órfão agora (categoria do GC),
// (3) NENHUMA coluna do banco o cita (além do razão de cota e das filas), (4) tem o mesmo sha256 do manifesto, (5) tem cópia de recuperação.
// Para na primeira anomalia (código 3). Nunca imprime caminhos, credenciais ou URL do banco. Env: DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF.
//   --fase revalidar          recalcula e grava a lista final (retira quem ganhou referência ou mudou)
//   --fase lote [--n 8]       exclui o próximo lote e verifica
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { obterChaveServico, cabecalhosServico } from './lib/chaveServico.mjs'

const args = process.argv.slice(2)
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const fase = val('--fase'); const N = Math.min(8, Math.max(1, Number(val('--n') || 8)))
const DB = process.env.DB_URL_PRODUCAO, TOKEN = process.env.SUPABASE_ACCESS_TOKEN, REF = process.env.PROJECT_REF
if (!fase || !DB || !TOKEN || !REF) { console.error('uso: --fase revalidar|lote; env: DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF'); process.exit(2) }
// GC_PASTA: outra pasta de manifesto + cópias de recuperação (ex.: uma rodada nova com 1 item autorizado pelo dono)
const PASTA = process.env.GC_PASTA || join(homedir(), '.desbravaclube-backups', 'gc-recuperacao-2026-10-01')
const NL = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9)
const q = (s) => String(s).replaceAll("'", "''")
function psql(sql, { avisos = false } = {}) {
  const r = spawnSync('psql', [DB, '-X', '-q', '-A', '-t', '-F', TAB, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('psql falhou: ' + String(r.stderr || '').split(NL).filter(Boolean).slice(0, 2).join(' | ').replaceAll(DB, '<db>').slice(0, 240))
  const linhas = r.stdout.split(NL).map((l) => l.split(CR).join('')).filter(Boolean).map((l) => l.split(TAB))
  return avisos ? { linhas, notas: String(r.stderr || '').split(NL).map((l) => l.split(CR).join('')).filter((l) => l.includes('R|')).map((l) => l.slice(l.indexOf('R|') + 2)) } : linhas
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
// secret nova (sb_secret_) preferida; a service_role legacy só como fallback com aviso — ver scripts/lib/chaveServico.mjs
let _k
const chave = async () => (_k ??= await obterChaveServico({ ref: REF, token: TOKEN }))
const url = (b, n) => `https://${REF}.supabase.co/storage/v1/object/${encodeURIComponent(b)}/${n.split('/').map(encodeURIComponent).join('/')}`
async function baixar(b, n) { const k = await chave(); const r = await fetch(url(b, n), { headers: cabecalhosServico(k) }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null }
const mb = (n) => (n / 1048576).toFixed(1)

const manifesto = JSON.parse(readFileSync(join(PASTA, 'manifesto-gc.json'), 'utf8')).itens
const A = manifesto.filter((i) => i.classe === 'A'), C = manifesto.filter((i) => i.classe === 'C')
const arqLista = join(PASTA, 'lista-final.json'), arqFeitos = join(PASTA, 'excluidos.json')
const feitos = existsSync(arqFeitos) ? JSON.parse(readFileSync(arqFeitos, 'utf8')) : {}

// ---------- referências em QUALQUER coluna (exceto razão de cota e filas) ----------
function citados(itens) {
  const nomes = itens.map((i) => i.caminho.replace(/^.*\//, ''))
  const arr = nomes.map((n, i) => `(${i}, '${q(n)}')`).join(',')
  const sql = `begin read only;
do $$ declare t record; pats text[]; n int; m record; hit int[] := '{}';
begin
  select array_agg('%' || x || '%' order by i) into pats from (values ${arr}) v(i, x);
  for t in
    select c.table_schema, c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where ((c.table_schema = 'public') or (c.table_schema = 'auth' and c.table_name = 'users'))
       and c.data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
       and not (c.table_name = 'club_storage_objetos' and c.column_name = 'name')
       and not (c.table_name in ('imagem_saneamento', 'storage_exclusao_fila') and c.column_name = 'caminho')
  loop
    begin
      execute format('select count(*) from %I.%I where %I::text like any ($1)', t.table_schema, t.table_name, t.column_name) into n using pats;
      if n > 0 then
        for m in select i, x from (values ${arr}) v(i, x) loop
          execute format('select count(*) from %I.%I where %I::text like ''%%'' || $1 || ''%%''', t.table_schema, t.table_name, t.column_name) into n using m.x;
          if n > 0 then hit := hit || m.i; end if;
        end loop;
      end if;
    exception when others then null;
    end;
  end loop;
  raise notice 'R|%', coalesce((select string_agg(distinct x::text, ',') from unnest(hit) x), '');
end $$;
rollback;`
  const { notas } = psql(sql, { avisos: true })
  const l = (notas.at(-1) || '').split(',').filter(Boolean).map(Number)
  return new Set(l)
}
const categorias = (itens) => {
  const v = itens.map((i) => `('${q(i.bucket)}','${q(i.caminho)}')`).join(',')
  return Object.fromEntries(psql(`select f.bucket||'|'||f.name, f.categoria from public._storage_gc_fatos(null, 30) f join (values ${v}) v(b,n) on v.b = f.bucket and v.n = f.name`).map(([k, c]) => [k, c]))
}
const quebradas = () => Number(psql('select count(*) from public._storage_gc_quebradas()')[0]?.[0] || 0)
const estadoGlobal = () => {
  const [[objs, bytes]] = psql(`select count(*), coalesce(sum((metadata->>'size')::bigint),0) from storage.objects`)
  const nomes = new Set(psql(`select bucket_id||'|'||name from storage.objects`).map(([x]) => x))
  const [[erros]] = psql(`select count(*) from public.app_erros where quando > now() - interval '30 minutes'`)
  const [[fila]] = psql(`select count(*) from public.storage_exclusao_fila where estado in ('falhou')`)
  const [[falhas]] = psql(`select count(*) from public.infra_falhas where quando > now() - interval '30 minutes' and origem like 'storage/%'`)
  return { objs: Number(objs), bytes: Number(bytes), nomes, erros: Number(erros), fila_falhou: Number(fila), infra: Number(falhas) }
}

if (fase === 'revalidar') {
  const cit = citados(A); const cat = categorias(A)
  const lista = []; const retirados = []
  for (let i = 0; i < A.length; i++) {
    const it = A[i]; const motivos = []
    if ((cat[`${it.bucket}|${it.caminho}`] ?? 'ausente') !== 'orfao') motivos.push(`categoria=${cat[`${it.bucket}|${it.caminho}`] ?? 'ausente'}`)
    if (cit.has(i)) motivos.push('citado_em_coluna')
    const b = await baixar(it.bucket, it.caminho)
    if (!b) motivos.push('indisponivel'); else if (sha(b) !== it.sha256) motivos.push('conteudo_mudou')
    if (!existsSync(join(PASTA, it.bucket, ...it.caminho.split('/')))) motivos.push('sem_copia_de_recuperacao')
    if (motivos.length) retirados.push({ id: it.id, grupo: it.grupo, motivos }); else lista.push(it.id)
  }
  const preservados = C.map((i) => i.id)
  writeFileSync(arqLista, JSON.stringify({ gerado_em: new Date().toISOString(), lista, retirados, preservados }, null, 1))
  const sel = A.filter((i) => lista.includes(i.id))
  console.log(`REVALIDAÇÃO imediata: ${A.length} seguros no manifesto | continuam seguros: ${lista.length} (${mb(sel.reduce((a, i) => a + i.bytes, 0))} MB) | retirados por mudança/nova referência: ${retirados.length} | indeterminados em lista de PRESERVAÇÃO: ${preservados.length}`)
  retirados.forEach((r) => console.log('  retirado:', r.grupo, r.motivos.join(',')))
  const por = {}; for (const i of sel) { const k = `${i.bucket} · ${i.grupo} · ${i.motivo}`; por[k] ??= { n: 0, b: 0 }; por[k].n++; por[k].b += i.bytes }
  for (const [k, v] of Object.entries(por)) console.log(`  ${k.padEnd(62)} ${String(v.n).padStart(3)} arq ${mb(v.b).padStart(6)} MB`)
  console.log(`  preservados (C): ${C.length} arq ${mb(C.reduce((a, i) => a + i.bytes, 0))} MB — grupos: ${[...new Set(C.map((i) => i.grupo))].join(', ')}`)
  process.exit(0)
}

if (fase === 'lote') {
  if (!existsSync(arqLista)) { console.error('rode --fase revalidar antes'); process.exit(2) }
  const { lista } = JSON.parse(readFileSync(arqLista, 'utf8'))
  const pend = A.filter((i) => lista.includes(i.id) && !feitos[i.id])
  if (!pend.length) { console.log('nada pendente: todos os itens da lista final já foram tratados'); process.exit(0) }
  const lote = pend.slice(0, N)
  const preserve = new Set(C.map((i) => `${i.bucket}|${i.caminho}`))
  if (lote.some((i) => preserve.has(`${i.bucket}|${i.caminho}`) || i.classe !== 'A')) { console.error('ABORTADO: item preservado/indeterminado no lote'); process.exit(3) }
  // re-checagem IMEDIATA, item a item
  const cit = citados(lote); const cat = categorias(lote); const prob = []
  for (let i = 0; i < lote.length; i++) {
    const it = lote[i]
    if ((cat[`${it.bucket}|${it.caminho}`] ?? 'ausente') !== 'orfao') prob.push(`${it.grupo}: categoria agora ${cat[`${it.bucket}|${it.caminho}`] ?? 'ausente'}`)
    if (cit.has(i)) prob.push(`${it.grupo}: ganhou referência`)
    const b = await baixar(it.bucket, it.caminho); if (!b || sha(b) !== it.sha256) prob.push(`${it.grupo}: conteúdo mudou/indisponível`)
  }
  if (prob.length) { console.log('*** NÃO EXCLUI — PARE ***'); prob.forEach((p) => console.log('  -', p)); process.exit(3) }
  const antes = estadoGlobal(); const qAntes = quebradas()
  const k = await chave(); const falhasApi = []
  for (const it of lote) {
    const r = await fetch(url(it.bucket, it.caminho), { method: 'DELETE', headers: cabecalhosServico(k) })
    if (!r.ok) falhasApi.push(`${it.grupo}: HTTP ${r.status}`)
  }
  await new Promise((r) => setTimeout(r, 3000))
  const depois = estadoGlobal(); const qDepois = quebradas()
  const removidosEsperados = new Set(lote.map((i) => `${i.bucket}|${i.caminho}`))
  const sumiram = [...antes.nomes].filter((n) => !depois.nomes.has(n)); const novos = [...depois.nomes].filter((n) => !antes.nomes.has(n))
  const fora = sumiram.filter((n) => !removidosEsperados.has(n)); const faltou = [...removidosEsperados].filter((n) => depois.nomes.has(n))
  const bytesLote = lote.reduce((a, i) => a + i.bytes, 0)
  const viol = []
  if (falhasApi.length) viol.push('falhas da API: ' + falhasApi.join('; '))
  if (fora.length) viol.push(`${fora.length} objeto(s) FORA do lote sumiram`)
  if (faltou.length) viol.push(`${faltou.length} objeto(s) do lote ainda existem`)
  if (sumiram.length - fora.length !== lote.length - faltou.length) viol.push('contagem de removidos diferente da esperada')
  if (qDepois > qAntes) viol.push(`referências quebradas aumentaram (${qAntes} -> ${qDepois})`)
  if (depois.erros > antes.erros + 0) viol.push(`app_erros novos na janela (${antes.erros} -> ${depois.erros})`)
  if (depois.fila_falhou > 0 || depois.infra > antes.infra) viol.push('fila/infra_falhas com falha')
  for (const it of lote) { const kk = `${it.bucket}|${it.caminho}`; if (removidosEsperados.has(kk) && !depois.nomes.has(kk)) feitos[it.id] = { em: new Date().toISOString() } }
  writeFileSync(arqFeitos, JSON.stringify(feitos))
  console.log(`lote: ${lote.length} itens (${mb(bytesLote)} MB) | removidos: ${lote.length - faltou.length} | objetos ${antes.objs} -> ${depois.objs} (${mb(antes.bytes - depois.bytes)} MB a menos) | objetos novos de usuários no intervalo: ${novos.length} | referências quebradas: ${qAntes} -> ${qDepois} | total já excluídos: ${Object.keys(feitos).length}`)
  if (viol.length) { console.log('\n*** VIOLAÇÕES — PARE ***'); viol.forEach((v) => console.log('  -', v)); process.exit(3) }
  console.log('OK: exatamente o esperado foi removido; nada fora do manifesto; 0 referências quebradas novas')
}
