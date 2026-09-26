// Fila offline dos resultados de jogos (pedido do dono: criança não perde ponto quando a rede cai).
//
// Se registrar_recorde / registrar_jogo falhar por REDE, o resultado fica guardado no celular
// (localStorage) e é reenviado depois: ao voltar a internet ('online'), ao abrir/voltar ao app e
// após o login. Regras de segurança:
//  - Chave por USUÁRIO + CLUBE; cada item também carrega uid/clube. Na hora de enviar, só vale o
//    item do usuário logado E do clube em uso na aba — nunca mistura contas (irmãos no mesmo
//    celular) nem manda um resultado para o clube errado. Itens de outra conta são IGNORADOS (não
//    apagados: são pontos do irmão; saem sozinhos pela expiração).
//  - Tamanho máximo por chave e expiração de 7 dias.
//  - Recorde: guarda só o MELHOR por jogo+semana (e só é enviado na mesma semana — senão entraria
//    na semana errada). Jogo com estrelas: só é enviado no MESMO dia (o servidor usa "hoje").
//  - Erro de REGRA do servidor (não de rede) = item descartado; nunca repete para sempre.
//  - Partida expirada: reenvia UMA vez sem partida (o servidor só aceita se exigir_partida='nao').
//  - Idempotência: recorde é "greatest" no servidor (reenviar não soma nada). registrar_jogo tem a
//    trava "já jogou esse jogo hoje" (por usuário+clube+dia+jogo) e a partida é consumida
//    atomicamente — um reenvio de algo que já entrou é recusado por regra e descartado.

export const PREFIXO_FILA = 'conquista:fila-jogos:v1:'
export const MAX_ITENS = 20
export const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000

const chaveDe = (uid, clube) => `${PREFIXO_FILA}${uid}:${clube}`

function armazenamento() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

// Data/semana no fuso do clube (America/Sao_Paulo) — as mesmas contas do servidor.
export function diaSP(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}
export function semanaSP(agora = new Date()) {
  const [a, m, d] = diaSP(agora).split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d))
  const dow = (dt.getUTCDay() + 6) % 7 // segunda = 0
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}

// Falha de REDE (não resposta do servidor): sem conexão ou o fetch nem completou.
export function ehErroDeRede(e) {
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return true } catch { /* ok */ }
  if (!e) return false
  const msg = String(e.message || e || '')
  return e.name === 'TypeError' && /fetch|network|load failed/i.test(msg)
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timeout|timed out/i.test(msg)
}

export const MSG_GUARDADO = 'Sem internet agora — seu resultado ficou guardado e será enviado quando a conexão voltar.'

// O que mostrar na tela quando o envio do recorde falha: a mensagem REAL do servidor
// ("Rápido demais…", "Partida inválida…"); "sem internet" só se for rede de verdade.
export function mensagemDoErroDeJogo(e) {
  if (ehErroDeRede(e)) return 'Não deu pra salvar o recorde (sem internet?).'
  const msg = String(e?.message || '').trim()
  return msg || 'Não deu pra salvar o recorde. Tente de novo.'
}

function ler(st, chave) {
  try {
    const v = JSON.parse(st.getItem(chave) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
function gravar(st, chave, itens) {
  try {
    if (itens.length) st.setItem(chave, JSON.stringify(itens))
    else st.removeItem(chave)
  } catch { /* cheio/bloqueado: segue sem fila */ }
}

// Guarda um resultado. item = { tipo: 'recorde'|'jogo', jogo, valor, partida }
export function enfileirar({ uid, clube, tipo, jogo, valor, partida = null }, agora = new Date()) {
  const st = armazenamento()
  if (!st || !uid || !clube) return false
  const chave = chaveDe(uid, clube)
  const t = agora.getTime()
  let itens = ler(st, chave).filter((i) => i && i.uid === uid && i.clube === clube && t - i.criadoEm < VALIDADE_MS)
  const novo = { id: `${t}-${Math.random().toString(36).slice(2, 8)}`, uid, clube, tipo, jogo, valor, partida,
    criadoEm: t, dia: diaSP(agora), semana: semanaSP(agora) }
  if (tipo === 'recorde') {
    // um por jogo+semana: fica o maior (reenviar vários na mesma partida esbarraria no "rápido demais")
    const ant = itens.find((i) => i.tipo === 'recorde' && i.jogo === jogo && i.semana === novo.semana)
    if (ant && ant.valor >= valor) return true
    itens = itens.filter((i) => i !== ant)
  } else if (itens.some((i) => i.tipo === 'jogo' && i.jogo === jogo && i.dia === novo.dia)) {
    return true // o servidor só aceita 1x por dia por jogo — o primeiro basta
  }
  itens.push(novo)
  gravar(st, chave, itens.slice(-MAX_ITENS))
  return true
}

export function itensDaFila(uid, clube) {
  const st = armazenamento()
  if (!st || !uid || !clube) return []
  return ler(st, chaveDe(uid, clube)).filter((i) => i && i.uid === uid && i.clube === clube)
}

// Tira da memória o que já expirou (de qualquer conta — ninguém perde nada válido).
export function limparExpirados(agora = new Date()) {
  const st = armazenamento()
  if (!st) return
  const t = agora.getTime()
  const chaves = []
  for (let k = 0; k < st.length; k++) { const c = st.key(k); if (c && c.startsWith(PREFIXO_FILA)) chaves.push(c) }
  for (const c of chaves) gravar(st, c, ler(st, c).filter((i) => i && t - i.criadoEm < VALIDADE_MS))
}

const ehPartidaExpirada = (e) => /partida inv[aá]lida|expirada/i.test(String(e?.message || ''))

// Envia a fila do (uid, clube) atual. `enviar(item, partida)` faz a chamada ao servidor e lança o
// erro dele. Rede caiu no meio = para e mantém o resto. Devolve { enviados, descartados, restantes }.
export async function enviarFila({ uid, clube, enviar, agora = new Date() }) {
  const st = armazenamento()
  const res = { enviados: 0, descartados: 0, restantes: 0 }
  if (!st || !uid || !clube || typeof enviar !== 'function') return res
  limparExpirados(agora)
  const chave = chaveDe(uid, clube)
  const pendentes = ler(st, chave)
  const manter = []
  let redeCaiu = false
  for (const item of pendentes) {
    if (redeCaiu) { manter.push(item); continue }
    // nunca de outra conta/clube (se aparecer aqui, é lixo: não é deste par)
    if (!item || item.uid !== uid || item.clube !== clube) { res.descartados++; continue }
    // fora da janela certa: entraria na semana/dia errado — descarta
    if ((item.tipo === 'recorde' && item.semana !== semanaSP(agora))
        || (item.tipo === 'jogo' && item.dia !== diaSP(agora))) { res.descartados++; continue }
    try {
      try {
        await enviar(item, item.partida || null)
      } catch (e) {
        if (!ehErroDeRede(e) && item.partida && ehPartidaExpirada(e)) await enviar(item, null)
        else throw e
      }
      res.enviados++
    } catch (e) {
      if (ehErroDeRede(e)) { redeCaiu = true; manter.push(item) }
      else res.descartados++ // regra do servidor: não adianta repetir
    }
  }
  // o jogo pode ter guardado algo novo enquanto enviávamos: junta sem perder nada
  const ids = new Set(pendentes.map((i) => i?.id))
  const novos = ler(st, chave).filter((i) => i && !ids.has(i.id))
  const final = [...manter, ...novos].slice(-MAX_ITENS)
  gravar(st, chave, final)
  res.restantes = final.length
  return res
}
