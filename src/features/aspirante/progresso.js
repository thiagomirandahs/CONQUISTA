// Progresso da Trilha do Aspirante — guardado neste aparelho (localStorage), por pessoa. Sem servidor: quem confere os
// requisitos do lenço é a liderança; aqui o aspirante só acompanha o próprio estudo.
// Formato: { licoes: { [id]: melhorNota }, lenco: { [indice]: true } }. Qualquer falha de storage => começa vazio.
const chave = (uid) => `dbv:aspirante:${uid || 'anon'}`
const vazio = () => ({ licoes: {}, lenco: {} })

export function lerProgresso(uid) {
  try {
    const bruto = JSON.parse(globalThis.localStorage?.getItem(chave(uid)) || 'null')
    if (!bruto || typeof bruto !== 'object') return vazio()
    return { licoes: ehObj(bruto.licoes) ? bruto.licoes : {}, lenco: ehObj(bruto.lenco) ? bruto.lenco : {} }
  } catch { return vazio() }
}
const ehObj = (x) => x && typeof x === 'object' && !Array.isArray(x)

export function salvarProgresso(uid, p) {
  try { globalThis.localStorage?.setItem(chave(uid), JSON.stringify(p)) } catch { /* sem storage: segue sem salvar */ }
}

// guarda a MELHOR nota da lição (nunca piora)
export function registrarNota(p, licaoId, nota) {
  const atual = Number.isFinite(p.licoes[licaoId]) ? p.licoes[licaoId] : -1
  return { ...p, licoes: { ...p.licoes, [licaoId]: Math.max(atual, nota) } }
}

export const licaoConcluida = (p, licaoId, minimo) => (p.licoes[licaoId] ?? -1) >= minimo

export function alternarLenco(p, indice) {
  const lenco = { ...p.lenco }
  if (lenco[indice]) delete lenco[indice]; else lenco[indice] = true
  return { ...p, lenco }
}
