#!/usr/bin/env node
// Validador do manifesto curricular 2026 (fase 2.5 — Consolidação Curricular).
// NÃO toca no banco, não importa nada em curriculum_versions — só valida os arquivos
// JSON em supabase/curriculo-manifesto/classes/*.json contra as regras abaixo e gera
// o relatório de cobertura. Rejeita (exit != 0) qualquer manifesto que:
//   1) tenha requisito sem proveniência (fonte);
//   2) tenha IDs duplicados (classe, seção ou requisito);
//   3) referencie uma OMD que não existe no registro (omds.json);
//   4) referencie uma OMD PENDENTE_DE_VALIDACAO como se fosse confirmada
//      (é assim que a possível OMD 022/2026 fica travada: existe no registro,
//      mas nenhum requisito pode se apoiar nela);
//   5) tenha vigência inconsistente (datas inválidas, ou vigente_desde copiado
//      do carimbo de publicação da página — proibido nesta fase);
//   6) apresente um item PENDENTE_DE_VALIDACAO sem motivo_pendencia, OU um item
//      CONFIRMADO/ALTERADO_POR_OMD que ainda carrega um bloco de pendência
//      (contraditório: não pode estar confirmado E pendente ao mesmo tempo);
//   7) tenha código de requisito duplicado dentro da mesma seção, ou de seção
//      duplicado dentro da mesma classe (mesma unicidade que o schema real
//      vai exigir: unique(section_id, codigo) — ver migration 36);
//   8) (fase 2.6) marque um requisito com uma lacuna_schema que NÃO tenha
//      representação suportada no banco (REPRESENTACAO_DAS_LACUNAS, abaixo).
//      Desde a migration 38 as 4 lacunas da fase 2 têm mecanismo próprio; uma
//      tag desconhecida significaria "conteúdo que o schema ainda achata".
//
// A lógica de validação (validarDados) é pura — recebe dados já carregados, não
// lê disco — pra dar pra testar com fixtures sintéticas em validar.autoteste.mjs
// sem depender do manifesto real (e sem precisar copiar conteúdo oficial pra provar
// que uma regra rejeita algo).
//
// Uso:
//   node supabase/curriculo-manifesto/validar.mjs
//   npm run curriculo:validar

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const STATUS_VALIDOS = ['CONFIRMADO', 'ALTERADO_POR_OMD', 'PENDENTE_DE_VALIDACAO']

// Fase 2.6 (migration 20260921000038_motor-de-regras-curriculares.sql): cada lacuna_schema
// que o manifesto pode marcar → o mecanismo do banco que a representa SEM achatar. Toda
// tag usada no manifesto PRECISA estar aqui (senão o validador rejeita — regra 8): uma
// tag fora deste registro significaria conteúdo que o schema ainda não sabe modelar.
// Fica no validador (não item a item no manifesto) porque a representação é propriedade
// da lacuna, não de cada requisito que a exercita.
export const REPRESENTACAO_DAS_LACUNAS = Object.freeze({
  requisito_anual_dinamico: {
    migration: '20260921000038',
    mecanismo: 'dynamic_content_definitions + dynamic_content_values (catálogo temporal, vigência sem sobreposição) + conteudo_dinamico_resolver(chave, data); class_requirements.conteudo_dinamico_definicao_id',
    resumo: 'conteúdo variável por período, resolvido pelo servidor pela data — sem nova curriculum_version por ano',
  },
  escolha_n_de_m: {
    migration: '20260921000038',
    mecanismo: 'requirement_option_groups(n_minimo) + requirement_options; opcoes_satisfeitas_automaticamente(grupo, pessoa)',
    resumo: '"complete N das M opções", extensível a qualquer N — o servidor conta; o front só apresenta',
  },
  escolha_sem_repeticao: {
    migration: '20260921000038',
    mecanismo: 'requirement_option_groups.sem_repeticao + especialidade_ja_concluida_pela_pessoa(pessoa, especialidade) sobre curriculum_achievements (histórico curricular portátil, com proveniência)',
    resumo: '"não realizada anteriormente" consulta o histórico da PESSOA em qualquer clube, nunca member_specialties do clube atual',
  },
  prazo_conclusao: {
    migration: '20260921000038',
    mecanismo: 'classes/specialties.prazo_minimo_dias + prazo_maximo_dias; prazo_situacao(inicio, min, max); gatilho de conclusão respeita o mínimo',
    resumo: 'prazo declarado no próprio registro versionado, calculado no servidor a partir de iniciada_em (NULL nas 6 Classes Regulares: a fonte não determina)',
  },
})

