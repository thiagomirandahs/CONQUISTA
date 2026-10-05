// Camadas abertas (folha, visualizador de story, lightbox, modal): o botão FÍSICO de voltar do Android tem de FECHAR a camada de cima, não navegar
// para a tela de trás com a camada ainda aberta (auditoria de navegação de 05/10/2026). Cada camada registra um "fechador" enquanto está aberta;
// o `backButton` (src/lib/nativo.js) pergunta aqui antes de mexer no histórico.
const pilha = []

export function registrarFechador(fn) {
  const item = { fn }
  pilha.push(item)
  return () => {
    const i = pilha.indexOf(item)
    if (i >= 0) pilha.splice(i, 1)
  }
}

export const temCamadaAberta = () => pilha.length > 0

// Fecha a camada do TOPO (a última aberta). Devolve true se havia uma.
export function fecharCamadaDoTopo() {
  const topo = pilha[pilha.length - 1]
  if (!topo) return false
  try { topo.fn() } catch { /* o fechador nunca derruba o voltar */ }
  return true
}

export function limparCamadas() { pilha.length = 0 }   // só para teste
