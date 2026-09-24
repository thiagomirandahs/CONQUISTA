// =====================================================================
//  Fase 9, item 10 — RAMPA 50 → 100 → 250 → 500 → 1.000 → 2.000 → 3.000, no STAGING.
//
//  NÃO-VALIDANTE. O staging roda na mesma máquina que o desenvolvimento, o k6 e o Docker. Este
//  teste mede ESTA MÁQUINA — CPU, disco e Docker do Windows —, não o Supabase de produção. O número
//  que sai daqui é diagnóstico (onde e como degrada, o que satura primeiro), nunca promessa de
//  capacidade. O relatório diz isso ao lado de cada número.
//
//  Quatro famílias, rodadas SEPARADAS (FAMILIA=...), porque cada uma satura uma coisa diferente:
//    leitura   contexto + início + (ranking | experiências | chat)      — o caminho quente
//    escrita   mensagem no chat do clube + foto no mural                 — disputa de lock
//    upload    arquivo no Storage (mural)                                — serviço e disco próprios
//    rajada    todos os usuários do degrau abrem o app em 10 s           — o pico de push
//
//  CRITÉRIO DE PARADA — escrito aqui ANTES da primeira execução, e não depois de ver o resultado:
//    C1  taxa de falha (5xx, timeout, sem resposta, ou 4xx inesperado) acima de 5%
//    C2  p95 de todas as operações acima de 3.000 ms
//    C3  p99 de todas as operações acima de 8.000 ms
//  Qualquer um aborta o teste (avaliados sobre o acumulado, depois de 20 s de carência).
//
//  CRITÉRIO DE "AGUENTA" por degrau (mais estrito, é o que se reporta como capacidade observada):
//    falha ≤ 1%  e  p95 ≤ 1.000 ms  e  p99 ≤ 3.000 ms  NAQUELE degrau (medido só no patamar).
//
//  FASE 9.1, item 10 — o MESMO script serve ao staging HOSPEDADO (supabase/carga/CAPACIDADE-HOSPEDADA.md).
//  Sem nenhuma variável nova, tudo continua exatamente como na fase 9. As novas:
//    ALVO=hospedado      só pelo supabase/carga/rampa-hospedada.mjs, que calcula PRODUCAO_BLOQUEADA a
//                        partir do .env de produção. Sem a lista, o script RECUSA; com BASE na lista,
//                        RECUSA. E no modo local (o padrão), BASE fora da máquina também é recusada:
//                        o único caminho para um alvo remoto passa pela guarda.
//    RESFRIAR_S          pausa com 0 usuários entre um degrau e o próximo (padrão 0 = como antes).
//                        No hospedado o degrau seguinte não pode herdar fila do anterior.
//    FAMILIA=piloto      o dia de um membro do piloto: Home (contexto + início) e uma entre ranking,
//                        mural, chat, jogos e a própria mensalidade. Só LEITURA.
//    PULAR               operações da família piloto a não fazer (ex.: membros, se a RPC não existir).
//    SLO_FALHA_PCT / SLO_P95_MS / SLO_P99_MS   o critério de "aguenta" (padrões acima).
//    RESULTADO           onde gravar o JSON bruto do k6 (padrão: /carga/resultado-<família>.json).
// =====================================================================
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate, Counter } from 'k6/metrics'
import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import encoding from 'k6/encoding'

const BASE = __ENV.BASE || 'http://host.docker.internal:55321'
const ANON = __ENV.ANON
const FAMILIA = __ENV.FAMILIA || 'leitura'
const DEGRAUS = (__ENV.DEGRAUS || '50,100,250,500,1000,2000,3000').split(',').map(Number)
const SUBIDA = Number(__ENV.SUBIDA_S || 15)
const PATAMAR = Number(__ENV.PATAMAR_S || 30)
const RESFRIAR = Number(__ENV.RESFRIAR_S || 0)
const DESCIDA = RESFRIAR > 0 ? 5 : 0       // os usuários saem em 5 s antes da pausa
const ALVO = __ENV.ALVO || 'local'
const PULAR = new Set(String(__ENV.PULAR || '').split(',').map((s) => s.trim()).filter(Boolean))
const SLO = { falha: Number(__ENV.SLO_FALHA_PCT || 1), p95: Number(__ENV.SLO_P95_MS || 1000), p99: Number(__ENV.SLO_P99_MS || 3000) }

