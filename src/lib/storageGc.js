// GC SEGURO do Storage (Fase 9) — LÓGICA PURA de classificação. Sem rede, sem banco, sem Node: só dados.
//
// É o espelho em JavaScript da regra SQL `_storage_gc_fatos` (migration 531). Quem usa:
//   * scripts/storage-gc-dryrun.mjs  — monta o relatório do dry-run (NUNCA apaga) e confere se o SQL e este
//     arquivo concordam (qualquer divergência vira aviso no relatório);
//   * src/lib/storageGc.test.js      — prova as regras (referenciado e recente NUNCA são candidatos...).
//
// Regra de ouro: um arquivo só é CANDIDATO se NADA o referencia, não está em bucket protegido, não está na
// fila de outra rotina, não é recente (carência mínima de 7 dias, que ninguém consegue baixar) e não é de
// clube na lixeira. Na dúvida (bucket desconhecido, sem data), NÃO é candidato.

export const CARENCIA_MINIMA_DIAS = 7

// buckets onde o GC olha: todas as referências deles estão no catálogo SQL (_storage_referencias)
export const BUCKETS_NO_ESCOPO = Object.freeze(['comprovacoes', 'imagens', 'comunidade', 'suporte-anexos'])
// buckets NUNCA candidatos (documento emitido, assinatura e marca pública)
export const BUCKETS_PROTEGIDOS = Object.freeze(['documentos-emitidos', 'assinaturas-desenhadas', 'publico', 'parceiros'])

// o que SERIA removido numa fase futura, autorizada à parte. 'arquivo_sem_linha' só existe no dry-run com listagem.
export const CATEGORIAS_CANDIDATAS = Object.freeze(['orfao', 'clube_expurgado', 'conclusao_anterior_sem_registro', 'arquivo_sem_linha'])

export const ROTULOS = Object.freeze({
  orfao: 'Órfão (nenhuma tabela referencia)',
  clube_expurgado: 'Arquivo de clube expurgado',
  conclusao_anterior_sem_registro: 'Pasta conclusao-anterior sem registro',
  arquivo_sem_linha: 'Arquivo físico sem linha em storage.objects (listagem)',
  referenciado: 'Referenciado (protegido)',
  em_fila_de_remocao: 'Na fila de outra rotina de limpeza',
  protegido_bucket: 'Bucket protegido (documentos, assinaturas, marca)',
  clube_na_lixeira: 'Clube na lixeira (recuperável)',
  recente: 'Recente (dentro da carência)',
  sem_data: 'Sem data de criação (listagem)',
  bucket_fora_do_escopo: 'Bucket fora do escopo do GC',
  sem_linha_referenciado: 'Sem linha em storage.objects, mas referenciado (anomalia)',
})

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE_UUID = new RegExp(`^${UUID}$`, 'i')
const RE_CONCLUSAO_ESTRITA = new RegExp(`^${UUID}/${UUID}/conclusao-anterior/${UUID}\\.(jpg|jpeg|png|webp|heic|heif)$`, 'i')
const RE_CONCLUSAO_PASTA = /^[^/]+\/[^/]+\/conclusao-anterior\//i
const RE_URL_STORAGE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/i
const PASTAS_ESTRUTURAIS = new Set(['requisitos', 'documentos', 'conclusao-anterior', 'perfis', 'unidades', 'mural', 'final', 'missoes', 'atividades', 'experiencias'])

export const ehCandidata = (categoria) => CATEGORIAS_CANDIDATAS.includes(categoria)

export function carenciaEfetiva(dias) {
  const n = Number(dias)
  return Math.max(CARENCIA_MINIMA_DIAS, Number.isFinite(n) ? n : CARENCIA_MINIMA_DIAS)
}

