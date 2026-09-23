import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  salvarExperiencia, salvarEtapa, definirPublico, mudarEstado, carregarExperiencia,
  carregarModelos, copiarModelo, carregarPendentes, avaliarEnvio,
  TIPO_ROTULO, EVIDENCIA_ROTULO, STATUS_ROTULO,
} from '../services/experiencias.js'
import { supabase } from '../lib/supabase.js'

// Construtor NO-CODE (fase 6). A liderança monta a experiência escolhendo de listas fechadas: o
// front NUNCA inventa um campo nem monta expressão. Se algo estiver fora do vocabulário, quem recusa
// é o servidor — e o erro dele aparece aqui, do jeito que veio.
const TIPOS = Object.entries(TIPO_ROTULO)
const EVIDENCIAS = Object.entries(EVIDENCIA_ROTULO)
const CONCLUSAO = [
  ['todas_etapas', 'Concluir todas as etapas obrigatórias'],
  ['minimo_etapas', 'Concluir um número mínimo de etapas'],
  ['aprovacao_lideranca', 'A liderança decide quando concluiu'],
]
const RECOMPENSAS = [['nenhuma', 'Nenhuma'], ['pontos', 'Pontos'], ['badge', 'Conquista'], ['item', 'Item virtual']]

export default function ExperienciaEditor() {
  const [unidades, setUnidades] = useState([])
  const [exp, setExp] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [modelos, setModelos] = useState([])
  const [pendentes, setPendentes] = useState([])
  const [form, setForm] = useState({
    titulo: '', descricao: '', tipo: 'desafio_individual', alvo: 'individual',
    inicio: '', fim: '', sequencial: false,
    conclusao: 'todas_etapas', conclusao_qtd: 1,
    recompensa: 'nenhuma', recompensa_valor: 10, recompensa_nome: '',
  })
  const [etapa, setEtapa] = useState({ titulo: '', descricao: '', evidencia: 'confirmacao', pontos: 0, exige_aprovacao: false, meta: 10, min_caracteres: 20 })
  const [publico, setPublico] = useState({ tipo: 'todos', unidade_id: '' })

  const recarregarPendentes = useCallback(async () => {
    try { setPendentes(await carregarPendentes()) } catch { /* recurso pode estar fechado */ }
  }, [])
  useEffect(() => {
    carregarModelos().then(setModelos).catch(() => {})
    supabase.from('unidades').select('id,nome').order('nome')
      .then(({ data }) => setUnidades(data || [])).catch?.(() => {})
    recarregarPendentes()
  }, [recarregarPendentes])

  const agir = async (fn) => {
    setErro(''); setOcupado(true)
    try { return await fn() } catch (e) { setErro(e?.message || String(e)); return null }
    finally { setOcupado(false) }
  }

  const criar = async (ev) => {
    ev.preventDefault()
    const dados = {
      titulo: form.titulo, descricao: form.descricao, tipo: form.tipo, alvo: form.alvo,
      sequencial: form.sequencial,
      regra_conclusao: form.conclusao === 'minimo_etapas'
        ? { tipo: 'minimo_etapas', quantidade: Number(form.conclusao_qtd) }
        : { tipo: form.conclusao },
      recompensa: form.recompensa === 'pontos' ? { tipo: 'pontos', valor: Number(form.recompensa_valor) }
        : form.recompensa === 'badge' ? { tipo: 'badge', chave: 'conquista-do-clube', nome: form.recompensa_nome || 'Conquista', icone: '🏅' }
        : form.recompensa === 'item' ? { tipo: 'item', chave: 'item-do-clube', nome: form.recompensa_nome || 'Item' }
        : { tipo: 'nenhuma' },
    }
    if (form.inicio) dados.inicio = new Date(form.inicio).toISOString()
    if (form.fim) dados.fim = new Date(form.fim).toISOString()
    const nova = await agir(() => salvarExperiencia(null, dados))
    if (nova) setExp(await carregarExperiencia(nova.id))
  }

  const adicionarEtapa = async (ev) => {
    ev.preventDefault()
    const regra = etapa.evidencia === 'contagem' ? { meta: Number(etapa.meta) }
      : etapa.evidencia === 'texto' ? { min_caracteres: Number(etapa.min_caracteres) }
      : {}
    const ok = await agir(() => salvarEtapa(exp.id, null, {
      titulo: etapa.titulo, descricao: etapa.descricao, evidencia: etapa.evidencia,
      pontos: Number(etapa.pontos), exige_aprovacao: etapa.exige_aprovacao, regra,
    }))
    if (ok) { setEtapa({ ...etapa, titulo: '', descricao: '' }); setExp(await carregarExperiencia(exp.id)) }
  }

  const salvarPublico = async () => {
    const item = publico.tipo === 'unidade' ? { tipo: 'unidade', unidade_id: publico.unidade_id } : { tipo: publico.tipo }
    const ok = await agir(() => definirPublico(exp.id, [item]))
    if (ok) setExp(await carregarExperiencia(exp.id))
  }

  const publicar = async () => {
    const ok = await agir(() => mudarEstado(exp.id, 'publicada'))
    if (ok) setExp(await carregarExperiencia(exp.id))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Link to="/experiencias" className="text-sm font-semibold text-brand underline">← Experiências</Link>
      <h1 className="text-2xl font-extrabold text-ink mt-2">🛠️ Montar uma experiência</h1>
      <p className="text-sm text-muted mb-4">Sem programar: você escolhe de listas e o servidor valida.</p>

      {erro && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 mb-4">{erro}</div>}

      {pendentes.length > 0 && (
        <section className="bg-surface rounded-2xl p-4 shadow-soft mb-5" aria-labelledby="t-val">
          <h2 id="t-val" className="text-sm font-extrabold text-ink mb-2">Esperando a sua validação ({pendentes.length})</h2>
          <ul className="space-y-2">
            {pendentes.map((p) => (
              <li key={p.id} className="border border-line rounded-xl p-3">
                <div className="text-sm font-bold text-ink">{p.quem}</div>
                <div className="text-xs text-muted">{p.experiencia} · {p.etapa}</div>
                {p.texto && <p className="text-xs text-faint mt-1">{p.texto}</p>}
                <div className="flex gap-2 mt-2">
                  <button type="button" disabled={ocupado}
                    onClick={() => agir(() => avaliarEnvio(p.id, 'aprovada')).then(recarregarPendentes)}
                    className="min-h-[40px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold">Aprovar</button>
                  <button type="button" disabled={ocupado}
                    onClick={() => agir(() => avaliarEnvio(p.id, 'correcao', 'Refaça, por favor')).then(recarregarPendentes)}
                    className="min-h-[40px] px-3 rounded-lg bg-amber-500 text-white text-xs font-bold">Pedir correção</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!exp && modelos.length > 0 && (
        <section className="bg-surface rounded-2xl p-4 shadow-soft mb-5" aria-labelledby="t-mod">
          <h2 id="t-mod" className="text-sm font-extrabold text-ink mb-1">Começar de um modelo</h2>
          <p className="text-xs text-faint mb-2 leading-snug">
            O modelo é copiado para o seu clube. A partir daí a experiência é sua — se a plataforma
            mudar o modelo depois, o que você publicou não muda.
          </p>
          <ul className="space-y-2">
            {modelos.map((m) => (
              <li key={m.chave} className="flex items-center justify-between gap-2 border border-line rounded-xl p-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink truncate">{m.titulo}</div>
                  <div className="text-[11px] text-faint">{TIPO_ROTULO[m.tipo] || m.tipo}</div>
                </div>
                <button type="button" disabled={ocupado}
                  onClick={async () => { const n = await agir(() => copiarModelo(m.chave)); if (n) setExp(await carregarExperiencia(n.id)) }}
                  className="shrink-0 min-h-[40px] px-3 rounded-lg bg-brand text-white text-xs font-bold">Copiar</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!exp ? (
        <form onSubmit={criar} className="bg-surface rounded-2xl p-5 shadow-soft space-y-3">
          <h2 className="font-bold text-ink">Do zero</h2>
          <Campo id="ex-titulo" rotulo="Título" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} required />
          <label className="block">
            <span className="text-xs text-muted">Descrição</span>
            <textarea id="ex-desc" rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              className="mt-1 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
          </label>
          <Selecao id="ex-tipo" rotulo="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} opcoes={TIPOS} />
          <Selecao id="ex-alvo" rotulo="Quem conclui" value={form.alvo} onChange={(v) => setForm({ ...form, alvo: v })}
            opcoes={[['individual', 'Cada pessoa'], ['unidade', 'A unidade inteira']]} />
          <div className="grid grid-cols-2 gap-2">
            <Campo id="ex-inicio" rotulo="Início" type="datetime-local" value={form.inicio} onChange={(v) => setForm({ ...form, inicio: v })} />
            <Campo id="ex-fim" rotulo="Fim" type="datetime-local" value={form.fim} onChange={(v) => setForm({ ...form, fim: v })} />
          </div>
          <Selecao id="ex-conclusao" rotulo="Conclui quando" value={form.conclusao} onChange={(v) => setForm({ ...form, conclusao: v })} opcoes={CONCLUSAO} />
          {form.conclusao === 'minimo_etapas' && (
            <Campo id="ex-qtd" rotulo="Quantas etapas" type="number" value={form.conclusao_qtd} onChange={(v) => setForm({ ...form, conclusao_qtd: v })} />
          )}
          <Selecao id="ex-recompensa" rotulo="Recompensa" value={form.recompensa} onChange={(v) => setForm({ ...form, recompensa: v })} opcoes={RECOMPENSAS} />
          {form.recompensa === 'pontos' && (
            <Campo id="ex-pontos" rotulo="Pontos" type="number" value={form.recompensa_valor} onChange={(v) => setForm({ ...form, recompensa_valor: v })} />
          )}
          {(form.recompensa === 'badge' || form.recompensa === 'item') && (
            <Campo id="ex-rec-nome" rotulo="Nome" value={form.recompensa_nome} onChange={(v) => setForm({ ...form, recompensa_nome: v })} />
          )}
          <button type="submit" disabled={ocupado} className="w-full min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-60">
            {ocupado ? 'Criando…' : 'Criar rascunho'}
          </button>
        </form>
      ) : (
        <div className="space-y-4" data-testid="editor-aberto">
          <div className="bg-surface rounded-2xl p-4 shadow-soft">
            <div className="font-bold text-ink">{exp.titulo}</div>
            <div className="text-xs text-muted">{TIPO_ROTULO[exp.tipo] || exp.tipo} · {STATUS_ROTULO[exp.status] || exp.status}</div>
          </div>

          {exp.status === 'rascunho' && (
            <>
              <form onSubmit={adicionarEtapa} className="bg-surface rounded-2xl p-4 shadow-soft space-y-3">
                <h2 className="font-bold text-ink text-sm">Etapas ({(exp.etapas || []).length})</h2>
                <ul className="space-y-1">
                  {(exp.etapas || []).map((s) => (
                    <li key={s.id} className="text-xs text-faint">{s.ordem}. {s.titulo} — {EVIDENCIA_ROTULO[s.evidencia]}</li>
                  ))}
                </ul>
                <Campo id="et-titulo" rotulo="Título da etapa" value={etapa.titulo} onChange={(v) => setEtapa({ ...etapa, titulo: v })} required />
                <Selecao id="et-evid" rotulo="O que a pessoa entrega" value={etapa.evidencia} onChange={(v) => setEtapa({ ...etapa, evidencia: v })} opcoes={EVIDENCIAS} />
                {etapa.evidencia === 'contagem' && <Campo id="et-meta" rotulo="Meta" type="number" value={etapa.meta} onChange={(v) => setEtapa({ ...etapa, meta: v })} />}
                {etapa.evidencia === 'texto' && <Campo id="et-min" rotulo="Mínimo de caracteres" type="number" value={etapa.min_caracteres} onChange={(v) => setEtapa({ ...etapa, min_caracteres: v })} />}
                <Campo id="et-pontos" rotulo="Pontos da etapa" type="number" value={etapa.pontos} onChange={(v) => setEtapa({ ...etapa, pontos: v })} />
                <label className="flex items-center gap-2 text-sm text-ink min-h-[44px]">
                  <input type="checkbox" checked={etapa.exige_aprovacao} onChange={(e) => setEtapa({ ...etapa, exige_aprovacao: e.target.checked })} />
                  A liderança precisa validar
                </label>
                <button type="submit" disabled={ocupado} className="w-full min-h-[44px] rounded-xl border border-brand text-brand font-bold text-sm">
                  Adicionar etapa
                </button>
              </form>

              <div className="bg-surface rounded-2xl p-4 shadow-soft space-y-3">
                <h2 className="font-bold text-ink text-sm">Para quem</h2>
                <Selecao id="pub-tipo" rotulo="Público" value={publico.tipo} onChange={(v) => setPublico({ ...publico, tipo: v })}
                  opcoes={[['todos', 'Todo o clube'], ['unidade', 'Uma unidade'], ['papel', 'Um papel']]} />
                {publico.tipo === 'unidade' && (
                  <Selecao id="pub-unid" rotulo="Unidade" value={publico.unidade_id} onChange={(v) => setPublico({ ...publico, unidade_id: v })}
                    opcoes={(unidades || []).map((u) => [u.id, u.nome])} />
                )}
                <button type="button" onClick={salvarPublico} disabled={ocupado}
                  className="w-full min-h-[44px] rounded-xl border border-brand text-brand font-bold text-sm">Salvar público</button>
              </div>

              <button type="button" onClick={publicar} disabled={ocupado} data-testid="publicar"
                className="w-full min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-60">
                Publicar
              </button>
              <p className="text-[11px] text-faint leading-snug">
                Depois de publicada, a estrutura não muda mais (etapas, regras, recompensa e período):
                isso protege o histórico de quem participou. Precisando mudar, crie uma versão nova.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Campo({ id, rotulo, value, onChange, type = 'text', required }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs text-muted">{rotulo}</span>
      <input id={id} type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
    </label>
  )
}

function Selecao({ id, rotulo, value, onChange, opcoes }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs text-muted">{rotulo}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
    </label>
  )
}
