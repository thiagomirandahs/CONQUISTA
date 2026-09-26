// Suporte (central de chamados) — "Eu" → Suporte. Qualquer pessoa logada abre chamado, acompanha o
// status e conversa com a equipe da plataforma. Só o autor e a plataforma veem (migration 290).
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClube } from '../context/Clube.jsx'
import { Botao, Campo, Selecao, Aviso, Card, Carregando, Vazio } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import {
  CATEGORIAS, ROTULO_CATEGORIA, ROTULO_STATUS_CHAMADO, PRIORIDADES,
  chamadoAbrir, meusChamados, chamadoVer, chamadoResponder, enviarAnexo, urlDoAnexo, validarAnexo, contextoTecnico,
} from '../services/suporte.js'

const TOM = {
  aberto: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  em_andamento: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  aguardando_usuario: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  resolvido: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  fechado: 'bg-surface2 text-muted',
}
export function StatusChamado({ status }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TOM[status] || TOM.fechado}`}>{ROTULO_STATUS_CHAMADO[status] || status}</span>
}
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')

export default function Suporte() {
  const [params, setParams] = useSearchParams()
  const aberto = params.get('chamado')
  const [novo, setNovo] = useState(false)
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(() => {
    meusChamados().then((l) => { setErro(''); setLista(l) }).catch((e) => setErro(e.message))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const abrir = (id) => { setNovo(false); setParams(id ? { chamado: id } : {}) }

  if (aberto) return <Conversa id={aberto} aoVoltar={() => { abrir(null); carregar() }} />
  if (novo) return <NovoChamado aoCancelar={() => setNovo(false)} aoCriar={(id) => { carregar(); abrir(id) }} />

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <header className="pt-1">
        <h1 className="text-lg font-extrabold text-ink">Suporte</h1>
        <p className="text-sm text-muted">Fale com a equipe do DesbravaClube. Só você e o suporte veem seus chamados.</p>
      </header>
      <Botao className="w-full" aoTocar={() => setNovo(true)} data-testid="novo-chamado">＋ Abrir chamado</Botao>
      <section>
        <h2 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-faint">Meus chamados</h2>
        {erro && <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>}
        {!erro && lista == null && <Carregando />}
        {lista?.length === 0 && <Vazio icone="🛟" titulo="Nenhum chamado ainda">Tem uma dúvida ou encontrou um problema? Abra um chamado.</Vazio>}
        {lista?.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {lista.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => abrir(c.id)} className="flex w-full min-h-[64px] items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{c.assunto}</span>
                    <span className="block text-xs text-faint">{ROTULO_CATEGORIA[c.categoria]} · {dataHora(c.atualizado_em)}</span>
                  </span>
                  <StatusChamado status={c.status} />
                  <span aria-hidden="true" className="text-faint">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function CampoAnexo({ arquivo, aoMudar, id = 'anexo' }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs font-semibold text-muted mb-1">Print (opcional, até 3 MB)</label>
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp"
        className="block w-full min-h-[44px] text-sm text-ink file:mr-3 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-surface2 file:px-3 file:font-semibold"
        onChange={(e) => {
          const f = e.target.files?.[0] || null
          const msg = validarAnexo(f)
          if (msg) { avisar.erro(msg); e.target.value = ''; aoMudar(null); return }
          aoMudar(f)
        }} />
      {arquivo && <p className="mt-1 text-xs text-muted">📎 {arquivo.name}</p>}
    </div>
  )
}

function NovoChamado({ aoCancelar, aoCriar }) {
  const { marca, papel } = useClube()
  const [categoria, setCategoria] = useState('')
  const [assunto, setAssunto] = useState('')
  const [descricao, setDescricao] = useState('')
  const [prioridade, setPrioridade] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const ehDiretoria = papel === 'diretoria'

  async function enviar(e) {
    e.preventDefault()
    setErro('')
    if (!categoria) return setErro('Escolha uma categoria.')
    if (assunto.trim().length < 3) return setErro('Escreva um assunto (mínimo 3 letras).')
    if (descricao.trim().length < 10) return setErro('Descreva com pelo menos 10 caracteres.')
    setEnviando(true)
    try {
      const anexo = arquivo ? await enviarAnexo(arquivo) : null
      const id = await chamadoAbrir({
        categoria, assunto: assunto.trim(), descricao: descricao.trim(), anexo,
        prioridadeSugerida: ehDiretoria && prioridade ? prioridade : null,
        contexto: contextoTecnico({ clube: marca?.nome, papel }),
      })
      avisar.sucesso('Chamado aberto! Avisaremos quando o suporte responder.')
      aoCriar(id)
    } catch (err) {
      setErro(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="max-w-2xl mx-auto space-y-3" noValidate>
      <button type="button" onClick={aoCancelar} className="min-h-[44px] text-sm font-semibold text-brand">‹ Voltar</button>
      <h1 className="text-lg font-extrabold text-ink">Abrir chamado</h1>
      <Card>
        <Selecao id="categoria" rotulo="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}
          opcoes={[['', 'Escolha…'], ...CATEGORIAS]} />
        <Campo id="assunto" rotulo="Assunto" maxLength={120} value={assunto} onChange={(e) => setAssunto(e.target.value)} />
        <Campo id="descricao" rotulo="Descreva o que aconteceu" linhas={5} maxLength={4000} value={descricao}
          onChange={(e) => setDescricao(e.target.value)} ajuda="Não escreva senhas nem dados de cartão." />
        {ehDiretoria && (
          <Selecao id="prioridade" rotulo="Prioridade sugerida (diretoria)" value={prioridade} onChange={(e) => setPrioridade(e.target.value)}
            opcoes={[['', 'Normal'], ...PRIORIDADES.filter(([k]) => k !== 'normal')]} />
        )}
        <CampoAnexo arquivo={arquivo} aoMudar={setArquivo} />
        <p className="text-xs text-faint">Enviamos junto só a versão do app, a tela, o clube, seu papel e o tipo de aparelho — para ajudar no diagnóstico.</p>
      </Card>
      {erro && <Aviso tom="erro" titulo="Não foi possível abrir">{erro}</Aviso>}
      <Botao tipo="submit" className="w-full" carregando={enviando} desabilitado={enviando}>Enviar chamado</Botao>
    </form>
  )
}

export function Anexo({ caminho }) {
  const [url, setUrl] = useState(null)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    let vivo = true
    urlDoAnexo(caminho).then((u) => vivo && setUrl(u)).catch(() => vivo && setFalhou(true))
    return () => { vivo = false }
  }, [caminho])
  if (falhou) return <p className="text-xs text-muted">📎 anexo indisponível</p>
  if (!url) return <p className="text-xs text-muted">📎 carregando anexo…</p>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 block">
      <img src={url} alt="Anexo do chamado" className="max-h-48 rounded-lg border border-line object-contain" />
    </a>
  )
}

function Conversa({ id, aoVoltar }) {
  const [c, setC] = useState(null)
  const [erro, setErro] = useState('')
  const [texto, setTexto] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(() => {
    chamadoVer(id).then((d) => { setErro(''); setC(d) }).catch((e) => setErro(e.message))
  }, [id])
  useEffect(() => { carregar() }, [carregar])

  async function responder(e) {
    e.preventDefault()
    if (!texto.trim()) return
    setEnviando(true)
    try {
      const anexo = arquivo ? await enviarAnexo(arquivo) : null
      await chamadoResponder(id, texto.trim(), anexo)
      setTexto(''); setArquivo(null)
      carregar()
    } catch (err) {
      avisar.erro(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <button type="button" onClick={aoVoltar} className="min-h-[44px] text-sm font-semibold text-brand">‹ Meus chamados</button>
      {erro && <Aviso tom="erro" titulo="Não deu pra abrir">{erro}</Aviso>}
      {!erro && !c && <Carregando />}
      {c && (
        <>
          <header>
            <h1 className="text-lg font-extrabold text-ink">{c.assunto}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusChamado status={c.status} /> {ROTULO_CATEGORIA[c.categoria]} · aberto em {dataHora(c.criado_em)}
            </p>
          </header>
          <ol className="space-y-2" aria-label="Conversa">
            {c.mensagens.map((m) => (
              <li key={m.id} className={`rounded-2xl border p-3 ${m.origem === 'suporte' ? 'border-[#f5c518]/40 bg-[#f5c518]/10 mr-6' : 'border-line bg-surface ml-6'}`}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-faint">{m.origem === 'suporte' ? 'Suporte DesbravaClube' : 'Você'} · {dataHora(m.criado_em)}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{m.texto}</p>
                {m.anexo_path && <Anexo caminho={m.anexo_path} />}
              </li>
            ))}
          </ol>
          {c.pode_responder ? (
            <form onSubmit={responder} className="space-y-2">
              <Card>
                <Campo id="resposta" rotulo={c.status === 'resolvido' ? 'Ainda com problema? Responda para reabrir' : 'Responder'}
                  linhas={3} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
                <CampoAnexo id="anexo-resposta" arquivo={arquivo} aoMudar={setArquivo} />
              </Card>
              <Botao tipo="submit" className="w-full" carregando={enviando} desabilitado={enviando || !texto.trim()}>
                {c.status === 'resolvido' ? 'Reabrir e enviar' : 'Enviar resposta'}
              </Botao>
            </form>
          ) : (
            <Aviso tom="info" titulo="Chamado encerrado">Se precisar, abra um novo chamado.</Aviso>
          )}
        </>
      )}
    </div>
  )
}