// valor guardado no banco -> 'bucket/caminho' (espelho de public._storage_ref_chave). null = não aponta para o Storage.
export function normalizarReferencia(ref, bucketPadrao = null) {
  const v = typeof ref === 'string' ? ref.trim() : ''
  if (!v) return null
  const m = RE_URL_STORAGE.exec(v)
  if (m) {
    let c = m[1].split('?')[0].split('#')[0]
    try { c = decodeURIComponent(c) } catch { /* mantém como veio */ }
    return c || null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null // URL externa
  if (v.startsWith('/')) return null // rota interna do app
  return bucketPadrao ? `${bucketPadrao}/${v}` : null
}

// Máscara de caminho (espelho de public._storage_gc_mascarar): sem dado pessoal.
export function mascararCaminho(bucket, name) {
  const seg = String(name ?? '').split('/')
  const out = seg.map((s, i) => {
    if (i === seg.length - 1) return `…${(/\.[A-Za-z0-9]{1,5}$/.exec(s) || [''])[0]}`
    if (RE_UUID.test(s)) return `${s.slice(0, 8)}…`
    if (PASTAS_ESTRUTURAIS.has(s)) return s
    return '…'
  })
  return `${bucket ?? '?'}/${out.join('/')}`
}

function idadeDias(f, agora) {
  if (typeof f.idade_dias === 'number') return f.idade_dias
  if (f.idade_dias != null && f.idade_dias !== '' && Number.isFinite(Number(f.idade_dias))) return Number(f.idade_dias)
  if (!f.criado_em) return null
  const t = new Date(f.criado_em).getTime()
  if (!Number.isFinite(t)) return null
  return (agora.getTime() - t) / 86400000
}

// Classifica UM arquivo. Entrada = fatos (os mesmos que o SQL devolve):
//   { bucket, name, bytes, criado_em, idade_dias?, existe_linha?, clube_situacao, referencias, em_fila }
// Saída = { categoria, motivo }. A ORDEM das regras importa e é a mesma do SQL.
export function classificarObjeto(f, { carenciaDias = CARENCIA_MINIMA_DIAS, agora = new Date() } = {}) {
  const carencia = carenciaEfetiva(carenciaDias)
  const semLinha = f.existe_linha === false
  const refs = Number(f.referencias || 0)
  const idade = idadeDias(f, agora)
  let categoria
  if (!BUCKETS_NO_ESCOPO.includes(f.bucket) && !BUCKETS_PROTEGIDOS.includes(f.bucket)) categoria = 'bucket_fora_do_escopo'
  else if (refs > 0) categoria = semLinha ? 'sem_linha_referenciado' : 'referenciado'
  else if (f.em_fila) categoria = 'em_fila_de_remocao'
  else if (BUCKETS_PROTEGIDOS.includes(f.bucket)) categoria = 'protegido_bucket'
  else if (f.clube_situacao === 'excluido') categoria = 'clube_na_lixeira'
  else if (idade == null) categoria = 'sem_data'
  else if (idade < carencia) categoria = 'recente'
  else if (f.clube_situacao === 'expurgado') categoria = 'clube_expurgado'
  else if (f.bucket === 'comprovacoes' && RE_CONCLUSAO_PASTA.test(f.name || '')) categoria = 'conclusao_anterior_sem_registro'
  else categoria = semLinha ? 'arquivo_sem_linha' : 'orfao'
  const motivo = categoria === 'conclusao_anterior_sem_registro'
    ? (RE_CONCLUSAO_ESTRITA.test(f.name || '') ? 'sem_registro' : 'formato_invalido')
    : null
  return { categoria, motivo }
}

// Rede de segurança: aborta se um candidato violar QUALQUER exclusão obrigatória. Não deveria acontecer nunca;
// se acontecer, é bug na classificação — e o relatório não sai (melhor erro do que lista errada).
export function conferirInvariantes(itens, carenciaDias) {
  const carencia = carenciaEfetiva(carenciaDias)
  for (const i of itens) {
    if (!ehCandidata(i.categoria)) continue
    const quebras = []
    if (Number(i.referencias || 0) > 0) quebras.push('referenciado')
    if (i.em_fila) quebras.push('em fila de outra rotina')
    if (BUCKETS_PROTEGIDOS.includes(i.bucket)) quebras.push('bucket protegido')
    if (!BUCKETS_NO_ESCOPO.includes(i.bucket)) quebras.push('bucket fora do escopo')
    if (i.clube_situacao === 'excluido') quebras.push('clube na lixeira')
    if (typeof i.idade === 'number' ? i.idade < carencia : true) quebras.push('recente ou sem data')
    if (quebras.length) throw new Error(`Invariante violada: candidato inválido (${quebras.join(', ')}) em ${mascararCaminho(i.bucket, i.name)}`)
  }
}

// Monta o relatório do dry-run a partir dos fatos. `chaveCurta(bucket, name)` é injetada (md5 no Node).
//   fatos      : objetos de storage.objects (e, se houver, itens da listagem com existe_linha=false)
//   quebradas  : [{ origem, bucket, name }] referências cujo objeto não existe
//   opcoes     : { carenciaDias, agora, incluirCaminhos, amostra, chaveCurta }
export function montarRelatorio({ fatos = [], quebradas = [], listagemUsada = false }, opcoes = {}) {
  const agora = opcoes.agora || new Date()
  const carencia = carenciaEfetiva(opcoes.carenciaDias)
  const amostra = Math.min(Math.max(opcoes.amostra ?? 10, 0), 200)
  const chave = opcoes.chaveCurta || (() => null)
  const avisos = []

  const itens = fatos.map((f) => {
    const { categoria, motivo } = classificarObjeto(f, { carenciaDias: carencia, agora })
    const idade = idadeDias(f, agora)
    return {
      bucket: f.bucket, name: f.name, bytes: Number(f.bytes || 0), criado_em: f.criado_em || null,
      idade: idade == null ? null : Math.round(idade * 100) / 100,
      referencias: Number(f.referencias || 0), em_fila: !!f.em_fila, clube_situacao: f.clube_situacao || null,
      existe_linha: f.existe_linha !== false, categoria, motivo, categoria_sql: f.categoria ?? null,
    }
  })
  conferirInvariantes(itens, carencia)

  // o SQL e este arquivo têm de concordar (as duas implementações da mesma regra)
  const divergentes = itens.filter((i) => {
    if (!i.categoria_sql) return false
    if (i.categoria === i.categoria_sql) return false
    // só a especialização por listagem difere de propósito
    return !(i.categoria === 'arquivo_sem_linha' && i.categoria_sql === 'orfao') && !(i.categoria === 'sem_linha_referenciado' && i.categoria_sql === 'referenciado')
  })
  if (divergentes.length) avisos.push(`DIVERGÊNCIA entre a classificação SQL e a do script em ${divergentes.length} arquivo(s): não confie na lista sem investigar.`)

  const porCategoria = {}
  const porBucket = {}
  for (const i of itens) {
    const c = (porCategoria[i.categoria] ||= { n: 0, bytes: 0 })
    c.n += 1; c.bytes += i.bytes
    const b = (porBucket[i.bucket] ||= { objetos: 0, bytes: 0, candidatos: 0, candidatos_bytes: 0 })
    b.objetos += 1; b.bytes += i.bytes
    if (ehCandidata(i.categoria)) { b.candidatos += 1; b.candidatos_bytes += i.bytes }
  }
  const candidatos = itens.filter((i) => ehCandidata(i.categoria))
  const amostras = {}
  for (const cat of CATEGORIAS_CANDIDATAS) {
    const lista = candidatos.filter((i) => i.categoria === cat).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))).slice(0, amostra)
    if (lista.length) {
      amostras[cat] = lista.map((i) => ({
        chave: chave(i.bucket, i.name),
        caminho: opcoes.incluirCaminhos ? `${i.bucket}/${i.name}` : mascararCaminho(i.bucket, i.name),
        bytes: i.bytes, idade_dias: i.idade, motivo: i.motivo,
      }))
    }
  }
  const quebradasPorOrigem = {}
  for (const q of quebradas) quebradasPorOrigem[q.origem] = (quebradasPorOrigem[q.origem] || 0) + 1
  const semLinhaReferenciados = itens.filter((i) => i.categoria === 'sem_linha_referenciado').length
  if (semLinhaReferenciados) avisos.push(`${semLinhaReferenciados} arquivo(s) existem fisicamente e são referenciados, mas não têm linha em storage.objects: investigar (nunca candidatos).`)
  if (!listagemUsada) avisos.push('Sem listagem da API do Storage: arquivos físicos SEM linha em storage.objects (ex.: de clube expurgado) NÃO foram avaliados.')

  return {
    versao: 1,
    modo: 'dry-run',
    somente_leitura: true,
    nada_foi_apagado: true,
    aplicar: 'nao_implementado: exige autorizacao do dono e uma fase propria',
    gerado_em: agora.toISOString(),
    carencia_dias: carencia,
    caminhos: opcoes.incluirCaminhos ? 'COMPLETOS (arquivo local sensivel: nao compartilhar)' : 'mascarados',
    listagem_da_api_usada: !!listagemUsada,
    totais: { objetos: itens.length, bytes: itens.reduce((s, i) => s + i.bytes, 0) },
    por_categoria: porCategoria,
    por_bucket: porBucket,
    candidatos: { n: candidatos.length, bytes: candidatos.reduce((s, i) => s + i.bytes, 0) },
    referencias_quebradas: { total: quebradas.length, por_origem: quebradasPorOrigem },
    amostras,
    divergencias_sql_js: divergentes.length,
    avisos,
    // lista COMPLETA de candidatos só quando pedido (caminhos completos): é a base para uma futura lista aprovada
    lista_candidatos: opcoes.incluirCaminhos
      ? candidatos.map((i) => ({ bucket: i.bucket, name: i.name, bytes: i.bytes, categoria: i.categoria, idade_dias: i.idade }))
      : undefined,
  }
}

