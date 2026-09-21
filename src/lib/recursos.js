// Recursos opcionais do clube (club_features). Lógica pura (testável) usada pelo RecursosProvider.

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
