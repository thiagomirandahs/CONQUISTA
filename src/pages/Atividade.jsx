import { useState, useEffect } from 'react'
import { useAuth } from '../context/Auth.jsx'
import Avatar from '../components/Avatar.jsx'
import { atividadeJogos } from '../lib/dados.js'

const PODE_GERIR = ['instrutor', 'diretoria']
const fmt = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : 'nunca jogou')

export default function Atividade() {
  const { profile } = useAuth()
  const ehAdmin = PODE_GERIR.includes(profile?.papel)
  const [d, setD] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    atividadeJogos()
      .then((r) => { setD(r); setCarregando(false) })
      .catch((e) => { setErro(e?.message || 'Erro'); setCarregando(false) })
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da liderança</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">📊 Atividade dos jogos</h2>
        <p className="text-sm text-muted">Quem está jogando e quem sumiu</p>
      </div>

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          <p className="font-semibold mb-1">Não consegui carregar</p>
          <p className="text-xs mb-1">{erro}</p>
          <p className="text-xs">Se a página é nova, rode <code className="bg-amber-100 rounded px-1">supabase/2026-08-06-lembrete-ausencia-e-atividade.sql</code> no Supabase.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-surface rounded-2xl p-4 shadow-soft text-center">
              <div className="text-3xl font-extrabold text-brand">{d.hoje}<span className="text-lg text-faint">/{d.total}</span></div>
              <div className="text-xs text-muted mt-1">jogaram HOJE</div>
            </div>
            <div className="bg-surface rounded-2xl p-4 shadow-soft text-center">
              <div className="text-3xl font-extrabold text-green-600">{d.semana}<span className="text-lg text-faint">/{d.total}</span></div>
              <div className="text-xs text-muted mt-1">jogaram essa SEMANA</div>
            </div>
          </div>

          <div className="bg-surface rounded-2xl p-4 shadow-soft">
            <h3 className="font-extrabold text-ink mb-1">😴 Sumidos (2+ dias sem jogar)</h3>
            <p className="text-xs text-faint mb-3">Recebem "Sentimos sua falta!" automaticamente pela manhã.</p>
            {(d.ausentes || []).length === 0 ? (
              <p className="text-sm text-green-700 bg-green-50 rounded-xl p-3 text-center">🎉 Ninguém sumido — todo mundo jogando!</p>
            ) : (
              <div className="space-y-2">
                {d.ausentes.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-1">
                    <Avatar foto={a.foto} nome={a.nome} size="w-9 h-9" textSize="text-sm" />
                    <span className="flex-1 font-semibold text-ink text-sm truncate">{a.nome}</span>
                    <span className="text-xs text-faint shrink-0">último: {fmt(a.ultimo)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
