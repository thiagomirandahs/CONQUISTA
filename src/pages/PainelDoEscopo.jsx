import { useState, useEffect, useCallback } from 'react'
import { Botao, Campo, Selo, Carregando, Aviso } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import {
  carregarPainelAnalitico, carregarVisitasDoEscopo, agendarVisita, atualizarVisita,
} from '../services/institucional.js'

// Painel analítico + visitas do portal institucional (migrations 141/142). Mobile-first: cartões
// empilhados, números grandes, botões ≥44px, nada de neon. O servidor só devolve AGREGADO — aqui não
// existe (nem poderia existir) nome de criança, foto, chat, evidência ou valor financeiro.

const PAPEL_CLUBE = { desbravador: 'Desbravadores', conselheiro: 'Conselheiros', instrutor: 'Instrutores', diretoria: 'Diretoria', tesoureiro: 'Tesouraria' }
const ASSINATURA = {
  ativa: ['ok', 'Assinatura ativa'], teste: ['info', 'Em teste'], pendente: ['atencao', 'Assinatura pendente'],
  suspensa: ['perigo', 'Suspensa'], cancelada: ['neutro', 'Cancelada'], sem_assinatura: ['neutro', 'Sem assinatura'],
}
const STATUS_VISITA = { agendada: ['atencao', 'Agendada'], confirmada: ['ok', 'Confirmada'], realizada: ['info', 'Realizada'], cancelada: ['neutro', 'Cancelada'] }
const TIPO = { campo: 'Associação/Missão', regiao: 'Região', distrito: 'Distrito' }

export const fmtDia = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}
export const fmtQuando = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
// valor de <input type="datetime-local"> (hora do aparelho) → ISO
export const localParaIso = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : null }
const n = (v) => Number(v || 0)

export function PainelAnalitico({ escopoId, aoAgendado, versao }) {
  const [filtro, setFiltro] = useState('')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => { setFiltro('') }, [escopoId])
  useEffect(() => {
    let vivo = true
    setDados(null); setErro('')
    carregarPainelAnalitico(filtro || null)
      .then((d) => { if (vivo) setDados(d) })
      .catch((e) => { if (vivo) setErro(e?.message || String(e)) })
    return () => { vivo = false }
  }, [escopoId, filtro, versao])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar o painel">{erro}</Aviso>
  if (!dados) return <Carregando linhas={2} texto="Somando os números dos clubes" />
  if (dados.sem_escopo) return <p className="text-sm text-faint">Seu papel neste escopo não inclui o painel dos clubes.</p>

  const t = dados.totais || {}
  const clubes = dados.clubes || []
  const filtros = dados.filtros || []
  return (
    <section aria-labelledby="t-painel" className="mb-5">
      <h2 id="t-painel" className="text-sm font-extrabold text-ink mb-2">Painel dos clubes</h2>
      {filtros.length > 0 && (
        <label className="block mb-3">
          <span className="text-xs text-muted">Filtrar por região/distrito</span>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
            <option value="">Todo o escopo</option>
            {filtros.map((f) => <option key={f.id} value={f.id}>{TIPO[f.tipo] || f.tipo} — {f.nome}</option>)}
          </select>
        </label>
      )}
      <dl className="grid grid-cols-2 gap-2 mb-3" data-testid="painel-totais">
        <Total rotulo="Clubes" valor={n(t.clubes)} />
        <Total rotulo="Membros ativos" valor={n(t.membros)} />
        <Total rotulo="Classes em andamento" valor={n(t.classes_em_andamento)} />
        <Total rotulo="Classes concluídas" valor={n(t.classes_concluidas)} />
        <Total rotulo="Investidos" valor={n(t.classes_investidas)} />
        <Total rotulo="Avaliações pendentes" valor={n(t.avaliacoes_pendentes)} alerta={n(t.avaliacoes_pendentes) > 0} />
        <Total rotulo="Usaram em 30 dias" valor={n(t.ativos_30d)} />
        <Total rotulo="Cadastros aguardando" valor={n(t.cadastros_pendentes)} alerta={n(t.cadastros_pendentes) > 0} />
      </dl>
      {clubes.length === 0 ? (
        <div className="bg-surface rounded-2xl p-5 shadow-soft text-sm text-faint">Nenhum clube está ligado a este escopo ainda.</div>
      ) : (
        <ul className="space-y-2">{clubes.map((c) => <CardClube key={c.club_id} c={c} aoAgendado={aoAgendado} />)}</ul>
      )}
    </section>
  )
}

function Total({ rotulo, valor, alerta }) {
  return (
    <div className={`rounded-2xl p-3 ${alerta ? 'bg-amber-50 border border-amber-200' : 'bg-surface shadow-soft'}`}>
      <dt className="text-xs text-muted leading-tight">{rotulo}</dt>
      <dd className="text-xl font-extrabold text-ink">{valor}</dd>
    </div>
  )
}

