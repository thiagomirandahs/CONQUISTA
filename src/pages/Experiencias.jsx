import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useClube } from '../context/Clube.jsx'
import { useAuth } from '../context/Auth.jsx'
import { subirComprovacao } from '../lib/upload.js'
import {
  carregarExperiencias, carregarExperiencia, participar, enviarEtapa,
  TIPO_ROTULO, EVIDENCIA_ROTULO, STATUS_ROTULO, recompensaTexto,
} from '../services/experiencias.js'
import { EsqueletoTela } from '../ui/carregamento.jsx'

// Experiências do clube (fase 6) — a jornada de QUEM PARTICIPA.
// Tudo o que aparece aqui foi montado pela liderança do próprio clube, dentro de um vocabulário
// fechado que o servidor valida. Esta tela não interpreta regra nenhuma: ela mostra o que o servidor
// devolveu e envia o que a pessoa preencheu. Quem decide se concluiu (e se ganhou) é o banco.
const STATUS_CLASSE = {
  publicada: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  encerrada: 'bg-slate-100 text-slate-700 border-slate-200',
  agendada: 'bg-sky-50 text-sky-800 border-sky-200',
  rascunho: 'bg-amber-50 text-amber-800 border-amber-200',
  arquivada: 'bg-slate-100 text-slate-500 border-slate-200',
}

