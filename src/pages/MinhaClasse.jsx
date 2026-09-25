import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import {
  carregarMinhaClasse, carregarClassesDisponiveis, iniciarClasse,
  salvarRequisito, enviarRequisito, escolherOpcoesRequisito, carregarOrigemRequisito, emitirDocumento,
  carregarHistoricoRequisito,
} from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import { vitoria as festa } from '../lib/juice.js'
import { mensagemDeErro } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'

// Tudo que a tela mostra vem do servidor (minha_classe): seções, requisitos, regras (escolha/conteúdo
// dinâmico), bloqueios e status. A tela NÃO interpreta texto de requisito nem decide regra — só apresenta.
// Cada situação tem ícone E texto (nunca só cor), e um botão desabilitado sempre diz o motivo.
const SITUACOES = {
  nao_iniciado: { label: 'Não iniciado', icon: '⚪', badge: 'bg-surface2 text-muted border border-line' },
  em_andamento: { label: 'Em andamento', icon: '✏️', badge: 'bg-blue-50 text-blue-700 border border-blue-200' },
  bloqueado: { label: 'Bloqueado', icon: '🔒', badge: 'bg-amber-50 text-amber-800 border border-amber-200' },
  pronto_pelo_historico: { label: 'Cumprido pelo seu histórico', icon: '✨', badge: 'bg-green-50 text-green-700 border border-green-200' },
  aguardando_avaliacao: { label: 'Aguardando avaliação', icon: '⏳', badge: 'bg-amber-50 text-amber-700 border border-amber-200' },
  aprovado: { label: 'Aprovado', icon: '✅', badge: 'bg-green-50 text-green-700 border border-green-200' },
  correcao_solicitada: { label: 'Correção solicitada', icon: '↺', badge: 'bg-red-50 text-red-700 border border-red-200' },
}

// Situação apresentada de um requisito = status operacional + o que o servidor declarou (bloqueios,
// escolha cumprida pelo histórico). Exportada pra teste.
export function situacaoDoRequisito(r) {
  if (['aprovado', 'aguardando_avaliacao', 'correcao_solicitada'].includes(r.status)) return r.status
  if ((r.bloqueios || []).length > 0) return 'bloqueado'
  if (r.escolha && r.escolha.satisfeitas_automaticamente >= r.escolha.n_minimo) return 'pronto_pelo_historico'
  return r.status === 'em_andamento' ? 'em_andamento' : 'nao_iniciado'
}

// Datas SEM hora (vigente_desde, publicado_em: "2018-01-01") são calendário, não instante — parsear como
// UTC e formatar no fuso local mostrava "31/12/2017". Datas com hora (timestamps) seguem o caminho normal.
// os enums da versão curricular em português (a auditoria de UX achou os dois crus na tela)
const ORIGEM_ROTULO = { oficial: 'oficial', adaptado: 'adaptado pelo clube', rascunho: 'rascunho' }
const VERSAO_ROTULO = { publicado: 'em vigor', arquivado: 'arquivada', rascunho: 'rascunho' }