function erro(lista, msg) { lista.push(msg) }

export function carregarOmds(dirManifesto) {
  const bruto = JSON.parse(readFileSync(join(dirManifesto, 'omds.json'), 'utf8'))
  const porId = new Map()
  for (const o of bruto.omds) porId.set(o.id, o)
  return porId
}

export function carregarClasses(dirManifesto) {
  const dirClasses = join(dirManifesto, 'classes')
  const arquivos = readdirSync(dirClasses).filter((f) => f.endsWith('.json')).sort()
  return arquivos.map((f) => ({ arquivo: f, dados: JSON.parse(readFileSync(join(dirClasses, f), 'utf8')) }))
}

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime())
}

// Percorre um "bloco" de classe (classe_regular OU classe_avancada) e devolve a lista
// plana de requisitos, cada um anotado com a seção/classe a que pertence — pra não
// repetir a mesma travessia nas várias regras de validação.
function achatarRequisitos(bloco, tipoClasse, arquivo) {
  const out = []
  if (!bloco) return out
  if (bloco.secoes) {
    for (const s of bloco.secoes) {
      for (const r of (s.requisitos || [])) out.push({ req: r, secao: s, classeId: bloco.id, tipoClasse, arquivo })
    }
  }
  if (bloco.secao_unica) {
    const s = bloco.secao_unica
    for (const r of (s.requisitos || [])) out.push({ req: r, secao: s, classeId: bloco.id, tipoClasse, arquivo })
  }
  return out
}

