#!/usr/bin/env node
// Gera o SQL de PLATAFORMA que publica o conteúdo anual de um ano (fase 9.1, item 8) A PARTIR DO
// MANIFESTO VALIDADO (conteudo-anual/<ano>.json). É o único caminho de publicação: ninguém escreve
// INSERT em dynamic_content_values à mão.
//
//   1) valida o manifesto do ano com o mesmo validarConteudoAnual de `npm run curriculo:conteudo-anual:validar`
//      (recusa se houver erro — vigência aberta, lacuna, fonte ausente, slot desconhecido, exemplo...);
//   2) monta o pacote canônico {formato, ano, arquivo, itens} (itens em ordem de chave e início);
//   3) calcula o sha256 do pacote canônico — é o `fonte_hash` que a função do banco grava em cada linha;
//   4) escreve conteudo-anual/publicar-<ano>.sql: UMA chamada a public.conteudo_anual_publicar(pacote, hash)
//      (migration 84), que recusa de novo tudo o que o validador recusa, é no-op com o mesmo manifesto e
//      recusa OUTRO manifesto para um ano já publicado.
//
// Uso:
//   node supabase/curriculo-manifesto/gerar-conteudo-anual.mjs 2027            # gera conteudo-anual/publicar-2027.sql
//   node supabase/curriculo-manifesto/gerar-conteudo-anual.mjs 2027 --check    # só confere (gate: manifesto editado sem regerar = FALHA)
//   node supabase/curriculo-manifesto/gerar-conteudo-anual.mjs --exemplo       # mostra (stdout) o SQL do EXEMPLO, embrulhado em
//                                                                              # begin/rollback — nunca grava arquivo, nunca publica
//   npm run curriculo:conteudo-anual:gerar -- 2027
// Sem ano: gera/confere todos os <ano>.json que existirem (hoje: nenhum — só o exemplo).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { canonico } from './gerar-importacao.mjs'
import { FORMATO, validarConteudoAnual, carregarManifestosDeConteudo, slotsEsperados, dirConteudoAnual, dirManifesto } from './validar-conteudo-anual.mjs'

const raiz = join(dirManifesto, '..', '..')
const TAG = '$cq_conteudo_anual$'
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

export function montarPacote({ arquivo, dados }, slots) {
  const { erros } = validarConteudoAnual({ arquivo, dados, slotsEsperados: slots })
  if (erros.length) throw new Error(`Manifesto ${arquivo} inválido — corrija antes de gerar a publicação:\n  ` + erros.join('\n  '))
  const itens = dados.itens
    .map((it) => ({ chave: it.chave, valor: it.valor.trim(), vigente_desde: it.vigente_desde, vigente_ate: it.vigente_ate,
                    fonte_url: it.fonte_url, fonte_descricao: it.fonte_descricao.trim() }))
    .sort((a, b) => a.chave.localeCompare(b.chave) || a.vigente_desde.localeCompare(b.vigente_desde))
  const pacote = { formato: FORMATO, ano: dados.ano, arquivo: 'supabase/curriculo-manifesto/conteudo-anual/' + arquivo, itens }
  const texto = canonico(pacote)
  if (texto.includes(TAG)) throw new Error('O pacote contém a tag de dollar-quoting — impossível embutir.')
  return { pacote, texto, hash: sha256(texto) }
}

export function gerarSql({ arquivo, dados }, slots) {
  const { pacote, texto, hash } = montarPacote({ arquivo, dados }, slots)
  const exemplo = dados.exemplo === true
  const linhas = [
    `-- ${exemplo ? 'EXEMPLO — NÃO É CONTEÚDO REAL. ' : ''}GERADO por supabase/curriculo-manifesto/gerar-conteudo-anual.mjs — NÃO EDITAR À MÃO.`,
    `-- Fonte única: supabase/curriculo-manifesto/conteudo-anual/${arquivo} (validado), ano ${pacote.ano}, ${pacote.itens.length} item(ns).`,
    `-- sha256 do pacote canônico: ${hash}`,
    '-- Rodar no SQL Editor do projeto, como postgres (é operação de PLATAFORMA). Procedimento completo, conferência',
    '-- e o que fazer se algo falhar: supabase/curriculo-manifesto/PUBLICACAO-CONTEUDO-ANUAL.md.',
    '-- Rodar de novo com o MESMO manifesto é no-op. Outro manifesto para um ano já publicado é RECUSADO.',
  ]
  if (exemplo) linhas.push('-- EXEMPLO: embrulhado em begin/rollback — mesmo rodado por engano, nada fica publicado.', 'begin;')
  linhas.push(`select public.conteudo_anual_publicar(${TAG}${texto}${TAG}::jsonb, '${hash}');`)
  if (exemplo) linhas.push('rollback;')
  linhas.push('')
  return { sql: linhas.join('\n'), hash, pacote }
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const slots = slotsEsperados()
  const manifestos = carregarManifestosDeConteudo()

  if (args.includes('--exemplo')) {
    const ex = manifestos.find((m) => m.arquivo === 'exemplo.json')
    if (!ex) { console.error('conteudo-anual/exemplo.json não existe.'); process.exit(1) }
    process.stdout.write(gerarSql(ex, slots).sql)
    process.exit(0)
  }

  const anoPedido = args.find((a) => /^\d{4}$/.test(a))
  const alvos = manifestos.filter((m) => /^\d{4}\.json$/.test(m.arquivo) && (!anoPedido || m.arquivo === `${anoPedido}.json`))
  if (anoPedido && alvos.length === 0) {
    console.error(`conteudo-anual/${anoPedido}.json não existe. Crie o manifesto do ano (veja conteudo-anual/README.md) antes de gerar.`)
    process.exit(1)
  }
  if (alvos.length === 0) {
    console.log('Nenhum manifesto de ano em conteudo-anual/ (só o exemplo). Nada a gerar.')
    console.log('Para ver o formato do SQL: node supabase/curriculo-manifesto/gerar-conteudo-anual.mjs --exemplo')
    process.exit(0)
  }
  let falhas = 0
  for (const m of alvos) {
    if (m.erroLeitura) { falhas++; console.log(`  FAIL ${m.arquivo}: JSON inválido — ${m.erroLeitura}`); continue }
    let saida
    try { saida = gerarSql(m, slots) } catch (e) { falhas++; console.log(`  FAIL ${e.message}`); continue }
    const caminho = join(dirConteudoAnual, `publicar-${m.dados.ano}.sql`)
    const rel = relative(raiz, caminho)
    if (check) {
      const atual = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
      if (atual === saida.sql) console.log(`  ok   ${rel} bate com o manifesto (sha256 ${saida.hash})`)
      else { falhas++; console.log(`  FAIL ${rel} ${atual === null ? 'não existe' : 'DIVERGE do manifesto'} — regere: npm run curriculo:conteudo-anual:gerar -- ${m.dados.ano}`) }
    } else {
      writeFileSync(caminho, saida.sql, 'utf8')
      console.log(`  gerado ${rel}  (ano ${m.dados.ano}, ${saida.pacote.itens.length} item(ns), sha256 ${saida.hash})`)
    }
  }
  process.exit(falhas === 0 ? 0 : 1)
}
