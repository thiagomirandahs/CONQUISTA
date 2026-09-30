#!/usr/bin/env node
// Gerador da migration com os MODELOS DE RELATÓRIO das Classes (fase 7).
// Fonte de verdade: supabase/curriculo-manifesto/modelos-de-relatorio/classes.json. Nada é editado à mão no banco.
//
//   node supabase/curriculo-manifesto/gerar-modelos-relatorio.mjs           # escreve a migration
//   node supabase/curriculo-manifesto/gerar-modelos-relatorio.mjs --check   # confere se a migration bate com o manifesto (CI)
//
// Recusa (exit != 0): modelo inválido (validarModelo), requisito que não existe no manifesto de classes ou que
// não é de comprovação por texto, chave repetida, campo "pendente" sem nota, marca de teste em modelo real.
// Versionamento: `versao` do arquivo. Mudou um modelo → suba a versão (as tentativas antigas guardam a versão
// com que foram feitas, e o modelo antigo NUNCA é apagado nem editado — a tabela é imutável).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { validarModelo } from '../../src/lib/relatorio/modelo.js'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..', '..')
export const ARQUIVO_MANIFESTO = join(aqui, 'modelos-de-relatorio', 'classes.json')
export const ARQUIVO_MIGRATION = join(raiz, 'supabase', 'migrations', '20260930000512_modelos-de-relatorio-das-classes.sql')
const MARCAS_DE_TESTE = /\[(EXEMPLO|TESTE|DADO DE TESTE|STAGING)\]/i

export function requisitosDeTexto(dirClasses = join(aqui, 'classes')) {
  const ids = new Map()
  for (const f of readdirSync(dirClasses).filter((x) => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(join(dirClasses, f), 'utf8'))
    for (const tipo of ['classe_regular', 'classe_avancada']) {
      const c = d[tipo]
      if (!c) continue
      for (const s of c.secoes || [c.secao_unica]) for (const r of s?.requisitos || []) ids.set(r.id, r.tipo_evidencia)
    }
  }
  return ids
}

// PURA: devolve { erros, avisos }
export function validarManifestoDeModelos(manifesto, requisitos) {
  const erros = []
  const avisos = []
  if (manifesto?.formato !== 'conquista.modelos_relatorio/1') erros.push('formato deve ser conquista.modelos_relatorio/1')
  if (manifesto?.alvo !== 'classe') erros.push('alvo deve ser "classe"')
  if (!Number.isInteger(manifesto?.versao) || manifesto.versao < 1) erros.push('versao inteira >= 1')
  if (MARCAS_DE_TESTE.test(JSON.stringify(manifesto || {}))) erros.push('modelo real carrega marca de teste/exemplo')
  const modelos = manifesto?.modelos || {}
  for (const [id, m] of Object.entries(modelos)) {
    if (!requisitos.has(id)) { erros.push(`${id}: não existe no manifesto de classes`); continue }
    if (requisitos.get(id) !== 'texto') erros.push(`${id}: o requisito não é de comprovação por texto (${requisitos.get(id)})`)
    for (const e of validarModelo(m.schema)) erros.push(`${id}: ${e}`)
    const pendentes = JSON.stringify(m.schema).includes('"pendente":true')
    if (pendentes && !m.nota) erros.push(`${id}: opção pendente exige "nota" explicando a decisão pendente`)
  }
  const semModelo = [...requisitos].filter(([id, t]) => t === 'texto' && !modelos[id]).map(([id]) => id)
  if (semModelo.length) avisos.push(`${semModelo.length} requisito(s) de texto sem modelo (seguem como texto livre): ${semModelo.slice(0, 5).join(', ')}…`)
  return { erros, avisos }
}

const aspas = (s) => `'${String(s).replace(/'/g, "''")}'`

export function gerarSql(manifesto) {
  const ids = Object.keys(manifesto.modelos).sort()
  const hash = createHash('sha256').update(JSON.stringify(manifesto)).digest('hex')
  const linhas = [
    '-- GERADO por supabase/curriculo-manifesto/gerar-modelos-relatorio.mjs — NÃO editar à mão.',
    '-- Fonte: supabase/curriculo-manifesto/modelos-de-relatorio/classes.json',
    `-- ${ids.length} modelo(s), versão ${manifesto.versao}, sha256 ${hash}`,
    '-- Idempotente e aditivo: nunca altera modelo já gravado (a tabela é imutável); mudou modelo = versão nova.',
    '',
    'insert into public.requisito_modelos (alvo, chave, versao, schema, categoria, familia, nota, fonte) values',
  ]
  ids.forEach((id, i) => {
    const m = manifesto.modelos[id]
    const fim = i === ids.length - 1 ? '' : ','
    linhas.push(`  ('classe', ${aspas(id)}, ${manifesto.versao}, ${aspas(JSON.stringify(m.schema))}::jsonb, ${aspas(m.categoria)}, ${aspas(m.familia)}, ${m.nota ? aspas(m.nota) : 'null'}, ${aspas(manifesto.fonte || '')})${fim}`)
  })
  linhas.push('on conflict (alvo, chave, versao) do nothing;', '', "notify pgrst, 'reload schema';", '')
  return { sql: linhas.join('\n'), hash }
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const check = process.argv.includes('--check')
  const manifesto = JSON.parse(readFileSync(ARQUIVO_MANIFESTO, 'utf8'))
  const { erros, avisos } = validarManifestoDeModelos(manifesto, requisitosDeTexto())
  avisos.forEach((a) => console.log(`  aviso ${a}`))
  if (erros.length) { erros.forEach((e) => console.log(`  FAIL ${e}`)); process.exit(1) }
  const { sql, hash } = gerarSql(manifesto)
  const rel = relative(raiz, ARQUIVO_MIGRATION)
  if (check) {
    const atual = existsSync(ARQUIVO_MIGRATION) ? readFileSync(ARQUIVO_MIGRATION, 'utf8') : null
    if (atual === sql) { console.log(`  ok   ${rel} bate com o manifesto (sha256 ${hash})`); process.exit(0) }
    console.log(`  FAIL ${rel} ${atual === null ? 'não existe' : 'DIVERGE do manifesto'} — regere: npm run curriculo:modelos:gerar`)
    process.exit(1)
  }
  writeFileSync(ARQUIVO_MIGRATION, sql, 'utf8')
  console.log(`  gerado ${rel} (${Object.keys(manifesto.modelos).length} modelos, sha256 ${hash})`)
}
