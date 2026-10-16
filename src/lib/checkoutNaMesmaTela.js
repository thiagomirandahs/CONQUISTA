// Checkout da InfinitePay na MESMA aba (pedido do dono, 16/10/2026: quase todos pagam pelo celular e aba nova confunde).
// O pagamento em si acontece na página segura da InfinitePay (o app nunca vê dado de cartão); ao terminar, ela volta para o
// redirect_url com ?order_nsu=…&transaction_nsu=…&slug=…, e a tela confirma sozinha.
// No APK o WebView não deve sair do app: lá o link abre no navegador do sistema (comportamento antigo).
import { ehNativo } from './nativo.js'

export const abrirNaMesmaTela = () => !ehNativo()

export function irParaCheckout(url) {
  globalThis.location.assign(url)
}

// Lê e LIMPA os parâmetros de retorno do checkout (para um recarregar não tentar confirmar de novo).
export function lerRetornoDoCheckout() {
  try {
    const u = new URL(globalThis.location.href)
    const order_nsu = u.searchParams.get('order_nsu')
    const transaction_nsu = u.searchParams.get('transaction_nsu')
    if (!order_nsu || !transaction_nsu) return null
    const slug = u.searchParams.get('slug') || u.searchParams.get('invoice_slug')
    for (const k of ['order_nsu', 'transaction_nsu', 'slug', 'invoice_slug', 'capture_method', 'receipt_url']) u.searchParams.delete(k)
    globalThis.history?.replaceState?.(globalThis.history.state, '', u.pathname + (u.search ? u.search : '') + u.hash)
    return { order_nsu, transaction_nsu, slug }
  } catch { return null }
}
