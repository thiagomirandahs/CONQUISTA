import { useState } from 'react'
import * as juice from '../../../lib/juice.js'
import { PedirAjuda } from '../../../components/Ajuda.jsx'

// ===================== 🟩 Termo do Clube (lógica) =====================
// Estilo Termo/Wordle: 5 letras, 6 tentativas, palavras do mundo desbravador
// (sem acento/ç: LENÇO = LENCO). Verde = certa no lugar; amarelo = existe.
const PALAVRAS_TERMO = ['TENDA', 'CORDA', 'LENCO', 'TRIBO', 'JESUS', 'GRACA', 'ANJOS', 'AMIGO',
  'UNIAO', 'HONRA', 'SERVO', 'TERRA', 'MUNDO', 'CANTO', 'AGUIA', 'FESTA']
const TECLADO_TERMO = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

function avaliarTermo(tent, alvo) {
  const res = Array(5).fill('cinza')
  const sobras = {}
  for (let i = 0; i < 5; i++) {
    if (tent[i] === alvo[i]) res[i] = 'verde'
    else sobras[alvo[i]] = (sobras[alvo[i]] || 0) + 1
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] !== 'verde' && sobras[tent[i]] > 0) { res[i] = 'amarelo'; sobras[tent[i]]-- }
  }
  return res
}
const COR_TERMO = {
  verde: 'bg-green-500 text-white border-green-500',
  amarelo: 'bg-amber-400 text-white border-amber-400',
  cinza: 'bg-slate-400 text-white border-line',
}

export default function JogoTermo({ onTerminar, onCancelar }) {
  const [alvo] = useState(() => PALAVRAS_TERMO[Math.floor(Math.random() * PALAVRAS_TERMO.length)])
  const [linhas, setLinhas] = useState([])
  const [atual, setAtual] = useState('')
  const [fim, setFim] = useState(null) // ganhou | perdeu
  const [aviso, setAviso] = useState('')

  function tecla(k) {
    if (fim) return
    if (k === '⌫') { setAtual((a) => a.slice(0, -1)); return }
    if (k === 'OK') {
      if (atual.length < 5) { setAviso('Complete as 5 letras'); setTimeout(() => setAviso(''), 900); return }
      const res = avaliarTermo(atual, alvo)
      const novas = [...linhas, { tent: atual, res }]
      setLinhas(novas)
      setAtual('')
      if (atual === alvo) {
        setFim('ganhou')
        setTimeout(() => onTerminar(novas.length <= 3 ? 3 : 2), 1200)
      } else if (novas.length >= 6) {
        setFim('perdeu')
        juice.erro()
        setTimeout(() => onTerminar(1), 1800)
      }
      return
    }
    if (atual.length < 5) setAtual((a) => a + k)
  }
  function ajudado() {
    if (fim) return
    setFim('ajudado') // revela a palavra no topo
    setTimeout(() => onTerminar(1), 1600) // usou ajuda = 1 estrela
  }

  // Cor de cada tecla = melhor resultado que aquela letra já teve
  const corTecla = {}
  const rank = { verde: 3, amarelo: 2, cinza: 1 }
  linhas.forEach(({ tent, res }) => tent.split('').forEach((l, i) => {
    if (!corTecla[l] || rank[res[i]] > rank[corTecla[l]]) corTecla[l] = res[i]
  }))

  return (
    <div className="bg-surface rounded-3xl p-4 sm:p-5 shadow-md text-center">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted">Tentativa {Math.min(linhas.length + 1, 6)} de 6</span>
        <button onClick={onCancelar} className="text-xs text-faint p-3 -m-3">Cancelar</button>
      </div>
      <p className={`text-xs mb-3 h-4 font-semibold ${fim === 'ganhou' ? 'text-green-600' : fim ? 'text-amber-600' : 'text-faint'}`}>
        {fim === 'ganhou' ? 'Descobriu! 🎉' : fim === 'ajudado' ? `Um amigo te ajudou! Era ${alvo} 🤝` : fim === 'perdeu' ? `Era ${alvo}!` : aviso || 'Palavra do mundo desbravador'}
      </p>

      {!fim && (
        <div className="mb-3">
          <PedirAjuda jogo="termo" resposta={alvo} onAjudado={ajudado}
            enunciado={{ tipo: 'termo', tentativas: linhas.map((l) => ({ tent: l.tent, res: l.res })), tamanho: 5 }} />
        </div>
      )}

      <div className="grid gap-1.5 mx-auto max-w-[280px] mb-4 select-none">
        {Array.from({ length: 6 }, (_, r) => {
          const linha = linhas[r]
          const ehAtual = r === linhas.length && !fim
          return (
            <div key={r} className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 5 }, (_, c) => {
                const letra = linha ? linha.tent[c] : ehAtual ? (atual[c] || '') : ''
                const cor = linha ? COR_TERMO[linha.res[c]] : 'bg-surface border-line text-ink'
                return (
                  <div key={c} className={`aspect-square rounded-lg border-2 grid place-items-center text-xl font-extrabold ${cor} ${
                    ehAtual && atual[c] ? 'border-brand' : ''
                  }`}>
                    {letra}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="space-y-1.5 select-none">
        {TECLADO_TERMO.map((row, r) => (
          <div key={r} className="flex justify-center gap-1">
            {r === 2 && (
              <button onClick={() => tecla('OK')} className="rounded-lg bg-brand text-white text-xs font-extrabold px-2.5 h-11">OK</button>
            )}
            {row.split('').map((k) => (
              <button key={k} onClick={() => tecla(k)}
                className={`rounded-lg w-[8.2%] min-w-6 h-11 text-sm font-extrabold ${
                  corTecla[k] ? COR_TERMO[corTecla[k]] : 'bg-surface2 text-ink'
                }`}>
                {k}
              </button>
            ))}
            {r === 2 && (
              <button onClick={() => tecla('⌫')} className="rounded-lg bg-surface2 text-ink text-sm font-extrabold px-2.5 h-11">⌫</button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-faint mt-3">Sem acento nem ç (ex.: LENÇO = LENCO). Verde = lugar certo; amarelo = tem na palavra.</p>
    </div>
  )
}
