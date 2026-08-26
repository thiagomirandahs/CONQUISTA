// Nível derivado dos pontos totais da temporada. Os limiares (thresholds)
// abaixo têm que bater com a função SQL public.meu_nivel() no banco — se
// mudar aqui, muda lá também (supabase/2026-08-24-avatar.sql).
export const LIMIARES_NIVEL = [
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200,
]
const PASSO_APOS_15 = 2000

function pisoNivel(nivel) {
  if (nivel <= LIMIARES_NIVEL.length) return LIMIARES_NIVEL[nivel - 1]
  const extra = nivel - LIMIARES_NIVEL.length
  return LIMIARES_NIVEL[LIMIARES_NIVEL.length - 1] + extra * PASSO_APOS_15
}

// { nivel, pisoAtual, proximoPiso, faltam, progresso(0-1) }
export function calcularNivel(totalPontos) {
  const pontos = Math.max(0, totalPontos || 0)
  let nivel = 1
  while (pisoNivel(nivel + 1) <= pontos) nivel++
  const pisoAtual = pisoNivel(nivel)
  const proximoPiso = pisoNivel(nivel + 1)
  const faltam = Math.max(0, proximoPiso - pontos)
  const progresso = proximoPiso > pisoAtual ? (pontos - pisoAtual) / (proximoPiso - pisoAtual) : 1
  return { nivel, pisoAtual, proximoPiso, faltam, progresso: Math.min(1, Math.max(0, progresso)) }
}
