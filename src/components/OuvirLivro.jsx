import { useEffect, useState } from 'react'
import { audiolivros } from '../services/audiolivros.js'
import { livroDoRequisito, urlDoPlayer, lerProgresso, salvarProgresso, concluirCapitulo } from '../lib/audiolivros.js'

// "🎧 Ouvir o livro" dentro do requisito de leitura (migration 370). Toca capítulo por capítulo pelo
// player sem cookie do YouTube, na ORDEM CERTA (o catálogo corrige playlists invertidas), e lembra
// neste aparelho onde a pessoa parou. Não baixa nem guarda áudio. Se não houver livro para o texto
// do requisito, não mostra nada.
export default function OuvirLivro({ descricao, userId }) {
  const [livro, setLivro] = useState(null)
  const [aberto, setAberto] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [prog, setProg] = useState({ atual: 1, ouvidos: [] })

  useEffect(() => {
    let vivo = true
    audiolivros().then((ls) => { if (vivo) setLivro(livroDoRequisito(descricao, ls)) }).catch(() => {})
    return () => { vivo = false }
  }, [descricao])
  useEffect(() => { if (livro) setProg(lerProgresso(userId, livro.id)) }, [livro, userId])

  if (!livro || !livro.capitulos?.length) return null
  const total = livro.capitulos.length
  const cap = livro.capitulos.find((c) => c.ordem === prog.atual) || livro.capitulos[0]

  function mudar(novo) { setProg(novo); salvarProgresso(userId, livro.id, novo) }
  function irPara(ordem) { mudar({ ...prog, atual: ordem }); setTocando(true) }
  function terminei() { mudar(concluirCapitulo(prog, total)); setTocando(prog.atual < total) }

  const idPainel = `ouvir-${livro.id}`
  return (
    <div className="mt-2 rounded-xl border-2 border-violet-200 bg-violet-50" data-testid="ouvir-livro">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls={idPainel}
        className="flex w-full min-h-[48px] items-center gap-3 px-3 text-left">
        <span aria-hidden="true" className="text-2xl">🎧</span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-violet-900">Ouvir o livro</span>
          <span className="block text-xs text-violet-800">
            {prog.ouvidos.length ? `${prog.ouvidos.length} de ${total} capítulos ouvidos` : `${total} partes · em áudio`}
          </span>
        </span>
        <span aria-hidden="true" className="text-violet-700">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div id={idPainel} className="px-3 pb-3 space-y-3">
          <p className="text-sm font-semibold text-ink">▶️ {cap.titulo} <span className="font-normal text-muted">de {total}</span></p>
          {tocando ? (
            <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingTop: '56.25%' }}>
              <iframe key={cap.video_id} src={urlDoPlayer(cap.video_id)} title={`${livro.titulo} — ${cap.titulo}`}
                allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 h-full w-full" />
            </div>
          ) : (
            <button type="button" onClick={() => setTocando(true)} data-testid="ouvir-tocar"
              className="w-full min-h-[52px] rounded-xl bg-violet-700 text-base font-bold text-white active:scale-[0.99]">
              ▶️ {prog.ouvidos.length ? 'Continuar de onde parei' : 'Começar a ouvir'}
            </button>
          )}
          {tocando && (
            <button type="button" onClick={terminei} data-testid="ouvir-terminei"
              className="w-full min-h-[48px] rounded-xl border-2 border-violet-300 bg-white text-sm font-bold text-violet-900 active:scale-[0.99]">
              {prog.atual < total ? '✅ Terminei este capítulo — próximo' : '✅ Terminei o livro'}
            </button>
          )}

          <details>
            <summary className="min-h-[44px] flex items-center text-sm font-semibold text-violet-900 cursor-pointer">Escolher capítulo</summary>
            <ol className="mt-1 grid grid-cols-3 gap-2">
              {livro.capitulos.map((c) => {
                const ouvido = prog.ouvidos.includes(c.ordem)
                const atual = c.ordem === prog.atual
                return (
                  <li key={c.ordem}>
                    <button type="button" onClick={() => irPara(c.ordem)} aria-current={atual ? 'true' : undefined}
                      className={`w-full min-h-[44px] rounded-lg border px-1 text-xs font-semibold ${atual ? 'border-violet-700 bg-violet-700 text-white' : ouvido ? 'border-green-300 bg-green-50 text-green-800' : 'border-line bg-white text-ink'}`}>
                      {ouvido && !atual ? '✓ ' : ''}{c.titulo.replace('Capítulo ', 'Cap. ')}
                    </button>
                  </li>
                )
              })}
            </ol>
          </details>

          <p className="text-xs text-muted" data-testid="ouvir-origem">
            💡 Ouça no Wi-Fi para economizar seus dados. Conteúdo de terceiros, não produzido pelo DesbravaClube: o áudio de
            «{livro.titulo}»{livro.autor ? `, de ${livro.autor},` : ''} vem do YouTube{livro.canal ? ` (canal ${livro.canal})` : ''}; ouvir ajuda a ler, mas não substitui o que o requisito pede.
          </p>
        </div>
      )}
    </div>
  )
}
