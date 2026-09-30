// Arranque do app (fase 7): marcos de tempo, "existe sessão guardada?" e telemetria SEM dado pessoal.
//
// Por que existe: a auditoria de 30/09 PROVOU o mecanismo do travamento com a biblioteca real, mas não
// pôde provar o que aconteceu no aparelho do dono (nenhum erro chegou ao servidor: quem trava por
// espera não lança exceção). Estes marcos fecham essa lacuna — na próxima abertura lenta, o servidor
// recebe em QUE ETAPA o arranque demorou.
//
// O QUE É GUARDADO/ENVIADO: nome da etapa, tempos em segundos, se havia internet, se é o app instalado.
// O QUE NUNCA: token, e-mail, nome, id de pessoa ou de clube, URL com parâmetro. O user_id e o clube
// são preenchidos pelo SERVIDOR (registrar_erro) a partir do login, nunca pelo cliente.

const CHAVE_PENDENTES = 'cq.boot.pend'
const MAX_PENDENTES = 5

// ---------------------------------------------------------------- marcos (só em memória)
const marcas = []
const agora = () => (typeof performance !== 'undefined' && performance.now ? Math.round(performance.now()) : Date.now())

export function marcar(etapa) {
  if (marcas.length < 40) marcas.push([etapa, agora()])
}
export function marcasDoArranque() { return marcas.map(([e, t]) => ({ etapa: e, ms: t })) }
export function limparMarcas() { marcas.length = 0 }

function msDe(etapa) {
  const m = marcas.find(([e]) => e === etapa)
  return m ? m[1] : null
}
const seg = (ms) => (ms == null ? '?' : (ms / 1000).toFixed(1))

// Em que etapa o arranque estava quando demorou/travou.
export function etapaPresa() {
  // 'pronto*' = o arranque terminou; a etapa que demorou é a última ANTES disso
  const uteis = marcas.filter(([e]) => !e.startsWith('pronto'))
  const ultima = uteis.length ? uteis[uteis.length - 1][0] : 'inicio'
  if (ultima.startsWith('perfil')) return 'perfil'
  if (ultima.startsWith('clube')) return 'clube'
  if (ultima.startsWith('sessao')) return 'sessao'
  return 'inicio'
}

// ---------------------------------------------------------------- sessão guardada (sim/não, nunca o token)
export function existeSessaoGuardada(chave, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const bruto = storage?.getItem(chave)
    if (!bruto) return false
    const s = JSON.parse(bruto)
    // a sessão só serve para recuperar se ainda tem com que renovar
    return !!(s && (s.refresh_token || s?.currentSession?.refresh_token))
  } catch { return false }
}

// ---------------------------------------------------------------- resumo e código (sem dado pessoal)
const faixa = (ms) => (ms < 3000 ? 'ate3s' : ms < 8000 ? 'ate8s' : ms < 20000 ? 'ate20s' : 'mais20s')

export function montarRegistro({ problema, tentativas = 0, online = true, nativo = false } = {}) {
  const total = marcas.length ? marcas[marcas.length - 1][1] : 0
  const presa = etapaPresa()
  const codigo = `BOOT:${presa}:${problema || 'lento'}:${faixa(total)}`.slice(0, 80)
  const contexto = [
    `sessao=${seg(msDe('sessao_resposta') != null && msDe('sessao_inicio') != null ? msDe('sessao_resposta') - msDe('sessao_inicio') : null)}s`,
    `perfil=${seg(msDe('perfil_fim') != null && msDe('perfil_inicio') != null ? msDe('perfil_fim') - msDe('perfil_inicio') : null)}s`,
    `total=${seg(total)}s`,
    `retry=${tentativas}`,
    `online=${online ? 1 : 0}`,
    `app=${nativo ? 1 : 0}`,
  ].join(' ').slice(0, 200)
  return { codigo, contexto, total }
}

// ---------------------------------------------------------------- fila local (sobrevive ao fechar o app)
export function lerPendentes(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const l = JSON.parse(storage?.getItem(CHAVE_PENDENTES) || '[]')
    return Array.isArray(l) ? l.filter((x) => x && typeof x.codigo === 'string') : []
  } catch { return [] }
}

export function guardarPendente(item, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const l = lerPendentes(storage)
    l.push({ codigo: String(item.codigo).slice(0, 80), contexto: String(item.contexto || '').slice(0, 200) })
    storage?.setItem(CHAVE_PENDENTES, JSON.stringify(l.slice(-MAX_PENDENTES)))
  } catch { /* sem storage: a telemetria é opcional */ }
}

// `enviar(item)` deve devolver uma promessa; falhou → o item fica para a próxima vez.
export async function enviarPendentes(enviar, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const fila = lerPendentes(storage)
  if (!fila.length) return 0
  let enviados = 0
  const restantes = []
  for (const item of fila) {
    try { await enviar(item); enviados++ } catch { restantes.push(item) }
  }
  try {
    if (restantes.length) storage?.setItem(CHAVE_PENDENTES, JSON.stringify(restantes))
    else storage?.removeItem(CHAVE_PENDENTES)
  } catch { /* ok */ }
  return enviados
}

// ---------------------------------------------------------------- recomeçar a abertura (com o login guardado)
// Achado da fase 7 (experimento com auth-js 2.108): depois que a abertura falha por REDE, o cliente de login
// fica preso no estado de falha — getSession/refreshSession/setSession devolvem o mesmo erro na hora, sem
// tentar nada, mesmo com a internet de volta (e o relógio interno também não recupera). Só uma instância
// NOVA se recupera — é exatamente o que "fechar e abrir" fazia. Recarregar a página cria a instância nova
// e o login guardado no aparelho continua lá.
//
// `manual` (toque no botão) sempre recarrega. Automático (internet voltou / voltou para o app) recarrega no
// máximo 1x a cada 20 s: um laço de recarga seria pior que o problema.
const CHAVE_RECARGA = 'cq.reload.abertura'
export function recarregarAbertura({ manual = false, agora = Date.now(),
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  recarregar = () => window.location.reload() } = {}) {
  let ultima = 0
  try { ultima = Number(storage?.getItem(CHAVE_RECARGA) || 0) } catch { /* sem storage */ }
  if (!manual && agora - ultima < 20000) return false
  try { storage?.setItem(CHAVE_RECARGA, String(agora)) } catch { /* sem storage */ }
  recarregar()
  return true
}
