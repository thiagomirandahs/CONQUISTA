// Integração nativa (Capacitor) — SÓ roda dentro do app Android empacotado.
// No navegador/PWA (inclusive o iPhone) tudo aqui é ignorado, então o web
// continua exatamente igual. Os imports dos plugins são dinâmicos pra não
// entrar no bundle do web à toa.
import { Capacitor } from '@capacitor/core'

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
export async function iniciarNativo() {
  if (!ehNativo()) return
  // Marca o documento como "app nativo" pra o CSS tirar seleção de texto, realce
  // de toque e o efeito de esticar a rolagem — deixa com cara de app, não de site.
  try { document.documentElement.classList.add('app-nativo') } catch { /* ok */ }
  try {
    const [{ SplashScreen }, { StatusBar, Style }, { App }] = await Promise.all([
      import('@capacitor/splash-screen'),
      import('@capacitor/status-bar'),
      import('@capacitor/app'),
    ])

    // Barra de status azul com ícones claros (combina com o app).
    try {
      await StatusBar.setStyle({ style: Style.Dark }) // Dark = ícones CLAROS sobre fundo escuro
      await StatusBar.setBackgroundColor({ color: '#1e3a8a' })
    } catch { /* alguns aparelhos/versões não deixam */ }

    // Botão físico "voltar" do Android: volta na navegação; na tela inicial,
    // minimiza o app (não fecha de vez, comportamento esperado no Android).
    try {
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back()
        else App.minimizeApp()
      })
    } catch { /* ignora */ }

    // Some com o splash assim que a interface já está pronta.
    setTimeout(() => { SplashScreen.hide().catch(() => {}) }, 300)
  } catch { /* rodando no web: sem plugins nativos */ }
}
