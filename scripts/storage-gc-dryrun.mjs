#!/usr/bin/env node
// =============================================================================
//  GC SEGURO do Storage — DRY-RUN. SOMENTE LEITURA. NÃO APAGA NADA.
//
//  Mostra o que SERIA removido (por categoria e por bucket, com bytes), sem remover nada.
//  Regras (STORAGE-GC-IMPLEMENTACAO.md):
//    * `--db <url>` é OBRIGATÓRIO e explícito. O script NUNCA lê variável de ambiente nem arquivo .env
//      para achar o banco (nem de produção): quem roda escolhe o alvo, de olhos abertos.
//    * tudo roda numa transação READ ONLY (e a sessão já abre read-only); só chama funções de leitura
//      da migration 531 (public._storage_gc_fatos / _storage_gc_quebradas / _storage_referencias).
//    * nunca candidatos: referenciado, buckets protegidos (documentos-emitidos, assinaturas-desenhadas,
//      publico, parceiros), na fila da Rede, clube na lixeira, recentes (carência mínima 7 dias) e bucket
//      fora do escopo. Qualquer violação aborta o relatório (invariantes em src/lib/storageGc.js).
//    * `--aplicar` NÃO existe: exige autorização do dono e uma fase própria.
//
//  Uso:
//    node scripts/storage-gc-dryrun.mjs --db "postgresql://usuario:senha@host:5432/postgres" [opções]
//
//  Opções:
//    --dias N              carência em dias (padrão 7; abaixo de 7 vira 7)
//    --listagem arq.json   listagem da API do Storage ([{bucket,name,bytes,criado_em}]) para achar arquivo
//                          físico SEM linha em storage.objects (ex.: de clube expurgado). Ver
//                          scripts/storage-gc-listar-api.mjs.
//    --json arq.json       grava o relatório completo em JSON (padrão: só o resumo no terminal)
//    --amostra N           itens por categoria na amostra (padrão 10, máx. 200)
//    --incluir-caminhos    caminhos COMPLETOS no JSON + lista de candidatos (exige --json; arquivo sensível,
//                          fica só no computador de quem rodou)
//    --rotulo texto        rótulo livre no relatório (ex.: producao-2026-10-02). Não leva a URL.
//
//  Requer o `psql` no PATH.
// =============================================================================
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { montarRelatorio, resumoHumano } from '../src/lib/storageGc.js'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const sair = (cod, msg) => { console.error(msg); process.exit(cod) }

