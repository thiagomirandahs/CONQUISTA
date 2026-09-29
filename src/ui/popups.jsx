import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { criarFilaDePopups } from '../lib/filaDePopups.js'

// =============================================================================
//  Fila de popups (fase 6.3): SÓ UM popup modal visível por vez.
//
//  A lógica mora em src/lib/filaDePopups.js (pura, testada sozinha). Aqui fica só o embrulho React:
//  um provider por sessão (`FilaDePopupsProvider`) e dois hooks:
//
//   * `usePopup(id, { prioridade })` — o que um popup usa. Pede a vez ao montar, devolve
//     `{ minhaVez, fechar }`; `fechar()` libera a vez para o próximo e marca "já visto nesta sessão"
//     (sessionStorage), então o mesmo popup não reabre ao navegar de volta.
//   * `usePopups()` — a API crua (`pedir`/`liberar`/`emExibicao`) para casos especiais.
//
//  Uso típico:
//    const { minhaVez, fechar } = usePopup('devocional', { prioridade: 5, ativo: !!devocional })
//    if (!minhaVez) return null
//    return <Folha aberta aoFechar={fechar} titulo="Devocional">…</Folha>
//
//  Fora do provider o hook cai numa fila própria do módulo (testes e telas soltas continuam
//  funcionando, só sem serializar com o resto).
// =============================================================================

const filaPadrao = criarFilaDePopups()
const FilaDePopupsContext = createContext(filaPadrao)

/** Provider da fila; um por sessão, na raiz do app. Aceita `fila` própria (testes). */
export function FilaDePopupsProvider({ children, fila }) {
  const [valor] = useState(() => fila || criarFilaDePopups())
  return <FilaDePopupsContext.Provider value={valor}>{children}</FilaDePopupsContext.Provider>
}

/** `{ pedir(id, prioridade) → Promise, liberar(id), emExibicao }` — só um popup por vez. */
export function usePopups() {
  const fila = useContext(FilaDePopupsContext)
  const [emExibicao, setEmExibicao] = useState(fila.emExibicao())
  useEffect(() => fila.assinar(setEmExibicao), [fila])
  return useMemo(() => ({ pedir: fila.pedir, liberar: fila.liberar, emExibicao }), [fila, emExibicao])
}

// "Já visto nesta sessão" em sessionStorage — guardado com try/catch porque em navegação privada,
// WebView com dados bloqueados ou iframe o acesso pode lançar; aí o popup só perde a memória.
const chaveVisto = (id) => `popup:${id}:visto`
export function popupJaVisto(id) {
  try { return sessionStorage.getItem(chaveVisto(id)) === '1' } catch { return false }
}
export function marcarPopupVisto(id) {
  try { sessionStorage.setItem(chaveVisto(id), '1') } catch { /* sem memória de sessão */ }
}
/** Esquece a marca de "visto" (testes; ou um popup que precisa voltar). */
export function esquecerPopupVisto(id) {
  try { sessionStorage.removeItem(chaveVisto(id)) } catch { /* ignora */ }
}

/**
 * Hook de um popup que entra na fila.
 *
 * @param {string} id  identificador estável do popup ('avisos', 'devocional', 'tour'…)
 * @param {object} [o]
 * @param {number}  [o.prioridade=0]        maior entra antes
 * @param {boolean} [o.ativo=true]          só pede a vez quando há o que mostrar (dado carregado)
 * @param {boolean} [o.umaVezPorSessao=true] depois de `fechar()`, não reabre na mesma sessão
 * @returns {{ minhaVez: boolean, fechar: Function, jaVisto: boolean }}
 */
export function usePopup(id, { prioridade = 0, ativo = true, umaVezPorSessao = true } = {}) {
  const fila = useContext(FilaDePopupsContext)
  const [minhaVez, setMinhaVez] = useState(false)
  const [jaVisto, setJaVisto] = useState(() => umaVezPorSessao && popupJaVisto(id))

  useEffect(() => {
    if (!ativo || jaVisto) return undefined
    let vivo = true
    fila.pedir(id, prioridade).then(() => { if (vivo) setMinhaVez(true) })
    return () => { vivo = false; fila.liberar(id); setMinhaVez(false) } // desmontou = liberou
  }, [fila, id, prioridade, ativo, jaVisto])

  const fechar = useCallback(() => {
    if (umaVezPorSessao) { marcarPopupVisto(id); setJaVisto(true) }
    setMinhaVez(false)
    fila.liberar(id)
  }, [fila, id, umaVezPorSessao])

  return useMemo(() => ({ minhaVez: minhaVez && !jaVisto, fechar, jaVisto }), [minhaVez, jaVisto, fechar])
}
