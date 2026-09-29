import { useCallback, useEffect, useRef, useState } from 'react'
import { Folha, usePopup } from '../ui/index.jsx'
import { TOURS, marcarTourDaAreaVisto, tourDaAreaVisto, tourPermitido } from '../lib/tutorial/tours.js'

// Mini-tour de uma área (Fase 6, item 6): primeiros-passos, classes, rede, gestao (ver src/lib/tutorial/tours.js).
//   · entra na FilaDePopups com a maior prioridade (tour > avisos > próximo evento > devocional);
//   · 1x por usuário + tour neste aparelho (marca "visto" assim que aparece — fechar o app no meio não repete);
//   · `forcar` reabre (Ajuda → "Rever tour") mesmo já visto, sem passar pela fila (foi a pessoa que pediu).
export const PRIORIDADE_DO_TOUR = 100

/**
 * Gatilho do tour de uma área. Devolve `{ aberto, fechar }`.
 * A Rede DBV vai usar este hook quando o gatilho for ligado lá (`useTourDaArea('rede', { uid, papel })`).
 */
export function useTourDaArea(id, { uid, papel, forcar = false } = {}) {
  const elegivelAgora = forcar || (!!uid && tourPermitido(id, papel) && !tourDaAreaVisto(uid, id))
  // "Elegível" fica preso depois da 1ª vez: marcar visto ao aparecer não pode tirar o tour da tela.
  const [elegivel, setElegivel] = useState(elegivelAgora)
  const [fechado, setFechado] = useState(false)
  if (elegivelAgora && !elegivel && !fechado) setElegivel(true)

  const popup = usePopup(`tour:${id}`, { prioridade: PRIORIDADE_DO_TOUR, ativo: !forcar && elegivel && !fechado, umaVezPorSessao: false })
  const aberto = !fechado && elegivel && (forcar || popup.minhaVez)

  useEffect(() => { if (aberto && !forcar) marcarTourDaAreaVisto(uid, id) }, [aberto, forcar, uid, id])

  const { fechar: liberar } = popup
  const fechar = useCallback(() => {
    if (!forcar) marcarTourDaAreaVisto(uid, id)
    setFechado(true)
    liberar()
  }, [forcar, uid, id, liberar])

  return { aberto, fechar }
}

export default function TourDaArea({ id, uid, papel, forcar = false, aoFechar }) {
  const { aberto, fechar } = useTourDaArea(id, { uid, papel, forcar })
  const tour = TOURS[id]
  const [passo, setPasso] = useState(0)
  const titulo = useRef(null)
  const primeiraVez = useRef(true)

  const encerrar = useCallback(() => { fechar(); aoFechar?.() }, [fechar, aoFechar])

  // Foco no título a cada troca de passo (leitor de tela lê o passo novo); o 1º foco é da Folha.
  useEffect(() => {
    if (primeiraVez.current) { primeiraVez.current = false; return }
    titulo.current?.focus()
  }, [passo])

  if (!tour) return null
  const total = tour.passos.length
  const atual = tour.passos[Math.min(passo, total - 1)]
  const ultimo = passo >= total - 1

  return (
    <Folha aberta={aberto} aoFechar={encerrar} titulo={`Tour: ${tour.titulo}`}>
      <div data-testid="tour" data-tour={id}>
        <p className="text-xs font-bold uppercase tracking-wide text-faint" aria-live="polite">Passo {passo + 1} de {total}</p>
        <div className="mt-3 text-4xl" aria-hidden="true">{atual.icone}</div>
        <h3 ref={titulo} tabIndex={-1} className="mt-2 text-xl font-extrabold text-ink outline-none">{atual.titulo}</h3>
        <p className="mt-1 text-[15px] text-muted">{atual.texto}</p>
        <ol className="mt-4 flex justify-center gap-1.5" aria-label="Passos do tour">
          {tour.passos.map((p, i) => (
            <li key={p.titulo} aria-current={i === passo ? 'step' : undefined}
              aria-label={`Passo ${i + 1}: ${p.titulo}`}
              className={`h-2 rounded-full motion-safe:transition-all ${i === passo ? 'w-5 bg-brand' : 'w-2 bg-line'}`} />
          ))}
        </ol>
        <div className="mt-5 flex gap-2">
          {passo > 0 ? (
            <button type="button" onClick={() => setPasso(passo - 1)}
              className="min-h-[48px] flex-1 rounded-2xl border border-line bg-surface text-sm font-bold text-ink active:bg-surface2">
              Voltar
            </button>
          ) : (
            <button type="button" onClick={encerrar}
              className="min-h-[48px] flex-1 rounded-2xl border border-line bg-surface text-sm font-bold text-muted active:bg-surface2">
              Pular
            </button>
          )}
          <button type="button" onClick={() => (ultimo ? encerrar() : setPasso(passo + 1))}
            className="min-h-[48px] flex-1 rounded-2xl bg-[#0b1f4d] text-sm font-extrabold text-white active:opacity-90">
            {ultimo ? 'Concluir' : 'Próximo'}
          </button>
        </div>
        {passo > 0 && !ultimo && (
          <button type="button" onClick={encerrar}
            className="mt-2 min-h-[44px] w-full rounded-2xl text-sm font-bold text-muted active:bg-surface2">
            Pular tour
          </button>
        )}
      </div>
    </Folha>
  )
}
