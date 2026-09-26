import { useState, useEffect, useCallback, useMemo } from 'react'
import { Botao, Aviso, Campo } from '../ui/index.jsx'
import { ROTULO_STATUS, formatarPreco } from '../services/comercial.js'
import {
  souAdminPlataforma, visaoGeral, clubesListar, clubeDetalhe, planosAdminListar, assinaturasListar,
  onboardingListar, planoMudar, provisionamentoPendencias, provisionamentoReexecutar,
  assinaturaTransicionar, suporteListar, suporteRevogar, auditoriaListar,
  trialPadrao, trialPadraoDefinir, trialEstender, trialEncerrar,
} from '../services/admin.js'
import { hierarquiaAdmin, TIPO_ROTULO } from '../services/hierarquia.js'
import { avisar } from '../ui/avisos.jsx'
import { MARCA_PRODUTO } from '../lib/marca.js'
import {
  Chip, StatusChip, ClubeAvatar, Kpi, Painel, Linha, BarraUso, EstadoVazio, Esqueleto, Nota, LinkAcao, FOCO,
  dataBR as data, dataHoraBR as dataHora,
} from '../components/admin/AdminUI.jsx'
import AdminHierarquia from './AdminHierarquia.jsx'
import AdminCortesias from './AdminCortesias.jsx'
import AdminVitrine from './AdminVitrine.jsx'
import { LimiteMembrosClube, LixeiraClube } from './AdminMembrosLixeira.jsx'
import AdminChamados from './AdminChamados.jsx'
import { adminChamadosContagem } from '../services/suporte.js'
import { ZonaDePerigoClube, LixeiraDeClubes } from './AdminExcluirClube.jsx'

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
  { chave: 'chamados', rotulo: 'Chamados', icone: '📨' },
  { chave: 'suporte', rotulo: 'Suporte', icone: '🛟' },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: '📜' },
  { chave: 'lixeira-clubes', rotulo: 'Lixeira de clubes', icone: '🗑️' },
]

const ROTULO_ARMAZENAMENTO = { sem_limite: 'Sem limite', normal: 'Normal', proximo: 'Próximo do limite', atingido: 'Limite atingido' }
const TOM_ARMAZENAMENTO = { sem_limite: 'neutro', normal: 'ok', proximo: 'atencao', atingido: 'perigo' }
const ROTULO_ONBOARDING = { em_andamento: 'Em andamento', concluido: 'Concluído', abandonado: 'Abandonado' }
const tomAssinatura = (s) => (s === 'ativa' ? 'ok' : s === 'trial' ? 'info' : ['inadimplente', 'suspensa'].includes(s) ? 'perigo' : s === 'cancelada' ? 'neutro' : 'atencao')
const ehCortesia = (c) => c?.provider === 'cortesia' && c?.assinatura_status === 'ativa'
const rotuloStatus = (s) => ROTULO_STATUS[s] || s

