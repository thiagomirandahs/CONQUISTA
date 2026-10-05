import ConclusaoReconhecida from '../components/classes/ConclusaoReconhecida.jsx'
import { corDaClasse, ehClasseAvancada } from '../lib/corDaClasse.js'
import { hrefExterno } from '../lib/urlSegura.js'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/Auth.jsx'
import EmblemaDaClasse from '../components/EmblemaDaClasse.jsx'
import {
  carregarMinhaClasse, carregarMinhasClasses, carregarClassesDisponiveis, carregarClassesConcluidasAnteriormente, iniciarClasse,
  salvarRequisito, enviarRequisito, escolherOpcoesRequisito, carregarOrigemRequisito, emitirDocumento,
  carregarHistoricoRequisito, cancelarClasse, carregarHistoricoDoCartao,
  carregarFormulariosDaClasse, carregarFormularioRequisito, salvarRelatorioRequisito, subirAnexoDeRelatorio, salvarRelatoRequisito,
} from '../lib/dados.js'
import FormularioRelatorio from '../components/relatorio/FormularioRelatorio.jsx'
import RelatoComplementar from '../components/relatorio/RelatoComplementar.jsx'
import RelatoDoMembro from '../components/relatorio/RelatoDoMembro.jsx'
import { temRelato } from '../lib/relatorio/relato.js'
import HistoricoTentativas from '../components/relatorio/HistoricoTentativas.jsx'
import AvisoCopiaDeSeguranca from '../components/relatorio/AvisoCopiaDeSeguranca.jsx'
import { chaveLocalDe } from '../lib/relatorio/rascunhoLocal.js'
import LinhaDoTempoInvestidura from '../components/LinhaDoTempoInvestidura.jsx'
import { etapaAtual, linhaDoHistorico, rotuloDaEtapa } from '../lib/fluxoInvestidura.js'
import Comprovacao from '../components/Comprovacao.jsx'
import HistoricoDeTentativas from '../components/HistoricoDeTentativas.jsx'
import { vitoria as festa } from '../lib/juice.js'
import { mensagemDeErro, Botao, Aviso, Folha, Carregando, ZonaUpload, MenuAcoes, BotaoVoltar } from '../ui/index.jsx'
import { useRascunho } from '../lib/rascunhos.js'
import { avisar } from '../ui/avisos.jsx'
import { EsqueletoTela } from '../ui/carregamento.jsx'
import BotaoAjuda from '../components/BotaoAjuda.jsx'
import TourDaArea from '../components/TourDaArea.jsx'
import OuvirLivro from '../components/OuvirLivro.jsx'
import { audiolivros } from '../services/audiolivros.js'
import { livroDoRequisito } from '../lib/audiolivros.js'
import { termoDoRequisito } from '../lib/catalogoEspecialidades.js'
import { Link, useNavigate } from 'react-router-dom'
import { DocumentoDaIdade } from '../components/DocumentoDaIdade.jsx'
import { documentosDaMinhaClasse } from '../services/documentoIdade.js'
import StatusRequisito from '../components/jornada/StatusRequisito.jsx'
import BarraProgresso from '../components/jornada/BarraProgresso.jsx'
import { statusDaJornada, contagens, progressoDaSecao, secaoTemPendencia, proximoRequisito } from '../lib/requisitos/jornada.js'
import { tipoDoRequisito, soConfirmacao, TIPOS } from '../lib/requisitos/tipos.js'
import CardLivroDaClasse from '../components/leitura/CardLivroDaClasse.jsx'

// Tudo que a tela mostra vem do servidor (minha_classe): seções, requisitos, regras (escolha/conteúdo
// dinâmico), bloqueios e status. A tela NÃO interpreta texto de requisito nem decide regra — só apresenta.
// Jornada (fase 7): a situação de cada requisito é ícone + texto (<StatusRequisito>, nunca só cor); um
// botão desabilitado sempre diz o motivo. A lógica de `situacaoDoRequisito` não mudou.
const ROTULO_PELO_HISTORICO = 'Cumprido pelo seu histórico'

// Situação apresentada de um requisito = status operacional + o que o servidor declarou (bloqueios,
// escolha cumprida pelo histórico). Exportada pra teste.
export function situacaoDoRequisito(r) {
  if (['aprovado', 'aguardando_avaliacao', 'correcao_solicitada'].includes(r.status)) return r.status
  if ((r.bloqueios || []).length > 0) return 'bloqueado'
  if (r.escolha && r.escolha.satisfeitas_automaticamente >= r.escolha.n_minimo) return 'pronto_pelo_historico'
  return r.status === 'em_andamento' ? 'em_andamento' : 'nao_iniciado'
}

// Datas SEM hora (vigente_desde, publicado_em: "2018-01-01") são calendário, não instante — parsear como
// UTC e formatar no fuso local mostrava "31/12/2017". Datas com hora (timestamps) seguem o caminho normal.
// os enums da versão curricular em português (a auditoria de UX achou os dois crus na tela)
const ORIGEM_ROTULO = { oficial: 'oficial', adaptado: 'adaptado pelo clube', rascunho: 'rascunho' }
const VERSAO_ROTULO = { publicado: 'em vigor', arquivado: 'arquivada', rascunho: 'rascunho' }

// Selo da Classe Avançada (manifesto 2026.4): mesma cor da regular pareada, identificada por texto (nunca só cor).
export function SeloAvancada({ cor, sobreCor = false }) {
  return (
    <span data-testid="selo-avancada"
      className="inline-block text-xs font-extrabold uppercase tracking-wide rounded-full px-2 py-0.5 border-2 align-middle"
      style={sobreCor
        ? { background: cor?.texto || '#fff', color: cor?.escuro || '#1e293b', borderColor: cor?.texto || '#fff' }
        : { background: cor?.claro || '#f1f5f9', color: cor?.escuro || '#334155', borderColor: cor?.hex || '#94a3b8' }}>
      ★ Avançada
    </span>
  )
}

export const fmtData = (iso) => {
  if (!iso) return ''
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (so) return `${so[3]}/${so[2]}/${so[1]}`
  return new Date(iso).toLocaleDateString('pt-BR')
}

