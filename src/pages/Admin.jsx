import { useState, useEffect, useCallback } from 'react'
import { Cabecalho, Card, Botao, Aviso, Selo, Carregando, Vazio, Abas, Campo } from '../ui/index.jsx'
import { ROTULO_STATUS, carregarPlanos, formatarPreco } from '../services/comercial.js'
import {
  souAdminPlataforma, contasListar, provisionamentoPendencias, provisionamentoReexecutar,
  assinaturaTransicionar, suporteListar, suporteRevogar, auditoriaListar,
} from '../services/admin.js'
import { avisar } from '../ui/avisos.jsx'

// /admin — painel da OPERAÇÃO da plataforma (Fase 4 desta rodada, motor comercial da Fase 5).
//
// Isolamento que este painel EXISTE para preservar, não pra contornar: é autoridade COMERCIAL
// (contas, planos, assinaturas, provisionamento, suporte assistido, auditoria da plataforma) —
// nunca autoridade ECLESIÁSTICA de um clube. Nenhuma tela aqui lê chat, foto, evidência,
// mensalidade interna ou qualquer dado privado de clube: as RPCs que ele chama (todas da migration
// 20260921000048) nunca tiveram policy que alcançasse essas tabelas, e este arquivo não adiciona
// nenhuma. O guard (RotaAdmin, ver App.jsx) barra quem não é `eh_admin_plataforma()` — inclusive
// diretoria/instrutor/coordenador do maior clube do sistema.
const ABAS = [
  { chave: 'visao', rotulo: 'Visão geral', icone: '📊' },
  { chave: 'contas', rotulo: 'Contas', icone: '🏢' },
  { chave: 'provisionamento', rotulo: 'Provisionamento', icone: '⚙️' },
  { chave: 'suporte', rotulo: 'Suporte', icone: '🛟' },
  { chave: 'planos', rotulo: 'Planos', icone: '💳' },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: '📜' },
]

export default function Admin() {
  const [aba, setAba] = useState('visao')
  const [autorizado, setAutorizado] = useState(null) // null = ainda checando
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

  return (
    <div className="max-w-3xl mx-auto">
      <Cabecalho icone="🛠️" titulo="Administração DesbravaClube" descricao="Operação da plataforma — contas, planos, assinaturas, provisionamento, suporte e auditoria" />
      <Abas abas={ABAS} ativa={aba} aoTrocar={setAba} rotulo="Áreas do admin" />
      {aba === 'visao' && <VisaoGeral />}
      {aba === 'contas' && <Contas />}
      {aba === 'provisionamento' && <Provisionamento />}
      {aba === 'suporte' && <Suporte />}
      {aba === 'planos' && <PlanosAdmin />}
      {aba === 'auditoria' && <Auditoria />}
    </div>
  )
}