function CardClube({ c, aoAgendado }) {
  const [aberto, setAberto] = useState(false)
  const [agendando, setAgendando] = useState(false)
  const [tom, rotAssin] = ASSINATURA[c.cadastro?.assinatura] || ASSINATURA.sem_assinatura
  const lugar = [c.distrito?.nome, c.regiao?.nome].filter(Boolean).join(' · ')
  const porPapel = Object.entries(c.membros?.por_papel || {})
  const porClasse = c.classes?.por_classe || []
  return (
    <li className="bg-surface rounded-2xl shadow-soft" data-testid="painel-clube">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}
        className="w-full text-left p-4 min-h-[44px]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-ink truncate">{c.nome}</div>
            {lugar && <div className="text-xs text-faint truncate">{lugar}</div>}
          </div>
          <span className="text-xs text-faint shrink-0">{n(c.membros?.total)} membros</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          <Selo tom={tom}>{rotAssin}</Selo>
          {c.status !== 'ativo' && <Selo tom="perigo">Clube {c.status}</Selo>}
          {n(c.avaliacoes_pendentes) > 0 && <Selo tom="atencao">{n(c.avaliacoes_pendentes)} avaliações</Selo>}
          {n(c.pendencias?.cadastros) > 0 && <Selo tom="atencao">{n(c.pendencias.cadastros)} cadastros</Selo>}
          {c.proxima_visita && <Selo tom="info">Visita {fmtQuando(c.proxima_visita)}</Selo>}
        </div>
        <p className="text-xs text-muted mt-2">
          {n(c.atividade?.ativos_7d)} usaram em 7 dias · {n(c.atividade?.ativos_30d)} em 30 · último uso {fmtDia(c.atividade?.ultimo_uso)}
        </p>
      </button>
      {aberto && (
        <div className="px-4 pb-4 border-t border-line pt-3 text-xs">
          <Linhas titulo="Membros por papel" itens={porPapel.map(([p, v]) => [PAPEL_CLUBE[p] || p, v])} />
          <Linhas titulo="Clube" itens={[
            ['Unidades', n(c.unidades)],
            ['Envios de requisito (30 dias)', n(c.atividade?.envios_30d)],
            ['Pedido de região pendente', c.pendencias?.pedido_regiao ? 'Sim' : 'Não'],
            ['Assinatura válida até', fmtDia(c.cadastro?.valida_ate)],
          ]} />
          <p className="font-semibold text-muted mt-2 mb-1">Classes (andamento · concluídas · investidas)</p>
          {porClasse.length === 0 ? <p className="text-faint">Nenhuma matrícula em classe.</p> : (
            <ul>
              {porClasse.map((k) => (
                <li key={k.classe} className="flex justify-between gap-2 py-1 border-b border-line last:border-0">
                  <span className="text-ink">{k.classe}</span>
                  <span className="font-bold text-ink shrink-0">{n(k.em_andamento)} · {n(k.concluidas)} · {n(k.investidas)}</span>
                </li>
              ))}
            </ul>
          )}
          {agendando ? (
            <div className="mt-3">
              <AgendarVisita clube={c} aoFechar={() => setAgendando(false)} aoAgendado={() => { setAgendando(false); aoAgendado?.() }} />
            </div>
          ) : (
            <Botao variacao="contorno" className="w-full mt-3" aoTocar={() => setAgendando(true)}>Agendar visita</Botao>
          )}
        </div>
      )}
    </li>
  )
}

