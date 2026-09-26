import { useState, useEffect, useCallback, useMemo } from 'react'
import { Cabecalho, Card, Botao, Aviso, Selo, Carregando, Vazio, Abas, Campo } from '../ui/index.jsx'
import { ROTULO_STATUS, formatarPreco } from '../services/comercial.js'
import {
  souAdminPlataforma, visaoGeral, clubesListar, clubeDetalhe, planosAdminListar, assinaturasListar,
  onboardingListar, planoMudar, provisionamentoPendencias, provisionamentoReexecutar,
  assinaturaTransicionar, suporteListar, suporteRevogar, auditoriaListar,
  trialPadrao, trialPadraoDefinir, trialEstender, trialEncerrar,
} from '../services/admin.js'
import { avisar } from '../ui/avisos.jsx'
import AdminHierarquia from './AdminHierarquia.jsx'
import AdminCortesias from './AdminCortesias.jsx'
import AdminVitrine from './AdminVitrine.jsx'
import { LimiteMembrosClube, LixeiraClube } from './AdminMembrosLixeira.jsx'

// /admin — Administração da PLATAFORMA (SaaS): conta, clube, plano, assinatura, armazenamento,
// onboarding, provisionamento, suporte e auditoria. Autoridade COMERCIAL, nunca eclesiástica: nenhuma
// tela aqui lê chat, foto, evidência, documento, mensalidade individual ou dado de criança — as RPCs
// (migrations 48 e 103) só devolvem metadado e contagens, e todas exigem eh_admin_plataforma() no
// servidor. O admin não ganha vínculo de clube; a Gestão do clube continua sendo da diretoria.
const ABAS = [
  { chave: 'visao', rotulo: 'Visão geral', icone: '📊' },
  { chave: 'clubes', rotulo: 'Clubes', icone: '🏕️' },
  { chave: 'hierarquia', rotulo: 'Hierarquia', icone: '🌳' },
  { chave: 'planos', rotulo: 'Planos', icone: '💳' },
  { chave: 'assinaturas', rotulo: 'Assinaturas', icone: '🧾' },
  { chave: 'cortesias', rotulo: 'Cortesias', icone: '🎁' },
  { chave: 'vitrine', rotulo: 'Vitrine do site', icone: '🪧' },
  { chave: 'armazenamento', rotulo: 'Armazenamento', icone: '💾' },
  { chave: 'onboarding', rotulo: 'Onboarding', icone: '🧭' },
  { chave: 'provisionamento', rotulo: 'Provisionamento', icone: '⚙️' },
  { chave: 'suporte', rotulo: 'Suporte', icone: '🛟' },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: '📜' },
]

const ROTULO_ARMAZENAMENTO = { sem_limite: 'Sem limite', normal: 'Normal', proximo: 'Próximo do limite', atingido: 'Limite atingido' }
const TOM_ARMAZENAMENTO = { sem_limite: 'neutro', normal: 'ok', proximo: 'atencao', atingido: 'perigo' }
const ROTULO_ONBOARDING = { em_andamento: 'Em andamento', concluido: 'Concluído', abandonado: 'Abandonado' }
const tomAssinatura = (s) => (s === 'ativa' ? 'ok' : ['inadimplente', 'suspensa', 'cancelada'].includes(s) ? 'perigo' : 'atencao')

