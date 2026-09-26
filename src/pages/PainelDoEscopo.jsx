import { useState, useEffect, useCallback } from 'react'
import { Botao, Campo, Card, CardAcao, Selo, Carregando, Aviso, Vazio, Progresso, mensagemDeErro } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { ClubeAvatar } from '../components/admin/AdminUI.jsx'
import {
  carregarClubeDetalhe, carregarVisitasDoEscopo, agendarVisita, atualizarVisita,
} from '../services/institucional.js'
import { ResumoAvaliacao } from '../components/AvaliacaoVisita.jsx'

// =============================================================================
//  Peças do portal da coordenação (migrations 141/142/300). Mesmo visual das telas do clube
//  (Card, Selo, Abas, Vazio — src/ui). Mobile-first: cartões empilhados, números grandes, alvos 44px.
//  O servidor só devolve AGREGADO e nada comercial: aqui não existe (nem poderia existir) nome de
//  criança, foto, chat, evidência, valor financeiro, plano ou assinatura.
// =============================================================================

export const PAPEL_CLUBE = {
  desbravador: 'Desbravadores', conselheiro: 'Conselheiros', conselheiro_associado: 'Conselheiros associados',
  instrutor: 'Instrutores', diretoria: 'Diretoria', tesoureiro: 'Tesouraria', secretario: 'Secretaria',
}
const STATUS_VISITA = { agendada: ['atencao', 'Agendada'], confirmada: ['ok', 'Confirmada'], realizada: ['info', 'Realizada'], cancelada: ['neutro', 'Cancelada'] }
export const TIPO_UNIDADE = { campo: 'Associação/Missão', regiao: 'Região', distrito: 'Distrito' }

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
export const n = (v) => Number(v || 0)
export const lugarDoClube = (c) => [c?.distrito?.nome, c?.regiao?.nome].filter(Boolean).join(' · ')
export const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v))}%`)
export const semUso = (c) => c?.atividade?.dias_sem_uso === null || c?.atividade?.dias_sem_uso === undefined
  ? !c?.atividade?.ultimo_uso : n(c.atividade.dias_sem_uso) >= 14

// ---------------------------------------------------------------- peças visuais
export function Numero({ icone, rotulo, valor, detalhe, alerta }) {
  return (
    <div className={`rounded-2xl p-3 ${alerta ? 'bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-400/30' : 'bg-surface shadow-soft'}`}>
      <dt className="text-xs text-muted leading-tight">{icone && <span aria-hidden="true">{icone} </span>}{rotulo}</dt>
      <dd className="text-2xl font-extrabold text-ink leading-tight mt-0.5">{valor}</dd>
      {detalhe && <dd className="text-xs text-faint leading-tight mt-0.5">{detalhe}</dd>}
    </div>
  )
}

export function Secao({ id, icone, titulo, subtitulo, children, acao }) {
  return (
    <Card as="section" aria-labelledby={`tit-${id}`} className="mb-3">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 id={`tit-${id}`} className="font-extrabold text-ink text-lg leading-tight"><span aria-hidden="true">{icone} </span>{titulo}</h2>
          {subtitulo && <p className="text-xs text-muted mt-0.5">{subtitulo}</p>}
        </div>
        {acao}
      </div>
      {children}
    </Card>
  )
}

export function Avatar({ clube, tamanho = 'md' }) {
  return <ClubeAvatar nome={clube?.nome || ''} logoUrl={clube?.marca?.logo_url} cor={clube?.marca?.cor} sigla={clube?.marca?.sigla} tamanho={tamanho} />
}

// Cartão de um clube na lista (toque abre a página do clube)
export function CartaoClube({ c, aoAbrir }) {
  const lugar = lugarDoClube(c)
  const pres = c.presenca?.media_pct_30d
  return (
    <li data-testid="painel-clube">
      <CardAcao aoTocar={() => aoAbrir(c)} aria-label={`Abrir ${c.nome}`}>
        <div className="flex items-center gap-3">
          <Avatar clube={c} />
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-ink truncate">{c.nome}</div>
            {lugar && <div className="text-xs text-faint truncate">{lugar}</div>}
          </div>
          <span aria-hidden="true" className="text-faint">›</span>
        </div>
        <dl className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="rounded-xl bg-surface2 py-2"><dt className="text-[11px] text-muted">Membros</dt><dd className="font-extrabold text-ink">{n(c.membros?.total)}</dd></div>
          <div className="rounded-xl bg-surface2 py-2"><dt className="text-[11px] text-muted">Presença</dt><dd className="font-extrabold text-ink">{pct(pres)}</dd></div>
          <div className="rounded-xl bg-surface2 py-2"><dt className="text-[11px] text-muted">Ativos 30d</dt><dd className="font-extrabold text-ink">{n(c.atividade?.ativos_30d)}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-1 mt-2">
          {c.status !== 'ativo' && <Selo tom="perigo">Clube {c.status}</Selo>}
          {semUso(c) && <Selo tom="perigo">Sem uso há 14+ dias</Selo>}
          {n(c.avaliacoes_pendentes) > 0 && <Selo tom="atencao">{n(c.avaliacoes_pendentes)} avaliações</Selo>}
          {n(c.pendencias?.cadastros) > 0 && <Selo tom="atencao">{n(c.pendencias.cadastros)} cadastros</Selo>}
          {n(c.investiduras?.previstas) > 0 && <Selo tom="info">{n(c.investiduras.previstas)} p/ investir</Selo>}
          {c.proxima_visita && <Selo tom="ok">Visita {fmtQuando(c.proxima_visita)}</Selo>}
        </div>
      </CardAcao>
    </li>
  )
}

// ---------------------------------------------------------------- página do clube
function Tendencia({ atual, anterior, sufixo = '' }) {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return null
  const d = Math.round(Number(atual) - Number(anterior))
  if (d === 0) return <span className="text-xs text-faint">= mês anterior</span>
  return <span className={`text-xs font-bold ${d > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
    {d > 0 ? '▲' : '▼'} {Math.abs(d)}{sufixo} vs mês anterior</span>
}

