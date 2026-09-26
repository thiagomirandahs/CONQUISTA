import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Botao, Aviso, Selo, Carregando, Vazio, Campo } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import {
  hierarquiaAdmin, unidadeCriar, unidadeEditar, unidadeStatus, clubeVincular, pedidoClubeDecidir,
  coordenadorDecidir, coordenadorRemover, conviteGerar, conviteRevogar,
  TIPO_ROTULO, PAPEIS_COORDENACAO, rotuloPapel, montarLinkCoordenacao,
} from '../services/hierarquia.js'

// Aba "Hierarquia" do /admin (migration 130). Mobile-first e clean: caixas claras, botões ≥44px,
// sem brilho. Pendências (clube pedindo região, coordenador que escolheu a unidade) vêm no topo.
// Só o admin da plataforma chega aqui — o servidor confere em cada RPC.
const TIPOS = ['divisao', 'uniao', 'campo', 'regiao', 'distrito']
const NIVEL = { divisao: 1, uniao: 2, campo: 3, regiao: 4, distrito: 5, clube: 7 }
const SITUACAO_CONVITE = { valido: ['ok', 'Válido'], revogado: ['perigo', 'Revogado'], expirado: ['neutro', 'Expirado'], esgotado: ['neutro', 'Esgotado'] }
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

function Caixa({ titulo, children, destaque, testid }) {
  return (
    <section data-testid={testid}
      className={`rounded-2xl border p-4 ${destaque ? 'border-amber-300 bg-amber-50' : 'border-line bg-surface'}`}>
      {titulo && <h3 className="font-bold text-ink text-sm mb-3">{titulo}</h3>}
      {children}
    </section>
  )
}

function Seletor({ id, rotulo, value, onChange, children }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-semibold text-muted mb-1">{rotulo}</label>
      <select id={id} value={value} onChange={onChange}
        className="w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink">
        {children}
      </select>
    </div>
  )
}

