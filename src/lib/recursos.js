// Recursos opcionais do clube (club_features). Lógica pura (testável) usada pelo modo de compatibilidade do contexto do clube (services/clubes.js).

// O banco ainda não recebeu o SQL do multi-clube (a tabela não existe): o front novo pode ir ANTES do SQL.
export function tabelaAusente(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === 'PGRST205' || code === '42P01' || /could not find the table|does not exist|schema cache/i.test(msg)
}

// { data, error } de `select feature, enabled from club_features` -> { leilao: true, ... }
//  * tabela inexistente = banco antigo, de um clube só, em que o leilão sempre existiu -> ligado (compat);
//  * qualquer OUTRA falha: nenhum recurso (falha fechada, como antes).
export function recursosDaResposta({ data, error }) {
  if (error) return tabelaAusente(error) ? { leilao: true } : {}
  return Object.fromEntries((data || []).map((item) => [item.feature, item.enabled === true]))
}

// Recurso que SÓ a plataforma liga (catálogo `recursos_catalogo.somente_plataforma`). Nasceu com as especialidades (fase 9,
// item 9): o catálogo delas ainda é de teste, e a liderança do clube não pode ligá-las sozinha — antes, qualquer diretoria
// ligava pelo switch de Configurações e expunha o teste às crianças do clube. Para esses, a tela de recursos não mostra switch.
// Campo ausente (banco antes da migration que o cria) = false: o recurso segue como sempre foi. Só o booleano `true` conta,
// porque o PostgREST devolve booleano de verdade; qualquer outra coisa é resposta estranha, não uma decisão da plataforma.
// (A trava de fato é o servidor: `recurso_definir` recusa ligar recurso da plataforma. Aqui é só não oferecer o switch.)
export function somenteDaPlataforma(item) {
  return item?.somente_plataforma === true
}
