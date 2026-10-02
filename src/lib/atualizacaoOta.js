// Atualização das telas do APK sem reinstalar (OTA auto-hospedado). Ver android/OTA.md.
//
// O APK leva as telas EMBUTIDAS (abre rápido e sem internet). Ao abrir e ao voltar do segundo
// plano (no máximo 1x a cada 30 min), o app lê https://app.desbravaclube.com.br/ota/versao.json;
// se houver pacote novo e compatível com este APK, baixa, confere o sha256 e deixa marcado para
// a PRÓXIMA abertura (nunca recarrega no meio do uso). Falha de rede = silêncio.
//
// Tudo que fala com o aparelho entra por parâmetro (`deps`) para ser testável; o módulo não
// importa nada nativo de forma estática — no navegador/PWA ele nunca é carregado.

export const URL_MANIFESTO = 'https://app.desbravaclube.com.br/ota/versao.json'
export const INTERVALO_MS = 30 * 60 * 1000

// Compara "1.3.0" / "v1.10.2" numericamente. Retorna <0, 0, >0.
export function compararVersaoNativa(a, b) {
  const partes = (v) => String(v || '0').trim().replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const x = partes(a); const y = partes(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d
  }
  return 0
}

const SHA256 = /^[0-9a-f]{64}$/i

// "1.3.0", "v1.3.8", "1.3.0-ci41" são versões numéricas. "main", "dev", "0" e vazio NÃO dizem nada sobre o APK: um APK montado
// pelo "Run workflow" chegou a sair com versionName "main" e o OTA o tratava como "nativo antigo" para sempre (02/10/2026).
// Versão ilegível não bloqueia: o bloqueio existe só para APK ANTIGO conhecido (ex.: 1.2.x) não receber tela que exige nativo novo.
export const versaoNativaLegivel = (v) => /^v?[1-9]\d*\.\d+/i.test(String(v || '').trim())

