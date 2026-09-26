import { useState, useEffect } from 'react'
import { PASSOS_DO_TOUR, tourJaVisto, marcarTourVisto } from '../lib/tutorial/tutorial.js'

// Tour de primeiro acesso: 4 passos (Início, Jornada, Clube, Eu), pulável, uma vez por usuário neste aparelho.
// `forcar` reabre (botão "Ver o tour de novo" em /ajuda) mesmo já visto.
export default function TourPrimeiroAcesso({ uid, forcar = false, aoFechar }) {
  const [aberto, setAberto] = useState(() => forcar || (!!uid && !tourJaVisto(uid)))
  const [passo, setPasso] = useState(0)
  // Marca como VISTO assim que aparece (não só ao tocar em Pular/Concluir): quem fechava o app com o
  // tour aberto via o tour de novo toda vez que abria (relato do dono, 26/09). Agora é 1x por pessoa.
  useEffect(() => { if (aberto && !forcar) marcarTourVisto(uid) }, [aberto, forcar, uid])
  if (!aberto) return null

  const fechar = () => { marcarTourVisto(uid); setAberto(false); aoFechar?.() }
  const atual = PASSOS_DO_TOUR[passo]
  const ultimo = passo === PASSOS_DO_TOUR.length - 1

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" data-testid="tour">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-5 shadow-soft">
        <p className="text-xs font-bold uppercase tracking-wide text-faint">Passo {passo + 1} de {PASSOS_DO_TOUR.length}</p>
        <div className="mt-3 text-4xl" aria-hidden="true">{atual.icone}</div>
        <h2 id="tour-titulo" className="mt-2 text-xl font-extrabold text-ink">{atual.titulo}</h2>
        <p className="mt-1 text-[15px] text-muted">{atual.texto}</p>
        <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
          {PASSOS_DO_TOUR.map((p, i) => <span key={p.titulo} className={`h-2 rounded-full ${i === passo ? 'w-5 bg-brand' : 'w-2 bg-line'}`} />)}
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={fechar} className="min-h-[48px] flex-1 rounded-2xl border border-line bg-surface text-sm font-bold text-muted active:bg-surface2">
            Pular
          </button>
          <button type="button" onClick={() => (ultimo ? fechar() : setPasso(passo + 1))}
            className="min-h-[48px] flex-1 rounded-2xl bg-[#0b1f4d] text-sm font-extrabold text-white active:opacity-90">
            {ultimo ? 'Começar' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>
  )
}
