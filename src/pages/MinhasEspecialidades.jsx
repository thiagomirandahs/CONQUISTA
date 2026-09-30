import { Carregando as Esqueleto, Aviso } from '../ui/index.jsx'
import { useState, useEffect, useCallback } from 'react'
import { m as motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import {
  carregarMinhaEspecialidade, carregarEspecialidadesDisponiveis, iniciarEspecialidade,
  salvarRequisitoEspecialidade, enviarRequisitoEspecialidade,
  salvarRelatorioEspecialidade, carregarHistoricoEspecialidade, subirAnexoDeRelatorio,
} from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import FormularioRelatorio from '../components/relatorio/FormularioRelatorio.jsx'
import HistoricoTentativas from '../components/relatorio/HistoricoTentativas.jsx'
import { schemaDoModelo, fmtDataBR } from '../lib/relatorio/conteudo.js'
import { vitoria as festa } from '../lib/juice.js'
import { mensagemDeErro, ZonaUpload } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'

const STATUS_INFO = {
  nao_iniciado: { label: 'Não iniciado', badge: 'bg-surface2 text-muted border border-line', icon: '⚪' },
  em_andamento: { label: 'Em andamento', badge: 'bg-blue-50 text-blue-700 border border-blue-200', icon: '✏️' },
  aguardando_avaliacao: { label: 'Aguardando avaliação', badge: 'bg-amber-50 text-amber-700 border border-amber-200', icon: '⏳' },
  aprovado: { label: 'Aprovado', badge: 'bg-green-50 text-green-700 border border-green-200', icon: '✅' },
  correcao_solicitada: { label: 'Correção solicitada', badge: 'bg-red-50 text-red-700 border border-red-200', icon: '↺' },
}

const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

export default function MinhasEspecialidades() {
  const { profile } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [minha, setMinha] = useState(null)
  const [disponiveis, setDisponiveis] = useState([])
  const [erro, setErro] = useState('')

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const m = await carregarMinhaEspecialidade()
      setMinha(m)
      setDisponiveis(await carregarEspecialidadesDisponiveis())
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não consegui carregar as especialidades.'))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  async function iniciar(specialtyId) {
    try {
      await iniciarEspecialidade(specialtyId)
      await recarregar()
    } catch (e) {
      avisar.erro(e)
    }
  }

  if (carregando) return <div className="mt-4"><Esqueleto /></div>

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-ink">🏅 Minhas Especialidades</h2>
        <p className="text-sm text-muted">Seu progresso em cada especialidade, requisito por requisito</p>
      </div>

      {erro && <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">{erro}</div>}

      {minha && <Progresso dados={minha} userId={profile?.id} onMudou={recarregar} />}

      <ListaDisponiveis disponiveis={disponiveis} onIniciar={iniciar} />
    </div>
  )
}