// Decisão pura: aplicar ou ignorar o manifesto publicado.
export function decidir({ manifesto, versaoAtual, versaoNativa, pendente }) {
  const m = manifesto
  if (!m || typeof m !== 'object' || !m.versao || !m.url || !m.minimoNativo) return { acao: 'ignorar', motivo: 'manifesto-invalido' }
  if (!SHA256.test(String(m.sha256 || ''))) return { acao: 'ignorar', motivo: 'manifesto-invalido' }
  if (!/^https:\/\//.test(m.url)) return { acao: 'ignorar', motivo: 'manifesto-invalido' }
  if (m.versao === versaoAtual) return { acao: 'ignorar', motivo: 'mesma-versao' }
  if (pendente && m.versao === pendente) return { acao: 'ignorar', motivo: 'ja-baixada' }
  if (versaoNativaLegivel(versaoNativa) && compararVersaoNativa(versaoNativa, m.minimoNativo) < 0) return { acao: 'ignorar', motivo: 'nativo-antigo' }
  return { acao: 'aplicar', motivo: 'versao-nova' }
}

// Cria o verificador. deps: { plugin (CapacitorUpdater), buscarManifesto(url) → objeto,
// versaoAtual, agora() }. Retorna { verificar(forcar?) } → resultado da última decisão.
export function criarAtualizador(deps) {
  const agora = deps.agora || (() => Date.now())
  let ultima = -Infinity
  let pendente = null
  let rodando = null

  async function executar() {
    let manifesto
    try {
      manifesto = await deps.buscarManifesto(URL_MANIFESTO)
    } catch {
      return { acao: 'ignorar', motivo: 'rede' }
    }
    let versaoNativa = '0'
    try { versaoNativa = (await deps.plugin.current())?.native || '0' } catch { /* segue com 0 */ }
    const d = decidir({ manifesto, versaoAtual: deps.versaoAtual, versaoNativa, pendente })
    if (d.acao !== 'aplicar') return d

    // Já baixada numa abertura anterior e ainda não aplicada: NÃO baixa de novo nem rearma nada. Achado de 02/10/2026: o app
    // baixava a MESMA versão a cada abertura e, com a condição "só ao matar o app" sendo rearmada toda vez, a atualização
    // nunca chegava a valer. Aqui só garante que ela continua marcada como a próxima.
    try {
      const lista = await deps.plugin.list?.()
      const existente = (lista?.bundles || []).find((b) => b?.version === manifesto.versao && b?.status === 'pending')
      if (existente) {
        try { await deps.plugin.next({ id: existente.id }) } catch { /* já estava marcada */ }
        pendente = manifesto.versao
        return { acao: 'ignorar', motivo: 'ja-baixada', versao: manifesto.versao }
      }
    } catch { /* sem list(): segue e baixa */ }

    let bundle
    try {
      bundle = await deps.plugin.download({ url: manifesto.url, version: manifesto.versao, checksum: manifesto.sha256.toLowerCase() })
    } catch {
      return { acao: 'ignorar', motivo: 'rede' }
    }
    // Conferência própria além da do plugin: o arquivo baixado tem de ser o publicado.
    if (!bundle || String(bundle.checksum || '').toLowerCase() !== manifesto.sha256.toLowerCase()) {
      try { if (bundle?.id) await deps.plugin.delete({ id: bundle.id }) } catch { /* ok */ }
      return { acao: 'ignorar', motivo: 'sha-errado' }
    }
    try {
      // Marca como a PRÓXIMA: o plugin aplica quando o app vai para o segundo plano ou é fechado e reaberto; nada de set() agora.
      // Sem setMultiDelay: a condição 'kill' era rearmada a cada abertura e travava a troca (ver acima).
      await deps.plugin.next({ id: bundle.id })
    } catch {
      return { acao: 'ignorar', motivo: 'falha-ao-marcar' }
    }
    pendente = manifesto.versao
    return { acao: 'aplicar', motivo: 'versao-nova', versao: manifesto.versao }
  }

  return {
    async verificar() {
      if (rodando) return rodando
      const t = agora()
      if (t - ultima < INTERVALO_MS) return { acao: 'ignorar', motivo: 'intervalo' }
      ultima = t
      rodando = executar().catch(() => ({ acao: 'ignorar', motivo: 'erro' }))
        .then((r) => { try { deps.registrar?.(r) } catch { /* diagnóstico nunca atrapalha */ } return r })
        .finally(() => { rodando = null })
      return rodando
    },
  }
}

// Diagnóstico para a tela de Ajuda: o resultado da última checagem fica no aparelho (localStorage).
const CHAVE_DIAG = 'dbv:ota:ultima'
export function registrarDiagnostico(r, extra = {}) {
  try { globalThis.localStorage?.setItem(CHAVE_DIAG, JSON.stringify({ quando: new Date().toISOString(), acao: r?.acao, motivo: r?.motivo, versao: r?.versao, ...extra })) } catch { /* sem storage */ }
}
export function lerDiagnostico() {
  try { const d = JSON.parse(globalThis.localStorage?.getItem(CHAVE_DIAG) || 'null'); return d && typeof d === 'object' ? d : null } catch { return null }
}

// Liga tudo no aparelho. Chamado por iniciarNativo() (só no APK).
export async function iniciarAtualizacaoOta() {
  try {
    const [{ CapacitorUpdater }, { CapacitorHttp }, { App }] = await Promise.all([
      import('@capgo/capacitor-updater'),
      import('@capacitor/core'),
      import('@capacitor/app'),
    ])
    // Primeiro de tudo: "este pacote abriu bem". Sem isso o plugin volta ao anterior em 10 s.
    await CapacitorUpdater.notifyAppReady().catch(() => {})
    const atualizador = criarAtualizador({
      plugin: CapacitorUpdater,
      registrar: async (r) => {
        let nativo = ''
        try { nativo = (await CapacitorUpdater.current())?.native || '' } catch { /* ok */ }
        registrarDiagnostico(r, { nativo })
      },
      versaoAtual: typeof __OTA_VERSAO__ === 'string' ? __OTA_VERSAO__ : 'dev', // eslint-disable-line no-undef
      // Pedido NATIVO (não passa por CSP/CORS da WebView, que roda em https://localhost)
      buscarManifesto: async (url) => {
        // SEM ?t=…: na Vercel, /ota/versao.json com query cai no rewrite e volta o index.html (visto em 29/09).
        // O no-cache já vem do vercel.json.
        const r = await CapacitorHttp.get({ url, headers: { 'Cache-Control': 'no-cache' }, connectTimeout: 8000, readTimeout: 8000 })
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
        return typeof r.data === 'string' ? JSON.parse(r.data) : r.data
      },
    })
    atualizador.verificar()
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) atualizador.verificar() })
  } catch { /* sem plugin (APK antigo) ou erro: segue com o que tem */ }
}