function Linhas({ itens }) {
  return (
    <dl>
      {itens.map(([r, v]) => (
        <div key={r} className="flex justify-between gap-2 py-2 border-b border-line last:border-0">
          <dt className="text-sm text-muted">{r}</dt><dd className="text-sm font-extrabold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function TabelaDeClasses({ classes }) {
  if (!classes?.length) return <p className="text-sm text-faint">Nenhuma matrícula em classe ainda.</p>
  const grupos = [['regular', 'Classes regulares'], ['avancada', 'Classes avançadas']]
  return (
    <div>
      {grupos.map(([tipo, titulo]) => {
        const lista = classes.filter((k) => (k.tipo || 'regular') === tipo)
        if (!lista.length) return null
        return (
          <div key={tipo} className="mb-2">
            <p className="text-xs font-bold text-muted mb-1">{titulo}</p>
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-faint"><th className="text-left font-semibold py-1">Classe</th>
                <th className="font-semibold">Andamento</th><th className="font-semibold">Concluídas</th><th className="font-semibold">Investidas</th></tr></thead>
              <tbody>
                {lista.map((k) => (
                  <tr key={k.classe} className="border-t border-line">
                    <td className="py-2 text-ink font-semibold">{k.classe}</td>
                    <td className="text-center font-bold text-ink">{n(k.em_andamento)}</td>
                    <td className="text-center font-bold text-ink">{n(k.concluidas)}</td>
                    <td className="text-center font-bold text-ink">{n(k.investidas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

export function ClubeDetalhe({ clubId, resumo, aoVoltar, aoMudar }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  const [visitas, setVisitas] = useState(null)
  const [agendando, setAgendando] = useState(false)

  const recarregarVisitas = useCallback(() => {
    carregarVisitasDoEscopo(clubId).then(setVisitas).catch(() => setVisitas([]))
  }, [clubId])
  useEffect(() => {
    let vivo = true
    setDados(null); setErro(null)
    carregarClubeDetalhe(clubId).then((d) => { if (vivo) setDados(d) }).catch((e) => { if (vivo) setErro(e) })
    recarregarVisitas()
    return () => { vivo = false }
  }, [clubId, recarregarVisitas])

  const clube = dados?.clube || resumo || {}
  const voltar = (
    <button type="button" onClick={aoVoltar} className="min-h-[44px] -ml-1 px-1 text-sm font-bold text-brand">‹ Voltar aos clubes</button>
  )
  const depoisVisita = () => { recarregarVisitas(); aoMudar?.() }

  return (
    <div data-testid="clube-detalhe">
      {voltar}
      <Card className="mb-3">
        <div className="flex items-center gap-3">
          <Avatar clube={clube} tamanho="lg" />
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-ink leading-tight">{clube.nome}</h2>
            {lugarDoClube(clube) && <p className="text-sm text-muted">{lugarDoClube(clube)}</p>}
            {clube.status && clube.status !== 'ativo' && <Selo tom="perigo" className="mt-1">Clube {clube.status}</Selo>}
          </div>
        </div>
      </Card>

      {erro && <Aviso tom="erro" titulo="Não deu pra abrir este clube">{mensagemDeErro(erro)}</Aviso>}
      {!dados && !erro && <Carregando linhas={4} texto="Abrindo o clube" />}
      {dados && <CorpoDoClube d={dados} />}

      <Secao id="visitas-clube" icone="📅" titulo="Visitas da coordenação"
        acao={!agendando && <Botao variacao="contorno" aoTocar={() => setAgendando(true)}>Agendar</Botao>}>
        {agendando && (
          <div className="mb-3">
            <AgendarVisita clube={{ club_id: clubId, nome: clube.nome }} aoFechar={() => setAgendando(false)}
              aoAgendado={() => { setAgendando(false); depoisVisita() }} />
          </div>
        )}
        {visitas === null ? <Carregando linhas={1} texto="Carregando visitas" />
          : visitas.length === 0 ? <p className="text-sm text-faint">Nenhuma visita a este clube ainda.</p>
            : <ul className="space-y-2">{visitas.map((v) => <CartaoVisita key={v.id} v={v} depois={depoisVisita} semClube />)}</ul>}
      </Secao>
    </div>
  )
}

function CorpoDoClube({ d }) {
  const m = d.membros || {}
  const p = d.presenca || {}
  const a = d.atividade || {}
  const inv = d.investiduras || {}
  const ag = d.agenda || {}
  const unidades = d.unidades || []
  const porPapel = Object.entries(m.por_papel || {}).filter(([k]) => k !== 'desbravador')
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 mb-3" data-testid="clube-numeros">
        <Numero icone="🧭" rotulo="Desbravadores" valor={n(m.desbravadores)} />
        <Numero icone="🎖️" rotulo="Liderança" valor={n(m.lideranca)} />
        <Numero icone="✅" rotulo="Presença média" valor={pct(p.media_pct)} detalhe={p.reunioes?.length ? `últimas ${p.reunioes.length} reuniões` : 'sem chamada registrada'} />
        <Numero icone="📱" rotulo="Usaram em 7 dias" valor={n(a.ativos_7d)} detalhe={`${n(a.ativos_30d)} em 30 dias`} />
        <Numero icone="📝" rotulo="Avaliações pendentes" valor={n(d.avaliacoes_pendentes)} alerta={n(d.avaliacoes_pendentes) >= 10} />
        <Numero icone="⏳" rotulo="Cadastros aguardando" valor={n(d.cadastros_pendentes)} alerta={n(d.cadastros_pendentes) > 0} />
      </dl>

      <Secao id="tendencia" icone="📈" titulo="Tendência" subtitulo="Mês atual comparado ao anterior">
        <Linhas itens={[
          ['Membros ativos agora', <span key="m">{n(m.total)} <Tendencia atual={m.total} anterior={m.inicio_do_mes} /></span>],
          ['Entraram neste mês', n(m.entraram_no_mes)],
          ['Presença neste mês', <span key="p">{pct(p.mes_atual_pct)} <Tendencia atual={p.mes_atual_pct} anterior={p.mes_anterior_pct} sufixo=" p.p." /></span>],
          ['Último uso do app', fmtDia(a.ultimo_uso)],
          ['Envios de requisito (30 dias)', n(a.envios_30d)],
        ]} />
      </Secao>

      <Secao id="presenca" icone="📋" titulo="Presença nas reuniões" subtitulo="Pela chamada (Apontamento) do clube — só percentuais">
        {!p.reunioes?.length ? <p className="text-sm text-faint">O clube ainda não registrou chamada nos últimos dias.</p> : (
          <ul className="space-y-2">
            {p.reunioes.map((r) => (
              <li key={r.dia}><Progresso valor={n(r.presentes)} total={n(r.total)} rotulo={`${fmtDia(r.dia)} · ${n(r.presentes)} de ${n(r.total)}`} /></li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao id="membros" icone="👥" titulo="Membros" subtitulo={`${n(m.total)} ativos`}>
        <Linhas itens={[['Desbravadores', n(m.desbravadores)], ...porPapel.map(([k, v]) => [PAPEL_CLUBE[k] || k, n(v)])]} />
      </Secao>

      <Secao id="unidades" icone="🏕️" titulo="Unidades" subtitulo={`${unidades.length} ${unidades.length === 1 ? 'unidade' : 'unidades'}`}>
        {unidades.length === 0 ? <p className="text-sm text-faint">O clube ainda não cadastrou unidades.</p> : (
          <ul className="grid grid-cols-2 gap-2">
            {unidades.map((u) => (
              <li key={u.id} className="rounded-xl bg-surface2 p-3 flex items-center gap-2 min-w-0">
                <span aria-hidden="true" className="h-3 w-3 rounded-full shrink-0" style={{ background: /^#[0-9a-f]{3,6}$/i.test(u.cor || '') ? u.cor : '#94a3b8' }} />
                <span className="min-w-0"><span className="block text-sm font-bold text-ink truncate">{u.nome}</span>
                  <span className="block text-xs text-faint">{n(u.membros)} membros</span></span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao id="classes" icone="🎓" titulo="Classes" subtitulo="Em andamento · concluídas · investidas">
        <TabelaDeClasses classes={d.classes} />
      </Secao>

      <Secao id="investiduras" icone="🏅" titulo="Investiduras">
        <Linhas itens={[
          ['Previstas (aptos a investir)', n(inv.previstas)],
          ['Realizadas neste mês', n(inv.realizadas_mes)],
          ['Realizadas no ano', n(inv.realizadas_ano)],
          ['Última investidura', fmtDia(inv.ultima)],
        ]} />
      </Secao>

      <Secao id="agenda" icone="🗓️" titulo="Agenda do clube">
        <Linhas itens={[['Próximo evento', fmtDia(ag.proximo_evento)], ['Eventos nos próximos 30 dias', n(ag.eventos_30d)]]} />
        <p className="text-xs text-faint mt-2">A agenda é do clube: o portal mostra só a data e a quantidade, sem os detalhes dos eventos.</p>
      </Secao>
    </>
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
        <Botao carregando={salvando} desabilitado={objetivo.trim().length < 3 || !quando} aoTocar={salvar}>Agendar</Botao>
      </div>
    </section>
  )
}

export function VisitasDoEscopo({ escopoId, versao, aoMudar }) {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState(null)
  const recarregar = useCallback(() => {
    setErro(null)
    carregarVisitasDoEscopo().then(setLista).catch((e) => setErro(e))
  }, [])
  useEffect(() => { recarregar() }, [recarregar, escopoId, versao])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar as visitas">{mensagemDeErro(erro)}</Aviso>
  if (lista === null) return <Carregando linhas={2} texto="Carregando visitas" />
  const depois = () => { recarregar(); aoMudar?.() }
  const abertas = lista.filter((v) => v.status === 'agendada' || v.status === 'confirmada')
  const historico = lista.filter((v) => !(v.status === 'agendada' || v.status === 'confirmada'))
  if (lista.length === 0) {
    return <Vazio icone="📅" titulo="Nenhuma visita ainda">Abra um clube na aba Clubes para agendar a primeira visita.</Vazio>
  }
  return (
    <section aria-label="Visitas aos clubes">
      <h2 className="text-sm font-extrabold text-ink mb-2">Próximas ({abertas.length})</h2>
      {abertas.length === 0 ? <p className="text-sm text-faint mb-4">Nenhuma visita marcada.</p>
        : <ul className="space-y-2 mb-4">{abertas.map((v) => <CartaoVisita key={v.id} v={v} depois={depois} />)}</ul>}
      {historico.length > 0 && (
        <>
          <h2 className="text-sm font-extrabold text-ink mb-2">Histórico ({historico.length})</h2>
          <ul className="space-y-2">{historico.map((v) => <CartaoVisita key={v.id} v={v} depois={depois} />)}</ul>
        </>
      )}
    </section>
  )
}

function CartaoVisita({ v, depois, semClube }) {
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
    <li className={semClube ? 'rounded-2xl bg-surface2 p-3' : 'bg-surface rounded-2xl p-4 shadow-soft'} data-testid="visita">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {!semClube && <div className="font-bold text-ink truncate">{v.clube}</div>}
          <div className={semClube ? 'text-sm font-bold text-ink' : 'text-xs text-muted'}>{fmtQuando(v.agendada_para)} · {v.objetivo}</div>
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
      <ResumoAvaliacao a={v.avaliacao} />
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
