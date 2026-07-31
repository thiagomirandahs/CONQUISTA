import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import AvisoOffline from '../components/AvisoOffline.jsx'
import { carregarFotos, adicionarFoto, excluirFoto } from '../lib/dados.js'

// Categorias (álbuns) do mural. O nome é gravado na coluna "evento" de cada foto.
const CATEGORIAS = [
  { nome: 'Acampamento', cor: '#1e3a8a', icon: '🏕️' },
  { nome: 'Investidura', cor: '#b45309', icon: '🎖️' },
  { nome: 'Caminhada', cor: '#0ea5e9', icon: '🥾' },
  { nome: 'Culto', cor: '#6366f1', icon: '🙏' },
  { nome: 'Serviço', cor: '#10b981', icon: '🤝' },
  { nome: 'Feira', cor: '#ef4444', icon: '🎪' },
  { nome: 'Ateliê', cor: '#9333ea', icon: '🎨' },
]

// Tema do dia do Ateliê (gira sozinho, um por dia)
const TEMAS_ATELIE = [
  'A arca de Noé', 'Um acampamento do clube', 'Davi e Golias', 'A criação do mundo',
  'Sua unidade em ação', 'Daniel na cova dos leões', 'Uma fogueira com amigos',
  'O que você quer ser quando crescer', 'Jesus acalmando a tempestade',
  'A bandeira do clube', 'Um animal da criação', 'Moisés abrindo o mar', 'Sua família',
]