export function formatarBytes(b) {
  const n = Number(b || 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

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

function Estado({ erro, dados, vazio, children, esqueleto }) {
  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (dados == null) return esqueleto || <Esqueleto />
  if (Array.isArray(dados) && dados.length === 0 && vazio) return vazio
  return children
}

export default function Admin() {
  // ?aba=chamados&chamado=<id> (link da notificação de chamado novo)
  const [params] = useState(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''))
  const [aba, setAba] = useState(() => (ABAS.some((a) => a.chave === params.get('aba')) ? params.get('aba') : 'visao'))
  const [clubeAberto, setClubeAberto] = useState(null)
  const [autorizado, setAutorizado] = useState(null)
  const [erroAcesso, setErroAcesso] = useState('')
  const [contadores, setContadores] = useState({})

  // Badges das abas (pendências): só depois que o servidor confirmou o admin.
  useEffect(() => {
    if (!autorizado) return
    Promise.resolve().then(visaoGeral).then((v) => v && setContadores((c) => ({
      ...c, provisionamento: v.provisionamentos_pendentes || 0, onboarding: v.onboarding_em_andamento || 0,
    }))).catch(() => {})
    atualizarChamados()
  }, [autorizado]) // eslint-disable-line react-hooks/exhaustive-deps
  // contador de chamados que pedem atenção (aberto + em andamento) — badge "Chamados" no menu
  function atualizarChamados() {
    adminChamadosContagem().then((n) => setContadores((c) => ({ ...c, chamados: n }))).catch(() => {})
  }

  useEffect(() => {
    souAdminPlataforma().then(setAutorizado).catch((e) => { setAutorizado(false); setErroAcesso(e.message) })
  }, [])

  if (autorizado === null) {
    return <div className="max-w-5xl mx-auto px-4 pt-6"><Esqueleto linhas={3} texto="Verificando acesso" /></div>
  }
  if (!autorizado) {
    return (
      <div className="max-w-md mx-auto px-4 pt-6">
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
    <div className="min-h-dvh bg-bg">
      <CabecalhoAdmin />
      <div className="max-w-5xl mx-auto px-4 pb-12">
        <AbasDoAdmin abas={ABAS} ativa={aba} aoTrocar={trocarAba} contadores={contadores} />
        {aba === 'visao' && <VisaoGeral irPara={trocarAba} aoAbrirClube={abrirClube} />}
        {aba === 'clubes' && (clubeAberto
          ? <DetalheClube clubId={clubeAberto} aoVoltar={() => setClubeAberto(null)} />
          : <Clubes aoAbrir={abrirClube} />)}
        {aba === 'hierarquia' && <AdminHierarquia />}
        {aba === 'planos' && <Planos />}
        {aba === 'assinaturas' && <Assinaturas aoAbrirClube={abrirClube} />}
        {aba === 'cortesias' && <AdminCortesias />}
        {aba === 'vitrine' && <AdminVitrine />}
        {aba === 'armazenamento' && <Armazenamento aoAbrirClube={abrirClube} />}
        {aba === 'onboarding' && <Onboarding aoAbrirClube={abrirClube} />}
        {aba === 'provisionamento' && <Provisionamento />}
        {aba === 'chamados' && <AdminChamados inicial={params.get('chamado')} aoMudarContagem={atualizarChamados} />}
        {aba === 'suporte' && <Suporte />}
        {aba === 'auditoria' && <Auditoria />}
        {aba === 'lixeira-clubes' && <LixeiraDeClubes />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Cabeçalho e abas
// Barra compacta azul-marinho (a mesma da landing), fixa no topo ao rolar.
function CabecalhoAdmin() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07122f] text-white">
      <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-3">
        <img src={MARCA_PRODUTO.logoUrl} alt="" width="36" height="36" className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-white/15" />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-extrabold leading-tight tracking-tight">Administração</h1>
          <p className="truncate text-xs text-white/70">DesbravaClube · plataforma</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#f5c518]/15 px-2.5 py-1 text-xs font-semibold text-[#f5c518] ring-1 ring-inset ring-[#f5c518]/30">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#f5c518]" />Admin da plataforma
        </span>
      </div>
    </header>
  )
}

// Pílulas que rolam de lado no celular (a última aparece cortada = dá pra ver que tem mais).
// Navegação do painel em MENU DE LISTA (como o menu do site): uma barra com a seção atual e o botão
// "Menu"; tocar abre a lista de todas as áreas, com ícone e contador de pendências. Tocar numa área
// troca a seção e fecha a lista. Pedido do dono (26/09): as pílulas roláveis escondiam áreas no celular.
function AbasDoAdmin({ abas, ativa, aoTrocar, contadores = {} }) {
  const [aberto, setAberto] = useState(false)
  const atual = abas.find((a) => a.chave === ativa) || abas[0]
  const totalPendencias = Object.values(contadores).reduce((t, n) => t + (Number(n) || 0), 0)
  useEffect(() => {
    if (!aberto) return undefined
    const esc = (e) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberto])
  return (
    <nav aria-label="Áreas da administração" className="sticky top-[61px] z-20 -mx-4 mb-4 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls="admin-menu-lista"
        data-testid="admin-menu" className={`flex w-full min-h-[48px] items-center gap-3 rounded-xl border border-line bg-surface px-3.5 text-left ${FOCO}`}>
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-surface2 text-lg">{atual.icone}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-faint">Seção</span>
          <span className="block truncate text-[15px] font-bold text-ink">{atual.rotulo}</span>
        </span>
        {totalPendencias > 0 && !aberto && <span className="rounded-full bg-amber-500 px-2 text-xs font-bold leading-6 text-white">{totalPendencias}</span>}
        <span aria-hidden="true" className="text-xl text-muted">{aberto ? '✕' : '☰'}</span>
        <span className="sr-only">{aberto ? 'Fechar menu' : 'Abrir menu'}</span>
      </button>
      {aberto && (
        <>
          <button type="button" aria-label="Fechar menu" onClick={() => setAberto(false)} className="fixed inset-0 z-[-1] cursor-default bg-black/20" tabIndex={-1} />
          <ul id="admin-menu-lista" role="tablist" aria-orientation="vertical"
            className="mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lg">
            {abas.map((a) => {
              const sel = a.chave === ativa
              const n = contadores[a.chave]
              return (
                <li key={a.chave}>
                  <button type="button" role="tab" aria-selected={sel} onClick={() => { aoTrocar(a.chave); setAberto(false) }}
                    className={`flex w-full min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors ${FOCO} ${sel
                      ? 'bg-[#0b1f4d] font-bold text-white dark:bg-white dark:text-[#07122f]'
                      : 'font-semibold text-ink hover:bg-surface2 active:bg-surface2'}`}>
                    <span aria-hidden="true" className="w-6 text-center text-lg">{a.icone}</span>
                    <span className="flex-1">{a.rotulo}</span>
                    {n > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-5 text-white">{n}</span>}
                    {sel && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </nav>
  )
}

// ---------------------------------------------------------------- Visão geral
function VisaoGeral({ irPara, aoAbrirClube }) {
  const { dados: v, erro } = useFonte(visaoGeral)
  return (
    <Estado erro={erro} dados={v} esqueleto={<EsqueletoKpis />}>
      {v && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi icone="🏕️" valor={v.clubes_total} rotulo="Clubes" detalhe={`${v.clubes_ativos} ativo(s) · ${v.clubes_inativos} inativo(s)`} testid="visao-clubes" aoTocar={() => irPara('clubes')} />
            <Kpi icone="🧭" tom="info" valor={v.onboarding_em_andamento} rotulo="Em onboarding" detalhe={`${v.onboarding_concluidos ?? 0} concluído(s)`} aoTocar={() => irPara('onboarding')} />
            <Kpi icone="💾" tom="ok" valor={formatarBytes(v.armazenamento_total_bytes)} rotulo="Armazenamento total"
              detalhe={v.clubes_proximos_do_limite + v.clubes_no_limite > 0 ? `${v.clubes_proximos_do_limite + v.clubes_no_limite} perto/no limite` : 'Todos dentro do limite'} aoTocar={() => irPara('armazenamento')} />
            <Kpi icone="💳" tom="dourado" valor={`${v.planos_publicos}/${v.planos_total}`} rotulo="Planos na vitrine / total" aoTocar={() => irPara('planos')} />
          </div>

          <PrecisaAtencao v={v} irPara={irPara} aoAbrirClube={aoAbrirClube} />

          <div className="grid gap-4 md:grid-cols-2">
            <Painel titulo="Assinaturas por status" icone="🧾" acao={<LinkAcao aoTocar={() => irPara('assinaturas')}>Ver</LinkAcao>}>
              {Object.keys(v.assinaturas_por_status || {}).length === 0
                ? <p className="text-sm text-muted">Nenhuma assinatura.</p>
                : (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(v.assinaturas_por_status).map(([s, n]) => (
                      <Chip key={s} tom={tomAssinatura(s)} ponto>{rotuloStatus(s)}: {n}</Chip>
                    ))}
                  </div>
                )}
            </Painel>
            <Painel titulo="Últimos 7 dias" icone="📜" acao={<LinkAcao aoTocar={() => irPara('auditoria')}>Auditoria</LinkAcao>}>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-surface2 p-3"><p className="text-xl font-extrabold text-ink tabular-nums">{v.eventos_admin_7d}</p><p className="text-xs text-muted">ações de administração</p></div>
                <div className="rounded-xl bg-surface2 p-3"><p className="text-xl font-extrabold text-ink tabular-nums">{v.eventos_assinatura_7d}</p><p className="text-xs text-muted">eventos de assinatura</p></div>
              </div>
            </Painel>
          </div>
          <TrialPadrao />
        </div>
      )}
    </Estado>
  )
}

function EsqueletoKpis() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-3">
            <div className="h-8 w-8 rounded-full bg-surface2 motion-safe:animate-pulse" />
            <div className="mt-3 h-6 w-1/2 rounded-full bg-surface2 motion-safe:animate-pulse" />
            <div className="mt-2 h-3 w-3/4 rounded-full bg-surface2 motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

// "Precisa da sua atenção": junta o que pede ação (sem inventar dado — cada item vem de uma RPC admin).
function PrecisaAtencao({ v, irPara, aoAbrirClube }) {
  const [clubes, setClubes] = useState(null)
  const [onb, setOnb] = useState(null)
  const [hier, setHier] = useState(null)
  useEffect(() => {
    let vivo = true
    Promise.resolve().then(clubesListar).then((d) => vivo && setClubes(d || [])).catch(() => vivo && setClubes([]))
    Promise.resolve().then(onboardingListar).then((d) => vivo && setOnb(d || [])).catch(() => vivo && setOnb([]))
    Promise.resolve().then(hierarquiaAdmin).then((d) => vivo && setHier(d)).catch(() => vivo && setHier(null))
    return () => { vivo = false }
  }, [])

  const agora = Date.now()
  const trials = (clubes || [])
    .map((c) => ({ ...c, restam: c.assinatura_status === 'trial' ? diasRestantes(c.trial_ate, agora) : null }))
    .filter((c) => c.restam != null && c.restam <= 7)
    .sort((a, b) => a.restam - b.restam)
  const parados = (onb || []).filter((o) => o.status === 'em_andamento' && diasParado(o.atualizado_em, agora) > DIAS_ONBOARDING_PARADO)
  const nHier = hier ? (hier.pedidos_clube || []).length + (hier.coordenadores_pendentes || []).length : 0
  const nArmaz = (v.clubes_proximos_do_limite || 0) + (v.clubes_no_limite || 0)

  const itens = []
  for (const c of trials.slice(0, 5)) {
    itens.push({ k: `t${c.club_id}`, tom: c.restam <= 2 ? 'perigo' : 'atencao', icone: '⏳',
      titulo: c.nome, texto: c.restam > 0 ? `Teste acaba em ${c.restam} dia(s) · ${data(c.trial_ate)}` : 'Teste venceu', acao: () => aoAbrirClube(c.club_id) })
  }
  if (parados.length) itens.push({ k: 'onb', tom: 'atencao', icone: '🧭', titulo: `${parados.length} cadastro(s) parado(s)`, texto: `Sem avanço há mais de ${DIAS_ONBOARDING_PARADO} dias`, acao: () => irPara('onboarding') })
  if (nHier) itens.push({ k: 'hier', tom: 'info', icone: '🌳', titulo: `${nHier} pendência(s) de hierarquia`, texto: 'Clube pedindo unidade ou coordenador aguardando', acao: () => irPara('hierarquia') })
  if (v.provisionamentos_pendentes > 0) itens.push({ k: 'prov', tom: 'perigo', icone: '⚙️', titulo: `${v.provisionamentos_pendentes} provisionamento(s) pendente(s)`, texto: 'Reexecute na aba Provisionamento', acao: () => irPara('provisionamento') })
  if (nArmaz) itens.push({ k: 'arm', tom: 'atencao', icone: '💾', titulo: `${nArmaz} clube(s) perto/no limite`, texto: 'de armazenamento do plano', acao: () => irPara('armazenamento') })

  const carregando = clubes == null || onb == null
  return (
    <Painel titulo="Precisa da sua atenção" icone="🔔" data-testid="visao-atencao"
      acao={itens.length > 0 ? <Chip tom="atencao">{itens.length}</Chip> : null}>
      {carregando && itens.length === 0 ? <Esqueleto linhas={2} avatar={false} texto="Carregando pendências" /> : itens.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true">✅</span>Tudo em dia. Nada pedindo ação agora.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {itens.map((i) => (
            <li key={i.k}>
              <button type="button" onClick={i.acao} className={`flex w-full min-h-[52px] items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-surface2 ${FOCO}`}>
                <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-base">{i.icone}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{i.titulo}</span>
                  <span className="block truncate text-xs text-muted">{i.texto}</span>
                </span>
                <Chip tom={i.tom} ponto className="hidden sm:inline-flex">{i.tom === 'perigo' ? 'Urgente' : i.tom === 'info' ? 'Revisar' : 'Atenção'}</Chip>
                <span aria-hidden="true" className="text-faint">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  )
}

// ---------------------------------------------------------------- Clubes
function Clubes({ aoAbrir }) {
  const { dados, erro } = useFonte(clubesListar)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')

  const lista = useMemo(() => (dados || []).filter((c) => {
    const t = busca.trim().toLowerCase()
    if (t && !`${c.nome} ${c.slug || ''} ${c.sigla || ''}`.toLowerCase().includes(t)) return false
    if (filtro === 'onboarding') return c.onboarding_status === 'em_andamento'
    if (filtro === 'sem_assinatura') return !c.assinatura_id
    if (filtro === 'armazenamento') return ['proximo', 'atingido'].includes(c.armazenamento_situacao)
    if (filtro === 'inativos') return c.status !== 'ativo'
    return true
  }), [dados, busca, filtro])

  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="🏕️" titulo="Nenhum clube ainda">Quando um clube se cadastrar, ele aparece aqui.</EstadoVazio>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Campo id="admin-busca-clube" rotulo="Buscar clube" tipo="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, sigla ou código" />
          <div className="mb-3">
            <label htmlFor="admin-filtro-clube" className="block text-sm font-medium text-ink mb-1">Filtro</label>
            <select id="admin-filtro-clube" value={filtro} onChange={(e) => setFiltro(e.target.value)}
              className={`w-[8.5rem] sm:w-56 min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink ${FOCO}`}>
              <option value="todos">Todos</option>
              <option value="onboarding">Em onboarding</option>
              <option value="sem_assinatura">Sem assinatura</option>
              <option value="armazenamento">Perto/no limite de armazenamento</option>
              <option value="inativos">Inativos</option>
            </select>
          </div>
        </div>
        <p className="text-xs font-medium text-muted" role="status">{lista.length} de {(dados || []).length} clube(s)</p>
        {lista.length === 0 && <EstadoVazio icone="🔎" titulo="Nenhum clube encontrado">Tente outro termo ou limpe o filtro.</EstadoVazio>}
        <ul className="grid gap-2 md:grid-cols-2">
          {lista.map((c) => <li key={c.club_id}><CartaoClube c={c} aoAbrir={aoAbrir} /></li>)}
        </ul>
      </div>
    </Estado>
  )
}

function CartaoClube({ c, aoAbrir }) {
  const temLimiteArmaz = c.armazenamento_limite_mb > 0
  const local = [c.vinculado_a_nome && `${TIPO_ROTULO?.[c.vinculado_a_tipo] || ''} ${c.vinculado_a_nome}`.trim()].filter(Boolean).join(' · ')
  return (
    <div data-testid="clube-item" className="h-full rounded-2xl border border-line bg-surface transition-colors hover:border-brand/40">
      <button type="button" onClick={() => aoAbrir(c.club_id)} className={`flex h-full w-full flex-col gap-3 rounded-2xl p-3.5 text-left min-h-[44px] ${FOCO}`}>
        <div className="flex items-start gap-3">
          <ClubeAvatar nome={c.nome} logoUrl={c.logo_url} cor={c.cor_primaria} sigla={c.sigla} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-ink leading-tight">{c.nome}</p>
            <p className="truncate text-xs text-faint">{c.slug || '—'}{local ? ` · ${local}` : ''}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <StatusChip status={c.assinatura_status} rotulo={rotuloStatus(c.assinatura_status)} cortesia={ehCortesia(c)}
                sufixo={c.assinatura_status === 'trial' && c.trial_ate ? ` até ${data(c.trial_ate)}` : ''} />
              {c.onboarding_status === 'em_andamento' && <Chip tom="atencao">Onboarding: {c.onboarding_etapa}</Chip>}
              {c.status !== 'ativo' && <Chip tom="perigo">Inativo</Chip>}
            </div>
          </div>
          <span aria-hidden="true" className="self-center text-lg text-faint">›</span>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-2.5 text-xs">
          <div className="min-w-0">
            <p className="text-faint">Plano</p>
            <p className="truncate font-semibold text-ink">{c.plano_nome ? `${c.plano_nome}${c.ciclo ? ` · ${c.ciclo}` : ''}` : 'Sem plano'}</p>
          </div>
          <div className="min-w-0">
            <p className="text-faint">Membros ativos</p>
            <p className="font-semibold text-ink tabular-nums">{c.membros ?? '—'}{c.membros_limite ? ` / ${c.membros_limite}` : ''}</p>
          </div>
          <div className="col-span-2">
            <div className="mb-1 flex justify-between gap-2">
              <span className="text-faint">Armazenamento</span>
              <span className="font-semibold text-ink tabular-nums">
                {formatarBytes(c.armazenamento_bytes)}{temLimiteArmaz ? ` de ${formatarBytes(c.armazenamento_limite_mb * 1048576)} (${c.armazenamento_pct}%)` : ' (sem limite)'}
              </span>
            </div>
            {temLimiteArmaz && <BarraUso pct={c.armazenamento_pct} situacao={c.armazenamento_situacao} rotulo={`Armazenamento de ${c.nome}`} />}
          </div>
        </div>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- Detalhe do clube
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
      <button type="button" onClick={aoVoltar} className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted hover:text-ink ${FOCO}`}>
        <span aria-hidden="true">←</span> Voltar para os clubes
      </button>
      <Estado erro={erro} dados={d} esqueleto={<Esqueleto linhas={3} />}>
        {d && (() => {
          const c = d.clube
          const hist = [...(d.assinatura_eventos || []).map((e) => ({ em: e.em, texto: `${e.motivo || `${e.de} → ${e.para}`} (${e.origem})` })),
            ...(d.auditoria || []).map((a) => ({ em: a.em, texto: `${a.acao} · ${a.alvo_tipo}${a.detalhe?.motivo ? ` · ${a.detalhe.motivo}` : ''}` }))]
            .sort((a, b) => String(b.em).localeCompare(String(a.em)))
          return (
            <>
              <section className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div aria-hidden="true" className="h-14" style={{ background: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.cor_primaria || '') ? c.cor_primaria : '#0b1f4d' }} />
                <div className="-mt-8 flex items-end gap-3 px-4">
                  <ClubeAvatar nome={c.nome} logoUrl={c.logo_url} cor={c.cor_primaria} sigla={c.sigla} tamanho="lg" className="ring-4 ring-surface shadow-sm" />
                </div>
                <div className="px-4 pb-4 pt-2">
                  <h2 className="text-lg font-extrabold leading-tight text-ink">{c.nome}</h2>
                  <p className="text-xs text-faint">{c.slug || '—'} · criado em {data(c.criado_em)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusChip status={c.assinatura_status} rotulo={rotuloStatus(c.assinatura_status)} cortesia={ehCortesia(c)} />
                    {c.plano_nome && <Chip tom="marca">{c.plano_nome} v{c.plano_versao}</Chip>}
                    <Chip tom={c.status === 'ativo' ? 'ok' : 'perigo'}>{c.status === 'ativo' ? 'Ativo' : 'Inativo'}</Chip>
                    {c.cor_primaria && <Chip><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-line" style={{ background: c.cor_primaria }} />{c.cor_primaria}</Chip>}
                  </div>
                </div>
              </section>

              <div className="grid gap-3 md:grid-cols-2">
                <Painel titulo="Plano e assinatura" icone="💳">
                  {c.assinatura_id ? (
                    <>
                      <Linha rotulo="Plano">{c.plano_nome} v{c.plano_versao}</Linha>
                      <Linha rotulo="Ciclo">{c.ciclo || '—'}</Linha>
                      <Linha rotulo="Situação"><StatusChip status={c.assinatura_status} rotulo={rotuloStatus(c.assinatura_status)} cortesia={ehCortesia(c)} /></Linha>
                      {c.trial_ate && <Linha rotulo="Teste até">{data(c.trial_ate)}</Linha>}
                      {c.periodo_fim && <Linha rotulo="Período até">{data(c.periodo_fim)}</Linha>}
                      <Linha rotulo="Pagamento">{c.provider === 'mock' || !c.provider ? 'Sem gateway — combinado fora do sistema' : c.provider}</Linha>
                      <div className="mt-4 space-y-4">
                        <TesteGratuito clubId={clubId} status={c.assinatura_status} trialAte={c.trial_ate} onFeito={recarregar} />
                        <CaixaClara titulo="Status da assinatura"><TransicaoAssinatura assinatura={{ id: c.assinatura_id, status: c.assinatura_status }} onFeito={recarregar} /></CaixaClara>
                        <CaixaClara titulo="Plano"><MudarPlano assinaturaId={c.assinatura_id} atual={`${c.plano_chave}|${c.plano_versao}`} onFeito={recarregar} /></CaixaClara>
                      </div>
                    </>
                  ) : <EstadoVazio icone="🧾" titulo="Sem assinatura">Clube anterior ao modelo comercial, ou cadastro que ainda não chegou à etapa do clube.</EstadoVazio>}
                </Painel>

                <div className="space-y-3">
                  <Painel titulo="Uso e limites" icone="📦">
                    <div className="mb-3">
                      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Armazenamento</span>
                        <span className="font-semibold text-ink tabular-nums">{formatarBytes(c.armazenamento_bytes)}{c.armazenamento_limite_mb ? ` de ${formatarBytes(c.armazenamento_limite_mb * 1048576)}` : ''}</span></div>
                      {c.armazenamento_limite_mb > 0 && <BarraUso pct={c.armazenamento_pct} situacao={c.armazenamento_situacao} rotulo="Armazenamento usado" />}
                    </div>
                    <Linha rotulo="Arquivos">{c.armazenamento_objetos}</Linha>
                    <Linha rotulo="Situação"><Chip tom={TOM_ARMAZENAMENTO[c.armazenamento_situacao]} ponto>{ROTULO_ARMAZENAMENTO[c.armazenamento_situacao]}{c.armazenamento_pct != null ? ` · ${c.armazenamento_pct}%` : ''}</Chip></Linha>
                    <Linha rotulo="Membros ativos">{c.membros ?? '—'}{c.membros_limite ? ` de ${c.membros_limite}` : ''}</Linha>
                    {(d.limites || []).filter((l) => !['armazenamento_mb', 'membros'].includes(l.chave)).map((l) => (
                      <Linha key={l.chave} rotulo={`Limite de ${l.chave}`}>{l.uso ?? '—'} de {l.teto}</Linha>
                    ))}
                  </Painel>

                  <Painel titulo="Hierarquia" icone="🌳">
                    <Linha rotulo="Vinculado a">{d.hierarquia ? `${d.hierarquia.nome} (${TIPO_ROTULO?.[d.hierarquia.tipo] || d.hierarquia.tipo})` : '—'}</Linha>
                  </Painel>

                  <Painel titulo="Onboarding e provisionamento" icone="🧭">
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
                  </Painel>
                </div>

                <Painel titulo="Recursos habilitados" icone="🧩">
                  {(d.recursos || []).length === 0
                    ? <p className="text-sm text-muted">Sem ajuste por clube — vale o que o plano define.</p>
                    : <div className="flex flex-wrap gap-1.5">{d.recursos.map((r) => <Chip key={r.recurso} tom={r.ligado ? 'ok' : 'neutro'} ponto>{r.recurso}: {r.ligado ? 'ligado' : 'desligado'}</Chip>)}</div>}
                </Painel>

                <Painel titulo="Pessoas (só contagens)" icone="👥">
                  {(d.vinculos_por_papel || []).length === 0
                    ? <p className="text-sm text-muted">Nenhum vínculo.</p>
                    : d.vinculos_por_papel.map((v) => <Linha key={`${v.papel}-${v.status}`} rotulo={`${v.papel} (${v.status})`}>{v.total}</Linha>)}
                  <p className="mt-2 text-xs text-faint">A administração da plataforma não vê nomes, fotos, chat, evidências nem mensalidades do clube.</p>
                </Painel>

                <div className="md:col-span-2 space-y-4">
                  <LimiteMembrosClube clubId={clubId} onFeito={recarregar} />
                  <LixeiraClube clubId={clubId} />
                </div>

                <Painel titulo="Auditoria recente" icone="📜" className="md:col-span-2">
                  {hist.length === 0 ? <p className="text-sm text-muted">Nenhum evento ainda.</p> : (
                    <ol className="relative ml-1.5 space-y-3 border-l border-line pl-4">
                      {hist.slice(0, 30).map((h, i) => (
                        <li key={i} className="relative">
                          <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-surface ring-2 ring-brand/60" />
                          <p className="text-sm text-ink break-words">{h.texto}</p>
                          <p className="text-xs text-faint">{dataHora(h.em)}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </Painel>
              </div>

              <ZonaDePerigoClube clube={{ ...c, club_id: c.club_id || clubId }} aoExcluir={aoVoltar} />
            </>
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
    <div className="rounded-xl border border-line bg-surface2/60 p-3" data-testid={testid}>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{titulo}</p>
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
    <Painel titulo="Teste gratuito para clubes novos" icone="⏳">
      {erro ? <p className="text-sm text-rose-700 dark:text-rose-300">{erro}</p> : dados == null ? <Esqueleto linhas={1} avatar={false} /> : (
        <>
          <p className="text-sm text-muted mb-3">
            Hoje: <strong className="text-ink" data-testid="trial-padrao-atual">{dados.trial_dias} dia(s)</strong>. Vale só para quem se cadastrar daqui pra frente — clubes que já estão em teste não mudam.
          </p>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
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
    </Painel>
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
            : <>Fora do teste ({rotuloStatus(status)}).</>}
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
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
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
const SELECT = `w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink ${FOCO}`

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
      <select id={`status-${assinatura.id}`} value={novo} onChange={(e) => setNovo(e.target.value)} data-testid="assinatura-status" className={`${SELECT} mb-2`}>
        {STATUS_ASSINATURA.map((s) => <option key={s} value={s}>{rotuloStatus(s)}</option>)}
      </select>
      <Campo id={`motivo-${assinatura.id}`} rotulo="Motivo (obrigatório, vai para a auditoria)" linhas={2}
        value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Botao aoTocar={confirmar} carregando={ocupado} desabilitado={novo === assinatura.status} className="w-full" data-testid="confirmar-transicao">
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
      <select id={`plano-${assinaturaId}`} value={escolha} onChange={(e) => { setEscolha(e.target.value); setExcedentes(null) }} className={`${SELECT} mb-1`}>
        {opcoes.map((p) => <option key={`${p.chave}|${p.versao}`} value={`${p.chave}|${p.versao}`}>{p.nome} v{p.versao}{p.publico ? '' : ' (fora da vitrine)'}</option>)}
      </select>
      <p className="text-xs text-faint mb-2">Troca só o plano (limites e recursos). O ciclo e o preço da assinatura não mudam por aqui.</p>
      {excedentes && (
        <Aviso tom="erro" titulo="O plano novo é menor que o uso atual">
          {excedentes.mensagem}
          <ul className="mt-1 text-xs">{(excedentes.excedentes || []).map((x, i) => <li key={i}>{x.clube}: {x.limite} {x.uso} de {x.teto}</li>)}</ul>
        </Aviso>
      )}
      <Botao variacao={excedentes ? 'perigo' : 'secundario'} aoTocar={() => aplicar(!!excedentes)} carregando={ocupado} desabilitado={escolha === atual} className="w-full">
        {excedentes ? 'Confirmar mesmo assim' : 'Aplicar plano'}
      </Botao>
    </div>
  )
}

// ---------------------------------------------------------------- Planos (todas as versões)
function Planos() {
  const { dados, erro } = useFonte(planosAdminListar)
  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="💳" titulo="Nenhum plano no catálogo" />}>
      <div className="space-y-3">
        <Nota icone="🔒">Somente leitura. Cada versão de plano é histórica: mudar o catálogo cria versão nova e não altera assinatura antiga em silêncio.</Nota>
        <ul className="grid gap-2 md:grid-cols-2">
          {(dados || []).map((p) => (
            <li key={p.id} data-testid="plano-item" className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-ink leading-tight">{p.nome}</p>
                  <p className="text-xs text-faint">{p.chave} · v{p.versao} · {p.assinaturas} assinatura(s)</p>
                </div>
                {(p.precos || [])[0] && <p className="shrink-0 text-right text-sm font-extrabold text-ink tabular-nums">{formatarPreco(p.precos[0].valor_centavos, p.precos[0].moeda)}<span className="block text-[11px] font-medium text-faint">/{p.precos[0].ciclo}</span></p>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Chip tom={p.publico ? 'ok' : 'neutro'} ponto>{p.publico ? 'Na vitrine' : 'Fora da vitrine'}</Chip>
                <Chip tom={p.ativo && p.status === 'publicado' ? 'marca' : 'perigo'}>{p.status}{p.ativo ? '' : ' · inativo'}</Chip>
                {p.provisorio && <Chip tom="atencao">Provisório</Chip>}
              </div>
              <div className="mt-3 space-y-0.5 border-t border-line pt-2 text-sm text-ink">
                {(p.precos || []).length === 0
                  ? <p className="text-muted text-xs">Sem preço.</p>
                  : p.precos.map((pr, i) => (
                    <p key={i} className="text-xs">{formatarPreco(pr.valor_centavos, pr.moeda)} / {pr.ciclo}{pr.ativo ? '' : ' (inativo)'} <span className="text-faint">· vigente de {data(pr.vigente_de)}{pr.vigente_ate ? ` até ${data(pr.vigente_ate)}` : ''}</span></p>
                  ))}
              </div>
              <p className="text-xs text-muted mt-2">
                <span className="text-faint">Limites:</span> {Object.keys(p.limites || {}).length === 0 ? 'sem limite' : Object.entries(p.limites).map(([k, v]) => `${k} ${v}`).join(' · ')}
              </p>
              <p className="text-xs text-muted"><span className="text-faint">Recursos:</span> {p.recursos ? p.recursos.join(', ') : 'todos'}</p>
            </li>
          ))}
        </ul>
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Assinaturas
function Assinaturas({ aoAbrirClube }) {
  const { dados, erro } = useFonte(assinaturasListar)
  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="🧾" titulo="Nenhuma assinatura">Quando um clube assinar um plano, aparece aqui.</EstadoVazio>}>
      <div className="space-y-3">
        <Nota>Licença/assinatura interna não é pagamento. Sem gateway integrado, nenhum pagamento aparece como confirmado aqui.</Nota>
        <ul className="grid gap-2 md:grid-cols-2">
          {(dados || []).map((s) => (
            <li key={s.id} data-testid="assinatura-item" className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-bold text-ink leading-tight">{(s.clubes || []).map((c) => c.nome).join(', ') || s.conta || 'Sem clube'}</p>
                <StatusChip status={s.status} rotulo={rotuloStatus(s.status)} cortesia={s.provider === 'cortesia' && s.status === 'ativa'} />
              </div>
              <p className="text-xs text-muted mt-1">
                {s.plano_nome} v{s.plano_versao} · {s.ciclo || 'ciclo —'} · início {data(s.criada_em)}
                {s.trial_ate ? ` · teste até ${data(s.trial_ate)}` : ''}{s.periodo_fim ? ` · período até ${data(s.periodo_fim)}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.faturas_pagas_gateway > 0
                  ? <Chip tom="ok">{s.faturas_pagas_gateway} pagamento(s) confirmado(s) pelo gateway</Chip>
                  : <Chip>Pagamento não confirmado por gateway</Chip>}
                {s.faturas_abertas > 0 && <Chip tom="atencao">{s.faturas_abertas} fatura(s) em aberto</Chip>}
              </div>
              {(s.clubes || [])[0] && <LinkAcao aoTocar={() => aoAbrirClube(s.clubes[0].club_id)}>Abrir clube</LinkAcao>}
            </li>
          ))}
        </ul>
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
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="💾" titulo="Nenhum clube" />}>
      <div className="space-y-2">
        <Nota icone="🔒">Só o tamanho usado. A administração não abre os arquivos dos clubes.</Nota>
        <ul className="grid gap-2 md:grid-cols-2">
          {lista.map((c) => (
            <li key={c.club_id} data-testid="armazenamento-item" className="rounded-2xl border border-line bg-surface">
              <button type="button" onClick={() => aoAbrirClube(c.club_id)} className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left min-h-[44px] ${FOCO}`}>
                <ClubeAvatar nome={c.nome} logoUrl={c.logo_url} cor={c.cor_primaria} sigla={c.sigla} tamanho="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-ink">{c.nome}</p>
                    <Chip tom={TOM_ARMAZENAMENTO[c.armazenamento_situacao]} ponto>{ROTULO_ARMAZENAMENTO[c.armazenamento_situacao]}</Chip>
                  </div>
                  <p className="text-xs text-muted mt-0.5 tabular-nums">
                    {formatarBytes(c.armazenamento_bytes)}{c.armazenamento_limite_mb ? ` de ${formatarBytes(c.armazenamento_limite_mb * 1048576)} · ${c.armazenamento_pct}%` : ' · sem limite'}
                  </p>
                  {c.armazenamento_limite_mb > 0 && <div className="mt-1.5"><BarraUso pct={c.armazenamento_pct} situacao={c.armazenamento_situacao} rotulo={`Armazenamento de ${c.nome}`} /></div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
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
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="🧭" titulo="Nenhum onboarding iniciado">Os cadastros de clube em andamento aparecem aqui.</EstadoVazio>}>
      {nParados > 0 && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="onboarding-parados">
          <span aria-hidden="true">⚠️</span>{nParados} cadastro(s) de clube parado(s) há mais de {DIAS_ONBOARDING_PARADO} dias.
        </p>
      )}
      <ul className="grid gap-2 md:grid-cols-2">
        {lista.map((o) => {
          const alerta = o.parado > DIAS_ONBOARDING_PARADO
          return (
            <li key={o.id} data-testid="onboarding-item"
              className={`rounded-2xl border bg-surface p-4 ${alerta ? 'border-amber-400/70 ring-1 ring-amber-400/30' : 'border-line'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold text-ink">{o.clube || 'Clube ainda não criado'}</p>
                <Chip tom={o.status === 'concluido' ? 'ok' : o.status === 'abandonado' ? 'perigo' : 'atencao'} ponto>{ROTULO_ONBOARDING[o.status] || o.status}</Chip>
              </div>
              {o.parado != null && (
                <p className={`text-sm mt-1 font-semibold ${alerta ? 'text-amber-800 dark:text-amber-300' : 'text-muted'}`} data-testid="onboarding-parado">
                  {o.parado === 0 ? 'Mexido hoje' : `Parado há ${o.parado} dia${o.parado === 1 ? '' : 's'}`} na etapa “{o.etapa}”
                </p>
              )}
              <p className="text-xs text-muted mt-1">
                Etapa atual: {o.etapa} · {(o.etapas_concluidas || []).length} etapa(s) concluída(s) · iniciado {data(o.iniciado_em)} · atualizado {dataHora(o.atualizado_em)}
                {o.provisionamento ? ` · provisionamento ${o.provisionamento}` : ''}
              </p>
              {o.ultimo_erro && <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">Último erro: {o.ultimo_erro}</p>}
              {o.club_id && <LinkAcao aoTocar={() => aoAbrirClube(o.club_id)}>Abrir clube</LinkAcao>}
            </li>
          )
        })}
      </ul>
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
    <Estado erro={erro} dados={lista} vazio={<EstadoVazio icone="✅" titulo="Nenhuma pendência de provisionamento">Todos os clubes foram montados corretamente.</EstadoVazio>}>
      <ul className="space-y-2">
        {(lista || []).map((p) => (
          <li key={p.club_id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{p.clube}</p>
              <p className="text-xs text-muted"><Chip tom="perigo">{p.status}</Chip> <span className="ml-1">{p.tentativas} tentativa(s){p.erro ? ` · ${p.erro}` : ''}</span></p>
            </div>
            <Botao variacao="secundario" aoTocar={() => reexecutar(p.club_id)} carregando={ocupado === p.club_id}>Reexecutar</Botao>
          </li>
        ))}
      </ul>
    </Estado>
  )
}

// ---------------------------------------------------------------- Suporte
const ROTULO_SUPORTE = {
  solicitado: 'Aguardando o clube autorizar', autorizado: 'Autorizado pelo clube',
  recusado: 'Recusado pelo clube', revogado: 'Revogado',
}
const TOM_SUPORTE = { solicitado: 'atencao', autorizado: 'ok', recusado: 'neutro', revogado: 'neutro' }

function Suporte() {
  const { dados: lista, erro, recarregar } = useFonte(suporteListar)
  async function revogar(id) {
    try { await suporteRevogar(id, 'Revogado pelo admin.'); recarregar() } catch (e) { avisar.erro(e) }
  }
  return (
    <Estado erro={erro} dados={lista}>
      <div className="space-y-3">
        <Nota icone="🛟">
          Nesta versão, autorizar um pedido aqui <strong>não concede acesso real</strong> a dado de
          clube — fica registrado e auditado. Só a liderança do clube autoriza; o admin nunca autoriza
          o próprio pedido.
        </Nota>
        {(lista || []).length === 0
          ? <EstadoVazio icone="🛟" titulo="Nenhum pedido de suporte" />
          : (
            <ul className="space-y-2">
              {lista.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{g.motivo}</p>
                    <Chip tom={TOM_SUPORTE[g.status] || 'neutro'} ponto className="mt-1">{ROTULO_SUPORTE[g.status] || g.status}</Chip>
                  </div>
                  {['solicitado', 'autorizado'].includes(g.status) && (
                    <Botao variacao="perigo" aoTocar={() => revogar(g.id)}>Revogar</Botao>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Auditoria
function Auditoria() {
  const { dados: lista, erro } = useFonte(auditoriaListar)
  return (
    <Estado erro={erro} dados={lista} vazio={<EstadoVazio icone="📜" titulo="Nenhum evento ainda">Toda ação administrativa fica registrada aqui.</EstadoVazio>}>
      <Painel>
        <ol className="relative ml-1.5 space-y-3 border-l border-line pl-4">
          {(lista || []).map((e) => (
            <li key={e.id} className="relative">
              <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-surface ring-2 ring-brand/60" />
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-ink">{e.acao}</p>
                <Chip>{e.alvo_tipo}</Chip>
              </div>
              <p className="text-xs text-muted">{dataHora(e.created_at)}{e.detalhe?.motivo ? ` · ${e.detalhe.motivo}` : ''}{e.detalhe?.para ? ` · ${e.detalhe.para}` : ''}</p>
            </li>
          ))}
        </ol>
      </Painel>
    </Estado>
  )
}
