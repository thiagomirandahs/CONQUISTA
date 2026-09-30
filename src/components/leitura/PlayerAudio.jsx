import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { audiolivros } from '../../services/audiolivros.js'
import { salvarProgressoLeitura } from '../../services/leituras.js'
import {
  VELOCIDADES, criarAdaptador, formatarTempo, valorFalado, urlDoPlayerComApi, limitarSalvamento,
  lerProgressoLocal, salvarProgressoLocal,
} from '../../lib/player/youtube.js'

// Player de áudio das Leituras (migration 514). Ouvir NÃO aprova requisito nem altera o currículo: só
// guarda onde a pessoa parou (servidor, silencioso se falhar, + cópia neste aparelho).
// Props: material { id, titulo, audiolivro_id, audio_url, progresso } · userId · aoProgresso?(dados)
//
// O iframe do YouTube (youtube-nocookie, controlado por postMessage) só monta depois do toque em
// "Ouvir"; a barra abaixo é a interface. Sem `audiolivro_id`, mas com `audio_url` direto, usa <audio>.

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
const BTN = `inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border-2 border-[#0b1f4d]/30 bg-white px-3 text-sm font-bold text-[#0b1f4d] transition-colors motion-reduce:transition-none active:bg-slate-100 disabled:opacity-50 ${FOCO}`

const agoraMs = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0 }

// Escolhe o ponto de retomada: o mais recente entre servidor e este aparelho.
function pontoDeRetomada(progresso, local) {
  const s = progresso && !progresso.concluido ? { capitulo: progresso.capitulo, posicao: progresso.posicao_seg, em: agoraMs(progresso.ultima_em) } : null
  const l = local && !local.concluido ? { capitulo: local.capitulo, posicao: local.posicao_seg, em: local.em } : null
  const e = s && l ? (l.em > s.em ? l : s) : s || l
  if (!e || (e.capitulo <= 1 && !(e.posicao > 0))) return null
  return { capitulo: e.capitulo || 1, posicao: e.posicao || 0 }
}

function useSalvarProgresso(material, userId, aoProgresso) {
  const cb = useRef(aoProgresso)
  useEffect(() => { cb.current = aoProgresso })
  // a ref só é lida dentro do callback (quando salva), nunca durante a renderização
  // eslint-disable-next-line react-hooks/refs
  const limitador = useMemo(() => limitarSalvamento((d) => {
    salvarProgressoLocal(userId, material.id, { capitulo: d.capitulo, posicao_seg: d.posicao_seg, duracao_seg: d.duracao_seg, concluido: d.concluido, ouvidos: d.ouvidos || [] })
    try { cb.current?.(d) } catch { /* a tela de fora não pode quebrar o áudio */ }
    // Silencioso: sem rede/sem clube, a cópia local já guardou a posição.
    Promise.resolve().then(() => salvarProgressoLeitura({
      materialId: material.id, capitulo: d.capitulo, posicaoSeg: d.posicao_seg, duracaoSeg: d.duracao_seg, concluido: d.concluido,
    })).catch(() => {})
  }), [material.id, userId])
  useEffect(() => {
    const sair = () => { limitador.agora() }
    const oculta = () => { if (document.visibilityState === 'hidden') sair() }
    window.addEventListener('pagehide', sair)
    document.addEventListener('visibilitychange', oculta)
    return () => { window.removeEventListener('pagehide', sair); document.removeEventListener('visibilitychange', oculta); sair() }
  }, [limitador])
  return limitador
}

