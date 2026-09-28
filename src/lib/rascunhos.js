// Rascunhos locais (modo manutenção, migration 400; mesma ideia da fila de jogos em services/filaJogos.js).
//
// O que a pessoa digitou num formulário fica guardado NESTE aparelho enquanto ela digita. Se o envio
// falhar (manutenção, rede), nada se perde: ao voltar à tela o texto está lá, e ela só toca em
// enviar de novo. Regras:
//  - chave por USUÁRIO (irmãos no mesmo celular não veem o rascunho um do outro);
//  - só TEXTO (nunca foto/arquivo: não cabe no localStorage e é dado sensível);
//  - expira em 7 dias; apagado quando o envio dá certo;
//  - localStorage pode não existir / estar cheio / bloqueado: tudo em try/catch, o app segue sem rascunho.
import { useCallback, useEffect, useRef, useState } from 'react'

export const PREFIXO_RASCUNHO = 'conquista:rascunho:v1:'
export const VALIDADE_RASCUNHO_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CARACTERES = 8000

function armazenamento() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}
const chaveDe = (uid, nome) => `${PREFIXO_RASCUNHO}${uid}:${nome}`

export function lerRascunho(uid, nome, agora = Date.now()) {
  const st = armazenamento()
  if (!st || !uid || !nome) return null
  try {
    const v = JSON.parse(st.getItem(chaveDe(uid, nome)) || 'null')
    if (!v || typeof v.valor !== 'string' || v.uid !== uid) return null
    if (agora - v.em > VALIDADE_RASCUNHO_MS) { st.removeItem(chaveDe(uid, nome)); return null }
    return v.valor
  } catch { return null }
}

export function salvarRascunho(uid, nome, valor, agora = Date.now()) {
  const st = armazenamento()
  if (!st || !uid || !nome) return false
  try {
    const texto = String(valor ?? '')
    if (!texto.trim()) { st.removeItem(chaveDe(uid, nome)); return true }
    st.setItem(chaveDe(uid, nome), JSON.stringify({ uid, valor: texto.slice(0, MAX_CARACTERES), em: agora }))
    return true
  } catch { return false }
}

export function limparRascunho(uid, nome) {
  const st = armazenamento()
  if (!st || !uid || !nome) return
  try { st.removeItem(chaveDe(uid, nome)) } catch { /* segue */ }
}

// Tira os vencidos (de qualquer conta).
export function limparRascunhosVencidos(agora = Date.now()) {
  const st = armazenamento()
  if (!st) return
  try {
    const chaves = []
    for (let k = 0; k < st.length; k++) { const c = st.key(k); if (c && c.startsWith(PREFIXO_RASCUNHO)) chaves.push(c) }
    for (const c of chaves) {
      try { const v = JSON.parse(st.getItem(c) || 'null'); if (!v || agora - v.em > VALIDADE_RASCUNHO_MS) st.removeItem(c) } catch { st.removeItem(c) }
    }
  } catch { /* segue */ }
}

// useState que se guarda sozinho. `inicial` vale quando não há rascunho. Devolve
// [valor, setValor, descartar, veioDoRascunho] — chame descartar() quando o envio der certo.
export function useRascunho(uid, nome, inicial = '') {
  const [veio] = useState(() => { const r = lerRascunho(uid, nome); return r != null && r !== inicial })
  const [valor, setValor] = useState(() => lerRascunho(uid, nome) ?? inicial)
  const primeira = useRef(true)
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return }
    salvarRascunho(uid, nome, valor) // texto curto: gravar a cada mudança é barato e não perde a última letra
  }, [uid, nome, valor])
  const descartar = useCallback(() => { primeira.current = true; limparRascunho(uid, nome) }, [uid, nome])
  return [valor, setValor, descartar, veio]
}
