import { useState, useEffect, useCallback } from 'react'
import { Card, Botao, Aviso, Selo, Carregando, Campo } from '../ui/index.jsx'
import {
  limiteMembros, limiteMembrosDefinir, lixeiraListar, lixeiraSimular, lixeiraRecuperar, lixeiraModoClube,
  lixeiraConfig, lixeiraConfigDefinir,
} from '../services/adminMembros.js'
import { avisar } from '../ui/avisos.jsx'

// /admin › detalhe do clube: limite de membros (migration 220) e lixeira de inativos (migration 221).
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
export const ROTULO_MODO = { desligado: 'Desligada', dry_run: 'Somente listar (não mexe em nada)', ativo: 'Ativa (move e expurga)' }
const TOM_MODO = { desligado: 'neutro', dry_run: 'atencao', ativo: 'perigo' }
const ROTULO_MOTIVO = {
  vinculo_suspenso: 'vínculo suspenso', vinculo_encerrado: 'saiu do clube', vinculo_vencido: 'vínculo vencido', sem_login: 'sem entrar no app',
}
const ROTULO_PACOTE = { na_lixeira: 'Na lixeira', recuperado: 'Recuperado', expurgado: 'Apagado de vez' }
const TOM_PACOTE = { na_lixeira: 'atencao', recuperado: 'ok', expurgado: 'neutro' }
const SELECT = 'mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink'

function useCarga(fn) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const recarregar = useCallback(() => {
    fn().then((d) => { setErro(''); setDados(d) }).catch((e) => setErro(e?.message || String(e)))
  }, [fn])
  useEffect(() => { recarregar() }, [recarregar])
  return { dados, erro, recarregar }
}

