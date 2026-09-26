#!/usr/bin/env node
// Gera a importação oficial das 6 Classes Regulares A PARTIR DO MANIFESTO (fase 3).
// O manifesto (omds.json + classes/*.json) é a ÚNICA fonte: este script não raspa nada da web
// e ninguém recopia requisito pra SQL à mão. Ele:
//   1) valida o manifesto com o mesmo validarDados de `npm run curriculo:validar` (recusa se houver erro);
//   2) monta o "pacote" canônico (classe_regular das 6 em `classes` + as avançadas sem pendência em
//      `classes_avancadas`, desde a 2026.4), com o
//      registro de OMDs e o sha256 de cada arquivo lido;
//   3) calcula o sha256 do pacote canônico (chaves ordenadas, sem espaços) — é o fonte_hash da
//      curriculum_version, e o que o teste de integridade (36) reconfere contra o banco;
//   4) escreve DOIS arquivos, byte a byte determinísticos:
//        supabase/migrations/20260921000040_importar-classes-regulares-2026-1.sql
//          -> chama public.curriculo_importar_classes_regulares(pacote, hash) (migration 39)
//        supabase/tests/_curriculo_regular_2026.sql
//          -> o MESMO pacote/hash, incluível pelos testes (\ir) pra comparar manifesto → banco.
//
// Uso:
//   node supabase/curriculo-manifesto/gerar-importacao.mjs           # (re)gera os dois arquivos
//   node supabase/curriculo-manifesto/gerar-importacao.mjs --check   # só confere: os arquivos em disco
//                                                                     # batem com o que o manifesto gera hoje?
//                                                                     # (gate: manifesto editado sem regerar = FALHA)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { validarDados, carregarOmds, carregarClasses } from './validar.mjs'

const dirManifesto = dirname(fileURLToPath(import.meta.url))
const raiz = join(dirManifesto, '..', '..')
const CLASSES_REGULARES = ['amigo', 'companheiro', 'excursionista', 'guia', 'pesquisador', 'pioneiro']
const TAG = '$cq_manifesto$'

// JSON canônico: chaves ordenadas recursivamente, sem espaços — o hash depende só do CONTEÚDO.
export function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

export function montarPacote() {
  const omds = carregarOmds(dirManifesto)
  const arquivosClasses = carregarClasses(dirManifesto)
  const { erros } = validarDados({ omds, arquivosClasses })
  if (erros.length) throw new Error('Manifesto inválido — corrija antes de gerar a importação:\n  ' + erros.join('\n  '))

  const regulares = arquivosClasses.map((a) => a.dados.classe_regular).filter(Boolean)
  const ids = regulares.map((c) => c.id).sort()
  if (JSON.stringify(ids) !== JSON.stringify(CLASSES_REGULARES)) {
    throw new Error(`Esperadas exatamente as 6 Classes Regulares (${CLASSES_REGULARES.join(', ')}); manifesto tem: ${ids.join(', ')}`)
  }
  const versoes = new Set(arquivosClasses.map((a) => a.dados.manifesto_versao))
  const datas = new Set(arquivosClasses.map((a) => a.dados.gerado_em))
  if (versoes.size !== 1 || datas.size !== 1) throw new Error('Todos os classes/*.json precisam ter o MESMO manifesto_versao e gerado_em.')
  for (const c of regulares) {
    for (const s of c.secoes) for (const r of s.requisitos) {
      if ((r.status || 'CONFIRMADO') === 'PENDENTE_DE_VALIDACAO') throw new Error(`${r.id} está PENDENTE_DE_VALIDACAO — uma Classe Regular com pendência não pode ser publicada.`)
    }
  }

  // (2026.4) Classes Avançadas: entram no pacote em `classes_avancadas` (a chave `classes` continua sendo SÓ as 6
  // regulares — o teste 36 e o importador tratam os dois grupos separadamente). Uma avançada com qualquer requisito
  // PENDENTE_DE_VALIDACAO NÃO é publicada: fica fora do pacote e o gerador avisa (nunca se publica pendência).
  const avancadasPendentes = []
  const avancadas = []
  for (const a of arquivosClasses.map((x) => x.dados.classe_avancada).filter(Boolean)) {
    const pend = (a.secao_unica?.requisitos || []).filter((r) => (r.status || 'CONFIRMADO') === 'PENDENTE_DE_VALIDACAO').map((r) => r.id)
    if (pend.length) { avancadasPendentes.push({ id: a.id, pendentes: pend }); continue }
    const { secao_unica: sec, ...resto } = a
    avancadas.push({ ...resto, secoes: [sec] })
  }

  const arquivos = ['omds.json', ...arquivosClasses.map((a) => 'classes/' + a.arquivo)].map((rel) => ({
    arquivo: 'supabase/curriculo-manifesto/' + rel,
    sha256: sha256(readFileSync(join(dirManifesto, rel), 'utf8')),
  }))

  const pacote = {
    manifesto_versao: [...versoes][0],
    gerado_em: [...datas][0],
    arquivos,
    omds: [...omds.values()],
    classes: regulares.sort((a, b) => a.id.localeCompare(b.id)),
    classes_avancadas: avancadas.sort((a, b) => a.id.localeCompare(b.id)),
  }
  const texto = canonico(pacote)
  if (texto.includes(TAG)) throw new Error('O pacote contém a tag de dollar-quoting — impossível embutir.')
  return { pacote, texto, hash: sha256(texto), avancadasPendentes }
}

