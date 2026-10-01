// FILA LOCAL DE ANEXOS (prova de conceito, Fase 9) — NÃO está ligada a nenhuma tela.
// Desenho completo em ANEXOS-OFFLINE-DESENHO.md. Resumo das regras:
//  - o id do item é gerado NO CLIENTE e vira o nome do arquivo no Storage (caminho determinístico):
//    reenviar o mesmo item nunca cria um segundo arquivo (o Storage responde 409 "já existe" = sucesso);
//  - tudo é por USUÁRIO + CLUBE: nenhuma operação devolve ou mexe em item de outra conta/clube;
//  - máquina de estados: enfileirado -> enviando -> enviado | falhou | cancelado
//    (falha de REDE volta a enfileirado com espera crescente; falha de REGRA vai a falhou; "Tentar de novo" reabre);
//  - "enviando" tem lease: se o app morreu no meio, a próxima rodada devolve o item a enfileirado (retomada);
//  - limites de itens e de bytes, e respeito à cota do aparelho (estimate injetável);
//  - arquivo sensível (documento da idade): validade curta, 1 por destino, apagado do aparelho ao enviar;
//  - o item guarda só o necessário: nada de nome original do arquivo, nada de texto livre.
import { ErroFila, ehQuotaExcedida } from './erros.js'
import { sha256Hex } from '../imagens/upload.js'

export const ESTADOS = Object.freeze({
  ENFILEIRADO: 'enfileirado', ENVIANDO: 'enviando', ENVIADO: 'enviado', FALHOU: 'falhou', CANCELADO: 'cancelado',
})
const ATIVOS = [ESTADOS.ENFILEIRADO, ESTADOS.ENVIANDO, ESTADOS.FALHOU] // ocupam espaço e contam nos limites

// Transições permitidas (qualquer outra é ignorada — protege contra corrida e item "ressuscitado").
export const TRANSICOES = Object.freeze({
  [ESTADOS.ENFILEIRADO]: [ESTADOS.ENVIANDO, ESTADOS.CANCELADO],
  [ESTADOS.ENVIANDO]: [ESTADOS.ENVIADO, ESTADOS.ENFILEIRADO, ESTADOS.FALHOU, ESTADOS.CANCELADO],
  [ESTADOS.FALHOU]: [ESTADOS.ENFILEIRADO, ESTADOS.CANCELADO],
  [ESTADOS.ENVIADO]: [],
  [ESTADOS.CANCELADO]: [],
})

const MB = 1024 * 1024
export const LIMITES_PADRAO = Object.freeze({
  maxBytesPorAnexo: 2 * MB,          // depois da compressão (perfil "evidencia" mira ~900 KB; documento ~1,2 MB)
  maxBytesPorConta: 24 * MB,         // por usuário+clube, só itens ativos
  maxBytesTotal: 48 * MB,            // todas as contas do aparelho
  maxItensPorDestino: 8,             // o modelo do requisito pode pedir menos; quem decide é a tela
  maxItensPorConta: 30,
  reservaCotaBytes: 50 * MB,         // espaço livre que o aparelho precisa manter depois de gravar
  validadeMs: 7 * 24 * 3600 * 1000,  // igual aos rascunhos de texto
  validadeSensivelMs: 24 * 3600 * 1000,
  tumuloMs: 60 * 60 * 1000,          // enviado/cancelado: a "lápide" some depois de 1 h (a tela já absorveu)
  leaseMs: 2 * 60 * 1000,            // "enviando" parado além disto = app morreu; volta a enfileirado
  maxTentativas: 6,
  esperaBaseMs: 5000,
  esperaMaxMs: 5 * 60 * 1000,
})

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const SEGURO = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/
const SIMPLES = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/
export const TIPOS_DESTINO = ['rascunho', 'requisito', 'tentativa']

// Pasta no Storage por tipo de arquivo. 'documentos' é a do DocumentoDaIdade; 'requisitos' é a das provas
// (e é a única que a policy "dono apaga requisito órfão" alcança — migration 173).
const PASTA = { comum: 'requisitos', sensivel: 'documentos' }

