// URL assinada continua válida após logout/revogação até expirar no Storage.
// Mantém cache curto e rejeita entradas antigas com validade maior que esta política.
export const VALIDADE_URL_PRIVADA_S = 10 * 60
export const MARGEM_REUSO_URL_PRIVADA_MS = 60 * 1000

export function cachePrivadoValido(ate, agora = Date.now()) {
  const restante = ate - agora
  return Number.isFinite(ate) && restante > MARGEM_REUSO_URL_PRIVADA_MS
    && restante <= VALIDADE_URL_PRIVADA_S * 1000
}
