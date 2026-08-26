import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import {
  carregarLivrosBiblia, carregarCapituloBiblia, registrarLeituraBiblia, minhaLeituraBiblia,
} from '../lib/dados.js'

// Livro em que a criança já leu pelo menos 1 capítulo, pra pintar de outra cor na lista.
function progressoDoLivro(progresso, abrev) {
  if (!progresso) return 0
  return progresso.capitulos.filter((c) => c.livro_abrev === abrev).length
}

export default function Biblia() {
  const location = useLocation()
  const [livros, setLivros] = useState([])
  const [progresso, setProgresso] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [livroSel, setLivroSel] = useState(null)
  const [capituloSel, setCapituloSel] = useState(null)
  const [versiculos, setVersiculos] = useState([])
  const [carregandoCapitulo, setCarregandoCapitulo] = useState(false)
  const [ganhoPontos, setGanhoPontos] = useState(0)
  const aplicouLinkInicial = useRef(false)

  async function carregar() {
    setCarregando(true)
    try {
      const [ls, p] = await Promise.all([carregarLivrosBiblia(), minhaLeituraBiblia()])
      setLivros(ls)
      setProgresso(p)
    } catch { /* mostra a tela vazia se falhar */ }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  // Veio do Devocional com "ler o capítulo do versículo de hoje"?
  useEffect(() => {
    if (aplicouLinkInicial.current || !livros.length) return
    const alvo = location.state
    if (alvo?.livroAbrev && alvo?.capitulo) {
      const l = livros.find((x) => x.abrev === alvo.livroAbrev)
      if (l) { aplicouLinkInicial.current = true; abrirCapitulo(l, alvo.capitulo) }
    }
  }, [livros]) // eslint-disable-line

  async function abrirCapitulo(livro, capitulo) {
    setLivroSel(livro)
    setCapituloSel(capitulo)
    setVersiculos([])
    setGanhoPontos(0)
    setCarregandoCapitulo(true)
    try {
      const vs = await carregarCapituloBiblia(livro.abrev, capitulo)
      setVersiculos(vs)
      const r = await registrarLeituraBiblia(livro.abrev, capitulo)
      if (r?.pontos_ganhos > 0) {
        setGanhoPontos(r.pontos_ganhos)
        import('../lib/juice.js').then(({ acerto }) => acerto(2)).catch(() => {})
        setProgresso((p) => p
          ? { ...p, total_lidos: r.total_capitulos_lidos, capitulos: [...p.capitulos, { livro_abrev: livro.abrev, capitulo }] }
          : p)
      }
    } catch { /* tela de capítulo fica vazia se falhar */ }
    setCarregandoCapitulo(false)
  }

  function mudarCapitulo(delta) {
    if (!livroSel) return
    let novo = capituloSel + delta
    if (novo >= 1 && novo <= livroSel.capitulos) { abrirCapitulo(livroSel, novo); return }
    // vira de livro quando acaba/começa o capítulo
    const i = livros.findIndex((l) => l.abrev === livroSel.abrev)
    if (delta > 0 && i < livros.length - 1) abrirCapitulo(livros[i + 1], 1)
    else if (delta < 0 && i > 0) abrirCapitulo(livros[i - 1], livros[i - 1].capitulos)
  }

  const totalLidos = progresso?.total_lidos || 0
  const totalCapitulos = progresso?.total_capitulos || 1189
  const pct = Math.round((totalLidos / totalCapitulos) * 100)

  // ---------- Tela de leitura de um capítulo ----------
  if (livroSel && capituloSel) {
    return (
      <div>
        <button onClick={() => { setLivroSel({ ...livroSel }); setCapituloSel(null) }}
          className="text-sm font-semibold text-azul mb-3">← Capítulos de {livroSel.nome}</button>
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-extrabold text-azul">{livroSel.nome} {capituloSel}</h1>
            <AnimatePresence>
              {ganhoPontos > 0 && (
                <motion.span initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="text-xs font-extrabold bg-green-100 text-green-700 rounded-full px-3 py-1">
                  +{ganhoPontos} pts
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {carregandoCapitulo ? (
            <p className="text-slate-400 text-sm py-8 text-center">Carregando…</p>
          ) : (
            <div className="space-y-2 leading-relaxed">
              {versiculos.map((v) => (
                <p key={v.versiculo} className="text-slate-700">
                  <sup className="text-dourado font-bold mr-1">{v.versiculo}</sup>{v.texto}
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-5">
            <button onClick={() => mudarCapitulo(-1)}
              className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">← Anterior</button>
            <button onClick={() => mudarCapitulo(1)}
              className="flex-1 rounded-xl bg-azul text-white font-semibold py-2.5">Próximo →</button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Grade de capítulos de um livro ----------
  if (livroSel) {
    const lidos = new Set(
      (progresso?.capitulos || []).filter((c) => c.livro_abrev === livroSel.abrev).map((c) => c.capitulo)
    )
    return (
      <div>
        <button onClick={() => setLivroSel(null)} className="text-sm font-semibold text-azul mb-3">← Livros</button>
        <h1 className="text-lg font-extrabold text-azul mb-3">{livroSel.nome}</h1>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {Array.from({ length: livroSel.capitulos }, (_, i) => i + 1).map((c) => (
            <button key={c} onClick={() => abrirCapitulo(livroSel, c)}
              className={`aspect-square rounded-xl font-bold text-sm ${
                lidos.has(c) ? 'bg-azul text-white' : 'bg-white text-slate-600 shadow'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ---------- Lista de livros ----------
  const antigo = livros.filter((l) => l.testamento === 'AT')
  const novo = livros.filter((l) => l.testamento === 'NT')

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-azul">📖 Bíblia</h1>
        <p className="text-slate-500 text-sm">Almeida Corrigida Fiel</p>
      </div>

      {!carregando && livros.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-4">
          A Bíblia ainda não foi carregada no app. Peça pra liderança rodar o SQL. 🙂
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow p-4 mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="font-semibold text-slate-600">Seu progresso</span>
              <span className="font-bold text-azul">{totalLidos}/{totalCapitulos} capítulos</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <motion.div className="h-full bg-dourado" initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
            </div>
          </div>

          {[{ titulo: 'Antigo Testamento', lista: antigo }, { titulo: 'Novo Testamento', lista: novo }].map((grupo) => (
            <div key={grupo.titulo} className="mb-5">
              <h2 className="text-sm font-bold text-slate-500 mb-2">{grupo.titulo}</h2>
              <div className="bg-white rounded-2xl shadow divide-y divide-slate-100">
                {grupo.lista.map((l) => {
                  const lidosLivro = progressoDoLivro(progresso, l.abrev)
                  return (
                    <button key={l.abrev} onClick={() => setLivroSel(l)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left">
                      <span className="font-semibold text-slate-700">{l.nome}</span>
                      <span className="text-xs text-slate-400">
                        {lidosLivro > 0 ? `${lidosLivro}/${l.capitulos} ✓` : `${l.capitulos} cap.`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