// validarDados: função PURA (sem I/O). Recebe { omds: Map<id,omd>, arquivosClasses: [{arquivo, dados}] }
// e devolve { erros, avisos }. Usada tanto pelo CLI real (com o manifesto de verdade)
// quanto pelo autoteste (com fixtures sintéticas).
export function validarDados({ omds, arquivosClasses }) {
  const erros = []
  const avisos = []

  for (const [id, o] of omds) {
    if (id === 'OMD-022-2026' && o.status !== 'PENDENTE_DE_VALIDACAO') {
      erro(erros, `omds.json: ${id} precisa continuar status=PENDENTE_DE_VALIDACAO (referência não confirmada em fonte oficial) — não pode virar CONFIRMADO sem nova evidência primária.`)
    }
  }

  const idsVistos = new Map()
  const codigosPorSecao = new Map()

  function marcarId(id, onde) {
    if (!id) { erro(erros, `${onde}: item sem "id".`); return }
    if (idsVistos.has(id)) {
      erro(erros, `ID duplicado "${id}": já usado em "${idsVistos.get(id)}", repetido em "${onde}".`)
    } else {
      idsVistos.set(id, onde)
    }
  }

  for (const { arquivo, dados } of arquivosClasses) {
    for (const [tipoClasse, chave] of [['regular', 'classe_regular'], ['avancada', 'classe_avancada']]) {
      const bloco = dados[chave]
      if (!bloco) continue
      marcarId(bloco.id, `${arquivo}#${chave}`)

      if (!bloco.fonte_base || !bloco.fonte_base.url) {
        erro(erros, `${arquivo}#${bloco.id}: classe sem fonte_base.url — toda classe precisa apontar pra a página/documento oficial de origem.`)
      }
      if (bloco.fonte_base?.publicado_em && !dataValida(bloco.fonte_base.publicado_em)) {
        erro(erros, `${arquivo}#${bloco.id}: fonte_base.publicado_em inválida ("${bloco.fonte_base.publicado_em}").`)
      }
      if (tipoClasse === 'regular') {
        if (!bloco.vigente_desde) {
          erro(erros, `${arquivo}#${bloco.id}: classe_regular sem vigente_desde — não pode reusar publicado_em como vigência (regra explícita desta fase).`)
        } else if (!dataValida(bloco.vigente_desde)) {
          erro(erros, `${arquivo}#${bloco.id}: vigente_desde inválida ("${bloco.vigente_desde}").`)
        } else if (bloco.fonte_base?.publicado_em === bloco.vigente_desde) {
          erro(erros, `${arquivo}#${bloco.id}: vigente_desde é IDÊNTICA a fonte_base.publicado_em — parece cópia automática do carimbo da página, proibida por esta fase.`)
        }
      }

      const secoesDaClasse = new Set()
      const secoesParaChecar = bloco.secoes || (bloco.secao_unica ? [bloco.secao_unica] : [])
      for (const s of secoesParaChecar) {
        marcarId(s.id, `${arquivo}#${bloco.id}`)
        const chaveSecao = s.codigo || s.id
        if (secoesDaClasse.has(chaveSecao)) erro(erros, `${arquivo}#${bloco.id}: seção com código/id duplicado "${chaveSecao}".`)
        secoesDaClasse.add(chaveSecao)
      }

      for (const { req, secao } of achatarRequisitos(bloco, tipoClasse, arquivo)) {
        const onde = `${arquivo}#${req.id || '(sem id)'}`
        marcarId(req.id, onde)
        if (req.codigo && req.id) {
          if (!codigosPorSecao.has(secao.id)) codigosPorSecao.set(secao.id, new Set())
          const set = codigosPorSecao.get(secao.id)
          if (set.has(req.codigo)) erro(erros, `${onde}: código de requisito "${req.codigo}" duplicado dentro da seção "${secao.id}" (equivalente a violar unique(section_id, codigo) no schema real).`)
          set.add(req.codigo)
        }
        if (!req.descricao_resumida) erro(erros, `${onde}: requisito sem descricao_resumida.`)

        const status = req.status || 'CONFIRMADO'
        if (!STATUS_VALIDOS.includes(status)) {
          erro(erros, `${onde}: status "${status}" inválido — precisa ser um de ${STATUS_VALIDOS.join(', ')}.`)
        }

        const refsOmd = [req.alterado_por_omd, req.confirmado_por_omd, req.proveniencia_pendente?.omd_referida].filter(Boolean)
        for (const ref of refsOmd) {
          if (!omds.has(ref)) {
            erro(erros, `${onde}: referencia a OMD "${ref}", que não existe em omds.json (dependência inexistente).`)
            continue
          }
          const omd = omds.get(ref)
          if ((req.alterado_por_omd === ref || req.confirmado_por_omd === ref) && omd.status !== 'CONFIRMADO') {
            erro(erros, `${onde}: usa a OMD "${ref}" (status=${omd.status}) para justificar status=${status} — uma OMD PENDENTE_DE_VALIDACAO nunca pode ser citada como fonte de um requisito CONFIRMADO/ALTERADO_POR_OMD.`)
          }
        }

        if (status === 'PENDENTE_DE_VALIDACAO') {
          if (!req.proveniencia_pendente || !req.proveniencia_pendente.motivo_pendencia) {
            erro(erros, `${onde}: status=PENDENTE_DE_VALIDACAO sem proveniencia_pendente.motivo_pendencia — toda pendência precisa de um motivo explícito, nunca implícito.`)
          }
          if (req.confirmado_por_omd) {
            erro(erros, `${onde}: status=PENDENTE_DE_VALIDACAO mas tem confirmado_por_omd preenchido — contraditório (isso apresentaria um item pendente como se já estivesse confirmado).`)
          }
        } else if (req.proveniencia_pendente) {
          erro(erros, `${onde}: status=${status} mas ainda carrega proveniencia_pendente — um item não pode estar confirmado/alterado E pendente ao mesmo tempo.`)
        }

        if (status === 'ALTERADO_POR_OMD' && !req.alterado_por_omd) {
          erro(erros, `${onde}: status=ALTERADO_POR_OMD sem alterado_por_omd — não dá pra rastrear qual OMD alterou.`)
        }

        if (req.tipo && req.tipo.startsWith('escolha_n_de_m') && req.escolha) {
          const n = req.escolha.n
          const m = (req.escolha.opcoes || []).length
          if (typeof n !== 'number' || n < 1) erro(erros, `${onde}: escolha.n inválido (${n}).`)
          else if (m > 0 && n > m) erro(erros, `${onde}: escolha.n (${n}) maior que o número de opções (${m}).`)
        }
        if (req.tipo === 'escolha_n_de_m_sem_repeticao' && !req.grupo_sem_repeticao) {
          avisos.push(`${onde}: tipo=escolha_n_de_m_sem_repeticao sem grupo_sem_repeticao — recomendado declarar o pool de especialidades já usadas que este item respeita.`)
        }
        if (req.lacuna_schema && !Object.hasOwn(REPRESENTACAO_DAS_LACUNAS, req.lacuna_schema)) {
          erro(erros, `${onde}: lacuna_schema "${req.lacuna_schema}" sem representação suportada no schema (não está em REPRESENTACAO_DAS_LACUNAS) — o banco ainda achataria este requisito.`)
        }
      }
    }

    if (dados.classe_avancada?.classe_regular_ref) {
      const ref = dados.classe_avancada.classe_regular_ref
      const existeAlgumaClasseComEsseId = arquivosClasses.some((a) => a.dados.classe_regular?.id === ref)
      if (!existeAlgumaClasseComEsseId) {
        erro(erros, `${arquivo}: classe_avancada.classe_regular_ref="${ref}" não corresponde a nenhuma classe_regular carregada (dependência inexistente).`)
      }
    }
  }

  return { erros, avisos }
}