// ---- GUARDA (init: roda antes de qualquer requisição) ----
const hostDe = (u) => { const m = String(u).match(/^[a-z]+:\/\/\[?([^\]/:?#]+)/i); return m ? m[1].toLowerCase() : '' }
const HOST = hostDe(BASE)
const LOCAIS = ['127.0.0.1', 'localhost', 'host.docker.internal', '::1']
if (ALVO === 'local') {
  if (!LOCAIS.includes(HOST)) throw new Error(`BASE fora da máquina (${HOST}) no modo local. Alvo remoto só por supabase/carga/rampa-hospedada.mjs (ALVO=hospedado), que tem a guarda de produção.`)
} else if (ALVO === 'hospedado') {
  if (!__ENV.PRODUCAO_BLOQUEADA) throw new Error('ALVO=hospedado sem PRODUCAO_BLOQUEADA: rode por supabase/carga/rampa-hospedada.mjs, que a calcula do .env de produção.')
  const bloqueados = __ENV.PRODUCAO_BLOQUEADA.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const ref = (HOST.match(/^([a-z]{20})\.supabase\./) || [])[1]
  if (bloqueados.some((b) => b === HOST || (ref && b === ref))) throw new Error('RECUSADO: BASE é a PRODUÇÃO. Carga só no staging hospedado.')
} else throw new Error(`ALVO desconhecido: ${ALVO} (local | hospedado)`)

const usuarios = new SharedArray('usuarios', () => JSON.parse(open(__ENV.USERS || './usuarios-staging.json')))
const JPEG = open('./pixel.jpg', 'b')
const subDe = (u) => JSON.parse(encoding.b64decode(u.token.split('.')[1], 'rawurl', 's')).sub

// No hospedado os tokens vêm de login de verdade (rampa-hospedada.mjs tokens): têm de ser DESTE projeto
// e durar a rampa inteira — um token que expira no meio vira 401 contado como "falta de capacidade".
if (ALVO === 'hospedado' && !LOCAIS.includes(HOST)) {
  const duracao = DEGRAUS.length * (SUBIDA + PATAMAR + DESCIDA + RESFRIAR) + 60
  const agora = Math.floor(Date.now() / 1000)
  for (let i = 0; i < usuarios.length; i++) {
    const p = JSON.parse(encoding.b64decode(usuarios[i].token.split('.')[1], 'rawurl', 's'))
    if (hostDe(p.iss || '') !== HOST) throw new Error(`token ${i} não é deste projeto (iss de outro host): gere os tokens contra a BASE`)
    if (p.exp < agora + duracao) throw new Error(`token ${i} expira antes do fim da rampa (${duracao} s): gere de novo logo antes de rodar`)
  }
}

const op = new Trend('op', true)
const falha = new Rate('falha')
const reqs = new Counter('reqs')

// O degrau em que o teste ESTÁ agora: 'sN' na subida para N, 'N' no patamar de N, 'rN' no
// resfriamento depois de N. Só o patamar entra na conta de capacidade — a subida mistura dois
// degraus e não diz nada de nenhum.
function degrauAgora() {
  const t = (Date.now() - exec.scenario.startTime) / 1000
  let acc = 0
  for (const d of DEGRAUS) {
    if (t < acc + SUBIDA) return `s${d}`
    acc += SUBIDA
    if (t < acc + PATAMAR) return String(d)
    acc += PATAMAR
    if (RESFRIAR > 0) {
      if (t < acc + DESCIDA + RESFRIAR) return `r${d}`
      acc += DESCIDA + RESFRIAR
    }
  }
  return 'descida'
}

// com RESFRIAR_S = 0 (o padrão) as etapas são exatamente as da fase 9
function resfriar(s) { if (RESFRIAR > 0) { s.push({ duration: `${DESCIDA}s`, target: 0 }); s.push({ duration: `${RESFRIAR}s`, target: 0 }) } }
function etapas() {
  const s = []
  for (const d of DEGRAUS) { s.push({ duration: `${SUBIDA}s`, target: d }); s.push({ duration: `${PATAMAR}s`, target: d }); resfriar(s) }
  s.push({ duration: '10s', target: 0 })
  return s
}
// rajada: "todos os N usuários do degrau abrem o app em 10 s" = N/10 aberturas por segundo
function etapasRajada() {
  const s = []
  for (const d of DEGRAUS) { s.push({ duration: `${SUBIDA}s`, target: Math.max(1, Math.round(d / 10)) }); s.push({ duration: `${PATAMAR}s`, target: Math.max(1, Math.round(d / 10)) }); resfriar(s) }
  return s
}

const limiares = {
  falha: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }],
  op: [
    { threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '20s' },
    { threshold: 'p(99)<8000', abortOnFail: true, delayAbortEval: '20s' },
  ],
}
// submétricas por degrau: o limiar é frouxo de propósito — ele só existe para o k6 guardar as
// estatísticas de cada patamar separadas (é assim que o resumo do k6 quebra por tag)
for (const d of DEGRAUS) {
  limiares[`op{degrau:${d}}`] = ['p(95)<600000']
  limiares[`falha{degrau:${d}}`] = ['rate<=1']
  limiares[`reqs{degrau:${d}}`] = ['count>=0']
}

export const options = {
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  thresholds: limiares,
  scenarios: FAMILIA === 'rajada' ? {
    rajada: { executor: 'ramping-arrival-rate', startRate: 5, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: 3000, stages: etapasRajada(), exec: 'rajada' },
  } : {
    [FAMILIA]: { executor: 'ramping-vus', startVUs: 0, stages: etapas(), gracefulRampDown: '5s', exec: FAMILIA },
  },
}

const cab = (u, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${u.token}`, 'x-clube-atual': u.clube, ...extra })
function medir(nome, r, esperado = (x) => x.status >= 200 && x.status < 300) {
  const tags = { degrau: degrauAgora(), op: nome }
  op.add(r.timings.duration, tags)
  reqs.add(1, tags)
  const ok = esperado(r)
  falha.add(!ok, tags)
  check(r, { [`${nome} ok`]: () => ok })
}
const rpc = (u, nome, corpo = {}) => http.post(`${BASE}/rest/v1/rpc/${nome}`, JSON.stringify(corpo), { headers: cab(u, { 'Content-Type': 'application/json' }), timeout: '30s' })
const quem = () => usuarios[(exec.vu.idInTest * 7 + exec.vu.iterationInScenario) % usuarios.length]

export function leitura() {
  const u = quem()
  medir('contexto', rpc(u, 'meu_contexto'))
  medir('inicio', rpc(u, 'meu_inicio'))
  sleep(Math.random() * 2 + 1)
  const dado = Math.random()
  if (dado < 0.4) medir('ranking', http.get(`${BASE}/rest/v1/pontos?select=usuario_id,pontos&club_id=eq.${u.clube}&limit=500`, { headers: cab(u), timeout: '30s' }))
  else if (dado < 0.7) medir('experiencias', rpc(u, 'experiencias_do_clube', { p_incluir_rascunhos: false }))
  else medir('chat', http.get(`${BASE}/rest/v1/chat_mensagens?select=id,texto,created_at&order=created_at.desc&limit=50`, { headers: cab(u), timeout: '30s' }))
  sleep(Math.random() * 3 + 2)
}

// Só a recusa do LIMITE DE ENVIO conta como resposta esperada (é a defesa funcionando). Qualquer
// outro 400 — recurso desligado, jogo inválido — é falha, e aparece como falha.
const limiteOuOk = (x) => (x.status >= 200 && x.status < 300) || (x.status === 400 && /demais|espere|aguarde|limite/i.test(x.body || ''))

export function escrita() {
  const u = quem()
  // o chat tem limite por pessoa (o red-team mediu ~30 seguidas): 429/erro de limite aqui NÃO é
  // falha de capacidade, é a defesa funcionando — conta como resposta esperada
  medir('chat_enviar', rpc(u, 'chat_enviar_geral', { p_texto: `carga ${exec.vu.idInTest}-${exec.vu.iterationInScenario}` }), limiteOuOk)
  sleep(Math.random() * 2 + 1)
  // a segunda escrita: publicar no mural (gatilho de carimbo do clube + RLS de escrita). Não é
  // partida de jogo porque os clubes do dataset sintético não têm catálogo de jogos — o ensaio de
  // 5 usuários deu 'Jogo inválido' em 100% delas: lacuna do DATASET, não do produto.
  const sub = JSON.parse(encoding.b64decode(u.token.split('.')[1], 'rawurl', 's')).sub
  medir('foto_mural', http.post(`${BASE}/rest/v1/fotos`, JSON.stringify({ url: `mural/${sub}-carga.jpg`, evento: 'Carga', legenda: 'carga-rampa', autor_id: sub }),
    { headers: cab(u, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), timeout: '30s' }))
  sleep(Math.random() * 3 + 2)
}

export function upload() {
  const u = quem()
  const sub = JSON.parse(encoding.b64decode(u.token.split('.')[1], 'rawurl', 's')).sub
  const caminho = `mural/${sub}-carga-${exec.vu.idInTest}-${exec.vu.iterationInScenario}.jpg`
  medir('upload', http.post(`${BASE}/storage/v1/object/imagens/${caminho}`, JPEG,
    { headers: cab(u, { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }), timeout: '30s' }))
  sleep(Math.random() * 4 + 3)
}

export function rajada() {
  const u = quem()
  medir('contexto', rpc(u, 'meu_contexto'))
  medir('inicio', rpc(u, 'meu_inicio'))
}

// FASE 9.1 — o dia de um membro do piloto, só leitura, com as mesmas chamadas que as telas fazem
// (src/services/*): quem abre o app cai na Home e depois vai a UMA tela. As proporções são uma
// estimativa de uso, não medição — o relatório diz isso.
const get = (u, caminho) => http.get(`${BASE}/rest/v1/${caminho}`, { headers: cab(u), timeout: '30s' })
function fazer(nome, pedido, esperado) { if (!PULAR.has(nome)) { const r = pedido(); medir(nome, r, esperado); return r } return null }
export function piloto() {
  const u = quem()
  fazer('contexto', () => rpc(u, 'meu_contexto'))
  fazer('inicio', () => rpc(u, 'meu_inicio'))
  sleep(Math.random() * 2 + 1)
  const dado = Math.random()
  if (dado < 0.30) {                    // ranking (a tela de pouso): placar, unidades e membros do clube da aba
    fazer('ranking', () => rpc(u, 'ranking_totais'))
    fazer('unidades', () => get(u, 'unidades?select=*&order=nome'))
    fazer('membros', () => rpc(u, 'membros_do_clube'))
  } else if (dado < 0.50) {             // mural
    fazer('mural', () => get(u, 'fotos?select=*&order=created_at.desc&limit=300'))
  } else if (dado < 0.70) {             // chat do clube: a conversa geral e as últimas mensagens
    const c = fazer('chat_conversa', () => get(u, 'chat_conversas?select=id&tipo=eq.geral&limit=1'))
    let id = null
    try { id = c && c.status === 200 ? JSON.parse(c.body)[0]?.id : null } catch { id = null }
    if (id) fazer('chat', () => get(u, `chat_mensagens_visiveis?select=id,autor_id,texto,created_at,apagada&conversa_id=eq.${id}&order=created_at.desc&limit=300`))
  } else if (dado < 0.85) {             // jogos
    fazer('jogos_do_dia', () => rpc(u, 'status_jogos_do_dia'))
    fazer('trilha', () => rpc(u, 'meu_progresso_trilha'))
  } else {                              // a própria mensalidade (o aviso de cobrança que todo membro recebe)
    fazer('mensalidade', () => get(u, `mensalidades?select=mes,ano,valor&desbravador_id=eq.${subDe(u)}&status=eq.pendente&order=ano.asc,mes.asc`))
  }
  sleep(Math.random() * 3 + 2)
}

// Um resumo por DEGRAU (só patamar), que é o que o relatório precisa.
export function handleSummary(data) {
  const m = data.metrics
  const linhas = [ALVO === 'hospedado'
    ? `família: ${FAMILIA}   (HOSPEDADO: ${HOST} — um gerador de carga, um IP; SLO: falha ≤ ${SLO.falha}%, p95 ≤ ${SLO.p95} ms, p99 ≤ ${SLO.p99} ms)`
    : `família: ${FAMILIA}   (NÃO-VALIDANTE: mede esta máquina)`,
    'degrau |  reqs | req/s |  p50 ms |  p95 ms |  p99 ms | falha % | aguenta?']
  for (const d of DEGRAUS) {
    const o = m[`op{degrau:${d}}`]; const f = m[`falha{degrau:${d}}`]; const r = m[`reqs{degrau:${d}}`]
    if (!o || !r || !r.values.count) { linhas.push(`${String(d).padStart(6)} |  (não chegou a este degrau)`); continue }
    const v = o.values; const erro = (f?.values.rate || 0) * 100
    const aguenta = erro <= SLO.falha && v['p(95)'] <= SLO.p95 && v['p(99)'] <= SLO.p99
    linhas.push(`${String(d).padStart(6)} | ${String(r.values.count).padStart(5)} | ${(r.values.count / PATAMAR).toFixed(0).padStart(5)} | ${v.med.toFixed(0).padStart(7)} | ${v['p(95)'].toFixed(0).padStart(7)} | ${v['p(99)'].toFixed(0).padStart(7)} | ${erro.toFixed(2).padStart(7)} | ${aguenta ? 'sim' : 'NÃO'}`)
  }
  const parou = data.state?.testRunDurationMs && Object.entries(data.metrics).some(([k, v]) => !k.includes('{') && v.thresholds && Object.values(v.thresholds).some((t) => !t.ok))
  linhas.push(parou ? 'CRITÉRIO DE PARADA ATINGIDO (C1/C2/C3) — o teste abortou antes do fim' : 'terminou a rampa sem atingir o critério de parada')
  // RESULTADO: o hospedado grava com outro nome, para não sobrescrever o bruto da rodada local
  return { stdout: linhas.join('\n') + '\n', [__ENV.RESULTADO || `/carga/resultado-${FAMILIA}.json`]: JSON.stringify(data) }
}
