// Regras puras do "arrastar e soltar" da árvore da hierarquia (/admin › Hierarquia).
// O servidor (admin_unidade_editar / admin_clube_vincular) continua sendo quem valida de verdade;
// aqui só se decide o que DESTACAR como destino possível e se vale pedir confirmação.
export const NIVEL = { divisao: 1, uniao: 2, campo: 3, regiao: 4, distrito: 5, clube: 7 }
export const RAIZ = 'raiz'
const ALVOS_DE_CLUBE = ['distrito', 'regiao', 'campo']

// alvo = nó de destino ({id, tipo, status}) ou RAIZ. itens = unidades + clubes (com parent_id).
export function podeSoltar(item, alvo, itens) {
  if (!item) return false
  const paiAtual = item.parent_id || RAIZ
  const idAlvo = alvo === RAIZ ? RAIZ : alvo?.id
  if (!idAlvo || idAlvo === item.id || idAlvo === paiAtual) return false
  if (alvo === RAIZ) return true
  if (alvo.status && alvo.status !== 'ativo') return false
  if (item.tipo === 'clube') return ALVOS_DE_CLUBE.includes(alvo.tipo)
  if (alvo.tipo === 'clube' || !(NIVEL[alvo.tipo] < NIVEL[item.tipo])) return false
  // não pode ir para dentro de um descendente de si mesmo
  const pai = new Map(itens.map((x) => [x.id, x.parent_id || null]))
  for (let p = alvo.id, passos = 0; p && passos < 50; p = pai.get(p), passos++) {
    if (p === item.id) return false
  }
  return true
}

export function frasesDoMovimento(item, alvo, rotulo) {
  const destino = alvo === RAIZ ? (item.tipo === 'clube' ? 'sem unidade' : 'o topo da árvore') : `${rotulo[alvo.tipo] || ''} ${alvo.nome}`.trim()
  const aviso = item.tipo === 'clube'
    ? 'Isso muda na hora quem da coordenação enxerga este clube (só números agregados).'
    : 'Tudo que está debaixo dela vai junto.'
  return `Mover ${rotulo[item.tipo] || ''} "${item.nome}" para ${destino}?\n\n${aviso}`
}