export const fmtData = (iso) => {
  if (!iso) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (so) return `${so[3]}/${so[2]}/${so[1]}`
  return new Date(iso).toLocaleDateString('pt-BR')
}

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
      avisar.erro(e)
    }
  }

  if (carregando) return <p className="text-faint text-sm text-center mt-10" role="status">Carregando…</p>

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-ink">🎖️ Minha Classe</h2>
        <p className="text-sm text-muted">Seu progresso na classe, requisito por requisito</p>
      </div>

      {erro && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 mb-4">{erro}</div>}

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
        <div className="text-4xl mb-2" aria-hidden="true">🎖️</div>
        <p className="font-semibold text-ink">Nenhuma classe disponível ainda</p>
        <p className="text-sm text-faint">A liderança ainda vai publicar o currículo deste clube.</p>
      </div>
    )
  }
  return (
    <ul className="space-y-3">
      {disponiveis.map((c) => {
        const inelegivel = c.elegivel === false
        const idMotivo = `motivo-${c.class_id}`
        return (
          <li key={c.class_id} className="bg-surface rounded-2xl p-4 shadow-soft flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-ink truncate text-base">{c.nome}</h3>
              {c.idade_minima != null && <div className="text-xs text-faint truncate">A partir de {c.idade_minima} anos</div>}
              {c.idade_minima == null && c.faixa_etaria && <div className="text-xs text-faint truncate">{c.faixa_etaria}</div>}
              {c.curriculum_version?.origem === 'piloto_teste' && (
                <span className="inline-block mt-1 text-xs font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  Dados de teste
                </span>
              )}
              {inelegivel && c.motivo_inelegivel && <div id={idMotivo} className="text-xs text-amber-800 mt-1">🔒 {c.motivo_inelegivel}</div>}
            </div>
            <button onClick={() => onIniciar(c.class_id)} disabled={inelegivel} aria-describedby={inelegivel ? idMotivo : undefined}
              className="shrink-0 min-h-[44px] rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-bold text-sm px-4 py-2 shadow-glow disabled:opacity-40 disabled:shadow-none">
              Iniciar
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Progresso({ dados, userId, onMudou }) {
  const { member_class: mc, classe, curriculum_version: versao, conclusao, secoes } = dados
  const ehTeste = versao?.origem === 'piloto_teste'
  // fase 4: 100% aprovado NÃO é "investido" — os estados são separados e vêm do servidor
  const ETAPAS = {
    requisitos_concluidos: { icon: '🧩', texto: 'Todos os requisitos aprovados! A conclusão está sendo validada pela liderança.' },
    aguardando_revisao: { icon: '🔎', texto: 'Todos os requisitos aprovados! Aguardando a revisão final da liderança.' },
    apto_investidura: { icon: '🎉', texto: 'Revisão final aprovada — você está apto(a) para a investidura. A liderança registra quando ela acontecer.' },
  }
  const etapa = ETAPAS[mc.status]

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-2xl p-5 shadow-soft">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-extrabold text-ink text-lg">{classe?.nome}</h3>
          {ehTeste && (
            <span className="text-xs font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              Dados de teste
            </span>
          )}
        </div>
        {ehTeste && <p className="text-xs text-faint mb-2">{versao.fonte_descricao}</p>}
        {versao?.origem === 'oficial' && (
          <p className="text-xs text-faint mb-2">
            Currículo oficial {versao.versao}{classe?.vigente_desde ? ` · vigente desde ${fmtData(classe.vigente_desde)}` : ''}
          </p>
        )}
        <div className="w-full bg-surface2 rounded-full h-3 overflow-hidden mt-2" role="progressbar" aria-valuenow={mc.percentual} aria-valuemin="0" aria-valuemax="100" aria-label="Progresso na classe">
          <motion.div className="h-full bg-gradient-to-r from-brand to-brand2" initial={{ width: 0 }}
            animate={{ width: `${mc.percentual}%` }} transition={{ duration: 0.6 }} />
        </div>
        <p className="text-sm text-muted mt-1.5">{mc.percentual}% concluído · iniciada em {fmtData(mc.iniciada_em)}</p>

        {etapa && (
          <div data-testid="etapa" data-etapa={mc.status} className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-blue-800">
            <span aria-hidden="true">{etapa.icon}</span> {etapa.texto}
            {mc.status === 'apto_investidura' && conclusao?.revisao?.revisado_em && (
              <div className="text-xs mt-1">Revisão final aprovada em {fmtData(conclusao.revisao.revisado_em)}{conclusao.revisao.revisado_por_nome ? ` por ${conclusao.revisao.revisado_por_nome}` : ''}.</div>
            )}
          </div>
        )}
        {mc.status === 'em_andamento' && conclusao?.revisao?.status === 'correcao_solicitada' && conclusao.revisao.comentario && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-800">
            ↺ A revisão final pediu correção: "{conclusao.revisao.comentario}" — os requisitos reabertos estão marcados abaixo.
          </div>
        )}
        {mc.status === 'investida' && (
          <div data-testid="etapa" data-etapa="investida" className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-800 font-semibold">
            🏅 Investido(a) nesta classe{conclusao?.investidura?.data ? ` em ${fmtData(conclusao.investidura.data)}` : ''}!
          </div>
        )}
        {conclusao?.snapshot && <BotaoDocumento memberClassId={mc.id} ehFinal={mc.status === 'investida'} />}
      </div>

      {(secoes || []).map((s) => (
        <section key={s.id} data-testid="secao" aria-labelledby={`secao-${s.id}`} className="bg-surface rounded-2xl shadow-soft overflow-hidden">
          <h4 id={`secao-${s.id}`} className="px-4 py-2.5 bg-surface2 font-bold text-ink text-sm">{s.codigo ? `${s.codigo}. ` : ''}{s.nome}</h4>
          <div className="divide-y divide-line">
            {(s.requisitos || []).map((r) => (
              <Requisito key={r.id} r={r} userId={userId} onMudou={onMudou} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Requisito({ r, userId, onMudou }) {
  const situacao = situacaoDoRequisito(r)
  const info = SITUACOES[situacao]
  const bloqueios = r.bloqueios || []
  const [texto, setTexto] = useState(r.evidencia_texto || '')
  const [foto, setFoto] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [mostrarHistorico, setMostrarHistorico] = useState(false)

  const podeEditar = ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(r.status)
  const podeEnviar = podeEditar && bloqueios.length === 0
  const precisaTexto = r.tipo_evidencia === 'texto'
  const precisaFoto = r.tipo_evidencia === 'foto'
  const idTitulo = `req-${r.id}`
  const idBloqueios = `bloq-${r.id}`

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
    <article data-testid="requisito" aria-labelledby={idTitulo} className="p-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h5 id={idTitulo} className="text-sm font-semibold text-ink leading-snug">
          <span data-testid="requisito-texto">{r.codigo}. {r.descricao}</span>
        </h5>
        <span className={`shrink-0 text-xs font-bold rounded-full px-2 py-0.5 ${info.badge}`} data-testid="situacao" data-situacao={situacao}>
          <span aria-hidden="true">{info.icon}</span> {info.label}
        </span>
      </div>

      {r.conteudo_dinamico && <ConteudoDoPeriodo dinamico={r.conteudo_dinamico} mostrarAviso={!podeEditar || bloqueios.length === 0} />}
      {r.escolha && <Escolha r={r} podeEditar={podeEditar} onMudou={onMudou} />}

      {r.status === 'aprovado' ? (
        <>
          {r.evidencia_texto && <p className="text-sm text-muted italic mt-1">"{r.evidencia_texto}"</p>}
          {r.evidencia_path && <Comprovacao valor={r.evidencia_path} alt="evidência" classImg="mt-2 w-32 h-32 object-cover rounded-lg" />}
        </>
      ) : podeEditar ? (
        <div className="mt-2 space-y-2">
          {r.status === 'correcao_solicitada' && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              ↺ A liderança pediu correção — veja o comentário no histórico abaixo e envie de novo.
            </p>
          )}
          {precisaTexto && (
            <label className="block">
              <span className="text-xs text-muted">Sua resposta</span>
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escreva aqui..."
                className="mt-1 w-full text-sm rounded-lg border border-line px-3 py-2" />
            </label>
          )}
          {precisaFoto && (
            <div>
              <label className="block">
                <span className="text-xs text-muted">Foto de evidência</span>
                <input type="file" accept="image/*" className="mt-1 block text-sm" onChange={(e) => escolherFoto(e.target.files?.[0])} />
              </label>
              {(previa || r.evidencia_path) && (
                previa
                  ? <img src={previa} alt="prévia da foto escolhida" className="mt-2 w-32 h-32 object-cover rounded-lg" />
                  : <Comprovacao valor={r.evidencia_path} alt="evidência salva" classImg="mt-2 w-32 h-32 object-cover rounded-lg" />
              )}
            </div>
          )}
          {bloqueios.length > 0 && (
            <ul id={idBloqueios} data-testid="bloqueios" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 space-y-0.5">
              {bloqueios.map((b, i) => <li key={i}>🔒 {b}</li>)}
            </ul>
          )}
          {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            {(precisaTexto || precisaFoto) && (
              <button onClick={salvar} disabled={ocupado} className="min-h-[44px] rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60">
                Salvar rascunho
              </button>
            )}
            <button onClick={enviar} disabled={ocupado || !podeEnviar} aria-describedby={!podeEnviar ? idBloqueios : undefined}
              className="min-h-[44px] rounded-lg bg-gradient-to-r from-brand to-brand2 text-white px-3 py-1.5 text-xs font-bold shadow-glow disabled:opacity-40 disabled:shadow-none">
              {ocupado ? 'Enviando...' : !podeEnviar ? '🔒 Enviar para avaliação' : 'Enviar para avaliação'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-faint mt-1">⏳ Aguardando a liderança avaliar.</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {(r.avaliacoes || []).length > 0 && r.member_requirement_id && (
          <button onClick={() => setMostrarHistorico((v) => !v)} aria-expanded={mostrarHistorico} className="text-xs font-semibold text-faint underline">
            {mostrarHistorico ? 'Esconder' : 'Ver'} histórico ({r.avaliacoes.length} avaliaç{r.avaliacoes.length === 1 ? 'ão' : 'ões'})
          </button>
        )}
        <OrigemDoRequisito requirementId={r.id} />
      </div>
      {mostrarHistorico && <HistoricoPorTentativa memberRequirementId={r.member_requirement_id} />}
    </article>
  )
}

// Gera (ou reobtém, idempotente) o Caderno da própria pessoa e abre a versão imprimível numa aba nova.
// Antes da investidura sai como acompanhamento; depois, como documento final.
function BotaoDocumento({ memberClassId, ehFinal }) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  async function gerar() {
    setOcupado(true); setErro('')
    try {
      const r = await emitirDocumento(memberClassId)
      window.open(`/documento/${r.token}`, '_blank', 'noopener')
    } catch (e) { setErro(e?.message || String(e)) } finally { setOcupado(false) }
  }
  return (
    <div className="mt-3">
      <button onClick={gerar} disabled={ocupado} className="w-full min-h-[44px] rounded-xl border border-line bg-surface2 text-ink font-semibold text-sm py-2 disabled:opacity-60">
        {ocupado ? 'Gerando…' : ehFinal ? '📘 Ver / imprimir meu documento de conclusão' : '📘 Ver / imprimir meu caderno de acompanhamento'}
      </button>
      {erro && <p role="alert" className="text-xs text-red-700 mt-1">{erro}</p>}
    </div>
  )
}

// Conteúdo anual/dinâmico: o servidor resolveu o valor pra hoje (ou não há valor cadastrado — e a
// tela diz isso claramente; o requisito fica bloqueado, nunca "cumprido" por conta própria).
// Desde a migration 84 o servidor manda o ANO do conteúdo (`ano`; `ano_referencia` = o ano procurado
// quando falta) e, depois do envio/aprovação, o valor FIXADO no requisito — a tela diz de que ano é.
// Sem o campo (servidor antigo), cai no texto de antes.
// (sem valor + lista de bloqueios visível, o aviso não repete: a lista já diz o motivo)
function ConteudoDoPeriodo({ dinamico, mostrarAviso }) {
  if (dinamico.valor) return <p className="text-xs text-ink bg-surface2 rounded-lg px-3 py-1.5 mb-1.5">📖 {dinamico.ano ? `Conteúdo de ${dinamico.ano}` : 'Conteúdo deste período'}: <span className="font-semibold">{dinamico.valor}</span></p>
  if (!mostrarAviso) return null
  const ano = dinamico.ano_referencia
  return <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-1.5">📖 O conteúdo oficial {ano ? `de ${ano}` : 'deste período'} ainda não está disponível. Assim que for cadastrado, este requisito é liberado.</p>
}

// Escolha N-de-M: opções na ordem do cartão (checkbox), texto livre só quando o cartão não lista opções.
// O que o histórico já cumpre vem marcado pelo servidor; o que viola "sem repetição" vem sinalizado.
function Escolha({ r, podeEditar, onMudou }) {
  const e = r.escolha
  const opcoes = e.opcoes || []
  const auto = new Set(e.opcoes_automaticas || [])
  const escolhidasIniciais = (e.escolhidas || []).filter((x) => x.option_id).map((x) => x.option_id)
  const livresIniciais = (e.escolhidas || []).filter((x) => x.rotulo_livre).map((x) => x.rotulo_livre)
  const [marcadas, setMarcadas] = useState(new Set(escolhidasIniciais))
  const [livres, setLivres] = useState(livresIniciais)
  const [novoLivre, setNovoLivre] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const violacoes = new Set((e.escolhidas || []).filter((x) => x.ja_realizada_antes).map((x) => x.option_id))
  const mudou = JSON.stringify([...marcadas].sort()) !== JSON.stringify([...escolhidasIniciais].sort()) || JSON.stringify(livres) !== JSON.stringify(livresIniciais)
  const idLegenda = `escolha-${r.id}`

  function alternar(id) {
    setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  async function salvar() {
    setSalvando(true); setErro('')
    try {
      await escolherOpcoesRequisito(r.id, [...marcadas], livres)
      await onMudou()
    } catch (err) {
      setErro(err?.message || String(err)); setSalvando(false)
    }
  }

  return (
    <fieldset data-testid="escolha" className="text-xs text-muted bg-surface2 rounded-lg px-3 py-2 mb-1.5" disabled={!podeEditar}>
      <legend id={idLegenda} className="font-semibold text-ink">
        Escolha {e.n_minimo}{opcoes.length ? ` de ${opcoes.length}` : ''}
        {e.sem_repeticao && <span className="font-normal text-faint"> · não vale especialidade já realizada antes desta classe</span>}
      </legend>
      {opcoes.length > 0 && (
        <ul className="mt-1 space-y-1">
          {opcoes.map((o) => {
            const cumprida = auto.has(o.id)
            const viola = violacoes.has(o.id)
            return (
              <li key={o.id}>
                <label className="flex items-start gap-2 min-h-[32px]">
                  <input type="checkbox" className="mt-0.5 w-5 h-5" aria-label={o.rotulo} checked={cumprida || marcadas.has(o.id)} disabled={cumprida || !podeEditar} onChange={() => alternar(o.id)} />
                  <span className={viola ? 'line-through' : ''}>{o.rotulo}</span>
                  {cumprida && <span className="text-green-700">✨ cumprida pelo seu histórico</span>}
                  {viola && <span className="text-amber-800">🔒 já realizada antes desta classe — não vale</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {e.aceita_texto_livre && (
        <div className="mt-1 space-y-1">
          {livres.length > 0 && (
            <ul className="space-y-0.5">
              {livres.map((t) => (
                <li key={t} className="flex items-center justify-between gap-2">
                  <span className="text-ink">• {t}</span>
                  {podeEditar && <button type="button" onClick={() => setLivres((l) => l.filter((x) => x !== t))} className="text-faint underline" aria-label={`Remover ${t}`}>remover</button>}
                </li>
              ))}
            </ul>
          )}
          {podeEditar && (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="sr-only">Qual especialidade você fez?</span>
                <input value={novoLivre} onChange={(ev) => setNovoLivre(ev.target.value)} placeholder="Qual especialidade você fez?"
                  className="w-full text-sm rounded-lg border border-line px-3 py-1.5" />
              </label>
              <button type="button" onClick={() => { const t = novoLivre.trim(); if (t && !livres.includes(t)) setLivres((l) => [...l, t]); setNovoLivre('') }}
                className="min-h-[36px] rounded-lg border border-line px-3 text-xs font-semibold text-muted">Adicionar</button>
            </div>
          )}
        </div>
      )}
      {erro && <p role="alert" className="text-red-700 mt-1">{erro}</p>}
      {podeEditar && mudou && (
        <button type="button" onClick={salvar} disabled={salvando} className="mt-2 min-h-[36px] rounded-lg bg-brand text-white px-3 py-1 text-xs font-bold disabled:opacity-60">
          {salvando ? 'Salvando…' : 'Salvar escolha'}
        </button>
      )}
    </fieldset>
  )
}

// Histórico por TENTATIVA (requisito_historico, migration 87): cada tentativa mostra a evidência
// enviada NAQUELE momento (não só a atual — a Tentativa 1 continua existindo mesmo depois da
// correção/reenvio) e a decisão que recebeu. Buscado sob demanda pra não pesar a carga inicial.
function HistoricoPorTentativa({ memberRequirementId }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    if (!memberRequirementId) return
    carregarHistoricoRequisito(memberRequirementId)
      .then((d) => { if (vivo) setDados(d) })
      .catch((e) => { if (vivo) setErro(e?.message || 'Não consegui carregar o histórico.') })
    return () => { vivo = false }
  }, [memberRequirementId])

  if (erro) return <p className="text-xs text-red-700 mt-1.5">{erro}</p>
  if (!dados) return <p className="text-xs text-faint mt-1.5">Carregando histórico...</p>

  const tentativas = dados.tentativas || []
  return (
    <ol className="mt-1.5 space-y-2">
      {tentativas.map((tt) => (
        <li key={tt.submission_id} className="text-xs bg-surface2 rounded-lg px-3 py-2 border-l-2 border-line">
          <div className="font-semibold text-ink mb-1">Tentativa {tt.tentativa_numero} · enviado em {fmtData(tt.enviado_em)}</div>
          {tt.evidencia_texto && <p className="text-muted italic mb-1">"{tt.evidencia_texto}"</p>}
          {tt.evidencia_path && <Comprovacao valor={tt.evidencia_path} alt={`evidência da tentativa ${tt.tentativa_numero}`} classImg="w-24 h-24 object-cover rounded-lg mb-1" />}
          {tt.decisao ? (
            <div className={tt.decisao === 'aprovado' ? 'text-green-700' : 'text-red-700'}>
              <span className="font-semibold">{tt.decisao === 'aprovado' ? '✅ Aprovado' : '↺ Correção solicitada'}</span>
              {' '}por {tt.avaliado_por_nome} ({tt.avaliado_papel}) em {fmtData(tt.avaliado_em)}
              {tt.comentario && <div className="italic mt-0.5 text-ink">"{tt.comentario}"</div>}
            </div>
          ) : (
            <div className="text-amber-800">⏳ Ainda aguardando avaliação.</div>
          )}
        </li>
      ))}
    </ol>
  )
}

// "Origem do requisito": proveniência sob demanda (auditoria/liderança) — não polui o card.
function OrigemDoRequisito({ requirementId }) {
  const [origem, setOrigem] = useState(null)
  const [abrindo, setAbrindo] = useState(false)
  async function verOrigem() {
    setAbrindo(true)
    try { setOrigem(await carregarOrigemRequisito(requirementId)) } catch (e) { avisar.erro(e) } finally { setAbrindo(false) }
  }
  return (
    <>
      <button onClick={verOrigem} disabled={abrindo} className="text-xs text-faint underline">
        {abrindo ? 'Carregando…' : 'Origem do requisito'}
      </button>
      {origem && <OrigemRequisito origem={origem} onFechar={() => setOrigem(null)} />}
    </>
  )
}

function OrigemRequisito({ origem, onFechar }) {
  const req = origem.requisito || {}
  const classe = origem.classe || {}
  const versao = origem.versao || {}
  const omd = (o, rotulo) => o && (
    <li><span className="font-semibold">{rotulo}:</span> {o.id} — {o.titulo} ({fmtData(o.data)}){o.url && <> · <a href={o.url} target="_blank" rel="noreferrer" className="underline">documento</a></>}</li>
  )
  return (
    <div role="dialog" aria-modal="true" aria-label="Origem do requisito" className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onFechar}>
      <div className="bg-surface rounded-2xl p-4 w-full max-w-md max-h-[85vh] overflow-y-auto shadow-soft text-xs text-muted space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h4 className="font-extrabold text-ink text-sm">Origem do requisito</h4>
          <button onClick={onFechar} className="text-faint text-2xl leading-none min-w-[44px] min-h-[44px]" aria-label="Fechar">×</button>
        </div>
        <p className="text-ink">{req.codigo}. {req.descricao}</p>
        <ul className="space-y-1">
          {req.manifesto_id && <li><span className="font-semibold">Item no manifesto:</span> <code>{req.manifesto_id}</code></li>}
          {req.status_fonte && <li><span className="font-semibold">Situação na fonte:</span> {req.status_fonte === 'ALTERADO_POR_OMD' ? 'alterado por OMD' : 'confirmado'}</li>}
          {omd(req.alterado_por_omd, 'Alterado por')}
          {omd(req.confirmado_por_omd, 'Confirmado por')}
          {req.observacao_fonte && <li><span className="font-semibold">Observação:</span> {req.observacao_fonte}</li>}
          {req.conteudo_dinamico && <li><span className="font-semibold">Conteúdo anual:</span> {req.conteudo_dinamico.nome} (<code>{req.conteudo_dinamico.chave}</code>)</li>}
          {req.escolha && <li><span className="font-semibold">Regra:</span> {req.escolha.n_minimo} de {req.escolha.opcoes?.length || 'qualquer'}{req.escolha.sem_repeticao ? ', sem repetir' : ''}</li>}
        </ul>
        <div className="border-t border-line pt-2 space-y-1">
          <div><span className="font-semibold">Classe:</span> {classe.nome}{classe.idade_minima != null ? ` · a partir de ${classe.idade_minima} anos` : ''}</div>
          {classe.fonte_url && <div><span className="font-semibold">Página oficial:</span> <a href={classe.fonte_url} target="_blank" rel="noreferrer" className="underline break-all">{classe.fonte_url}</a></div>}
          {classe.fonte_publicado_em && <div><span className="font-semibold">Carimbo da página:</span> {fmtData(classe.fonte_publicado_em)} (não é a vigência)</div>}
          {classe.vigente_desde && <div><span className="font-semibold">Vigente desde:</span> {fmtData(classe.vigente_desde)}</div>}
        </div>
        <div className="border-t border-line pt-2 space-y-1">
          <div><span className="font-semibold">Versão:</span> {versao.identificador} {versao.versao} ({ORIGEM_ROTULO[versao.origem] || versao.origem}) · {VERSAO_ROTULO[versao.status] || versao.status}</div>
          {versao.manifesto_versao && <div><span className="font-semibold">Manifesto:</span> {versao.manifesto_versao}, gerado em {fmtData(versao.gerado_em)}</div>}
          {versao.importado_em && <div><span className="font-semibold">Importado em:</span> {fmtData(versao.importado_em)}</div>}
          {versao.fonte_hash && <div className="break-all"><span className="font-semibold">Hash:</span> <code>{versao.fonte_hash}</code></div>}
        </div>
      </div>
    </div>
  )
}
