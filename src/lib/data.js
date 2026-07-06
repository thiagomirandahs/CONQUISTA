// Data de HOJE no fuso de Brasília, no formato 'YYYY-MM-DD'.
// Use como FUNÇÃO (nunca guarde numa constante de módulo), senão o valor
// "trava" num dia velho quando o app fica aberto atravessando a meia-noite.
// O banco todo usa America/Sao_Paulo — isto alinha o app ao banco.
export function hojeLocalISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
