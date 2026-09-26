// /admin → Chamados: fila da central de suporte (migration 290). NÃO é a aba "Suporte" (acesso de
// suporte autorizado pelo clube). Toda RPC exige eh_admin_plataforma() no servidor e audita as ações.
import { useCallback, useEffect, useState } from 'react'
import { Botao, Aviso, Campo, Selecao } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { Chip, Painel, Linha, EstadoVazio, Esqueleto, FOCO, dataHoraBR } from '../components/admin/AdminUI.jsx'
import {
  ROTULO_CATEGORIA, ROTULO_STATUS_CHAMADO, ROTULO_PRIORIDADE, PRIORIDADES,
  adminChamadosListar, adminChamadoVer, adminChamadoResponder, adminChamadoAtualizar, enviarAnexo, tempoDesde,
} from '../services/suporte.js'
import { Anexo } from './Suporte.jsx'

const FILTROS = [['abertos', 'Abertos'], ['meus', 'Meus'], ['aguardando', 'Aguardando usuário'], ['resolvidos', 'Resolvidos'], ['todos', 'Todos']]
const TOM_STATUS = { aberto: 'info', em_andamento: 'atencao', aguardando_usuario: 'dourado', resolvido: 'ok', fechado: 'neutro' }
const TOM_PRIO = { urgente: 'perigo', alta: 'atencao', normal: 'neutro', baixa: 'neutro' }
const STATUS_OPCOES = Object.entries(ROTULO_STATUS_CHAMADO).map(([k, v]) => [k, v === 'Aguardando você' ? 'Aguardando usuário' : v])

