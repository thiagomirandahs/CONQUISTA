// Exibe uma comprovação (foto/vídeo de missão ou atividade) — hardening etapa 2.
//  * Registro ANTIGO: foto_url é uma URL pública completa → mostra direto (transição: nada antigo quebra) — EXCETO se for do
//    bucket 'imagens', que agora é privado: aí a URL é trocada por uma assinada (urlComprovacao).
//  * Registro NOVO: foto_url é um CAMINHO no bucket privado 'comprovacoes' →
//    gera uma signed URL temporária. O Storage só assina pra quem tem acesso
//    (dono ou liderança) — quem não tem vê o aviso, nunca o arquivo.
// Mantém o visual das telas: as classes de img/vídeo vêm por props.
import { useState, useEffect } from 'react'
import { urlComprovacao } from '../lib/dados.js'
import { caminhoDaImagem } from '../lib/imagens.js'

// URL completa de FORA do nosso bucket privado: abre direto. As do bucket 'imagens' precisam ser assinadas.
const urlSolta = (v) => /^https?:\/\//i.test(v || '') && !caminhoDaImagem(v)

const ehVideo = (s = '') => /\.(mp4|mov|m4v|webm|ogg|3gp|3gpp|avi|mkv|qt)(\?|$)/i.test(s)

// `ampliavel`: a própria comprovação abre em tela cheia ao tocar (quem avalia precisa VER a foto inteira).
export default function Comprovacao({ valor, alt = 'comprovação', classImg, classVideo, onAmpliar, ampliavel = false }) {
  const [url, setUrl] = useState(urlSolta(valor) ? valor : null)
  const [erro, setErro] = useState(false)
  const [aberta, setAberta] = useState(false)

  useEffect(() => {
    let vivo = true
    setErro(false)
    if (!valor) { setUrl(null); return }
    if (urlSolta(valor)) { setUrl(valor); return }
    setUrl(null)
    urlComprovacao(valor)
      .then((u) => { if (vivo) setUrl(u) })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [valor])

  if (!valor) return null
  if (erro) return <p className="text-xs text-faint mt-1">🔒 Comprovação protegida (sem acesso ou offline).</p>
  if (!url) return <p className="text-xs text-faint mt-1">Carregando comprovação…</p>

  // vídeo? decide pelo CAMINHO original (a signed URL tem query string)
  if (ehVideo(valor)) {
    return <video src={url} controls playsInline preload="metadata" className={classVideo} />
  }
  if (ampliavel) {
    return (
      <>
        <button type="button" onClick={() => setAberta(true)} className="relative block w-full" aria-label={`Ampliar ${alt}`}>
          <img src={url} alt={alt} loading="lazy" className={classImg} />
          <span className="absolute bottom-3 right-2 rounded-full bg-black/70 px-3 py-1.5 text-sm font-bold text-white">🔍 Toque para ampliar</span>
        </button>
        {aberta && (
          <div role="dialog" aria-modal="true" aria-label={alt} onClick={() => setAberta(false)}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black/90 p-3">
            <img src={url} alt={alt} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
            <div className="flex gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="min-h-[48px] rounded-xl bg-white px-4 py-3 text-sm font-bold text-ink">Abrir original</a>
              <button type="button" onClick={() => setAberta(false)} className="min-h-[48px] rounded-xl bg-[#39ff14] px-5 py-3 text-sm font-extrabold text-emerald-950">✕ Fechar</button>
            </div>
          </div>
        )}
      </>
    )
  }
  return onAmpliar ? (
    <button onClick={() => onAmpliar(url)} className="block w-full">
      <img src={url} alt={alt} loading="lazy" className={classImg} />
    </button>
  ) : (
    <img src={url} alt={alt} loading="lazy" className={classImg} />
  )
}
