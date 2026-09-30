import { useEffect, useState } from 'react'
import { carregarLeituras } from '../../services/leituras.js'
import CapaLivro from './CapaLivro.jsx'
import PlayerAudio from './PlayerAudio.jsx'
import { estaConcluido, linkSeguro, temAudio } from '../../lib/leitura.js'

// Card do livro da Classe (migration 514), para a tela Minha Classe.
//
// Props:
//   classeManifesto  slug do manifesto da classe (ex.: 'amigo'). Escolhe, entre os livros de
//                    `leituras_catalogo('minha_classe')`, o desta classe. Sem ele, usa o primeiro que o servidor devolver.
//   userId           id da pessoa (só para a cópia local do progresso de áudio).
// Não renderiza nada se não houver livro para a classe. O requisito do currículo continua mandando:
// o card só oferece o material ("Ler/Ver livro" e "Ouvir audiobook"); ouvir não aprova nada.
let cache = null
export const limparCacheLivroDaClasse = () => { cache = null }
const livrosDaMinhaClasse = () => {
  if (!cache) cache = carregarLeituras('minha_classe').catch((e) => { cache = null; throw e })
  return cache
}

export default function CardLivroDaClasse({ classeManifesto, userId }) {
  const [livro, setLivro] = useState(null)
  const [ouvindo, setOuvindo] = useState(false)
  const [progresso, setProgresso] = useState(null)

  useEffect(() => {
    let vivo = true
    livrosDaMinhaClasse().then((itens) => {
      if (!vivo) return
      const l = (classeManifesto ? itens.find((i) => i.classe_manifesto === classeManifesto) : itens[0]) || null
      setLivro(l); setProgresso(l?.progresso || null)
    }).catch(() => {})
    return () => { vivo = false }
  }, [classeManifesto])

  if (!livro) return null
  const link = linkSeguro(livro.book_url)
  const concluido = estaConcluido({ progresso })
  return (
    <section aria-label={`Livro da classe: ${livro.titulo}`} className="rounded-2xl border-2 border-[#0b1f4d]/15 bg-surface p-3 shadow-soft" data-testid="card-livro-da-classe">
      <div className="flex gap-3">
        <CapaLivro titulo={livro.titulo} url={livro.capa_url} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold text-muted">Livro da Classe</p>
          <p className="text-base font-extrabold leading-tight text-ink">{livro.titulo}</p>
          {livro.autor && <p className="text-xs text-muted">de {livro.autor}</p>}
          {concluido && <p className="text-xs font-bold text-emerald-800"><span aria-hidden="true">✓ </span>Concluído</p>}
          {!concluido && progresso?.posicao_seg > 0 && <p className="text-xs text-muted">Você já começou a ouvir.</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#0b1f4d] px-4 text-sm font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            {livro.book_rotulo === 'Comprar' ? 'Comprar' : livro.book_rotulo === 'Ler' ? 'Ler' : 'Ver livro'} <span className="sr-only">(abre em outra aba)</span>
          </a>
        )}
        {temAudio(livro) && !ouvindo && (
          <button type="button" onClick={() => setOuvindo(true)}
            className="min-h-[48px] rounded-xl border-2 border-amber-400 bg-amber-50 px-4 text-sm font-extrabold text-[#0b1f4d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <span aria-hidden="true">🎧 </span>Ouvir audiobook
          </button>
        )}
      </div>
      {ouvindo && <div className="mt-3"><PlayerAudio material={{ ...livro, progresso }} userId={userId}
        aoProgresso={(p) => setProgresso({ capitulo: p.capitulo, posicao_seg: p.posicao_seg, duracao_seg: p.duracao_seg, concluido: !!(progresso?.concluido || p.concluido), ultima_em: new Date().toISOString() })} /></div>}
    </section>
  )
}
