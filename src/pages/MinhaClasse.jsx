import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import {
  carregarMinhaClasse, carregarClassesDisponiveis, iniciarClasse,
  salvarRequisito, enviarRequisito,
} from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import { vitoria as festa } from '../lib/juice.js'

const STATUS_INFO = {
  nao_iniciado: { label: 'Não iniciado', badge: 'bg-surface2 text-muted border border-line', icon: '⚪' },
  em_andamento: { label: 'Em andamento', badge: 'bg-blue-50 text-blue-700 border border-blue-200', icon: '✏️' },
  aguardando_avaliacao: { label: 'Aguardando avaliação', badge: 'bg-amber-50 text-amber-700 border border-amber-200', icon: '⏳' },
  aprovado: { label: 'Aprovado', badge: 'bg-green-50 text-green-700 border border-green-200', icon: '✅' },
  correcao_solicitada: { label: 'Correção solicitada', badge: 'bg-red-50 text-red-700 border border-red-200', icon: '↺' },
}

const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

export default function MinhaClasse() {
  const { profile } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [minha, setMinha] = useState(null)
  const [disponiveis, setDisponiveis] = useState([])
  const [erro, setErro] = useState('')

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const m = await carregarMinhaClasse()
      setMinha(m)
      if (!m) setDisponiveis(await carregarClassesDisponiveis())
    } catch (e) {
      setErro(e?.message || String(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  async function iniciar(classId) {
    try {
      await iniciarClasse(classId)
      await recarregar()
    } catch (e) {
      alert('Erro: ' + (e?.message || e))
    }
  }

  if (carregando) return <p className="text-faint text-sm text-center mt-10">Carregando…</p>

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🎖️ Minha Classe</h2>
        <p className="text-sm text-muted">Seu progresso na classe, requisito por requisito</p>
      </div>

      {erro && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 mb-4">{erro}</div>}

      {!minha ? (
        <ListaDisponiveis disponiveis={disponiveis} onIniciar={iniciar} />
      ) : (
        <Progresso dados={minha} userId={profile?.id} onMudou={recarregar} />
      )}
    </div>
  )
}

function ListaDisponiveis({ disponiveis, onIniciar }) {
  if (disponiveis.length === 0) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2">🎖️</div>
        <p className="font-semibold text-ink">Nenhuma classe disponível ainda</p>
        <p className="text-sm text-faint">A liderança ainda vai publicar o currículo deste clube.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {disponiveis.map((c) => (
        <div key={c.class_id} className="bg-surface rounded-2xl p-4 shadow-soft flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-ink truncate">{c.nome}</div>
            {c.faixa_etaria && <div className="text-xs text-faint truncate">{c.faixa_etaria}</div>}
            {c.curriculum_version?.origem === 'piloto_teste' && (
              <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                Dados de teste
              </span>
            )}
          </div>
          <button onClick={() => onIniciar(c.class_id)}
            className="shrink-0 rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-bold text-sm px-4 py-2 shadow-glow">
            Iniciar
          </button>
        </div>
      ))}
    </div>
  )
}

function Progresso({ dados, userId, onMudou }) {
  const { member_class: mc, classe, curriculum_version: versao, investidura, secoes } = dados
  const ehTeste = versao?.origem === 'piloto_teste'

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-2xl p-5 shadow-soft">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-extrabold text-ink text-lg">{classe?.nome}</h3>
          {ehTeste && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              Dados de teste
            </span>
          )}
        </div>
        {ehTeste && <p className="text-xs text-faint mb-2">{versao.fonte_descricao}</p>}
        <div className="w-full bg-surface2 rounded-full h-3 overflow-hidden mt-2">
          <motion.div className="h-full bg-gradient-to-r from-brand to-brand2" initial={{ width: 0 }}
            animate={{ width: `${mc.percentual}%` }} transition={{ duration: 0.6 }} />
        </div>
        <p className="text-sm text-muted mt-1.5">{mc.percentual}% concluído · iniciada em {fmtData(mc.iniciada_em)}</p>

        {mc.status === 'concluida' && investidura?.status === 'pendente' && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-blue-800">
            🎉 Todos os requisitos concluídos! Aguardando a liderança revisar para a investidura.
          </div>
        )}
        {mc.status === 'investida' && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-800 font-semibold">
            🏅 Investido(a) nesta classe!
          </div>
        )}
      </div>

      {(secoes || []).map((s) => (
        <div key={s.id} className="bg-surface rounded-2xl shadow-soft overflow-hidden">
          <div className="px-4 py-2.5 bg-surface2 font-bold text-ink text-sm">{s.nome}</div>
          <div className="divide-y divide-line">
            {(s.requisitos || []).map((r) => (
              <Requisito key={r.id} r={r} userId={userId} onMudou={onMudou} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Requisito({ r, userId, onMudou }) {
  const info = STATUS_INFO[r.status] || STATUS_INFO.nao_iniciado
  const [texto, setTexto] = useState(r.evidencia_texto || '')
  const [foto, setFoto] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [mostrarHistorico, setMostrarHistorico] = useState(false)

  const podeEditar = ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(r.status)
  const precisaTexto = r.tipo_evidencia === 'texto'
  const precisaFoto = r.tipo_evidencia === 'foto'

  function escolherFoto(f) {
    setFoto(f || null)
    setPrevia(f ? URL.createObjectURL(f) : null)
  }

  async function salvar() {
    setOcupado(true); setErro('')
    try {
      await salvarRequisito({ requirementId: r.id, texto: precisaTexto ? texto : null, foto: precisaFoto ? foto : null, userId })
      await onMudou()
    } catch (e) {
      setErro(e?.message || String(e)); setOcupado(false)
    }
  }

  async function enviar() {
    setOcupado(true); setErro('')
    try {
      if ((precisaTexto && texto.trim()) || (precisaFoto && foto)) {
        await salvarRequisito({ requirementId: r.id, texto: precisaTexto ? texto : null, foto: precisaFoto ? foto : null, userId })
      }
      await enviarRequisito(r.id)
      festa()
      await onMudou()
    } catch (e) {
      setErro(e?.message || String(e)); setOcupado(false)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-semibold text-ink leading-snug">{r.codigo}. {r.descricao}</p>
        <span className={`shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5 ${info.badge}`}>{info.icon} {info.label}</span>
      </div>

      {r.status === 'aprovado' ? (
        <>
          {r.evidencia_texto && <p className="text-sm text-muted italic mt-1">"{r.evidencia_texto}"</p>}
          {r.evidencia_path && <Comprovacao valor={r.evidencia_path} alt="evidência" classImg="mt-2 w-32 h-32 object-cover rounded-lg" />}
        </>
      ) : podeEditar ? (
        <div className="mt-2 space-y-2">
          {r.status === 'correcao_solicitada' && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              A liderança pediu correção — veja o comentário no histórico abaixo e envie de novo.
            </p>
          )}
          {precisaTexto && (
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escreva aqui..."
              className="w-full text-sm rounded-lg border border-line px-3 py-2" />
          )}
          {precisaFoto && (
            <div>
              <input type="file" accept="image/*" className="text-sm" onChange={(e) => escolherFoto(e.target.files?.[0])} />
              {(previa || r.evidencia_path) && (
                previa
                  ? <img src={previa} alt="prévia" className="mt-2 w-32 h-32 object-cover rounded-lg" />
                  : <Comprovacao valor={r.evidencia_path} alt="evidência salva" classImg="mt-2 w-32 h-32 object-cover rounded-lg" />
              )}
            </div>
          )}
          {erro && <p className="text-xs text-red-700">{erro}</p>}
          <div className="flex gap-2">
            {(precisaTexto || precisaFoto) && (
              <button onClick={salvar} disabled={ocupado} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60">
                Salvar rascunho
              </button>
            )}
            <button onClick={enviar} disabled={ocupado} className="rounded-lg bg-gradient-to-r from-brand to-brand2 text-white px-3 py-1.5 text-xs font-bold shadow-glow disabled:opacity-60">
              {ocupado ? 'Enviando...' : 'Enviar para avaliação'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-faint mt-1">Aguardando a liderança avaliar.</p>
      )}

      {(r.avaliacoes || []).length > 0 && (
        <div className="mt-2">
          <button onClick={() => setMostrarHistorico((v) => !v)} className="text-[11px] font-semibold text-faint underline">
            {mostrarHistorico ? 'Esconder' : 'Ver'} histórico de avaliação ({r.avaliacoes.length})
          </button>
          {mostrarHistorico && (
            <ul className="mt-1.5 space-y-1">
              {r.avaliacoes.map((a, i) => (
                <li key={i} className="text-xs text-muted bg-surface2 rounded-lg px-3 py-1.5">
                  <span className="font-semibold">{a.decisao === 'aprovado' ? '✅ Aprovado' : '↺ Correção solicitada'}</span>
                  {' '}por {a.avaliado_por_nome} ({a.avaliado_papel}) em {fmtData(a.created_at)}
                  {a.comentario && <div className="italic mt-0.5">"{a.comentario}"</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