// ---------------------------------------------------------------- Visão geral
// Agregada em memória a partir de admin_contas_listar/admin_provisionamento_pendencias — não existe
// hoje uma RPC de agregação dedicada no backend (auditado); nenhum dado pessoal novo é exposto,
// só contagens sobre o que as duas RPCs já devolvem.
function VisaoGeral() {
  const [contas, setContas] = useState(null)
  const [pendencias, setPendencias] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    Promise.all([contasListar(), provisionamentoPendencias()])
      .then(([c, p]) => { setContas(c); setPendencias(p) })
      .catch((e) => setErro(e.message))
  }, [])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!contas || !pendencias) return <Carregando />

  const porStatus = {}
  let clubes = 0
  let cobrancasAbertas = 0
  for (const c of contas) {
    const s = c.assinatura?.status || 'sem_assinatura'
    porStatus[s] = (porStatus[s] || 0) + 1
    clubes += (c.clubes || []).length
    cobrancasAbertas += c.cobrancas_abertas || 0
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card className="text-center"><p className="text-3xl font-extrabold text-ink" data-testid="visao-contas">{contas.length}</p><p className="text-xs text-muted">Contas comerciais</p></Card>
        <Card className="text-center"><p className="text-3xl font-extrabold text-ink">{clubes}</p><p className="text-xs text-muted">Clubes cobertos</p></Card>
        <Card className="text-center"><p className="text-3xl font-extrabold text-ink">{cobrancasAbertas}</p><p className="text-xs text-muted">Cobranças em aberto/vencidas</p></Card>
        <Card className="text-center"><p className="text-3xl font-extrabold text-ink">{pendencias.length}</p><p className="text-xs text-muted">Provisionamentos pendentes</p></Card>
      </div>
      <Card>
        <p className="font-bold text-ink mb-2 text-sm">Assinaturas por status</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(porStatus).map(([s, n]) => (
            <Selo key={s} tom={s === 'ativa' ? 'ok' : s === 'inadimplente' || s === 'suspensa' ? 'perigo' : 'atencao'}>
              {ROTULO_STATUS[s] || s}: {n}
            </Selo>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Contas
function Contas() {
  const [contas, setContas] = useState(null)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState(null)

  const carregar = useCallback(() => {
    contasListar().then(setContas).catch((e) => setErro(e.message))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!contas) return <Carregando />
  if (contas.length === 0) return <Vazio icone="🏢" titulo="Nenhuma conta comercial ainda" />

  return (
    <div className="space-y-3">
      {contas.map((c) => (
        <Card key={c.conta_id} data-testid="conta-item">
          <button type="button" onClick={() => setAberta(aberta === c.conta_id ? null : c.conta_id)}
            className="w-full text-left flex items-center justify-between gap-2 min-h-[44px]">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{c.nome}</p>
              <p className="text-xs text-muted">{(c.clubes || []).length} clube(s) · {c.assinatura?.plano_nome || 'sem plano'}</p>
            </div>
            {c.assinatura && (
              <Selo tom={c.assinatura.status === 'ativa' ? 'ok' : ['inadimplente', 'suspensa'].includes(c.assinatura.status) ? 'perigo' : 'atencao'}>
                {ROTULO_STATUS[c.assinatura.status] || c.assinatura.status}
              </Selo>
            )}
          </button>
          {aberta === c.conta_id && (
            <div className="mt-3 pt-3 border-t border-line space-y-3">
              <ul className="text-xs text-muted space-y-1">
                {(c.clubes || []).map((cl) => (
                  <li key={cl.club_id}>🏕️ {cl.nome} — {cl.membros ?? '—'} membros, provisionamento: {cl.provisionamento}</li>
                ))}
              </ul>
              {c.assinatura && <TransicaoAssinatura assinatura={c.assinatura} onFeito={carregar} />}
            </div>
          )}
        </Card>
      ))}
    </div>
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
      <p className="text-xs font-bold text-ink mb-1">Mudar status da assinatura</p>
      <select value={novo} onChange={(e) => setNovo(e.target.value)} data-testid="assinatura-status"
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

// ---------------------------------------------------------------- Provisionamento
function Provisionamento() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(null)

  const carregar = useCallback(() => {
    provisionamentoPendencias().then(setLista).catch((e) => setErro(e.message))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function reexecutar(clubId) {
    setOcupado(clubId)
    try {
      const r = await provisionamentoReexecutar(clubId)
      avisar[r?.status === 'ok' ? 'sucesso' : 'erro'](r?.status === 'ok' ? null : new Error(r?.erro || 'Continua pendente.'),
        r?.status === 'ok' ? 'Provisionamento concluído.' : undefined)
      carregar()
    } catch (e) { avisar.erro(e) }
    setOcupado(null)
  }

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!lista) return <Carregando />
  if (lista.length === 0) return <Vazio icone="✅" titulo="Nenhuma pendência de provisionamento" />

  return (
    <div className="space-y-3">
      {lista.map((p) => (
        <Card key={p.club_id}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{p.clube}</p>
              <p className="text-xs text-muted">{p.status} · {p.tentativas} tentativa(s){p.erro ? ` · ${p.erro}` : ''}</p>
            </div>
            <Botao variacao="secundario" aoTocar={() => reexecutar(p.club_id)} carregando={ocupado === p.club_id}>
              Reexecutar
            </Botao>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Suporte
const ROTULO_SUPORTE = {
  solicitado: 'Aguardando o clube autorizar', autorizado: 'Autorizado pelo clube',
  recusado: 'Recusado pelo clube', revogado: 'Revogado',
}

function Suporte() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(() => { suporteListar().then(setLista).catch((e) => setErro(e.message)) }, [])
  useEffect(() => { carregar() }, [carregar])

  async function revogar(id) {
    try { await suporteRevogar(id, 'Revogado pelo admin.'); carregar() } catch (e) { avisar.erro(e) }
  }

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!lista) return <Carregando />

  return (
    <div className="space-y-3">
      <Aviso tom="info">
        Nesta versão, autorizar um pedido aqui <strong>não concede acesso real</strong> a dado de
        clube — fica registrado e auditado. Só a liderança do clube autoriza; o admin nunca autoriza
        o próprio pedido.
      </Aviso>
      {lista.length === 0
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
  )
}

// ---------------------------------------------------------------- Planos (somente leitura)
// CRUD de catálogo NÃO existe no backend auditado (billing_plans/billing_prices não têm RPC de
// escrita) — esta aba é deliberadamente só leitura, reaproveitando o MESMO catálogo público que
// /planos já usa (nenhum preço no React).
function PlanosAdmin() {
  const [planos, setPlanos] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => { carregarPlanos().then(setPlanos).catch((e) => setErro(e.message)) }, [])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!planos) return <Carregando />

  return (
    <div className="space-y-3">
      <Aviso tom="info">Somente leitura nesta fase: não há RPC de escrita no catálogo — editar plano continua sendo via banco.</Aviso>
      {planos.map((p) => (
        <Card key={`${p.chave}-${p.versao}`}>
          <div className="flex items-center justify-between">
            <p className="font-bold text-ink">{p.nome}</p>
            {p.provisorio && <Selo tom="atencao">PROVISÓRIO</Selo>}
          </div>
          <p className="text-xs text-muted mt-1">{(p.precos || []).map((pr) => `${formatarPreco(pr.valor_centavos, pr.moeda)}/${pr.ciclo}`).join(' · ')}</p>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Auditoria
function Auditoria() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => { auditoriaListar().then(setLista).catch((e) => setErro(e.message)) }, [])

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!lista) return <Carregando />
  if (lista.length === 0) return <Vazio icone="📜" titulo="Nenhum evento ainda" />

  return (
    <div className="space-y-2">
      {lista.map((e) => (
        <Card key={e.id} className="p-3">
          <p className="text-sm font-semibold text-ink">{e.acao}</p>
          <p className="text-xs text-muted">{e.alvo_tipo} · {new Date(e.created_at).toLocaleString('pt-BR')}</p>
        </Card>
      ))}
    </div>
  )
}