export default function AdminHierarquia() {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(null)

  const recarregar = useCallback(() => {
    hierarquiaAdmin().then((d) => { setErro(''); setDados(d) }).catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  const rodar = async (chave, fn, ok) => {
    setOcupado(chave)
    try { const r = await fn(); if (ok) avisar.sucesso(ok); recarregar(); return r } catch (e) { avisar.erro(e) } finally { setOcupado(null) }
    return null
  }

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!dados) return <Carregando />

  const unidades = dados.unidades || []
  const ativas = unidades.filter((u) => u.status === 'ativo')
  const pedidos = dados.pedidos_clube || []
  const coordPend = dados.coordenadores_pendentes || []

  return (
    <div className="space-y-4 max-w-2xl">
      <Caixa titulo={`Pendências (${pedidos.length + coordPend.length})`} destaque={pedidos.length + coordPend.length > 0} testid="hier-pendencias">
        {pedidos.length + coordPend.length === 0 && <p className="text-sm text-muted">Nada aguardando confirmação.</p>}
        {pedidos.map((p) => (
          <PedidoClube key={p.id} pedido={p} ativas={ativas} ocupado={ocupado} rodar={rodar} />
        ))}
        {coordPend.map((c) => (
          <div key={c.membership_id} className="rounded-xl border border-line bg-surface p-3 mb-2" data-testid="hier-coord-pendente">
            <p className="text-sm text-ink"><strong>{c.nome}</strong> quer ser <strong>{rotuloPapel(c.papel)}</strong></p>
            <p className="text-xs text-muted mb-2">{c.unidade?.caminho || c.unidade?.nome}{c.convite ? ` · convite "${c.convite}"` : ''} · desde {data(c.desde)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Botao variacao="contorno" carregando={ocupado === `c+${c.membership_id}`} desabilitado={!!ocupado}
                aoTocar={() => rodar(`c+${c.membership_id}`, () => coordenadorDecidir(c.membership_id, true), 'Coordenador confirmado.')}>Confirmar</Botao>
              <Botao variacao="secundario" carregando={ocupado === `c-${c.membership_id}`} desabilitado={!!ocupado}
                aoTocar={() => rodar(`c-${c.membership_id}`, () => coordenadorDecidir(c.membership_id, false), 'Pedido recusado.')}>Recusar</Botao>
            </div>
          </div>
        ))}
      </Caixa>

      <Arvore unidades={unidades} clubes={dados.clubes || []} ativas={ativas} ocupado={ocupado} rodar={rodar} />
      <NovaUnidade ativas={ativas} ocupado={ocupado} rodar={rodar} />
      <Convites convites={dados.convites || []} ativas={ativas} ocupado={ocupado} rodar={rodar} />
    </div>
  )
}

function PedidoClube({ pedido: p, ativas, ocupado, rodar }) {
  const [outra, setOutra] = useState('')
  const alvos = ativas.filter((u) => ['distrito', 'regiao', 'campo'].includes(u.tipo))
  return (
    <div className="rounded-xl border border-line bg-surface p-3 mb-2" data-testid="hier-pedido-clube">
      <p className="text-sm text-ink">Clube <strong>{p.clube}</strong> pediu para ficar em <strong>{p.unidade_pedida?.nome}</strong></p>
      <p className="text-xs text-muted mb-2">{p.unidade_pedida?.caminho} · {data(p.solicitado_em)}{p.unidade_atual ? ` · hoje em ${p.unidade_atual.nome}` : ''}</p>
      <Seletor id={`pedido-outra-${p.id}`} rotulo="Confirmar em outra unidade (opcional)" value={outra} onChange={(e) => setOutra(e.target.value)}>
        <option value="">A que o clube pediu</option>
        {alvos.map((u) => <option key={u.id} value={u.id}>{TIPO_ROTULO[u.tipo]} — {u.nome}</option>)}
      </Seletor>
      <div className="grid grid-cols-2 gap-2">
        <Botao variacao="contorno" carregando={ocupado === `p+${p.id}`} desabilitado={!!ocupado}
          aoTocar={() => rodar(`p+${p.id}`, () => pedidoClubeDecidir(p.id, true, outra || null), 'Clube ligado à unidade.')}>Confirmar</Botao>
        <Botao variacao="secundario" carregando={ocupado === `p-${p.id}`} desabilitado={!!ocupado}
          aoTocar={() => rodar(`p-${p.id}`, () => pedidoClubeDecidir(p.id, false), 'Pedido recusado.')}>Recusar</Botao>
      </div>
    </div>
  )
}

function Arvore({ unidades, clubes, ativas, ocupado, rodar }) {
  const filhos = useMemo(() => {
    const m = new Map()
    for (const x of [...unidades, ...clubes.map((c) => ({ ...c, tipo: 'clube' }))]) {
      const k = x.parent_id || 'raiz'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(x)
    }
    return m
  }, [unidades, clubes])
  const raiz = filhos.get('raiz') || []
  const [aberta, setAberta] = useState(null)

  if (raiz.length === 0) return <Vazio icone="🌳" titulo="Nenhuma unidade ainda">Crie a primeira associação, região ou distrito abaixo.</Vazio>

  const No = ({ n, prof }) => (
    <li>
      <button type="button" onClick={() => setAberta(aberta?.id === n.id ? null : n)}
        className="w-full text-left min-h-[44px] flex items-center gap-2 rounded-xl px-2 hover:bg-surface2"
        style={{ paddingLeft: `${8 + prof * 16}px` }}>
        <span className="text-xs text-faint w-20 shrink-0">{TIPO_ROTULO[n.tipo]}</span>
        <span className={`text-sm font-semibold ${n.status === 'ativo' ? 'text-ink' : 'text-faint line-through'}`}>{n.nome}</span>
        {(n.coordenadores || []).filter((c) => c.status === 'ativo').length > 0 &&
          <Selo tom="ok">{(n.coordenadores || []).filter((c) => c.status === 'ativo').length} coord.</Selo>}
      </button>
      {aberta?.id === n.id && (
        <div className="my-2" style={{ marginLeft: `${8 + prof * 16}px` }}>
          {n.tipo === 'clube'
            ? <EditarClube clube={n} ativas={ativas} ocupado={ocupado} rodar={rodar} />
            : <EditarUnidade unidade={n} ativas={ativas} ocupado={ocupado} rodar={rodar} />}
        </div>
      )}
      {(filhos.get(n.id) || []).length > 0 && (
        <ul>{(filhos.get(n.id) || []).sort((a, b) => NIVEL[a.tipo] - NIVEL[b.tipo] || a.nome.localeCompare(b.nome))
          .map((f) => <No key={f.id} n={f} prof={prof + 1} />)}</ul>
      )}
    </li>
  )

  return (
    <Caixa titulo="Árvore" testid="hier-arvore">
      <p className="text-xs text-muted mb-2">Toque numa linha para editar. Clubes sem unidade aparecem na raiz.</p>
      <ul>{raiz.sort((a, b) => NIVEL[a.tipo] - NIVEL[b.tipo] || a.nome.localeCompare(b.nome)).map((n) => <No key={n.id} n={n} prof={0} />)}</ul>
    </Caixa>
  )
}

function EditarUnidade({ unidade: u, ativas, ocupado, rodar }) {
  const [nome, setNome] = useState(u.nome)
  const [pai, setPai] = useState(u.parent_id || '')
  const pais = ativas.filter((x) => NIVEL[x.tipo] < NIVEL[u.tipo] && x.id !== u.id)
  return (
    <Card className="border border-line shadow-none">
      <Campo id={`un-nome-${u.id}`} rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      <Seletor id={`un-pai-${u.id}`} rotulo="Fica debaixo de" value={pai} onChange={(e) => setPai(e.target.value)}>
        <option value="">(nenhuma — topo)</option>
        {pais.map((x) => <option key={x.id} value={x.id}>{TIPO_ROTULO[x.tipo]} — {x.nome}</option>)}
      </Seletor>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Botao variacao="contorno" carregando={ocupado === `e${u.id}`} desabilitado={!!ocupado}
          aoTocar={() => rodar(`e${u.id}`, () => unidadeEditar(u.id, nome, pai || null), 'Unidade salva.')}>Salvar</Botao>
        <Botao variacao="secundario" carregando={ocupado === `s${u.id}`} desabilitado={!!ocupado}
          aoTocar={() => rodar(`s${u.id}`, () => unidadeStatus(u.id, u.status !== 'ativo'), u.status === 'ativo' ? 'Unidade desativada.' : 'Unidade reativada.')}>
          {u.status === 'ativo' ? 'Desativar' : 'Reativar'}
        </Botao>
      </div>
      <p className="text-xs font-semibold text-muted mb-1">Coordenação</p>
      {(u.coordenadores || []).length === 0 && <p className="text-xs text-faint mb-2">Ninguém ainda. Gere um link de convite abaixo.</p>}
      {(u.coordenadores || []).map((c) => (
        <div key={c.membership_id} className="flex items-center justify-between gap-2 py-1 border-b border-line last:border-0">
          <span className="text-sm text-ink">{c.nome} <span className="text-xs text-muted">· {rotuloPapel(c.papel)} · {c.status}</span></span>
          <Botao variacao="secundario" className="shrink-0" carregando={ocupado === `r${c.membership_id}`} desabilitado={!!ocupado}
            aoTocar={() => {
              if (!window.confirm(`Remover ${c.nome} da coordenação? O acesso ao portal acaba na hora.`)) return
              rodar(`r${c.membership_id}`, () => coordenadorRemover(c.membership_id, 'removido no /admin'), 'Vínculo encerrado.')
            }}>Remover</Botao>
        </div>
      ))}
    </Card>
  )
}

function EditarClube({ clube: c, ativas, ocupado, rodar }) {
  const [pai, setPai] = useState(c.parent_id || '')
  const alvos = ativas.filter((u) => ['distrito', 'regiao', 'campo'].includes(u.tipo))
  return (
    <Card className="border border-line shadow-none">
      <Seletor id={`cl-pai-${c.id}`} rotulo="Clube ligado a" value={pai} onChange={(e) => setPai(e.target.value)}>
        <option value="">(nenhuma unidade)</option>
        {alvos.map((u) => <option key={u.id} value={u.id}>{TIPO_ROTULO[u.tipo]} — {u.nome}</option>)}
      </Seletor>
      <p className="text-xs text-faint mb-2">Mudar a unidade muda na hora quem da coordenação enxerga este clube (só números agregados).</p>
      <Botao variacao="contorno" className="w-full" carregando={ocupado === `v${c.id}`} desabilitado={!!ocupado || pai === (c.parent_id || '')}
        aoTocar={() => rodar(`v${c.id}`, () => clubeVincular(c.id, pai || null, 'definido no /admin'), 'Clube atualizado.')}>Salvar</Botao>
    </Card>
  )
}

function NovaUnidade({ ativas, ocupado, rodar }) {
  const [tipo, setTipo] = useState('regiao')
  const [nome, setNome] = useState('')
  const [pai, setPai] = useState('')
  const pais = ativas.filter((x) => NIVEL[x.tipo] < NIVEL[tipo])
  const criar = async () => {
    const r = await rodar('nova', () => unidadeCriar(tipo, nome, pai || null), 'Unidade criada.')
    if (r) setNome('')
  }
  return (
    <Caixa titulo="Nova unidade" testid="hier-nova">
      <Seletor id="hn-tipo" rotulo="Tipo" value={tipo} onChange={(e) => { setTipo(e.target.value); setPai('') }}>
        {TIPOS.map((t) => <option key={t} value={t}>{TIPO_ROTULO[t]}</option>)}
      </Seletor>
      <Campo id="hn-nome" rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Região Norte" />
      <Seletor id="hn-pai" rotulo="Fica debaixo de (opcional)" value={pai} onChange={(e) => setPai(e.target.value)}>
        <option value="">(nenhuma — topo)</option>
        {pais.map((x) => <option key={x.id} value={x.id}>{TIPO_ROTULO[x.tipo]} — {x.nome}</option>)}
      </Seletor>
      <Botao variacao="contorno" className="w-full" carregando={ocupado === 'nova'} desabilitado={!!ocupado || nome.trim().length < 2} aoTocar={criar}>
        Criar unidade
      </Botao>
    </Caixa>
  )
}

function Convites({ convites, ativas, ocupado, rodar }) {
  const [papel, setPapel] = useState('coordenador_regional')
  const [modo, setModo] = useState('fixo')
  const [unidade, setUnidade] = useState('')
  const [dias, setDias] = useState('7')
  const [usos, setUsos] = useState('1')
  const [link, setLink] = useState('')
  const tipo = PAPEIS_COORDENACAO.find((p) => p.papel === papel)?.tipo
  const alvos = ativas.filter((u) => u.tipo === tipo)

  const gerar = async () => {
    const u = alvos.find((x) => x.id === unidade)
    const r = await rodar('conv', () => conviteGerar({
      papel, unidadeId: modo === 'fixo' ? unidade || null : null, dias: Number(dias), maxUsos: Number(usos),
      rotulo: modo === 'fixo' && u ? `${rotuloPapel(papel)} — ${u.nome}` : `${rotuloPapel(papel)} (escolhe a unidade)`,
    }), 'Link gerado. Copie agora: ele não aparece de novo.')
    if (r?.token) setLink(montarLinkCoordenacao(window.location.origin, r.token))
  }
  const copiar = async () => {
    try { await navigator.clipboard.writeText(link); avisar.sucesso('Link copiado.') } catch { avisar.info('Selecione e copie o link.') }
  }

  return (
    <Caixa titulo="Convites de coordenação" testid="hier-convites">
      <Seletor id="cv-papel" rotulo="Papel" value={papel} onChange={(e) => { setPapel(e.target.value); setUnidade('') }}>
        {PAPEIS_COORDENACAO.map((p) => <option key={p.papel} value={p.papel}>{p.rotulo} ({TIPO_ROTULO[p.tipo]})</option>)}
      </Seletor>
      <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Tipo de link">
        {[['fixo', 'Unidade definida'], ['escolha', 'Pessoa escolhe']].map(([v, l]) => (
          <button key={v} type="button" aria-pressed={modo === v} onClick={() => setModo(v)}
            className={`min-h-[44px] rounded-xl border text-sm font-bold ${modo === v ? 'border-brand text-brand bg-surface' : 'border-line text-muted bg-surface'}`}>{l}</button>
        ))}
      </div>
      <p className="text-xs text-faint mb-3">
        {modo === 'fixo' ? 'Quem abrir o link já entra com o papel nesta unidade.' : 'A pessoa escolhe a unidade; o vínculo fica pendente até você confirmar aqui.'}
      </p>
      {modo === 'fixo' && (
        <Seletor id="cv-unidade" rotulo="Unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
          <option value="">Escolha…</option>
          {alvos.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Seletor>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo id="cv-dias" rotulo="Vale por (dias)" tipo="number" inputMode="numeric" min={1} max={90} value={dias} onChange={(e) => setDias(e.target.value)} />
        <Campo id="cv-usos" rotulo="Usos" tipo="number" inputMode="numeric" min={1} max={50} value={usos} onChange={(e) => setUsos(e.target.value)} />
      </div>
      <Botao variacao="contorno" className="w-full" carregando={ocupado === 'conv'} desabilitado={!!ocupado || (modo === 'fixo' && !unidade)} aoTocar={gerar}>
        Gerar link
      </Botao>
      {link && (
        <div className="mt-3 rounded-xl border border-line bg-surface2 p-3">
          <p className="text-xs text-muted mb-1">Copie agora — por segurança ele não é mostrado de novo:</p>
          <p className="text-xs text-ink break-all mb-2" data-testid="hier-link">{link}</p>
          <Botao variacao="secundario" className="w-full" aoTocar={copiar}>Copiar link</Botao>
        </div>
      )}

      {convites.length > 0 && (
        <ul className="mt-4 space-y-2">
          {convites.map((c) => {
            const [tom, rot] = SITUACAO_CONVITE[c.situacao] || ['neutro', c.situacao]
            return (
              <li key={c.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{c.rotulo}</span>
                  <Selo tom={tom}>{rot}</Selo>
                </div>
                <p className="text-xs text-muted mt-1">{c.usos}/{c.max_usos} uso(s) · até {data(c.expira_em)} · {c.modo === 'fixo' ? 'unidade definida' : 'pessoa escolhe'} · {c.prefixo}…</p>
                {c.situacao === 'valido' && (
                  <Botao variacao="secundario" className="w-full mt-2" carregando={ocupado === `x${c.id}`} desabilitado={!!ocupado}
                    aoTocar={() => rodar(`x${c.id}`, () => conviteRevogar(c.id), 'Convite revogado.')}>Revogar</Botao>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Caixa>
  )
}
