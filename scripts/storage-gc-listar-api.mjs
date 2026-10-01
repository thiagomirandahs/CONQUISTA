#!/usr/bin/env node
// =============================================================================
//  Lista os arquivos FÍSICOS de um bucket pela API do Storage (só `list`: leitura) e grava um JSON no
//  formato que scripts/storage-gc-dryrun.mjs aceita em --listagem. Serve para achar arquivo que existe
//  no backend mas NÃO tem linha em storage.objects (ex.: sobra do expurgo de clube, migration 280).
//
//    node scripts/storage-gc-listar-api.mjs --url https://xxxx.supabase.co --chave-env NOME_DA_VARIAVEL \
//         --saida listagem.json [--buckets comprovacoes,imagens,comunidade,suporte-anexos]
//
//  A chave de serviço NUNCA vai na linha de comando: o script lê a variável de ambiente CUJO NOME você
//  informa em --chave-env (nada é lido sozinho). Só chama list(); não existe remove() aqui.
// =============================================================================
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const sair = (cod, msg) => { console.error(msg); process.exit(cod) }

const url = valor('--url')
const nomeVar = valor('--chave-env')
const saida = valor('--saida')
if (!url || !nomeVar || !saida) sair(2, 'Uso: --url <https://projeto.supabase.co> --chave-env <NOME_DA_VARIAVEL> --saida <arquivo.json> [--buckets a,b]')
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(url)) sair(2, '--url precisa ser a URL do projeto Supabase (https://….supabase.co) ou o Supabase local.')
const chave = process.env[nomeVar]
if (!chave) sair(2, `A variável de ambiente ${nomeVar} está vazia.`)
const buckets = (valor('--buckets') || 'comprovacoes,imagens,comunidade,suporte-anexos').split(',').map((s) => s.trim()).filter(Boolean)

const sb = createClient(url, chave, { auth: { persistSession: false } })
const PAGINA = 1000

// percorre pastas recursivamente (a API lista um nível por vez; item sem `id` é pasta)
async function listar(bucket, prefixo, acc) {
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await sb.storage.from(bucket).list(prefixo, { limit: PAGINA, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`${bucket}/${prefixo}: ${error.message}`)
    if (!data?.length) return
    for (const it of data) {
      const caminho = prefixo ? `${prefixo}/${it.name}` : it.name
      if (it.id == null) await listar(bucket, caminho, acc)
      else acc.push({ bucket, name: caminho, bytes: Number(it.metadata?.size ?? 0) || 0, criado_em: it.created_at ?? null })
    }
    if (data.length < PAGINA) return
  }
}

const todos = []
for (const b of buckets) {
  const antes = todos.length
  await listar(b, '', todos)
  console.log(`${b}: ${todos.length - antes} arquivo(s)`)
}
writeFileSync(saida, JSON.stringify(todos), 'utf8')
console.log(`Listagem gravada em ${saida} (${todos.length} arquivos). Contém caminhos completos: não compartilhe.`)
