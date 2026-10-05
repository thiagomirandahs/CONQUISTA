// Data de HOJE no fuso de Brasília, no formato 'YYYY-MM-DD'.
// Use como FUNÇÃO (nunca guarde numa constante de módulo), senão o valor
// "trava" num dia velho quando o app fica aberto atravessando a meia-noite.
// O banco todo usa America/Sao_Paulo — isto alinha o app ao banco.
export function hojeLocalISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// Um instante (ISO/timestamptz do servidor, em UTC) -> o DIA em Brasília (YYYY-MM-DD). `slice(0, 10)` dá o dia em UTC: depois das 21h
// em Brasília já é "amanhã" lá (auditoria de 05/10/2026: o fim do desafio andava 1 dia a cada edição).
export function dataLocalISO(instante) {
  const d = new Date(instante)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// hoje + n dias, em Brasília
export function hojeMaisDiasLocalISO(n) {
  return dataLocalISO(Date.now() + n * 86400000)
}