function ListaDisponiveis({ disponiveis, onIniciar }) {
  if (disponiveis.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-bold text-faint uppercase tracking-wide mb-2">Disponíveis pra começar</h3>
      <div className="space-y-2">
        {disponiveis.map((sp) => {
          const bloqueada = (sp.dependencias_pendentes || []).length > 0
          return (
            <div key={sp.specialty_id} className="bg-surface rounded-2xl p-4 shadow-soft flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-ink truncate">{sp.nome}</div>
                <div className="text-xs text-faint truncate">{[sp.categoria, sp.nivel].filter(Boolean).join(' · ')}</div>
                {sp.curriculum_version?.origem === 'piloto_teste' && (
                  <span className="inline-block mt-1 text-xs font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    Dados de teste
                  </span>
                )}
                {bloqueada && (
                  <p className="text-xs text-red-700 mt-1">🔒 Falta concluir antes: {sp.dependencias_pendentes.join(', ')}</p>
                )}
              </div>
              <button onClick={() => onIniciar(sp.specialty_id)} disabled={bloqueada}
                className="shrink-0 rounded-xl bg-gradient-to-r from-brand to-brand2 text-white font-bold text-sm px-4 py-2 shadow-glow disabled:opacity-40">
                Iniciar
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Progresso({ dados, userId, onMudou }) {
  const { member_specialty: ms, especialidade, curriculum_version: versao, oferta, requisitos } = dados
  const ehTeste = versao?.origem === 'piloto_teste'

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-2xl p-5 shadow-soft">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-extrabold text-ink text-lg">{especialidade?.nome}</h3>
          {ehTeste && (
            <span className="text-xs font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              Dados de teste
            </span>
          )}
        </div>
        {oferta?.titulo && <p className="text-xs text-faint mb-1">Turma: {oferta.titulo}{oferta.instrutor_responsavel_nome ? ` · com ${oferta.instrutor_responsavel_nome}` : ''}</p>}
        {ehTeste && <p className="text-xs text-faint mb-2">{versao.fonte_descricao}</p>}
        <div className="w-full bg-surface2 rounded-full h-3 overflow-hidden mt-2">
          <motion.div className="h-full bg-gradient-to-r from-brand to-brand2" initial={{ width: 0 }}
            animate={{ width: `${ms.percentual}%` }} transition={{ duration: 0.6 }} />
        </div>
        <p className="text-sm text-muted mt-1.5">{ms.percentual}% concluído · iniciada em {fmtData(ms.iniciada_em)}</p>
        {(dados.grupos || []).length > 0 && (
          <ul className="mt-3 space-y-1" data-testid="grupos">
            {dados.grupos.map((g) => (
              <li key={g.chave} data-testid="grupo" className="rounded-lg bg-surface2 px-3 py-1.5 text-sm text-ink">
                <span className="font-semibold">{g.rotulo}</span>
                {' — '}{g.aprovados >= g.minimo ? '✅ ' : ''}{g.aprovados} de {g.minimo} feitas
              </li>
            ))}
          </ul>
        )}
        {ms.status === 'concluida' && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-800 font-semibold">
            🏅 Especialidade concluída!
          </div>
        )}
      </div>

      <div className="bg-surface rounded-2xl shadow-soft overflow-hidden divide-y divide-line">
        {(requisitos || []).map((r) => <Requisito key={r.id} r={r} userId={userId} onMudou={onMudou} />)}
      </div>
    </div>
  )
}

function Requisito({ r, userId, onMudou }) {
  const info = STATUS_INFO[r.status] || STATUS_INFO.nao_iniciado
  const [texto, setTexto] = useState(r.evidencia_texto || '')
  const [foto, setFoto] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [mostrarHistorico, setMostrarHistorico] = useState(false)
  const [tentativas, setTentativas] = useState(null) // histórico completo (só requisito com formulário)
  const schema = schemaDoModelo(r.modelo)
  const bloqueios = r.bloqueios || []
  const idBloqueios = `bloq-esp-${r.id}`

  const podeEditar = ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(r.status)
  const precisaTexto = r.tipo_evidencia === 'texto'
  const precisaFoto = r.tipo_evidencia === 'foto'

  async function salvar() {
    setOcupado(true); setErro('')
    try {
      await salvarRequisitoEspecialidade({ requirementId: r.id, texto: precisaTexto ? texto : null, foto: precisaFoto ? foto : null, userId })
      await onMudou()
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não consegui salvar o requisito.')); setOcupado(false)
    }
  }

  async function enviar() {
    setOcupado(true); setErro('')
    try {
      if ((precisaTexto && texto.trim()) || (precisaFoto && foto)) {
        await salvarRequisitoEspecialidade({ requirementId: r.id, texto: precisaTexto ? texto : null, foto: precisaFoto ? foto : null, userId })
      }
      await enviarRequisitoEspecialidade(r.id)
      festa()
      await onMudou()
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não consegui enviar o requisito.')); setOcupado(false)
    }
  }

  const comentarioDaCorrecao = r.status === 'correcao_solicitada'
    ? ([...(r.avaliacoes || [])].reverse().find((a) => a.decisao === 'correcao_solicitada' && a.comentario)?.comentario || '')
    : ''
  const salvarForm = (conteudo, anexos) => salvarRelatorioEspecialidade({ requirementId: r.id, conteudo, anexos })
  async function enviarForm(conteudo, anexos) {
    await salvarForm(conteudo, anexos)
    await enviarRequisitoEspecialidade(r.id)
    festa()
    await onMudou()
  }
  async function alternarTentativas() {
    if (tentativas) { setTentativas(null); return }
    try { setTentativas(await carregarHistoricoEspecialidade(r.member_specialty_requirement_id)) } catch (e) { avisar.erro(e) }
  }

  return (
    <div className="p-4" data-testid="requisito-especialidade">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-semibold text-ink leading-snug">{r.codigo}. {r.descricao}</p>
        <span className={`shrink-0 text-xs font-bold rounded-full px-2 py-0.5 ${info.badge}`}>{info.icon} {info.label}</span>
      </div>
      {r.prazo_em && r.status !== 'aprovado' && (
        <p data-testid="prazo" className="mb-1.5 text-xs font-semibold text-muted">📅 Até {fmtDataBR(r.prazo_em).slice(0, 5)}</p>
      )}

      {r.status === 'aprovado' ? (
        <>
          {r.evidencia_texto && <p className="text-sm text-muted italic mt-1">"{r.evidencia_texto}"</p>}
          {r.evidencia_path && <Comprovacao valor={r.evidencia_path} alt="evidência" classImg="mt-2 w-32 h-32 object-cover rounded-lg" />}
        </>
      ) : podeEditar ? (
        <div className="mt-2 space-y-2">
          {r.status === 'correcao_solicitada' && !schema && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              A liderança pediu correção — veja o comentário no histórico abaixo e envie de novo.
            </p>
          )}
          {schema && (
            <FormularioRelatorio key={r.id} schema={schema}
              valorInicial={{ conteudo: r.rascunho || {}, anexos: r.anexos || [] }}
              comentarioDevolucao={comentarioDaCorrecao}
              onSalvarRascunho={salvarForm} onEnviar={enviarForm}
              subirAnexo={(file) => subirAnexoDeRelatorio(file, userId)}
              enviarDesativado={bloqueios.length > 0} descricaoEnviarId={idBloqueios} />
          )}
          {bloqueios.length > 0 && (
            <ul id={idBloqueios} data-testid="bloqueios" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 space-y-0.5">
              {bloqueios.map((b, i) => <li key={i}>🔒 {b}</li>)}
            </ul>
          )}
          {!schema && precisaTexto && (
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escreva aqui..."
              className="w-full text-sm rounded-lg border border-line px-3 py-2" />
          )}
          {!schema && precisaFoto && (
            /* ZonaUpload (design system), igual à de Minha Classe: a foto salva vem do bucket privado como
               `miniatura`; "Remover" só para a foto escolhida agora. Validação/compressão seguem no service. */
            <ZonaUpload rotulo="Foto de comprovação" accept="image/*" arquivo={foto} aoEscolher={setFoto}
              aoRemover={foto ? () => setFoto(null) : undefined} estado={ocupado && foto ? 'enviando' : undefined} progresso="Só um instante"
              miniatura={!foto && r.evidencia_path
                ? <Comprovacao valor={r.evidencia_path} alt="evidência salva" classImg="max-h-48 w-auto rounded-xl object-contain shadow-soft" />
                : undefined} />
          )}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {!schema && (
          <div className="flex gap-2">
            {(precisaTexto || precisaFoto) && (
              <button onClick={salvar} disabled={ocupado} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60">
                Salvar rascunho
              </button>
            )}
            <button onClick={enviar} disabled={ocupado} className="rounded-lg bg-gradient-to-r from-brand to-brand2 text-white px-3 py-1.5 text-xs font-bold shadow-glow disabled:opacity-60">
              {ocupado ? 'Enviando...' : 'Enviar para avaliação'}
            </button>
          </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-faint mt-1">Aguardando a liderança avaliar.</p>
      )}

      {schema && r.tentativas > 0 && r.member_specialty_requirement_id && (
        <div className="mt-2">
          <button type="button" onClick={alternarTentativas} data-testid="ver-tentativas"
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-faint underline">
            {tentativas ? 'Esconder' : 'Ver'} histórico ({r.tentativas} tentativa{r.tentativas === 1 ? '' : 's'})
          </button>
          {tentativas && <HistoricoTentativas tentativas={tentativas.tentativas || []} modelo={tentativas.modelo} mostrarAvaliador className="mt-1.5" />}
        </div>
      )}
      {!schema && (r.avaliacoes || []).length > 0 && (
        <div className="mt-2">
          <button onClick={() => setMostrarHistorico((v) => !v)} className="text-xs font-semibold text-faint underline">
            {mostrarHistorico ? 'Esconder' : 'Ver'} histórico de avaliação ({r.avaliacoes.length})
          </button>
          {mostrarHistorico && (
            <ul className="mt-1.5 space-y-1">
              {r.avaliacoes.map((a, i) => (
                <li key={i} className="text-xs text-muted bg-surface2 rounded-lg px-3 py-1.5">
                  <span className="font-semibold">{a.decisao === 'aprovado' ? '✅ Aprovado' : '↺ Correção solicitada'}</span>
                  {' '}por {a.avaliado_por_nome} ({a.avaliado_papel}) em {fmtData(a.created_at)}
                  {a.comentario && <div className="italic mt-0.5">"{a.comentario}"</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
