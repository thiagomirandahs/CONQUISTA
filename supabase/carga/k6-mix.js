// =====================================================================
// Fase 8 — teste de carga com MIX REALISTA e ramp-up gradual.
//
// O que este arquivo NÃO faz: disparar 3.000 VUs de uma vez e declarar vitória se terminar.
// "3.000 usuários ativos" não é "3.000 requisições": uma pessoa usando o app faz ~1 requisição a
// cada 20–40 s de uso normal, e um pico de push concentra várias aberturas de Home ao mesmo tempo.
// O mix abaixo modela isso.
// =====================================================================
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { SharedArray } from 'k6/data'

const BASE = __ENV.BASE || 'http://host.docker.internal:54321'
const ANON = __ENV.ANON
const usuarios = new SharedArray('usuarios', () => JSON.parse(open(__ENV.USERS || './usuarios.json')))

const t_home = new Trend('op_home', true)
const t_contexto = new Trend('op_contexto', true)
const t_ranking = new Trend('op_ranking', true)
const t_experiencias = new Trend('op_experiencias', true)
const t_chat = new Trend('op_chat', true)
const t_avaliar = new Trend('op_avaliar', true)
const t_troca = new Trend('op_troca_clube', true)
const erros = new Rate('erros')

export const options = {
  scenarios: {
    // ramp-up gradual: 50 -> 200 -> 600 -> 1200 VUs. Cada VU = uma pessoa usando o app.
    uso_normal: {
      executor: 'ramping-vus', startVUs: 10, gracefulRampDown: '10s',
      stages: __ENV.DEGRAU === 'base' ? [
        { duration: '20s', target: 20 },
        { duration: '40s', target: 50 },
        { duration: '40s', target: 100 },
        { duration: '20s', target: 0 },
      ] : __ENV.DEGRAU === 'joelho' ? [
        { duration: '30s', target: 25 },
        { duration: '40s', target: 50 },
        { duration: '40s', target: 100 },
        { duration: '40s', target: 200 },
        { duration: '40s', target: 300 },
        { duration: '20s', target: 0 },
      ] : [
        { duration: '30s', target: 50 },
        { duration: '45s', target: 200 },
        { duration: '45s', target: 600 },
        { duration: '60s', target: 1200 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // critérios definidos ANTES do teste (item 12 do enunciado)
    'http_req_failed': ['rate<0.01'],
    'op_home': ['p(95)<800'],
    'op_contexto': ['p(95)<500'],
  },
}

function h(u) {
  return { headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'x-clube-atual': u.clube, 'Content-Type': 'application/json' } }
}
function chamar(nome, trend, u, rpc, corpo) {
  const r = http.post(`${BASE}/rest/v1/rpc/${rpc}`, JSON.stringify(corpo || {}), h(u))
  trend.add(r.timings.duration)
  const ok = check(r, { [`${nome} 2xx`]: (x) => x.status >= 200 && x.status < 300 })
  erros.add(!ok)
  return r
}

export default function () {
  const u = usuarios[(__VU * 7 + __ITER) % usuarios.length]

  // toda abertura do app: contexto + home. É o caminho quente.
  chamar('contexto', t_contexto, u, 'meu_contexto')
  chamar('home', t_home, u, 'meu_inicio')
  sleep(Math.random() * 2 + 1)

  const dado = Math.random()
  if (dado < 0.30) {
    // ranking: leitura mais pesada do app
    const r = http.get(`${BASE}/rest/v1/pontos?select=usuario_id,pontos&club_id=eq.${u.clube}&limit=500`, h(u))
    t_ranking.add(r.timings.duration); erros.add(r.status >= 300)
  } else if (dado < 0.55) {
    chamar('experiencias', t_experiencias, u, 'experiencias_do_clube', { p_incluir_rascunhos: false })
  } else if (dado < 0.75) {
    // chat: as 50 últimas da conversa geral
    const r = http.get(`${BASE}/rest/v1/chat_mensagens?select=id,texto,created_at&order=created_at.desc&limit=50`, h(u))
    t_chat.add(r.timings.duration); erros.add(r.status >= 300)
  } else if (dado < 0.90 && u.papel !== 'desbravador') {
    chamar('avaliar', t_avaliar, u, 'avaliacoes_pendentes')
  } else {
    // troca de clube: refaz o contexto com outro header (cenário multi-clube)
    const r = http.post(`${BASE}/rest/v1/rpc/meu_contexto`, '{}', h(u))
    t_troca.add(r.timings.duration); erros.add(r.status >= 300)
  }
  sleep(Math.random() * 3 + 2)   // pensa entre 2 e 5 s — é uma pessoa, não um robô
}
