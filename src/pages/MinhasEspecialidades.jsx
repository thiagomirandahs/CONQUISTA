import { Carregando as Esqueleto, Aviso } from '../ui/index.jsx'
import ListaEspecialidades from '../components/especialidades/ListaEspecialidades.jsx'
import { useState, useEffect, useCallback } from 'react'
import { m as motion } from 'framer-motion'
import { useAuth } from '../context/Auth.jsx'
import {
  carregarMinhaEspecialidade, buscarEspecialidades, iniciarEspecialidade,
  salvarRequisitoEspecialidade, enviarRequisitoEspecialidade,
  salvarRelatorioEspecialidade, carregarHistoricoEspecialidade, subirAnexoDeRelatorio,
} from '../lib/dados.js'
import Comprovacao from '../components/Comprovacao.jsx'
import FormularioRelatorio from '../components/relatorio/FormularioRelatorio.jsx'
import HistoricoTentativas from '../components/relatorio/HistoricoTentativas.jsx'
import AvisoCopiaDeSeguranca from '../components/relatorio/AvisoCopiaDeSeguranca.jsx'
import { chaveLocalDe } from '../lib/relatorio/rascunhoLocal.js'
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

const ABAS_MINHAS = [{ valor: 'iniciadas', rotulo: 'Em andamento' }, { valor: 'concluidas', rotulo: 'Concluídas' }]
const ABAS_ESCOLHER = [{ valor: 'disponiveis', rotulo: 'Disponíveis' }]

// Duas vistas: LISTA paginada (Minhas / Escolher) e DETALHE de uma especialidade (o de sempre, com formulário,
// histórico, grupos, bloqueios e prazo). Quem só tem UMA em andamento cai direto no detalhe, como antes.
export default function MinhasEspecialidades() {
  const { profile } = useAuth()
  const [vista, setVista] = useState('carregando') // carregando | lista | detalhe
  const [aba, setAba] = useState('minhas') // minhas | escolher
  const [minha, setMinha] = useState(null)

  const abrir = useCallback(async (memberSpecialtyId = null) => {
    setVista('carregando')
    try {
      const m = await carregarMinhaEspecialidade(memberSpecialtyId)
      if (m) { setMinha(m); setVista('detalhe') } else setVista('lista')
    } catch (e) {
      avisar.erro(e, 'Não consegui abrir a especialidade.')
      setVista('lista')
    }
  }, [])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        // só pergunto quantas estão em andamento (no máximo 2 itens) — nunca o catálogo
        const r = await buscarEspecialidades({ situacao: 'iniciadas', limite: 2 })
        if (!vivo) return
        const unica = (r.itens || []).length === 1 && (r.total ?? 1) === 1
        if (unica) await abrir(r.itens[0].member_specialty_id)
        else setVista('lista')
      } catch {
        if (vivo) setVista('lista') // a própria lista mostra o erro, com "Tentar de novo"
      }
    })()
    return () => { vivo = false }
  }, [abrir])

  if (vista === 'carregando') return <div className="mt-4"><Esqueleto /></div>

  if (vista === 'detalhe' && minha) {
    return (
      <div className="space-y-5">
        <div>
          <button type="button" onClick={() => { setAba('minhas'); setVista('lista') }} data-testid="voltar-lista"
            className="inline-flex min-h-[44px] items-center text-sm font-bold text-brand underline">← Todas as especialidades</button>
          <h2 className="text-2xl font-extrabold text-ink">🏅 Minhas Especialidades</h2>
          <p className="text-sm text-muted">Seu progresso em cada especialidade, requisito por requisito</p>
        </div>
        <Progresso dados={minha} userId={profile?.id} onMudou={() => abrir(minha.member_specialty.id)} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-extrabold text-ink">🏅 Especialidades</h2>
        <p className="text-sm text-muted">Acompanhe as suas ou escolha uma nova para começar</p>
      </div>
      <div role="tablist" aria-label="Especialidades" className="flex gap-2">
        {[['minhas', 'Minhas especialidades'], ['escolher', 'Escolher uma especialidade']].map(([v, r]) => (
          <button key={v} type="button" role="tab" aria-selected={aba === v} onClick={() => setAba(v)}
            className={`min-h-[48px] flex-1 rounded-xl px-2 text-sm font-extrabold ${aba === v ? 'bg-gradient-to-r from-brand to-brand2 shadow-glow' : 'border border-line bg-surface text-muted'}`}
            style={aba === v ? { color: 'var(--marca-1-texto, #fff)' } : undefined}>{r}</button>
        ))}
      </div>
      {aba === 'minhas' ? (
        <ListaEspecialidades key="minhas" abas={ABAS_MINHAS} aoAbrir={(it) => abrir(it.member_specialty_id)} />
      ) : (
        <ListaEspecialidades key="escolher" abas={ABAS_ESCOLHER}
          aoComecar={async (it) => { const r = await iniciarEspecialidade(it.specialty_id); await abrir(r?.member_specialty_id ?? null) }} />
      )}
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
        {(requisitos || []).map((r) => <Requisito key={r.id} r={r} userId={userId} memberSpecialtyId={ms.id} onMudou={onMudou} />)}
      </div>
    </div>
  )
}

function Requisito({ r, userId, memberSpecialtyId, onMudou }) {
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
  const chaveLocal = chaveLocalDe(userId, 'especialidade', r.id)
  // releitura da especialidade (só quando um rascunho local pendente volta a rede): conferir antes de empurrar
  const carregarServidor = async () => {
    const d = await carregarMinhaEspecialidade(memberSpecialtyId)
    const q = (d?.requisitos || []).find((x) => x.id === r.id)
    return { conteudo: q?.rascunho || {}, anexos: q?.anexos || [], rascunhoEm: q?.rascunho_em ?? null, editavel: ['nao_iniciado', 'em_andamento', 'correcao_solicitada'].includes(q?.status) }
  }
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
              valorInicial={{ conteudo: r.rascunho || {}, anexos: r.anexos || [], rascunhoEm: r.rascunho_em ?? null }}
              comentarioDevolucao={comentarioDaCorrecao}
              onSalvarRascunho={salvarForm} onEnviar={enviarForm} chaveLocal={chaveLocal} carregarServidor={carregarServidor}
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
      {!podeEditar && <AvisoCopiaDeSeguranca chaveLocal={chaveLocal} />}

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