function resumo(pacote) {
  let secoes = 0, reqs = 0, grupos = 0, opcoes = 0, dinamicos = 0
  for (const c of [...pacote.classes, ...(pacote.classes_avancadas || [])]) for (const s of c.secoes) {
    secoes++
    for (const r of s.requisitos) {
      reqs++
      if (r.tipo === 'anual_dinamico') dinamicos++
      if (r.tipo === 'escolha_n_de_m' || r.tipo === 'escolha_n_de_m_sem_repeticao') { grupos++; opcoes += (r.escolha?.opcoes || []).length }
    }
  }
  return { classes: pacote.classes.length, avancadas: (pacote.classes_avancadas || []).length, secoes, reqs, grupos, opcoes, dinamicos }
}

export function gerarArquivos() {
  const { pacote, texto, hash, avancadasPendentes } = montarPacote()
  const r = resumo(pacote)
  const slug = 'importar-classes-regulares-' + pacote.manifesto_versao.replace(/[^0-9a-z]+/gi, '-')
  const cab = (tipo) => [
    `-- ${tipo} GERADO por supabase/curriculo-manifesto/gerar-importacao.mjs — NÃO EDITAR À MÃO.`,
    `-- Fonte única: manifesto curricular ${pacote.manifesto_versao} (gerado em ${pacote.gerado_em}): classe_regular das 6 Classes Regulares`
      + (r.avancadas ? ` + ${r.avancadas} Classes Avançadas (classes_avancadas).` : '.'),
    `-- sha256 do pacote canônico: ${hash}`,
    `-- ${r.classes} regulares + ${r.avancadas} avançadas, ${r.secoes} seções, ${r.reqs} requisitos, ${r.grupos} grupos N-de-M (${r.opcoes} opções), ${r.dinamicos} requisitos anuais/dinâmicos.`,
    `-- Para regerar: node supabase/curriculo-manifesto/gerar-importacao.mjs  (--check só confere).`,
  ].join('\n')

  const migration = [
    cab('ARQUIVO'),
    '-- Re-executar com o MESMO manifesto é no-op (mesmo hash). Conteúdo diferente com a mesma versão é RECUSADO',
    '-- pelo importador (versão publicada nunca é editada — gere uma versão nova do manifesto).',
    '-- Não cria progresso/conclusão pra ninguém: publica catálogo, não matricula pessoas.',
    `select public.curriculo_importar_classes_regulares(${TAG}${texto}${TAG}::jsonb, '${hash}');`,
    '',
    "notify pgrst, 'reload schema';",
    '',
    'insert into public.migracoes_aplicadas (arquivo)',
    `values ('2026-09-21-${slug}.sql')`,
    'on conflict (arquivo) do update set aplicada_em = now();',
    '',
  ].join('\n')

  const fixture = [
    cab('FIXTURE DE TESTE'),
    '-- Incluir DEPOIS de \\ir _lib.sql. t.manifesto guarda o pacote canônico (texto) e o hash, pra comparar manifesto → banco.',
    'create table t.manifesto (texto text not null, hash text not null);',
    `insert into t.manifesto (texto, hash) values (${TAG}${texto}${TAG}, '${hash}');`,
    'grant select on t.manifesto to public;',
    '',
  ].join('\n')

  // Uma migration POR VERSÃO do manifesto: a da versão atual é encontrada pelo slug (se já existe, é
  // ela que --check confere); senão ganha o próximo número livre. As migrations de versões anteriores
  // (ex.: ..._2026-1.sql) ficam intocadas — são história (o importador arquiva a versão anterior ao
  // importar a nova; nunca a edita).
  const dirMig = join(raiz, 'supabase', 'migrations')
  const existente = readdirSync(dirMig).find((f) => f.endsWith(`_${slug}.sql`))
  let nomeMigration = existente
  // Número da migration de uma versão NOVA: o próximo livre, ou o forçado por CURRICULO_MIGRATION_NUMERO (14 dígitos)
  // quando outra frente de trabalho reservou faixas de numeração. Depois de criada, é achada pelo slug.
  if (!nomeMigration && process.env.CURRICULO_MIGRATION_NUMERO) {
    const n = process.env.CURRICULO_MIGRATION_NUMERO
    if (!/^\d{14}$/.test(n) || readdirSync(dirMig).some((f) => f.startsWith(n + '_'))) throw new Error(`CURRICULO_MIGRATION_NUMERO inválido ou já usado: ${n}`)
    nomeMigration = `${n}_${slug}.sql`
  }
  if (!nomeMigration) {
    const maior = readdirSync(dirMig).map((f) => /^(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort().pop()
    nomeMigration = `${String(BigInt(maior) + 1n)}_${slug}.sql`
  }
  return {
    hash, resumo: r, versao: pacote.manifesto_versao, avancadasPendentes,
    arquivos: [
      { caminho: join(dirMig, nomeMigration), conteudo: migration },
      { caminho: join(raiz, 'supabase', 'tests', '_curriculo_regular_2026.sql'), conteudo: fixture },
    ],
  }
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const check = process.argv.includes('--check')
  const { hash, resumo: r, versao, arquivos, avancadasPendentes } = gerarArquivos()
  for (const p of avancadasPendentes) console.log(`  AVISO classe avançada ${p.id} NÃO publicada — pendente: ${p.pendentes.join(', ')}`)
  let drift = 0
  for (const { caminho, conteudo } of arquivos) {
    const rel = relative(raiz, caminho)
    if (check) {
      const atual = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
      if (atual === conteudo) console.log(`  ok   ${rel} bate com o manifesto`)
      else { drift++; console.log(`  FAIL ${rel} ${atual === null ? 'não existe' : 'DIVERGE do manifesto (regere: node supabase/curriculo-manifesto/gerar-importacao.mjs)'}`) }
    } else {
      writeFileSync(caminho, conteudo, 'utf8')
      console.log(`  gerado ${rel}`)
    }
  }
  console.log(`\nmanifesto ${versao} — sha256 ${hash}`)
  console.log(`${r.classes} regulares + ${r.avancadas} avançadas, ${r.secoes} seções, ${r.reqs} requisitos, ${r.grupos} grupos N-de-M (${r.opcoes} opções), ${r.dinamicos} dinâmicos`)
  if (check) console.log(drift === 0 ? 'OK — os arquivos gerados correspondem exatamente ao manifesto.' : `FALHOU — ${drift} arquivo(s) fora de sincronia com o manifesto.`)
  process.exit(drift === 0 ? 0 : 1)
}