// ------------------------------------------------------------------ limite de membros
export function LimiteMembrosClube({ clubId, onFeito }) {
  const buscar = useCallback(() => limiteMembros(clubId), [clubId])
  const { dados: d, erro, recarregar } = useCarga(buscar)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function salvar(limite) {
    if (limite !== null && !(Number(limite) >= 1)) { avisar.erro(new Error('Informe um limite de pelo menos 1 membro.')); return }
    setOcupado(true)
    try {
      const r = await limiteMembrosDefinir(clubId, limite === null ? null : Number(limite), motivo.trim() || null)
      avisar.sucesso(limite === null ? 'O clube voltou ao limite do plano.' : `Limite ajustado para ${r.limite_efetivo} membros.`)
      if (r.abaixo_do_uso) avisar.info('O limite ficou abaixo do uso atual: ninguém é removido, só novas entradas ficam barradas.')
      setValor(''); setMotivo('')
      recarregar(); onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  if (erro) return <Aviso tom="erro" titulo="Limite de membros">{erro}</Aviso>
  if (!d) return <Carregando />
  const cheio = d.limite_efetivo != null && d.uso >= d.limite_efetivo
  return (
    <Card data-testid="admin-limite-membros">
      <p className="font-bold text-ink text-sm mb-2">Limite de membros</p>
      <p className="text-2xl font-extrabold text-ink" data-testid="limite-uso">
        {d.uso} <span className="text-base font-semibold text-muted">de {d.limite_efetivo ?? 'sem limite'}</span>
      </p>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {cheio && <Selo tom="perigo">Limite atingido — novas entradas barradas</Selo>}
        {d.ajuste ? <Selo tom="atencao">Ajustado pelo admin</Selo> : <Selo tom="neutro">Teto do plano</Selo>}
      </div>
      <p className="text-sm text-muted mt-2">
        Plano: {d.limite_plano ?? 'sem limite'}
        {d.ajuste && <> · ajuste: <strong>{d.ajuste.valor}</strong> desde {data(d.ajuste.definido_em)}{d.ajuste.motivo ? ` (${d.ajuste.motivo})` : ''}</>}
      </p>
      <p className="text-xs text-faint mt-1">{d.regra}</p>
      <div className="grid gap-2 mt-3 sm:grid-cols-2">
        <Campo id="limite-valor" rotulo="Novo limite só deste clube" tipo="number" inputMode="numeric" min={1} max={100000}
          value={valor} onChange={(e) => setValor(e.target.value)} />
        <Campo id="limite-motivo" rotulo="Motivo (vai para a auditoria)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
      </div>
      <div className="grid gap-2 mt-2 sm:grid-cols-2">
        <Botao aoTocar={() => salvar(valor)} carregando={ocupado} desabilitado={!valor || !motivo.trim()} data-testid="limite-salvar">Salvar ajuste</Botao>
        {d.ajuste && <Botao variacao="secundario" aoTocar={() => salvar(null)} desabilitado={ocupado} data-testid="limite-remover">Voltar ao limite do plano</Botao>}
      </div>
      <p className="text-xs text-faint mt-2">Vale só para este clube; a versão do plano não muda para os outros. Ninguém é removido se o limite ficar abaixo do uso.</p>
    </Card>
  )
}

// ------------------------------------------------------------------ lixeira
export function LixeiraClube({ clubId }) {
  const buscar = useCallback(() => lixeiraListar(clubId), [clubId])
  const { dados: d, erro, recarregar } = useCarga(buscar)
  const [ocupado, setOcupado] = useState('')

  async function acao(chave, fn, sucesso) {
    setOcupado(chave)
    try { const r = await fn(); if (sucesso) avisar.sucesso(typeof sucesso === 'function' ? sucesso(r) : sucesso); recarregar() } catch (e) { avisar.erro(e) }
    setOcupado('')
  }
  async function mudarModo(valor) {
    const modo = valor === 'global' ? null : valor
    if (modo === 'ativo' && !(await avisar.confirmar({ titulo: 'Ligar a lixeira neste clube?', descricao: 'Quem está na lista "iria para a lixeira" será movido na próxima rodada diária: os dados somem das telas e podem ser recuperados até o expurgo.', rotulo: 'Ligar a lixeira' }))) return
    acao('modo', () => lixeiraModoClube(clubId, modo), 'Modo da lixeira atualizado.')
  }
  async function recuperar(p) {
    if (!(await avisar.confirmar({ titulo: `Recuperar ${p.nome || 'esta pessoa'}?`, descricao: 'Os dados voltam e o vínculo volta INATIVO (a diretoria reativa se quiser).', rotulo: 'Recuperar' }))) return
    acao(`rec-${p.id}`, () => lixeiraRecuperar(p.id, 'recuperado pelo admin'), (r) => `Recuperado: ${r.restauradas} registro(s).`)
  }

  if (erro) return <Aviso tom="erro" titulo="Lixeira de membros">{erro}</Aviso>
  if (!d) return <Carregando />
  const naLixeira = d.pacotes.filter((p) => p.status === 'na_lixeira')
  const historico = d.pacotes.filter((p) => p.status !== 'na_lixeira')
  return (
    <Card data-testid="admin-lixeira">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-ink text-sm">Lixeira de membros inativos</p>
        <Selo tom={TOM_MODO[d.modo]}>{ROTULO_MODO[d.modo] || d.modo}</Selo>
      </div>
      <p className="text-xs text-muted mt-1" data-testid="lixeira-regra">{d.regra}</p>

      <label htmlFor="lixeira-modo" className="block text-sm font-semibold text-ink mt-3">Modo neste clube</label>
      <select id="lixeira-modo" className={SELECT} value={d.modo_proprio || 'global'} disabled={ocupado === 'modo'}
        onChange={(e) => mudarModo(e.target.value)}>
        <option value="global">Seguir a configuração geral</option>
        <option value="desligado">{ROTULO_MODO.desligado}</option>
        <option value="dry_run">{ROTULO_MODO.dry_run}</option>
        <option value="ativo">{ROTULO_MODO.ativo}</option>
      </select>

      <div className="flex items-center justify-between gap-2 mt-4">
        <p className="font-semibold text-ink text-sm">Iria para a lixeira ({d.marcacoes.length})</p>
        <Botao variacao="secundario" aoTocar={() => acao('sim', () => lixeiraSimular(clubId), (r) => `Lista atualizada: ${r.candidatos} pessoa(s).`)}
          carregando={ocupado === 'sim'} data-testid="lixeira-simular">Atualizar lista</Botao>
      </div>
      {d.marcacoes.length === 0 ? <p className="text-sm text-muted">Ninguém se encaixa na regra agora.</p> : (
        <ul className="divide-y divide-line text-sm" data-testid="lixeira-marcacoes">
          {d.marcacoes.map((m, i) => (
            <li key={i} className="py-2">
              <span className="font-semibold text-ink">{m.nome || 'Sem nome'}</span>
              <span className="text-muted"> · {(m.papeis || []).join(', ')} · {ROTULO_MOTIVO[m.motivo] || m.motivo} desde {data(m.inativo_desde)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="font-semibold text-ink text-sm mt-4">Na lixeira ({naLixeira.length})</p>
      {naLixeira.length === 0 ? <p className="text-sm text-muted">Vazia.</p> : (
        <ul className="divide-y divide-line text-sm" data-testid="lixeira-pacotes">
          {naLixeira.map((p) => (
            <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{p.nome || 'Sem nome'} <span className="text-muted font-normal">· {(p.papeis || []).join(', ')}</span></p>
                <p className="text-xs text-muted">
                  {ROTULO_MOTIVO[p.motivo] || p.motivo} desde {data(p.inativo_desde)} · na lixeira desde {data(p.arquivado_em)} ·
                  apagado de vez em <strong>{data(p.expurgo_previsto_em)}</strong>{p.arquivos ? ` · ${p.arquivos} foto(s)` : ''}
                </p>
              </div>
              <Botao aoTocar={() => recuperar(p)} carregando={ocupado === `rec-${p.id}`} desabilitado={!!ocupado} data-testid={`lixeira-recuperar-${p.id}`}>Recuperar</Botao>
            </li>
          ))}
        </ul>
      )}

      {historico.length > 0 && (
        <details className="mt-3">
          <summary className="text-sm text-muted cursor-pointer min-h-[44px] flex items-center">Histórico ({historico.length})</summary>
          <ul className="divide-y divide-line text-sm">
            {historico.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap gap-2 items-center">
                <Selo tom={TOM_PACOTE[p.status]}>{ROTULO_PACOTE[p.status]}</Selo>
                <span className="text-muted">{p.nome || 'Pessoa apagada'} · {data(p.recuperado_em || p.expurgado_em)}{p.conta_removida ? ' · conta de login removida' : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {d.execucoes.length > 0 && (
        <p className="text-xs text-faint mt-3">
          Última rodada: {data(d.execucoes[0].quando)} ({ROTULO_MODO[d.execucoes[0].modo] || d.execucoes[0].modo}) · {d.execucoes[0].candidatos} na regra,
          {' '}{d.execucoes[0].arquivados} movido(s), {d.execucoes[0].expurgados} apagado(s) de vez{d.execucoes[0].erros ? ` · ${d.execucoes[0].erros} erro(s)` : ''}.
        </p>
      )}
      <LixeiraConfigGeral onFeito={recarregar} />
    </Card>
  )
}

// configuração geral (vale para todos os clubes sem modo próprio)
export function LixeiraConfigGeral({ onFeito }) {
  const { dados: c, erro, recarregar } = useCarga(lixeiraConfig)
  const [form, setForm] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    if (c) setForm({ modo: c.modo, inat: String(c.dias_inatividade), ret: String(c.dias_retencao), semLogin: c.sem_login_dias ? String(c.sem_login_dias) : '' })
  }, [c])

  async function salvar() {
    if (form.modo === 'ativo' && c.modo !== 'ativo' && !(await avisar.confirmar({ titulo: 'Ligar a lixeira para todos os clubes sem modo próprio?', descricao: 'O clube fundador tem modo próprio e não muda.', rotulo: 'Ligar' }))) return
    setOcupado(true)
    try {
      await lixeiraConfigDefinir({
        modo: form.modo, diasInatividade: Number(form.inat), diasRetencao: Number(form.ret),
        semLoginDias: form.semLogin ? Number(form.semLogin) : 0,
      })
      avisar.sucesso('Configuração da lixeira salva.')
      recarregar(); onFeito?.()
    } catch (e) { avisar.erro(e) }
    setOcupado(false)
  }

  if (erro) return <p className="text-xs text-muted mt-3">{erro}</p>
  if (!c || !form) return null
  return (
    <details className="mt-3 rounded-xl border border-line p-3" data-testid="lixeira-config">
      <summary className="text-sm font-semibold text-ink cursor-pointer min-h-[44px] flex items-center">Configuração geral (todos os clubes)</summary>
      <label htmlFor="lixeira-modo-geral" className="block text-sm font-semibold text-ink mt-2">Modo geral</label>
      <select id="lixeira-modo-geral" className={SELECT} value={form.modo} onChange={(e) => setForm({ ...form, modo: e.target.value })}>
        {Object.entries(ROTULO_MODO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <Campo id="lixeira-inat" rotulo="Dias inativo" tipo="number" inputMode="numeric" min={30} max={3650} value={form.inat} onChange={(e) => setForm({ ...form, inat: e.target.value })} />
        <Campo id="lixeira-ret" rotulo="Dias na lixeira" tipo="number" inputMode="numeric" min={7} max={3650} value={form.ret} onChange={(e) => setForm({ ...form, ret: e.target.value })} />
        <Campo id="lixeira-login" rotulo="Sem login (dias)" tipo="number" inputMode="numeric" min={60} max={3650} placeholder="desligado" value={form.semLogin} onChange={(e) => setForm({ ...form, semLogin: e.target.value })} />
      </div>
      <p className="text-xs text-faint mt-1">“Sem login” vazio = regra desligada (padrão). Diretoria nunca entra por essa regra.</p>
      {(c.clubes || []).length > 0 && (
        <p className="text-xs text-muted mt-2">Clubes com modo próprio: {c.clubes.map((x) => `${x.clube} (${ROTULO_MODO[x.modo] || x.modo})`).join('; ')}</p>
      )}
      <Botao aoTocar={salvar} carregando={ocupado} className="w-full mt-2" data-testid="lixeira-config-salvar">Salvar configuração geral</Botao>
    </details>
  )
}
