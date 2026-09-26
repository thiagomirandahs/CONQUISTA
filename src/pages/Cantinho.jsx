import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  cantinhoMinhasUnidades, cantinhoVer, cantinhoJustificar, cantinhoCaixaLancar, cantinhoCaixaExcluir,
  cantinhoMeditacaoSalvar, cantinhoMuralEnviar, cantinhoMuralModerar, cantinhoMuralApagar,
  cantinhoAjudaRegistrar, cantinhoAjudaConfirmar, cantinhoAjudaDesfazer, cantinhoConfigDefinir,
  cantinhoReuniaoSalvar, cantinhoReuniaoExcluir, cantinhoPlanoSalvar, cantinhoPlanoExcluir,
  paraCentavos, formatarReal, diaMes, ehDomingo, STATUS_CHAMADA, STATUS_PLANO,
} from '../services/cantinho.js'
import { avisar } from '../ui/avisos.jsx'
import BotaoAjuda from '../components/BotaoAjuda.jsx'
import { Aviso, Botao, Campo, Card, Carregando, Selecao, Selo, Vazio } from '../ui/index.jsx'

// =============================================================================
//  CANTINHO DA UNIDADE — o espaço de cada unidade, cuidado pelo conselheiro.
//  Quem vê o quê é decidido no SERVIDOR (cantinho_ver): o membro recebe só o que é dele; outra unidade
//  recebe erro. Aqui só desenhamos o que veio e mostramos os botões de quem pode editar (pode_editar).
//  Mobile-first: cartões empilhados, alvos de 44px, atalhos no topo para pular entre as seções.
// =============================================================================

const SECOES = [
  ['meditacao', '🙏', 'Meditação'], ['mural', '💌', 'Oração'], ['chamada', '📋', 'Chamada'],
  ['ajuda', '🏠', 'Ajuda em casa'], ['reunioes', '📅', 'Reuniões'], ['caixa', '💰', 'Caixa'], ['plano', '🗺️', 'Planejamento'],
]
const PAPEL_ROTULO = { diretoria: 'Diretoria', lider: 'Conselheiro(a)', membro: 'Membro' }
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const horaBR = (iso) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

