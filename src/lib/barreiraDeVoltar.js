// Barreira do botão VOLTAR: entrar, sair e trocar de clube marcam o "início" da navegação atual.
// O navegador não deixa apagar o histórico, então quem voltar para antes dessa marca (a tela de
// login, as telas da conta anterior, o clube anterior) é mandado de volta para o início — o voltar
// nunca reabre a sessão de outra pessoa nem outro clube.
const CHAVE = 'cq.inicioNavegacao'

const idxAtual = () => {
  try { return Number(window.history.state?.idx ?? 0) } catch { return 0 }
}

export function marcarInicioDaNavegacao() {
  try { sessionStorage.setItem(CHAVE, String(idxAtual())) } catch { /* sem storage */ }
}

export function voltouAntesDoInicio() {
  let marca = null
  try { marca = sessionStorage.getItem(CHAVE) } catch { /* sem storage */ }
  if (marca == null) return false
  return idxAtual() < Number(marca)
}

export function esquecerInicioDaNavegacao() {
  try { sessionStorage.removeItem(CHAVE) } catch { /* sem storage */ }
}
