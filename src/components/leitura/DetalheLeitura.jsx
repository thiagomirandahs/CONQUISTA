import { useState } from 'react'
import PlayerAudio from './PlayerAudio.jsx'
import { SEM_VERSAO_DIGITAL, linkSeguro, subtitulo, temAudio, temVersaoDigital } from '../../lib/leitura.js'

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
const BOTAO = `inline-flex min-h-[48px] w-full items-center justify-center rounded-xl px-4 text-sm font-extrabold ${FOCO}`

// Conteúdo do detalhe de um material: descrição, autor e SÓ os botões que o servidor devolveu.
// Nada de link/PDF/áudio inventado. Props: material · userId · aoProgresso?(dados)
export default function DetalheLeitura({ material: m, userId, aoProgresso }) {
  const [ouvindo, setOuvindo] = useState(false)
  const livro = linkSeguro(m.book_url)
  const pdf = linkSeguro(m.pdf_url)
  const sub = subtitulo(m)
  return (
    <div className="space-y-3" data-testid="detalhe-leitura">
      {(m.autor || sub) && <p className="text-sm text-muted">{[m.autor && `de ${m.autor}`, sub].filter(Boolean).join(' · ')}</p>}
      {m.descricao && <p className="text-sm text-ink">{m.descricao}</p>}
      {livro && (
        <a href={livro} target="_blank" rel="noopener noreferrer" className={`${BOTAO} bg-[#0b1f4d] text-white`}>
          {m.book_rotulo || 'Ver livro'} <span className="sr-only">(abre em outra aba)</span>
        </a>
      )}
      {pdf && (
        <a href={pdf} target="_blank" rel="noopener noreferrer" className={`${BOTAO} border-2 border-[#0b1f4d] bg-white text-[#0b1f4d]`}>
          Abrir PDF <span className="sr-only">(abre em outra aba)</span>
        </a>
      )}
      {temAudio(m) && (ouvindo
        ? <PlayerAudio material={m} userId={userId} aoProgresso={aoProgresso} />
        : (
          <button type="button" onClick={() => setOuvindo(true)} className={`${BOTAO} border-2 border-amber-400 bg-amber-50 text-[#0b1f4d]`}>
            <span aria-hidden="true" className="mr-2">🎧</span>Ouvir audiobook
          </button>
        ))}
      {!temVersaoDigital(m) && <p className="rounded-xl bg-surface2 p-3 text-sm text-muted">{SEM_VERSAO_DIGITAL}</p>}
      <p className="text-xs text-muted">O que vale para a sua Classe é sempre o requisito do currículo. Este material só ajuda.</p>
    </div>
  )
}
