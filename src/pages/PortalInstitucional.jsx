import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useEscopo } from '../context/Escopo.jsx'
import { carregarInvestidurasDoEscopo, carregarPainelAnalitico, carregarVisitasDoEscopo } from '../services/institucional.js'
import {
  CartaoClube, ClubeDetalhe, VisitasDoEscopo, Numero, Secao, Avatar, TabelaDeClasses,
  TIPO_UNIDADE, fmtDia, fmtQuando, lugarDoClube, n, pct, semUso,
} from './PainelDoEscopo.jsx'
import { EsqueletoTela } from '../ui/carregamento.jsx'
import { EstrelasFixas, mediasDeAvaliacao } from '../components/AvaliacaoVisita.jsx'
import { Abas, Aviso, Card, CardAcao, Carregando, Selo, Vazio, mensagemDeErro } from '../ui/index.jsx'

// =============================================================================
//  Portal da coordenação (distrito/região/campo). Mesmo visual das telas do clube (src/ui).
//  Mostra só o que o escopo justifica: os clubes abaixo (agregado), a página de cada clube na visão
//  da coordenação, as visitas e o andamento das classes. Estar acima na hierarquia não abre chat,
//  fotos, mensagens, financeiro, evidências nem dados de responsáveis — e o servidor nem devolve isso.
//  Plano/assinatura do clube também NÃO são assunto da coordenação (migration 300 tirou do servidor).
// =============================================================================
const TIPO_ROTULO = { distrito: 'Distrito', regiao: 'Região', campo: 'Associação / Missão', uniao: 'União', divisao: 'Divisão' }
const PAPEL_ROTULO = {
  coordenador_distrital: 'Coordenação distrital', coordenador_regional: 'Coordenação regional',
  coordenador_geral: 'Coordenação geral', diretor_mda: 'Direção do Ministério',
  secretario_md: 'Secretaria do MD', associado_md: 'Associado(a) do MD', departamental_jovem: 'Departamental',
  coordenador_uniao: 'Coordenação da união', diretor_uniao: 'Direção da união', coordenador_divisao: 'Coordenação da divisão',
}

