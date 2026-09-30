// Gerador do SQL de ESPECIALIDADES a partir do manifesto validado (fase 7). O manifesto é a fonte de verdade:
// nada do catálogo é editado à mão no banco.
//
//   node supabase/especialidades-manifesto/gerar-importacao.mjs                 # gera gerado/<AREA>.sql (revisão) das áreas reais
//   node supabase/especialidades-manifesto/gerar-importacao.mjs --check         # confere se gerado/ bate com o manifesto (CI)
//   node supabase/especialidades-manifesto/gerar-importacao.mjs --fixture       # gera supabase/tests/_fixture_especialidade_teste.sql (SÓ teste local)
//   node supabase/especialidades-manifesto/gerar-importacao.mjs --migration 520 AA   # copia gerado/AA.sql para uma migration numerada
//
// Modos: "migration" só aceita áreas REAIS; "fixture" só aceita arquivos de teste/ (marcados "teste": true).
// O SQL é determinístico (mesmo manifesto → mesmo arquivo + mesmo sha256), idempotente, e RECUSA reimportar a mesma
// versão com conteúdo diferente (versão publicada é imutável — mudou algo, suba "versao" no manifesto).
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { carregarAreas, carregarTeste, validarEspecialidades, dirManifesto } from './validar.mjs'

