import { useState, useEffect } from 'react'
import { useClube } from '../context/Clube.jsx'
import { carregarAvaliacoesPendentesDeClasse, avaliarRequisito } from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'

const PODE_GERIR = ['instrutor', 'diretoria']

export default function AvaliarClasse() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!ehAdmin) { setCarregando(false); return }
    carregarAvaliacoesPendentesDeClasse()
      .then((d) => { setLista(d); setCarregando(false) })
      .catch((e) => { setErro(e?.message || 'Erro'); setCarregando(false) })
  }, [ehAdmin])

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da diretoria</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor avaliam requisitos de classe — no clube em uso.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🎖️ Avaliar classes</h2>
        <p className="text-sm text-muted">Requisitos aguardando avaliação neste clube</p>
      </div>

      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">{erro}</div>
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-ink">Nada pra avaliar!</p>
          <p className="text-sm text-faint">Os requisitos enviados pela criançada aparecem aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((it) => <Item key={it.member_requirement_id} it={it} onFeito={(id) => setLista((l) => l.filter((x) => x.member_requirement_id !== id))} />)}
        </div>
      )}
    </div>
  )
}

function Item({ it, onFeito }) {
  const [comentario, setComentario] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function avaliar(decisao) {
    setOcupado(true)
    try {
      await avaliarRequisito(it.member_requirement_id, decisao, comentario.trim() || null)
      onFeito(it.member_requirement_id)
    } catch (e) {
      alert('Erro: ' + (e?.message || e))
      setOcupado(false)
    }
  }

  return (
    <div className="bg-surface rounded-2xl p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-bold text-ink truncate">{it.usuario_nome}</div>
        <span className="text-[11px] text-faint shrink-0">{it.classe_nome} · {it.secao_nome}</span>
      </div>
      <p className="text-sm text-ink mb-2">{it.requisito_codigo}. {it.requisito_descricao}</p>
      {it.evidencia_texto && <p className="text-sm text-muted italic mb-2">"{it.evidencia_texto}"</p>}
      {it.evidencia_path && (
        <Comprovacao valor={it.evidencia_path} alt="evidência" classImg="w-full max-h-64 object-cover rounded-lg mb-2" />
      )}
      <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentário (opcional)"
        className="w-full text-sm rounded-lg border border-line px-3 py-1.5 mb-2" />
      <div className="flex gap-2">
        <button onClick={() => avaliar('correcao_solicitada')} disabled={ocupado}
          className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-muted hover:bg-surface2 disabled:opacity-60">
          Pedir correção
        </button>
        <button onClick={() => avaliar('aprovado')} disabled={ocupado}
          className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 text-white py-2 text-sm font-semibold disabled:opacity-60">
          ✅ Aprovar
        </button>
      </div>
    </div>
  )
}