export function relatorioCobertura(arquivosClasses) {
  const linhas = []
  const totalGeral = { CONFIRMADO: 0, ALTERADO_POR_OMD: 0, PENDENTE_DE_VALIDACAO: 0 }
  for (const { arquivo, dados } of arquivosClasses) {
    for (const [tipoClasse, chave] of [['regular', 'classe_regular'], ['avancada', 'classe_avancada']]) {
      const bloco = dados[chave]
      if (!bloco) continue
      const contagem = { CONFIRMADO: 0, ALTERADO_POR_OMD: 0, PENDENTE_DE_VALIDACAO: 0 }
      const lacunas = {}
      for (const { req } of achatarRequisitos(bloco, tipoClasse, arquivo)) {
        const status = req.status || 'CONFIRMADO'
        contagem[status] = (contagem[status] || 0) + 1
        totalGeral[status] = (totalGeral[status] || 0) + 1
        if (req.lacuna_schema) lacunas[req.lacuna_schema] = (lacunas[req.lacuna_schema] || 0) + 1
      }
      const total = contagem.CONFIRMADO + contagem.ALTERADO_POR_OMD + contagem.PENDENTE_DE_VALIDACAO
      linhas.push({ classe: bloco.nome, tipo: tipoClasse, cobertura: bloco.cobertura || (tipoClasse === 'regular' ? 'completa' : '-'), total, ...contagem, lacunas })
    }
  }
  return { linhas, totalGeral }
}