function Linhas({ titulo, itens }) {
  if (itens.length === 0) return null
  return (
    <div className="mb-2">
      <p className="font-semibold text-muted mb-1">{titulo}</p>
      <dl>
        {itens.map(([r, v]) => (
          <div key={r} className="flex justify-between gap-2 py-1">
            <dt className="text-faint">{r}</dt><dd className="font-bold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ----------------------------------------------------------------------------------------------
export function AgendarVisita({ clube, aoFechar, aoAgendado }) {
  const [quando, setQuando] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const salvar = async () => {
    const iso = localParaIso(quando)
    if (!iso) { avisar.info('Escolha a data e a hora.'); return }
    setSalvando(true)
    try {
      await agendarVisita({ clubId: clube.club_id, quando: iso, objetivo, observacao: obs || null })
      avisar.sucesso('Visita agendada. A diretoria do clube foi avisada.')
      aoAgendado()
    } catch (e) { avisar.erro(e) } finally { setSalvando(false) }
  }
  return (
    <section className="rounded-2xl border border-line bg-surface2 p-3" aria-label={`Agendar visita — ${clube.nome}`} data-testid="agendar-visita">
      <h3 className="text-sm font-extrabold text-ink mb-3">Agendar visita — {clube.nome}</h3>
      <Campo id="vis-quando" rotulo="Data e hora" tipo="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
      <Campo id="vis-objetivo" rotulo="Objetivo" value={objetivo} maxLength={200} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: conhecer a diretoria" />
      <Campo id="vis-obs" rotulo="Observação (opcional)" linhas={3} value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Botao variacao="secundario" aoTocar={aoFechar} desabilitado={salvando}>Cancelar</Botao>
        <Botao variacao="contorno" carregando={salvando} desabilitado={objetivo.trim().length < 3 || !quando} aoTocar={salvar}>Agendar</Botao>
      </div>
    </section>
  )
}

export function VisitasDoEscopo({ escopoId, versao, aoMudar }) {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const recarregar = useCallback(() => {
    setErro('')
    carregarVisitasDoEscopo().then(setLista).catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar, escopoId, versao])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar as visitas">{erro}</Aviso>
  if (lista === null) return <Carregando linhas={1} texto="Carregando visitas" />
  const depois = () => { recarregar(); aoMudar?.() }
  return (
    <section aria-labelledby="t-visitas" className="mb-5">
      <h2 id="t-visitas" className="text-sm font-extrabold text-ink mb-2">Visitas aos clubes ({lista.length})</h2>
      {lista.length === 0 ? (
        <p className="text-sm text-faint">Nenhuma visita ainda. Abra um clube no painel para agendar.</p>
      ) : (
        <ul className="space-y-2">{lista.map((v) => <CartaoVisita key={v.id} v={v} depois={depois} />)}</ul>
      )}
    </section>
  )
}

function CartaoVisita({ v, depois }) {
  const [modo, setModo] = useState(null) // 'reagendar' | 'cancelar' | 'realizada'
  const [quando, setQuando] = useState('')
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [tom, rot] = STATUS_VISITA[v.status] || ['neutro', v.status]
  const aberta = v.status === 'agendada' || v.status === 'confirmada'

  const enviar = async () => {
    setSalvando(true)
    try {
      await atualizarVisita(v.id, modo, { quando: modo === 'reagendar' ? localParaIso(quando) : null, texto: texto || null })
      avisar.sucesso(modo === 'realizada' ? 'Relatório registrado.' : modo === 'cancelar' ? 'Visita cancelada.' : 'Visita remarcada.')
      setModo(null); setTexto(''); setQuando('')
      depois()
    } catch (e) { avisar.erro(e) } finally { setSalvando(false) }
  }

  return (
    <li className="bg-surface rounded-2xl p-4 shadow-soft" data-testid="visita">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-ink truncate">{v.clube}</div>
          <div className="text-xs text-muted">{fmtQuando(v.agendada_para)} · {v.objetivo}</div>
        </div>
        <Selo tom={tom}>{rot}</Selo>
      </div>
      <p className="text-xs text-faint mt-1">Por {v.agendada_por?.unidade?.nome}{v.agendada_por?.nome ? ` (${v.agendada_por.nome})` : ''}</p>
      {v.observacao && <p className="text-xs text-ink mt-1">{v.observacao}</p>}
      {v.sugestao && aberta && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded-xl p-2 mt-2">
          O clube sugeriu {fmtQuando(v.sugestao.para)}{v.sugestao.obs ? ` — ${v.sugestao.obs}` : ''}
        </p>
      )}
      {v.motivo_cancelamento && <p className="text-xs text-muted mt-1">Motivo: {v.motivo_cancelamento}</p>}
      {v.relatorio && (
        <div className="mt-2 rounded-xl bg-surface2 p-2">
          <p className="text-xs font-semibold text-muted">Relatório</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{v.relatorio}</p>
        </div>
      )}
      {v.pode_editar && aberta && !modo && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Botao variacao="secundario" aoTocar={() => setModo('reagendar')}>Remarcar</Botao>
          <Botao variacao="secundario" aoTocar={() => setModo('cancelar')}>Cancelar</Botao>
          <Botao variacao="contorno" aoTocar={() => setModo('realizada')}>Realizada</Botao>
        </div>
      )}
      {modo && (
        <div className="mt-3">
          {modo === 'reagendar' && (
            <>
              <Campo id={`vq-${v.id}`} rotulo="Nova data e hora" tipo="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
              {v.sugestao && (
                <button type="button" className="text-xs font-bold text-brand underline min-h-[44px] mb-2"
                  onClick={() => { const d = new Date(v.sugestao.para); const p = (x) => String(x).padStart(2, '0'); setQuando(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`) }}>
                  Usar a data sugerida pelo clube
                </button>
              )}
            </>
          )}
          <Campo id={`vt-${v.id}`} linhas={modo === 'realizada' ? 4 : 2} maxLength={modo === 'realizada' ? 4000 : 500}
            rotulo={modo === 'realizada' ? 'Relatório curto da visita' : modo === 'cancelar' ? 'Motivo (opcional)' : 'Observação (opcional)'}
            value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Botao variacao="secundario" desabilitado={salvando} aoTocar={() => { setModo(null); setTexto('') }}>Voltar</Botao>
            <Botao variacao="contorno" carregando={salvando}
              desabilitado={(modo === 'reagendar' && !quando) || (modo === 'realizada' && texto.trim().length < 10)} aoTocar={enviar}>
              Salvar
            </Botao>
          </div>
        </div>
      )}
    </li>
  )
}
