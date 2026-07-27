import { useState, useEffect, useRef } from 'react'
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
const TAM_CANVAS = 600

function ModalDesenho({ onFechar, onEnviar }) {
  const canvasRef = useRef(null)
  const atualRef = useRef(null) // traço em andamento (fora do estado = fluido)
  const [tracos, setTracos] = useState([])
  const [cor, setCor] = useState('#1e3a8a')
  const [larg, setLarg] = useState(8)
  const [legenda, setLegenda] = useState('')
  const [enviando, setEnviando] = useState(false)
  const tema = TEMAS_ATELIE[Math.floor(Date.now() / 86400000) % TEMAS_ATELIE.length]

  function desenharTudo() {
    const c = canvasRef.current?.getContext('2d')
    if (!c) return
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, TAM_CANVAS, TAM_CANVAS)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const t of [...tracos, atualRef.current].filter(Boolean)) {
      c.strokeStyle = t.cor
      c.lineWidth = t.larg
      c.beginPath()
      t.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
      if (t.pts.length === 1) c.lineTo(t.pts[0].x + 0.1, t.pts[0].y) // toque único vira ponto
      c.stroke()
    }
  }
  useEffect(() => { desenharTudo() }, [tracos]) // eslint-disable-line

  function pos(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (TAM_CANVAS / r.width), y: (e.clientY - r.top) * (TAM_CANVAS / r.height) }
  }
  function comecar(e) {
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    atualRef.current = { cor, larg, pts: [pos(e)] }
    desenharTudo()
  }
  function mover(e) {
    if (!atualRef.current) return
    atualRef.current.pts.push(pos(e))
    desenharTudo()
  }
  function soltar() {
    if (!atualRef.current) return
    setTracos((t) => [...t, atualRef.current])
    atualRef.current = null
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
    <motion.div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={enviando ? undefined : onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 sm:p-5 max-h-full overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-extrabold text-slate-800">🎨 Ateliê</h3>
          <button onClick={onFechar} disabled={enviando} className="text-xs text-slate-400 p-3 -m-3">Fechar</button>
        </div>
        <p className="text-xs text-slate-500 mb-3">Tema de hoje: <b>{tema}</b> (mas pode desenhar o que quiser!)</p>

        <canvas ref={canvasRef} width={TAM_CANVAS} height={TAM_CANVAS}
          onPointerDown={comecar} onPointerMove={mover} onPointerUp={soltar} onPointerLeave={soltar}
          className="w-full aspect-square rounded-2xl border-2 border-slate-200 bg-white"
          style={{ touchAction: 'none' }} />

        <div className="flex items-center gap-1.5 mt-3 flex-wrap select-none">
          {CORES_ATELIE.map((c) => (
            <button key={c} onClick={() => setCor(c)}
              className={`w-8 h-8 rounded-full border-2 shrink-0 ${cor === c ? 'border-azul scale-110' : 'border-slate-200'} transition-transform`}
              style={{ backgroundColor: c }} title={c === '#ffffff' ? 'Borracha' : ''} />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2 select-none">
          {[4, 8, 16].map((l) => (
            <button key={l} onClick={() => setLarg(l)}
              className={`w-10 h-10 rounded-xl grid place-items-center ${larg === l ? 'bg-azul/10 ring-2 ring-azul' : 'bg-slate-50'}`}>
              <span className="rounded-full bg-slate-700" style={{ width: l, height: l }} />
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => setTracos((t) => t.slice(0, -1))} disabled={!tracos.length}
            className="text-sm font-bold text-slate-600 bg-slate-100 rounded-xl px-3 py-2.5 disabled:opacity-40">↩️ Desfazer</button>
          <button onClick={() => setTracos([])} disabled={!tracos.length}
            className="text-sm font-bold text-red-600 bg-red-50 rounded-xl px-3 py-2.5 disabled:opacity-40">🗑️ Limpar</button>
        </div>

        <input value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={120}
          placeholder={`Legenda (ex.: ${tema})`}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30 mt-3" />

        <button onClick={enviar} disabled={!tracos.length || enviando}
          className="w-full mt-3 bg-purple-600 text-white font-extrabold rounded-xl py-3 disabled:opacity-50">
          {enviando ? 'Publicando…' : '🎨 Publicar no mural'}
        </button>
      </motion.div>
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
