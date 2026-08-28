// Helpers PUROS compartilhados entre os jogos clássicos.
// (Extraídos de Trilha.jsx sem mudar comportamento — mesma função de sempre.)

// Embaralha uma cópia do array (Fisher–Yates). Não mexe no original.
export function embaralhar(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
