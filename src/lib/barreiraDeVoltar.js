// Barreira do botão VOLTAR: entrar e trocar de clube abrem uma "etapa" nova de navegação (um id
// aleatório). Cada tela visitada é CARIMBADA no histórico do navegador com o id da etapa em que foi
// aberta. Se o VOLTAR cair numa tela carimbada por uma etapa ANTERIOR (a conta que saiu, o clube de
// antes, o login), a pessoa é mandada para o início — o navegador não deixa apagar o histórico, mas
// deixa marcar cada entrada.
//
// Por que carimbo e não "posição no histórico": um link aberto na mesma aba (convite, inscrição)
// começa uma entrada nova que não é "voltar" — comparar posições mandava esse link para o início.
// Entrada sem carimbo = tela nova, recebe o carimbo da etapa atual e segue normalmente.
const CHAVE = 'cq.etapaNavegacao'

const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export function etapaAtual() {
  try { return sessionStorage.getItem(CHAVE) } catch { return null }
}

export function marcarInicioDaNavegacao() {
  const id = novoId()
  try { sessionStorage.setItem(CHAVE, id) } catch { /* sem storage */ }
  carimbarEntradaAtual(id)
}

export function esquecerInicioDaNavegacao() {
  try { sessionStorage.removeItem(CHAVE) } catch { /* sem storage */ }
}

export function carimbarEntradaAtual(id = etapaAtual()) {
  if (!id) return
  try {
    const st = window.history.state || {}
    if (st.cqEtapa !== id) window.history.replaceState({ ...st, cqEtapa: id }, '')
  } catch { /* fora do navegador */ }
}

// true = esta entrada foi aberta numa etapa anterior (é um VOLTAR para trás do login/troca de clube)
export function voltouAntesDoInicio() {
  const atual = etapaAtual()
  if (!atual) return false
  let carimbo = null
  try { carimbo = window.history.state?.cqEtapa ?? null } catch { /* fora do navegador */ }
  return carimbo != null && carimbo !== atual
}