// Caminho DETERMINÍSTICO (formato antigo <uid>/<pasta>/<id>.<ext>, aceito pelas policies da 87 e pela
// validação _anexos_do_dono_erros da 510). Mesmo item => mesmo caminho, sempre.
export const caminhoDoItem = ({ uid, id, mime, sensivel = false }) => {
  const ext = EXT[mime]
  if (!ext || !SIMPLES.test(String(uid)) || !SEGURO.test(String(id))) throw new ErroFila('ENTRADA', 'Item inválido para gerar o caminho.')
  return `${uid}/${sensivel ? PASTA.sensivel : PASTA.comum}/${id}.${sensivel ? 'jpg' : ext}`
}

// ---- classificação de erro de envio -------------------------------------------------------------
const msgDe = (e) => String(e?.message || e || '')
const statusDe = (e) => Number(e?.statusCode ?? e?.status ?? e?.originalError?.status ?? 0)
export const ehDuplicado = (e) => statusDe(e) === 409 || /already exists|resource already exists|duplicate/i.test(msgDe(e))
export const ehErroDeRede = (e) => {
  if (!e) return false
  if (statusDe(e) === 0 && e.name === 'TypeError' && /fetch|network|load failed/i.test(msgDe(e))) return true
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timeout|timed out|offline/i.test(msgDe(e))
    || [408, 425, 429, 500, 502, 503, 504].includes(statusDe(e))
}
export const ehErroDeSessao = (e) => [401].includes(statusDe(e)) || /jwt expired|invalid jwt|not authenticated/i.test(msgDe(e))
// 'duplicado' | 'rede' | 'sessao' | 'regra'
export function classificarErro(e) {
  if (ehDuplicado(e)) return 'duplicado'
  if (ehErroDeSessao(e)) return 'sessao'
  if (ehErroDeRede(e)) return 'rede'
  return 'regra'
}

// ---- helpers do navegador (opcionais, injetáveis) -----------------------------------------------
export async function estimativaDoNavegador() {
  try {
    const e = await globalThis.navigator?.storage?.estimate?.()
    return e && Number.isFinite(e.quota) ? { usage: e.usage || 0, quota: e.quota } : null
  } catch { return null }
}
// Pede ao navegador para NÃO apagar o storage do app quando faltar espaço. Pode ser negado — a fila segue.
export async function pedirPersistencia() {
  try {
    const s = globalThis.navigator?.storage
    if (!s?.persist) return false
    return (await s.persisted?.()) || (await s.persist())
  } catch { return false }
}

const uuidPadrao = () => globalThis.crypto.randomUUID()

