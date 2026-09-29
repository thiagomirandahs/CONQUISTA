import { useState } from 'react'
import { urlDoVideo } from '../lib/apresentacao/etapas.js'

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5b012] focus-visible:ring-offset-2'

// Vídeo curto: poster + play grande. Só no clique injeta o iframe do youtube-nocookie (única origem em frame-src).
export default function VideoCurto({ youtubeId, poster, titulo }) {
  const [tocando, setTocando] = useState(false) // quem renderiza passa `key={youtubeId}`: vídeo novo = poster de novo
  if (tocando) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
        <iframe src={urlDoVideo(youtubeId)} title={`Vídeo: ${titulo}`} loading="lazy" className="h-full w-full"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    )
  }
  return (
    <button type="button" onClick={() => setTocando(true)} aria-label={`Assistir ao vídeo: ${titulo}`}
      className={`group relative block aspect-video w-full overflow-hidden rounded-2xl bg-[#07122f] ${FOCO}`}>
      {poster
        ? <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : <div className="absolute inset-0 bg-gradient-to-br from-[#07122f] to-[#143a8a]" />}
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-[#f5b012] text-[#0b1b46] shadow-xl transition-transform motion-safe:group-hover:scale-105">
          <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 h-9 w-9" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </span>
      </span>
      <span className="absolute bottom-4 left-4 rounded-lg bg-black/50 px-2.5 py-1 text-xs font-bold text-white">Toque para assistir</span>
    </button>
  )
}