export function formatarBytes(b) {
  const n = Number(b || 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—')

// carrega uma fonte uma vez; `recarregar` refaz
function useFonte(fn) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const recarregar = useCallback(() => {
    fn().then((d) => { setErro(''); setDados(d) }).catch((e) => setErro(e?.message || String(e)))
  }, [fn])
  useEffect(() => { recarregar() }, [recarregar])
  return { dados, erro, recarregar }
}

function Estado({ erro, dados, vazio, children }) {
  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (dados == null) return <Carregando />
  if (Array.isArray(dados) && dados.length === 0 && vazio) return vazio
  return children
}

export default function Admin() {
  const [aba, setAba] = useState('visao')
  const [clubeAberto, setClubeAberto] = useState(null)
  const [autorizado, setAutorizado] = useState(null)
  const [erroAcesso, setErroAcesso] = useState('')

  useEffect(() => {
    souAdminPlataforma().then(setAutorizado).catch((e) => { setAutorizado(false); setErroAcesso(e.message) })
  }, [])

  if (autorizado === null) return <Carregando texto="Verificando acesso" />
  if (!autorizado) {
    return (
      <div className="max-w-md mx-auto">
        <Aviso tom="erro" titulo="Área restrita">
          Esta área é exclusiva da administração da plataforma DesbravaClube — não é uma ferramenta
          de clube. {erroAcesso && <span className="block mt-1 text-xs opacity-80">{erroAcesso}</span>}
        </Aviso>
      </div>
    )
  }

  const abrirClube = (id) => { setClubeAberto(id); setAba('clubes') }
  const trocarAba = (a) => { setClubeAberto(null); setAba(a) }

  return (
    // Mobile-first: o /admin fica fora do AppLayout, então o respiro lateral (16px) é daqui.
    <div className="max-w-5xl mx-auto px-4 pt-4 pb-10">
      <header className="mb-3">
        <h1 className="text-xl font-extrabold text-ink"><span aria-hidden="true">🛠️ </span><span>Administração da Plataforma</span></h1>
        <p className="text-xs text-muted">Clubes, planos, assinaturas, hierarquia e auditoria do DesbravaClube</p>
      </header>
      <AbasDoAdmin abas={ABAS} ativa={aba} aoTrocar={trocarAba} />
      {aba === 'visao' && <VisaoGeral irPara={trocarAba} />}
      {aba === 'clubes' && (clubeAberto
        ? <DetalheClube clubId={clubeAberto} aoVoltar={() => setClubeAberto(null)} />
        : <Clubes aoAbrir={abrirClube} />)}
      {aba === 'hierarquia' && <AdminHierarquia />}
      {aba === 'planos' && <Planos />}
      {aba === 'assinaturas' && <Assinaturas aoAbrirClube={abrirClube} />}
      {aba === 'cortesias' && <AdminCortesias />}
      {aba === 'vitrine' && <AdminVitrine />}
      {aba === 'armazenamento' &&<Armazenamento aoAbrirClube={abrirClube} />}
      {aba === 'onboarding' && <Onboarding aoAbrirClube={abrirClube} />}
      {aba === 'provisionamento' && <Provisionamento />}
      {aba === 'suporte' && <Suporte />}
      {aba === 'auditoria' && <Auditoria />}
    </div>
  )
}

// ---------------------------------------------------------------- Visão geral
// Abas clean que rolam de lado no celular (a última aparece cortada = dá pra ver que tem mais).
function AbasDoAdmin({ abas, ativa, aoTrocar }) {
  return (
    <nav aria-label="Áreas da administração" className="-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <div role="tablist" className="flex w-max gap-2">
        {abas.map((a) => {
          const sel = a.chave === ativa
          return (
            <button key={a.chave} type="button" role="tab" aria-selected={sel} onClick={() => aoTrocar(a.chave)}
              className={`min-h-[40px] whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition ${sel ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-muted'}`}>
              <span aria-hidden="true">{a.icone} </span>{a.rotulo}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// Número compacto: legenda à esquerda, valor à direita — cabe o painel inteiro em meia tela.
function Metrica({ valor, rotulo, testid, aoTocar }) {
  const conteudo = (
    <>
      <span className="text-xs text-muted text-left leading-tight">{rotulo}</span>
      <span className="text-xl font-extrabold text-ink" data-testid={testid}>{valor}</span>
    </>
  )
  const base = 'flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 min-h-[52px]'
  return aoTocar
    ? <button type="button" onClick={aoTocar} className={`${base} active:bg-surface2`}>{conteudo}<span className="sr-only"> — abrir</span></button>
    : <div className={base}>{conteudo}</div>
}

function VisaoGeral({ irPara }) {
  const { dados: v, erro } = useFonte(visaoGeral)
  return (
    <Estado erro={erro} dados={v}>
      {v && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Metrica valor={v.clubes_total} rotulo="Clubes" testid="visao-clubes" aoTocar={() => irPara('clubes')} />
            <Metrica valor={v.clubes_ativos} rotulo="Clubes ativos" />
            <Metrica valor={v.onboarding_em_andamento} rotulo="Em onboarding" aoTocar={() => irPara('onboarding')} />
            <Metrica valor={v.clubes_inativos} rotulo="Inativos" />
            <Metrica valor={formatarBytes(v.armazenamento_total_bytes)} rotulo="Armazenamento total" aoTocar={() => irPara('armazenamento')} />
            <Metrica valor={v.clubes_proximos_do_limite + v.clubes_no_limite} rotulo="Clubes perto/no limite" aoTocar={() => irPara('armazenamento')} />
            <Metrica valor={v.provisionamentos_pendentes} rotulo="Provisionamentos pendentes" aoTocar={() => irPara('provisionamento')} />
            <Metrica valor={`${v.planos_publicos}/${v.planos_total}`} rotulo="Planos na vitrine / total" aoTocar={() => irPara('planos')} />
          </div>
          <Card>
            <p className="font-bold text-ink mb-2 text-sm">Assinaturas por status</p>
            {Object.keys(v.assinaturas_por_status || {}).length === 0
              ? <p className="text-sm text-muted">Nenhuma assinatura.</p>
              : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(v.assinaturas_por_status).map(([s, n]) => (
                    <Selo key={s} tom={tomAssinatura(s)}>{ROTULO_STATUS[s] || s}: {n}</Selo>
                  ))}
                </div>
              )}
          </Card>
          <TrialPadrao />
          <Card>
            <p className="font-bold text-ink mb-1 text-sm">Últimos 7 dias</p>
            <p className="text-sm text-muted">{v.eventos_admin_7d} ação(ões) de administração · {v.eventos_assinatura_7d} evento(s) de assinatura</p>
          </Card>
        </div>
      )}
    </Estado>
  )
}

// ---------------------------------------------------------------- Clubes
function Clubes({ aoAbrir }) {
  const { dados, erro } = useFonte(clubesListar)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')

  const lista = useMemo(() => (dados || []).filter((c) => {
    const t = busca.trim().toLowerCase()
    if (t && !`${c.nome} ${c.slug || ''}`.toLowerCase().includes(t)) return false
    if (filtro === 'onboarding') return c.onboarding_status === 'em_andamento'
    if (filtro === 'sem_assinatura') return !c.assinatura_id
    if (filtro === 'armazenamento') return ['proximo', 'atingido'].includes(c.armazenamento_situacao)
    if (filtro === 'inativos') return c.status !== 'ativo'
    return true
  }), [dados, busca, filtro])

  return (
    <Estado erro={erro} dados={dados} vazio={<Vazio icone="🏕️" titulo="Nenhum clube ainda" />}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Campo id="admin-busca-clube" rotulo="Buscar clube" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código" />
          <div>
            <label htmlFor="admin-filtro-clube" className="block text-sm font-medium text-ink mb-1">Filtro</label>
            <select id="admin-filtro-clube" value={filtro} onChange={(e) => setFiltro(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
              <option value="todos">Todos</option>
              <option value="onboarding">Em onboarding</option>
              <option value="sem_assinatura">Sem assinatura</option>
              <option value="armazenamento">Perto/no limite de armazenamento</option>
              <option value="inativos">Inativos</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted" role="status">{lista.length} de {(dados || []).length} clube(s)</p>
        {lista.map((c) => (
          <Card key={c.club_id} data-testid="clube-item">
            <button type="button" onClick={() => aoAbrir(c.club_id)} className="w-full text-left min-h-[44px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-ink">{c.nome}</p>
                <div className="flex flex-wrap gap-1.5">
                  {c.assinatura_status
                    ? <Selo tom={tomAssinatura(c.assinatura_status)}>{ROTULO_STATUS[c.assinatura_status] || c.assinatura_status}{c.assinatura_status === 'trial' && c.trial_ate ? ` até ${data(c.trial_ate)}` : ''}</Selo>
                    : <Selo tom="neutro">Sem assinatura</Selo>}
                  {c.onboarding_status === 'em_andamento' && <Selo tom="atencao">Onboarding: {c.onboarding_etapa}</Selo>}
                  {c.status !== 'ativo' && <Selo tom="perigo">Inativo</Selo>}
                </div>
              </div>
              <p className="text-xs text-muted mt-1">
                {c.slug || '—'} · criado em {data(c.criado_em)} · {c.plano_nome ? `${c.plano_nome} v${c.plano_versao}${c.ciclo ? ` (${c.ciclo})` : ''}` : 'sem plano'}
                {' · '}{formatarBytes(c.armazenamento_bytes)}{c.armazenamento_limite_mb ? ` de ${formatarBytes(c.armazenamento_limite_mb * 1048576)} (${c.armazenamento_pct}%)` : ' (sem limite)'}
              </p>
            </button>
          </Card>
        ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Detalhe do clube
function Secao({ titulo, children }) {
  return (
    <Card>
      <h3 className="font-bold text-ink text-sm mb-2">{titulo}</h3>
      {children}
    </Card>
  )
}

function Linha({ rotulo, children }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm border-b border-line last:border-0">
      <span className="text-muted">{rotulo}</span><span className="text-ink font-semibold text-right">{children}</span>
    </div>
  )
}

function DetalheClube({ clubId, aoVoltar }) {
  const buscar = useCallback(() => clubeDetalhe(clubId), [clubId])
  const { dados: d, erro, recarregar } = useFonte(buscar)
  const [ocupado, setOcupado] = useState(false)

  async function reexecutar() {
    setOcupado(true)
    try {
      const r = await provisionamentoReexecutar(clubId)
      if (r?.status === 'ok') avisar.sucesso('Provisionamento concluído.')
      else avisar.erro(new Error(r?.erro || 'Continua pendente.'))
      recarregar()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <div className="space-y-3">
      <Botao variacao="secundario" aoTocar={aoVoltar}>← Voltar para os clubes</Botao>
      <Estado erro={erro} dados={d}>
        {d && (() => {
          const c = d.clube
          return (
            <div className="grid gap-3 md:grid-cols-2">
              <Secao titulo="Identificação">
                <Linha rotulo="Nome">{c.nome}</Linha>
                <Linha rotulo="Código">{c.slug || '—'}</Linha>
                <Linha rotulo="Situação">{c.status === 'ativo' ? 'Ativo' : 'Inativo'}</Linha>
                <Linha rotulo="Criado em">{data(c.criado_em)}</Linha>
                <Linha rotulo="Vinculado a">{d.hierarquia ? `${d.hierarquia.nome} (${d.hierarquia.tipo})` : '—'}</Linha>
              </Secao>

              <Secao titulo="Plano e assinatura">
                {c.assinatura_id ? (
                  <>
                    <Linha rotulo="Plano">{c.plano_nome} v{c.plano_versao}</Linha>
                    <Linha rotulo="Ciclo">{c.ciclo || '—'}</Linha>
                    <Linha rotulo="Situação"><Selo tom={tomAssinatura(c.assinatura_status)}>{ROTULO_STATUS[c.assinatura_status] || c.assinatura_status}</Selo></Linha>
                    {c.trial_ate && <Linha rotulo="Teste até">{data(c.trial_ate)}</Linha>}
                    {c.periodo_fim && <Linha rotulo="Período até">{data(c.periodo_fim)}</Linha>}
                    <Linha rotulo="Pagamento">{c.provider === 'mock' || !c.provider ? 'Sem gateway — combinado fora do sistema' : c.provider}</Linha>
                    <div className="mt-3 space-y-4">
                      <TesteGratuito clubId={clubId} status={c.assinatura_status} trialAte={c.trial_ate} onFeito={recarregar} />
                      <TransicaoAssinatura assinatura={{ id: c.assinatura_id, status: c.assinatura_status }} onFeito={recarregar} />
                      <MudarPlano assinaturaId={c.assinatura_id} atual={`${c.plano_chave}|${c.plano_versao}`} onFeito={recarregar} />
                    </div>
                  </>
                ) : <p className="text-sm text-muted">Sem assinatura nem conta comercial (clube anterior ao modelo comercial, ou cadastro que ainda não chegou à etapa do clube).</p>}
              </Secao>

              <Secao titulo="Armazenamento e limites">
                <Linha rotulo="Uso">{formatarBytes(c.armazenamento_bytes)} · {c.armazenamento_objetos} arquivo(s)</Linha>
                <Linha rotulo="Limite">{c.armazenamento_limite_mb ? formatarBytes(c.armazenamento_limite_mb * 1048576) : 'Sem limite'}</Linha>
                <Linha rotulo="Situação"><Selo tom={TOM_ARMAZENAMENTO[c.armazenamento_situacao]}>{ROTULO_ARMAZENAMENTO[c.armazenamento_situacao]}{c.armazenamento_pct != null ? ` · ${c.armazenamento_pct}%` : ''}</Selo></Linha>
                {(d.limites || []).filter((l) => l.chave !== 'armazenamento_mb').map((l) => (
                  <Linha key={l.chave} rotulo={`Limite de ${l.chave}`}>{l.uso ?? '—'} de {l.teto}</Linha>
                ))}
              </Secao>

              <Secao titulo="Onboarding e provisionamento">
                {(d.onboarding || []).length === 0
                  ? <p className="text-sm text-muted">Sem sessão de onboarding registrada.</p>
                  : d.onboarding.map((o, i) => (
                    <div key={i} className="mb-2">
                      <Linha rotulo="Onboarding">{ROTULO_ONBOARDING[o.status] || o.status} · etapa {o.etapa}</Linha>
                      <Linha rotulo="Atualizado em">{dataHora(o.atualizado_em)}</Linha>
                      {o.ultimo_erro && <Linha rotulo="Último erro">{o.ultimo_erro}</Linha>}
                    </div>
                  ))}
                <Linha rotulo="Provisionamento">{d.provisionamento?.status || 'não verificado'}{d.provisionamento?.erro ? ` · ${d.provisionamento.erro}` : ''}</Linha>
                {d.provisionamento && d.provisionamento.status !== 'ok' && (
                  <div className="mt-2"><Botao variacao="secundario" aoTocar={reexecutar} carregando={ocupado}>Reexecutar provisionamento</Botao></div>
                )}
              </Secao>

              <Secao titulo="Recursos habilitados">
                {(d.recursos || []).length === 0
                  ? <p className="text-sm text-muted">Sem ajuste por clube — vale o que o plano define.</p>
                  : <div className="flex flex-wrap gap-1.5">{d.recursos.map((r) => <Selo key={r.recurso} tom={r.ligado ? 'ok' : 'neutro'}>{r.recurso}: {r.ligado ? 'ligado' : 'desligado'}</Selo>)}</div>}
              </Secao>

              <Secao titulo="Pessoas (só contagens)">
                {(d.vinculos_por_papel || []).length === 0
                  ? <p className="text-sm text-muted">Nenhum vínculo.</p>
                  : d.vinculos_por_papel.map((v) => <Linha key={`${v.papel}-${v.status}`} rotulo={`${v.papel} (${v.status})`}>{v.total}</Linha>)}
                <p className="text-xs text-faint mt-2">A administração da plataforma não vê nomes, fotos, chat, evidências nem mensalidades do clube.</p>
              </Secao>

              <LimiteMembrosClube clubId={clubId} onFeito={recarregar} />
              <LixeiraClube clubId={clubId} />

              <div className="md:col-span-2">
                <Secao titulo="Histórico administrativo">
                  {[...(d.assinatura_eventos || []).map((e) => ({ em: e.em, texto: `${e.motivo || `${e.de} → ${e.para}`} (${e.origem})` })),
                    ...(d.auditoria || []).map((a) => ({ em: a.em, texto: `${a.acao} · ${a.alvo_tipo}${a.detalhe?.motivo ? ` · ${a.detalhe.motivo}` : ''}` }))]
                    .sort((a, b) => String(b.em).localeCompare(String(a.em)))
                    .map((h, i) => <Linha key={i} rotulo={dataHora(h.em)}>{h.texto}</Linha>)}
                  {(d.assinatura_eventos || []).length + (d.auditoria || []).length === 0 && <p className="text-sm text-muted">Nenhum evento ainda.</p>}
                </Secao>
              </div>
            </div>
          )
        })()}
      </Estado>
    </div>
  )
}

// ---------------------------------------------------------------- Teste gratuito (migration 109)
export function diasRestantes(iso, agora = Date.now()) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - agora) / 86400000)
}

function CaixaClara({ titulo, children, testid }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3" data-testid={testid}>
      <p className="text-sm font-bold text-ink mb-2">{titulo}</p>
      {children}
    </div>
  )
}

function TrialPadrao() {
  const { dados, erro, recarregar } = useFonte(trialPadrao)
  const [dias, setDias] = useState('')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (dados) setDias(String(dados.trial_dias)) }, [dados])

  async function salvar() {
    const n = Number(dias)
    if (!Number.isInteger(n) || n < 0 || n > 365) { avisar.erro(null, 'Use um número inteiro de 0 a 365 dias.'); return }
    setOcupado(true)
    try {
      await trialPadraoDefinir(n)
      avisar.sucesso(`Clubes novos passam a ter ${n} dia(s) de teste.`)
      recarregar()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <Card>
      <p className="font-bold text-ink mb-1 text-sm">Teste gratuito para clubes novos</p>
      {erro ? <p className="text-sm text-red-700">{erro}</p> : dados == null ? <Carregando /> : (
        <>
          <p className="text-sm text-muted mb-3">
            Hoje: <strong className="text-ink" data-testid="trial-padrao-atual">{dados.trial_dias} dia(s)</strong>. Vale só para quem se cadastrar daqui pra frente — clubes que já estão em teste não mudam.
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Campo id="trial-padrao-dias" rotulo="Dias de teste" tipo="number" inputMode="numeric" min={0} max={365}
              value={dias} onChange={(e) => setDias(e.target.value)} />
            <div className="mb-3">
              <Botao aoTocar={salvar} carregando={ocupado} desabilitado={String(dados.trial_dias) === dias} className="w-full" data-testid="trial-padrao-salvar">
                Salvar padrão
              </Botao>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

function TesteGratuito({ clubId, status, trialAte, onFeito }) {
  const [data_, setData] = useState('')
  const [ocupado, setOcupado] = useState(null)
  const podeEstender = ['trial', 'pagamento_pendente'].includes(status)
  const emTeste = status === 'trial'
  const restam = diasRestantes(trialAte)

  async function rodar(chave, fn, ok) {
    setOcupado(chave)
    try { await fn(); avisar.sucesso(ok); setData(''); onFeito?.() } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }
  const estenderDias = (n) => rodar(`+${n}`, () => trialEstender(clubId, { dias: n, motivo: `teste gratuito +${n} dias` }), `Teste estendido em ${n} dias.`)
  const estenderData = () => {
    if (!data_) { avisar.erro(null, 'Escolha a data final do teste.'); return }
    // fim do dia escolhido, no fuso de quem está usando
    const ate = new Date(`${data_}T23:59:59`).toISOString()
    rodar('data', () => trialEstender(clubId, { ate, motivo: `teste gratuito até ${data_.split('-').reverse().join('/')}` }), 'Data do fim do teste atualizada.')
  }
  const encerrar = () => {
    if (!window.confirm('Encerrar o teste gratuito agora? O clube passa a "aguardando pagamento". Nada é apagado e nenhuma cobrança é criada.')) return
    rodar('encerrar', () => trialEncerrar(clubId, 'teste gratuito encerrado pela administração'), 'Teste gratuito encerrado.')
  }

  return (
    <CaixaClara titulo="Teste gratuito" testid="teste-gratuito">
      <p className="text-sm text-ink mb-3" data-testid="teste-gratuito-situacao">
        {emTeste
          ? <>Em teste até <strong>{data(trialAte)}</strong>{restam != null && ` · ${restam > 0 ? `faltam ${restam} dia(s)` : 'vence hoje'}`}</>
          : status === 'pagamento_pendente'
            ? <>Teste encerrado{trialAte ? ` em ${data(trialAte)}` : ''} · aguardando pagamento</>
            : <>Fora do teste ({ROTULO_STATUS[status] || status}).</>}
      </p>
      {podeEstender ? (
        <>
          <p className="text-xs font-semibold text-muted mb-1">{emTeste ? 'Estender' : 'Reabrir o teste'}</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[7, 15, 30].map((n) => (
              <Botao key={n} variacao="secundario" aoTocar={() => estenderDias(n)} carregando={ocupado === `+${n}`} desabilitado={!!ocupado}>
                +{n} dias
              </Botao>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Campo id={`trial-ate-${clubId}`} rotulo="Ou escolha a data final" tipo="date" value={data_} onChange={(e) => setData(e.target.value)} />
            <div className="mb-3">
              <Botao variacao="secundario" aoTocar={estenderData} carregando={ocupado === 'data'} desabilitado={!!ocupado || !data_} className="w-full">
                Definir data
              </Botao>
            </div>
          </div>
          {emTeste && (
            <Botao variacao="perigo" aoTocar={encerrar} carregando={ocupado === 'encerrar'} desabilitado={!!ocupado} className="w-full" data-testid="trial-encerrar">
              Encerrar teste agora
            </Botao>
          )}
        </>
      ) : <p className="text-xs text-faint">Só dá para mexer no teste de um clube em teste ou aguardando pagamento.</p>}
      <p className="text-xs text-faint mt-2">Tudo fica na auditoria. Nenhuma cobrança é criada por aqui.</p>
    </CaixaClara>
  )
}

const STATUS_ASSINATURA = ['trial', 'ativa', 'pagamento_pendente', 'inadimplente', 'suspensa', 'cancelada']

function TransicaoAssinatura({ assinatura, onFeito }) {
  const [novo, setNovo] = useState(assinatura.status)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function confirmar() {
    if (novo === assinatura.status) return
    if (motivo.trim().length < 5) { avisar.erro(null, 'Descreva o motivo (mínimo 5 caracteres) — fica na auditoria.'); return }
    setOcupado(true)
    try {
      await assinaturaTransicionar(assinatura.id, novo, motivo.trim())
      avisar.sucesso('Status da assinatura atualizado.')
      setMotivo('')
      onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <div>
      <label htmlFor={`status-${assinatura.id}`} className="block text-xs font-bold text-ink mb-1">Mudar status da assinatura</label>
      <select id={`status-${assinatura.id}`} value={novo} onChange={(e) => setNovo(e.target.value)} data-testid="assinatura-status"
        className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink mb-2">
        {STATUS_ASSINATURA.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s] || s}</option>)}
      </select>
      <Campo id={`motivo-${assinatura.id}`} rotulo="Motivo (obrigatório, vai para a auditoria)" linhas={2}
        value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Botao aoTocar={confirmar} carregando={ocupado} desabilitado={novo === assinatura.status} data-testid="confirmar-transicao">
        Confirmar transição
      </Botao>
    </div>
  )
}

function MudarPlano({ assinaturaId, atual, onFeito }) {
  const { dados: planos } = useFonte(planosAdminListar)
  const [escolha, setEscolha] = useState(atual)
  const [excedentes, setExcedentes] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const opcoes = (planos || []).filter((p) => p.ativo && p.status === 'publicado')

  async function aplicar(confirmar = false) {
    const [chave, versao] = escolha.split('|')
    setOcupado(true)
    try {
      const r = await planoMudar(assinaturaId, chave, Number(versao), confirmar)
      if (r?.precisa_confirmar) { setExcedentes(r); setOcupado(false); return }
      avisar.sucesso('Plano alterado. Nada foi apagado.')
      setExcedentes(null)
      onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  return (
    <div>
      <label htmlFor={`plano-${assinaturaId}`} className="block text-xs font-bold text-ink mb-1">Alterar plano</label>
      <select id={`plano-${assinaturaId}`} value={escolha} onChange={(e) => { setEscolha(e.target.value); setExcedentes(null) }}
        className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink mb-1">
        {opcoes.map((p) => <option key={`${p.chave}|${p.versao}`} value={`${p.chave}|${p.versao}`}>{p.nome} v{p.versao}{p.publico ? '' : ' (fora da vitrine)'}</option>)}
      </select>
      <p className="text-xs text-faint mb-2">Troca só o plano (limites e recursos). O ciclo e o preço da assinatura não mudam por aqui.</p>
      {excedentes && (
        <Aviso tom="atencao" titulo="O plano novo é menor que o uso atual">
          {excedentes.mensagem}
          <ul className="mt-1 text-xs">{(excedentes.excedentes || []).map((x, i) => <li key={i}>{x.clube}: {x.limite} {x.uso} de {x.teto}</li>)}</ul>
        </Aviso>
      )}
      <Botao variacao={excedentes ? 'perigo' : 'secundario'} aoTocar={() => aplicar(!!excedentes)} carregando={ocupado} desabilitado={escolha === atual}>
        {excedentes ? 'Confirmar mesmo assim' : 'Aplicar plano'}
      </Botao>
    </div>
  )
}

// ---------------------------------------------------------------- Planos (todas as versões)
function Planos() {
  const { dados, erro } = useFonte(planosAdminListar)
  return (
    <Estado erro={erro} dados={dados} vazio={<Vazio icone="💳" titulo="Nenhum plano no catálogo" />}>
      <div className="space-y-3">
        <Aviso tom="info">Somente leitura. Cada versão de plano é histórica: mudar o catálogo cria versão nova e não altera assinatura antiga em silêncio.</Aviso>
        {(dados || []).map((p) => (
          <Card key={p.id} data-testid="plano-item">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-ink">{p.nome} <span className="text-muted font-normal">· {p.chave} v{p.versao}</span></p>
              <div className="flex flex-wrap gap-1.5">
                <Selo tom={p.publico ? 'ok' : 'neutro'}>{p.publico ? 'Na vitrine' : 'Fora da vitrine'}</Selo>
                <Selo tom={p.ativo && p.status === 'publicado' ? 'ok' : 'perigo'}>{p.status}{p.ativo ? '' : ' · inativo'}</Selo>
                {p.provisorio && <Selo tom="atencao">Provisório</Selo>}
              </div>
            </div>
            <p className="text-xs text-muted mt-1">{p.assinaturas} assinatura(s) neste plano</p>
            <div className="mt-2 text-sm text-ink space-y-0.5">
              {(p.precos || []).length === 0
                ? <p className="text-muted">Sem preço.</p>
                : p.precos.map((pr, i) => (
                  <p key={i}>{formatarPreco(pr.valor_centavos, pr.moeda)} / {pr.ciclo}{pr.ativo ? '' : ' (inativo)'} <span className="text-xs text-faint">vigente de {data(pr.vigente_de)}{pr.vigente_ate ? ` até ${data(pr.vigente_ate)}` : ''}</span></p>
                ))}
            </div>
            <p className="text-xs text-muted mt-2">
              Limites: {Object.keys(p.limites || {}).length === 0 ? 'sem limite' : Object.entries(p.limites).map(([k, v]) => `${k} ${v}`).join(' · ')}
            </p>
            <p className="text-xs text-muted">Recursos: {p.recursos ? p.recursos.join(', ') : 'todos'}</p>
          </Card>
        ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Assinaturas
function Assinaturas({ aoAbrirClube }) {
  const { dados, erro } = useFonte(assinaturasListar)
  return (
    <Estado erro={erro} dados={dados} vazio={<Vazio icone="🧾" titulo="Nenhuma assinatura" />}>
      <div className="space-y-3">
        <Aviso tom="info">
          Licença/assinatura interna não é pagamento. Sem gateway integrado, nenhum pagamento aparece como confirmado aqui.
        </Aviso>
        {(dados || []).map((s) => (
          <Card key={s.id} data-testid="assinatura-item">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-ink">{(s.clubes || []).map((c) => c.nome).join(', ') || s.conta || 'Sem clube'}</p>
              <Selo tom={tomAssinatura(s.status)}>{ROTULO_STATUS[s.status] || s.status}</Selo>
            </div>
            <p className="text-xs text-muted mt-1">
              {s.plano_nome} v{s.plano_versao} · {s.ciclo || 'ciclo —'} · início {data(s.criada_em)}
              {s.trial_ate ? ` · teste até ${data(s.trial_ate)}` : ''}{s.periodo_fim ? ` · período até ${data(s.periodo_fim)}` : ''}
            </p>
            <p className="text-xs mt-1">
              {s.faturas_pagas_gateway > 0
                ? <span className="text-green-700 font-semibold">{s.faturas_pagas_gateway} pagamento(s) confirmado(s) pelo gateway</span>
                : <span className="text-faint">Pagamento não confirmado por gateway</span>}
              {s.faturas_abertas > 0 && <span className="text-amber-800"> · {s.faturas_abertas} fatura(s) em aberto</span>}
            </p>
            {(s.clubes || [])[0] && (
              <button type="button" onClick={() => aoAbrirClube(s.clubes[0].club_id)} className="mt-2 text-xs font-bold text-brand underline min-h-[44px]">Abrir clube</button>
            )}
          </Card>
        ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Armazenamento
function Armazenamento({ aoAbrirClube }) {
  const { dados, erro } = useFonte(clubesListar)
  const ordem = { atingido: 0, proximo: 1, normal: 2, sem_limite: 3 }
  const lista = [...(dados || [])].sort((a, b) => ordem[a.armazenamento_situacao] - ordem[b.armazenamento_situacao] || b.armazenamento_bytes - a.armazenamento_bytes)
  return (
    <Estado erro={erro} dados={dados} vazio={<Vazio icone="💾" titulo="Nenhum clube" />}>
      <div className="space-y-2">
        <Aviso tom="info">Só o tamanho usado. A administração não abre os arquivos dos clubes.</Aviso>
        {lista.map((c) => (
          <Card key={c.club_id} className="p-3" data-testid="armazenamento-item">
            <button type="button" onClick={() => aoAbrirClube(c.club_id)} className="w-full text-left min-h-[44px]">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-ink">{c.nome}</p>
                <Selo tom={TOM_ARMAZENAMENTO[c.armazenamento_situacao]}>{ROTULO_ARMAZENAMENTO[c.armazenamento_situacao]}</Selo>
              </div>
              <p className="text-xs text-muted mt-1">
                {formatarBytes(c.armazenamento_bytes)}{c.armazenamento_limite_mb ? ` de ${formatarBytes(c.armazenamento_limite_mb * 1048576)} · ${c.armazenamento_pct}%` : ' · sem limite'}
              </p>
              {c.armazenamento_limite_mb > 0 && (
                <div className="h-1.5 mt-2 rounded-full bg-surface2 overflow-hidden" aria-hidden="true">
                  <div className={`h-full rounded-full ${c.armazenamento_situacao === 'atingido' ? 'bg-red-600' : c.armazenamento_situacao === 'proximo' ? 'bg-amber-500' : 'bg-green-600'}`}
                    style={{ width: `${Math.min(100, c.armazenamento_pct || 0)}%` }} />
                </div>
              )}
            </button>
          </Card>
        ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Onboarding
// Cadastro de clube parado: há quantos dias a sessão EM ANDAMENTO não anda (desde a última etapa).
// Só visibilidade — nada é apagado. Mais de 7 dias ganha destaque e sobe para o topo da lista.
export const DIAS_ONBOARDING_PARADO = 7
export function diasParado(iso, agora = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((agora - t) / 86400000))
}

function Onboarding({ aoAbrirClube }) {
  const { dados, erro } = useFonte(onboardingListar)
  const agora = Date.now()
  const lista = (dados || []).map((o) => ({ ...o, parado: o.status === 'em_andamento' ? diasParado(o.atualizado_em, agora) : null }))
  // parados há mais tempo primeiro; o resto mantém a ordem do servidor (atualizado mais recente)
  lista.sort((a, b) => (b.parado ?? -1) - (a.parado ?? -1))
  const nParados = lista.filter((o) => o.parado != null && o.parado > DIAS_ONBOARDING_PARADO).length
  return (
    <Estado erro={erro} dados={dados} vazio={<Vazio icone="🧭" titulo="Nenhum onboarding iniciado" />}>
      {nParados > 0 && (
        <p className="mb-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800" data-testid="onboarding-parados">
          {nParados} cadastro(s) de clube parado(s) há mais de {DIAS_ONBOARDING_PARADO} dias.
        </p>
      )}
      <div className="space-y-2">
        {lista.map((o) => (
          <Card key={o.id} className={`p-3 ${o.parado > DIAS_ONBOARDING_PARADO ? 'border-2 border-amber-300' : ''}`} data-testid="onboarding-item">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">{o.clube || 'Clube ainda não criado'}</p>
              <Selo tom={o.status === 'concluido' ? 'ok' : o.status === 'abandonado' ? 'perigo' : 'atencao'}>{ROTULO_ONBOARDING[o.status] || o.status}</Selo>
            </div>
            {o.parado != null && (
              <p className={`text-sm mt-1 font-semibold ${o.parado > DIAS_ONBOARDING_PARADO ? 'text-amber-800' : 'text-muted'}`} data-testid="onboarding-parado">
                {o.parado === 0 ? 'Mexido hoje' : `Parado há ${o.parado} dia${o.parado === 1 ? '' : 's'}`} na etapa “{o.etapa}”
              </p>
            )}
            <p className="text-xs text-muted mt-1">
              Etapa atual: {o.etapa} · {(o.etapas_concluidas || []).length} etapa(s) concluída(s) · iniciado {data(o.iniciado_em)} · atualizado {dataHora(o.atualizado_em)}
              {o.provisionamento ? ` · provisionamento ${o.provisionamento}` : ''}
            </p>
            {o.ultimo_erro && <p className="text-xs text-red-700 mt-1">Último erro: {o.ultimo_erro}</p>}
            {o.club_id && <button type="button" onClick={() => aoAbrirClube(o.club_id)} className="mt-1 text-xs font-bold text-brand underline min-h-[44px]">Abrir clube</button>}
          </Card>
        ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Provisionamento
function Provisionamento() {
  const { dados: lista, erro, recarregar } = useFonte(provisionamentoPendencias)
  const [ocupado, setOcupado] = useState(null)

  async function reexecutar(clubId) {
    setOcupado(clubId)
    try {
      const r = await provisionamentoReexecutar(clubId)
      if (r?.status === 'ok') avisar.sucesso('Provisionamento concluído.')
      else avisar.erro(new Error(r?.erro || 'Continua pendente.'))
      recarregar()
    } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }

  return (
    <Estado erro={erro} dados={lista} vazio={<Vazio icone="✅" titulo="Nenhuma pendência de provisionamento" />}>
      <div className="space-y-3">
        {(lista || []).map((p) => (
          <Card key={p.club_id}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-ink truncate">{p.clube}</p>
                <p className="text-xs text-muted">{p.status} · {p.tentativas} tentativa(s){p.erro ? ` · ${p.erro}` : ''}</p>
              </div>
              <Botao variacao="secundario" aoTocar={() => reexecutar(p.club_id)} carregando={ocupado === p.club_id}>Reexecutar</Botao>
            </div>
          </Card>
        ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Suporte
const ROTULO_SUPORTE = {
  solicitado: 'Aguardando o clube autorizar', autorizado: 'Autorizado pelo clube',
  recusado: 'Recusado pelo clube', revogado: 'Revogado',
}

function Suporte() {
  const { dados: lista, erro, recarregar } = useFonte(suporteListar)
  async function revogar(id) {
    try { await suporteRevogar(id, 'Revogado pelo admin.'); recarregar() } catch (e) { avisar.erro(e) }
  }
  return (
    <Estado erro={erro} dados={lista}>
      <div className="space-y-3">
        <Aviso tom="info">
          Nesta versão, autorizar um pedido aqui <strong>não concede acesso real</strong> a dado de
          clube — fica registrado e auditado. Só a liderança do clube autoriza; o admin nunca autoriza
          o próprio pedido.
        </Aviso>
        {(lista || []).length === 0
          ? <Vazio icone="🛟" titulo="Nenhum pedido de suporte" />
          : lista.map((g) => (
            <Card key={g.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{g.motivo}</p>
                  <p className="text-xs text-muted">{ROTULO_SUPORTE[g.status] || g.status}</p>
                </div>
                {['solicitado', 'autorizado'].includes(g.status) && (
                  <Botao variacao="perigo" aoTocar={() => revogar(g.id)}>Revogar</Botao>
                )}
              </div>
            </Card>
          ))}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Auditoria
function Auditoria() {
  const { dados: lista, erro } = useFonte(auditoriaListar)
  return (
    <Estado erro={erro} dados={lista} vazio={<Vazio icone="📜" titulo="Nenhum evento ainda" />}>
      <div className="space-y-2">
        {(lista || []).map((e) => (
          <Card key={e.id} className="p-3">
            <p className="text-sm font-semibold text-ink">{e.acao}</p>
            <p className="text-xs text-muted">{e.alvo_tipo} · {dataHora(e.created_at)}{e.detalhe?.motivo ? ` · ${e.detalhe.motivo}` : ''}{e.detalhe?.para ? ` · ${e.detalhe.para}` : ''}</p>
          </Card>
        ))}
      </div>
    </Estado>
  )
}