// ---- a fila -------------------------------------------------------------------------------------
export function criarFila({
  armazenamento,
  agora = () => Date.now(),
  uuid = uuidPadrao,
  hash = sha256Hex,
  estimar = estimativaDoNavegador,   // () => Promise<{usage, quota} | null>
  online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  limites = {},
} = {}) {
  if (!armazenamento) throw new ErroFila('ENTRADA', 'armazenamento é obrigatório.')
  const L = { ...LIMITES_PADRAO, ...limites }
  const travas = new Set()          // processamento em andamento por usuário+clube (esta aba)
  const ouvintes = new Set()

  const avisar = () => { for (const f of [...ouvintes]) { try { f() } catch { /* ouvinte não derruba a fila */ } } }
  const donoOk = (m, uid, clube) => !!m && m.uid === uid && m.clube === clube
  const exigirDono = (uid, clube) => {
    if (!uid || !clube || typeof uid !== 'string' || typeof clube !== 'string') throw new ErroFila('ENTRADA', 'uid e clube são obrigatórios.')
  }
  const validadeDe = (m) => (m.sensivel ? L.validadeSensivelMs : L.validadeMs)
  const mesmoDestino = (a, b) => a.tipo === b.tipo && a.alvo === b.alvo && a.ref === b.ref && (a.campo ?? null) === (b.campo ?? null)

  function normalizarDestino(d) {
    if (!d || !TIPOS_DESTINO.includes(d.tipo) || !SIMPLES.test(String(d.alvo || '')) || !SIMPLES.test(String(d.ref || ''))) {
      throw new ErroFila('ENTRADA', 'Destino do anexo inválido.')
    }
    if (d.campo != null && !SIMPLES.test(String(d.campo))) throw new ErroFila('ENTRADA', 'Campo do destino inválido.')
    return { tipo: d.tipo, alvo: String(d.alvo), ref: String(d.ref), campo: d.campo == null ? null : String(d.campo) }
  }

  // Muda o estado de forma ATÔMICA e só por transição permitida. `de` = estado esperado (corrida => null).
  const transitar = (id, de, para, patch = {}, { apagarBlob = false } = {}) => armazenamento.atualizar(id, (m) => {
    if (m.estado !== de || !TRANSICOES[de]?.includes(para)) return null
    return { meta: { ...m, ...patch, estado: para, atualizadoEm: agora() }, apagarBlob }
  })

  // ---- adicionar ----
  async function adicionar({ uid, clube, destino, blob, id = null, sensivel = false, base = null }) {
    exigirDono(uid, clube)
    const dest = normalizarDestino(destino)
    if (!blob || typeof blob.size !== 'number') throw new ErroFila('ENTRADA', 'Arquivo ausente.')
    const mime = String(blob.type || '').toLowerCase()
    if (!EXT[mime]) throw new ErroFila('TIPO', 'Só guardamos foto JPG, PNG ou WebP na fila.')
    if (sensivel && mime !== 'image/jpeg') throw new ErroFila('TIPO', 'Documento sensível entra na fila já convertido em JPEG.')
    if (blob.size <= 0 || blob.size > L.maxBytesPorAnexo) throw new ErroFila('TAMANHO', 'Anexo vazio ou acima do limite da fila.', blob.size)

    const itemId = id == null ? uuid() : String(id)
    if (!SEGURO.test(itemId)) throw new ErroFila('ENTRADA', 'Id do item inválido.')

    // idempotência: o mesmo id devolve o mesmo item (e nunca revela item de outra conta)
    const existente = await armazenamento.obter(itemId)
    if (existente) {
      if (!donoOk(existente, uid, clube)) throw new ErroFila('ID_EM_USO', 'Id já usado.')
      return { id: itemId, duplicado: true, item: existente }
    }

    const todos = await armazenamento.listar()
    const ativos = todos.filter((m) => ATIVOS.includes(m.estado))
    const daConta = ativos.filter((m) => donoOk(m, uid, clube))
    const doDestino = daConta.filter((m) => mesmoDestino(m.destino, dest))
    if (doDestino.length >= (sensivel ? 1 : L.maxItensPorDestino)) throw new ErroFila('LIMITE_ITENS', 'Anexos demais para este item.')
    if (daConta.length >= L.maxItensPorConta) throw new ErroFila('LIMITE_ITENS', 'Anexos demais guardados neste aparelho.')
    const soma = (lista) => lista.reduce((s, m) => s + (m.bytes || 0), 0)
    if (soma(daConta) + blob.size > L.maxBytesPorConta || soma(ativos) + blob.size > L.maxBytesTotal) {
      throw new ErroFila('LIMITE_BYTES', 'A fila de anexos deste aparelho está cheia.')
    }
    const est = await Promise.resolve(estimar?.()).catch(() => null)
    if (est && est.quota - est.usage - blob.size < L.reservaCotaBytes) {
      throw new ErroFila('COTA_BAIXA', 'O aparelho está com pouco espaço livre.', { livre: est.quota - est.usage })
    }

    const t = agora()
    const meta = {
      v: 1, id: itemId, uid, clube, destino: dest, mime, bytes: blob.size, sensivel: !!sensivel,
      caminho: caminhoDoItem({ uid, id: itemId, mime, sensivel }),
      sha256: (await hash(blob).catch(() => null)) || null,
      base: base == null ? null : String(base),         // hash do rascunho do servidor (conflito local x nuvem)
      estado: ESTADOS.ENFILEIRADO, tentativas: 0, erro: null,
      criadoEm: t, atualizadoEm: t, iniciadoEm: null, proximaTentativaEm: 0, enviadoEm: null,
    }
    let gravou
    try { gravou = await armazenamento.inserir(meta, blob) } catch (e) {
      throw ehQuotaExcedida(e) ? new ErroFila('COTA', 'Sem espaço para gravar o anexo.') : e
    }
    if (!gravou) { // corrida: outra execução inseriu o mesmo id agora
      const ja = await armazenamento.obter(itemId)
      if (!donoOk(ja, uid, clube)) throw new ErroFila('ID_EM_USO', 'Id já usado.')
      return { id: itemId, duplicado: true, item: ja }
    }
    avisar()
    return { id: itemId, duplicado: false, item: meta }
  }

  // ---- consulta (SEMPRE filtrada por dono) ----
  async function listar({ uid, clube, destino = null, estados = null }) {
    exigirDono(uid, clube)
    const d = destino ? normalizarDestino(destino) : null
    return (await armazenamento.listar())
      .filter((m) => donoOk(m, uid, clube) && (!d || mesmoDestino(m.destino, d)) && (!estados || estados.includes(m.estado)))
      .sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id))
  }

  async function resumo({ uid, clube }) {
    const itens = await listar({ uid, clube })
    const conta = (e) => itens.filter((m) => m.estado === e).length
    return {
      pendentes: conta(ESTADOS.ENFILEIRADO) + conta(ESTADOS.ENVIANDO), falhas: conta(ESTADOS.FALHOU), enviados: conta(ESTADOS.ENVIADO),
      bytes: itens.filter((m) => ATIVOS.includes(m.estado)).reduce((s, m) => s + m.bytes, 0),
    }
  }

  async function obterBlob({ uid, clube, id }) {
    exigirDono(uid, clube)
    const m = await armazenamento.obter(id)
    return donoOk(m, uid, clube) ? armazenamento.lerBlob(id) : null
  }

  // ---- ações do usuário ----
  async function tentarDeNovo({ uid, clube, id }) {
    exigirDono(uid, clube)
    const m = await armazenamento.obter(id)
    if (!donoOk(m, uid, clube)) return false
    const r = await transitar(id, ESTADOS.FALHOU, ESTADOS.ENFILEIRADO, { tentativas: 0, erro: null, proximaTentativaEm: 0 })
    if (r) avisar()
    return !!r
  }

  async function cancelar({ uid, clube, id }) {
    exigirDono(uid, clube)
    const m = await armazenamento.obter(id)
    if (!donoOk(m, uid, clube) || !TRANSICOES[m.estado]?.includes(ESTADOS.CANCELADO)) return false
    const r = await transitar(id, m.estado, ESTADOS.CANCELADO, { erro: { codigo: 'CANCELADO' } }, { apagarBlob: true })
    if (r) avisar()
    return !!r
  }

  // A tela já trocou o "pendente" pelo caminho final no rascunho: a lápide do item enviado pode sair.
  async function confirmar({ uid, clube, id }) {
    exigirDono(uid, clube)
    const m = await armazenamento.obter(id)
    if (!donoOk(m, uid, clube) || ![ESTADOS.ENVIADO, ESTADOS.CANCELADO].includes(m.estado)) return false
    await armazenamento.apagar(id)
    avisar()
    return true
  }

  // ---- envio (retomada incluída) ----
  // enviar({ id, caminho, blob, mime, destino, uid, clube }) -> faz o upload (upsert:false) e resolve; erros classificados acima.
  async function processar({ uid, clube, enviar, verificar = true }) {
    exigirDono(uid, clube)
    if (typeof enviar !== 'function') throw new ErroFila('ENTRADA', 'enviar é obrigatório.')
    const chave = `${uid}:${clube}`
    if (travas.has(chave)) return { pulado: 'ocupado', enviados: 0, falhas: 0, pendentes: 0 }
    if (!online()) return { pulado: 'offline', enviados: 0, falhas: 0, pendentes: (await resumo({ uid, clube })).pendentes }
    travas.add(chave)
    const out = { pulado: null, enviados: 0, falhas: 0, pendentes: 0, parou: null }
    try {
      // retomada: "enviando" com lease vencido = o app morreu no meio do envio
      for (const m of await listar({ uid, clube, estados: [ESTADOS.ENVIANDO] })) {
        if (agora() - (m.iniciadoEm || 0) >= L.leaseMs) await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.ENFILEIRADO, { iniciadoEm: null })
      }
      const fila = (await listar({ uid, clube, estados: [ESTADOS.ENFILEIRADO] })).filter((m) => (m.proximaTentativaEm || 0) <= agora())
      for (const cand of fila) {
        const t0 = agora()
        const m = await transitar(cand.id, ESTADOS.ENFILEIRADO, ESTADOS.ENVIANDO, { iniciadoEm: t0, tentativas: cand.tentativas + 1 })
        if (!m) continue // outra execução pegou
        avisar()
        const blob = await armazenamento.lerBlob(m.id)
        if (!blob) { await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.FALHOU, { erro: { codigo: 'ARQUIVO_PERDIDO' } }); out.falhas++; continue }
        if (verificar && m.sha256) {
          const h = await hash(blob).catch(() => null)
          if (h && h !== m.sha256) { await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.FALHOU, { erro: { codigo: 'CORROMPIDO' } }, { apagarBlob: true }); out.falhas++; continue }
        }
        const concluido = () => transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.ENVIADO, { erro: null, enviadoEm: agora(), iniciadoEm: null }, { apagarBlob: true })
        try {
          await enviar({ id: m.id, caminho: m.caminho, blob, mime: m.mime, destino: m.destino, uid, clube })
          await concluido(); out.enviados++
        } catch (e) {
          const tipo = classificarErro(e)
          if (tipo === 'duplicado') { await concluido(); out.enviados++; continue }   // o arquivo já está lá: idempotência
          if (tipo === 'regra') {
            await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.FALHOU, { erro: { codigo: 'REGRA', mensagem: msgDe(e).slice(0, 160) } })
            out.falhas++; continue
          }
          if (tipo === 'sessao') {   // não gasta tentativa: a sessão renova e a próxima rodada envia
            await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.ENFILEIRADO, { tentativas: m.tentativas - 1, iniciadoEm: null, erro: { codigo: 'SESSAO' } })
            out.parou = 'sessao'; break
          }
          // rede: espera crescente; esgotou as tentativas => falhou (a pessoa decide "Tentar de novo")
          if (m.tentativas >= L.maxTentativas) {
            await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.FALHOU, { erro: { codigo: 'REDE_ESGOTOU' }, iniciadoEm: null })
            out.falhas++
          } else {
            const espera = Math.min(L.esperaMaxMs, L.esperaBaseMs * 2 ** (m.tentativas - 1))
            await transitar(m.id, ESTADOS.ENVIANDO, ESTADOS.ENFILEIRADO, { iniciadoEm: null, erro: { codigo: 'REDE' }, proximaTentativaEm: agora() + espera })
          }
          out.parou = 'rede'; break    // sem rede, os demais também falhariam
        }
      }
      out.pendentes = (await resumo({ uid, clube })).pendentes
      return out
    } finally {
      travas.delete(chave)
      avisar()
    }
  }

  // ---- limpeza ----
  // Manutenção do aparelho inteiro (todas as contas; devolve só contagens). Chamar ao abrir o app.
  async function limpar() {
    const t = agora()
    const out = { expirados: 0, removidos: 0, bytesLiberados: 0 }
    for (const m of await armazenamento.listar()) {
      if (ATIVOS.includes(m.estado) && t - m.criadoEm >= validadeDe(m)) {
        const r = await armazenamento.atualizar(m.id, (x) => (ATIVOS.includes(x.estado)
          ? { meta: { ...x, estado: ESTADOS.CANCELADO, erro: { codigo: 'EXPIRADO' }, atualizadoEm: t }, apagarBlob: true } : null))
        if (r) { out.expirados++; out.bytesLiberados += m.bytes || 0 }
      } else if (!ATIVOS.includes(m.estado) && t - m.atualizadoEm >= L.tumuloMs) {
        await armazenamento.apagar(m.id); out.removidos++
      }
    }
    if (out.expirados || out.removidos) avisar()
    return out
  }

  // Sair da conta / trocar de usuário. soSensiveis=true mantém os anexos comuns da conta (política do dono);
  // false apaga TUDO da conta. Devolve quantos itens saíram. Itens de OUTRAS contas nunca são tocados.
  async function descartarDaConta({ uid, clube = null, soSensiveis = false }) {
    if (!uid) throw new ErroFila('ENTRADA', 'uid é obrigatório.')
    let n = 0
    for (const m of await armazenamento.listar()) {
      if (m.uid !== uid || (clube && m.clube !== clube) || (soSensiveis && !m.sensivel)) continue
      await armazenamento.apagar(m.id); n++
    }
    if (n) avisar()
    return n
  }
  async function descartarTudo() { await armazenamento.limparTudo(); avisar() }

  function observar(f) { ouvintes.add(f); return () => ouvintes.delete(f) }

  return { adicionar, listar, resumo, obterBlob, tentarDeNovo, cancelar, confirmar, processar, limpar, descartarDaConta, descartarTudo, observar, limites: L }
}