function Controles({ tocando, pos, dur, vel, ativo, aoTocarPausar, aoPular, aoBuscar, aoVelocidade, rotulo }) {
  return (
    <div className="space-y-3" data-testid="player-controles">
      <div className="flex items-center justify-center gap-3">
        <button type="button" className={BTN} onClick={() => aoPular(-15)} disabled={!ativo} aria-label="Voltar 15 segundos">↺ 15</button>
        <button type="button" onClick={aoTocarPausar} aria-label={tocando ? 'Pausar' : rotulo}
          className={`inline-flex min-h-[56px] min-w-[56px] items-center justify-center rounded-full bg-[#0b1f4d] px-5 text-base font-extrabold text-white transition-colors motion-reduce:transition-none active:bg-[#07122f] ${FOCO}`}>
          <span aria-hidden="true">{tocando ? '⏸' : '▶'}</span><span className="ml-2">{tocando ? 'Pausar' : 'Ouvir'}</span>
        </button>
        <button type="button" className={BTN} onClick={() => aoPular(15)} disabled={!ativo} aria-label="Avançar 15 segundos">15 ↻</button>
      </div>
      <div>
        <input type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.min(Math.floor(pos), Math.max(1, Math.floor(dur)))}
          onChange={(e) => aoBuscar(Number(e.target.value))} disabled={!ativo || !dur}
          aria-label="Posição do áudio" aria-valuetext={dur ? valorFalado(pos, dur) : 'Ainda não começou'}
          className={`h-11 w-full accent-[#0b1f4d] ${FOCO}`} />
        <div className="flex justify-between text-xs font-semibold text-muted" aria-hidden="true">
          <span>{formatarTempo(pos)}</span><span>{dur ? formatarTempo(dur) : '--:--'}</span>
        </div>
      </div>
      <div role="group" aria-label="Velocidade" className="flex flex-wrap items-center justify-center gap-2">
        {VELOCIDADES.map((v) => (
          <button key={v} type="button" onClick={() => aoVelocidade(v)} aria-pressed={vel === v}
            className={`min-h-[44px] min-w-[52px] rounded-lg border-2 px-2 text-sm font-bold ${FOCO} ${vel === v ? 'border-[#0b1f4d] bg-[#0b1f4d] text-white' : 'border-slate-300 bg-white text-[#0b1f4d]'}`}>
            {String(v).replace('.', ',')}×
          </button>
        ))}
      </div>
    </div>
  )
}

function FaixaContinuar({ capitulo, posicao, aoContinuar }) {
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3" data-testid="player-retomar">
      <p className="text-sm font-semibold text-[#0b1f4d]">Você parou em: {capitulo} · {formatarTempo(posicao)}</p>
      <button type="button" onClick={aoContinuar}
        className={`mt-2 min-h-[48px] w-full rounded-xl bg-[#0b1f4d] text-sm font-extrabold text-white active:bg-[#07122f] ${FOCO}`}>
        CONTINUAR OUVINDO
      </button>
    </div>
  )
}

function NotaOrigem({ material, livro }) {
  return (
    <p className="text-xs text-muted">
      Ouvir ajuda a ler, mas não substitui o que o requisito pede.
      {livro ? ` Conteúdo de terceiros${livro.canal ? ` (canal ${livro.canal})` : ''}, tocado pelo YouTube.` : ` «${material.titulo}».`}
    </p>
  )
}