export default function AdminChamados({ inicial = null, aoMudarContagem }) {
  const [filtro, setFiltro] = useState('abertos')
  const [aberto, setAberto] = useState(inicial)
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(() => {
    setLista(null)
    adminChamadosListar(filtro).then((l) => { setErro(''); setLista(l) }).catch((e) => setErro(e.message))
  }, [filtro])
  useEffect(() => { carregar() }, [carregar])

  if (aberto) {
    return <DetalheChamado id={aberto} aoVoltar={() => { setAberto(null); carregar(); aoMudarContagem?.() }} aoMudar={aoMudarContagem} />
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filtrar chamados" className="flex flex-wrap gap-1.5">
        {FILTROS.map(([k, r]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
            className={`min-h-[44px] rounded-full px-3.5 text-sm font-semibold ${FOCO} ${filtro === k
              ? 'bg-[#0b1f4d] text-white dark:bg-white dark:text-[#07122f]' : 'border border-line bg-surface text-ink'}`}>{r}</button>
        ))}
      </div>
      {erro && <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>}
      {!erro && lista == null && <Esqueleto />}
      {lista?.length === 0 && <EstadoVazio icone="📨" titulo="Nenhum chamado aqui" />}
      {lista?.length > 0 && (
        <ul className="space-y-2">
          {lista.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setAberto(c.id)} data-testid="chamado-item"
                className={`w-full rounded-2xl border border-line bg-surface p-3.5 text-left active:bg-surface2 ${FOCO}`}>
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink">{c.assunto}</span>
                    <span className="block truncate text-xs text-muted">{c.autor} · {c.clube || 'sem clube'} · {ROTULO_CATEGORIA[c.categoria]}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-faint" title={dataHoraBR(c.criado_em)}>há {tempoDesde(c.criado_em)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tom={TOM_STATUS[c.status] || 'neutro'} ponto>{STATUS_OPCOES.find(([k]) => k === c.status)?.[1] || c.status}</Chip>
                  <Chip tom={TOM_PRIO[c.prioridade] || 'neutro'}>Prioridade {ROTULO_PRIORIDADE[c.prioridade]}</Chip>
                  {c.ultima_msg_origem === 'usuario' && !['resolvido', 'fechado'].includes(c.status) && <Chip tom="atencao">Resposta do usuário</Chip>}
                  {c.meu && <Chip tom="info">Comigo</Chip>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DetalheChamado({ id, aoVoltar, aoMudar }) {
  const [c, setC] = useState(null)
  const [erro, setErro] = useState('')
  const [texto, setTexto] = useState('')
  const [interna, setInterna] = useState(false)
  const [statusResp, setStatusResp] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(() => {
    adminChamadoVer(id).then((d) => { setErro(''); setC(d) }).catch((e) => setErro(e.message))
  }, [id])
  useEffect(() => { carregar() }, [carregar])

  async function atualizar(campos) {
    setOcupado(true)
    try { await adminChamadoAtualizar(id, campos); carregar(); aoMudar?.() } catch (e) { avisar.erro(e) } finally { setOcupado(false) }
  }

  async function responder(e) {
    e.preventDefault()
    if (!texto.trim()) return
    setOcupado(true)
    try {
      const anexo = arquivo ? await enviarAnexo(arquivo) : null
      await adminChamadoResponder(id, { texto: texto.trim(), interna, anexo, status: statusResp || null })
      setTexto(''); setArquivo(null); setStatusResp('')
      avisar.sucesso(interna ? 'Nota interna salva.' : 'Resposta enviada ao usuário.')
      carregar(); aoMudar?.()
    } catch (err) { avisar.erro(err) } finally { setOcupado(false) }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={aoVoltar} className={`min-h-[44px] text-sm font-semibold text-brand ${FOCO}`}>‹ Fila de chamados</button>
      {erro && <Aviso tom="erro" titulo="Não deu pra abrir">{erro}</Aviso>}
      {!erro && !c && <Esqueleto />}
      {c && (
        <>
          <Painel titulo={c.assunto} icone="📨">
            <Linha rotulo="Autor">{c.autor}</Linha>
            <Linha rotulo="Clube">{c.clube || '—'}</Linha>
            <Linha rotulo="Categoria">{ROTULO_CATEGORIA[c.categoria]}</Linha>
            <Linha rotulo="Aberto em">{dataHoraBR(c.criado_em)} (há {tempoDesde(c.criado_em)})</Linha>
            {c.prioridade_sugerida && <Linha rotulo="Prioridade sugerida">{ROTULO_PRIORIDADE[c.prioridade_sugerida]}</Linha>}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Selecao id="ch-status" rotulo="Status" value={c.status} disabled={ocupado}
                onChange={(e) => atualizar({ status: e.target.value })} opcoes={STATUS_OPCOES} />
              <Selecao id="ch-prio" rotulo="Prioridade" value={c.prioridade} disabled={ocupado}
                onChange={(e) => atualizar({ prioridade: e.target.value })} opcoes={PRIORIDADES} />
            </div>
            <Botao variacao="contorno" desabilitado={ocupado} aoTocar={() => atualizar({ assumir: !c.meu })}>
              {c.meu ? 'Soltar chamado' : 'Assumir chamado'}
            </Botao>
          </Painel>

          <Painel titulo="Contexto técnico" icone="🧩">
            {Object.keys(c.contexto || {}).length === 0
              ? <p className="text-sm text-muted">Sem contexto.</p>
              : Object.entries(c.contexto).map(([k, v]) => <Linha key={k} rotulo={k}>{String(v)}</Linha>)}
          </Painel>

          <Painel titulo="Conversa" icone="💬">
            <ol className="space-y-2">
              {c.mensagens.map((m) => (
                <li key={m.id} data-testid={m.interna ? 'nota-interna' : 'mensagem'}
                  className={`rounded-xl border p-3 ${m.interna ? 'border-dashed border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                    : m.origem === 'suporte' ? 'border-[#f5c518]/40 bg-[#f5c518]/10' : 'border-line bg-surface2'}`}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-faint">
                    {m.interna ? '🔒 Nota interna' : m.origem === 'suporte' ? 'Suporte' : 'Usuário'} · {m.autor} · {dataHoraBR(m.criado_em)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{m.texto}</p>
                  {m.anexo_path && <Anexo caminho={m.anexo_path} />}
                </li>
              ))}
            </ol>
          </Painel>

          <form onSubmit={responder}>
            <Painel titulo={interna ? 'Nova nota interna' : 'Responder ao usuário'} icone={interna ? '🔒' : '✉️'}>
              <label className="mb-2 flex min-h-[44px] items-center gap-2 text-sm font-semibold text-ink">
                <input type="checkbox" checked={interna} onChange={(e) => setInterna(e.target.checked)} className="h-5 w-5" />
                Nota interna (o usuário não vê)
              </label>
              <Campo id="ch-texto" rotulo="Mensagem" linhas={4} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
              {!interna && (
                <Selecao id="ch-status-resp" rotulo="Depois de enviar, status" value={statusResp} onChange={(e) => setStatusResp(e.target.value)}
                  opcoes={[['', 'Aguardando usuário (padrão)'], ['em_andamento', 'Em andamento'], ['resolvido', 'Resolvido']]} />
              )}
              <div className="mb-3">
                <label htmlFor="ch-anexo" className="block text-xs font-semibold text-muted mb-1">Anexo (opcional)</label>
                <input id="ch-anexo" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full min-h-[44px] text-sm"
                  onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
              </div>
              <Botao tipo="submit" className="w-full" carregando={ocupado} desabilitado={ocupado || !texto.trim()}>
                {interna ? 'Salvar nota' : 'Enviar resposta'}
              </Botao>
            </Painel>
          </form>
        </>
      )}
    </div>
  )
}