const raiz = join(dirManifesto, '..', '..')
export const dirGerado = join(dirManifesto, 'gerado')
export const ARQUIVO_FIXTURE = join(raiz, 'supabase', 'tests', '_fixture_especialidade_teste.sql')

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const md5uuid = (chave) => {
  const h = createHash('md5').update('cq-curriculo-oficial:' + chave).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const json = (o) => `${q(JSON.stringify(o))}::jsonb`

export const identificadorDaVersao = (dados) => (dados.teste ? 'especialidades-teste-local' : `especialidades-${dados.area.toLowerCase()}`)

// Só entram especialidades "publicavel". Devolve o pacote canônico (ordem estável) usado no hash.
export function montarPacote(dados) {
  const especialidades = dados.especialidades.filter((e) => e.estado === 'publicavel').map((e) => ({
    codigo: e.codigo, nome: e.nome, nivel: e.nivel ?? null, fonte_url: e.fonte_url, depende_de_especialidades: e.depende_de_especialidades || [],
    grupos: (e.grupos || []).map((g) => ({ chave: g.chave, rotulo: g.rotulo, minimo: g.minimo })),
    requisitos: e.requisitos.map((r) => ({
      ordem: r.ordem, descricao: r.descricao, tipo_evidencia: r.tipo_evidencia, evidencia_obrigatoria: r.evidencia_obrigatoria ?? false,
      modelo: r.modelo ?? null, grupo: r.grupo ?? null, depende_de: (r.depende_de || []).map(String), prazo_dias: r.prazo_dias ?? null,
      fonte_url: r.fonte_url, status_fonte: r.status_fonte,
    })),
  })).sort((a, b) => a.codigo.localeCompare(b.codigo))
  return { formato: dados.formato, area: dados.area, versao: dados.versao, fonte: dados.fonte, especialidades }
}

// contexto: Map codigo → { ident, versao } das especialidades de OUTROS arquivos (dependência entre áreas).
export function gerarSql(dados, { modo = 'migration', contexto = new Map() } = {}) {
  if (modo === 'migration' && dados.teste) throw new Error('Manifesto de TESTE nunca vira migration.')
  if (modo === 'fixture' && !dados.teste) throw new Error('Fixture só aceita manifesto de teste.')
  const pacote = montarPacote(dados)
  if (!pacote.especialidades.length) return null
  const hash = createHash('sha256').update(JSON.stringify(pacote)).digest('hex')
  const ident = identificadorDaVersao(dados)
  const versao = String(dados.versao)
  const vId = md5uuid(`${ident}:${versao}`)
  const linhas = [
    '-- GERADO por supabase/especialidades-manifesto/gerar-importacao.mjs — NÃO editar à mão.',
    `-- Manifesto: área ${dados.area}, versão ${versao}${dados.teste ? ' (TESTE LOCAL — nunca vai para migration)' : ''}; ${pacote.especialidades.length} especialidade(s); sha256 ${hash}`,
    `-- Fonte: ${dados.fonte.nome} — ${dados.fonte.url} — consultada em ${dados.fonte.consultada_em}${dados.fonte.revisao ? ` (revisão ${dados.fonte.revisao})` : ''} — ${dados.fonte.status}`,
    'do $especialidades$',
    'declare v_existente text;',
    'begin',
    `  select fonte_hash into v_existente from public.curriculum_versions where identificador = ${q(ident)} and versao = ${q(versao)};`,
    '  if found then',
    `    if v_existente is distinct from ${q(hash)} then`,
    `      raise exception 'Especialidades ${ident}: a versão ${versao} já existe com OUTRO conteúdo — publique uma versão nova do manifesto.';`,
    '    end if;',
    `    raise notice 'Especialidades ${ident}: versão ${versao} já importada (mesmo conteúdo).';`,
    '    return;',
    '  end if;',
    '  insert into public.curriculum_versions (id, origem, identificador, versao, vigente_desde, status, fonte_url, fonte_descricao, fonte_hash, fonte_arquivo, importado_em, fonte_detalhes)',
    `  values (${q(vId)}, 'oficial', ${q(ident)}, ${q(versao)}, ${q(dados.fonte.consultada_em)}, 'publicado', ${q(dados.fonte.url)},`,
    `    ${q(`Especialidades — ${dados.area_nome}. Importado do manifesto (supabase/especialidades-manifesto), versão ${versao}.`)},`,
    `    ${q(hash)}, ${q(dados.teste ? 'supabase/especialidades-manifesto/teste' : `supabase/especialidades-manifesto/areas/${dados.area}.json`)}, now(),`,
    `    ${json({ manifesto_versao: dados.versao, area: dados.area, fonte: dados.fonte, teste: !!dados.teste })});`,
  ]
  pacote.especialidades.forEach((e, ei) => {
    const eId = md5uuid(`${ident}:${versao}:${e.codigo}`)
    linhas.push(
      '  insert into public.specialties (id, curriculum_version_id, codigo, nome, categoria, nivel, ordem, fonte_url, fonte_consultada_em, fonte_revisao, status_fonte, manifesto_hash)',
      `  values (${q(eId)}, ${q(vId)}, ${q(e.codigo)}, ${q(e.nome)}, ${q(dados.area_nome)}, ${e.nivel == null ? 'null' : q(String(e.nivel))}, ${(ei + 1) * 10}, ${q(e.fonte_url)}, ${q(dados.fonte.consultada_em)}, ${dados.fonte.revisao ? q(dados.fonte.revisao) : 'null'}, ${q(dados.fonte.status)}, ${q(hash)});`,
    )
    for (const g of e.grupos) {
      linhas.push(`  insert into public.specialty_requirement_groups (id, specialty_id, chave, rotulo, minimo) values (${q(md5uuid(`${ident}:${versao}:${e.codigo}:g:${g.chave}`))}, ${q(eId)}, ${q(g.chave)}, ${q(g.rotulo)}, ${g.minimo});`)
    }
    for (const r of e.requisitos) {
      const dep = r.depende_de.length ? `array[${r.depende_de.map(q).join(', ')}]::text[]` : "'{}'::text[]"
      linhas.push(
        '  insert into public.specialty_requirements (id, specialty_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, ordem, modelo, grupo, depende_de, prazo_dias, fonte_url, status_fonte, manifesto_id)',
        `  values (${q(md5uuid(`${ident}:${versao}:${e.codigo}:r:${r.ordem}`))}, ${q(eId)}, ${q(String(r.ordem))}, ${q(r.descricao)}, ${q(r.tipo_evidencia)}, ${r.evidencia_obrigatoria}, ${r.ordem * 10}, ${r.modelo ? json(r.modelo) : 'null'}, ${r.grupo ? q(r.grupo) : 'null'}, ${dep}, ${r.prazo_dias ?? 'null'}, ${q(r.fonte_url)}, ${q(r.status_fonte)}, ${q(`${e.codigo}.${r.ordem}`)});`,
      )
    }
  })
  // dependências ENTRE especialidades (curriculum_dependencies). O alvo tem que existir: se a área dele ainda não foi importada, a migration PARA com mensagem clara.
  for (const e of pacote.especialidades) {
    for (const dep of e.depende_de_especialidades) {
      const naMesma = pacote.especialidades.find((x) => x.codigo === dep)
      const fora = contexto.get(dep)
      if (!naMesma && !fora) throw new Error(`${e.codigo} depende de ${dep}, que não está neste arquivo nem no contexto de importação.`)
      const idAlvo = naMesma ? md5uuid(`${ident}:${versao}:${dep}`) : md5uuid(`${fora.ident}:${fora.versao}:${dep}`)
      linhas.push(
        `  if not exists (select 1 from public.specialties where id = ${q(idAlvo)}) then raise exception 'Especialidades ${ident}: ${e.codigo} depende de ${dep}, que ainda não foi importada — importe a área dela primeiro.'; end if;`,
        `  insert into public.curriculum_dependencies (alvo_tipo, alvo_id, depende_de_tipo, depende_de_id) values ('specialty', ${q(md5uuid(`${ident}:${versao}:${e.codigo}`))}, 'specialty', ${q(idAlvo)}) on conflict do nothing;`,
      )
    }
  }
  linhas.push('end $especialidades$;', '')
  return { sql: linhas.join('\n'), hash, pacote }
}

export function contextoDe(arquivos, areaAtual) {
  const m = new Map()
  for (const a of arquivos) {
    if (!a.dados || a.dados.area === areaAtual) continue
    for (const e of a.dados.especialidades) if (e.estado === 'publicavel') m.set(e.codigo, { ident: identificadorDaVersao(a.dados), versao: String(a.dados.versao) })
  }
  return m
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const fixture = args.includes('--fixture')
  const iMig = args.indexOf('--migration')
  const todos = [...carregarAreas(), ...carregarTeste()].filter((a) => a.dados)
  const { erros } = validarEspecialidades(todos)
  if (erros.length) { erros.forEach((e) => console.log(`  FAIL ${e}`)); process.exit(1) }

  if (fixture) {
    const t = carregarTeste().filter((a) => a.dados)
    if (!t.length) { console.log('Nenhum manifesto em teste/ — nada a gerar.'); process.exit(0) }
    const saida = t.map((a) => gerarSql(a.dados, { modo: 'fixture' })?.sql).filter(Boolean).join('\n')
    if (check) {
      const atual = existsSync(ARQUIVO_FIXTURE) ? readFileSync(ARQUIVO_FIXTURE, 'utf8') : null
      if (atual === saida) { console.log('  ok   _fixture_especialidade_teste.sql bate com o manifesto de teste'); process.exit(0) }
      console.log('  FAIL _fixture_especialidade_teste.sql ' + (atual === null ? 'não existe' : 'DIVERGE') + ' — regere: npm run especialidades:fixture'); process.exit(1)
    }
    writeFileSync(ARQUIVO_FIXTURE, saida, 'utf8')
    console.log('  gerado supabase/tests/_fixture_especialidade_teste.sql')
    process.exit(0)
  }

  const reais = carregarAreas().filter((a) => a.dados && a.dados.exemplo !== true)
  if (iMig >= 0) {
    const num = args[iMig + 1]; const area = args[iMig + 2]
    const alvo = reais.find((a) => a.dados.area === area)
    if (!/^\d{3}$/.test(num || '') || !alvo) { console.error('Uso: --migration NNN AREA (área real e validada)'); process.exit(1) }
    const g = gerarSql(alvo.dados, { modo: 'migration', contexto: contextoDe(reais, alvo.dados.area) })
    if (!g) { console.error(`Área ${area} sem especialidade "publicavel".`); process.exit(1) }
    const destino = join(raiz, 'supabase', 'migrations', `20260930000${num}_especialidades-${area.toLowerCase()}.sql`)
    if (existsSync(destino)) { console.error('Migration já existe: ' + destino); process.exit(1) }
    writeFileSync(destino, g.sql + "\nnotify pgrst, 'reload schema';\n", 'utf8')
    console.log('  gerado ' + destino)
    process.exit(0)
  }

  let falhas = 0
  let gerados = 0
  for (const a of reais) {
    const g = gerarSql(a.dados, { modo: 'migration', contexto: contextoDe(reais, a.dados.area) })
    if (!g) continue
    gerados++
    const caminho = join(dirGerado, `${a.dados.area}.sql`)
    if (check) {
      const atual = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
      if (atual === g.sql) console.log(`  ok   gerado/${a.dados.area}.sql bate com o manifesto`)
      else { falhas++; console.log(`  FAIL gerado/${a.dados.area}.sql ${atual === null ? 'não existe' : 'DIVERGE'} — regere: npm run especialidades:importacao:gerar`) }
    } else {
      mkdirSync(dirname(caminho), { recursive: true })
      writeFileSync(caminho, g.sql, 'utf8')
      console.log(`  gerado gerado/${a.dados.area}.sql (sha256 ${g.hash})`)
    }
  }
  if (!gerados) console.log('Nenhuma especialidade "publicavel" em áreas reais — nada a gerar (estrutura pronta; conteúdo aguarda fonte aprovada).')
  process.exit(falhas ? 1 : 0)
}

const ehCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (ehCli) main()