function PlayerYoutube({ material, userId, aoProgresso }) {
  const [livro, setLivro] = useState(undefined)
  const [erro, setErro] = useState(false)
  const capitulos = useMemo(() => [...(livro?.capitulos || [])].sort((a, b) => a.ordem - b.ordem), [livro])
  const local = useMemo(() => lerProgressoLocal(userId, material.id), [userId, material.id])
  const retomada = useMemo(() => pontoDeRetomada(material.progresso, local), [material.progresso, local])

  const [capOrdem, setCapOrdem] = useState(1)
  const [iniciado, setIniciado] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [vel, setVel] = useState(1)
  const [ouvidos, setOuvidos] = useState(() => (material.progresso?.concluido ? null : local?.ouvidos || []))
  const iframeRef = useRef(null)
  const adaptRef = useRef(null)
  const buscaPendente = useRef(0)
  const estado = useRef({})
  const limitador = useSalvarProgresso(material, userId, aoProgresso)

  useEffect(() => {
    let vivo = true
    audiolivros().then((ls) => { if (vivo) setLivro(ls.find((l) => l.id === material.audiolivro_id) || null) })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [material.audiolivro_id])

  const ordens = capitulos.map((c) => c.ordem)
  const cap = capitulos.find((c) => c.ordem === capOrdem) || capitulos[0]
  const ultimo = cap && cap.ordem === ordens[ordens.length - 1]
  const listaOuvidos = ouvidos || ordens
  useEffect(() => { estado.current = { cap, pos, dur, vel, ultimo, capitulos, listaOuvidos, tocando } })

  const registrar = useCallback((extra, forcar) => {
    const e = estado.current
    if (!e.cap) return
    const d = { capitulo: e.cap.ordem, posicao_seg: Math.floor(e.pos), duracao_seg: e.dur ? Math.floor(e.dur) : null, concluido: false, ouvidos: e.listaOuvidos, ...extra }
    if (forcar) limitador.agora(d); else limitador(d)
  }, [limitador])

  const terminou = useCallback(() => {
    const e = estado.current
    if (!e.cap) return
    const novos = [...new Set([...(e.listaOuvidos || []), e.cap.ordem])].sort((a, b) => a - b)
    setOuvidos(novos)
    if (e.ultimo) {
      setTocando(false)
      registrar({ posicao_seg: Math.floor(e.dur || e.pos), concluido: true, ouvidos: novos }, true)
      return
    }
    const prox = e.capitulos[e.capitulos.findIndex((c) => c.ordem === e.cap.ordem) + 1]
    buscaPendente.current = 0
    setPos(0); setDur(0); setCapOrdem(prox.ordem)
    limitador.agora({ capitulo: prox.ordem, posicao_seg: 0, duracao_seg: null, concluido: false, ouvidos: novos })
  }, [registrar, limitador])

  useEffect(() => {
    if (!iniciado || !cap) return undefined
    const ad = criarAdaptador(iframeRef.current, {
      aoPronto: () => {
        if (buscaPendente.current > 0) { ad.buscar(buscaPendente.current); buscaPendente.current = 0 }
        if (estado.current.vel !== 1) ad.velocidade(estado.current.vel)
      },
      aoInfo: (i) => {
        if (i.currentTime !== undefined && i.playerState !== 0) setPos(i.currentTime)
        if (i.duration) setDur(i.duration)
        if (i.playerState === 1 || i.playerState === 3) setTocando(true)
        if (i.playerState === 2) { setTocando(false); registrar({ posicao_seg: Math.floor(i.currentTime ?? estado.current.pos) }, true) } else if (i.playerState === 1) registrar({ posicao_seg: Math.floor(i.currentTime ?? estado.current.pos) })
      },
      aoTerminar: terminou,
    })
    adaptRef.current = ad
    ad.iniciar()
    return () => { ad.parar(); adaptRef.current = null }
  }, [iniciado, cap?.video_id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <p role="alert" className="text-sm text-rose-700">Não foi possível carregar o áudio agora. Tente de novo mais tarde.</p>
  if (livro === undefined) return <p role="status" className="text-sm text-muted">Carregando o áudio…</p>
  if (!cap) return <p className="text-sm text-muted">O áudio deste livro não está disponível.</p>

  function tocarPausar() {
    if (!iniciado) { setIniciado(true); setTocando(true); return }
    if (tocando) { adaptRef.current?.pausar(); setTocando(false); registrar({}, true) } else { adaptRef.current?.tocar(); setTocando(true) }
  }
  function pular(delta) {
    const nova = Math.min(Math.max(0, pos + delta), dur || pos + delta)
    adaptRef.current?.buscar(nova); setPos(nova)
  }
  function buscar(v) { adaptRef.current?.buscar(v); setPos(v) }
  function velocidade(v) { setVel(v); adaptRef.current?.velocidade(v) }
  function irPara(ordem) {
    buscaPendente.current = 0
    setPos(0); setDur(0); setCapOrdem(ordem); setIniciado(true); setTocando(true)
    limitador.agora({ capitulo: ordem, posicao_seg: 0, duracao_seg: null, concluido: false, ouvidos: listaOuvidos })
  }
  function continuar() {
    const alvo = capitulos.find((c) => c.ordem === retomada.capitulo) || capitulos[0]
    buscaPendente.current = retomada.posicao
    setCapOrdem(alvo.ordem); setPos(retomada.posicao); setDur(0); setIniciado(true); setTocando(true)
  }
  const capRetomada = retomada && (capitulos.find((c) => c.ordem === retomada.capitulo) || capitulos[0])

  return (
    <div className="space-y-3" data-testid="player-audio">
      <p className="text-sm font-bold text-[#0b1f4d]">🎧 {cap.titulo} <span className="font-normal text-muted">de {capitulos.length}</span></p>
      {retomada && !iniciado && <FaixaContinuar capitulo={capRetomada.titulo} posicao={retomada.posicao} aoContinuar={continuar} />}
      <Controles tocando={tocando} pos={pos} dur={dur} vel={vel} ativo={iniciado} rotulo="Ouvir" aoTocarPausar={tocarPausar}
        aoPular={pular} aoBuscar={buscar} aoVelocidade={velocidade} />
      {iniciado && (
        <iframe key={cap.video_id} ref={iframeRef} src={urlDoPlayerComApi(cap.video_id, window.location.origin)}
          title={`${material.titulo} — ${cap.titulo}`} allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin"
          className="mx-auto block h-[113px] w-[200px] rounded-lg bg-black" />
      )}
      {capitulos.length > 1 && (
        <ol className="grid grid-cols-3 gap-2" aria-label="Capítulos">
          {capitulos.map((c) => {
            const ouvido = listaOuvidos.includes(c.ordem), atual = c.ordem === cap.ordem
            return (
              <li key={c.ordem}>
                <button type="button" onClick={() => irPara(c.ordem)} aria-current={atual ? 'true' : undefined}
                  aria-label={`${c.titulo}${ouvido ? ', ouvido' : ''}`}
                  className={`min-h-[44px] w-full rounded-lg border px-1 text-xs font-semibold ${FOCO} ${atual ? 'border-[#0b1f4d] bg-[#0b1f4d] text-white' : ouvido ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-300 bg-white text-[#0b1f4d]'}`}>
                  {ouvido ? '✓ ' : ''}{c.titulo.replace('Capítulo ', 'Cap. ')}
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <NotaOrigem material={material} livro={livro} />
    </div>
  )
}

function PlayerNativo({ material, userId, aoProgresso }) {
  const local = useMemo(() => lerProgressoLocal(userId, material.id), [userId, material.id])
  const retomada = useMemo(() => pontoDeRetomada(material.progresso, local), [material.progresso, local])
  const [iniciado, setIniciado] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [vel, setVel] = useState(1)
  const [falhou, setFalhou] = useState(false)
  const ref = useRef(null)
  const inicio = useRef(0)
  const limitador = useSalvarProgresso(material, userId, aoProgresso)
  const dado = (extra) => ({ capitulo: 1, posicao_seg: Math.floor(ref.current?.currentTime || 0), duracao_seg: ref.current?.duration ? Math.floor(ref.current.duration) : null, concluido: false, ouvidos: [], ...extra })

  function tocar() { setIniciado(true); setTocando(true) }
  useEffect(() => {
    if (iniciado && ref.current) {
      const p = ref.current.play?.(); p?.catch?.(() => setFalhou(true))
    }
  }, [iniciado])
  function tocarPausar() {
    if (!iniciado) { tocar(); return }
    const el = ref.current
    if (tocando) { el?.pause?.(); setTocando(false); limitador.agora(dado({})) } else { const p = el?.play?.(); p?.catch?.(() => setFalhou(true)); setTocando(true) }
  }
  function ir(v) { if (ref.current) ref.current.currentTime = v; setPos(v) }
  const limite = () => ref.current?.duration || dur || Infinity
  function continuar() { inicio.current = retomada.posicao; setIniciado(true); setTocando(true) }

  if (falhou) return <p role="alert" className="text-sm text-rose-700">Não foi possível tocar este áudio aqui.</p>
  return (
    <div className="space-y-3" data-testid="player-audio">
      {retomada && !iniciado && <FaixaContinuar capitulo="Capítulo 1" posicao={retomada.posicao} aoContinuar={continuar} />}
      <Controles tocando={tocando} pos={pos} dur={dur} vel={vel} ativo={iniciado} rotulo="Ouvir" aoTocarPausar={tocarPausar}
        aoPular={(d) => ir(Math.min(Math.max(0, pos + d), limite()))} aoBuscar={ir}
        aoVelocidade={(v) => { setVel(v); if (ref.current) ref.current.playbackRate = v }} />
      <audio ref={ref} src={material.audio_url} preload="none" data-testid="audio-nativo"
        onLoadedMetadata={(e) => { setDur(e.currentTarget.duration || 0); if (inicio.current > 0) { e.currentTarget.currentTime = inicio.current; inicio.current = 0 } }}
        onTimeUpdate={(e) => { setPos(e.currentTarget.currentTime); limitador(dado({ posicao_seg: Math.floor(e.currentTarget.currentTime) })) }}
        onPlay={() => setTocando(true)} onPause={() => setTocando(false)}
        onEnded={() => { setTocando(false); limitador.agora(dado({ posicao_seg: Math.floor(ref.current?.duration || pos), concluido: true })) }}
        onError={() => { if (iniciado) setFalhou(true) }} />
      <NotaOrigem material={material} />
    </div>
  )
}

export default function PlayerAudio(props) {
  const { material } = props
  if (!material) return null
  if (material.audiolivro_id) return <PlayerYoutube {...props} />
  if (material.audio_url) return <PlayerNativo {...props} />
  return null
}
