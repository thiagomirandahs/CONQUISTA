#!/usr/bin/env node
// MANIFESTO DO GC (somente leitura + cópia de recuperação): classifica os candidatos órfãos (>30 dias) em A (seguro: tem causa conhecida e nenhuma referência)
// ou C (indeterminado: sem explicação positiva) e grava, ANTES de qualquer exclusão, um manifesto com: id (md5 bucket|caminho), bucket, hash do caminho (sha256),
// tamanho, sha256 do CONTEÚDO, data, grupo e motivo; mais uma cópia do arquivo em ~/.desbravaclube-backups/gc-recuperacao-AAAA-MM-DD/.
// NUNCA imprime caminhos/URLs/credenciais. Env (nomes): DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const DB = process.env.DB_URL_PRODUCAO, TOKEN = process.env.SUPABASE_ACCESS_TOKEN, REF = process.env.PROJECT_REF
if (!DB || !TOKEN || !REF) { console.error('faltam DB_URL_PRODUCAO, SUPABASE_ACCESS_TOKEN, PROJECT_REF'); process.exit(2) }
const PASTA = join(homedir(), '.desbravaclube-backups', 'gc-recuperacao-2026-10-01'); mkdirSync(PASTA, { recursive: true })
const NL = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9)
const psql = (sql) => {
  const r = spawnSync('psql', [DB, '-X', '-q', '-A', '-t', '-F', TAB, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('psql falhou: ' + String(r.stderr || '').split(NL)[0].replaceAll(DB, '<db>').slice(0, 200))
  return r.stdout.split(NL).map((l) => l.split(CR).join('')).filter(Boolean).map((l) => l.split(TAB))
}
const sha = (b) => createHash('sha256').update(b).digest('hex')

const SQL = `
with c as (select bucket, name, bytes, criado_em, idade_dias from public._storage_gc_fatos(null, 30) where categoria = 'orfao'),
x as (select c.*,
  case when bucket = 'imagens' and name like 'perfis/%' then substring(split_part(name,'/',2),1,36)
       when bucket = 'imagens' and name like 'mural/%' then substring(split_part(name,'/',2),1,36)
       when bucket = 'imagens' and name like 'atividades/%' then substring(split_part(name,'/',2),38,36)
       when bucket = 'comprovacoes' then substring(name,1,36) end as usr,
  case when bucket = 'imagens' and name like 'atividades/%' then substring(split_part(name,'/',2),1,36) end as atv,
  regexp_replace(name, '^.*/', '') as base
  from c)
select bucket, name, bytes, criado_em::text, round(idade_dias)::int,
  case
   when bucket = 'imagens' and name like 'perfis/%' then
     case when not exists (select 1 from public.profiles p where p.id::text = x.usr) then 'A|perfil|usuario_inexistente'
          when exists (select 1 from public.profiles p where p.id::text = x.usr and p.foto is not null and p.foto <> '' and p.foto not like '%' || x.base || '%') then 'A|perfil|avatar_substituido'
          else 'C|perfil|sem_explicacao' end
   when bucket = 'imagens' and name like 'atividades/%' then
     case when not exists (select 1 from public.atividades t where t.id::text = x.atv) then 'A|atividade|atividade_apagada'
          when exists (select 1 from public.entregas e where e.atividade_id::text = x.atv and e.usuario_id::text = x.usr and e.foto_url is not null and e.foto_url not like '%' || x.base || '%') then 'A|atividade|entrega_substituida'
          else 'C|atividade|sem_explicacao' end
   when bucket = 'imagens' and name like 'mural/%' then
     case when exists (select 1 from public.profiles p where p.id::text = x.usr) and not exists (select 1 from public.fotos f where f.url like '%' || x.base || '%' or f.thumb like '%' || x.base || '%')
          then 'A|mural|linha_de_fotos_ausente' else 'C|mural|sem_explicacao' end
   when bucket = 'comprovacoes' then
     case when not exists (select 1 from public.profiles p where p.id::text = x.usr) then 'A|comprovacao|usuario_inexistente'
          when exists (select 1 from public.entregas e where e.usuario_id::text = x.usr and e.foto_url is not null and e.foto_url <> x.name
                       and abs(extract(epoch from (e.created_at - to_timestamp(nullif(substring(x.name from '/([0-9]{10,})[.][a-z0-9]+$'),'')::bigint / 1000.0)))) < 259200) then 'A|comprovacao|entrega_substituida'
          else 'C|comprovacao|sem_explicacao' end
   else 'C|outro|sem_explicacao' end
from x order by 1, 2;`

const linhas = psql(SQL).map(([bucket, nome, bytes, criado, idade, cls]) => { const [classe, grupo, motivo] = cls.split('|'); return { bucket, nome, bytes: Number(bytes), criado, idade: Number(idade), classe, grupo, motivo } })
const [[ts]] = psql("select to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')")
const k = (await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).find((x) => x.name === 'service_role').api_key
const itens = []
for (const l of linhas) {
  const r = await fetch(`https://${REF}.supabase.co/storage/v1/object/${encodeURIComponent(l.bucket)}/${l.nome.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: `Bearer ${k}`, apikey: k } })
  const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null
  if (b && l.classe === 'A') { const dst = join(PASTA, l.bucket, ...l.nome.split('/')); mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, b) }
  itens.push({ id: createHash('md5').update(`${l.bucket}|${l.nome}`).digest('hex'), bucket: l.bucket, caminho_sha256: sha(Buffer.from(l.nome)), caminho: l.nome, bytes: l.bytes, sha256: b ? sha(b) : null, bytes_baixados: b ? b.length : null, criado_em: l.criado, idade_dias: l.idade, classe: l.classe, grupo: l.grupo, motivo: l.motivo })
}
const man = join(homedir(), '.desbravaclube-backups', 'storage-2026-10-01', 'MANIFESTO.tsv')
const noBackup = existsSync(man) ? new Set(readFileSync(man, 'utf8').split(NL).slice(1).filter(Boolean).map((l) => { const [b, c] = l.split(CR).join('').split(TAB); return `${b}|${c}` })) : new Set()
itens.forEach((i) => { i.no_backup_anterior = noBackup.has(`${i.bucket}|${i.caminho}`) })
writeFileSync(join(PASTA, 'manifesto-gc.json'), JSON.stringify({ gerado_em: ts, criterio: 'orfao, carencia 30 dias, categoria do GC recalculada agora', itens }, null, 1))
writeFileSync(join(PASTA, 'manifesto-gc.tsv'), ['id', 'bucket', 'caminho_sha256', 'bytes', 'sha256', 'criado_em', 'idade_dias', 'classe', 'grupo', 'motivo', 'no_backup_anterior'].join(TAB) + NL + itens.map((i) => [i.id, i.bucket, i.caminho_sha256, i.bytes, i.sha256, i.criado_em, i.idade_dias, i.classe, i.grupo, i.motivo, i.no_backup_anterior].join(TAB)).join(NL) + NL)
const mb = (n) => (n / 1048576).toFixed(1)
const A = itens.filter((i) => i.classe === 'A'), C = itens.filter((i) => i.classe === 'C')
console.log(`candidatos: ${itens.length} | A (seguros): ${A.length} (${mb(A.reduce((a, i) => a + i.bytes, 0))} MB) | C (indeterminados, PRESERVAR): ${C.length} (${mb(C.reduce((a, i) => a + i.bytes, 0))} MB)`)
const por = {}
for (const i of A) { const kk = `${i.bucket} · ${i.grupo} · ${i.motivo}`; por[kk] ??= { n: 0, b: 0, min: 9999, max: 0 }; por[kk].n++; por[kk].b += i.bytes; por[kk].min = Math.min(por[kk].min, i.idade_dias); por[kk].max = Math.max(por[kk].max, i.idade_dias) }
for (const [kk, v] of Object.entries(por)) console.log(`  A ${kk.padEnd(60)} ${String(v.n).padStart(3)} arq ${mb(v.b).padStart(6)} MB  idade ${v.min}-${v.max} d`)
console.log('cópia de recuperação dos A baixada:', A.filter((i) => i.sha256).length, 'de', A.length, '| presentes no backup anterior:', A.filter((i) => i.no_backup_anterior).length, '| sem cópia/indisponíveis:', A.filter((i) => !i.sha256).length)
console.log('manifesto: ~/.desbravaclube-backups/gc-recuperacao-2026-10-01/manifesto-gc.json (+ .tsv)')
