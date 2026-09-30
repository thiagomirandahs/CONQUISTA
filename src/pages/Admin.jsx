import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Botao, Aviso, Campo } from '../ui/index.jsx'
import { useAuth } from '../context/Auth.jsx'
import { Link, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
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
import { Tabela, Paginacao, Filtros, useOrdenacao, usePaginacao, useTelaLarga, contem } from '../components/admin/Tabela.jsx'
import { SidebarAdmin, GavetaAdmin, BotaoMenuAdmin } from '../components/admin/NavegacaoAdmin.jsx'
import AdminHierarquia from './AdminHierarquia.jsx'
import AdminCortesias from './AdminCortesias.jsx'
import AdminVitrine from './AdminVitrine.jsx'
import AdminAudiolivros from './AdminAudiolivros.jsx'
import AdminPaineisPlano from './AdminPaineisPlano.jsx'
import AdminManutencao from './AdminManutencao.jsx'
import AdminComunidade from './AdminComunidade.jsx'
import AdminRecursosPlataforma from './AdminRecursosPlataforma.jsx'
import { LimiteMembrosClube, PacotesGuardados } from './AdminMembrosLixeira.jsx'
import AdminChamados from './AdminChamados.jsx'
import { adminChamadosContagem } from '../services/suporte.js'
import { ZonaDePerigoClube, LixeiraDeClubes } from './AdminExcluirClube.jsx'

// /admin — Administração da PLATAFORMA (SaaS): conta, clube, plano, assinatura, armazenamento,
// onboarding, provisionamento, suporte e auditoria. Autoridade COMERCIAL, nunca eclesiástica: nenhuma
// tela aqui lê chat, foto, evidência, documento, mensalidade individual ou dado de criança — as RPCs
// (migrations 48 e 103) só devolvem metadado e contagens, e todas exigem eh_admin_plataforma() no
// servidor. O admin não ganha vínculo de clube; a Gestão do clube continua sendo da diretoria.
//
// Navegação (Fase 6, 5.2): 14 SEÇÕES na barra lateral (≥ lg) ou na gaveta ☰ (< lg). Algumas seções
// agrupam telas em sub-abas (Planos = catálogo + painéis + cortesias; Recursos = vitrine + audiolivros;
// Suporte = chamados + acessos). A tela aberta continua sendo `?aba=<chave>` na URL — as 18 chaves
// antigas valem (o link da notificação de chamado é ?aba=chamados&chamado=<id>).
const ABAS = [
  { chave: 'visao', rotulo: 'Visão geral', icone: '📊' },
  { chave: 'clubes', rotulo: 'Clubes', icone: '🏕️' },
  { chave: 'planos', rotulo: 'Catálogo', icone: '💳' },
  { chave: 'paineis', rotulo: 'Painéis do plano', icone: '🧩' },
  { chave: 'cortesias', rotulo: 'Cortesias', icone: '🎁' },
  { chave: 'assinaturas', rotulo: 'Assinaturas', icone: '🧾' },
  { chave: 'armazenamento', rotulo: 'Armazenamento', icone: '💾' },
  { chave: 'onboarding', rotulo: 'Onboarding', icone: '🧭' },
  { chave: 'provisionamento', rotulo: 'Provisionamento', icone: '⚙️' },
  { chave: 'hierarquia', rotulo: 'Hierarquia', icone: '🌳' },
  { chave: 'vitrine', rotulo: 'Vitrine do site', icone: '🪧' },
  { chave: 'audiolivros', rotulo: 'Audiolivros', icone: '🎧' },
  // exceção declarada: a Comunidade é conteúdo PÚBLICO entre clubes; a plataforma modera (primeiro nome + clube, nunca dado pessoal)
  { chave: 'comunidade', rotulo: 'Rede DBV', icone: '🌎' },
  { chave: 'chamados', rotulo: 'Chamados', icone: '📨' },
  { chave: 'suporte', rotulo: 'Acessos de suporte', icone: '🛟' },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: '📜' },
  { chave: 'manutencao', rotulo: 'Manutenção', icone: '🛠️' },
  { chave: 'lixeira-clubes', rotulo: 'Lixeira de clubes', icone: '🗑️' },
]
export const SECOES = [
  { chave: 'visao', rotulo: 'Visão geral', icone: '📊', abas: ['visao'], descricao: 'Números da plataforma e o que pede ação.' },
  { chave: 'clubes', rotulo: 'Clubes', icone: '🏕️', abas: ['clubes'], descricao: 'Todos os clubes, com plano, uso e situação.' },
  { chave: 'planos', rotulo: 'Planos', icone: '💳', abas: ['planos', 'paineis', 'cortesias'], descricao: 'Catálogo, painéis liberados por plano e cortesias.' },
  { chave: 'assinaturas', rotulo: 'Assinaturas', icone: '🧾', abas: ['assinaturas'], descricao: 'Licenças por clube e situação de pagamento.' },
  { chave: 'armazenamento', rotulo: 'Armazenamento', icone: '💾', abas: ['armazenamento'], descricao: 'Uso de espaço por clube (só o tamanho, nunca os arquivos).' },
  { chave: 'onboarding', rotulo: 'Onboarding', icone: '🧭', abas: ['onboarding'], descricao: 'Cadastros de clube em andamento, concluídos ou parados.' },
  { chave: 'provisionamento', rotulo: 'Provisionamento', icone: '⚙️', abas: ['provisionamento'], descricao: 'Clubes cuja montagem inicial falhou.' },
  { chave: 'hierarquia', rotulo: 'Hierarquia', icone: '🌳', abas: ['hierarquia'], descricao: 'Distritos, regiões, associações e coordenadores.' },
  { chave: 'recursos', rotulo: 'Recursos', icone: '🧩', abas: ['vitrine', 'audiolivros'], descricao: 'Vitrine do site e catálogo de audiolivros.' },
  { chave: 'rede', rotulo: 'Rede DBV', icone: '🌎', abas: ['comunidade'], descricao: 'Moderação da comunidade entre clubes.' },
  { chave: 'suporte', rotulo: 'Suporte', icone: '🛟', abas: ['chamados', 'suporte'], descricao: 'Central de chamados e acessos de suporte autorizados pelos clubes.' },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: '📜', abas: ['auditoria'], descricao: 'Trilha imutável de tudo que a administração fez.' },
  { chave: 'manutencao', rotulo: 'Manutenção', icone: '🛠️', abas: ['manutencao'], descricao: 'Modo manutenção da plataforma.' },
  { chave: 'lixeira-clubes', rotulo: 'Lixeira', icone: '🗑️', abas: ['lixeira-clubes'], descricao: 'Clubes excluídos, à espera do expurgo.' },
]
const secaoDaAba = (aba) => SECOES.find((s) => s.abas.includes(aba)) || SECOES[0]