export default function PortalInstitucional() {
  const { carregando, erro, escopos, escopo, temEscopo, capacidades, trocarEscopo, recarregar } = useEscopo()
  // ao abrir o portal, relê os escopos (vínculo criado agora por convite aparece sem sair e entrar)
  useEffect(() => { recarregar?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [aba, setAba] = useState('geral')
  const [clubeAberto, setClubeAberto] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [painel, setPainel] = useState(null)
  const [erroPainel, setErroPainel] = useState(null)
  const [investiduras, setInvestiduras] = useState(null)
  const [visitas, setVisitas] = useState(null)
  const [versao, setVersao] = useState(0)
  const verPainel = !!capacidades?.ver_painel
  const escopoId = escopo?.escopo_id

  useEffect(() => { setFiltro(''); setClubeAberto(null) }, [escopoId])

  useEffect(() => {
    if (!escopo) { setInvestiduras([]); return undefined }
    let vivo = true
    carregarInvestidurasDoEscopo().then((x) => { if (vivo) setInvestiduras(x) }).catch(() => { if (vivo) setInvestiduras([]) })
    return () => { vivo = false }
  }, [escopo, versao])

  useEffect(() => {
    if (!escopo || !verPainel) return undefined
    let vivo = true
    setPainel(null); setErroPainel(null)
    carregarPainelAnalitico(filtro || null)
      .then((d) => { if (vivo) setPainel(d) })
      .catch((e) => { if (vivo) setErroPainel(e) })
    carregarVisitasDoEscopo().then((x) => { if (vivo) setVisitas(x) }).catch(() => { if (vivo) setVisitas([]) })
    return () => { vivo = false }
  }, [escopo, verPainel, filtro, versao])

  const mudou = useCallback(() => setVersao((x) => x + 1), [])
  // botão 🔄 da moldura (LayoutConta): relê painel, visitas e investiduras
  useEffect(() => { window.addEventListener('conta:atualizar', mudou); return () => window.removeEventListener('conta:atualizar', mudou) }, [mudou])
  const abrirClube = (c) => { setClubeAberto(c); setAba('clubes'); document.documentElement.scrollTop = 0 }

  if (carregando) return <div className="max-w-2xl mx-auto px-4 py-6"><EsqueletoTela cartoes={3} /></div>

  if (erro) {
    return (
      <div className="max-w-md mx-auto px-4 mt-8">
        <Aviso tom="erro" titulo="Não deu pra carregar seus vínculos">Confira a internet e tente de novo.</Aviso>
      </div>
    )
  }

  if (!temEscopo) {
    return (
      <div className="max-w-md mx-auto px-4 mt-8">
        <Vazio icone="🏛️" titulo="Sem vínculo institucional"
          acao={<Link to="/" className="inline-block text-sm font-semibold text-brand underline min-h-[44px] leading-[44px]">Voltar para o meu clube</Link>}>
          Este portal é para coordenação distrital, regional, de campo, união ou divisão.
        </Vazio>
      </div>
    )
  }

  const clubes = painel?.clubes || []
  const abas = [
    { chave: 'geral', icone: '🏠', rotulo: 'Visão geral' },
    ...(verPainel ? [
      { chave: 'clubes', icone: '🏕️', rotulo: 'Clubes', contador: clubes.length },
      { chave: 'visitas', icone: '📅', rotulo: 'Visitas' },
      { chave: 'classes', icone: '🎓', rotulo: 'Classes' },
    ] : []),
  ]

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-24">
      <Topo escopos={escopos} escopo={escopo} onTrocar={trocarEscopo} />
      <Abas abas={abas} ativa={aba} aoTrocar={(k) => { setAba(k); setClubeAberto(null) }} rotulo="Seções do portal" />

      {verPainel && (painel?.filtros?.length > 0) && !clubeAberto && aba !== 'visitas' && (
        <label className="block mb-3">
          <span className="text-xs font-semibold text-muted">Filtrar por região/distrito</span>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink">
            <option value="">Todo o escopo</option>
            {painel.filtros.map((f) => <option key={f.id} value={f.id}>{TIPO_UNIDADE[f.tipo] || f.tipo} — {f.nome}</option>)}
          </select>
        </label>
      )}

      {erroPainel && <Aviso tom="erro" titulo="Não deu pra carregar os clubes">{mensagemDeErro(erroPainel)}</Aviso>}

      {aba === 'geral' && (
        <VisaoGeral painel={painel} verPainel={verPainel} visitas={visitas} investiduras={investiduras}
          aoAbrirClube={abrirClube} aoVerVisitas={() => setAba('visitas')} />
      )}

      {aba === 'clubes' && verPainel && (
        clubeAberto ? (
          <ClubeDetalhe clubId={clubeAberto.club_id} resumo={clubeAberto} aoVoltar={() => setClubeAberto(null)} aoMudar={mudou} />
        ) : !painel ? <Carregando linhas={3} texto="Carregando os clubes" /> : clubes.length === 0 ? (
          <Vazio icone="🏕️" titulo="Nenhum clube por aqui ainda">Quando um clube for ligado a este escopo, ele aparece aqui sozinho.</Vazio>
        ) : (
          <ul className="space-y-2">{clubes.map((c) => <CartaoClube key={c.club_id} c={c} aoAbrir={abrirClube} />)}</ul>
        )
      )}

      {aba === 'visitas' && verPainel && <VisitasDoEscopo escopoId={escopoId} versao={versao} aoMudar={mudou} />}

      {aba === 'classes' && verPainel && <AbaClasses painel={painel} investiduras={investiduras} aoAbrirClube={abrirClube} />}

      <p className="text-xs text-faint mt-6 leading-snug">
        Este portal mostra apenas números gerais dos clubes e o que exige a sua decisão. Conversas, fotos,
        mensagens, mensalidades, evidências dos requisitos e dados de responsáveis pertencem a cada clube e
        não são acessíveis aqui.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- topo (mesmo cartão-herói do app)
function Topo({ escopos, escopo, onTrocar }) {
  return (
    <header className="mb-4 rounded-3xl bg-gradient-to-br from-brand to-brand2 p-5 shadow-glow" style={{ color: 'var(--marca-1-texto, #fff)' }}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-90">Portal da coordenação</p>
      <h1 className="text-2xl font-extrabold leading-tight mt-0.5">{escopo?.nome || 'Escolha um escopo'}</h1>
      {escopo && <p className="text-sm opacity-90">{TIPO_ROTULO[escopo.tipo] || escopo.tipo} · {PAPEL_ROTULO[escopo.papel] || escopo.papel}</p>}
      {escopos.length > 1 && (
        <label className="block mt-3">
          <span className="text-xs font-semibold opacity-90">Escopo em uso</span>
          <select value={escopo?.escopo_id || ''} onChange={(e) => onTrocar(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-white/30 bg-surface px-3 text-sm font-semibold text-ink">
            <option value="" disabled>Escolha um escopo…</option>
            {escopos.map((e) => <option key={e.escopo_id} value={e.escopo_id}>{e.nome} — {TIPO_ROTULO[e.tipo] || e.tipo}</option>)}
          </select>
        </label>
      )}
    </header>
  )
}

// ---------------------------------------------------------------- visão geral
function VisaoGeral({ painel, verPainel, visitas, investiduras, aoAbrirClube, aoVerVisitas }) {
  const clubes = useMemo(() => painel?.clubes || [], [painel])
  const t = painel?.totais || {}
  const semAtividade = useMemo(() => clubes.filter(semUso), [clubes])
  const acumuladas = useMemo(() => clubes.filter((c) => n(c.avaliacoes_pendentes) >= 10)
    .sort((a, b) => n(b.avaliacoes_pendentes) - n(a.avaliacoes_pendentes)), [clubes])
  const proximas = (visitas || []).filter((v) => v.status === 'agendada' || v.status === 'confirmada').slice(0, 3)
  const medias = useMemo(() => mediasDeAvaliacao(visitas), [visitas])

  return (
    <>
      <Pendencias investiduras={investiduras} />
      {!verPainel ? (
        <p className="text-sm text-faint mb-5">Seu papel neste escopo não inclui o painel dos clubes.</p>
      ) : !painel ? <Carregando linhas={3} texto="Somando os números dos clubes" /> : (
        <>
          <dl className="grid grid-cols-2 gap-2 mb-3" data-testid="painel-totais">
            <Numero icone="🏕️" rotulo="Clubes" valor={n(t.clubes)} />
            <Numero icone="👥" rotulo="Membros ativos" valor={n(t.membros)} />
            <Numero icone="✅" rotulo="Presença média" valor={pct(t.presenca_media_pct)} detalhe="últimos 30 dias" />
            <Numero icone="📱" rotulo="Usaram em 30 dias" valor={n(t.ativos_30d)} />
            <Numero icone="📝" rotulo="Avaliações pendentes" valor={n(t.avaliacoes_pendentes)} alerta={n(t.avaliacoes_pendentes) > 0} />
            <Numero icone="⏳" rotulo="Cadastros aguardando" valor={n(t.cadastros_pendentes)} alerta={n(t.cadastros_pendentes) > 0} />
          </dl>

          <Secao id="destaques" icone="🔎" titulo="Precisa de atenção">
            {semAtividade.length === 0 && acumuladas.length === 0 ? (
              <p className="text-sm text-faint">Tudo em dia: nenhum clube parado nem com avaliações acumuladas.</p>
            ) : (
              <ul className="space-y-2">
                {semAtividade.map((c) => (
                  <Destaque key={`s-${c.club_id}`} c={c} aoAbrir={aoAbrirClube}
                    texto={c.atividade?.ultimo_uso ? `Sem atividade há ${n(c.atividade?.dias_sem_uso)} dias` : 'Ainda sem atividade no app'} tom="perigo" />
                ))}
                {acumuladas.map((c) => (
                  <Destaque key={`a-${c.club_id}`} c={c} aoAbrir={aoAbrirClube} texto={`${n(c.avaliacoes_pendentes)} avaliações acumuladas`} tom="atencao" />
                ))}
              </ul>
            )}
          </Secao>

          <Secao id="proximas" icone="📅" titulo="Próximas visitas"
            acao={<button type="button" onClick={aoVerVisitas} className="min-h-[44px] px-2 text-sm font-bold text-brand">Ver todas</button>}>
            {visitas === null ? <Carregando linhas={1} texto="Carregando visitas" />
              : proximas.length === 0 ? <p className="text-sm text-faint">Nenhuma visita marcada. Abra um clube para agendar.</p> : (
                <ul className="space-y-2">
                  {proximas.map((v) => (
                    <li key={v.id} className="rounded-xl bg-surface2 p-3">
                      <div className="text-sm font-bold text-ink">{v.clube}</div>
                      <div className="text-xs text-muted">{fmtQuando(v.agendada_para)} · {v.objetivo}</div>
                    </li>
                  ))}
                </ul>
              )}
          </Secao>

          {medias.length > 0 && (
            <Secao id="avaliacoes-visitas" icone="⭐" titulo="Avaliações das visitas" subtitulo="Média da nota geral dada pelos clubes">
              <ul className="space-y-2" data-testid="medias-avaliacao">
                {medias.map((g) => (
                  <li key={g.chave} className="rounded-xl bg-surface2 p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-ink truncate">{g.nome || g.unidade}</div>
                      <div className="text-xs text-muted truncate">{g.nome ? `${g.unidade} · ` : ''}{g.total} {g.total === 1 ? 'avaliação' : 'avaliações'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-extrabold text-ink">{g.media.toFixed(1).replace('.', ',')}</div>
                      <EstrelasFixas nota={g.media} tamanho="text-xs" />
                    </div>
                  </li>
                ))}
              </ul>
            </Secao>
          )}

          <Secao id="investiduras-mes" icone="🏅" titulo="Investiduras">
            <dl className="grid grid-cols-2 gap-2">
              <Numero rotulo="Realizadas neste mês" valor={n(t.investiduras_mes)} />
              <Numero rotulo="Previstas (aptos)" valor={n(t.investiduras_previstas)} />
            </dl>
          </Secao>
        </>
      )}
    </>
  )
}

function Destaque({ c, texto, tom, aoAbrir }) {
  return (
    <li>
      <CardAcao aoTocar={() => aoAbrir(c)} className="!shadow-none !bg-surface2 !p-3">
        <div className="flex items-center gap-3">
          <Avatar clube={c} tamanho="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-ink truncate">{c.nome}</div>
            {lugarDoClube(c) && <div className="text-xs text-faint truncate">{lugarDoClube(c)}</div>}
          </div>
          <Selo tom={tom}>{texto}</Selo>
        </div>
      </CardAcao>
    </li>
  )
}

function Pendencias({ investiduras }) {
  return (
    <Secao id="pendencias" icone="📌" titulo="O que depende de você">
      {investiduras === null ? <Carregando linhas={1} texto="Conferindo pendências" /> : investiduras.length === 0 ? (
        <>
          <p className="font-semibold text-ink text-sm">✅ Nada aguarda a sua decisão</p>
          <p className="text-xs text-faint mt-1 leading-snug">
            As Classes Regulares (Amigo a Guia) são revisadas e investidas pelo próprio clube — não há
            etapa distrital ou regional nesse processo. Se um processo passar a exigir a sua aprovação,
            ele aparece aqui.
          </p>
        </>
      ) : (
        <ul className="space-y-2">
          {investiduras.map((i) => (
            <li key={i.member_class_id} className="rounded-xl bg-surface2 p-3">
              <div className="font-bold text-ink text-sm">{i.pessoa_nome}</div>
              <div className="text-xs text-muted">{i.classe_nome} · {i.clube_nome}</div>
              <div className="text-xs text-amber-800 mt-1">⏳ Aguardando: {i.etapa?.nome} · desde {fmtDia(i.aguardando_desde)}</div>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  )
}

// ---------------------------------------------------------------- classes / investiduras
function AbaClasses({ painel, investiduras, aoAbrirClube }) {
  const clubes = useMemo(() => painel?.clubes || [], [painel])
  const somadas = useMemo(() => {
    const mapa = new Map()
    clubes.forEach((c) => (c.classes?.por_classe || []).forEach((k) => {
      const x = mapa.get(k.classe) || { classe: k.classe, em_andamento: 0, concluidas: 0, investidas: 0 }
      x.em_andamento += n(k.em_andamento); x.concluidas += n(k.concluidas); x.investidas += n(k.investidas)
      mapa.set(k.classe, x)
    }))
    return [...mapa.values()]
  }, [clubes])
  if (!painel) return <Carregando linhas={3} texto="Somando as classes" />
  const t = painel.totais || {}
  return (
    <>
      <dl className="grid grid-cols-3 gap-2 mb-3">
        <Numero rotulo="Em andamento" valor={n(t.classes_em_andamento)} />
        <Numero rotulo="Concluídas" valor={n(t.classes_concluidas)} />
        <Numero rotulo="Investidas" valor={n(t.classes_investidas)} />
      </dl>
      <Secao id="classes-escopo" icone="🎓" titulo="Por classe" subtitulo="Soma de todos os clubes do escopo">
        <TabelaDeClasses classes={somadas} />
      </Secao>
      <Secao id="investiduras-clubes" icone="🏅" titulo="Investiduras por clube">
        {clubes.length === 0 ? <p className="text-sm text-faint">Nenhum clube no escopo.</p> : (
          <ul className="space-y-2">
            {clubes.map((c) => (
              <li key={c.club_id}>
                <CardAcao aoTocar={() => aoAbrirClube(c)} className="!shadow-none !bg-surface2 !p-3">
                  <div className="flex items-center gap-3">
                    <Avatar clube={c} tamanho="sm" />
                    <div className="min-w-0 flex-1 text-sm font-bold text-ink truncate">{c.nome}</div>
                    <span className="text-xs text-muted shrink-0">{n(c.investiduras?.previstas)} previstas · {n(c.investiduras?.realizadas_mes)} no mês</span>
                  </div>
                </CardAcao>
              </li>
            ))}
          </ul>
        )}
      </Secao>
      {investiduras?.length > 0 && <Pendencias investiduras={investiduras} />}
      <Card className="text-xs text-faint">Presença, classes e investiduras são contadas pelos registros do próprio clube; o portal não mostra nomes.</Card>
    </>
  )
}
