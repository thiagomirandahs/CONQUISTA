import { useState, useEffect } from 'react'
import { useClube } from '../context/Clube.jsx'
import {
  carregarAvaliacoesPendentesDeEspecialidade, avaliarRequisitoEspecialidade,
  carregarEspecialidadesDisponiveis, criarOfertaEspecialidade, carregarOfertasDoClube,
} from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import { mensagemDeErro } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'

const PODE_GERIR = ['instrutor', 'diretoria']

export default function AvaliarEspecialidades() {
  const { papel: meuPapel } = useClube()
  const ehAdmin = PODE_GERIR.includes(meuPapel)

  if (!ehAdmin) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold text-ink">Área da diretoria</p>
        <p className="text-sm text-faint">Apenas diretoria/instrutor criam turmas — a avaliação também pode ser feita pelo instrutor responsável de cada turma.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-ink">🏅 Especialidades</h2>
        <p className="text-sm text-muted">Turmas/ofertas e requisitos aguardando avaliação neste clube</p>
      </div>
      <CriarTurma />
      <FilaDeAvaliacao />
    </div>
  )
}

function CriarTurma() {
  const [disponiveis, setDisponiveis] = useState([])
  const [ofertas, setOfertas] = useState([])
  const [specialtyId, setSpecialtyId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(false)

  async function carregar() {
    const [d, o] = await Promise.all([carregarEspecialidadesDisponiveis(), carregarOfertasDoClube()])
    setDisponiveis(d)
    setOfertas(o)
  }
  useEffect(() => { carregar().catch(() => {}) }, [])

  async function criar() {
    if (!specialtyId) { setErro('Escolha uma especialidade.'); return }
    setCriando(true); setErro('')
    try {
      await criarOfertaEspecialidade({ specialtyId, titulo: titulo.trim() || null })
      setTitulo(''); setSpecialtyId('')
      await carregar()
    } catch (e) {
      setErro(e?.message || String(e))
    } finally {
      setCriando(false)
    }
  }

  return (
    <div className="bg-surface rounded-2xl p-4 shadow-soft">
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between text-left">
        <span className="font-bold text-ink text-sm">👥 Turmas/ofertas ({ofertas.length})</span>
        <span className="text-faint text-xs">{aberto ? 'esconder' : 'abrir'}</span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-3">
          {ofertas.length > 0 && (
            <ul className="space-y-1.5">
              {ofertas.map((o) => (
                <li key={o.oferta_id} className="text-xs bg-surface2 rounded-lg px-3 py-1.5">
                  <span className="font-semibold">{o.especialidade_nome}</span>{o.titulo ? ` — ${o.titulo}` : ''}
                  {o.instrutor_responsavel_nome ? ` · responsável: ${o.instrutor_responsavel_nome}` : ''} · {o.participantes} participante(s)
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 items-end">
            <select value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)} className="text-sm rounded-lg border border-line px-2 py-1.5">
              <option value="">Escolha a especialidade...</option>
              {disponiveis.map((sp) => <option key={sp.specialty_id} value={sp.specialty_id}>{sp.nome}</option>)}
            </select>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título da turma (opcional)"
              className="text-sm rounded-lg border border-line px-2 py-1.5 flex-1 min-w-[160px]" />
            <button onClick={criar} disabled={criando} className="rounded-lg bg-gradient-to-r from-brand to-brand2 text-white text-sm font-bold px-3 py-1.5 disabled:opacity-60">
              {criando ? 'Criando...' : 'Criar turma'}
            </button>
          </div>
          {erro && <p className="text-xs text-red-700">{erro}</p>}
          <p className="text-[11px] text-faint">O instrutor responsável (opcional) se define depois, atribuindo participantes à turma pela RPC — a tela completa de gestão de turma fica pra próxima fase.</p>
        </div>
      )}
    </div>
  )
}

function FilaDeAvaliacao() {
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    carregarAvaliacoesPendentesDeEspecialidade()
      .then((d) => { setLista(d); setCarregando(false) })
      .catch((e) => { setErro(e?.message || 'Erro'); setCarregando(false) })
  }, [])

  return (
    <div>
      <h3 className="text-xs font-bold text-faint uppercase tracking-wide mb-2">Requisitos aguardando avaliação</h3>
      {carregando ? (
        <p className="text-faint text-sm">Carregando...</p>
      ) : erro ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">{erro}</div>
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🎉</div>
          <p className="font-semibold text-ink">Nada pra avaliar!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((it) => <Item key={it.member_specialty_requirement_id} it={it} onFeito={(id) => setLista((l) => l.filter((x) => x.member_specialty_requirement_id !== id))} />)}
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
      await avaliarRequisitoEspecialidade(it.member_specialty_requirement_id, decisao, comentario.trim() || null)
      onFeito(it.member_specialty_requirement_id)
    } catch (e) {
      avisar.erro(e)
      setOcupado(false)
    }
  }

  return (
    <div className="bg-surface rounded-2xl p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-bold text-ink truncate">{it.usuario_nome}</div>
        <span className="text-xs text-faint shrink-0">{it.especialidade_nome}</span>
      </div>
      <p className="text-sm text-ink mb-2">{it.requisito_codigo}. {it.requisito_descricao}</p>
      {it.evidencia_texto && <p className="text-sm text-muted italic mb-2">"{it.evidencia_texto}"</p>}
      {it.evidencia_path && (
        <Comprovacao ampliavel valor={it.evidencia_path} alt="evidência" classImg="w-full max-h-72 object-contain bg-black/5 rounded-lg mb-2" />
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
