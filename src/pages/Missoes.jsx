import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import { carregarMissao, enviarMissao, classeDoUsuario } from '../lib/dados.js'
import { vitoria as festa } from '../lib/juice.js'
import Comprovacao from '../components/Comprovacao.jsx'

// Cores oficiais dos lenços das classes (ajustadas p/ contraste com texto branco)
const corClasse = {
  Amigo: '#1d4ed8', Companheiro: '#dc2626', Pesquisador: '#16a34a',
  Pioneiro: '#6b7280', Excursionista: '#7c3aed', Guia: '#d97706',
}

export default function Missoes() {
  const { profile } = useAuth()
  const classe = classeDoUsuario(profile?.nascimento)
  const [carregando, setCarregando] = useState(true)
  const [missao, setMissao] = useState(null)
  const [resumo, setResumo] = useState({ feito: false, sequencia: 0, foto: null })
  const [resposta, setResposta] = useState(null)
  const [foto, setFoto] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { if (profile?.id) recarregar() }, [profile?.id]) // eslint-disable-line
  async function recarregar() {
    setCarregando(true)
    try {
      const d = await carregarMissao()
      setMissao(d.missao)
      setResumo(d.resumo)
    } finally {
      setCarregando(false)
    }
  }

  function escolherFoto(f) {
    setErro('')
    setFoto(f || null)
    setPrevia(f ? URL.createObjectURL(f) : null)
  }

  async function concluir() {
    const opcoes = missao?.opcoes || []
    if (opcoes.length && resposta === null) { setErro('Responda a pergunta.'); return }
    if (missao?.pede_foto && !foto) { setErro('Anexe a foto pedida na missão.'); return }
    setEnviando(true)
    setErro('')
    try {
      const r = await enviarMissao({ foto, resposta, userId: profile.id })
      if (r?.status !== 'pendente') festa() // foto que vai pra aprovação não solta confete ainda
      await recarregar()
    } catch (e) {
      setErro(e?.message || String(e))
      setEnviando(false)
    }
  }

  const seq = resumo.sequencia || 0
  const ehDevocional = missao?.tipo === 'devocional'

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-extrabold text-ink">🎯 Missões</h2>
          <p className="text-sm text-muted">Uma missão nova todo dia — ganhe pontos! 🔥</p>
        </div>
        {classe && (
          <span className="text-xs font-bold text-white rounded-full px-3 py-1.5 shrink-0" style={{ backgroundColor: corClasse[classe] || '#1e3a8a' }}>
            🔰 {classe}
          </span>
        )}
      </div>

      {seq > 0 && (
        <div className="mb-3 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 inline-block">
          🔥 {seq} dia{seq > 1 ? 's' : ''} seguidos!
        </div>
      )}

      {carregando ? (
        <p className="text-faint text-sm">Carregando missão...</p>
      ) : !missao ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🎯</div>
          <p className="font-semibold text-ink">Missões chegando!</p>
          <p className="text-sm text-faint">A liderança ainda vai cadastrar as missões (rode o SQL).</p>
        </div>
      ) : resumo.feito ? (
        <div className="bg-surface rounded-2xl p-6 shadow-soft text-center">
          {resumo.status === 'pendente' ? (
            <>
              <div className="text-5xl mb-2">⏳</div>
              <p className="font-bold text-ink">Missão enviada!</p>
              <p className="text-sm text-faint">Aguardando a liderança aprovar a foto pra valer os pontos.</p>
            </>
          ) : resumo.status === 'reprovada' ? (
            <>
              <div className="text-5xl mb-2">↺</div>
              <p className="font-bold text-ink">Missão de hoje não foi aprovada</p>
              <p className="text-sm text-faint">Capriche mais na próxima 🙂</p>
            </>
          ) : (
            <>
              <div className="text-5xl mb-2">✅</div>
              <p className="font-bold text-ink">Missão de hoje concluída!</p>
              <p className="text-sm text-faint">Volte amanhã pra uma nova missão 🙂</p>
            </>
          )}
          {resumo.foto && <Comprovacao valor={resumo.foto} alt="sua foto" classImg="mt-3 mx-auto w-32 h-32 object-cover rounded-xl" />}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden shadow-soft">
          <div className="p-4 text-white" style={{ background: ehDevocional ? 'linear-gradient(135deg,#1e3a8a,#4338ca)' : 'linear-gradient(135deg,#047857,#10b981)' }}>
            <div className="text-xs font-semibold opacity-90">
              {ehDevocional ? '📖 Devocional do dia' : `🎖️ Desafio${missao.tema ? ' · ' + missao.tema : ''}`}
            </div>
            {missao.texto && <p className="text-[15px] leading-snug mt-1">"{missao.texto}"</p>}
            {ehDevocional && <p className="text-[11px] opacity-80 mt-1">📖 Leia com atenção e responda de qual livro é 👇</p>}
          </div>

          <div className="bg-surface p-4 space-y-4">
            {/* Missões de foto (e outras sem opções) guardam o enunciado em
                'pergunta' — mostra ele aqui, senão a criança não vê o que fazer. */}
            {(missao.opcoes || []).length === 0 && missao.pergunta && (
              <p className="text-[15px] font-semibold text-ink leading-snug">{missao.pergunta}</p>
            )}

            {(missao.opcoes || []).length > 0 && (
              <div>
                <p className="text-sm font-semibold text-ink mb-2">❓ {missao.pergunta}</p>
                <div className="grid grid-cols-2 gap-2">
                  {missao.opcoes.map((op, i) => (
                    <button key={i} type="button" onClick={() => setResposta(i)}
                      className={`rounded-xl py-3 px-2 text-sm font-semibold border transition ${resposta === i ? 'bg-gradient-to-r from-brand to-brand2 text-white border-transparent shadow-glow' : 'bg-surface text-muted border-line'}`}>
                      {op}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {missao.pede_foto && (
              <div>
                <p className="text-sm font-semibold text-ink mb-1">📷 Foto da missão</p>
                <input type="file" accept="image/*" className="text-sm w-full" onChange={(e) => escolherFoto(e.target.files?.[0])} />
                {previa && <img src={previa} alt="prévia" className="mt-2 w-full max-h-48 object-cover rounded-lg" />}
              </div>
            )}

            {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}

            <motion.button onClick={concluir} disabled={enviando} whileTap={{ scale: 0.97 }}
              className="w-full rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-extrabold py-3 shadow-glow disabled:opacity-60">
              {enviando ? 'Enviando...' : 'Concluir missão 🎉'}
            </motion.button>
          </div>
        </div>
      )}
    </div>
  )
}
