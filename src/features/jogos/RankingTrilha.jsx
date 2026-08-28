import { useState, useEffect } from 'react'
import Avatar from '../../components/Avatar.jsx'
import { carregarRecordesSemana, excluirRecorde } from '../../lib/dados.js'
import { JOGOS, ARCADE } from './registry.jsx'

// Placar por jogo: chips no topo trocam entre "Geral" e cada jogo.
export default function RankingTrilha({ dados, carregando, meuId, ehAdmin }) {
  const [jogo, setJogo] = useState('geral')
  const [recordes, setRecordes] = useState(null) // ranking dos jogos sem fim
  const top = ['🥇', '🥈', '🥉']
  const abas = [['geral', '🏆', 'Geral'], ...Object.entries(JOGOS).map(([k, j]) => [k, j.emoji, j.curto])]
  const lista = (dados && dados[jogo]) || []
  const ehArcade = ARCADE.has(jogo)

  function recarregarRecs() {
    setRecordes(null)
    carregarRecordesSemana(jogo).then(setRecordes).catch(() => setRecordes([]))
  }
  useEffect(() => {
    if (!ehArcade) return
    recarregarRecs()
  }, [jogo]) // eslint-disable-line

  // Liderança: apaga um recorde suspeito da semana (ex.: valor forjado)
  async function apagarRec(r) {
    if (!window.confirm(`Apagar o recorde de ${r.nome || 'este membro'} (⚡ ${r.pontos}) desta semana?\n\nEle pode fazer um novo jogando de verdade.`)) return
    try {
      await excluirRecorde(r.id, jogo)
      recarregarRecs()
    } catch (e) {
      alert('Não foi possível: ' + (e?.message || e))
    }
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-1 px-1">
        {abas.map(([k, emoji, lbl]) => (
          <button key={k} onClick={() => setJogo(k)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${jogo === k ? 'bg-brand text-white' : 'bg-surface text-muted shadow-sm'}`}>
            {emoji} {lbl}
          </button>
        ))}
      </div>

      {ehArcade ? (
        recordes === null ? (
          <p className="text-faint text-sm">Carregando...</p>
        ) : recordes.length === 0 ? (
          <div className="bg-surface rounded-2xl p-8 text-center shadow-sm">
            <div className="text-4xl mb-2">⚡</div>
            <p className="font-semibold text-ink">Nenhum recorde essa semana ainda</p>
            <p className="text-sm text-faint">Jogue sem limite e crave o seu!</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-faint mb-2">⚡ Recordes da SEMANA — o maior ganha <b>+20 pontos</b> no domingo!</p>
            <div className="bg-surface rounded-2xl shadow-sm p-2">
              {recordes.map((r, i) => {
                const eu = r.id === meuId
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-2 py-2.5 rounded-xl ${eu ? 'bg-brand/5' : ''}`}>
                    <span className="w-6 text-center font-extrabold text-faint">{top[i] || i + 1}</span>
                    <Avatar foto={r.foto} nome={r.nome || '?'} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-ink text-sm truncate">{r.nome || 'Desbravador'}{eu && ' (você)'}</div>
                    </div>
                    <span className="font-extrabold text-gold shrink-0">⚡ {r.pontos}</span>
                    {ehAdmin && (
                      <button onClick={() => apagarRec(r)} title="Apagar recorde suspeito"
                        className="text-red-400 hover:text-red-600 shrink-0 p-2 -m-1">🗑️</button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      ) : carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-2">🎮</div>
          <p className="font-semibold text-ink">Ninguém jogou {jogo === 'geral' ? 'ainda' : 'esse ainda'}</p>
          <p className="text-sm text-faint">Seja o primeiro a pontuar!</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-faint mb-2">{jogo === 'geral' ? 'Somando todos os jogos' : 'Só nesse jogo'} · ⭐ = soma das estrelas.</p>
          <div className="bg-surface rounded-2xl shadow-sm p-2">
            {lista.map((r, i) => {
              const eu = r.id === meuId
              return (
                <div key={r.id} className={`flex items-center gap-3 px-2 py-2.5 rounded-xl ${eu ? 'bg-brand/5' : ''}`}>
                  <span className="w-6 text-center font-extrabold text-faint">{top[i] || i + 1}</span>
                  <Avatar foto={r.foto} nome={r.nome || '?'} cor="#1e3a8a" size="w-9 h-9" textSize="text-sm" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink text-sm truncate">{r.nome || 'Desbravador'}{eu && ' (você)'}</div>
                    <div className="text-[11px] text-faint">{r.passos} jogo{r.passos === 1 ? '' : 's'}</div>
                  </div>
                  <span className="font-extrabold text-gold shrink-0">⭐ {r.estrelas}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