export function formatarTabela(linhas) {
  const cab = ['Classe', 'Tipo', 'Cobertura da fonte', 'Total', 'CONFIRMADO', 'ALTERADO_POR_OMD', 'PENDENTE_DE_VALIDACAO', 'Lacunas de schema encontradas']
  const larguras = cab.map((c) => c.length)
  const linhasFmt = linhas.map((l) => {
    const lacunasTxt = Object.entries(l.lacunas).map(([k, v]) => `${k}=${v}`).join(', ') || '—'
    const vals = [l.classe, l.tipo, l.cobertura, String(l.total), String(l.CONFIRMADO), String(l.ALTERADO_POR_OMD), String(l.PENDENTE_DE_VALIDACAO), lacunasTxt]
    vals.forEach((v, i) => { larguras[i] = Math.max(larguras[i], v.length) })
    return vals
  })
  const linha = (vals) => vals.map((v, i) => v.padEnd(larguras[i])).join('  ')
  const out = [linha(cab), larguras.map((w) => '-'.repeat(w)).join('  ')]
  for (const v of linhasFmt) out.push(linha(v))
  return out.join('\n')
}

// ---------------------------------------------------------------------
// CLI: só roda quando este arquivo é o ponto de entrada (não quando importado
// pelo autoteste).
const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) {
  const dirManifesto = dirname(fileURLToPath(import.meta.url))
  const omds = carregarOmds(dirManifesto)
  const arquivosClasses = carregarClasses(dirManifesto)
  const { erros, avisos } = validarDados({ omds, arquivosClasses })

  console.log('=== Validação do manifesto curricular 2026 ===\n')
  if (erros.length === 0) {
    console.log('OK — nenhuma violação encontrada (fonte/proveniência, IDs, dependências, vigência, status).\n')
  } else {
    console.log(`FALHOU — ${erros.length} violação(ões):\n`)
    for (const e of erros) console.log('  ✗ ' + e)
    console.log('')
  }
  if (avisos.length > 0) {
    console.log(`Avisos (não bloqueiam, só recomendação) — ${avisos.length}:`)
    for (const a of avisos) console.log('  ! ' + a)
    console.log('')
  }

  console.log('=== Relatório de cobertura (Classes Regulares e Avançadas pareadas) ===\n')
  const { linhas, totalGeral } = relatorioCobertura(arquivosClasses)
  console.log(formatarTabela(linhas))
  console.log('')
  console.log(`TOTAL GERAL — CONFIRMADO: ${totalGeral.CONFIRMADO}  ALTERADO_POR_OMD: ${totalGeral.ALTERADO_POR_OMD}  PENDENTE_DE_VALIDACAO: ${totalGeral.PENDENTE_DE_VALIDACAO}  (${totalGeral.CONFIRMADO + totalGeral.ALTERADO_POR_OMD + totalGeral.PENDENTE_DE_VALIDACAO} requisitos no manifesto)`)

  console.log('\n=== Lacunas de schema × representação no banco (fase 2.6, migration 38) ===\n')
  const usoPorLacuna = {}
  for (const l of linhas) for (const [k, v] of Object.entries(l.lacunas)) usoPorLacuna[k] = (usoPorLacuna[k] || 0) + v
  for (const [tag, rep] of Object.entries(REPRESENTACAO_DAS_LACUNAS)) {
    console.log(`  ${tag}  (${usoPorLacuna[tag] || 0} requisito(s) no manifesto)`)
    console.log(`    representação: ${rep.mecanismo}`)
    console.log(`    o que resolve: ${rep.resumo}`)
  }
  const semRepresentacao = Object.keys(usoPorLacuna).filter((k) => !Object.hasOwn(REPRESENTACAO_DAS_LACUNAS, k))
  console.log(semRepresentacao.length === 0
    ? '\n  Nenhuma lacuna marcada no manifesto fica sem representação — nada precisa mais ser "achatado".'
    : `\n  SEM REPRESENTAÇÃO: ${semRepresentacao.join(', ')}`)

  process.exit(erros.length === 0 ? 0 : 1)
}