function Secao({ id, icone, titulo, subtitulo, children, acao }) {
  return (
    <Card as="section" id={`sec-${id}`} aria-labelledby={`tit-${id}`} className="scroll-mt-20">
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

export default function Cantinho() {
  const { unidadeId: daRota } = useParams()
  const [unidades, setUnidades] = useState(null)
  const [escolhida, setEscolhida] = useState(daRota || null)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let vivo = true
    cantinhoMinhasUnidades()
      .then((us) => {
        if (!vivo) return
        setUnidades(us)
        if (!daRota && us.length === 1) setEscolhida(us[0].unidade_id)
      })
      .catch((e) => { if (vivo) { setUnidades([]); setErro(e) } })
    return () => { vivo = false }
  }, [daRota])

  useEffect(() => { if (daRota) setEscolhida(daRota) }, [daRota])

  const recarregar = useCallback(async () => {
    if (!escolhida) return
    try {
      setDados(await cantinhoVer(escolhida))
      setErro(null)
    } catch (e) {
      setErro(e)
      setDados(null)
    }
  }, [escolhida])

  useEffect(() => { setDados(null); recarregar() }, [recarregar])

  if (unidades === null || (escolhida && !dados && !erro)) return <div className="mt-2"><Carregando linhas={4} texto="Abrindo o cantinho" /></div>

  if (erro && !dados) {
    return (
      <Vazio icone="🔒" titulo="Este cantinho é só da unidade">
        Só os membros da unidade, o(a) conselheiro(a) e a diretoria abrem este espaço.
      </Vazio>
    )
  }

  if (!escolhida) {
    if (unidades.length === 0) {
      return (
        <Vazio icone="🏡" titulo="Você ainda não está numa unidade">
          Quando a diretoria colocar você numa unidade, o cantinho dela aparece aqui.
        </Vazio>
      )
    }
    return (
      <div>
        <h1 className="text-2xl font-extrabold text-ink mb-1">🏡 Cantinho das unidades</h1>
        <p className="text-sm text-muted mb-4">Escolha a unidade para abrir o cantinho dela.</p>
        <div className="grid grid-cols-1 gap-2">
          {unidades.map((u) => (
            <button key={u.unidade_id} type="button" onClick={() => setEscolhida(u.unidade_id)}
              className="flex items-center gap-3 min-h-[56px] bg-surface rounded-2xl shadow-soft px-4 text-left">
              <span className="w-3 h-10 rounded-full shrink-0" style={{ backgroundColor: u.cor || '#1e3a8a' }} aria-hidden="true" />
              <span className="font-bold text-ink flex-1">{u.nome}</span>
              <Selo tom={u.papel === 'membro' ? 'neutro' : 'info'}>{PAPEL_ROTULO[u.papel] || u.papel}</Selo>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return <Painel dados={dados} recarregar={recarregar} voltar={!daRota && unidades.length > 1 ? () => { setEscolhida(null); setDados(null) } : null} />
}

function Painel({ dados, recarregar, voltar }) {
  const u = dados.unidade || {}
  const domingo = ehDomingo(dados.hoje)
  const nomes = useMemo(() => Object.fromEntries((dados.membros || []).map((m) => [m.id, m.nome || 'Membro'])), [dados.membros])
  const ctx = { dados, recarregar, nomes, pode: !!dados.pode_editar, unidadeId: u.id }

  return (
    <div className="space-y-4 pb-6">
      <header className="rounded-2xl overflow-hidden shadow-soft text-white" style={{ background: `linear-gradient(135deg, #0b1f4d, ${u.cor || '#1e3a8a'})` }}>
        <div className="p-4 relative">
          <BotaoAjuda topico="cantinho" sobreEscuro className="absolute right-3 top-3" />
          {voltar && <button type="button" onClick={voltar} className="min-h-[44px] -ml-1 mb-1 text-sm font-semibold text-white/85">← Unidades</button>}
          <p className="text-xs uppercase tracking-wider text-amber-300 font-bold">Cantinho da unidade</p>
          <h1 className="text-2xl font-extrabold leading-tight">{u.nome}</h1>
          {u.lema && <p className="text-sm text-white/80 italic">“{u.lema}”</p>}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="bg-white/15 rounded-full px-2.5 py-1 font-semibold">{PAPEL_ROTULO[dados.papel] || dados.papel}</span>
            <span className="bg-white/15 rounded-full px-2.5 py-1">👥 {(dados.membros || []).length} membros</span>
            <span className="bg-white/15 rounded-full px-2.5 py-1">Semana de {diaMes(dados.domingo)}</span>
          </div>
        </div>
        {domingo && (
          <div className="bg-amber-400 text-[#0b1f4d] px-4 py-2 text-sm font-extrabold" data-testid="faixa-domingo">
            ☀️ Hoje é domingo! Semana nova: meditação nova e mural de oração recomeçando.
          </div>
        )}
      </header>

      <nav aria-label="Seções do cantinho" className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {SECOES.filter(([k]) => k !== 'plano' || ctx.pode).map(([k, i, r]) => (
          <a key={k} href={`#sec-${k}`} className="shrink-0 min-h-[44px] inline-flex items-center px-3 rounded-xl bg-surface text-sm font-bold text-muted shadow-soft">
            <span aria-hidden="true">{i}&nbsp;</span>{r}
          </a>
        ))}
      </nav>

      <SecaoMeditacao {...ctx} domingo={domingo} />
      <SecaoMural {...ctx} />
      <SecaoChamada {...ctx} />
      <SecaoAjuda {...ctx} />
      <SecaoReunioes {...ctx} />
      <SecaoCaixa {...ctx} />
      {ctx.pode && <SecaoPlano {...ctx} />}
    </div>
  )
}

// ---------------------------------------------------------------- 3) Meditação
function SecaoMeditacao({ dados, recarregar, pode, unidadeId, domingo }) {
  const m = dados.meditacao
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(m?.texto || '')
  const [ref, setRef] = useState(m?.referencia || '')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setSalvando(true)
    try {
      await cantinhoMeditacaoSalvar(unidadeId, texto, ref)
      setEditando(false)
      avisar.sucesso('Meditação da semana salva 🙏')
      await recarregar()
    } catch (err) { avisar.erro(err, 'Não consegui salvar a meditação.') } finally { setSalvando(false) }
  }

  return (
    <Secao id="meditacao" icone="🙏" titulo="Meditação da semana" subtitulo={`Domingo, ${diaMes(dados.domingo)} — vale a semana toda`}
      acao={pode && !editando ? <Botao variacao="discreto" aoTocar={() => { setTexto(m?.texto || ''); setRef(m?.referencia || ''); setEditando(true) }}>{m ? 'Editar' : 'Escrever'}</Botao> : null}>
      {editando ? (
        <form onSubmit={salvar}>
          <Campo id="med-texto" rotulo="Mensagem ou versículo" linhas={4} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} required />
          <Campo id="med-ref" rotulo="Referência (opcional)" placeholder="Ex.: Salmos 23:1" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
          <div className="flex gap-2"><Botao tipo="submit" carregando={salvando}>Salvar</Botao><Botao variacao="secundario" aoTocar={() => setEditando(false)}>Cancelar</Botao></div>
        </form>
      ) : m ? (
        <blockquote className={`rounded-xl p-4 border-l-4 border-amber-400 ${domingo ? 'bg-amber-50' : 'bg-surface2'}`}>
          <p className="text-ink whitespace-pre-line leading-relaxed">{m.texto}</p>
          {m.referencia && <footer className="text-sm font-bold text-amber-700 mt-2">{m.referencia}</footer>}
        </blockquote>
      ) : (
        <p className="text-sm text-faint">{pode ? 'Escreva a meditação deste domingo para a unidade.' : 'O(a) conselheiro(a) ainda vai escrever a meditação deste domingo.'}</p>
      )}
      {(dados.meditacoes_anteriores || []).length > 0 && (
        <details className="mt-3">
          <summary className="min-h-[44px] flex items-center text-sm font-semibold text-muted cursor-pointer">Meditações anteriores</summary>
          <ul className="space-y-2">
            {dados.meditacoes_anteriores.map((x) => (
              <li key={x.domingo} className="text-sm bg-surface2 rounded-xl p-3">
                <span className="text-xs font-bold text-faint">{diaMes(x.domingo)}</span>
                <p className="text-ink">{x.texto}</p>{x.referencia && <p className="text-xs font-bold text-amber-700">{x.referencia}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Secao>
  )
}

// ---------------------------------------------------------------- 4) Pedidos de oração e agradecimentos
function SecaoMural({ dados, recarregar, pode, unidadeId }) {
  const [tipo, setTipo] = useState('pedido')
  const [texto, setTexto] = useState('')
  const [privado, setPrivado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const lista = dados.mural || []

  async function enviar(e) {
    e.preventDefault()
    if (!texto.trim()) return
    setEnviando(true)
    try {
      await cantinhoMuralEnviar(unidadeId, tipo, texto.trim(), privado)
      setTexto(''); setPrivado(false)
      avisar.sucesso(tipo === 'pedido' ? 'Pedido enviado. Vamos orar juntos 🙏' : 'Agradecimento enviado 💛')
      await recarregar()
    } catch (err) { avisar.erro(err, 'Não consegui enviar. Tente de novo.') } finally { setEnviando(false) }
  }
  async function moderar(item) {
    try { await cantinhoMuralModerar(item.id, !item.oculto); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui moderar.') }
  }
  async function apagar(item) {
    const ok = await avisar.confirmar({ titulo: 'Apagar esta mensagem?', descricao: 'Ela some para todo mundo.', rotulo: 'Apagar' })
    if (!ok) return
    try { await cantinhoMuralApagar(item.id); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui apagar.') }
  }

  return (
    <Secao id="mural" icone="💌" titulo="Pedidos de oração e agradecimentos"
      subtitulo="Só a unidade vê. O mural recomeça todo domingo.">
      <form onSubmit={enviar} className="mb-3">
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-2 mb-2">
          {[['pedido', '🙏 Pedido'], ['agradecimento', '💛 Agradecimento']].map(([v, r]) => (
            <button key={v} type="button" role="radio" aria-checked={tipo === v} onClick={() => setTipo(v)}
              className={`min-h-[44px] rounded-xl text-sm font-bold border-2 ${tipo === v ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted'}`}>{r}</button>
          ))}
        </div>
        <Campo id="mural-texto" rotulo={tipo === 'pedido' ? 'Pelo que vamos orar?' : 'Pelo que você agradece?'} linhas={2} maxLength={280}
          value={texto} onChange={(e) => setTexto(e.target.value)} />
        <label className="flex items-center gap-3 min-h-[44px] text-sm text-ink mb-2">
          <input type="checkbox" className="w-5 h-5" checked={privado} onChange={(e) => setPrivado(e.target.checked)} />
          Só o(a) conselheiro(a) pode ler
        </label>
        <Botao tipo="submit" carregando={enviando} desabilitado={!texto.trim()} className="w-full">Enviar</Botao>
      </form>
      {lista.length === 0 ? <p className="text-sm text-faint">Nenhum pedido nesta semana ainda.</p> : (
        <ul className="space-y-2" data-testid="mural-lista">
          {lista.map((it) => (
            <li key={it.id} className={`rounded-xl p-3 ${it.tipo === 'pedido' ? 'bg-sky-50' : 'bg-amber-50'} ${it.oculto ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2 text-xs font-bold text-muted mb-1">
                <span>{it.tipo === 'pedido' ? '🙏 Pedido' : '💛 Agradecimento'}</span>
                {it.privado && <Selo tom="info">🔒 Só conselheiro</Selo>}
                {it.oculto && <Selo tom="atencao">Escondido</Selo>}
                <span className="ml-auto truncate">{it.meu ? 'Você' : it.autor}</span>
              </div>
              <p className="text-ink text-sm whitespace-pre-line">{it.texto}</p>
              {(pode || it.meu) && (
                <div className="flex gap-2 mt-2">
                  {pode && <Botao variacao="secundario" className="text-xs" aoTocar={() => moderar(it)}>{it.oculto ? 'Mostrar' : 'Esconder'}</Botao>}
                  <Botao variacao="discreto" className="text-xs" aoTocar={() => apagar(it)}>Apagar</Botao>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(dados.mural_historico || []).length > 0 && (
        <details className="mt-3">
          <summary className="min-h-[44px] flex items-center text-sm font-semibold text-muted cursor-pointer">
            {pode ? 'Semanas anteriores (só você e a diretoria veem)' : 'Os seus das semanas anteriores'}
          </summary>
          <ul className="space-y-1.5">
            {dados.mural_historico.map((it) => (
              <li key={it.id} className="text-sm bg-surface2 rounded-xl p-2.5">
                <span className="text-xs font-bold text-faint">{diaMes(it.semana)} · {it.tipo === 'pedido' ? 'Pedido' : 'Agradecimento'} · {it.meu ? 'Você' : it.autor}</span>
                <p className="text-ink">{it.texto}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Secao>
  )
}

// ---------------------------------------------------------------- 1) Presentes/Faltosos + 6) Culto
function SecaoChamada({ dados, recarregar, pode, unidadeId, nomes }) {
  const reunioes = dados.chamada || []
  const resumo = dados.resumo || []
  const [justificando, setJustificando] = useState(null) // { usuario_id, data, motivo }

  async function salvarJustificativa(e) {
    e.preventDefault()
    try {
      await cantinhoJustificar(unidadeId, justificando.usuario_id, justificando.data, justificando.motivo)
      setJustificando(null)
      await recarregar()
    } catch (err) { avisar.erro(err, 'Não consegui justificar a falta.') }
  }

  const totalReunioes = reunioes.length
  const culto = resumo.reduce((s, r) => s + Number(r.culto || 0), 0)
  const presencas = resumo.reduce((s, r) => s + Number(r.reunioes || 0), 0)

  return (
    <Secao id="chamada" icone="📋" titulo={pode ? 'Presentes e faltosos' : 'Minha presença'}
      subtitulo="A chamada é feita nos Apontamentos da reunião"
      acao={pode ? <Botao variacao="contorno" para="/apontamentos" className="text-xs">Fazer chamada</Botao> : null}>
      {totalReunioes === 0 ? <p className="text-sm text-faint">Ainda não há reuniões apontadas.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-surface2 rounded-xl p-3">
              <p className="text-xs text-muted">Faltas (sem justificativa)</p>
              <p className="text-2xl font-extrabold text-ink" data-testid="total-faltas">{resumo.reduce((s, r) => s + Number(r.faltas || 0), 0)}</p>
            </div>
            <div className="bg-surface2 rounded-xl p-3" data-testid="resumo-culto">
              <p className="text-xs text-muted">⛪ Foi ao culto</p>
              <p className="text-2xl font-extrabold text-ink">{culto}<span className="text-sm text-faint font-semibold">/{presencas}</span></p>
            </div>
          </div>
          {pode && resumo.some((r) => r.faltas > 0) && (
            <div className="mb-3">
              <p className="text-xs font-bold text-faint mb-1">MAIS FALTAS (últimas {totalReunioes} reuniões)</p>
              <ul className="space-y-1">
                {[...resumo].filter((r) => r.faltas > 0).sort((a, b) => b.faltas - a.faltas).slice(0, 5).map((r) => (
                  <li key={r.usuario_id} className="flex justify-between text-sm"><span className="text-ink">{nomes[r.usuario_id] || 'Membro'}</span>
                    <span className="font-bold text-rose-600">{r.faltas} falta(s){r.justificadas > 0 ? ` · ${r.justificadas} justif.` : ''}</span></li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-2">
            {reunioes.map((r) => (
              <li key={r.data}>
                <details open={r === reunioes[0]}>
                  <summary className="min-h-[44px] flex items-center justify-between text-sm font-bold text-ink cursor-pointer">
                    <span>Reunião {diaMes(r.data)}</span>
                    <span className="text-xs text-muted font-semibold">
                      {r.itens.filter((i) => i.status === 'presente' || i.status === 'atrasado').length}/{r.itens.length} presentes
                    </span>
                  </summary>
                  <ul className="divide-y divide-line">
                    {r.itens.map((i) => {
                      const st = STATUS_CHAMADA[i.status] || STATUS_CHAMADA.presente
                      return (
                        <li key={i.usuario_id} className="py-2 flex items-center gap-2 text-sm">
                          <span className="flex-1 min-w-0 truncate text-ink">{nomes[i.usuario_id] || 'Você'}{i.igreja ? ' ⛪' : ''}</span>
                          <Selo tom={st.tom}>{st.icone} {st.rotulo}</Selo>
                          {pode && (i.status === 'falta' || i.status === 'justificada') && (
                            <button type="button" className="min-h-[44px] px-2 text-xs font-bold text-brand"
                              onClick={() => setJustificando({ usuario_id: i.usuario_id, data: r.data, motivo: i.motivo || '' })}>
                              {i.status === 'falta' ? 'Justificar' : 'Editar'}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
      {justificando && (
        <form onSubmit={salvarJustificativa} className="mt-3 bg-surface2 rounded-xl p-3">
          <p className="text-sm font-bold text-ink mb-2">Justificar a falta de {nomes[justificando.usuario_id]} ({diaMes(justificando.data)})</p>
          <Campo id="just-motivo" rotulo="Motivo (deixe vazio para tirar a justificativa)" maxLength={200}
            value={justificando.motivo} onChange={(e) => setJustificando({ ...justificando, motivo: e.target.value })} />
          <div className="flex gap-2"><Botao tipo="submit">Salvar</Botao><Botao variacao="secundario" aoTocar={() => setJustificando(null)}>Cancelar</Botao></div>
        </form>
      )}
    </Secao>
  )
}

// ---------------------------------------------------------------- 5) Ajudar os pais
function SecaoAjuda({ dados, recarregar, pode, unidadeId }) {
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState(String(dados.ajuda_pontos ?? 10))
  const semana = dados.domingo
  const daSemana = (dados.ajuda || []).filter((a) => a.semana === semana)
  const minha = daSemana.find((a) => a.usuario_id === dados.eu)
  const desbravadores = (dados.membros || []).filter((m) => m.role === 'desbravador')
  const porPessoa = Object.fromEntries(daSemana.map((a) => [a.usuario_id, a]))
  const souDesbravador = desbravadores.some((m) => m.id === dados.eu)

  async function registrar(e) {
    e.preventDefault()
    try { await cantinhoAjudaRegistrar(unidadeId, descricao); setDescricao(''); avisar.sucesso('Registrado! O(a) conselheiro(a) vai confirmar 💪'); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui registrar (vale 1 por semana).') }
  }
  async function confirmar(uid) {
    try { const r = await cantinhoAjudaConfirmar(unidadeId, uid); avisar.sucesso(`Confirmado: +${r?.pontos ?? 0} pontos`); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui confirmar (vale 1x por semana).') }
  }
  async function desfazer(a) {
    const ok = await avisar.confirmar({ titulo: 'Desfazer esta confirmação?', descricao: 'Os pontos desta semana saem do ranking.', rotulo: 'Desfazer' })
    if (!ok) return
    try { await cantinhoAjudaDesfazer(a.id); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui desfazer.') }
  }
  async function salvarValor(e) {
    e.preventDefault()
    try { await cantinhoConfigDefinir(Number(valor)); avisar.sucesso('Valor salvo para o clube todo'); await recarregar() } catch (err) { avisar.erro(err, 'Valor entre 0 e 50 pontos.') }
  }

  return (
    <Secao id="ajuda" icone="🏠" titulo="Ajudar os pais" subtitulo={`Vale +${dados.ajuda_pontos ?? 10} pontos, 1 vez por semana, confirmado pelo(a) conselheiro(a)`}>
      {souDesbravador && (
        minha ? (
          <Aviso tom={minha.status === 'confirmado' ? 'ok' : 'info'}>
            {minha.status === 'confirmado' ? `Confirmado nesta semana: +${minha.pontos} pontos 🎉` : 'Você já registrou nesta semana. Falta o(a) conselheiro(a) confirmar.'}
          </Aviso>
        ) : (
          <form onSubmit={registrar} className="mb-3">
            <Campo id="ajuda-desc" rotulo="Como você ajudou em casa esta semana?" maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: lavei a louça, arrumei o quarto" />
            <Botao tipo="submit" className="w-full">Registrar minha ajuda</Botao>
          </form>
        )
      )}
      {pode && (
        <ul className="divide-y divide-line" data-testid="ajuda-lista">
          {desbravadores.map((m) => {
            const a = porPessoa[m.id]
            return (
              <li key={m.id} className="py-2 flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-ink truncate">{m.nome}</p>
                  {a?.descricao && <p className="text-xs text-muted truncate">“{a.descricao}”</p>}
                </div>
                {a?.status === 'confirmado' ? (
                  <><Selo tom="ok">+{a.pontos}</Selo><button type="button" className="min-h-[44px] px-2 text-xs font-bold text-muted" onClick={() => desfazer(a)}>Desfazer</button></>
                ) : (
                  <Botao variacao={a ? 'primario' : 'secundario'} className="text-xs" aoTocar={() => confirmar(m.id)}>{a ? 'Confirmar' : 'Ajudou ✓'}</Botao>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!pode && !souDesbravador && <p className="text-sm text-faint">Os desbravadores registram aqui a ajuda em casa da semana.</p>}
      {dados.papel === 'diretoria' && (
        <form onSubmit={salvarValor} className="mt-3 flex items-end gap-2">
          <div className="flex-1"><Campo id="ajuda-valor" rotulo="Pontos por semana (clube todo, 0 a 50)" tipo="number" min={0} max={50} value={valor} onChange={(e) => setValor(e.target.value)} /></div>
          <div className="mb-3"><Botao tipo="submit" variacao="secundario">Salvar</Botao></div>
        </form>
      )}
    </Secao>
  )
}

// ---------------------------------------------------------------- 7) Reuniões da unidade (+ agenda do clube)
function SecaoReunioes({ dados, recarregar, pode, unidadeId }) {
  const [form, setForm] = useState(null)
  async function salvar(e) {
    e.preventDefault()
    try {
      const inicio = new Date(`${form.data}T${form.hora || '09:00'}:00-03:00`).toISOString()
      await cantinhoReuniaoSalvar(unidadeId, { id: form.id, inicio, local: form.local, pauta: form.pauta })
      setForm(null); await recarregar()
    } catch (err) { avisar.erro(err, 'Não consegui salvar a reunião.') }
  }
  async function excluir(r) {
    const ok = await avisar.confirmar({ titulo: 'Tirar esta reunião da agenda?', rotulo: 'Tirar' })
    if (!ok) return
    try { await cantinhoReuniaoExcluir(r.id); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui tirar.') }
  }
  const reunioes = dados.reunioes || []
  const agenda = dados.agenda_clube || []
  return (
    <Secao id="reunioes" icone="📅" titulo="Reuniões da unidade"
      acao={pode && !form ? <Botao variacao="discreto" aoTocar={() => setForm({ data: hojeISO(), hora: '09:00', local: '', pauta: '' })}>+ Nova</Botao> : null}>
      {form && (
        <form onSubmit={salvar} className="bg-surface2 rounded-xl p-3 mb-3">
          <div className="grid grid-cols-2 gap-2">
            <Campo id="reu-data" rotulo="Data" tipo="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} required />
            <Campo id="reu-hora" rotulo="Hora" tipo="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} />
          </div>
          <Campo id="reu-local" rotulo="Local" maxLength={120} value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} />
          <Campo id="reu-pauta" rotulo="Pauta" linhas={2} maxLength={500} value={form.pauta} onChange={(e) => setForm({ ...form, pauta: e.target.value })} />
          <div className="flex gap-2"><Botao tipo="submit">Salvar</Botao><Botao variacao="secundario" aoTocar={() => setForm(null)}>Cancelar</Botao></div>
        </form>
      )}
      {reunioes.length === 0 ? <p className="text-sm text-faint">Nenhuma reunião da unidade marcada.</p> : (
        <ul className="space-y-2">
          {reunioes.map((r) => (
            <li key={r.id} className="bg-surface2 rounded-xl p-3">
              <p className="font-bold text-ink text-sm capitalize">{horaBR(r.inicio)}</p>
              {r.local && <p className="text-xs text-muted">📍 {r.local}</p>}
              {r.pauta && <p className="text-sm text-ink mt-1 whitespace-pre-line">{r.pauta}</p>}
              {pode && <div className="mt-1"><Botao variacao="discreto" className="text-xs" aoTocar={() => excluir(r)}>Tirar</Botao></div>}
            </li>
          ))}
        </ul>
      )}
      {agenda.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-faint mb-1">PRÓXIMOS NA AGENDA DO CLUBE</p>
          <ul className="space-y-1">
            {agenda.map((e) => <li key={e.id} className="text-sm text-ink">📌 {diaMes(e.data)}{e.hora ? ` ${e.hora}` : ''} — {e.titulo}</li>)}
          </ul>
          <Link to="/agenda" className="inline-flex items-center min-h-[44px] text-sm font-bold text-brand">Ver a agenda do clube →</Link>
        </div>
      )}
    </Secao>
  )
}

// ---------------------------------------------------------------- 2) Caixa da unidade
function SecaoCaixa({ dados, recarregar, unidadeId }) {
  const caixa = dados.caixa || { saldo_centavos: 0, lancamentos: [] }
  const pode = !!dados.pode_caixa
  const [form, setForm] = useState(null)
  async function salvar(e) {
    e.preventDefault()
    const valorCentavos = paraCentavos(form.valor)
    if (!valorCentavos) { avisar.info('Informe um valor maior que zero.'); return }
    try {
      await cantinhoCaixaLancar(unidadeId, { data: form.data, descricao: form.descricao, tipo: form.tipo, valorCentavos })
      setForm(null); await recarregar()
    } catch (err) { avisar.erro(err, 'Não consegui lançar no caixa.') }
  }
  async function excluir(l) {
    const ok = await avisar.confirmar({ titulo: 'Apagar este lançamento?', rotulo: 'Apagar' })
    if (!ok) return
    try { await cantinhoCaixaExcluir(l.id); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui apagar.') }
  }
  return (
    <Secao id="caixa" icone="💰" titulo="Caixa da unidade" subtitulo="Só anotação — nenhum pagamento passa por aqui"
      acao={pode && !form ? <Botao variacao="discreto" aoTocar={() => setForm({ tipo: 'entrada', data: hojeISO(), descricao: '', valor: '' })}>+ Lançar</Botao> : null}>
      <div className="rounded-xl p-3 mb-3 bg-[#0b1f4d] text-white">
        <p className="text-xs text-white/70">Saldo</p>
        <p className={`text-2xl font-extrabold ${caixa.saldo_centavos < 0 ? 'text-rose-300' : 'text-amber-300'}`} data-testid="saldo">{formatarReal(caixa.saldo_centavos)}</p>
      </div>
      {form && (
        <form onSubmit={salvar} className="bg-surface2 rounded-xl p-3 mb-3">
          <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-2 mb-2">
            {[['entrada', '⬆️ Entrada'], ['saida', '⬇️ Saída']].map(([v, r]) => (
              <button key={v} type="button" role="radio" aria-checked={form.tipo === v} onClick={() => setForm({ ...form, tipo: v })}
                className={`min-h-[44px] rounded-xl text-sm font-bold border-2 ${form.tipo === v ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted'}`}>{r}</button>
            ))}
          </div>
          <Campo id="cx-desc" rotulo="Descrição" maxLength={120} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} required />
          <div className="grid grid-cols-2 gap-2">
            <Campo id="cx-valor" rotulo="Valor (R$)" inputMode="decimal" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required />
            <Campo id="cx-data" rotulo="Data" tipo="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </div>
          <div className="flex gap-2"><Botao tipo="submit">Lançar</Botao><Botao variacao="secundario" aoTocar={() => setForm(null)}>Cancelar</Botao></div>
        </form>
      )}
      {pode ? (
        (caixa.lancamentos || []).length === 0 ? <p className="text-sm text-faint">Nenhum lançamento ainda.</p> : (
          <ul className="divide-y divide-line">
            {caixa.lancamentos.map((l) => (
              <li key={l.id} className="py-2 flex items-center gap-2 text-sm">
                <span className="text-xs text-faint w-10 shrink-0">{diaMes(l.data)}</span>
                <span className="flex-1 min-w-0 truncate text-ink">{l.descricao}</span>
                <span className={`font-bold ${l.tipo === 'entrada' ? 'text-emerald-700' : 'text-rose-600'}`}>{l.tipo === 'entrada' ? '+' : '−'}{formatarReal(l.valor_centavos)}</span>
                <button type="button" aria-label="Apagar lançamento" className="w-11 h-11 grid place-items-center text-faint" onClick={() => excluir(l)}>✕</button>
              </li>
            ))}
          </ul>
        )
      ) : <p className="text-xs text-faint">Quem lança: o(a) conselheiro(a) e o(a) tesoureiro(a) da unidade.</p>}
    </Secao>
  )
}

// ---------------------------------------------------------------- 8) Planejamento
function SecaoPlano({ dados, recarregar, unidadeId }) {
  const [form, setForm] = useState(null)
  const itens = dados.plano || []
  async function salvar(e) {
    e.preventDefault()
    try { await cantinhoPlanoSalvar(unidadeId, form); setForm(null); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui salvar.') }
  }
  async function mudar(it, status) {
    try { await cantinhoPlanoSalvar(unidadeId, { ...it, status }); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui atualizar.') }
  }
  async function excluir(it) {
    const ok = await avisar.confirmar({ titulo: 'Apagar este item?', rotulo: 'Apagar' })
    if (!ok) return
    try { await cantinhoPlanoExcluir(it.id); await recarregar() } catch (err) { avisar.erro(err, 'Não consegui apagar.') }
  }
  return (
    <Secao id="plano" icone="🗺️" titulo="Planejamento da unidade" subtitulo="Só o(a) conselheiro(a) e a diretoria veem"
      acao={!form ? <Botao variacao="discreto" aoTocar={() => setForm({ titulo: '', detalhe: '', status: 'a_fazer', prazo: '' })}>+ Meta</Botao> : null}>
      {form && (
        <form onSubmit={salvar} className="bg-surface2 rounded-xl p-3 mb-3">
          <Campo id="pl-titulo" rotulo="Meta ou tarefa" maxLength={120} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required />
          <Campo id="pl-detalhe" rotulo="Detalhes" linhas={2} maxLength={500} value={form.detalhe || ''} onChange={(e) => setForm({ ...form, detalhe: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Selecao id="pl-status" rotulo="Status" opcoes={STATUS_PLANO} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} />
            <Campo id="pl-prazo" rotulo="Prazo" tipo="date" value={form.prazo || ''} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
          </div>
          <div className="flex gap-2"><Botao tipo="submit">Salvar</Botao><Botao variacao="secundario" aoTocar={() => setForm(null)}>Cancelar</Botao></div>
        </form>
      )}
      {itens.length === 0 ? <p className="text-sm text-faint">Nenhuma meta ainda. Que tal planejar o próximo acampamento?</p> : (
        <ul className="space-y-2">
          {itens.map((it) => (
            <li key={it.id} className={`rounded-xl p-3 bg-surface2 ${it.status === 'feito' ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-2">
                <p className={`flex-1 font-bold text-sm text-ink ${it.status === 'feito' ? 'line-through' : ''}`}>{it.titulo}</p>
                {it.prazo && <Selo tom="neutro">até {diaMes(it.prazo)}</Selo>}
              </div>
              {it.detalhe && <p className="text-xs text-muted mt-0.5">{it.detalhe}</p>}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {STATUS_PLANO.map(([v, r]) => (
                  <button key={v} type="button" aria-pressed={it.status === v} onClick={() => mudar(it, v)}
                    className={`min-h-[44px] px-3 rounded-xl text-xs font-bold ${it.status === v ? 'bg-[#0b1f4d] text-amber-300' : 'bg-surface text-muted'}`}>{r}</button>
                ))}
                <button type="button" className="min-h-[44px] px-3 text-xs font-bold text-muted" onClick={() => setForm({ ...it })}>Editar</button>
                <button type="button" className="min-h-[44px] px-3 text-xs font-bold text-rose-600" onClick={() => excluir(it)}>Apagar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  )
}