export default function Experiencias() {
  const { podeGerir } = useClube()
  const [lista, setLista] = useState(null)
  const [aberta, setAberta] = useState(null)
  const [erro, setErro] = useState('')

  const buscar = useCallback(async () => {
    setErro('')
    try { setLista(await carregarExperiencias(!!podeGerir)) }
    catch (e) { setErro(e?.message || String(e)); setLista([]) }
  }, [podeGerir])
  useEffect(() => { buscar() }, [buscar])

  if (aberta) {
    return <Detalhe id={aberta} onVoltar={() => { setAberta(null); buscar() }} />
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">✨ Experiências</h1>
          <p className="text-sm text-muted">Desafios, campanhas e temporadas do seu clube</p>
        </div>
        {podeGerir && (
          <Link to="/experiencias/novo" data-testid="ir-construtor"
            className="shrink-0 min-h-[44px] px-4 grid place-items-center rounded-xl bg-brand text-white font-bold text-sm">
            Criar
          </Link>
        )}
      </header>

      {erro && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 mb-4">{erro}</div>}

      {lista === null ? (
        <EsqueletoTela cabecalho={false} cartoes={2} />
      ) : lista.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2" aria-hidden="true">✨</div>
          <p className="font-semibold text-ink">Nenhuma experiência por aqui</p>
          <p className="text-sm text-faint mt-1">
            {podeGerir ? 'Crie a primeira: um desafio, uma campanha ou uma temporada.' : 'Quando a liderança publicar uma, ela aparece aqui.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {lista.map((e) => <Card key={e.id} e={e} onAbrir={() => setAberta(e.id)} />)}
        </ul>
      )}
    </div>
  )
}

function Card({ e, onAbrir }) {
  const p = e.minha_participacao
  return (
    <li>
      <button type="button" onClick={onAbrir} className="w-full text-left bg-surface rounded-2xl p-4 shadow-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-ink">{e.titulo}</div>
            <div className="text-xs text-muted">{TIPO_ROTULO[e.tipo] || e.tipo} · {e.etapas} etapa{e.etapas === 1 ? '' : 's'}</div>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border shrink-0 ${STATUS_CLASSE[e.status] || ''}`}>
            {STATUS_ROTULO[e.status] || e.status}
          </span>
        </div>
        {e.descricao && <p className="text-sm text-faint mt-1 leading-snug line-clamp-2">{e.descricao}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-faint">
          <span>🎁 {recompensaTexto(e.recompensa)}</span>
          {e.temporada && <span>📅 {e.temporada.titulo}</span>}
          {e.alvo === 'unidade' && <span>👥 Por unidade</span>}
          {p?.status === 'concluida' && <span className="text-emerald-700 font-bold">✅ Concluída</span>}
          {p?.status === 'em_andamento' && <span className="text-sky-700 font-bold">▶️ Em andamento</span>}
        </div>
      </button>
    </li>
  )
}

function Detalhe({ id, onVoltar }) {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [rascunho, setRascunho] = useState({})

  const buscar = useCallback(async () => {
    try { setD(await carregarExperiencia(id)) } catch (e) { setErro(e?.message || String(e)) }
  }, [id])
  useEffect(() => { buscar() }, [buscar])

  const agir = async (fn) => {
    setErro(''); setOcupado(true)
    try { await fn(); await buscar() } catch (e) { setErro(e?.message || String(e)) }
    finally { setOcupado(false) }
  }

  if (!d && !erro) return <EsqueletoTela cabecalho={false} cartoes={2} />

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button type="button" onClick={onVoltar} className="text-sm font-semibold text-brand underline mb-3">← Voltar</button>
      {erro && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 mb-4">{erro}</div>}
      {!d ? null : (
        <>
          <h1 className="text-2xl font-extrabold text-ink">{d.titulo}</h1>
          <p className="text-sm text-muted">{TIPO_ROTULO[d.tipo] || d.tipo} · 🎁 {recompensaTexto(d.recompensa)}</p>
          {d.descricao && <p className="text-sm text-ink mt-2 leading-snug whitespace-pre-line">{d.descricao}</p>}

          {d.participacao?.status === 'concluida' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-900 my-4" data-testid="concluida">
              ✅ Você concluiu esta experiência. A recompensa foi lançada uma única vez.
            </div>
          )}

          {!d.participacao && d.vigente && (
            <button type="button" disabled={ocupado} onClick={() => agir(() => participar(d.id))}
              className="w-full min-h-[48px] rounded-xl bg-brand text-white font-bold my-4 disabled:opacity-60">
              {ocupado ? 'Entrando…' : 'Participar'}
            </button>
          )}
          {!d.vigente && d.status !== 'publicada' && (
            <p className="text-xs text-faint my-4">Esta experiência está {STATUS_ROTULO[d.status]?.toLowerCase()}.</p>
          )}

          <h2 className="text-sm font-extrabold text-ink mt-5 mb-2">Etapas</h2>
          <ol className="space-y-3">
            {(d.etapas || []).map((s) => (
              <Etapa key={s.id} s={s} podeEnviar={!!d.participacao && d.vigente && d.participacao.status !== 'concluida'}
                setErro={setErro}
                valor={rascunho[s.id] || {}} setValor={(v) => setRascunho((r) => ({ ...r, [s.id]: v }))}
                ocupado={ocupado} onEnviar={(dados) => agir(() => enviarEtapa(s.id, dados))} />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function Etapa({ s, podeEnviar, valor, setValor, ocupado, onEnviar, setErro }) {
  const { session } = useAuth()
  const env = s.meu_envio
  const feito = env?.status === 'aprovada'
  const aguardando = env?.status === 'enviada'
  const [subindo, setSubindo] = useState(false)

  // Evidência de arquivo REAPROVEITA o bucket privado que já existe ('comprovacoes', pasta do próprio
  // usuário). Nenhuma infraestrutura nova de arquivo: mesma política, mesma privacidade.
  const escolherArquivo = async (ev) => {
    const file = ev.target.files?.[0]
    if (!file) return
    setSubindo(true)
    try {
      const path = await subirComprovacao({ file, tipo: 'experiencias', userId: session?.user?.id })
      setValor({ ...valor, arquivo_path: path })
    } catch (e) { setErro?.(e?.message || String(e)) }
    finally { setSubindo(false) }
  }

  const enviar = (ev) => {
    ev.preventDefault()
    const d = {}
    if (s.evidencia === 'texto') d.texto = valor.texto || ''
    if (s.evidencia === 'contagem') d.quantidade = Number(valor.quantidade || 0)
    if (s.evidencia === 'foto' || s.evidencia === 'arquivo') d.arquivo_path = valor.arquivo_path || ''
    if (s.evidencia === 'quiz') d.respostas = valor.respostas || {}
    onEnviar(d)
  }

  return (
    <li className={`bg-surface rounded-2xl p-4 shadow-soft ${feito ? 'ring-1 ring-emerald-200' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-ink text-sm">{s.ordem}. {s.titulo}</div>
          <div className="text-xs text-faint">
            {EVIDENCIA_ROTULO[s.evidencia] || s.evidencia}
            {s.exige_aprovacao && ' · a liderança valida'}
            {s.pontos > 0 && ` · ${s.pontos} pts`}
          </div>
        </div>
        {feito && <span className="text-emerald-700 text-sm font-bold shrink-0">✅</span>}
        {aguardando && <span className="text-amber-700 text-xs font-bold shrink-0">aguardando</span>}
      </div>
      {s.descricao && <p className="text-sm text-faint mt-1 leading-snug">{s.descricao}</p>}
      {env?.observacao && <p className="text-xs text-amber-800 mt-1">Liderança: {env.observacao}</p>}

      {podeEnviar && !feito && (
        <form onSubmit={enviar} className="mt-3 space-y-2">
          {s.evidencia === 'texto' && (
            <label className="block">
              <span className="sr-only">Sua resposta</span>
              <textarea aria-label={`Resposta da etapa ${s.titulo}`} rows={3} value={valor.texto || ''}
                onChange={(e) => setValor({ ...valor, texto: e.target.value })}
                className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
            </label>
          )}
          {s.evidencia === 'contagem' && (
            <label className="block">
              <span className="text-xs text-muted">Quantidade{s.regra?.unidade_medida ? ` (${s.regra.unidade_medida})` : ''}</span>
              <input type="number" min={0} aria-label={`Quantidade da etapa ${s.titulo}`} value={valor.quantidade || ''}
                onChange={(e) => setValor({ ...valor, quantidade: e.target.value })}
                className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
            </label>
          )}
          {(s.evidencia === 'foto' || s.evidencia === 'arquivo') && (
            <>
              <label className="block">
                <span className="text-xs text-muted">{s.evidencia === 'foto' ? 'Foto' : 'Arquivo'}</span>
                <input type="file" accept={s.evidencia === 'foto' ? 'image/*' : undefined}
                  aria-label={`Arquivo da etapa ${s.titulo}`} onChange={escolherArquivo}
                  className="mt-1 w-full text-sm text-ink" />
              </label>
              <p className="text-xs text-faint">
                {subindo ? 'Enviando o arquivo…'
                  : valor.arquivo_path ? '✅ Arquivo pronto para enviar.'
                  : 'Vai para a sua pasta privada de comprovações — a mesma das atividades.'}
              </p>
            </>
          )}
          {s.evidencia === 'quiz' && (s.regra?.perguntas || []).map((q, qi) => (
            <fieldset key={qi} className="border border-line rounded-xl p-3">
              <legend className="text-xs text-ink px-1">{q.texto}</legend>
              {(q.opcoes || []).map((o, oi) => (
                <label key={oi} className="flex items-center gap-2 min-h-[36px] text-sm text-ink">
                  <input type="radio" name={`q-${s.id}-${qi}`} value={oi}
                    checked={String(valor.respostas?.[qi]) === String(oi)}
                    onChange={() => setValor({ ...valor, respostas: { ...(valor.respostas || {}), [qi]: oi } })} />
                  {o}
                </label>
              ))}
            </fieldset>
          ))}
          <button type="submit" disabled={ocupado || subindo}
            className="w-full min-h-[44px] rounded-xl bg-brand text-white font-bold text-sm disabled:opacity-60">
            {aguardando ? 'Reenviar' : 'Enviar'}
          </button>
        </form>
      )}
    </li>
  )
}