// Complementar e silencioso: banco sem a 519, função ausente ou falha = nada a mostrar.
async function buscarConcluidasAntes() {
  try {
    const r = await Promise.resolve().then(() => carregarClassesConcluidasAnteriormente())
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

export default function MinhaClasse() {
  const { profile } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [minha, setMinha] = useState(null)
  const [minhas, setMinhas] = useState([])
  const [selecionada, setSelecionada] = useState(null) // member_class_id da aba aberta (null = o servidor escolhe)
  const [mostrarOutras, setMostrarOutras] = useState(false)
  const [disponiveis, setDisponiveis] = useState([])
  const [concluidasAntes, setConcluidasAntes] = useState([]) // concluídas em outros clubes (519); falha = []
  const [formularios, setFormularios] = useState({}) // requirement_id → formulário (uma chamada por carga)
  const [erro, setErro] = useState('')

  const recarregar = useCallback(async (idAba) => {
    setErro('')
    try {
      // a lista de abas é complementar: servidor antigo (sem minhas_classes) continua funcionando com uma classe só
      const [m, lista] = await Promise.all([
        carregarMinhaClasse(idAba),
        carregarMinhasClasses().catch(() => []),
      ])
      // formulários da classe inteira numa chamada só; falha (servidor antigo/rede) = UI antiga, nunca quebra
      const forms = m?.member_class?.id
        ? await Promise.resolve().then(() => carregarFormulariosDaClasse(m.member_class.id)).catch(() => ({}))
        : {}
      setFormularios(forms && typeof forms === 'object' ? forms : {})
      setMinha(m)
      setMinhas(lista || [])
      if (!m) {
        setDisponiveis(await carregarClassesDisponiveis())
        setConcluidasAntes(await buscarConcluidasAntes())
      }
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não consegui carregar a sua classe.'))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { recarregar(null) }, [recarregar])

  async function trocarAba(id) {
    setSelecionada(id)
    setMostrarOutras(false)
    await recarregar(id)
  }

  async function abrirOutras() {
    const abrir = !mostrarOutras
    setMostrarOutras(abrir)
    if (abrir) {
      try { setDisponiveis(await carregarClassesDisponiveis()) } catch (e) { avisar.erro(e) }
      setConcluidasAntes(await buscarConcluidasAntes())
    }
  }

  async function iniciar(classId) {
    try {
      const r = await iniciarClasse(classId)
      setMostrarOutras(false)
      const novoId = r?.member_class_id || null
      setSelecionada(novoId)
      await recarregar(novoId)
    } catch (e) {
      avisar.erro(e)
    }
  }

  if (carregando) return <EsqueletoTela cabecalho={false} cartoes={2} />

  const idAberta = minha?.member_class?.id

  return (
    <div>
      <div className="mb-1"><BotaoVoltar para="/jornada" rotulo="a Jornada" /></div>
      <TourDaArea id="classes" uid={profile?.id} />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold text-ink">🎖️ Minha Classe</h2>
          <p className="text-sm text-muted">Seu progresso na classe, requisito por requisito</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to="/catalogo-especialidades" aria-label="Especialidades e mestrados" data-testid="abrir-catalogo"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-surface2 px-3 text-sm font-bold text-ink"><span aria-hidden="true">📚</span> Especialidades</Link>
          <BotaoAjuda topico="minha-classe" />
        </div>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {/* As abas de classe têm emblema, cor da classe e percentual — o `Abas` do design system não tem
          esses slots, então a AbasDeClasse continua própria (mesmos alvos de 44px+ e role="tablist"). */}
      {minha && (
        <AbasDeClasse minhas={minhas} idAberta={idAberta} onTrocar={trocarAba} mostrarOutras={mostrarOutras} onOutras={abrirOutras} />
      )}
      {minha && mostrarOutras && (
        <div className="mb-4" data-testid="outras-classes">
          <ListaDisponiveis disponiveis={disponiveis} onIniciar={iniciar} concluidasAnteriormente={concluidasAntes} />
        </div>
      )}

      {!minha ? (
        <ListaDisponiveis disponiveis={disponiveis} onIniciar={iniciar} concluidasAnteriormente={concluidasAntes} />
      ) : (
        <>
          <Progresso key={idAberta} dados={minha} formularios={formularios} userId={profile?.id} onMudou={() => recarregar(selecionada)} />
          {minha.member_class?.status === 'em_andamento' && (
            <CancelarClasse key={`cancelar-${idAberta}`} memberClassId={idAberta} nome={minha.classe?.nome}
              onCancelada={async () => { setSelecionada(null); setMostrarOutras(false); await recarregar(null) }} />
          )}
        </>
      )}
    </div>
  )
}

// Cancelar a própria matrícula (só em andamento — o servidor recusa concluída/investida). Confirmação
// em dois toques, dizendo o que acontece: nada é apagado e dá para recomeçar de onde parou.
export function CancelarClasse({ memberClassId, nome, onCancelada }) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  async function cancelar() {
    setOcupado(true); setErro('')
    try {
      await cancelarClasse(memberClassId)
      await onCancelada?.()
    } catch (e) {
      setErro(mensagemDeErro(e))
      setOcupado(false)
    }
  }
  if (!confirmando) {
    return (
      <div className="mt-6 text-center">
        <button type="button" onClick={() => setConfirmando(true)} data-testid="cancelar-classe"
          className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-muted underline">
          Cancelar esta classe
        </button>
      </div>
    )
  }
  return (
    <div className="mt-6 bg-surface rounded-2xl shadow-soft p-4 border border-line" data-testid="confirmar-cancelar-classe">
      <p className="font-bold text-ink">Cancelar a classe {nome}?</p>
      <p className="text-sm text-muted mt-1">
        O progresso fica guardado no histórico. Se quiser, você pode iniciar esta classe de novo depois e continuar de onde parou.
      </p>
      {erro && <p role="alert" className="text-sm text-red-700 mt-2">{erro}</p>}
      <div className="flex gap-2 mt-3">
        <Botao variacao="secundario" className="flex-1" aoTocar={() => { setConfirmando(false); setErro('') }} desabilitado={ocupado}>Voltar</Botao>
        <Botao variacao="perigo" className="flex-1" aoTocar={cancelar} carregando={ocupado} data-testid="confirmar-cancelar">
          Sim, cancelar
        </Botao>
      </div>
    </div>
  )
}

// Status da matrícula que já não é "em andamento": a pessoa terminou os requisitos (mesmo que a investidura
// ainda dependa da liderança). O servidor decide o status; aqui só agrupamos para mostrar.
const STATUS_CONCLUIDA = ['requisitos_concluidos', 'aguardando_revisao', 'apto_investidura', 'investida', 'concluida']
export const estaConcluida = (c) => STATUS_CONCLUIDA.includes(c?.status)

// Abas grandes (uma por classe da pessoa no clube) + "Iniciar outra classe". Rola na horizontal no
// celular; cada aba tem o emblema, o nome e a % — e a aberta fica na cor dela, com contorno forte.
// As classes em andamento vêm primeiro; as concluídas depois, com "✓ Concluída" (sem ocupar mais espaço).
function AbasDeClasse({ minhas, idAberta, onTrocar, mostrarOutras, onOutras }) {
  const andamento = minhas.filter((c) => !estaConcluida(c))
  const concluidas = minhas.filter(estaConcluida)
  const aba = (c) => {
    const cor = corDaClasse(c.nome)
    const aberta = c.member_class_id === idAberta
    const concluida = estaConcluida(c)
    return (
      <button key={c.member_class_id} type="button" role="tab" aria-selected={aberta} data-testid="aba-classe"
        data-concluida={concluida ? 'true' : 'false'}
        onClick={() => !aberta && onTrocar(c.member_class_id)}
        className={`shrink-0 min-h-[64px] min-w-[132px] flex items-center gap-2 rounded-2xl px-3 py-2 text-left shadow-soft border-4 transition active:scale-[0.98] ${aberta ? '' : 'bg-surface'}`}
        style={aberta
          ? { background: cor?.hex || '#334155', color: cor?.texto || '#fff', borderColor: cor?.escuro || '#1e293b' }
          : { borderColor: cor?.hex || 'transparent' }}>
        <EmblemaDaClasse nome={c.nome} tamanho={32} />
        <span className="min-w-0">
          <span className={`block font-extrabold text-base leading-tight ${aberta ? '' : 'text-ink'}`}>{c.nome}</span>
          {ehClasseAvancada(c.nome) && <span className="block text-xs font-extrabold uppercase tracking-wide" style={aberta ? undefined : { color: cor?.escuro }}>★ Avançada</span>}
          <span className={`block text-sm font-semibold ${aberta ? '' : 'text-muted'}`}>
            {c.status === 'investida' ? '🏅 Investido' : concluida ? '✓ Concluída' : `${c.percentual ?? 0}%`}
          </span>
        </span>
      </button>
    )
  }
  const grupo = (titulo, lista) => lista.length > 0 && (
    <div role="presentation" className="flex shrink-0 flex-col gap-1">
      <span aria-hidden="true" data-testid="rotulo-grupo" className="text-xs font-bold uppercase tracking-wide text-faint">{titulo}</span>
      <div role="presentation" className="flex gap-2">{lista.map(aba)}</div>
    </div>
  )
  return (
    <div className="mb-4 -mx-1 flex items-end gap-3 overflow-x-auto px-1 pb-2" role="tablist" aria-label="Minhas classes">
      {grupo('Em andamento', andamento)}
      {grupo('Concluídas', concluidas)}
      <button type="button" onClick={onOutras} aria-expanded={mostrarOutras} data-testid="iniciar-outra"
        className="shrink-0 min-h-[64px] min-w-[132px] rounded-2xl border-4 border-dashed border-line bg-surface2 px-3 py-2 text-base font-extrabold text-ink active:scale-[0.98]">
        {mostrarOutras ? '✕ Fechar' : '+ Iniciar outra classe'}
      </button>
    </div>
  )
}

// Separa as classes do servidor em seções. Compatível com banco SEM os campos novos (`anterior`/`bloqueio`
// undefined): elegível = "Disponíveis", inelegível = "Bloqueadas". Nenhuma classe some; só é agrupada.
export function agruparDisponiveis(disponiveis) {
  const lista = Array.isArray(disponiveis) ? disponiveis : []
  const bloqueadas = lista.filter((c) => c.elegivel === false)
  const liberadas = lista.filter((c) => c.elegivel !== false)
  return {
    disponiveis: liberadas.filter((c) => c.anterior !== true),
    anteriores: liberadas.filter((c) => c.anterior === true),
    bloqueadas,
  }
}

const SECOES_DISPONIVEIS = [
  { chave: 'disponiveis', titulo: 'Disponíveis', apoio: null },
  { chave: 'anteriores', titulo: 'Classes anteriores disponíveis', apoio: 'Você já tem idade para estas classes. Dá para fazer as que ficaram pendentes.' },
  { chave: 'bloqueadas', titulo: 'Bloqueadas', apoio: null },
]

const MSG_NASCIMENTO = 'Informe a data de nascimento para verificar quais classes estão disponíveis.'
const ID_AVISO_NASCIMENTO = 'aviso-nascimento-classes'

// Classes já concluídas em OUTRO clube: só informativo (sem Iniciar); valem aqui.
export function ConcluidasAnteriormente({ itens }) {
  const lista = Array.isArray(itens) ? itens : []
  if (lista.length === 0) return null
  return (
    <section aria-labelledby="secao-classes-concluidas-antes" data-testid="secao-concluidas-anteriormente">
      <h3 id="secao-classes-concluidas-antes" className="text-sm font-extrabold uppercase tracking-wide text-muted">Concluídas anteriormente</h3>
      <p className="mt-0.5 text-sm text-muted">
        {lista.every((c) => c.origem !== 'registro_anterior_neste_clube')
          ? 'Você já concluiu estas classes em outro clube. Elas valem aqui.'
          : 'Você já concluiu estas classes antes. Elas valem aqui.'}
      </p>
      <ul className="mt-2 space-y-2">
        {lista.map((c) => {
          const cor = corDaClasse(c.nome)
          const data = fmtData(c.concluida_em)
          const registro = c.origem === 'registro_anterior_neste_clube'
          const registrada = fmtData(c.registrada_em)
          return (
            <li key={c.class_id} className="bg-surface rounded-2xl p-3 shadow-soft flex items-center gap-3"
              style={cor ? { borderLeft: `8px solid ${cor.hex}` } : undefined}>
              <EmblemaDaClasse nome={c.nome} tamanho={36} />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink text-base leading-tight"><span aria-hidden="true">✓ </span>{c.nome}</div>
                {(data || c.origem_clube_nome) && (
                  <div className="text-xs text-muted">
                    {data && <>Concluída em {data}</>}{data && c.origem_clube_nome && ' '}{c.origem_clube_nome && <>no clube {c.origem_clube_nome}</>}
                  </div>
                )}
                {registro && !data && c.data_desconhecida && <div className="text-xs text-muted">Data da conclusão desconhecida</div>}
                {registro && registrada && <div className="text-xs text-muted">Registrada em {registrada}</div>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function ListaDisponiveis({ disponiveis, onIniciar, concluidasAnteriormente = [] }) {
  const temConcluidas = Array.isArray(concluidasAnteriormente) && concluidasAnteriormente.length > 0
  if ((!disponiveis || disponiveis.length === 0) && !temConcluidas) {
    return (
      <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
        <div className="text-4xl mb-2" aria-hidden="true">🎖️</div>
        <p className="font-semibold text-ink">Nenhuma classe disponível ainda</p>
        <p className="text-sm text-faint">A liderança ainda vai publicar o currículo deste clube.</p>
      </div>
    )
  }
  const grupos = agruparDisponiveis(disponiveis)
  const semNascimento = (Array.isArray(disponiveis) ? disponiveis : []).some((c) => c.bloqueio === 'nascimento')
  return (
    <div className="space-y-5">
      {semNascimento && (
        <div role="note" data-testid="aviso-nascimento"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p id={ID_AVISO_NASCIMENTO} className="text-sm font-semibold text-amber-900">{MSG_NASCIMENTO}</p>
          <Link to="/perfil" data-testid="informar-nascimento"
            className="mt-2 inline-flex min-h-[44px] items-center rounded-xl bg-brand px-4 text-sm font-bold text-white">
            Informar data de nascimento
          </Link>
        </div>
      )}
      {SECOES_DISPONIVEIS.map(({ chave, titulo, apoio }) => {
        const itens = grupos[chave]
        if (itens.length === 0) return null
        const idTitulo = `secao-classes-${chave}`
        return (
          <section key={chave} aria-labelledby={idTitulo} data-testid={`secao-${chave}`}>
            <h3 id={idTitulo} className="text-sm font-extrabold uppercase tracking-wide text-muted">{titulo}</h3>
            {apoio && <p className="mt-0.5 text-sm text-muted">{apoio}</p>}
            <ul className="mt-2 space-y-3">
              {itens.map((c) => <ItemDisponivel key={c.class_id} c={c} onIniciar={onIniciar} />)}
            </ul>
          </section>
        )
      })}
      <ConcluidasAnteriormente itens={concluidasAnteriormente} />
    </div>
  )
}

const MOTIVO_GENERICO = 'Esta classe ainda não está liberada para você.'

function ItemDisponivel({ c, onIniciar }) {
  const inelegivel = c.elegivel === false
  const idMotivo = `motivo-${c.class_id}`
  const cor = corDaClasse(c.nome)
  const avancada = c.avancada === true || ehClasseAvancada(c.nome)
  // `bloqueio` (idade | pre_requisito) é aditivo: sem ele (banco antigo) cai no 🔒 de sempre
  const porNascimento = inelegivel && c.bloqueio === 'nascimento' // um aviso único no topo cuida do texto
  const icone = c.bloqueio === 'idade' ? '🎂' : c.bloqueio === 'pre_requisito' ? '🔗' : '🔒'
  const rotuloBloqueio = c.bloqueio === 'idade' ? 'Por idade' : c.bloqueio === 'pre_requisito' ? 'Falta uma classe antes' : null
  return (
    <li data-avancada={avancada ? 'true' : 'false'} data-bloqueio={inelegivel ? (c.bloqueio || 'outro') : undefined}
      className="bg-surface rounded-2xl p-4 shadow-soft flex items-center justify-between gap-3"
      style={cor ? { borderLeft: `8px solid ${cor.hex}` } : undefined}>
      <EmblemaDaClasse nome={c.nome} tamanho={44} />
      <div className="min-w-0 flex-1">
        <h4 className="font-bold text-ink text-base leading-tight">{c.nome}</h4>
        {avancada && <div className="mt-0.5"><SeloAvancada cor={cor} /></div>}
        {cor && <div className="text-xs font-semibold" style={{ color: cor.escuro }}>Cor da classe: {cor.nome}</div>}
        {c.idade_minima != null && <div className="text-xs text-faint truncate">A partir de {c.idade_minima} anos</div>}
        {c.idade_minima == null && c.faixa_etaria && <div className="text-xs text-faint truncate">{c.faixa_etaria}</div>}
        {c.curriculum_version?.origem === 'piloto_teste' && (
          <span className="inline-block mt-1 text-xs font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            Dados de teste
          </span>
        )}
        {inelegivel && !porNascimento && rotuloBloqueio && (
          <span data-testid="rotulo-bloqueio" className="inline-block mt-1 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{rotuloBloqueio}</span>
        )}
        {inelegivel && !porNascimento && <div id={idMotivo} className="text-xs text-amber-800 mt-1">{icone} {c.motivo_inelegivel || MOTIVO_GENERICO}</div>}
      </div>
      <button type="button" onClick={() => onIniciar(c.class_id)} disabled={inelegivel} aria-describedby={porNascimento ? ID_AVISO_NASCIMENTO : inelegivel ? idMotivo : undefined}
        style={cor ? { background: cor.hex, color: cor.texto } : undefined}
        className={`shrink-0 min-h-[48px] rounded-xl font-bold text-base px-4 py-2 shadow-soft disabled:opacity-40 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${cor ? '' : 'bg-gradient-to-r from-brand to-brand2 text-white'}`}>
        Iniciar
      </button>
    </li>
  )
}

// Caminho do cartão (migration 330): revisão do clube → distrito → região → apto. Mostra a etapa atual
// ("Aguardando distrito", "Aguardando região", "Apto à investidura") e a linha do tempo da corrida atual.
function CaminhoDoCartao({ memberClassId, status }) {
  const [linha, setLinha] = useState(null)
  useEffect(() => {
    let vivo = true
    Promise.resolve().then(() => carregarHistoricoDoCartao(memberClassId))
      .then((runs) => { if (vivo) setLinha(linhaDoHistorico((runs || [])[runs.length - 1])) })
      .catch(() => { if (vivo) setLinha(null) })
    return () => { vivo = false }
  }, [memberClassId, status])
  if (!linha) return null
  const atual = etapaAtual(linha)
  return (
    <div data-testid="caminho-do-cartao" className="mt-2">
      {atual && atual.escopo_tipo !== 'clube' && (
        <p className="text-sm font-semibold text-amber-800">⏳ {rotuloDaEtapa(atual)} — o clube já aprovou o seu cartão.</p>
      )}
      <LinhaDoTempoInvestidura linha={linha} titulo="Caminho do seu cartão" />
    </div>
  )
}

function Progresso({ dados, formularios = {}, userId, onMudou }) {
  const { member_class: mc, classe, curriculum_version: versao, conclusao, secoes } = dados
  const ehTeste = versao?.origem === 'piloto_teste'
  // fase 4: 100% aprovado NÃO é "investido" — os estados são separados e vêm do servidor
  const ETAPAS = {
    requisitos_concluidos: { icon: '🧩', texto: 'Todos os requisitos aprovados! A conclusão está sendo validada pela liderança.' },
    aguardando_revisao: { icon: '🔎', texto: 'Todos os requisitos aprovados! Aguardando a revisão final da liderança.' },
    apto_investidura: { icon: '🎉', texto: 'Revisão final aprovada — você está apto(a) para a investidura. A liderança registra quando ela acontecer.' },
  }
  const etapa = ETAPAS[mc.status]
  // tema da página inteira = a cor da classe (classe sem cor conhecida cai nas cores do app)
  const cor = corDaClasse(classe?.nome)
  // requisitos de idade que pedem foto do documento (migration 380): uma leitura por classe
  const [docs, setDocs] = useState({})
  const lerDocs = useCallback(() => documentosDaMinhaClasse(mc.id).then(setDocs).catch(() => setDocs({})), [mc.id])
  useEffect(() => { lerDocs() }, [lerDocs])
  const mudouComDocs = useCallback(async () => { await onMudou(); await lerDocs() }, [onMudou, lerDocs])

  // Jornada: seções colapsáveis (abre a que tem algo a fazer) e detalhe de UM requisito por vez na tela.
  // `secoesAbertas` só guarda o que a pessoa mexeu; o resto segue o padrão (aberta se há pendência).
  const [secoesAbertas, setSecoesAbertas] = useState({})
  const [abertos, setAbertos] = useState(() => new Set())
  const [focoEm, setFocoEm] = useState(null)
  const total = contagens(secoes)
  const proximo = proximoRequisito(secoes, formularios)
  const secaoAberta = (s) => (s.id in secoesAbertas ? secoesAbertas[s.id] : secaoTemPendencia(s))
  const alternarRequisito = useCallback((id, abrir) => {
    setAbertos((a) => { const n = new Set(a); if (abrir) n.add(id); else n.delete(id); return n })
  }, [])
  function continuar() {
    if (!proximo) return
    setSecoesAbertas((o) => ({ ...o, [proximo.secaoId]: true }))
    alternarRequisito(proximo.requisitoId, true)
    setFocoEm({ id: proximo.requisitoId }) // objeto novo a cada toque: refoca mesmo no mesmo requisito
  }
  // depois de abrir pelo [CONTINUAR]: leva o foco (e a vista) ao requisito
  useEffect(() => {
    if (!focoEm) return
    const el = document.getElementById(`abrir-${focoEm.id}`)
    if (el) {
      el.focus()
      const reduz = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      el.scrollIntoView?.({ block: 'center', behavior: reduz ? 'auto' : 'smooth' })
    }
  }, [focoEm])

  return (
    <div className="space-y-4" data-testid="classe-tema" data-cor={cor?.hex || ''}>
      <div className="bg-surface rounded-2xl shadow-soft overflow-hidden">
        <div data-testid="cabecalho-classe" className={`px-5 py-4 flex items-center gap-3 ${cor ? '' : 'bg-gradient-to-r from-brand to-brand2 text-white'}`}
          style={cor ? { background: cor.hex, color: cor.texto } : undefined}>
          <EmblemaDaClasse nome={classe?.nome} tamanho={56} />
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold text-2xl leading-tight">{classe?.nome}</h3>
            {ehClasseAvancada(classe?.nome) && <div className="mt-0.5"><SeloAvancada cor={cor} sobreCor={!!cor} /></div>}
            {versao?.origem === 'oficial' && (
              <p className="text-xs font-semibold opacity-90">
                Currículo oficial {versao.versao}{classe?.vigente_desde ? ` · vigente desde ${fmtData(classe.vigente_desde)}` : ''}
              </p>
            )}
          </div>
          {ehTeste && (
            <span className="text-xs font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              Dados de teste
            </span>
          )}
        </div>
        <div className="p-5 pt-3">
        {ehTeste && <p className="text-xs text-faint mb-2">{versao.fonte_descricao}</p>}
        <div className="mt-1" data-testid="jornada">
          {/* o percentual é do SERVIDOR (member_class.percentual); as contagens só agrupam o status de cada requisito */}
          <BarraProgresso valor={mc.percentual ?? 0} rotulo="Progresso na classe" mostrarRotulo />
          <p data-testid="jornada-contagem" className="mt-2 text-base font-bold text-ink">{total.aprovados} de {total.total} requisitos aprovados</p>
          <ul data-testid="jornada-resumo" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
            <li><span aria-hidden="true">✓ </span>{total.aprovados} {total.aprovados === 1 ? 'aprovado' : 'aprovados'}</li>
            <li><span aria-hidden="true">⏳ </span>{total.aguardando} aguardando avaliação</li>
            <li><span aria-hidden="true">⚠ </span>{total.correcao} {total.correcao === 1 ? 'precisa' : 'precisam'} de correção</li>
          </ul>
          {proximo ? (
            <Botao aoTocar={continuar} data-testid="continuar" className="mt-3 w-full">
              Continuar
            </Botao>
          ) : (
            <p data-testid="nada-pendente" className="mt-3 rounded-xl bg-surface2 px-3 py-2.5 text-sm font-semibold text-ink">Nada pendente por aqui</p>
          )}
        </div>
        <p className="text-sm text-muted mt-2">iniciada em {fmtData(mc.iniciada_em)}</p>

        {etapa && (
          <div data-testid="etapa" data-etapa={mc.status} className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-blue-800">
            <span aria-hidden="true">{etapa.icon}</span> {etapa.texto}
            {mc.status === 'apto_investidura' && conclusao?.revisao?.revisado_em && (
              <div className="text-xs mt-1">Revisão final aprovada em {fmtData(conclusao.revisao.revisado_em)}{conclusao.revisao.revisado_por_nome ? ` por ${conclusao.revisao.revisado_por_nome}` : ''}.</div>
            )}
          </div>
        )}
        {mc.status === 'em_andamento' && conclusao?.revisao?.status === 'correcao_solicitada' && conclusao.revisao.comentario && (
          <div className="mt-3">
            <Aviso tom="erro">
              <p>A revisão final pediu correção: "{conclusao.revisao.comentario}" — os requisitos reabertos estão marcados abaixo.</p>
            </Aviso>
          </div>
        )}
        {mc.status === 'investida' && (
          <div data-testid="etapa" data-etapa="investida" className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-800 font-semibold">
            🏅 Investido(a) nesta classe{conclusao?.investidura?.data ? ` em ${fmtData(conclusao.investidura.data)}` : ''}!
          </div>
        )}
        <ConclusaoReconhecida memberClassId={mc.id} ativo={mc.status === 'investida'} />
        {['aguardando_revisao', 'apto_investidura', 'investida'].includes(mc.status) && <CaminhoDoCartao memberClassId={mc.id} status={mc.status} />}
        {conclusao?.snapshot && <BotaoDocumento memberClassId={mc.id} ehFinal={mc.status === 'investida'} />}
        </div>
      </div>

      {(secoes || []).map((s) => {
        const aberta = secaoAberta(s)
        const { feitos, total: n } = progressoDaSecao(s.requisitos)
        const idCorpo = `secao-corpo-${s.id}`
        return (
          <section key={s.id} data-testid="secao" aria-labelledby={`secao-${s.id}`} className="bg-surface rounded-2xl shadow-soft overflow-hidden"
            style={cor ? { border: `2px solid ${cor.hex}` } : undefined}>
            <div className={`flex items-center justify-between gap-2 ${cor ? '' : 'bg-surface2 text-ink'}`}
              style={cor ? { background: cor.hex, color: cor.texto } : undefined}>
              <h4 id={`secao-${s.id}`} className="min-w-0 flex-1 font-extrabold text-base">
                <button type="button" data-testid="alternar-secao" aria-expanded={aberta} aria-controls={idCorpo}
                  onClick={() => setSecoesAbertas((o) => ({ ...o, [s.id]: !aberta }))}
                  className="flex min-h-[48px] w-full items-center gap-2 px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-current">
                  <span aria-hidden="true" className={`shrink-0 text-sm transition-transform motion-reduce:transition-none before:content-['▸'] ${aberta ? 'rotate-90' : ''}`} />
                  <span className="min-w-0">{s.codigo ? `${s.codigo}. ` : ''}{s.nome}</span>
                </button>
              </h4>
              <span className="pr-4"><ProgressoDaSecao feitos={feitos} total={n} /></span>
            </div>
            <div className="px-4 py-2 border-b border-line">
              <BarraProgresso feitos={feitos} total={n} tamanho="fina" rotulo={`Progresso da seção ${s.codigo ? `${s.codigo}. ` : ''}${s.nome}`} />
            </div>
            {aberta && (
              <div id={idCorpo} className="divide-y divide-line">
                {(s.requisitos || []).map((r) => (
                  <Requisito key={r.id} r={r} secao={s} classeManifesto={classe?.manifesto_id || null} formulario={formularios[r.id] || null} cor={cor} userId={userId} onMudou={mudouComDocs} documento={docs[r.id]}
                    aberto={abertos.has(r.id)} onAlternar={(abrir) => alternarRequisito(r.id, abrir)} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Requisito({ r, secao = null, classeManifesto = null, formulario = null, cor = null, userId, onMudou, documento = null, aberto = false, onAlternar = () => {} }) {
  const situacao = situacaoDoRequisito(r)
  const statusJornada = statusDaJornada(r, formulario)
  const tipo = tipoDoRequisito({ requisito: r, formulario })
  const idDetalhe = `detalhe-${r.id}`
  // o detalhe monta na primeira abertura e depois só fica escondido: digitar e fechar não perde nada em andamento
  const [jaAbriu, setJaAbriu] = useState(aberto)
  if (aberto && !jaAbriu) setJaAbriu(true)
  const bloqueios = r.bloqueios || []
  // rascunho local (modo manutenção/rede): a resposta digitada fica no aparelho até ser salva
  const [texto, setTexto, descartarRascunho, veioDoRascunho] = useRascunho(userId, `requisito:${r.id}`, r.evidencia_texto || '')
  const [foto, setFoto] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  // Secundários (ouvir o livro, catálogo, histórico, origem) ficam no menu "⋯" (MenuAcoes) para não
  // disputar com a tarefa. O histórico só é buscado quando a pessoa pede (o comentário da correção já
  // aparece inline no card, sem chamada extra).
  const [mostrarHistorico, setMostrarHistorico] = useState(false)
  const [mostrarOuvir, setMostrarOuvir] = useState(false)
  const [temLivro, setTemLivro] = useState(false)
  const [origem, setOrigem] = useState(null)
  const [abrindoOrigem, setAbrindoOrigem] = useState(false)
  const navegar = useNavigate()
  // Motor de relatório (fase 7): o formulário já veio com a classe (classe_formularios) — sem piscar nem chamada por requisito.
  const form = formulario?.modelo?.schema ? formulario : null

  // A ação "Ouvir o livro" só entra no menu quando o catálogo (uma leitura por sessão) tem o livro
  // citado no requisito — o mesmo critério do <OuvirLivro>, que renderiza nada quando não tem.
  useEffect(() => {
    let vivo = true
    audiolivros().then((ls) => { if (vivo) setTemLivro(!!livroDoRequisito(r.descricao, ls)) }).catch(() => {})
    return () => { vivo = false }
  }, [r.descricao])

  async function verOrigem() {
    setAbrindoOrigem(true)
    try { setOrigem(await carregarOrigemRequisito(r.id)) } catch (e) { avisar.erro(e) } finally { setAbrindoOrigem(false) }
  }

  const podeEditar = ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(r.status)
  const podeEnviar = podeEditar && bloqueios.length === 0
  // o último comentário de correção do avaliador (vem no payload de minha_classe — sem chamada extra)
  const comentarioDaCorrecao = r.status === 'correcao_solicitada'
    ? ([...(r.avaliacoes || [])].reverse().find((a) => a.decisao === 'correcao_solicitada' && a.comentario)?.comentario || '')
    : ''
  const precisaTexto = r.tipo_evidencia === 'texto'
  const precisaFoto = r.tipo_evidencia === 'foto'
  const obrigatoria = !!r.evidencia_obrigatoria
  const idTitulo = `req-${r.id}`
  const idBloqueios = `bloq-${r.id}`
  const prazo = r.prazo_em || r.prazo || null

  async function salvar() {
    setOcupado(true); setErro('')
    try {
      if (precisaTexto || precisaFoto) await salvarRequisito({ requirementId: r.id, texto: precisaTexto ? texto : null, foto: precisaFoto ? foto : null, userId })
      await relatoRef.current?.salvarAgora()
      descartarRascunho()
      await onMudou()
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não consegui salvar o rascunho.')); setOcupado(false)
    }
  }

  async function enviar() {
    setErro('')
    // Comprovação obrigatória: avisa na hora, com o que falta, em vez de esperar o servidor recusar.
    if (obrigatoria && precisaTexto && !texto.trim()) { setErro('Escreva sua resposta antes de enviar para avaliação.'); return }
    if (obrigatoria && precisaFoto && !foto && !r.evidencia_path) { setErro('Escolha uma foto de comprovação antes de enviar para avaliação.'); return }
    if (documento && !documento.documento?.evidencia_path) { setErro('Envie a foto do documento antes de enviar para avaliação.'); return }
    setOcupado(true)
    try {
      await relatoRef.current?.preparar() // o relato digitado vai ao servidor ANTES do envio (o envio congela esse texto)
      if ((precisaTexto && texto.trim()) || (precisaFoto && foto)) {
        await salvarRequisito({ requirementId: r.id, texto: precisaTexto ? texto : null, foto: precisaFoto ? foto : null, userId })
      }
      await enviarRequisito(r.id)
      relatoRef.current?.aoEnviado()
      descartarRascunho()
      festa()
      await onMudou()
    } catch (e) {
      relatoRef.current?.retomar()
      setErro(mensagemDeErro(e, 'Não consegui enviar para avaliação.')); setOcupado(false)
    }
  }

  // enviar pelo formulário: grava o rascunho final e só então envia (o servidor valida e congela a tentativa)
  const salvarFormulario = (conteudo, anexos) => salvarRelatorioRequisito({ requirementId: r.id, conteudo, anexos })
  async function enviarFormulario(conteudo, anexos) {
    if (documento && !documento.documento?.evidencia_path) throw new Error('Envie a foto do documento antes de enviar para avaliação.')
    await relatoRef.current?.preparar()
    try {
      await salvarFormulario(conteudo, anexos)
      await enviarRequisito(r.id)
    } catch (e) { relatoRef.current?.retomar(); throw e }
    relatoRef.current?.aoEnviado()
    festa()
    await onMudou()
  }
  const usaFormulario = podeEditar && !!form
  const chaveLocal = chaveLocalDe(userId, 'classe', r.id)
  // relato complementar (520): bloco em TODO requisito editável; some se o banco não tem a 520 (payload sem `relato`)
  const relatoRef = useRef(null)
  const relatoDisponivel = temRelato(r)
  const carregarRelatoServidor = async () => {
    const f = await carregarFormularioRequisito(r.id)
    return { relato: f?.relato, rascunhoEm: f?.rascunho_em ?? null, editavel: ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(f?.status) }
  }
  const blocoRelato = podeEditar && relatoDisponivel ? (
    <RelatoComplementar key={`relato-${r.id}`} ref={relatoRef} requirementId={r.id} chaveLocal={chaveLocalDe(userId, 'classe-relato', r.id)}
      relatoInicial={r.relato} rascunhoEm={r.rascunho_em ?? null} exigeTexto={precisaTexto && obrigatoria}
      salvarRelato={(t) => salvarRelatoRequisito({ requirementId: r.id, relato: t })} carregarServidor={carregarRelatoServidor} />
  ) : null
  // releitura do servidor (só quando um rascunho local pendente volta a rede): conferir antes de empurrar
  const carregarServidor = async () => {
    const f = await carregarFormularioRequisito(r.id)
    return { conteudo: f?.rascunho || {}, anexos: f?.anexos || [], rascunhoEm: f?.rascunho_em ?? null, editavel: ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(f?.status) }
  }

  function fechar() {
    onAlternar(false)
    document.getElementById(`abrir-${r.id}`)?.focus()
  }
  // Esc fecha o detalhe (só quando a tecla vem de DENTRO deste card: menus/folhas em portal cuidam do seu Esc)
  function aoTeclar(e) {
    if (e.key === 'Escape' && aberto && !e.defaultPrevented && e.currentTarget.contains(e.target)) { e.stopPropagation(); fechar() }
  }

  return (
    <article data-testid="requisito" aria-labelledby={idTitulo} className="" onKeyDown={aoTeclar}>
      {/* Linha da jornada: situação (ícone + texto) EM CIMA do texto; tocar abre/fecha o detalhe. */}
      <h5 id={idTitulo} className="text-sm font-semibold text-ink leading-snug">
        <button type="button" id={`abrir-${r.id}`} data-testid="abrir-requisito" aria-expanded={aberto} aria-controls={idDetalhe}
          onClick={() => onAlternar(!aberto)}
          className="flex min-h-[56px] w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand">
          <span className="min-w-0 flex-1">
            <span className="mb-1.5 block" data-testid="situacao" data-situacao={situacao}>
              <StatusRequisito status={statusJornada} rotulo={situacao === 'pronto_pelo_historico' ? ROTULO_PELO_HISTORICO : undefined} />
            </span>
            <span data-testid="requisito-texto" className={aberto ? 'block' : 'line-clamp-3 block'}>{r.codigo}. {r.descricao}</span>
          </span>
          <span aria-hidden="true" className={`mt-1 shrink-0 text-lg text-muted transition-transform motion-reduce:transition-none before:content-['▾'] ${aberto ? 'rotate-180' : ''}`} />
        </button>
      </h5>

      {jaAbriu && (
      <div id={idDetalhe} role="region" aria-labelledby={idTitulo} hidden={!aberto} data-testid="detalhe-requisito" className="px-4 pb-4">
      {/* Detalhe: o "o que precisa ser feito" é o texto do requisito na linha acima (aberta, sem corte); aqui
          vêm tipo, dependências, prazo, material e a ação apropriada. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="tipos-requisito">
        {secao && <span className="text-xs text-muted">Seção {secao.codigo ? `${secao.codigo}. ` : ''}{secao.nome}</span>}
        {tipo.chips.map((c) => (
          <span key={c.rotulo} data-tipo={c.tipo || 'neutro'} className="inline-flex items-center rounded-full border border-line bg-surface2 px-2 py-0.5 text-xs font-bold text-ink">{c.rotulo}</span>
        ))}
      </div>
      {prazo && <p data-testid="prazo" className="mb-2 text-sm text-ink"><span aria-hidden="true">📅 </span>Prazo: <span className="font-semibold">{fmtData(prazo)}</span></p>}
      {bloqueios.length > 0 && r.status !== 'aprovado' && (
        <div className="mb-2">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Antes de enviar</p>
          <ul id={idBloqueios} data-testid="bloqueios" className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 space-y-0.5">
            {bloqueios.map((b, i) => <li key={i}>🔒 {b}</li>)}
          </ul>
        </div>
      )}
      {/* Material relacionado: "Ouvir o livro" (audiolivros) e, nos requisitos de LEITURA, o card do livro da classe
          (só com o manifesto_id da classe, para nunca mostrar o livro de outra). O card some sozinho se não há livro. */}
      {tipo.tipo === TIPOS.LEITURA && classeManifesto && r.status !== 'aprovado' && (
        <div className="mb-2"><CardLivroDaClasse classeManifesto={classeManifesto} userId={userId} /></div>
      )}
      <MaterialDoRequisito temLivro={temLivro} mostrarOuvir={mostrarOuvir} aoOuvir={() => setMostrarOuvir(true)} descricao={r.descricao} userId={userId} />

      {r.conteudo_dinamico && <ConteudoDoPeriodo dinamico={r.conteudo_dinamico} mostrarAviso={!podeEditar || bloqueios.length === 0} />}
      {r.escolha && <Escolha r={r} podeEditar={podeEditar} onMudou={onMudou} />}

      {documento && <DocumentoDaIdade info={documento} requirementId={r.id} memberRequirementId={r.member_requirement_id} podeEditar={podeEditar} userId={userId} onMudou={onMudou} />}
      {r.status === 'aprovado' ? (
        <>
          {r.evidencia_texto && <p className="text-sm text-muted italic mt-1">"{r.evidencia_texto}"</p>}
          {r.evidencia_path && <Comprovacao valor={r.evidencia_path} alt="evidência" classImg="mt-2 w-32 h-32 object-cover rounded-lg" />}
        </>
      ) : podeEditar ? (
        <div className="mt-2 space-y-2">
          {r.status === 'correcao_solicitada' && !usaFormulario && (
            // O comentário do avaliador aparece AQUI, sem precisar abrir o histórico (auditoria da Fase 6).
            <Aviso tom="erro" titulo="A liderança pediu correção">
              {comentarioDaCorrecao
                ? <>"{comentarioDaCorrecao}" — ajuste e envie de novo.</>
                : <>Ajuste a sua resposta e envie de novo. O histórico abaixo tem os detalhes.</>}
            </Aviso>
          )}
          {/* Comprovação em destaque: caixa colorida com o passo dito em palavras simples — tem criança e
              responsável com dificuldade, então o "onde eu ponho?" precisa ser óbvio e o alvo de toque grande. */}
          {usaFormulario && (
            <>
              {form.modelo?.nota && <p className="text-xs text-muted">{form.modelo.nota}</p>}
              <FormularioRelatorio key={r.id} schema={form.modelo.schema}
                valorInicial={{ conteudo: form.rascunho || {}, anexos: form.anexos || [], rascunhoEm: form.rascunho_em ?? null }}
                comentarioDevolucao={r.status === 'correcao_solicitada' ? comentarioDaCorrecao : ''}
                onSalvarRascunho={salvarFormulario} onEnviar={enviarFormulario}
                chaveLocal={chaveLocal} carregarServidor={carregarServidor} blocoExtra={blocoRelato}
                subirAnexo={(file) => subirAnexoDeRelatorio(file, userId)}
                enviarDesativado={!podeEnviar} descricaoEnviarId={idBloqueios}
                rotuloEnviar={soConfirmacao(form.modelo.schema) ? 'Marcar como feito' : undefined} />
            </>
          )}
          {!usaFormulario && precisaTexto && (
            <label className="block rounded-xl border-2 border-blue-300 bg-blue-50 p-3">
              <span className="block text-sm font-bold text-blue-900"><span aria-hidden="true">✍️ </span><span>Sua resposta{obrigatoria ? ' (obrigatória)' : ''}</span></span>
              <span className="block text-xs text-blue-800 mt-0.5">Escreva aqui o que você fez ou aprendeu.</span>
              <textarea aria-label={`Sua resposta${obrigatoria ? ' (obrigatória)' : ''}`} value={texto} required={obrigatoria} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="Escreva aqui..."
                className="mt-2 w-full text-base rounded-lg border-2 border-blue-200 bg-white px-3 py-2 focus:border-blue-500 focus:outline-none" />
              {veioDoRascunho && <span className="block text-xs text-blue-800 mt-1">Recuperamos o que você tinha escrito neste aparelho — é só enviar.</span>}
            </label>
          )}
          {!usaFormulario && precisaFoto && (
            <div>
              <span className="block text-sm font-semibold text-ink mb-1.5">Foto de comprovação{obrigatoria ? ' (obrigatória)' : ''}</span>
              {/* ZonaUpload (design system): sem `capture` de propósito — a pessoa escolhe entre câmera e galeria.
                  A foto já salva vem do bucket privado, por isso entra como `miniatura` (<Comprovacao> assina a URL).
                  "Remover" só vale para a foto escolhida agora: a salva no servidor não se apaga daqui. */}
              <ZonaUpload rotulo="Foto de comprovação" obrigatorio={obrigatoria} accept="image/*" arquivo={foto}
                aoEscolher={setFoto} aoRemover={foto ? () => setFoto(null) : undefined}
                estado={ocupado && foto ? 'enviando' : undefined} progresso="Só um instante"
                miniatura={!foto && r.evidencia_path
                  ? <Comprovacao valor={r.evidencia_path} alt="evidência salva" classImg="max-h-48 w-auto rounded-xl object-contain shadow-soft" />
                  : undefined} />
            </div>
          )}
          {!usaFormulario && blocoRelato}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {/* Hierarquia: UM botão principal, largo e alto; o rascunho é discreto. */}
          {!usaFormulario && (
          <div className="space-y-1.5">
            <Botao aoTocar={enviar} carregando={ocupado} desabilitado={!podeEnviar} aria-describedby={!podeEnviar ? idBloqueios : undefined}
              data-testid="botao-enviar" className="w-full" style={cor ? { background: cor.hex, color: cor.texto, backgroundImage: 'none' } : undefined}>
              {!podeEnviar ? '🔒 Enviar para avaliação' : 'Enviar para avaliação'}
            </Botao>
            {(precisaTexto || precisaFoto || relatoDisponivel) && (
              <Botao variacao="discreto" aoTocar={salvar} desabilitado={ocupado} className="w-full text-muted">
                Salvar rascunho
              </Botao>
            )}
          </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-faint mt-1">⏳ Aguardando a liderança avaliar.</p>
      )}
      {!podeEditar && <AvisoCopiaDeSeguranca chaveLocal={chaveLocal} />}
      {!podeEditar && <RelatoDoMembro relato={r.relato} titulo="Seu relato" className="mt-2" />}
      {!podeEditar && relatoDisponivel && <AvisoCopiaDeSeguranca chaveLocal={chaveLocalDe(userId, 'classe-relato', r.id)} />}
      {(r.avaliacoes || []).length > 0 && r.member_requirement_id && (
        <button type="button" onClick={() => setMostrarHistorico((v) => !v)} aria-expanded={mostrarHistorico} data-testid="alternar-historico"
          className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-muted underline">
          <span aria-hidden="true">🕘</span> {mostrarHistorico ? 'Esconder' : 'Ver'} histórico de tentativas
        </button>
      )}

      {/* Secundário no menu "⋯" (MenuAcoes): ouvir o livro, catálogo, histórico, origem — nada disputa com a
          tarefa. Cada ação abre o seu conteúdo AQUI no card (o menu fecha e o foco volta ao "⋯"). */}
      <div className="mt-2 flex items-center justify-end">
        <MenuAcoes rotulo="Mais sobre este requisito" acoes={acoesDoRequisito({
          r, mostrarHistorico, abrindoOrigem,
          catalogo: (termo) => navegar(`/catalogo-especialidades${termo ? `?q=${encodeURIComponent(termo)}` : ''}`),
          historico: () => setMostrarHistorico((v) => !v),
          origem: verOrigem,
        })} />
      </div>
      {mostrarHistorico && r.member_requirement_id && <HistoricoPorTentativa memberRequirementId={r.member_requirement_id} />}
      <OrigemRequisito origem={origem} onFechar={() => setOrigem(null)} />
      <button type="button" onClick={fechar} data-testid="fechar-requisito"
        className="mt-3 min-h-[44px] w-full rounded-xl bg-surface2 px-4 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        Fechar detalhes
      </button>
      </div>
      )}
    </article>
  )
}

// Ações do "⋯" de um requisito, na ordem em que aparecem. Pura (exportada para teste): só decide
// QUAIS ações existem e com que rótulo — quem executa é o card.
// (o "Ouvir o livro" saiu do menu: agora vive na seção Material do detalhe — <MaterialDoRequisito>.)
export function acoesDoRequisito({ r, mostrarHistorico, abrindoOrigem, catalogo, historico, origem }) {
  const acoes = []
  const termo = termoDoRequisito(r.descricao)
  if (termo !== null) acoes.push({ rotulo: 'Ver no catálogo de especialidades', icone: '🔎', onClick: () => catalogo(termo) })
  const n = (r.avaliacoes || []).length
  if (n > 0 && r.member_requirement_id) {
    acoes.push({ rotulo: `${mostrarHistorico ? 'Esconder' : 'Ver'} histórico (${n} avaliaç${n === 1 ? 'ão' : 'ões'})`, icone: '🕘', onClick: historico })
  }
  acoes.push({ rotulo: abrindoOrigem ? 'Carregando…' : 'Origem do requisito', icone: '📜', onClick: origem, desabilitada: abrindoOrigem })
  return acoes
}

// Material relacionado ao requisito. Hoje: "Ouvir o livro" (catálogo de audiolivros, migration 370).
// (O card do livro da classe — CardLivroDaClasse — é renderizado logo acima deste bloco, no detalhe dos requisitos de leitura.)
function MaterialDoRequisito({ temLivro, mostrarOuvir, aoOuvir, descricao, userId }) {
  if (!temLivro && !mostrarOuvir) return null
  return (
    <div className="mb-2" data-testid="material-requisito">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Material para estudar</p>
      {mostrarOuvir
        ? <OuvirLivro descricao={descricao} userId={userId} />
        : (
          <button type="button" onClick={aoOuvir}
            className="mt-1 inline-flex min-h-[44px] w-full items-center gap-2 rounded-xl border-2 border-violet-200 bg-violet-50 px-3 text-left text-sm font-bold text-violet-900">
            <span aria-hidden="true">🎧</span> Ouvir o livro
          </button>
        )}
    </div>
  )
}

// Gera (ou reobtém, idempotente) o Caderno da própria pessoa e abre a versão imprimível numa aba nova.
// Antes da investidura sai como acompanhamento; depois, como documento final.
function BotaoDocumento({ memberClassId, ehFinal }) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  async function gerar() {
    setOcupado(true); setErro('')
    try {
      const r = await emitirDocumento(memberClassId)
      window.open(`/documento/${r.token}`, '_blank', 'noopener')
    } catch (e) { setErro(mensagemDeErro(e, 'Não consegui gerar o documento.')) } finally { setOcupado(false) }
  }
  return (
    <div className="mt-3">
      <Botao variacao="secundario" aoTocar={gerar} carregando={ocupado} className="w-full">
        {ehFinal ? '📘 Ver / imprimir meu documento de conclusão' : '📘 Ver / imprimir meu caderno de acompanhamento'}
      </Botao>
      {erro && <div className="mt-2"><Aviso tom="erro">{erro}</Aviso></div>}
    </div>
  )
}

// Conteúdo anual/dinâmico (Curso de Leitura): com valor do ano, mostra o livro (desde a migration 84
// vem o ANO e, depois do envio/aprovação, o valor FIXADO). Sem valor cadastrado, desde a migration 108
// o requisito fica ABERTO: aviso neutro pedindo o nome do livro e o resumo na resposta (sem cadeado).
// (se o servidor ainda mandar bloqueios — servidor antigo —, a lista já diz o motivo e o aviso não repete)
export const AVISO_LEITURA_SEM_LIVRO = 'Escreva o nome do livro do Curso de Leitura deste ano e o seu resumo'
function ConteudoDoPeriodo({ dinamico, mostrarAviso }) {
  if (dinamico.valor) return <p className="text-sm text-ink bg-surface2 rounded-lg px-3 py-2 mb-1.5">📖 {dinamico.ano ? `Conteúdo de ${dinamico.ano}` : 'Conteúdo deste período'}: <span className="font-semibold">{dinamico.valor}</span></p>
  if (!mostrarAviso) return null
  return <p data-testid="aviso-leitura" className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-1.5">📖 {AVISO_LEITURA_SEM_LIVRO}.</p>
}

// Escolha N-de-M: opções na ordem do cartão (checkbox), texto livre só quando o cartão não lista opções.
// O que o histórico já cumpre vem marcado pelo servidor; o que viola "sem repetição" vem sinalizado.
function Escolha({ r, podeEditar, onMudou }) {
  const e = r.escolha
  const opcoes = e.opcoes || []
  const auto = new Set(e.opcoes_automaticas || [])
  const escolhidasIniciais = (e.escolhidas || []).filter((x) => x.option_id).map((x) => x.option_id)
  const livresIniciais = (e.escolhidas || []).filter((x) => x.rotulo_livre).map((x) => x.rotulo_livre)
  const [marcadas, setMarcadas] = useState(new Set(escolhidasIniciais))
  const [livres, setLivres] = useState(livresIniciais)
  const [novoLivre, setNovoLivre] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const violacoes = new Set((e.escolhidas || []).filter((x) => x.ja_realizada_antes).map((x) => x.option_id))
  const mudou = JSON.stringify([...marcadas].sort()) !== JSON.stringify([...escolhidasIniciais].sort()) || JSON.stringify(livres) !== JSON.stringify(livresIniciais)
  const idLegenda = `escolha-${r.id}`

  function alternar(id) {
    setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  async function salvar() {
    setSalvando(true); setErro('')
    try {
      await escolherOpcoesRequisito(r.id, [...marcadas], livres)
      await onMudou()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não consegui salvar a escolha.')); setSalvando(false)
    }
  }

  return (
    <fieldset data-testid="escolha" className="text-xs text-muted bg-surface2 rounded-lg px-3 py-2 mb-1.5" disabled={!podeEditar}>
      <legend id={idLegenda} className="font-semibold text-ink">
        Escolha {e.n_minimo}{opcoes.length ? ` de ${opcoes.length}` : ''}
        {e.sem_repeticao && <span className="font-normal text-faint"> · não vale especialidade já realizada antes desta classe</span>}
      </legend>
      {opcoes.length > 0 && (
        <ul className="mt-1 space-y-1">
          {opcoes.map((o) => {
            const cumprida = auto.has(o.id)
            const viola = violacoes.has(o.id)
            return (
              <li key={o.id}>
                <label className="flex items-start gap-2 min-h-[44px]">
                  <input type="checkbox" className="mt-0.5 w-5 h-5" aria-label={o.rotulo} checked={cumprida || marcadas.has(o.id)} disabled={cumprida || !podeEditar} onChange={() => alternar(o.id)} />
                  <span className={viola ? 'line-through' : ''}>{o.rotulo}</span>
                  {cumprida && <span className="text-green-700">✨ cumprida pelo seu histórico</span>}
                  {viola && <span className="text-amber-800">🔒 já realizada antes desta classe — não vale</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {e.aceita_texto_livre && (
        <div className="mt-1 space-y-1">
          {livres.length > 0 && (
            <ul className="space-y-0.5">
              {livres.map((t) => (
                <li key={t} className="flex items-center justify-between gap-2">
                  <span className="text-ink">• {t}</span>
                  {podeEditar && <button type="button" onClick={() => setLivres((l) => l.filter((x) => x !== t))} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-faint underline" aria-label={`Remover ${t}`}>remover</button>}
                </li>
              ))}
            </ul>
          )}
          {podeEditar && (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="sr-only">Qual especialidade você fez?</span>
                <input value={novoLivre} onChange={(ev) => setNovoLivre(ev.target.value)} placeholder="Qual especialidade você fez?"
                  className="w-full text-sm rounded-lg border border-line px-3 py-1.5" />
              </label>
              <Botao variacao="contorno" aoTocar={() => { const t = novoLivre.trim(); if (t && !livres.includes(t)) setLivres((l) => [...l, t]); setNovoLivre('') }}
                className="text-xs">Adicionar</Botao>
            </div>
          )}
        </div>
      )}
      {erro && <p role="alert" className="text-red-700 mt-1">{erro}</p>}
      {podeEditar && mudou && (
        <Botao aoTocar={salvar} carregando={salvando} className="mt-2 text-xs">
          Salvar escolha
        </Botao>
      )}
    </fieldset>
  )
}

// Histórico por TENTATIVA (requisito_historico, migration 87): cada tentativa mostra a evidência
// enviada NAQUELE momento (não só a atual — a Tentativa 1 continua existindo mesmo depois da
// correção/reenvio) e a decisão que recebeu. Buscado sob demanda pra não pesar a carga inicial.
function HistoricoPorTentativa({ memberRequirementId }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    if (!memberRequirementId) return
    carregarHistoricoRequisito(memberRequirementId)
      .then((d) => { if (vivo) setDados(d) })
      .catch((e) => { if (vivo) setErro(mensagemDeErro(e, 'Não consegui carregar o histórico.')) })
    return () => { vivo = false }
  }, [memberRequirementId])

  if (erro) return <div className="mt-1.5"><Aviso tom="erro">{erro}</Aviso></div>
  if (!dados) return <div className="mt-1.5"><Carregando linhas={1} texto="Carregando histórico" /></div>

  // requisito com formulário: cada tentativa mostra o relatório que foi enviado NAQUELA vez
  if (dados.modelo) return <HistoricoTentativas tentativas={dados.tentativas || []} modelo={dados.modelo} mostrarAvaliador className="mt-1.5" />
  return <HistoricoDeTentativas tentativas={dados.tentativas || []} mostrarAvaliador className="mt-1.5" />
}

// "Origem do requisito": proveniência sob demanda (auditoria/liderança), aberta pelo menu "⋯" do card.
// Folha (bottom sheet): sobe de baixo no celular, fecha no Esc, no fundo e no ✕ de 44px.
function OrigemRequisito({ origem, onFechar }) {
  const req = origem?.requisito || {}
  const classe = origem?.classe || {}
  const versao = origem?.versao || {}
  const omd = (o, rotulo) => o && (
    <li><span className="font-semibold">{rotulo}:</span> {o.id} — {o.titulo} ({fmtData(o.data)}){hrefExterno(o.url) && <> · <a href={hrefExterno(o.url)} target="_blank" rel="noreferrer" className="underline">documento</a></>}</li>
  )
  return (
    <Folha aberta={!!origem} aoFechar={onFechar} titulo="Origem do requisito">
      <div className="text-xs text-muted space-y-2">
        <p className="text-ink">{req.codigo}. {req.descricao}</p>
        <ul className="space-y-1">
          {req.manifesto_id && <li><span className="font-semibold">Item no manifesto:</span> <code>{req.manifesto_id}</code></li>}
          {req.status_fonte && <li><span className="font-semibold">Situação na fonte:</span> {req.status_fonte === 'ALTERADO_POR_OMD' ? 'alterado por OMD' : 'confirmado'}</li>}
          {omd(req.alterado_por_omd, 'Alterado por')}
          {omd(req.confirmado_por_omd, 'Confirmado por')}
          {req.observacao_fonte && <li><span className="font-semibold">Observação:</span> {req.observacao_fonte}</li>}
          {req.conteudo_dinamico && <li><span className="font-semibold">Conteúdo anual:</span> {req.conteudo_dinamico.nome} (<code>{req.conteudo_dinamico.chave}</code>)</li>}
          {req.escolha && <li><span className="font-semibold">Regra:</span> {req.escolha.n_minimo} de {req.escolha.opcoes?.length || 'qualquer'}{req.escolha.sem_repeticao ? ', sem repetir' : ''}</li>}
        </ul>
        <div className="border-t border-line pt-2 space-y-1">
          <div><span className="font-semibold">Classe:</span> {classe.nome}{classe.idade_minima != null ? ` · a partir de ${classe.idade_minima} anos` : ''}</div>
          {hrefExterno(classe.fonte_url) && <div><span className="font-semibold">Página oficial:</span> <a href={hrefExterno(classe.fonte_url)} target="_blank" rel="noreferrer" className="underline break-all">{classe.fonte_url}</a></div>}
          {classe.fonte_publicado_em && <div><span className="font-semibold">Carimbo da página:</span> {fmtData(classe.fonte_publicado_em)} (não é a vigência)</div>}
          {classe.vigente_desde && <div><span className="font-semibold">Vigente desde:</span> {fmtData(classe.vigente_desde)}</div>}
        </div>
        <div className="border-t border-line pt-2 space-y-1">
          <div><span className="font-semibold">Versão:</span> {versao.identificador} {versao.versao} ({ORIGEM_ROTULO[versao.origem] || versao.origem}) · {VERSAO_ROTULO[versao.status] || versao.status}</div>
          {versao.manifesto_versao && <div><span className="font-semibold">Manifesto:</span> {versao.manifesto_versao}, gerado em {fmtData(versao.gerado_em)}</div>}
          {versao.importado_em && <div><span className="font-semibold">Importado em:</span> {fmtData(versao.importado_em)}</div>}
          {versao.fonte_hash && <div className="break-all"><span className="font-semibold">Hash:</span> <code>{versao.fonte_hash}</code></div>}
        </div>
      </div>
    </Folha>
  )
}

// Andamento da seção no cabeçalho ("8/10"): texto + ícone (✓ quando tudo aprovado), nunca só cor.
function ProgressoDaSecao({ feitos, total }) {
  if (!total) return null
  const tudo = feitos === total
  const estilo = tudo ? 'bg-green-600 text-white' : feitos > 0 ? 'bg-amber-400 text-amber-950' : 'bg-white/90 text-gray-700'
  return (
    <span data-testid="progresso-secao" className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold shadow-sm ${estilo}`}>
      {tudo ? '✅ ' : ''}{feitos}/{total}
    </span>
  )
}
