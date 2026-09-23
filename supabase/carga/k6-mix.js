// =====================================================================
// Fase 8 / 8.1 — teste de carga com MIX REALISTA e ramp-up gradual.
//
// A fase 8.1 REPRODUZ exatamente este cenário depois das otimizações, para a comparação ser
// válida. O que mudou aqui foi só ACRÉSCIMO, nunca alteração do que já era medido:
//   - p(99) nos limiares (a fase 8 só tinha p95, e é no p99 que a fila aparece primeiro);
//   - operação de ESCRITA no mix (a fase 8 media só leitura — e escrita é o que disputa lock);
//   - leitura de Storage (URL assinada), que também estava de fora;
//   - degraus intermediários (150, 200, 450, 800) para achar o joelho novo com precisão.
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
// fase 8.1: as duas famílias que faltavam medir
const t_escrita = new Trend('op_escrita', true)
const t_storage = new Trend('op_storage', true)
const erros = new Rate('erros')

// ---------------------------------------------------------------------------
// Fase 8.1, item 6: 3.000 usuários CADASTRADOS não são 3.000 concorrentes.
//
// Base de usuários e simultaneidade são grandezas diferentes, e confundi-las é o erro que este
// projeto vem evitando desde a fase 8. Com a taxa MEDIDA de ~0,25 req/s por pessoa em uso
// contínuo, 3.000 cadastrados se traduzem assim:
//
//   uso normal ao longo do dia .... ~10% ativos numa hora de pico -> 300 pessoas -> ~75 req/s
//   PICO DE PUSH (o pior caso) .... 3.000 aparelhos abrindo a Home em ~60 s
//                                   = 50 aberturas/s x 2 chamadas = ~100 req/s
//
// O cenário `pico3000` modela o SEGUNDO, que é o que importa: é o único momento em que a base
// inteira converge. Usa taxa de chegada constante (não VUs): o que se fixa é o RITMO, porque é
// assim que um pico de push se comporta — os aparelhos não esperam a resposta uns dos outros.
// ---------------------------------------------------------------------------
export const options = __ENV.DEGRAU === 'pico3000' ? {
  scenarios: {
    abertura_em_massa: {
      executor: 'constant-arrival-rate',
      rate: 50, timeUnit: '1s', duration: '60s',
      preAllocatedVUs: 300, maxVUs: 1500,
      exec: 'aberturaDePush',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'op_home': ['p(95)<800', 'p(99)<2000'],
    'op_contexto': ['p(95)<500', 'p(99)<1500'],
    // o que realmente importa num pico: o k6 conseguiu MANTER o ritmo de 50 aberturas/s?
    'dropped_iterations': ['count<100'],
  },
} : {
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
      ] : __ENV.DEGRAU === 'fino' ? [
        // fase 8.1: degraus intermediários entre 100 e 300, onde o joelho da fase 8 ficava
        { duration: '30s', target: 100 },
        { duration: '40s', target: 150 },
        { duration: '40s', target: 200 },
        { duration: '40s', target: 300 },
        { duration: '40s', target: 450 },
        { duration: '20s', target: 0 },
      ] : __ENV.DEGRAU === 'alto' ? [
        { duration: '30s', target: 300 },
        { duration: '45s', target: 600 },
        { duration: '45s', target: 800 },
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
    'op_home': ['p(95)<800', 'p(99)<2000'],
    'op_contexto': ['p(95)<500', 'p(99)<1500'],
    // O chat NÃO tinha limiar na fase 8, e com razão: com 4,4 s de p95 medido, qualquer número
    // teria sido inventado para passar. Depois da correção da policy (migration 51) passa a ter.
    'op_chat': ['p(95)<800'],
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
  } else if (dado < 0.94) {
    // troca de clube: refaz o contexto com outro header (cenário multi-clube)
    const r = http.post(`${BASE}/rest/v1/rpc/meu_contexto`, '{}', h(u))
    t_troca.add(r.timings.duration); erros.add(r.status >= 300)
  } else if (dado < 0.98) {
    // ESCRITA (fase 8.1): enviar mensagem no chat geral. É a escrita mais frequente do produto e
    // a que mais disputa lock — leitura sozinha nunca mostra contenção.
    const r = http.post(`${BASE}/rest/v1/rpc/chat_enviar_geral`,
      JSON.stringify({ p_texto: `carga ${__VU}-${__ITER}` }), h(u))
    t_escrita.add(r.timings.duration); erros.add(r.status >= 300)
  } else {
    // STORAGE (fase 8.1): gerar URL assinada de uma imagem privada. Mede o caminho do Storage,
    // que tem serviço próprio e pool próprio — pode saturar antes ou depois da API de dados.
    const r = http.post(`${BASE}/storage/v1/object/sign/imagens/perfis/inexistente.jpg`,
      JSON.stringify({ expiresIn: 60 }), h(u))
    t_storage.add(r.timings.duration)
    // 400/404 é resposta legítima (o objeto não existe): o que se mede aqui é o TEMPO de
    // resposta do serviço sob carga, não o sucesso do download. Só 5xx conta como erro.
    erros.add(r.status >= 500)
  }
  sleep(Math.random() * 3 + 2)   // pensa entre 2 e 5 s — é uma pessoa, não um robô
}


// O caminho exato de quem toca no aviso do celular: contexto + Home, e nada mais. Sem think time,
// porque no pico a pessoa não está navegando — ela acabou de abrir o app.
export function aberturaDePush() {
  const u = usuarios[(__VU * 7 + __ITER) % usuarios.length]
  chamar('contexto', t_contexto, u, 'meu_contexto')
  chamar('home', t_home, u, 'meu_inicio')
}
