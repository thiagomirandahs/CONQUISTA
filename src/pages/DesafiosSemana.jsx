import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import Duelos from '../components/Duelos.jsx'
import { carregarDesafiosSemana, carregarMinhaCartela, lancarPontosUnidade } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']

// "Semana de 08/07 a 14/07" — inicio é a segunda; fim = +6 dias.
// Formata SEMPRE no fuso de Brasília (o banco define a semana lá), pra o rótulo
// não sair 1 dia atrás em aparelhos a oeste (Manaus, Acre).
function fmtSemana(inicio) {
  if (!inicio) return 'Esta semana'
  const ini = new Date(inicio)
  const fim = new Date(ini.getTime() + 6 * 86400000)
  const dd = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  return `Semana de ${dd(ini)} a ${dd(fim)}`
}

export default function DesafiosSemana() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [dados, setDados] = useState({ inicio: null, unidades: [] })
  const [cartela, setCartela] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [premiando, setPremiando] = useState(false)
  const [aba, setAba] = useState('semana') // semana | duelos

  async function carregar() {
    setCarregando(true)
    try {
      const d = await carregarDesafiosSemana()
      setDados(d)
      setCartela(await carregarMinhaCartela(d.inicio, profile?.id))
    } catch { /* não trava a tela se a busca falhar */ }
    setCarregando(false)
  }
  useEffect(() => { if (profile?.id) carregar() }, [profile?.id]) // eslint-disable-line

  const top = dados.unidades[0]
  const maxPts = Math.max(1, ...dados.unidades.map((u) => u.pontos))
  const semPontos = dados.unidades.every((u) => u.pontos === 0)
  const cheia = cartela.length > 0 && cartela.every((m) => m.feito >= m.meta)

  async function premiar(pontos) {
    if (!top) return
    try {
      await lancarPontosUnidade({ unidadeId: top.id, pontos, motivo: 'Bônus do time da semana 🏆', lancadoPor: profile?.id })
      setPremiando(false)
      carregar()
    } catch (e) {
      alert('Não deu pra premiar: ' + (e?.message || e))
      throw e // deixa o modal liberar o botão pra tentar de novo
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-800">🏁 Desafios</h2>
        <p className="text-sm text-slate-500">
          {aba === 'semana' ? `${fmtSemana(dados.inicio)} · zera toda segunda!` : 'Uma unidade desafia a outra ⚔️'}
        </p>
      </div>

      <div className="bg-white rounded-xl p-1 flex shadow-sm mb-4 max-w-xs">
        {[['semana', '🏁 Semana'], ['duelos', '⚔️ Duelos']].map(([k, lbl]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${aba === k ? 'bg-azul text-white' : 'text-slate-500'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {aba === 'duelos' ? <Duelos onMudou={carregar} /> : carregando ? (
        <p className="text-slate-400 text-sm">Carregando...</p>
      ) : (
      <>
      {/* Cartela pessoal */}
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">Sua cartela</h3>
          {cheia && <span className="text-xs font-extrabold text-green-600">Cartela cheia! 🎉</span>}
        </div>
        <div className="space-y-3">
          {cartela.map((m) => {
            const pct = Math.min(100, Math.round((m.feito / m.meta) * 100))
            const ok = m.feito >= m.meta
            return (
              <div key={m.chave}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-600">{m.emoji} {m.nome}</span>
                  <span className={`font-bold ${ok ? 'text-green-600' : 'text-slate-500'}`}>
                    {ok ? '✓ ' : ''}{Math.min(m.feito, m.meta)}/{m.meta}
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: pct + '%' }} transition={{ duration: 0.5 }}
                    className={`h-full rounded-full ${ok ? 'bg-green-500' : 'bg-azul'}`} />
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Cada missão, jogo, devocional e atividade da semana conta aqui. Na segunda começa de novo!</p>
      </div>

      {/* Corrida das unidades */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <h3 className="font-bold text-slate-800 mb-1">🏁 Corrida das unidades</h3>
        <p className="text-xs text-slate-400 mb-3">Média dos pontos da semana + pontos de time. Mesmo quem está atrás no geral pode ganhar a semana!</p>
        {semPontos ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">🏁</div>
            <p className="text-sm text-slate-500">A semana está começando — ninguém pontuou ainda. Bora! 🚀</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {dados.unidades.map((u, i) => (
              <div key={u.id} className="flex items-center gap-3">
                <span className="w-6 text-center font-extrabold text-slate-400">{['🥇', '🥈', '🥉'][i] || i + 1}</span>
                <Avatar foto={u.emblema} nome={u.nome || '?'} cor={u.cor} size="w-8 h-8" textSize="text-xs" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 text-sm truncate">{u.nome}</span>
                    <span className="font-extrabold shrink-0" style={{ color: u.cor }}>{u.pontos}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                    <motion.div initial={{ width: 0 }} animate={{ width: Math.round((u.pontos / maxPts) * 100) + '%' }}
                      transition={{ duration: 0.5 }} className="h-full rounded-full" style={{ backgroundColor: u.cor }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {ehAdmin && top && top.pontos > 0 && (
          <button onClick={() => setPremiando(true)}
            className="w-full mt-4 bg-dourado text-azul font-bold rounded-xl py-2.5 text-sm">
            🏆 Premiar o time da semana ({top.nome})
          </button>
        )}
      </div>
      </>
      )}

      {premiando && top && <ModalPremiar top={top} onCancelar={() => setPremiando(false)} onConfirmar={premiar} />}
    </div>
  )
}

// Modal só da liderança: lança um bônus de time (avulsos) pra unidade líder.
function ModalPremiar({ top, onCancelar, onConfirmar }) {
  const [pts, setPts] = useState('30')
  const [enviando, setEnviando] = useState(false)
  const travado = useRef(false)
  const valor = Math.max(1, Math.min(200, parseInt(pts, 10) || 0))

  async function confirmar() {
    if (travado.current) return // trava síncrona: ignora duplo-clique
    travado.current = true
    setEnviando(true)
    try {
      await onConfirmar(valor)
    } catch {
      travado.current = false // deu erro: libera pra tentar de novo
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={enviando ? undefined : onCancelar}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl p-5 w-full max-w-xs">
        <h3 className="font-extrabold text-slate-800 text-lg">🏆 Premiar {top.nome}</h3>
        <p className="text-sm text-slate-500 mt-1">Lança pontos de time (avulsos) pra unidade líder da semana. Entra no ranking geral.</p>
        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mt-4 mb-1">Pontos de bônus</label>
        <input type="number" min="1" max="200" value={pts} onChange={(e) => setPts(e.target.value)} disabled={enviando}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-lg font-bold text-slate-800 disabled:opacity-60" />
        <div className="flex gap-2 mt-4">
          <button onClick={onCancelar} disabled={enviando} className="flex-1 bg-slate-100 text-slate-600 font-bold rounded-xl py-2.5 disabled:opacity-60">Cancelar</button>
          <button onClick={confirmar} disabled={enviando} className="flex-1 bg-azul text-white font-bold rounded-xl py-2.5 disabled:opacity-60">
            {enviando ? 'Premiando…' : `Premiar +${valor}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
