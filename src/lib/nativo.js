// Integração nativa (Capacitor) — SÓ roda dentro do app Android empacotado.
// No navegador/PWA (inclusive o iPhone) tudo aqui é ignorado, então o web
// continua exatamente igual. Os imports dos plugins são dinâmicos pra não
// entrar no bundle do web à toa.
import { Capacitor } from '@capacitor/core'
import { decidirVoltarFisico } from './voltarFisico.js'
import { temCamadaAberta, fecharCamadaDoTopo } from './camadas.js'

export function ehNativo() {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

let _hb = null
// Vibração curta de feedback (só no app; no web não faz nada).
export async function vibrar(intensidade = 'leve') {
  if (!ehNativo()) return
  try {
    if (!_hb) _hb = await import('@capacitor/haptics')
    const { Haptics, ImpactStyle } = _hb
    const style = intensidade === 'forte' ? ImpactStyle.Heavy
      : intensidade === 'media' ? ImpactStyle.Medium : ImpactStyle.Light
    await Haptics.impact({ style })
  } catch { /* aparelho sem vibração / plugin ausente */ }
}

// Chamado uma vez no arranque (main.jsx). Ajusta barra de status, botão voltar
// do Android e esconde o splash quando o app já pintou.
// Ponte com o MainActivity (Android): manda a cor de fundo do tema e se o tema é claro.
export function pintarBarrasDoSistema() {
  try {
    const html = document.documentElement
    const cor = getComputedStyle(html).getPropertyValue('--c-bg').trim() || '#eef2fb'
    const claro = html.getAttribute('data-theme') !== 'dark'
    globalThis.DesbravaBarras?.pintar?.(cor, claro)
  } catch { /* fora do APK */ }
}

export async function iniciarNativo() {
  if (!ehNativo()) return
  // Marca o documento como "app nativo" pra o CSS tirar seleção de texto, realce
  // de toque e o efeito de esticar a rolagem — deixa com cara de app, não de site.
  try { document.documentElement.classList.add('app-nativo') } catch { /* ok */ }
  // Telas novas sem reinstalar (OTA auto-hospedado, android/OTA.md). Não segura o arranque.
  import('./atualizacaoOta.js').then((m) => m.iniciarAtualizacaoOta()).catch(() => {})
  try {
    const [{ SplashScreen }, { StatusBar, Style }, { App }] = await Promise.all([
      import('@capacitor/splash-screen'),
      import('@capacitor/status-bar'),
      import('@capacitor/app'),
    ])

    // Barras do sistema na COR DO TEMA (regra do dono, 29/09): o Android pinta a área da barra de
    // status/navegação com o fundo da tela e escolhe ícones claros/escuros. Sem faixa preta nem azul.
    pintarBarrasDoSistema()
    try { new MutationObserver(pintarBarrasDoSistema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contraste', 'data-rede'] }) } catch { /* ok */ }
    try { await StatusBar.setOverlaysWebView({ overlay: false }) } catch { /* ok */ }
    void Style

    // Botão físico "voltar" do Android: volta na navegação; na tela inicial,
    // minimiza o app (não fecha de vez, comportamento esperado no Android).
    try {
      App.addListener('backButton', ({ canGoBack }) => {
        const acao = decidirVoltarFisico({ caminho: window.location.pathname, temCamada: temCamadaAberta(), canGoBack })
        if (acao === 'fechar-camada') fecharCamadaDoTopo()
        else if (acao === 'voltar') window.history.back()
        else App.minimizeApp()
      })
    } catch { /* ignora */ }

    // Some com o splash assim que a interface já está pronta.
    setTimeout(() => { SplashScreen.hide().catch(() => {}) }, 300)
  } catch { /* rodando no web: sem plugins nativos */ }
}
