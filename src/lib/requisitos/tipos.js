// Tipo de um requisito PARA EXIBIÇÃO (chip no detalhe da Minha Classe). É heurística de apresentação:
// NUNCA altera, filtra nem reinterpreta o conteúdo oficial do requisito — só ajuda a criança a entender
// "que tipo de coisa é isto". Sem informação suficiente → rótulo neutro "Requisito".
//
// Tabela (a primeira regra que casar vence; `requisito` = item de minha_classe, `formulario` = item de classe_formularios):
//   1. descrição começa com "Decorar"/"Memorizar"                         → MEMORIZACAO
//   2. requisito.tipo ~ "especialidade" ou requisito.especialidade        → ESPECIALIDADE
//   3. formulario.modelo.familia: L*                                      → LEITURA
//                                 A* / E*                                 → ENTREGA   (resposta escrita)
//                                 R*                                      → ATIVIDADE (atividade com relatório)
//                                 V*                                      → PARTICIPACAO (confirmação do responsável)
//   4. sem família: tipo_evidencia 'texto'                                → ENTREGA
//                   tipo_evidencia 'foto' | 'arquivo'                     → PRATICA   (comprovação da prática)
//   5. só há dependência (bloqueios)                                      → DEPENDENCIA
//   6. nada disso                                                         → neutro ("Requisito", tipo null)
// Além do tipo principal, requisito com `bloqueios` ganha também o chip "Dependência".

export const TIPOS = Object.freeze({
  LEITURA: 'LEITURA',
  ATIVIDADE: 'ATIVIDADE',
  ENTREGA: 'ENTREGA',
  PRATICA: 'PRATICA',
  PARTICIPACAO: 'PARTICIPACAO',
  MEMORIZACAO: 'MEMORIZACAO',
  ESPECIALIDADE: 'ESPECIALIDADE',
  DEPENDENCIA: 'DEPENDENCIA',
})

export const ROTULOS = Object.freeze({
  LEITURA: 'Leitura',
  ATIVIDADE: 'Atividade',
  ENTREGA: 'Entrega',
  PRATICA: 'Prática',
  PARTICIPACAO: 'Participação',
  MEMORIZACAO: 'Memorização',
  ESPECIALIDADE: 'Especialidade',
  DEPENDENCIA: 'Dependência',
})
export const ROTULO_NEUTRO = 'Requisito'

const FAMILIA = [
  [/^L/i, TIPOS.LEITURA],
  [/^(A|E)/i, TIPOS.ENTREGA],
  [/^R/i, TIPOS.ATIVIDADE],
  [/^V/i, TIPOS.PARTICIPACAO],
]

function tipoPrincipal(requisito, formulario) {
  const descricao = String(requisito?.descricao || '').trim()
  if (/^(decorar|memorizar)\b/i.test(descricao)) return TIPOS.MEMORIZACAO
  if (/especialidade/i.test(String(requisito?.tipo || '')) || requisito?.especialidade) return TIPOS.ESPECIALIDADE
  const familia = String(formulario?.modelo?.familia || '')
  if (familia) {
    const achou = FAMILIA.find(([re]) => re.test(familia))
    if (achou) return achou[1]
  }
  const ev = requisito?.tipo_evidencia
  if (ev === 'texto') return TIPOS.ENTREGA
  if (ev === 'foto' || ev === 'arquivo') return TIPOS.PRATICA
  return null
}

/**
 * @returns {{ tipo: string|null, rotulo: string, chips: Array<{tipo: string, rotulo: string}> }}
 *   `tipo`/`rotulo` = o principal; `chips` = o que mostrar (principal + "Dependência" quando há bloqueios).
 */
export function tipoDoRequisito({ requisito, formulario = null } = {}) {
  const dependente = (requisito?.bloqueios || []).length > 0
  const principal = tipoPrincipal(requisito, formulario)
  const chips = []
  if (principal) chips.push({ tipo: principal, rotulo: ROTULOS[principal] })
  if (dependente) chips.push({ tipo: TIPOS.DEPENDENCIA, rotulo: ROTULOS.DEPENDENCIA })
  if (principal) return { tipo: principal, rotulo: ROTULOS[principal], chips }
  if (dependente) return { tipo: TIPOS.DEPENDENCIA, rotulo: ROTULOS.DEPENDENCIA, chips }
  return { tipo: null, rotulo: ROTULO_NEUTRO, chips: [{ tipo: null, rotulo: ROTULO_NEUTRO }] }
}

// Formulário cujo único campo "de resposta" é uma confirmação ("marque quando tiver feito"): a tela usa o
// texto "Marcar como feito". Anexos opcionais não contam como resposta.
export function soConfirmacao(schema) {
  const campos = (schema?.campos || []).filter((c) => c.tipo !== 'anexos')
  return campos.length > 0 && campos.every((c) => c.tipo === 'confirmacao')
}