// ---- recusas ---------------------------------------------------------------
if (args.some((a) => ['--aplicar', '--apagar', '--remover', '--delete', '--executar'].includes(a))) {
  sair(3, '--aplicar NÃO está implementado. Apagar arquivo do Storage exige autorização explícita do dono e uma fase própria '
    + '(lista aprovada + variável de confirmação). Este script só RELATA.')
}
if (flag('--help') || flag('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 33).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const db = valor('--db')
if (!db || db.startsWith('--')) {
  sair(2, 'Faltou --db <url>. Informe o banco de forma explícita (este script nunca lê o ambiente para escolher o alvo).')
}
if (!/^postgres(ql)?:\/\//i.test(db)) sair(2, '--db precisa ser uma URL postgresql://…')
const dias = Math.max(7, Number(valor('--dias')) || 7)
const amostra = Math.min(Math.max(Number(valor('--amostra') ?? 10) || 0, 0), 200)
const arqJson = valor('--json')
const incluirCaminhos = flag('--incluir-caminhos')
if (incluirCaminhos && !arqJson) sair(2, '--incluir-caminhos exige --json <arquivo>: caminhos completos não vão para o terminal.')

// ---- listagem opcional da API ----------------------------------------------
let listagem = null
const arqLista = valor('--listagem')
if (arqLista) {
  let bruto
  try { bruto = JSON.parse(readFileSync(arqLista, 'utf8')) } catch (e) { sair(2, `Não consegui ler a listagem: ${e.message}`) }
  const itens = Array.isArray(bruto) ? bruto : (bruto?.objetos ?? [])
  listagem = itens
    .map((o) => ({ bucket: o.bucket ?? o.bucket_id, name: o.name ?? o.nome ?? o.path,
      bytes: Number(o.bytes ?? o.size ?? o.metadata?.size ?? 0) || 0, criado_em: o.criado_em ?? o.created_at ?? null }))
    .filter((o) => o.bucket && o.name)
  if (!listagem.length) sair(2, 'A listagem está vazia ou no formato errado ([{bucket,name,bytes,criado_em}]).')
}

// ---- SQL (tudo leitura) ----------------------------------------------------
const TAG = '$gclst$'
const jsonLista = listagem ? JSON.stringify(listagem) : null
if (jsonLista && jsonLista.includes(TAG)) sair(2, 'Listagem com conteúdo inválido.')
const sql = `
begin read only;
set local statement_timeout = '120s';
set local lock_timeout = '3s';
select jsonb_build_object(
  'read_only', current_setting('transaction_read_only'),
  'funcoes_531', (to_regprocedure('public._storage_gc_fatos(jsonb,integer)') is not null
                  and to_regprocedure('public._storage_gc_quebradas()') is not null)
)::text;
select jsonb_build_object(
  'fatos', coalesce((select jsonb_agg(f) from public._storage_gc_fatos(null, ${dias}) f), '[]'::jsonb),
  'fatos_listagem', ${jsonLista
    ? `coalesce((select jsonb_agg(f) from public._storage_gc_fatos(${TAG}${jsonLista}${TAG}::jsonb, ${dias}) f where not f.existe_linha), '[]'::jsonb)`
    : "'[]'::jsonb"},
  'quebradas', coalesce((select jsonb_agg(q) from public._storage_gc_quebradas() q), '[]'::jsonb),
  'catalogo', (select count(*) from public._storage_referencias())
)::text;
rollback;
`

// ambiente MÍNIMO para o psql: nada do ambiente do usuário (PGPASSWORD, PGSERVICE, PGHOST...) entra aqui.
const base = ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'HOME']
const envFilho = {}
for (const k of base) if (process.env[k]) envFilho[k] = process.env[k]
// a URL é desmontada em variáveis PG* do processo filho (a senha não aparece na linha de comando)
let alvo
try { alvo = new URL(db) } catch { sair(2, '--db: URL inválida.') }
envFilho.PGHOST = alvo.hostname
if (alvo.port) envFilho.PGPORT = alvo.port
envFilho.PGUSER = decodeURIComponent(alvo.username)
if (alvo.password) envFilho.PGPASSWORD = decodeURIComponent(alvo.password)
envFilho.PGDATABASE = decodeURIComponent(alvo.pathname.replace(/^\//, '')) || 'postgres'
if (alvo.searchParams.get('sslmode')) envFilho.PGSSLMODE = alvo.searchParams.get('sslmode')
envFilho.PGCONNECT_TIMEOUT = '15'
envFilho.PGOPTIONS = '-c default_transaction_read_only=on'

const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, env: envFilho, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
const limpar = (t) => String(t || '').split(db).join('<url>').replace(/:\/\/[^@\s/]*@/g, '://<credenciais>@')
if (r.error) sair(1, `Não consegui executar o psql (está no PATH?): ${limpar(r.error.message)}`)
if (r.status !== 0) sair(1, `psql falhou:\n${limpar(r.stderr)}`)

const linhas = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
if (linhas.length < 2) sair(1, 'Resposta inesperada do banco.')
const pre = JSON.parse(linhas[0])
if (pre.read_only !== 'on') sair(1, 'A transação não está em modo somente leitura. Abortado.')
if (!pre.funcoes_531) sair(1, 'As funções da migration 531 não existem nesse banco. Aplique a 531 (aditiva: só funções, sem tabela) antes do dry-run.')
const dados = JSON.parse(linhas[1])

const chaveCurta = (b, n) => createHash('md5').update(`${b}/${n}`).digest('hex').slice(0, 12)
const fatos = [...dados.fatos, ...dados.fatos_listagem]
const rel = montarRelatorio(
  { fatos, quebradas: dados.quebradas, listagemUsada: !!listagem },
  { carenciaDias: dias, amostra, incluirCaminhos, chaveCurta },
)
rel.rotulo = valor('--rotulo') || null
rel.catalogo_entradas = dados.catalogo

console.log(resumoHumano(rel))
if (arqJson) {
  writeFileSync(arqJson, JSON.stringify(rel, null, 2), 'utf8')
  console.log(`\nRelatório JSON gravado em ${arqJson}${incluirCaminhos ? ' (contém caminhos completos: não compartilhe)' : ''}.`)
}