export default function Mural() {
  const { profile } = useAuth()
  const [fotos, setFotos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [categoria, setCategoria] = useState(null) // categoria aberta (álbum)
  const [lightbox, setLightbox] = useState(null)   // foto ampliada
  const [upload, setUpload] = useState(false)      // modal de envio
  const [desenhando, setDesenhando] = useState(false) // ateliê de desenho

  useEffect(() => {
    let vivo = true
    carregarFotos().then((d) => { if (vivo) { setFotos(d); setCarregando(false) } })
    return () => { vivo = false }
  }, [])

  const ehLideranca = ['instrutor', 'diretoria'].includes(profile?.papel)
  const podeExcluir = (f) => f && (f.autor_id === profile?.id || ehLideranca)
  const fotosDe = (nome) => fotos.filter((f) => f.evento === nome)

  async function aoEnviar({ file, legenda }) {
    const nova = await adicionarFoto({ file, evento: categoria.nome, legenda, autorId: profile.id })
    setFotos((fs) => [nova, ...fs]) // aparece no topo na hora
  }

  async function aoExcluir(foto) {
    await excluirFoto(foto.id)
    setFotos((fs) => fs.filter((f) => f.id !== foto.id))
    setLightbox(null)
  }

  return (
    <div>
      <AvisoOffline />
      <AnimatePresence mode="wait">
        {categoria ? (
          <motion.div key="album" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
            {/* Cabeçalho do álbum */}
            <div className="mb-5 flex items-center gap-3">
              <button onClick={() => setCategoria(null)}
                className="w-9 h-9 rounded-full bg-white shadow-sm grid place-items-center text-slate-600 shrink-0">←</button>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
                  <span>{categoria.icon}</span>
                  <span className="truncate">{categoria.nome}</span>
                </h2>
                <p className="text-sm text-slate-500">{fotosDe(categoria.nome).length} foto(s) neste álbum</p>
              </div>
              {categoria.nome === 'Ateliê' && (
                <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} onClick={() => setDesenhando(true)}
                  className="text-sm text-white rounded-xl px-4 py-2 font-semibold shadow-sm shrink-0 bg-purple-600">
                  🎨 Desenhar
                </motion.button>
              )}
              <motion.button whileTap={{ scale: 0.94 }} whileHover={{ scale: 1.04 }} onClick={() => setUpload(true)}
                className="text-sm text-white rounded-xl px-4 py-2 font-semibold shadow-sm shrink-0"
                style={{ backgroundColor: categoria.cor }}>+ Foto</motion.button>
            </div>

            {carregando ? (
              <p className="text-slate-400 text-sm">Carregando fotos...</p>
            ) : fotosDe(categoria.nome).length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
                <div className="text-4xl mb-2">{categoria.icon}</div>
                <p className="font-semibold text-slate-700">Álbum ainda vazio</p>
                <p className="text-sm text-slate-400 mb-4">Seja o primeiro a postar uma foto de {categoria.nome}.</p>
                <button onClick={() => setUpload(true)}
                  className="text-white rounded-xl px-5 py-2.5 font-semibold text-sm" style={{ backgroundColor: categoria.cor }}>
                  + Adicionar foto
                </button>
              </div>
            ) : (
              <motion.div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
                {fotosDe(categoria.nome).map((f) => (
                  <motion.button key={f.id} onClick={() => setLightbox(f)}
                    variants={{ hide: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1 } }}
                    whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                    className="rounded-2xl overflow-hidden shadow-sm aspect-square relative bg-slate-200">
                    <img src={f.thumb || f.url} alt={f.legenda || categoria.nome} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    {f.legenda && (
                      <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-white text-xs font-medium p-2 text-left truncate">
                        {f.legenda}
                      </span>
                    )}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.div key="cats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mb-5">
              <h2 className="text-2xl font-extrabold text-slate-800">Mural de Fotos</h2>
              <p className="text-sm text-slate-500">Escolha uma categoria para ver e adicionar fotos 📸</p>
            </div>

            <motion.div className="grid grid-cols-2 sm:grid-cols-3 gap-3"
              initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
              {CATEGORIAS.map((c) => {
                const lista = fotosDe(c.nome)
                const capa = lista[0]?.thumb || lista[0]?.url
                return (
                  <motion.button key={c.nome} onClick={() => setCategoria(c)}
                    variants={{ hide: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1 } }}
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    className="rounded-2xl overflow-hidden shadow-sm aspect-square relative text-white grid place-items-center"
                    style={{ backgroundColor: c.cor }}>
                    {capa && <img src={capa} alt={c.nome} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                    <div className="absolute inset-0" style={{ background: capa ? 'rgba(0,0,0,0.35)' : 'transparent' }} />
                    {!capa && <span className="text-4xl opacity-80 relative">{c.icon}</span>}
                    <div className="absolute bottom-2 left-2 right-2 text-left">
                      <div className="font-bold text-sm drop-shadow flex items-center gap-1">
                        <span>{c.icon}</span><span className="truncate">{c.nome}</span>
                      </div>
                      <div className="text-[11px] text-white/90 drop-shadow">
                        {carregando ? '...' : `${lista.length} foto(s)`}
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox — foto ampliada */}
      <AnimatePresence>
        {lightbox && (
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setLightbox(null)}>
            <motion.img onClick={(e) => e.stopPropagation()} src={lightbox.url} alt={lightbox.legenda || ''} decoding="async"
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              className="max-w-full max-h-[75vh] rounded-2xl shadow-2xl object-contain" />
            {lightbox.legenda && <p className="text-white text-center mt-4 max-w-md px-4">{lightbox.legenda}</p>}
            <div className="flex items-center gap-3 mt-4" onClick={(e) => e.stopPropagation()}>
              {podeExcluir(lightbox) && (
                <button onClick={() => aoExcluir(lightbox).catch((err) =>
                  alert(err?.message === 'SEM_PERMISSAO'
                    ? 'Não foi possível excluir (sem permissão). A liderança precisa aplicar a regra de exclusão no banco.'
                    : 'Erro ao excluir: ' + (err?.message || err)))}
                  className="bg-red-500/90 text-white text-sm font-semibold rounded-xl px-4 py-2">🗑️ Excluir</button>
              )}
              <button onClick={() => setLightbox(null)} className="bg-white/20 text-white text-sm font-semibold rounded-xl px-4 py-2">Fechar</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de envio de foto */}
      <AnimatePresence>
        {upload && categoria && (
          <UploadFoto categoria={categoria} onEnviar={aoEnviar} onFechar={() => setUpload(false)} />
        )}
      </AnimatePresence>

      {/* Ateliê: desenhar com o dedo e publicar no álbum 🎨 */}
      <AnimatePresence>
        {desenhando && (
          <ModalDesenho
            onFechar={() => setDesenhando(false)}
            onEnviar={async ({ file, legenda }) => {
              await aoEnviar({ file, legenda })
              setDesenhando(false)
            }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// Ateliê de desenho: canvas de traço livre (dedo), cores, tamanhos, desfazer.
// O desenho vira uma imagem e entra no álbum 🎨 Ateliê como uma foto normal.
const CORES_ATELIE = ['#1e3a8a', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#0ea5e9', '#78350f', '#000000', '#ffffff']
const TAM_CANVAS = 900 // resolução do desenho (maior = aguenta zoom sem borrar)

function ModalDesenho({ onFechar, onEnviar }) {
  const canvasRef = useRef(null)
  const atualRef = useRef(null) // traço em andamento (fora do estado = fluido)
  const [tracos, setTracos] = useState([])
  const tracosRef = useRef([]) // fonte da verdade do desenho (não depende de closure)
  const [cor, setCor] = useState('#1e3a8a')
  const [larg, setLarg] = useState(12)
  const [legenda, setLegenda] = useState('')
  const [enviando, setEnviando] = useState(false)
  const tema = TEMAS_ATELIE[Math.floor(Date.now() / 86400000) % TEMAS_ATELIE.length]

  // Zoom/pan por transform CSS no canvas (transform-origin 0 0). Como pos() lê o
  // getBoundingClientRect — que JÁ inclui o transform — o traço sai no lugar
  // certo em qualquer zoom, sem conta extra. 1 dedo desenha; 2 dedos movem/zoom.
  const [view, setView] = useState({ z: 1, panX: 0, panY: 0 })
  const [base, setBase] = useState(320) // lado do canvas na tela (px) sem zoom
  const contElRef = useRef(null)
  const roRef = useRef(null)
  const inited = useRef(false)
  const pointers = useRef(new Map())
  const pinchRef = useRef(null)

  // Mede a área de desenho; na 1ª vez centraliza o canvas nela.
  const contRef = useCallback((node) => {
    roRef.current?.disconnect()
    contElRef.current = node || null
    if (!node) return
    const medir = () => {
      const w = node.clientWidth, h = node.clientHeight
      const b = Math.max(160, Math.min(w, h) - 12)
      setBase(b)
      if (!inited.current && w > 0 && h > 0) {
        inited.current = true
        setView({ z: 1, panX: (w - b) / 2, panY: (h - b) / 2 })
      }
    }
    medir()
    const ro = new ResizeObserver(medir); ro.observe(node); roRef.current = ro
  }, [])

  function desenharTudo() {
    const c = canvasRef.current?.getContext('2d')
    if (!c) return
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, TAM_CANVAS, TAM_CANVAS)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const t of [...tracosRef.current, atualRef.current].filter(Boolean)) {
      c.strokeStyle = t.cor
      c.lineWidth = t.larg
      c.beginPath()
      t.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
      if (t.pts.length === 1) c.lineTo(t.pts[0].x + 0.1, t.pts[0].y) // toque único vira ponto
      c.stroke()
    }
  }
  useEffect(() => { desenharTudo() }, [tracos]) // eslint-disable-line

  // Ouve move/solta na JANELA (não só no canvas): pega o dedo mesmo se ele sair
  // do canvas ou se a captura falhar. Sem isto, um pointerup perdido deixava o
  // ponteiro "preso" e os traços seguintes viravam gesto (não desenhavam).
  useEffect(() => {
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
    }
  }, []) // eslint-disable-line

  // toque -> pixel do canvas. Sem borda no canvas + rect já com o transform = exato.
  function pos(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (TAM_CANVAS / r.width), y: (e.clientY - r.top) * (TAM_CANVAS / r.height) }
  }
  function doisPontos() {
    const v = [...pointers.current.values()]
    return { a: v[0], b: v[1] }
  }
  function iniciarPinca() {
    const { a, b } = doisPontos()
    if (!a || !b) return
    pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }
  // Mantém o ponto entre os dois dedos "grudado" enquanto dá zoom/move.
  function aplicarPinca() {
    const { a, b } = doisPontos()
    if (!a || !b) return
    if (!pinchRef.current) { iniciarPinca(); return }
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const k = dist / (pinchRef.current.dist || dist)
    const r = contElRef.current.getBoundingClientRect()
    const pm = pinchRef.current.mid
    setView((vw) => {
      const z = Math.min(6, Math.max(0.4, vw.z * k))
      const lx = (pm.x - r.left - vw.panX) / vw.z
      const ly = (pm.y - r.top - vw.panY) / vw.z
      return { z, panX: (mid.x - r.left) - z * lx, panY: (mid.y - r.top) - z * ly }
    })
    pinchRef.current = { dist, mid }
  }
  function comecar(e) {
    e.preventDefault()
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      atualRef.current = { cor, larg, pts: [pos(e)] }; desenharTudo()
    } else {
      atualRef.current = null; desenharTudo(); iniciarPinca() // 2+ dedos = mover/zoom
    }
  }
  function mover(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) { aplicarPinca(); return }
    if (atualRef.current) { atualRef.current.pts.push(pos(e)); desenharTudo() }
  }
  function soltar(e) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchRef.current = null
    if (atualRef.current && pointers.current.size === 0) {
      tracosRef.current = [...tracosRef.current, atualRef.current] // grava o traço
      setTracos(tracosRef.current)
      atualRef.current = null
    }
  }
  function desfazer() { tracosRef.current = tracosRef.current.slice(0, -1); setTracos(tracosRef.current) }
  function limpar() { tracosRef.current = []; setTracos([]) }
  function zoomBotao(f) {
    const r = contElRef.current?.getBoundingClientRect(); if (!r) return
    const cx = r.width / 2, cy = r.height / 2
    setView((vw) => {
      const z = Math.min(6, Math.max(0.4, vw.z * f))
      const lx = (cx - vw.panX) / vw.z, ly = (cy - vw.panY) / vw.z
      return { z, panX: cx - z * lx, panY: cy - z * ly }
    })
  }
  function centralizar() {
    const r = contElRef.current?.getBoundingClientRect(); if (!r) return
    const b = Math.max(160, Math.min(r.width, r.height) - 12)
    setView({ z: 1, panX: (r.width - b) / 2, panY: (r.height - b) / 2 })
  }

  function enviar() {
    if (!tracos.length || enviando) return
    setEnviando(true)
    canvasRef.current.toBlob(async (blob) => {
      try {
        const file = new File([blob], 'desenho.png', { type: 'image/png' })
        await onEnviar({ file, legenda: legenda.trim() || `🎨 ${tema}` })
      } catch (err) {
        alert('Não deu pra enviar: ' + (err?.message || err))
        setEnviando(false)
      }
    }, 'image/png')
  }

  return (
    <motion.div className="fixed inset-0 z-[60] bg-slate-900/95 flex flex-col"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* topo */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-white shrink-0">
        <div className="min-w-0">
          <h3 className="text-base font-extrabold leading-tight">🎨 Ateliê</h3>
          <p className="text-[11px] text-white/70 truncate">Tema: {tema} · 2 dedos p/ mover e dar zoom ✌️</p>
        </div>
        <button onClick={onFechar} disabled={enviando}
          className="text-sm font-bold text-white bg-white/15 rounded-lg px-3 py-2 shrink-0 disabled:opacity-50">Fechar</button>
      </div>

      {/* área do desenho (tela cheia) */}
      <div ref={contRef} className="relative flex-1 overflow-hidden bg-slate-800 touch-none">
        <canvas ref={canvasRef} width={TAM_CANVAS} height={TAM_CANVAS}
          onPointerDown={comecar}
          className="absolute top-0 left-0 rounded-lg shadow-2xl bg-white"
          style={{ width: base, height: base, transformOrigin: '0 0',
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.z})`, touchAction: 'none' }} />

        {/* controles de zoom flutuantes */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-2 select-none">
          <button onClick={() => zoomBotao(1.3)} className="w-11 h-11 rounded-full bg-white shadow-lg text-2xl font-bold text-slate-700 grid place-items-center leading-none">+</button>
          <button onClick={() => zoomBotao(1 / 1.3)} className="w-11 h-11 rounded-full bg-white shadow-lg text-2xl font-bold text-slate-700 grid place-items-center leading-none">−</button>
          <button onClick={centralizar} title="Centralizar" className="w-11 h-11 rounded-full bg-white shadow-lg text-lg grid place-items-center">⤢</button>
        </div>
      </div>

      {/* barra de ferramentas */}
      <div className="shrink-0 bg-white px-3 pt-2 pb-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap select-none">
          {CORES_ATELIE.map((c) => (
            <button key={c} onClick={() => setCor(c)}
              className={`w-8 h-8 rounded-full border-2 shrink-0 ${cor === c ? 'border-azul scale-110' : 'border-slate-200'} transition-transform`}
              style={{ backgroundColor: c }} title={c === '#ffffff' ? 'Borracha' : ''} />
          ))}
          <div className="w-px h-7 bg-slate-200 mx-0.5" />
          {[6, 12, 24].map((l) => (
            <button key={l} onClick={() => setLarg(l)}
              className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${larg === l ? 'bg-azul/10 ring-2 ring-azul' : 'bg-slate-50'}`}>
              <span className="rounded-full bg-slate-700" style={{ width: Math.min(l, 22), height: Math.min(l, 22) }} />
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={desfazer} disabled={!tracos.length}
            className="text-base font-bold text-slate-600 bg-slate-100 rounded-xl px-3 py-2 disabled:opacity-40 shrink-0" title="Desfazer">↩️</button>
          <button onClick={limpar} disabled={!tracos.length}
            className="text-base font-bold text-red-600 bg-red-50 rounded-xl px-3 py-2 disabled:opacity-40 shrink-0" title="Limpar">🗑️</button>
        </div>
        <div className="flex items-center gap-2">
          <input value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={120}
            placeholder={`Legenda (ex.: ${tema})`}
            className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30" />
          <button onClick={enviar} disabled={!tracos.length || enviando}
            className="bg-purple-600 text-white font-extrabold rounded-xl px-4 py-2.5 disabled:opacity-50 shrink-0">
            {enviando ? '…' : '🎨 Publicar'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function UploadFoto({ categoria, onEnviar, onFechar }) {
  const [file, setFile] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [legenda, setLegenda] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  function escolher(f) {
    setErro('')
    setFile(f || null)
    setPrevia(f ? URL.createObjectURL(f) : null)
  }

  async function enviar(e) {
    e.preventDefault()
    if (!file) { setErro('Escolha uma foto primeiro.'); return }
    setEnviando(true)
    setErro('')
    try {
      await onEnviar({ file, legenda: legenda.trim() })
      onFechar()
    } catch (err) {
      setErro('Não foi possível enviar: ' + (err?.message || err))
      setEnviando(false)
    }
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.form onClick={(e) => e.stopPropagation()} onSubmit={enviar}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-full overflow-y-auto">
        <h3 className="text-lg font-extrabold text-slate-800 mb-1">Adicionar foto</h3>
        <p className="text-sm text-slate-500 mb-4">Álbum: <strong>{categoria.icon} {categoria.nome}</strong></p>

        <label className="block aspect-video rounded-2xl border-2 border-dashed border-slate-300 overflow-hidden cursor-pointer grid place-items-center text-slate-400 mb-3 bg-slate-50">
          {previa
            ? <img src={previa} alt="prévia" className="w-full h-full object-cover" />
            : <span className="text-sm">📷 Toque para escolher uma foto</span>}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
        </label>

        <input type="text" value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={120}
          placeholder="Legenda (opcional)"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30 mb-3" />

        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
          <motion.button type="submit" disabled={enviando} whileTap={{ scale: 0.97 }}
            className="flex-1 rounded-xl text-white font-semibold py-2.5 disabled:opacity-60" style={{ backgroundColor: categoria.cor }}>
            {enviando ? 'Enviando...' : 'Enviar foto'}
          </motion.button>
        </div>
      </motion.form>
    </motion.div>
  )
}
