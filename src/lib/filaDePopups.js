// Fila de popups (fase 6.3): SÓ UM popup modal por vez na sessão.
//
// Hoje quatro coisas podem abrir em cima da tela ao entrar no app (avisos, devocional, próximo
// evento, tour do primeiro acesso) e cada uma decide sozinha — no celular elas se empilham. Esta
// fila é a regra única: cada popup PEDE a vez (`pedir`), espera a promessa resolver, mostra-se, e
// LIBERA (`liberar`) ao fechar; só então o próximo da fila entra. Lógica pura, sem React, para ser
// testada sozinha; o hook `usePopups` (src/ui/popups.jsx) só embrulha isto num contexto.
//
// Regras:
//  * prioridade maior entra antes (empate: ordem de chegada);
//  * pedir de novo com o mesmo id devolve a MESMA promessa (não duplica na fila);
//  * `liberar(id)` de quem não é o atual só tira o pedido da fila (desistiu antes da vez);
//  * `cancelar` (desmontou) é o mesmo que liberar.

export function criarFilaDePopups() {
  let atual = null
  const fila = [] // { id, prioridade, ordem, resolver, promessa }
  let ordem = 0
  const ouvintes = new Set()

  const avisar = () => { for (const f of ouvintes) f(atual) }

  function avancar() {
    if (atual || fila.length === 0) return
    fila.sort((a, b) => (b.prioridade - a.prioridade) || (a.ordem - b.ordem))
    const proximo = fila.shift()
    atual = proximo.id
    proximo.resolver()
    avisar()
  }

  /** Pede a vez. Resolve quando for a vez deste popup. */
  function pedir(id, prioridade = 0) {
    if (!id) throw new Error('filaDePopups: pedir() precisa de um id')
    if (atual === id) return Promise.resolve()
    const existente = fila.find((p) => p.id === id)
    if (existente) return existente.promessa
    let resolver
    const promessa = new Promise((res) => { resolver = res })
    fila.push({ id, prioridade, ordem: ordem++, resolver, promessa })
    avancar()
    return promessa
  }

  /** Libera a vez (fechou) ou desiste de esperar. Chama o próximo. */
  function liberar(id) {
    if (atual === id) {
      atual = null
      avisar()
      avancar()
      return
    }
    const i = fila.findIndex((p) => p.id === id)
    if (i >= 0) fila.splice(i, 1)
  }

  /** Quem está na vez agora (ou null). */
  const emExibicao = () => atual

  /** Tamanho da fila de espera (sem contar o atual). */
  const esperando = () => fila.length

  /** Observa mudanças do popup atual; devolve a função de cancelar. */
  function assinar(f) {
    ouvintes.add(f)
    return () => ouvintes.delete(f)
  }

  return { pedir, liberar, cancelar: liberar, emExibicao, esperando, assinar }
}
