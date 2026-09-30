#!/usr/bin/env node
// Gerador do SQL de importação de ESPECIALIDADES a partir do manifesto validado (fase 7).
// Só entram especialidades "publicavel" (com requisitos conferidos). O SQL é determinístico (mesmo manifesto →
// mesmo arquivo + mesmo sha256) e chama public.curriculo_importar_especialidades(pacote, hash) — função a criar
// numa migration futura, DEPOIS da aprovação da fonte e da estratégia de importação. Nunca aplica nada sozinho.
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { carregarAreas, validarEspecialidades, dirManifesto } from './validar.mjs'

export function montarPacote(arquivos) {
  const especialidades = []
  for (const { dados } of arquivos) {
    for (const e of dados.especialidades) {
      if (e.estado !== 'publicavel') continue
      especialidades.push({
        codigo: e.codigo, nome: e.nome, categoria: dados.area_nome, nivel: e.nivel ?? null, fonte_url: e.fonte_url,
        requisitos: e.requisitos.map((r) => ({ ordem: r.ordem, descricao: r.descricao, tipo_evidencia: r.tipo_evidencia, fonte_url: r.fonte_url })),
      })
    }
  }
  especialidades.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return { formato: 'conquista.especialidades/1', especialidades }
}

export function gerarSql(arquivos) {
  const { erros } = validarEspecialidades(arquivos)
  if (erros.length) throw new Error('Manifesto inválido — corrija antes de gerar:\n' + erros.join('\n'))
  const pacote = montarPacote(arquivos)
  const json = JSON.stringify(pacote)
  const hash = createHash('sha256').update(json).digest('hex')
  const sql = [
    '-- GERADO por supabase/especialidades-manifesto/gerar-importacao.mjs — NÃO editar à mão.',
    `-- ${pacote.especialidades.length} especialidade(s) publicável(is); sha256 ${hash}`,
    `select public.curriculo_importar_especialidades($pacote$${json}$pacote$::jsonb, '${hash}');`,
    '',
  ].join('\n')
  return { sql, hash, pacote }
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const check = process.argv.includes('--check')
  const arqs = carregarAreas().filter((a) => a.dados)
  const caminho = join(dirManifesto, 'importacao-especialidades.sql')
  const publicaveis = arqs.reduce((n, a) => n + a.dados.especialidades.filter((e) => e.estado === 'publicavel').length, 0)
  if (!publicaveis) {
    console.log('Nenhuma especialidade "publicavel" no manifesto — nada a gerar (estrutura pronta; conteúdo aguarda fonte aprovada).')
    process.exit(0)
  }
  const { sql, hash } = gerarSql(arqs)
  if (check) {
    const atual = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
    if (atual === sql) { console.log(`  ok   importacao-especialidades.sql bate com o manifesto (sha256 ${hash})`); process.exit(0) }
    console.log('  FAIL importacao-especialidades.sql ' + (atual === null ? 'não existe' : 'DIVERGE do manifesto') + ' — regere: npm run especialidades:importacao:gerar')
    process.exit(1)
  }
  writeFileSync(caminho, sql, 'utf8')
  console.log(`  gerado importacao-especialidades.sql (sha256 ${hash})`)
}