const ROTULO_ARMAZENAMENTO = { sem_limite: 'Sem limite', normal: 'Normal', proximo: 'Próximo do limite', atingido: 'Limite atingido' }
const TOM_ARMAZENAMENTO = { sem_limite: 'neutro', normal: 'ok', proximo: 'atencao', atingido: 'perigo' }
const ROTULO_ONBOARDING = { em_andamento: 'Em andamento', concluido: 'Concluído', abandonado: 'Abandonado' }
const tomAssinatura = (s) => (s === 'ativa' ? 'ok' : s === 'trial' ? 'info' : ['inadimplente', 'suspensa'].includes(s) ? 'perigo' : s === 'cancelada' ? 'neutro' : 'atencao')
const ehCortesia = (c) => c?.provider === 'cortesia' && c?.assinatura_status === 'ativa'
const rotuloStatus = (s) => ROTULO_STATUS[s] || s
const STATUS_ASSINATURA = ['trial', 'ativa', 'pagamento_pendente', 'inadimplente', 'suspensa', 'cancelada']

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
  // A seção vive na URL (?aba=chamados&chamado=<id> — link da notificação de chamado novo, link direto,
  // voltar/avançar do navegador). Trocar de seção empilha no histórico (replace: false), então o botão
  // "voltar" do aparelho volta para a seção anterior em vez de sair do /admin.
  const [params, setParams] = useSearchParams()
  const abaDaUrl = params.get('aba')
  const aba = ABAS.some((a) => a.chave === abaDaUrl) ? abaDaUrl : 'visao'
  const secao = secaoDaAba(aba)
  const setAba = useCallback((nova) => {
    setParams((p) => {
      const q = new URLSearchParams(p)
      if (nova === 'visao') q.delete('aba'); else q.set('aba', nova)
      if (nova !== 'chamados') q.delete('chamado')
      return q
    }, { replace: false })
  }, [setParams])
  const [clubeAberto, setClubeAberto] = useState(null)
  const [autorizado, setAutorizado] = useState(null)
  const [erroAcesso, setErroAcesso] = useState('')
  const [contadores, setContadores] = useState({})
  const larga = useTelaLarga('lg')

  // Badges das seções (pendências): só depois que o servidor confirmou o admin.
  useEffect(() => {
    if (!autorizado) return
    Promise.resolve().then(visaoGeral).then((v) => v && setContadores((c) => ({
      ...c, provisionamento: v.provisionamentos_pendentes || 0, onboarding: v.onboarding_em_andamento || 0,
    }))).catch(() => {})
    atualizarChamados()
  }, [autorizado])
  // contador de chamados que pedem atenção (aberto + em andamento) — badge "Suporte" no menu
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

  const abrirClube = (id) => { setClubeAberto(id); if (aba !== 'clubes') setAba('clubes') }
  const trocarAba = (a) => { setClubeAberto(null); if (a !== aba) setAba(a) }
  // tocar numa seção abre a primeira tela dela (ou mantém a atual, se já está nela)
  const trocarSecao = (chave) => {
    const s = SECOES.find((x) => x.chave === chave) || SECOES[0]
    trocarAba(s.abas.includes(aba) ? aba : s.abas[0])
  }

  return (
    // Mobile-first: o /admin fica fora do AppLayout, então o respiro lateral (16px) é daqui.
    <div className="min-h-dvh bg-bg">
      {larga && <SidebarAdmin secoes={SECOES} ativa={secao.chave} aoTrocar={trocarSecao} contadores={contadores} />}
      <div style={larga ? { paddingLeft: '16rem' } : undefined}>
        <CabecalhoAdmin larga={larga} />
        <div className="max-w-7xl mx-auto px-4 pb-12" style={{ paddingRight: 'max(1rem, var(--seguro-dir))', paddingLeft: larga ? undefined : 'max(1rem, var(--seguro-esq))' }}>
          {!larga && <MenuMovel secoes={SECOES} ativa={secao.chave} aoTrocar={trocarSecao} contadores={contadores} />}
          <TituloDaSecao secao={secao} aba={aba} aoTrocarAba={trocarAba} contadores={contadores} />
          {aba === 'visao' && <VisaoGeral irPara={trocarAba} aoAbrirClube={abrirClube} chamadosAbertos={contadores.chamados} />}
          {aba === 'clubes' && (clubeAberto
            ? <DetalheClube clubId={clubeAberto} aoVoltar={() => setClubeAberto(null)} />
            : <Clubes aoAbrir={abrirClube} />)}
          {aba === 'hierarquia' && <AdminHierarquia />}
          {aba === 'planos' && <Planos />}
          {aba === 'paineis' && <AdminPaineisPlano />}
          {aba === 'assinaturas' && <Assinaturas aoAbrirClube={abrirClube} />}
          {aba === 'cortesias' && <AdminCortesias />}
          {aba === 'vitrine' && <AdminVitrine />}
          {aba === 'audiolivros' && <AdminAudiolivros />}
          {aba === 'comunidade' && <AdminComunidade />}
          {aba === 'armazenamento' && <Armazenamento aoAbrirClube={abrirClube} />}
          {aba === 'onboarding' && <Onboarding aoAbrirClube={abrirClube} />}
          {aba === 'provisionamento' && <Provisionamento />}
          {aba === 'chamados' && <AdminChamados inicial={params.get('chamado')} aoMudarContagem={atualizarChamados} />}
          {aba === 'suporte' && <Suporte />}
          {aba === 'manutencao' && <AdminManutencao />}
          {aba === 'auditoria' && <Auditoria />}
          {aba === 'lixeira-clubes' && <LixeiraDeClubes />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Cabeçalho e navegação
// Conta de admin SEM clube (o dono separa a conta de admin da conta do clube): o painel precisa das
// saídas da conta — trocar senha, suporte e SAIR — já que não passa pelo layout do clube.
function MenuDaContaAdmin() {
  const { sair } = useAuth() || {}
  const [aberto, setAberto] = useState(false)
  const item = 'flex w-full min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-ink active:bg-surface2'
  return (
    <div className="relative">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-label="Minha conta" data-testid="admin-conta"
        className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-lg ring-1 ring-white/20">👤</button>
      {aberto && createPortal(
        <>
        {/* renderizado direto no <body> (portal): a transição de página aplica transform no conteúdo, o que
            prendia o menu numa camada abaixo da barra de seção. Fixo, acima de tudo; tocar fora fecha. */}
        <button type="button" aria-label="Fechar menu" tabIndex={-1} onClick={() => setAberto(false)} className="fixed inset-0 z-[90] cursor-default bg-black/20" />
        <div className="fixed right-4 top-[calc(4rem+var(--seguro-topo))] z-[100] w-64 rounded-2xl border border-line bg-surface p-1.5 text-ink shadow-xl">
          <Link to="/conta/senha" className={item}><span aria-hidden="true">🔑</span>Trocar senha</Link>
          <Link to="/institucional" className={item}><span aria-hidden="true">🏛️</span>Portal da coordenação</Link>
          <button type="button" className={`${item} text-red-600`} onClick={sair} data-testid="admin-sair"><span aria-hidden="true">🚪</span>Sair da conta</button>
        </div>
        </>,
        document.body,
      )}
    </div>
  )
}
// Barra compacta azul-marinho (a mesma da landing), fixa no topo ao rolar. Com a barra lateral (≥ lg)
// a marca já está nela, então o cabeçalho fica só com o título e a conta.
function CabecalhoAdmin({ larga }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07122f] text-white" style={{ paddingTop: 'var(--seguro-topo)' }}>
      <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 py-3" style={{ paddingRight: 'max(1rem, var(--seguro-dir))', paddingLeft: larga ? undefined : 'max(1rem, var(--seguro-esq))' }}>
        {!larga && <img src={MARCA_PRODUTO.logoUrl} alt="" width="36" height="36" className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-white/15" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-extrabold leading-tight tracking-tight">Administração</h1>
          <p className="truncate text-xs text-white/70">DesbravaClube · plataforma</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#f5c518]/15 px-2.5 py-1 text-xs font-semibold text-[#f5c518] ring-1 ring-inset ring-[#f5c518]/30">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#f5c518]" />Admin da plataforma
        </span>
        <MenuDaContaAdmin />
      </div>
    </header>
  )
}

// < lg: barra com a seção atual + ☰ que abre a gaveta com as 14 seções.
function MenuMovel({ secoes, ativa, aoTrocar, contadores = {} }) {
  const [aberto, setAberto] = useState(false)
  const refBotao = useRef(null)
  const fechar = useCallback(() => setAberto(false), [])
  const atual = secoes.find((s) => s.chave === ativa) || secoes[0]
  const totalPendencias = Object.values(contadores).reduce((t, n) => t + (Number(n) || 0), 0)
  return (
    <nav aria-label="Áreas da administração" className="sticky top-[calc(61px+var(--seguro-topo))] z-20 -mx-4 mb-4 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur">
      <BotaoMenuAdmin atual={atual} aberto={aberto} aoTocar={() => setAberto((v) => !v)} totalPendencias={totalPendencias} refBotao={refBotao} />
      <GavetaAdmin aberta={aberto} aoFechar={fechar} secoes={secoes} ativa={ativa} aoTrocar={aoTrocar} contadores={contadores} refBotao={refBotao} />
    </nav>
  )
}

// Título da seção + sub-abas (quando a seção agrupa mais de uma tela).
function TituloDaSecao({ secao, aba, aoTrocarAba, contadores = {} }) {
  const subAbas = secao.abas.length > 1 ? secao.abas.map((c) => ABAS.find((a) => a.chave === c)).filter(Boolean) : []
  return (
    <div className="mb-4 space-y-3" data-testid="titulo-secao">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink">
          <span aria-hidden="true">{secao.icone}</span>{secao.rotulo}
        </h2>
        {secao.descricao && <p className="text-sm text-muted">{secao.descricao}</p>}
      </div>
      {subAbas.length > 0 && (
        <div role="group" aria-label={`Telas de ${secao.rotulo}`} className="flex flex-wrap gap-1.5">
          {subAbas.map((a) => {
            const sel = a.chave === aba
            const n = contadores[a.chave]
            return (
              <button key={a.chave} type="button" onClick={() => aoTrocarAba(a.chave)} aria-pressed={sel} data-testid={`subaba-${a.chave}`}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${FOCO} ${sel
                  ? 'bg-[#0b1f4d] text-white dark:bg-white dark:text-[#07122f]' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}>
                <span aria-hidden="true">{a.icone}</span>{a.rotulo}
                {n > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-5 text-white">{n}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Visão geral
// KPIs SÓ do que o servidor fornece: admin_visao_geral (migration 103) + admin_chamados_contagem (290).
// Não existe (e não se inventa): receita/MRR, churn, série histórica, usuários ativos.
// KPI só aparece quando o servidor mandou o número (payload parcial não vira "undefined" na tela).
const tem = (n) => n !== null && n !== undefined
function VisaoGeral({ irPara, aoAbrirClube, chamadosAbertos }) {
  const { dados: v, erro } = useFonte(visaoGeral)
  return (
    <Estado erro={erro} dados={v} esqueleto={<EsqueletoKpis />}>
      {v && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            {tem(v.clubes_total) && <Kpi icone="🏕️" valor={v.clubes_total} rotulo="Clubes" detalhe={`${v.clubes_ativos} ativo(s) · ${v.clubes_inativos} inativo(s)`} testid="visao-clubes" aoTocar={() => irPara('clubes')} />}
            {tem(v.clubes_ativos) && <Kpi icone="✅" tom="ok" valor={v.clubes_ativos} rotulo="Clubes ativos" testid="visao-ativos" aoTocar={() => irPara('clubes')} />}
            {tem(v.clubes_inativos) && <Kpi icone="⛔" tom={v.clubes_inativos > 0 ? 'perigo' : 'neutro'} valor={v.clubes_inativos} rotulo="Clubes inativos" testid="visao-inativos" aoTocar={() => irPara('clubes')} />}
            {tem(v.onboarding_em_andamento) && <Kpi icone="🧭" tom="info" valor={v.onboarding_em_andamento} rotulo="Em onboarding" detalhe={`${v.onboarding_concluidos ?? 0} concluído(s)`} testid="visao-onboarding" aoTocar={() => irPara('onboarding')} />}
            {tem(v.provisionamentos_pendentes) && <Kpi icone="⚙️" tom={v.provisionamentos_pendentes > 0 ? 'perigo' : 'neutro'} valor={v.provisionamentos_pendentes} rotulo="Provisionamentos pendentes" testid="visao-provisionamento" aoTocar={() => irPara('provisionamento')} />}
            <Kpi icone="📨" tom={chamadosAbertos > 0 ? 'atencao' : 'neutro'} valor={chamadosAbertos ?? '—'} rotulo="Chamados abertos" detalhe="abertos + em andamento" testid="visao-chamados" aoTocar={() => irPara('chamados')} />
            {tem(v.armazenamento_total_bytes) && <Kpi icone="💾" tom="ok" valor={formatarBytes(v.armazenamento_total_bytes)} rotulo="Armazenamento total" testid="visao-armazenamento"
              detalhe={v.clubes_proximos_do_limite + v.clubes_no_limite > 0 ? `${v.clubes_proximos_do_limite} perto · ${v.clubes_no_limite} no limite` : 'Todos dentro do limite'} aoTocar={() => irPara('armazenamento')} />}
            {tem(v.planos_total) && <Kpi icone="💳" tom="dourado" valor={`${v.planos_publicos}/${v.planos_total}`} rotulo="Planos na vitrine / total" testid="visao-planos" aoTocar={() => irPara('planos')} />}
            {tem(v.eventos_admin_7d) && <Kpi icone="📜" valor={v.eventos_admin_7d} rotulo="Ações de administração" detalhe="últimos 7 dias" testid="visao-eventos-admin" aoTocar={() => irPara('auditoria')} />}
            {tem(v.eventos_assinatura_7d) && <Kpi icone="🧾" valor={v.eventos_assinatura_7d} rotulo="Eventos de assinatura" detalhe="últimos 7 dias" testid="visao-eventos-assinatura" aoTocar={() => irPara('assinaturas')} />}
          </div>

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <PrecisaAtencao v={v} chamadosAbertos={chamadosAbertos} irPara={irPara} aoAbrirClube={aoAbrirClube} />
            <Painel titulo="Assinaturas por status" icone="🧾" acao={<LinkAcao aoTocar={() => irPara('assinaturas')}>Ver</LinkAcao>} data-testid="visao-assinaturas">
              <ul className="divide-y divide-line">
                {STATUS_ASSINATURA.map((s) => {
                  const n = Number(v.assinaturas_por_status?.[s] || 0)
                  return (
                    <li key={s} className="flex items-center justify-between gap-2 py-1.5">
                      <Chip tom={n > 0 ? tomAssinatura(s) : 'neutro'} ponto>{rotuloStatus(s)}</Chip>
                      <span className="text-sm font-bold text-ink tabular-nums" data-testid={`visao-status-${s}`}>{n}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-[11px] text-faint">Contagem por assinatura (um clube pode ter mais de uma ao longo do tempo).</p>
            </Painel>
          </div>
        </div>
      )}
    </Estado>
  )
}

function EsqueletoKpis() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
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

// "Precisa da sua atenção": só aparece o que está > 0. Os números vêm de admin_visao_geral e
// admin_chamados_contagem; o teste acabando e o onboarding parado vêm das listas admin já existentes.
function PrecisaAtencao({ v, chamadosAbertos, irPara, aoAbrirClube }) {
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
  const por = v.assinaturas_por_status || {}
  const nInad = Number(por.inadimplente || 0)
  const nPend = Number(por.pagamento_pendente || 0)
  const nSusp = Number(por.suspensa || 0)

  const itens = []
  if (v.provisionamentos_pendentes > 0) itens.push({ k: 'prov', tom: 'perigo', icone: '⚙️', titulo: `${v.provisionamentos_pendentes} provisionamento(s) pendente(s)`, texto: 'Reexecute em Provisionamento', acao: () => irPara('provisionamento') })
  if (v.clubes_no_limite > 0) itens.push({ k: 'arm-no', tom: 'perigo', icone: '💾', titulo: `${v.clubes_no_limite} clube(s) no limite de armazenamento`, texto: 'Não conseguem enviar fotos até liberar espaço ou mudar de plano', acao: () => irPara('armazenamento') })
  if (v.clubes_proximos_do_limite > 0) itens.push({ k: 'arm-perto', tom: 'atencao', icone: '💾', titulo: `${v.clubes_proximos_do_limite} clube(s) perto do limite`, texto: 'de armazenamento do plano', acao: () => irPara('armazenamento') })
  if (nInad > 0) itens.push({ k: 'inad', tom: 'perigo', icone: '🧾', titulo: `${nInad} assinatura(s) com pagamento em atraso`, texto: 'Ver em Assinaturas', acao: () => irPara('assinaturas') })
  if (nSusp > 0) itens.push({ k: 'susp', tom: 'atencao', icone: '🧾', titulo: `${nSusp} assinatura(s) suspensa(s)`, texto: 'Clubes sem acesso às ferramentas', acao: () => irPara('assinaturas') })
  if (nPend > 0) itens.push({ k: 'pend', tom: 'atencao', icone: '🧾', titulo: `${nPend} assinatura(s) aguardando pagamento`, texto: 'Teste encerrado sem licença ativa', acao: () => irPara('assinaturas') })
  if (chamadosAbertos > 0) itens.push({ k: 'cham', tom: 'atencao', icone: '📨', titulo: `${chamadosAbertos} chamado(s) aberto(s)`, texto: 'Aguardando resposta do suporte', acao: () => irPara('chamados') })
  for (const c of trials.slice(0, 5)) {
    itens.push({ k: `t${c.club_id}`, tom: c.restam <= 2 ? 'perigo' : 'atencao', icone: '⏳',
      titulo: c.nome, texto: c.restam > 0 ? `Teste acaba em ${c.restam} dia(s) · ${data(c.trial_ate)}` : 'Teste venceu', acao: () => aoAbrirClube(c.club_id) })
  }
  if (parados.length) itens.push({ k: 'onb', tom: 'atencao', icone: '🧭', titulo: `${parados.length} cadastro(s) parado(s)`, texto: `Sem avanço há mais de ${DIAS_ONBOARDING_PARADO} dias`, acao: () => irPara('onboarding') })
  if (nHier) itens.push({ k: 'hier', tom: 'info', icone: '🌳', titulo: `${nHier} pendência(s) de hierarquia`, texto: 'Clube pedindo unidade ou coordenador aguardando', acao: () => irPara('hierarquia') })

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
const FILTROS_STATUS_CLUBE = [['todos', 'Todos'], ['sem_assinatura', 'Sem assinatura'], ...STATUS_ASSINATURA.map((s) => [s, rotuloStatus(s)])]
const COLUNAS_CLUBES = [
  { chave: 'nome', rotulo: 'Clube', ordenavel: true, valor: (c) => c.nome },
  { chave: 'status', rotulo: 'Status', ordenavel: true, valor: (c) => (c.status !== 'ativo' ? 'zz-inativo' : c.assinatura_status || 'zz') },
  { chave: 'plano', rotulo: 'Plano', ordenavel: true, valor: (c) => c.plano_nome },
  { chave: 'membros', rotulo: 'Membros', ordenavel: true, alinhar: 'direita', valor: (c) => c.membros },
  { chave: 'storage', rotulo: 'Storage', ordenavel: true, alinhar: 'direita', valor: (c) => c.armazenamento_pct, largura: '9rem' },
  { chave: 'onboarding', rotulo: 'Onboarding', ordenavel: true, valor: (c) => c.onboarding_status },
  { chave: 'criado', rotulo: 'Criado', ordenavel: true, valor: (c) => c.criado_em },
]

function Clubes({ aoAbrir }) {
  const { dados, erro } = useFonte(clubesListar)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [statusFiltro, setStatusFiltro] = useState('todos')

  const lista = useMemo(() => (dados || []).filter((c) => {
    if (!contem(busca, c.nome, c.slug, c.sigla)) return false
    if (statusFiltro === 'sem_assinatura' && c.assinatura_id) return false
    if (statusFiltro !== 'todos' && statusFiltro !== 'sem_assinatura' && c.assinatura_status !== statusFiltro) return false
    if (filtro === 'onboarding') return c.onboarding_status === 'em_andamento'
    if (filtro === 'sem_assinatura') return !c.assinatura_id
    if (filtro === 'armazenamento') return ['proximo', 'atingido'].includes(c.armazenamento_situacao)
    if (filtro === 'inativos') return c.status !== 'ativo'
    return true
  }), [dados, busca, filtro, statusFiltro])
  const contagens = useMemo(() => {
    const n = { todos: (dados || []).length, sem_assinatura: (dados || []).filter((c) => !c.assinatura_id).length }
    for (const s of STATUS_ASSINATURA) n[s] = (dados || []).filter((c) => c.assinatura_status === s).length
    return n
  }, [dados])
  const { ordenada, ordem, ordenarPor } = useOrdenacao(lista, COLUNAS_CLUBES)
  const pag = usePaginacao(ordenada, 25)

  const colunas = useMemo(() => COLUNAS_CLUBES.map((col) => ({
    ...col,
    render: {
      nome: (c) => (
        <span className="flex items-center gap-2.5">
          <ClubeAvatar nome={c.nome} logoUrl={c.logo_url} cor={c.cor_primaria} sigla={c.sigla} tamanho="sm" />
          <span className="min-w-0"><span className="block truncate font-bold">{c.nome}</span><span className="block truncate text-xs text-faint">{c.slug || '—'}</span></span>
        </span>
      ),
      status: (c) => (
        <span className="flex flex-wrap gap-1">
          <StatusChip status={c.assinatura_status} rotulo={rotuloStatus(c.assinatura_status)} cortesia={ehCortesia(c)} />
          {c.status !== 'ativo' && <Chip tom="perigo">Inativo</Chip>}
        </span>
      ),
      plano: (c) => (c.plano_nome ? `${c.plano_nome}${c.ciclo ? ` · ${c.ciclo}` : ''}` : <span className="text-faint">Sem plano</span>),
      membros: (c) => <span className="tabular-nums">{c.membros ?? '—'}{c.membros_limite ? ` / ${c.membros_limite}` : ''}</span>,
      storage: (c) => (c.armazenamento_limite_mb > 0
        ? <span className="block"><span className="block text-xs tabular-nums">{c.armazenamento_pct}%</span><BarraUso pct={c.armazenamento_pct} situacao={c.armazenamento_situacao} rotulo={`Armazenamento de ${c.nome}`} /></span>
        : <span className="text-xs text-faint">{formatarBytes(c.armazenamento_bytes)}</span>),
      onboarding: (c) => (c.onboarding_status === 'em_andamento' ? <Chip tom="atencao">{c.onboarding_etapa}</Chip> : c.onboarding_status ? ROTULO_ONBOARDING[c.onboarding_status] : <span className="text-faint">—</span>),
      criado: (c) => <span className="whitespace-nowrap text-xs">{data(c.criado_em)}</span>,
    }[col.chave],
  })), [])

  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="🏕️" titulo="Nenhum clube ainda">Quando um clube se cadastrar, ele aparece aqui.</EstadoVazio>}>
      <div className="space-y-3">
        {/* 360px: busca e filtro empilhados, cada um com a largura toda (o filtro não corta as opções);
            a partir de sm ficam lado a lado. */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] sm:items-end gap-2">
          <Campo id="admin-busca-clube" rotulo="Buscar clube" tipo="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, sigla ou código" />
          <div className="mb-3">
            <label htmlFor="admin-filtro-clube" className="block text-sm font-medium text-ink mb-1">Filtro</label>
            <select id="admin-filtro-clube" value={filtro} onChange={(e) => setFiltro(e.target.value)}
              className={`w-full min-w-0 sm:w-56 min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink ${FOCO}`}>
              <option value="todos">Todos</option>
              <option value="onboarding">Em onboarding</option>
              <option value="sem_assinatura">Sem assinatura</option>
              <option value="armazenamento">Perto/no limite de armazenamento</option>
              <option value="inativos">Inativos</option>
            </select>
          </div>
        </div>
        <Filtros rotulo="Status da assinatura" opcoes={FILTROS_STATUS_CLUBE} valor={statusFiltro} aoMudar={setStatusFiltro} contagens={contagens} />
        <p className="text-xs font-medium text-muted" role="status">{lista.length} de {(dados || []).length} clube(s)</p>
        {lista.length === 0 && <EstadoVazio icone="🔎" titulo="Nenhum clube encontrado">Tente outro termo ou limpe o filtro.</EstadoVazio>}
        {lista.length > 0 && (
          <>
            <Tabela colunas={colunas} linhas={pag.fatia} id={(c) => c.club_id} ordem={ordem} ordenarPor={ordenarPor} legenda="Clubes da plataforma"
              testidLinha="clube-item" aoTocarLinha={(c) => aoAbrir(c.club_id)} className="md:grid-cols-2"
              cartao={(c) => <CartaoClube c={c} aoAbrir={aoAbrir} />} />
            <Paginacao {...pag} rotulo="clube(s)" />
          </>
        )}
      </div>
    </Estado>
  )
}

function CartaoClube({ c, aoAbrir }) {
  const temLimiteArmaz = c.armazenamento_limite_mb > 0
  // "Distrito Cavaleiro" já traz o tipo no nome: não repetir ("Distrito Distrito Cavaleiro")
  const tipoRot = TIPO_ROTULO?.[c.vinculado_a_tipo] || ''
  const nomeVinc = c.vinculado_a_nome || ''
  const local = nomeVinc ? (tipoRot && !nomeVinc.toLowerCase().startsWith(tipoRot.toLowerCase()) ? `${tipoRot} ${nomeVinc}` : nomeVinc) : ''
  return (
    <div className="h-full rounded-2xl border border-line bg-surface transition-colors hover:border-brand/40">
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
// Sub-abas (Fase 6, 5.5): leitura separada de ação. Formulários e RPCs são os mesmos de antes — só
// mudaram de lugar. Ações destrutivas (excluir clube) ficam SÓ na Zona de perigo.
const SUBABAS_CLUBE = [
  { chave: 'resumo', rotulo: 'Resumo', icone: '🏕️' },
  { chave: 'assinatura', rotulo: 'Assinatura', icone: '💳' },
  { chave: 'uso', rotulo: 'Uso', icone: '📦' },
  { chave: 'recursos', rotulo: 'Recursos', icone: '🧩' },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: '📜' },
  { chave: 'perigo', rotulo: 'Zona de perigo', icone: '⚠️' },
]

function DetalheClube({ clubId, aoVoltar }) {
  const buscar = useCallback(() => clubeDetalhe(clubId), [clubId])
  const { dados: d, erro, recarregar } = useFonte(buscar)
  const [ocupado, setOcupado] = useState(false)
  const [sub, setSub] = useState('resumo')

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
              {/* Sub-cabeçalho fixo: nome + status sempre à vista enquanto rola. */}
              <div className="sticky top-[calc(61px+var(--seguro-topo))] z-10 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur" data-testid="clube-subcabecalho">
                <div className="flex items-center gap-3">
                  <ClubeAvatar nome={c.nome} logoUrl={c.logo_url} cor={c.cor_primaria} sigla={c.sigla} tamanho="sm" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-extrabold leading-tight text-ink">{c.nome}</h3>
                    <p className="truncate text-xs text-faint">{c.slug || '—'}</p>
                  </div>
                  <StatusChip status={c.assinatura_status} rotulo={rotuloStatus(c.assinatura_status)} cortesia={ehCortesia(c)} />
                  {c.status !== 'ativo' && <Chip tom="perigo">Inativo</Chip>}
                </div>
                <div role="group" aria-label="Partes do clube" className="mt-2 -mx-4 flex gap-1.5 overflow-x-auto px-4 no-scrollbar">
                  {SUBABAS_CLUBE.map((s) => {
                    const sel = s.chave === sub
                    return (
                      <button key={s.chave} type="button" onClick={() => setSub(s.chave)} aria-pressed={sel} data-testid={`clube-sub-${s.chave}`}
                        className={`inline-flex shrink-0 min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${FOCO} ${sel
                          ? (s.chave === 'perigo' ? 'bg-rose-600 text-white' : 'bg-[#0b1f4d] text-white dark:bg-white dark:text-[#07122f]')
                          : (s.chave === 'perigo' ? 'border border-rose-300 bg-surface text-rose-700 dark:text-rose-300' : 'border border-line bg-surface text-ink hover:bg-surface2')}`}>
                        <span aria-hidden="true">{s.icone}</span>{s.rotulo}
                      </button>
                    )
                  })}
                </div>
              </div>

              {sub === 'resumo' && (
                <div className="grid gap-3 md:grid-cols-2">
                  <section className="overflow-hidden rounded-2xl border border-line bg-surface md:col-span-2">
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

                  <Painel titulo="Resumo" icone="📋">
                    <Linha rotulo="Plano">{c.plano_nome ? `${c.plano_nome} v${c.plano_versao}` : 'Sem plano'}</Linha>
                    <Linha rotulo="Membros ativos">{c.membros ?? '—'}{c.membros_limite ? ` de ${c.membros_limite}` : ''}</Linha>
                    <Linha rotulo="Armazenamento">{formatarBytes(c.armazenamento_bytes)}{c.armazenamento_pct != null ? ` · ${c.armazenamento_pct}%` : ''}</Linha>
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

                  <Painel titulo="Pessoas (só contagens)" icone="👥" className="md:col-span-2">
                    {(d.vinculos_por_papel || []).length === 0
                      ? <p className="text-sm text-muted">Nenhum vínculo.</p>
                      : d.vinculos_por_papel.map((v) => <Linha key={`${v.papel}-${v.status}`} rotulo={`${v.papel} (${v.status})`}>{v.total}</Linha>)}
                    <p className="mt-2 text-xs text-faint">A administração da plataforma não vê nomes, fotos, chat, evidências nem mensalidades do clube.</p>
                  </Painel>
                </div>
              )}

              {sub === 'assinatura' && (
                <Painel titulo="Plano e assinatura" icone="💳">
                  {c.assinatura_id ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Linha rotulo="Plano">{c.plano_nome} v{c.plano_versao}</Linha>
                        <Linha rotulo="Ciclo">{c.ciclo || '—'}</Linha>
                        <Linha rotulo="Situação"><StatusChip status={c.assinatura_status} rotulo={rotuloStatus(c.assinatura_status)} cortesia={ehCortesia(c)} /></Linha>
                        {c.trial_ate && <Linha rotulo="Teste até">{data(c.trial_ate)}</Linha>}
                        {c.periodo_fim && <Linha rotulo="Período até">{data(c.periodo_fim)}</Linha>}
                        <Linha rotulo="Pagamento">{c.provider === 'mock' || !c.provider ? 'Sem gateway — combinado fora do sistema' : c.provider}</Linha>
                        <div className="mt-4"><TesteGratuito clubId={clubId} status={c.assinatura_status} trialAte={c.trial_ate} onFeito={recarregar} /></div>
                      </div>
                      <div className="space-y-4">
                        <CaixaClara titulo="Status da assinatura"><TransicaoAssinatura assinatura={{ id: c.assinatura_id, status: c.assinatura_status }} clube={c.nome} onFeito={recarregar} /></CaixaClara>
                        <CaixaClara titulo="Plano"><MudarPlano assinaturaId={c.assinatura_id} atual={`${c.plano_chave}|${c.plano_versao}`} onFeito={recarregar} /></CaixaClara>
                      </div>
                    </div>
                  ) : <EstadoVazio icone="🧾" titulo="Sem assinatura">Clube anterior ao modelo comercial, ou cadastro que ainda não chegou à etapa do clube.</EstadoVazio>}
                </Painel>
              )}

              {sub === 'uso' && (
                <div className="grid gap-3 md:grid-cols-2">
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
                  <div className="space-y-3">
                    <LimiteMembrosClube clubId={clubId} onFeito={recarregar} />
                    <PacotesGuardados clubId={clubId} />
                  </div>
                </div>
              )}

              {sub === 'recursos' && (
                <div className="space-y-3">
                  <Painel titulo="Recursos habilitados" icone="🧩">
                    {(d.recursos || []).length === 0
                      ? <p className="text-sm text-muted">Sem ajuste por clube — vale o que o plano define.</p>
                      : <div className="flex flex-wrap gap-1.5">{d.recursos.map((r) => <Chip key={r.recurso} tom={r.ligado ? 'ok' : 'neutro'} ponto>{r.recurso}: {r.ligado ? 'ligado' : 'desligado'}</Chip>)}</div>}
                  </Painel>
                  <AdminRecursosPlataforma clubId={clubId} recursos={d.recursos || []} onFeito={recarregar} />
                </div>
              )}

              {sub === 'auditoria' && (
                <Painel titulo="Auditoria recente" icone="📜">
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
              )}

              {sub === 'perigo' && <ZonaDePerigoClube clube={{ ...c, club_id: c.club_id || clubId }} aoExcluir={aoVoltar} />}
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
  // o campo mostra o que o admin digitou; enquanto ele não digitou nada, o valor salvo. Sem copiar o
  // valor salvo para o estado num efeito: o efeito roda depois da renderização e uma resposta da
  // fonte chegando no meio da digitação apagava o que o admin tinha escrito.
  const [editado, setDias] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const dias = editado ?? (dados?.trial_dias != null ? String(dados.trial_dias) : '')

  async function salvar() {
    const n = Number(dias)
    if (!Number.isInteger(n) || n < 0 || n > 365) { avisar.erro(null, 'Use um número inteiro de 0 a 365 dias.'); return }
    setOcupado(true)
    try {
      await trialPadraoDefinir(n)
      avisar.sucesso(`Clubes novos passam a ter ${n} dia(s) de teste.`)
      setDias(null)
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

const SELECT = `w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink ${FOCO}`

// Status que tiram (ou ameaçam tirar) o acesso do clube: botão vermelho + confirmação própria (P0 da
// auditoria UX 6.11). Os demais (trial, ativa, pagamento pendente) seguem o fluxo neutro.
const STATUS_PERIGOSOS = ['inadimplente', 'suspensa', 'cancelada']
const IMPACTO_STATUS = {
  inadimplente: 'O clube fica marcado com pagamento em atraso e vê o aviso de regularização.',
  suspensa: 'O clube perde acesso às ferramentas até ser reativado. Nada é apagado.',
  cancelada: 'A assinatura é encerrada; o clube perde acesso às ferramentas e precisa de uma assinatura nova para voltar. Nada é apagado.',
}

function TransicaoAssinatura({ assinatura, clube, onFeito }) {
  const [novo, setNovo] = useState(assinatura.status)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const perigoso = STATUS_PERIGOSOS.includes(novo) && novo !== assinatura.status

  async function confirmar() {
    if (novo === assinatura.status) return
    if (motivo.trim().length < 5) { avisar.erro(null, 'Descreva o motivo (mínimo 5 caracteres) — fica na auditoria.'); return }
    if (perigoso) {
      const ok = await avisar.confirmar({
        titulo: `Mudar a assinatura para "${rotuloStatus(novo)}"?`,
        descricao: [
          `Clube: ${clube || '—'}.`,
          `Status atual: ${rotuloStatus(assinatura.status)} → novo: ${rotuloStatus(novo)}.`,
          `Impacto: ${IMPACTO_STATUS[novo]}`,
          `Motivo (vai para a auditoria): ${motivo.trim()}`,
        ].join(' '),
        rotulo: `Confirmar: ${rotuloStatus(novo)}`,
        perigo: true,
      })
      if (!ok) return
    }
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
      {perigoso && (
        <p className="mb-2 text-xs text-rose-700 dark:text-rose-300" role="note" data-testid="transicao-impacto">{IMPACTO_STATUS[novo]}</p>
      )}
      <Botao variacao={perigoso ? 'perigo' : 'primario'} aoTocar={confirmar} carregando={ocupado} desabilitado={novo === assinatura.status}
        className="w-full" data-testid="confirmar-transicao">
        {perigoso ? `Mudar para ${rotuloStatus(novo)}` : 'Confirmar transição'}
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
// O padrão de teste gratuito dos clubes novos mora aqui (é regra de plano, não métrica).
function Planos() {
  const { dados, erro } = useFonte(planosAdminListar)
  return (
    <div className="space-y-4">
      <TrialPadrao />
      <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="💳" titulo="Nenhum plano no catálogo" />}>
        <div className="space-y-3">
          <Nota icone="🔒">Preço e limites: somente leitura (cada versão é histórica). Os painéis que cada plano libera se escolhem em “Painéis do plano”.</Nota>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
    </div>
  )
}

// ---------------------------------------------------------------- Assinaturas
const nomeClubesDaAssinatura = (s) => (s.clubes || []).map((c) => c.nome).join(', ') || s.conta || 'Sem clube'
const COLUNAS_ASSINATURAS = [
  { chave: 'clube', rotulo: 'Clube', ordenavel: true, valor: nomeClubesDaAssinatura },
  { chave: 'status', rotulo: 'Status', ordenavel: true, valor: (s) => s.status },
  { chave: 'plano', rotulo: 'Plano', ordenavel: true, valor: (s) => s.plano_nome },
  { chave: 'ciclo', rotulo: 'Ciclo', ordenavel: true, valor: (s) => s.ciclo },
  { chave: 'inicio', rotulo: 'Início', ordenavel: true, valor: (s) => s.criada_em },
  { chave: 'ate', rotulo: 'Teste / período até', ordenavel: true, valor: (s) => s.trial_ate || s.periodo_fim },
  { chave: 'pagamento', rotulo: 'Pagamento', valor: (s) => s.faturas_pagas_gateway },
]

function Assinaturas({ aoAbrirClube }) {
  const { dados, erro } = useFonte(assinaturasListar)
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('todos')
  const lista = useMemo(() => (dados || []).filter((s) =>
    (statusFiltro === 'todos' || s.status === statusFiltro) && contem(busca, nomeClubesDaAssinatura(s), s.plano_nome, s.ciclo)), [dados, busca, statusFiltro])
  const contagens = useMemo(() => {
    const n = { todos: (dados || []).length }
    for (const s of STATUS_ASSINATURA) n[s] = (dados || []).filter((x) => x.status === s).length
    return n
  }, [dados])
  const { ordenada, ordem, ordenarPor } = useOrdenacao(lista, COLUNAS_ASSINATURAS, { chave: 'inicio', direcao: 'desc' })
  const pag = usePaginacao(ordenada, 25)
  const colunas = useMemo(() => COLUNAS_ASSINATURAS.map((col) => ({
    ...col,
    render: {
      clube: (s) => <span className="font-bold">{nomeClubesDaAssinatura(s)}</span>,
      status: (s) => <StatusChip status={s.status} rotulo={rotuloStatus(s.status)} cortesia={s.provider === 'cortesia' && s.status === 'ativa'} />,
      plano: (s) => `${s.plano_nome} v${s.plano_versao}`,
      ciclo: (s) => s.ciclo || '—',
      inicio: (s) => <span className="whitespace-nowrap text-xs">{data(s.criada_em)}</span>,
      ate: (s) => <span className="whitespace-nowrap text-xs">{s.trial_ate ? `teste ${data(s.trial_ate)}` : s.periodo_fim ? data(s.periodo_fim) : '—'}</span>,
      pagamento: (s) => (
        <span className="flex flex-wrap gap-1">
          {s.faturas_pagas_gateway > 0 ? <Chip tom="ok">{s.faturas_pagas_gateway} confirmado(s)</Chip> : <Chip>Não confirmado por gateway</Chip>}
          {s.faturas_abertas > 0 && <Chip tom="atencao">{s.faturas_abertas} em aberto</Chip>}
        </span>
      ),
    }[col.chave],
  })), [])
  const cartao = (s) => (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-bold text-ink leading-tight">{nomeClubesDaAssinatura(s)}</p>
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
    </div>
  )
  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="🧾" titulo="Nenhuma assinatura">Quando um clube assinar um plano, aparece aqui.</EstadoVazio>}>
      <div className="space-y-3">
        <Nota>Licença/assinatura interna não é pagamento. Sem gateway integrado, nenhum pagamento aparece como confirmado aqui.</Nota>
        <Campo id="admin-busca-assinatura" rotulo="Buscar assinatura" tipo="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Clube ou plano" />
        <Filtros rotulo="Status" opcoes={[['todos', 'Todas'], ...STATUS_ASSINATURA.map((s) => [s, rotuloStatus(s)])]} valor={statusFiltro} aoMudar={setStatusFiltro} contagens={contagens} />
        {lista.length === 0 ? <EstadoVazio icone="🔎" titulo="Nenhuma assinatura encontrada">Tente outro termo ou limpe o filtro.</EstadoVazio> : (
          <>
            <Tabela colunas={colunas} linhas={pag.fatia} id={(s) => s.id} ordem={ordem} ordenarPor={ordenarPor} legenda="Assinaturas"
              testidLinha="assinatura-item" aoTocarLinha={(s) => (s.clubes || [])[0] && aoAbrirClube(s.clubes[0].club_id)} className="md:grid-cols-2" cartao={cartao} />
            <Paginacao {...pag} rotulo="assinatura(s)" />
          </>
        )}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Armazenamento
const ORDEM_SITUACAO = { atingido: 0, proximo: 1, normal: 2, sem_limite: 3 }
const COLUNAS_ARMAZ = [
  { chave: 'nome', rotulo: 'Clube', ordenavel: true, valor: (c) => c.nome },
  { chave: 'situacao', rotulo: 'Situação', ordenavel: true, valor: (c) => ORDEM_SITUACAO[c.armazenamento_situacao] ?? 9 },
  { chave: 'usado', rotulo: 'Usado', ordenavel: true, alinhar: 'direita', valor: (c) => Number(c.armazenamento_bytes || 0) },
  { chave: 'limite', rotulo: 'Limite', ordenavel: true, alinhar: 'direita', valor: (c) => c.armazenamento_limite_mb },
  { chave: 'pct', rotulo: '%', ordenavel: true, alinhar: 'direita', valor: (c) => c.armazenamento_pct, largura: '10rem' },
  { chave: 'objetos', rotulo: 'Arquivos', ordenavel: true, alinhar: 'direita', valor: (c) => c.armazenamento_objetos },
]

function Armazenamento({ aoAbrirClube }) {
  const { dados, erro } = useFonte(clubesListar)
  const lista = useMemo(() => [...(dados || [])].sort((a, b) => ORDEM_SITUACAO[a.armazenamento_situacao] - ORDEM_SITUACAO[b.armazenamento_situacao] || b.armazenamento_bytes - a.armazenamento_bytes), [dados])
  const total = useMemo(() => (dados || []).reduce((t, c) => t + Number(c.armazenamento_bytes || 0), 0), [dados])
  const nPerto = (dados || []).filter((c) => c.armazenamento_situacao === 'proximo').length
  const nLimite = (dados || []).filter((c) => c.armazenamento_situacao === 'atingido').length
  const { ordenada, ordem, ordenarPor } = useOrdenacao(lista, COLUNAS_ARMAZ)
  const pag = usePaginacao(ordenada, 25)
  const colunas = useMemo(() => COLUNAS_ARMAZ.map((col) => ({
    ...col,
    render: {
      nome: (c) => <span className="flex items-center gap-2.5"><ClubeAvatar nome={c.nome} logoUrl={c.logo_url} cor={c.cor_primaria} sigla={c.sigla} tamanho="sm" /><span className="font-bold">{c.nome}</span></span>,
      situacao: (c) => <Chip tom={TOM_ARMAZENAMENTO[c.armazenamento_situacao]} ponto>{ROTULO_ARMAZENAMENTO[c.armazenamento_situacao]}</Chip>,
      usado: (c) => formatarBytes(c.armazenamento_bytes),
      limite: (c) => (c.armazenamento_limite_mb ? formatarBytes(c.armazenamento_limite_mb * 1048576) : <span className="text-faint">sem limite</span>),
      pct: (c) => (c.armazenamento_limite_mb > 0 ? <span className="block"><span className="block text-xs">{c.armazenamento_pct}%</span><BarraUso pct={c.armazenamento_pct} situacao={c.armazenamento_situacao} rotulo={`Armazenamento de ${c.nome}`} /></span> : '—'),
      objetos: (c) => c.armazenamento_objetos ?? '—',
    }[col.chave],
  })), [])
  const cartao = (c) => (
    <div className="rounded-2xl border border-line bg-surface">
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
    </div>
  )
  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="💾" titulo="Nenhum clube" />}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2" data-testid="armazenamento-total">
          <Kpi icone="💾" tom="ok" valor={formatarBytes(total)} rotulo="Total usado" detalhe={`${(dados || []).length} clube(s)`} testid="armazenamento-total-valor" />
          <Kpi icone="!" tom={nPerto > 0 ? 'atencao' : 'neutro'} valor={nPerto} rotulo="Perto do limite" />
          <Kpi icone="✕" tom={nLimite > 0 ? 'perigo' : 'neutro'} valor={nLimite} rotulo="No limite" />
        </div>
        <Nota icone="🔒">Só o tamanho usado. A administração não abre os arquivos dos clubes.</Nota>
        <Tabela colunas={colunas} linhas={pag.fatia} id={(c) => c.club_id} ordem={ordem} ordenarPor={ordenarPor} legenda="Armazenamento por clube"
          testidLinha="armazenamento-item" aoTocarLinha={(c) => aoAbrirClube(c.club_id)} className="md:grid-cols-2" cartao={cartao} />
        <Paginacao {...pag} rotulo="clube(s)" />
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
const COLUNAS_ONBOARDING = [
  { chave: 'clube', rotulo: 'Clube', ordenavel: true, valor: (o) => o.clube },
  { chave: 'status', rotulo: 'Status', ordenavel: true, valor: (o) => o.status },
  { chave: 'etapa', rotulo: 'Etapa', ordenavel: true, valor: (o) => o.etapa },
  { chave: 'parado', rotulo: 'Parado há', ordenavel: true, alinhar: 'direita', valor: (o) => o.parado },
  { chave: 'iniciado', rotulo: 'Iniciado', ordenavel: true, valor: (o) => o.iniciado_em },
  { chave: 'atualizado', rotulo: 'Atualizado', ordenavel: true, valor: (o) => o.atualizado_em },
]

function Onboarding({ aoAbrirClube }) {
  const { dados, erro } = useFonte(onboardingListar)
  const [statusFiltro, setStatusFiltro] = useState('todos')
  const lista = useMemo(() => {
    const agora = Date.now()
    const l = (dados || []).map((o) => ({ ...o, parado: o.status === 'em_andamento' ? diasParado(o.atualizado_em, agora) : null }))
      .filter((o) => statusFiltro === 'todos' || o.status === statusFiltro)
    // parados há mais tempo primeiro; o resto mantém a ordem do servidor (atualizado mais recente)
    l.sort((a, b) => (b.parado ?? -1) - (a.parado ?? -1))
    return l
  }, [dados, statusFiltro])
  const contagens = useMemo(() => ({
    todos: (dados || []).length,
    em_andamento: (dados || []).filter((o) => o.status === 'em_andamento').length,
    concluido: (dados || []).filter((o) => o.status === 'concluido').length,
    abandonado: (dados || []).filter((o) => o.status === 'abandonado').length,
  }), [dados])
  const nParados = lista.filter((o) => o.parado != null && o.parado > DIAS_ONBOARDING_PARADO).length
  const { ordenada, ordem, ordenarPor } = useOrdenacao(lista, COLUNAS_ONBOARDING)
  const pag = usePaginacao(ordenada, 25)
  const colunas = useMemo(() => COLUNAS_ONBOARDING.map((col) => ({
    ...col,
    render: {
      clube: (o) => <span className="font-bold">{o.clube || <span className="font-normal text-faint">Clube ainda não criado</span>}</span>,
      status: (o) => <Chip tom={o.status === 'concluido' ? 'ok' : o.status === 'abandonado' ? 'perigo' : 'atencao'} ponto>{ROTULO_ONBOARDING[o.status] || o.status}</Chip>,
      etapa: (o) => <span className="text-xs">{o.etapa} · {(o.etapas_concluidas || []).length} concluída(s)</span>,
      parado: (o) => (o.parado == null ? '—' : <span className={o.parado > DIAS_ONBOARDING_PARADO ? 'font-bold text-amber-800 dark:text-amber-300' : ''}>{o.parado === 0 ? 'hoje' : `${o.parado} dia(s)`}</span>),
      iniciado: (o) => <span className="whitespace-nowrap text-xs">{data(o.iniciado_em)}</span>,
      atualizado: (o) => <span className="whitespace-nowrap text-xs">{dataHora(o.atualizado_em)}</span>,
    }[col.chave],
  })), [])
  const cartao = (o) => {
    const alerta = o.parado > DIAS_ONBOARDING_PARADO
    return (
      <div className={`rounded-2xl border bg-surface p-4 ${alerta ? 'border-amber-400/70 ring-1 ring-amber-400/30' : 'border-line'}`}>
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
      </div>
    )
  }
  return (
    <Estado erro={erro} dados={dados} vazio={<EstadoVazio icone="🧭" titulo="Nenhum onboarding iniciado">Os cadastros de clube em andamento aparecem aqui.</EstadoVazio>}>
      <div className="space-y-3">
        <Filtros rotulo="Status do onboarding" opcoes={[['todos', 'Todos'], ['em_andamento', 'Em andamento'], ['concluido', 'Concluídos'], ['abandonado', 'Abandonados']]}
          valor={statusFiltro} aoMudar={setStatusFiltro} contagens={contagens} />
        {nParados > 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="onboarding-parados">
            <span aria-hidden="true">⚠️</span>{nParados} cadastro(s) de clube parado(s) há mais de {DIAS_ONBOARDING_PARADO} dias.
          </p>
        )}
        {lista.length === 0 ? <EstadoVazio icone="🔎" titulo="Nada com esse status" /> : (
          <>
            <Tabela colunas={colunas} linhas={pag.fatia} id={(o) => o.id} ordem={ordem} ordenarPor={ordenarPor} legenda="Onboarding de clubes"
              testidLinha="onboarding-item" aoTocarLinha={(o) => o.club_id && aoAbrirClube(o.club_id)} className="md:grid-cols-2" cartao={cartao} />
            <Paginacao {...pag} rotulo="cadastro(s)" />
          </>
        )}
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

// ---------------------------------------------------------------- Suporte (acessos autorizados pelo clube)
const ROTULO_SUPORTE = {
  solicitado: 'Aguardando o clube autorizar', autorizado: 'Autorizado pelo clube',
  recusado: 'Recusado pelo clube', revogado: 'Revogado',
}
const TOM_SUPORTE = { solicitado: 'atencao', autorizado: 'ok', recusado: 'neutro', revogado: 'neutro' }
const COLUNAS_SUPORTE = [
  { chave: 'clube', rotulo: 'Clube', ordenavel: true, valor: (g) => g.clube_nome },
  { chave: 'motivo', rotulo: 'Motivo' },
  { chave: 'status', rotulo: 'Status', ordenavel: true, valor: (g) => g.status },
  { chave: 'pedido', rotulo: 'Pedido em', ordenavel: true, valor: (g) => g.criado_em },
  { chave: 'expira', rotulo: 'Expira', ordenavel: true, valor: (g) => g.expira_em },
  { chave: 'acoes', rotulo: 'Ação', alinhar: 'direita' },
]

function Suporte() {
  const { dados: lista, erro, recarregar } = useFonte(suporteListar)
  // o nome do clube vem da lista de clubes já carregada pelo painel (support_grants só tem o club_id)
  const { dados: clubes } = useFonte(clubesListar)
  const nomes = useMemo(() => Object.fromEntries((clubes || []).map((c) => [c.club_id, c.nome])), [clubes])
  const comNome = useMemo(() => (lista || []).map((g) => ({ ...g, clube_nome: nomes[g.club_id] || null })), [lista, nomes])
  const { ordenada, ordem, ordenarPor } = useOrdenacao(comNome, COLUNAS_SUPORTE, { chave: 'pedido', direcao: 'desc' })
  async function revogar(g) {
    const ok = await avisar.confirmar({
      titulo: 'Revogar este pedido de suporte?',
      descricao: `"${g.motivo}" deixa de valer na hora e a revogação fica na auditoria.`,
      rotulo: 'Revogar pedido',
    })
    if (!ok) return
    try { await suporteRevogar(g.id, 'Revogado pelo admin.'); recarregar() } catch (e) { avisar.erro(e) }
  }
  const botaoRevogar = (g) => ['solicitado', 'autorizado'].includes(g.status) && <Botao variacao="perigo" aoTocar={() => revogar(g)}>Revogar</Botao>
  const colunas = useMemo(() => COLUNAS_SUPORTE.map((col) => ({
    ...col,
    render: {
      clube: (g) => <span className="font-bold">{g.clube_nome || <span className="font-normal text-faint">Clube {String(g.club_id || '').slice(0, 8)}…</span>}</span>,
      motivo: (g) => <span className="text-sm">{g.motivo}</span>,
      status: (g) => <Chip tom={TOM_SUPORTE[g.status] || 'neutro'} ponto>{ROTULO_SUPORTE[g.status] || g.status}</Chip>,
      pedido: (g) => <span className="whitespace-nowrap text-xs">{dataHora(g.criado_em)}</span>,
      expira: (g) => <span className="whitespace-nowrap text-xs">{g.revogado_em ? `revogado ${dataHora(g.revogado_em)}` : dataHora(g.expira_em)}</span>,
      acoes: botaoRevogar,
    }[col.chave],
  })), []) // eslint-disable-line react-hooks/exhaustive-deps
  const cartao = (g) => (
    <div className="rounded-2xl border border-line bg-surface p-3" data-testid="suporte-item">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{g.clube_nome || 'Clube não identificado'}</p>
          <p className="text-sm text-ink">{g.motivo}</p>
          <p className="mt-1 text-xs text-muted">Pedido em {dataHora(g.criado_em)}{g.expira_em ? ` · expira ${dataHora(g.expira_em)}` : ''}</p>
          <Chip tom={TOM_SUPORTE[g.status] || 'neutro'} ponto className="mt-1">{ROTULO_SUPORTE[g.status] || g.status}</Chip>
        </div>
        {botaoRevogar(g)}
      </div>
    </div>
  )
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
          : <Tabela colunas={colunas} linhas={ordenada} id={(g) => g.id} ordem={ordem} ordenarPor={ordenarPor} legenda="Pedidos de acesso de suporte" cartao={cartao} />}
      </div>
    </Estado>
  )
}

// ---------------------------------------------------------------- Auditoria
// Trilha imutável. A RPC devolve as N mais recentes (`auditoriaListar(limite)`): "carregar mais" pede
// de novo com um limite maior — sem paginação no servidor.
const PASSO_AUDITORIA = 100
const COLUNAS_AUDITORIA = [
  { chave: 'quando', rotulo: 'Quando', ordenavel: true, valor: (e) => e.created_at },
  { chave: 'acao', rotulo: 'Ação', ordenavel: true, valor: (e) => e.acao },
  { chave: 'alvo', rotulo: 'Alvo', ordenavel: true, valor: (e) => e.alvo_tipo },
  { chave: 'detalhe', rotulo: 'Detalhe' },
]
const detalheAuditoria = (e) => [e.detalhe?.motivo, e.detalhe?.para && `→ ${e.detalhe.para}`].filter(Boolean).join(' · ')

function Auditoria() {
  const [limite, setLimite] = useState(PASSO_AUDITORIA)
  const buscar = useCallback(() => auditoriaListar(limite), [limite])
  const { dados: lista, erro } = useFonte(buscar)
  const [acao, setAcao] = useState('todas')
  const [busca, setBusca] = useState('')
  const acoes = useMemo(() => [...new Set((lista || []).map((e) => e.acao).filter(Boolean))].sort(), [lista])
  const filtrada = useMemo(() => (lista || []).filter((e) => (acao === 'todas' || e.acao === acao) && contem(busca, e.acao, e.alvo_tipo, e.alvo_id, detalheAuditoria(e))), [lista, acao, busca])
  const { ordenada, ordem, ordenarPor } = useOrdenacao(filtrada, COLUNAS_AUDITORIA, { chave: 'quando', direcao: 'desc' })
  const colunas = useMemo(() => COLUNAS_AUDITORIA.map((col) => ({
    ...col,
    render: {
      quando: (e) => <span className="whitespace-nowrap text-xs">{dataHora(e.created_at)}</span>,
      acao: (e) => <span className="font-semibold">{e.acao}</span>,
      alvo: (e) => <Chip>{e.alvo_tipo}</Chip>,
      detalhe: (e) => <span className="text-xs text-muted break-words">{detalheAuditoria(e) || '—'}</span>,
    }[col.chave],
  })), [])
  const cartao = (e) => (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-sm font-semibold text-ink">{e.acao}</p>
        <Chip>{e.alvo_tipo}</Chip>
      </div>
      <p className="text-xs text-muted">{dataHora(e.created_at)}{detalheAuditoria(e) ? ` · ${detalheAuditoria(e)}` : ''}</p>
    </div>
  )
  const podeCarregarMais = (lista || []).length >= limite
  return (
    <Estado erro={erro} dados={lista} vazio={<EstadoVazio icone="📜" titulo="Nenhum evento ainda">Toda ação administrativa fica registrada aqui.</EstadoVazio>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] sm:items-end gap-2">
          <Campo id="admin-busca-auditoria" rotulo="Buscar na auditoria" tipo="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ação, alvo ou motivo" />
          <div className="mb-3">
            <label htmlFor="admin-filtro-acao" className="block text-xs font-semibold text-muted mb-1">Ação</label>
            <select id="admin-filtro-acao" value={acao} onChange={(e) => setAcao(e.target.value)}
              className={`w-full min-w-0 sm:w-64 min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink ${FOCO}`}>
              <option value="todas">Todas as ações</option>
              {acoes.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs font-medium text-muted" role="status">{filtrada.length} de {(lista || []).length} evento(s) carregado(s)</p>
        {filtrada.length === 0 ? <EstadoVazio icone="🔎" titulo="Nenhum evento com esse filtro" /> : (
          <Tabela colunas={colunas} linhas={ordenada} id={(e) => e.id} ordem={ordem} ordenarPor={ordenarPor} legenda="Auditoria da administração" testidLinha="auditoria-item" cartao={cartao} />
        )}
        {podeCarregarMais && (
          <Botao variacao="secundario" className="w-full" aoTocar={() => setLimite((l) => l + PASSO_AUDITORIA)} data-testid="auditoria-mais">
            Carregar mais {PASSO_AUDITORIA}
          </Botao>
        )}
      </div>
    </Estado>
  )
}
