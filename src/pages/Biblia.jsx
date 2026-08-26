import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import {
  carregarLivrosBiblia, carregarCapituloBiblia,
  iniciarLeituraBiblia, confirmarLeituraBiblia, minhaLeituraBiblia,
} from '../lib/dados.js'

// Quantos capítulos a criança já leu neste livro (pra pintar na lista).
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
  // fase da leitura:
  //  carregando | lendo (cronômetro) | lido (acabou agora) | jalido (já era lido)
  //  | vazio (capítulo sem texto) | erro (não deu pra registrar; mostra o motivo)
  const [fase, setFase] = useState('carregando')
  const [segTotal, setSegTotal] = useState(0)
  const [segRestantes, setSegRestantes] = useState(0)
  const [ganhoPontos, setGanhoPontos] = useState(0)
  const [limiteAtingido, setLimiteAtingido] = useState(false)
  const [erroMsg, setErroMsg] = useState('')

  const aplicouLinkInicial = useRef(false)
  const timerRef = useRef(null)
  // Muda a cada abertura de capítulo: invalida timers/confirmações pendentes
  // se a criança trocar de capítulo ou sair da tela antes de terminar.
  const tokenRef = useRef(0)

  function pararTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }
  useEffect(() => () => pararTimer(), [])

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

  function marcarLidoNoProgresso(livro, cap, totalServidor) {
    setProgresso((p) => {
      if (!p) return p
      if (p.capitulos.some((c) => c.livro_abrev === livro.abrev && c.capitulo === cap)) return p
      return {
        ...p,
        total_lidos: totalServidor ?? (p.total_lidos + 1),
        capitulos: [...p.capitulos, { livro_abrev: livro.abrev, capitulo: cap }],
      }
    })
  }

  async function confirmar(livro, cap, meuToken, jaTentou) {
    try {
      const r = await confirmarLeituraBiblia(livro.abrev, cap)
      if (meuToken !== tokenRef.current) return
      if (r?.lido) {
        setFase('lido')
        if (r.pontos_ganhos > 0) {
          setGanhoPontos(r.pontos_ganhos)
          import('../lib/juice.js').then(({ acerto }) => acerto(2)).catch(() => {})
        } else if (r.limite_diario) {
          setLimiteAtingido(true)
        }
        marcarLidoNoProgresso(livro, cap, r.total_capitulos_lidos)
      } else if (r?.muito_rapido && !jaTentou) {
        // Diferença de relógio: espera o que falta e tenta 1 vez mais.
        const espera = Math.max(1, (r.faltam || 1)) * 1000
        setTimeout(() => {
          if (meuToken === tokenRef.current) confirmar(livro, cap, meuToken, true)
        }, espera)
      }
      // 'invalido' (abriu outro capítulo depois): ignora em silêncio.
    } catch { /* mantém a leitura na tela, sem pontuar */ }
  }

  async function abrirCapitulo(livro, cap) {
    const meuToken = ++tokenRef.current
    pararTimer()
    setLivroSel(livro)
    setCapituloSel(cap)
    setVersiculos([])
    setGanhoPontos(0)
    setLimiteAtingido(false)
    setErroMsg('')
    setSegTotal(0)
    setSegRestantes(0)
    setFase('carregando')
    try {
      const vs = await carregarCapituloBiblia(livro.abrev, cap)
      if (meuToken !== tokenRef.current) return
      setVersiculos(vs)
      if (!vs.length) { setFase('vazio'); return } // sem texto: não cobra tempo

      const r = await iniciarLeituraBiblia(livro.abrev, cap)
      if (meuToken !== tokenRef.current) return
      if (r?.ja_lido) { setFase('jalido'); return }

      // segundos = quanto AINDA falta (retoma se foi interrompido).
      const total = Math.max(0, r?.segundos ?? 12)
      setSegTotal(Math.max(1, total))
      setSegRestantes(total)
      setFase('lendo')
      if (total <= 0) { confirmar(livro, cap, meuToken); return } // já cumpriu o tempo
      timerRef.current = setInterval(() => {
        setSegRestantes((s) => {
          if (s <= 1) {
            pararTimer()
            confirmar(livro, cap, meuToken)
            return 0
          }
          return s - 1
        })
      }, 1000)
    } catch (e) {
      if (meuToken !== tokenRef.current) return
      setErroMsg(e?.message || 'Não deu pra registrar a leitura agora.')
      setFase('erro') // mostra o motivo real (ex: cadastro inativo), não "já lido"
    }
  }

  function mudarCapitulo(delta) {
    if (!livroSel) return
    const novo = capituloSel + delta
    if (novo >= 1 && novo <= livroSel.capitulos) { abrirCapitulo(livroSel, novo); return }
    const i = livros.findIndex((l) => l.abrev === livroSel.abrev)
    if (delta > 0 && i < livros.length - 1) abrirCapitulo(livros[i + 1], 1)
    else if (delta < 0 && i > 0) abrirCapitulo(livros[i - 1], livros[i - 1].capitulos)
  }

  function voltarParaGrade() { pararTimer(); tokenRef.current++; setCapituloSel(null) }
  function voltarParaLivros() { pararTimer(); tokenRef.current++; setLivroSel(null); setCapituloSel(null) }

  const totalLidos = progresso?.total_lidos || 0
  const totalCapitulos = progresso?.total_capitulos || 1189
  const pct = Math.round((totalLidos / totalCapitulos) * 100)

  // ---------- Tela de leitura de um capítulo ----------
  if (livroSel && capituloSel) {
    const pctLeitura = segTotal > 0 ? Math.round(((segTotal - segRestantes) / segTotal) * 100) : 0
    return (
      <div>
        <button onClick={voltarParaGrade}
          className="text-sm font-semibold text-azul mb-3">← Capítulos de {livroSel.nome}</button>
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-extrabold text-azul">{livroSel.nome} {capituloSel}</h1>
            <AnimatePresence>
              {fase === 'lido' && ganhoPontos > 0 && (
                <motion.span key="pts" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="text-xs font-extrabold bg-green-100 text-green-700 rounded-full px-3 py-1">
                  +{ganhoPontos} pts
                </motion.span>
              )}
              {fase === 'lido' && ganhoPontos === 0 && (
                <motion.span key="lido" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="text-xs font-bold bg-slate-100 text-slate-500 rounded-full px-3 py-1">
                  ✓ lido
                </motion.span>
              )}
              {fase === 'jalido' && (
                <span key="ja" className="text-xs font-bold bg-slate-100 text-slate-500 rounded-full px-3 py-1">
                  ✓ já lido
                </span>
              )}
            </AnimatePresence>
          </div>

          {fase === 'lendo' && (
            <div className="mb-4 rounded-xl bg-blue-50 border border-blue-100 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-azul mb-1.5">
                <span>📖 Continue lendo pra ganhar seus pontos…</span>
                <span>{segRestantes}s</span>
              </div>
              <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-full bg-azul transition-all duration-1000 ease-linear"
                  style={{ width: `${pctLeitura}%` }} />
              </div>
            </div>
          )}

          {fase === 'lido' && limiteAtingido && (
            <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-sm p-3">
              ✅ Progresso salvo! Você já pegou o máximo de pontos de Bíblia por hoje — pode continuar lendo à vontade 🙂
            </div>
          )}

          {fase === 'erro' && (
            <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
              {erroMsg}
            </div>
          )}

          {fase === 'carregando' ? (
            <p className="text-slate-400 text-sm py-8 text-center">Carregando…</p>
          ) : fase === 'vazio' ? (
            <p className="text-slate-400 text-sm py-8 text-center">Este capítulo ainda não foi carregado. 🙂</p>
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
        <button onClick={voltarParaLivros} className="text-sm font-semibold text-azul mb-3">← Livros</button>
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
            <p className="text-[11px] text-slate-400 mt-2">Cada capítulo lido vale +2 pontos (até 20 por dia). Fique um tempinho lendo pra contar 🙂</p>
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