const mb = (b) => `${(Number(b || 0) / 1048576).toFixed(1)} MB`

export function resumoHumano(r) {
  const L = []
  L.push('=== GC do Storage — DRY-RUN (somente leitura; NADA foi apagado) ===')
  L.push(`Gerado em ${r.gerado_em} | carência: ${r.carencia_dias} dias | caminhos ${r.caminhos}`)
  L.push(`Objetos: ${r.totais.objetos} (${mb(r.totais.bytes)})`)
  L.push('')
  L.push('Por categoria:')
  for (const [cat, v] of Object.entries(r.por_categoria).sort((a, b) => b[1].bytes - a[1].bytes)) {
    L.push(`  ${ehCandidata(cat) ? '[candidato]' : '           '} ${cat.padEnd(34)} ${String(v.n).padStart(6)}  ${mb(v.bytes).padStart(10)}`)
  }
  L.push('')
  L.push(`SERIA removido (numa fase futura, se aprovado): ${r.candidatos.n} arquivo(s), ${mb(r.candidatos.bytes)}`)
  L.push('Por bucket (objetos / candidatos):')
  for (const [b, v] of Object.entries(r.por_bucket)) L.push(`  ${b.padEnd(24)} ${String(v.objetos).padStart(6)} / ${String(v.candidatos).padStart(5)}  (${mb(v.candidatos_bytes)})`)
  L.push('')
  L.push(`Referências quebradas (tabela aponta para objeto inexistente): ${r.referencias_quebradas.total}`)
  for (const [o, n] of Object.entries(r.referencias_quebradas.por_origem)) L.push(`  ${o}: ${n}`)
  if (r.avisos.length) { L.push(''); L.push('AVISOS:'); for (const a of r.avisos) L.push(`  - ${a}`) }
  L.push('')
  L.push('--aplicar: NÃO implementado. Apagar exige autorização do dono e uma fase própria.')
  return L.join('\n')
}
