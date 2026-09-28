import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import {
  meuStatus, carregarFeed, curtir, carregarComentarios, comentar, compartilhar, denunciar, apagar, publicar,
  urlDaFoto, tempoRelativo, MOTIVOS_DENUNCIA,
} from '../services/comunidade.js'
import { avisar } from '../ui/avisos.jsx'
import { Aviso, Botao, Cabecalho, Card, Carregando, Folha, Selo, Vazio, mensagemDeErro } from '../ui/index.jsx'

// =============================================================================
//  COMUNIDADE entre clubes (fase 1). O servidor decide TUDO (triagem, autorização dos pais,
//  limites, suspensão, quem comenta onde); esta tela só desenha o que veio e repassa a resposta.
//  Mobile-first: feed de uma coluna, página de 10, fotos com lazy-load, alvos de 44px.
//  Perfil público = primeiro nome + clube (é o que o servidor manda). Sem mensagem privada.
// =============================================================================

// Erro que o servidor escreveu PARA a pessoa (regras da Comunidade): mostramos como veio.
const ERRO_DA_COMUNIDADE = /Comunidade|responsável|pausada|Adultos de outro clube|não está disponível|não publicam|denunciar o que|limite|Espere|Escreva|legenda|comentário pode|Foto inválida|foto/i
const textoDoErro = (e, contexto) => {
  const m = String(e?.message || '')
  return ERRO_DA_COMUNIDADE.test(m) && m.length < 200 ? m : mensagemDeErro(e, contexto)
}

function Inicial({ nome }) {
  return (
    <span aria-hidden="true" className="w-10 h-10 shrink-0 rounded-full grid place-items-center font-extrabold text-white bg-gradient-to-br from-brand to-brand2">
      {(nome || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

function Foto({ path, alt }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let vivo = true
    urlDaFoto(path).then((u) => { if (vivo) setUrl(u) }).catch(() => {})
    return () => { vivo = false }
  }, [path])
  if (!url) return <div className="mt-3 w-full aspect-square rounded-xl bg-surface2 animate-pulse" aria-label="Carregando a foto" />
  // sem link de download nem "abrir em nova aba": a foto só vive dentro do app
  return <img src={url} alt={alt} loading="lazy" decoding="async" draggable={false} onContextMenu={(e) => e.preventDefault()}
    className="mt-3 w-full max-h-[70vh] object-cover rounded-xl bg-surface2 select-none" />
}

function Autor({ autor, criadoEm }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Inicial nome={autor?.nome} />
      <div className="min-w-0">
        <p className="font-extrabold text-ink leading-tight truncate">{autor?.nome}</p>
        <p className="text-xs text-muted truncate">{autor?.clube}{criadoEm ? ` · ${tempoRelativo(criadoEm)}` : ''}</p>
      </div>
    </div>
  )
}

function Publicacao({ post, status, clubeId, aoAtualizar, aoRemover, aoCompartilhado }) {
  const [comentariosAbertos, setComentariosAbertos] = useState(false)
  const [denunciaAberta, setDenunciaAberta] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const podePublicar = !!status?.pode_publicar
  const eh = post.repost

  async function alternarCurtida() {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await curtir(post.id, !post.eu_curti)
      aoAtualizar({ ...post, curtidas: r.curtidas, eu_curti: r.eu_curti })
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui curtir.')) }
    setOcupado(false)
  }

  async function repostar() {
    const alvo = eh && !eh.indisponivel ? eh.id : post.id
    if (!(await avisar.confirmar({ titulo: 'Compartilhar na Comunidade?', descricao: 'Ela aparece no feed com o seu nome.', rotulo: 'Compartilhar', perigo: false }))) return
    try {
      const r = await compartilhar(alvo)
      if (r?.ok) { avisar.sucesso(r.mensagem); aoCompartilhado?.(r.post) } else avisar.info(r?.mensagem)
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui compartilhar.')) }
  }

  async function apagarMeu() {
    if (!(await avisar.confirmar({ titulo: 'Apagar esta publicação?', rotulo: 'Apagar' }))) return
    try { await apagar('post', post.id); aoRemover(post.id); avisar.sucesso('Publicação apagada.') }
    catch (e) { avisar.info(textoDoErro(e, 'Não consegui apagar.')) }
  }

  return (
    <Card as="article" aria-label={`Publicação de ${post.autor?.nome}`} data-testid="post">
      <div className="flex items-start justify-between gap-2">
        <Autor autor={post.autor} criadoEm={post.criado_em} />
        {post.status === 'em_analise' && <Selo tom="atencao">Em análise</Selo>}
      </div>
      {post.status === 'em_analise' && (
        <p className="text-xs text-muted mt-2">Sua foto aparece para todos assim que a diretoria do seu clube aprovar.</p>
      )}
      {post.legenda && <p className="mt-3 text-ink whitespace-pre-line break-words">{post.legenda}</p>}
      {post.foto && <Foto path={post.foto} alt={`Foto de ${post.autor?.nome}`} />}
      {eh && (
        <div className="mt-3 border border-line rounded-xl p-3 bg-surface2" data-testid="repost">
          <p className="text-xs font-bold text-muted mb-2">🔁 Compartilhou</p>
          {eh.indisponivel
            ? <p className="text-sm text-faint">Esta publicação não está mais disponível.</p>
            : (<>
                <Autor autor={eh.autor} criadoEm={eh.criado_em} />
                {eh.legenda && <p className="mt-2 text-ink text-sm whitespace-pre-line break-words">{eh.legenda}</p>}
                {eh.foto && <Foto path={eh.foto} alt={`Foto de ${eh.autor?.nome}`} />}
              </>)}
        </div>
      )}
      {post.status !== 'em_analise' && (
        <div className="mt-3 flex items-center gap-1 -mx-2">
          <button type="button" onClick={alternarCurtida} aria-pressed={!!post.eu_curti} disabled={ocupado} aria-label={`Curtir, ${post.curtidas} curtidas`}
            className="min-h-[44px] min-w-[44px] px-2 rounded-xl text-sm font-bold text-ink hover:bg-surface2">
            <span aria-hidden="true">{post.eu_curti ? '💛' : '🤍'}</span> {post.curtidas}<span className="sr-only"> curtidas</span>
          </button>
          <button type="button" onClick={() => setComentariosAbertos(true)} aria-label={`Ver ${post.comentarios} comentários`}
            className="min-h-[44px] min-w-[44px] px-2 rounded-xl text-sm font-bold text-ink hover:bg-surface2">
            <span aria-hidden="true">💬</span> {post.comentarios}<span className="sr-only"> comentários</span>
          </button>
          {podePublicar && (
            <button type="button" onClick={repostar} aria-label="Compartilhar na Comunidade"
              className="min-h-[44px] min-w-[44px] px-2 rounded-xl text-sm font-bold text-ink hover:bg-surface2">🔁</button>
          )}
          <span className="flex-1" />
          {post.meu
            ? <button type="button" onClick={apagarMeu} className="min-h-[44px] px-3 rounded-xl text-xs font-bold text-muted hover:bg-surface2">Apagar</button>
            : <button type="button" onClick={() => setDenunciaAberta(true)} className="min-h-[44px] px-3 rounded-xl text-xs font-bold text-muted hover:bg-surface2">🚩 Denunciar</button>}
        </div>
      )}
      <Comentarios aberta={comentariosAbertos} aoFechar={() => setComentariosAbertos(false)} post={post} status={status} clubeId={clubeId}
        aoContar={(n) => aoAtualizar({ ...post, comentarios: n })} />
      <Denuncia aberta={denunciaAberta} aoFechar={() => setDenunciaAberta(false)} tipo="post" id={post.id}
        aoOcultar={() => aoRemover(post.id)} />
    </Card>
  )
}

function Denuncia({ aberta, aoFechar, tipo, id, aoOcultar }) {
  const [enviando, setEnviando] = useState(false)
  async function enviar(motivo) {
    setEnviando(true)
    try {
      const r = await denunciar(tipo, id, motivo)
      if (r?.ok) { avisar.sucesso(r.mensagem); if (r.ocultou) aoOcultar?.() } else avisar.info(r?.mensagem)
      aoFechar()
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui enviar a denúncia.')) }
    setEnviando(false)
  }
  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Denunciar">
      <p className="text-sm text-muted mb-3">A diretoria do clube vai revisar. Quem publicou não fica sabendo que foi você.</p>
      <div className="grid gap-2">
        {MOTIVOS_DENUNCIA.map(([chave, rotulo]) => (
          <Botao key={chave} variacao="secundario" desabilitado={enviando} aoTocar={() => enviar(chave)} className="justify-start">{rotulo}</Botao>
        ))}
      </div>
    </Folha>
  )
}

function Comentarios({ aberta, aoFechar, post, status, clubeId, aoContar }) {
  const [itens, setItens] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [recusa, setRecusa] = useState('')
  const [denunciar_, setDenunciar] = useState(null)
  // adulto de OUTRO clube não comenta em publicação de criança (o servidor recusa de qualquer jeito)
  const bloqueadoPorRegra = post.crianca && status?.papel !== 'desbravador' && post.clube_id !== clubeId
  const podeComentar = !!status?.pode_publicar && !bloqueadoPorRegra

  useEffect(() => {
    if (!aberta) return undefined
    let vivo = true
    carregarComentarios(post.id).then((r) => { if (vivo) setItens(r?.itens || []) })
      .catch(() => { if (vivo) setItens([]) })
    return () => { vivo = false }
  }, [aberta, post.id])

  async function enviar(e) {
    e.preventDefault()
    if (!texto.trim() || enviando) return
    setEnviando(true); setRecusa('')
    try {
      const r = await comentar(post.id, texto.trim())
      if (r?.ok) {
        const novos = [r.comentario, ...(itens || [])]
        setItens(novos); setTexto(''); aoContar(novos.length)
      } else setRecusa(r?.mensagem || 'Não foi possível comentar.')
    } catch (err) { setRecusa(textoDoErro(err, 'Não consegui comentar.')) }
    setEnviando(false)
  }

  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Comentários">
      {podeComentar && (
        <form onSubmit={enviar} className="mb-4">
          <label htmlFor={`comentar-${post.id}`} className="sr-only">Escreva um comentário</label>
          <textarea id={`comentar-${post.id}`} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} rows={2}
            placeholder="Escreva algo gentil…" className="w-full min-h-[44px] rounded-xl bg-surface border border-line px-3 py-2.5 text-sm text-ink" />
          {recusa && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2 mt-2">{recusa}</p>}
          <Botao tipo="submit" carregando={enviando} desabilitado={!texto.trim()} className="mt-2 w-full">Comentar</Botao>
        </form>
      )}
      {bloqueadoPorRegra && <p className="text-xs text-muted mb-3">Adultos de outro clube não comentam em publicações de desbravadores. Você pode curtir 🙂</p>}
      {itens === null ? <Carregando linhas={2} /> : itens.length === 0
        ? <p className="text-sm text-faint text-center py-4">Ninguém comentou ainda.</p>
        : (
          <ul className="space-y-3">
            {itens.map((c) => (
              <li key={c.id} className="flex gap-2">
                <Inicial nome={c.autor?.nome} />
                <div className="min-w-0 flex-1 bg-surface2 rounded-xl px-3 py-2">
                  <p className="text-xs font-bold text-ink">{c.autor?.nome} <span className="font-normal text-muted">· {c.autor?.clube}</span></p>
                  <p className="text-sm text-ink break-words">{c.texto}</p>
                  {!c.meu && <button type="button" onClick={() => setDenunciar(c.id)} className="min-h-[44px] text-xs text-muted font-bold">🚩 Denunciar</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      <Denuncia aberta={!!denunciar_} aoFechar={() => setDenunciar(null)} tipo="comentario" id={denunciar_}
        aoOcultar={() => { const n = (itens || []).filter((c) => c.id !== denunciar_); setItens(n); aoContar(n.length) }} />
    </Folha>
  )
}

function NovaPublicacao({ clubeId, userId, aoPublicar }) {
  const [legenda, setLegenda] = useState('')
  const [foto, setFoto] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [recusa, setRecusa] = useState('')
  const input = useRef(null)

  async function enviar(e) {
    e.preventDefault()
    if ((!legenda.trim() && !foto) || enviando) return
    setEnviando(true); setRecusa('')
    try {
      const r = await publicar({ legenda: legenda.trim(), file: foto, clubeId, userId })
      if (r?.ok) {
        avisar.sucesso(r.mensagem)
        setLegenda(''); setFoto(null); if (input.current) input.current.value = ''
        aoPublicar(r.post)
      } else setRecusa(r?.mensagem || 'Não foi possível publicar.')
    } catch (err) { setRecusa(textoDoErro(err, 'Não consegui publicar.')) }
    setEnviando(false)
  }

  return (
    <Card as="form" onSubmit={enviar} aria-label="Nova publicação" className="mb-4">
      <label htmlFor="comunidade-legenda" className="block text-sm font-bold text-ink mb-1">O que você quer compartilhar?</label>
      <textarea id="comunidade-legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={500} rows={3}
        placeholder="Conte como foi a reunião, o acampamento, a especialidade…"
        className="w-full min-h-[44px] rounded-xl bg-surface border border-line px-3 py-2.5 text-sm text-ink" />
      <label htmlFor="comunidade-foto"
        className="mt-3 flex items-center justify-center gap-2 min-h-[64px] rounded-xl border-2 border-dashed border-line text-sm font-bold text-muted cursor-pointer hover:bg-surface2">
        <span aria-hidden="true" className="text-2xl">📷</span>{foto ? 'Trocar a foto' : 'Adicionar foto (opcional)'}
      </label>
      <input ref={input} id="comunidade-foto" type="file" accept="image/*" className="sr-only" onChange={(e) => setFoto(e.target.files?.[0] || null)} />
      {foto && <p className="text-xs text-muted mt-1">Foto escolhida. Ela aparece depois que a diretoria do seu clube aprovar.</p>}
      <p className="text-xs text-faint mt-2">Não mostre documento, endereço, escola ou nome completo. Nada de telefone, @ ou links.</p>
      {recusa && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2 mt-2">{recusa}</p>}
      <Botao tipo="submit" carregando={enviando} desabilitado={!legenda.trim() && !foto} className="mt-3 w-full">Publicar</Botao>
    </Card>
  )
}

const MOTIVO_SEM_ACESSO = {
  sem_autorizacao: ['🔒', 'Falta a autorização do responsável', 'Peça para o seu pai, mãe ou responsável autorizar a Comunidade pelo app (tela Meus filhos).'],
  recurso_desligado: ['🧩', 'A Comunidade não está liberada', 'Este clube ainda não usa a Comunidade.'],
}

export default function Comunidade() {
  const { profile } = useAuth()
  const { clubeId } = useClube()
  const [status, setStatus] = useState(null)
  const [itens, setItens] = useState([])
  const [proximo, setProximo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [maisCarregando, setMaisCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const st = await meuStatus()
      setStatus(st)
      if (st?.pode_ver) {
        const f = await carregarFeed()
        setItens(f?.itens || []); setProximo(f?.proximo || null)
      }
    } catch (e) { setErro(e) }
    setCarregando(false)
  }, [])
  useEffect(() => { carregar() }, [carregar, clubeId])

  async function carregarMais() {
    if (!proximo || maisCarregando) return
    setMaisCarregando(true)
    try {
      const f = await carregarFeed(proximo)
      setItens((a) => [...a, ...(f?.itens || []).filter((n) => !a.some((x) => x.id === n.id))]); setProximo(f?.proximo || null)
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui carregar mais.')) }
    setMaisCarregando(false)
  }

  const atualizar = (p) => setItens((a) => a.map((x) => (x.id === p.id ? p : x)))
  const remover = (id) => setItens((a) => a.filter((x) => x.id !== id))
  const inserir = (p) => { if (p) setItens((a) => [p, ...a.filter((x) => x.id !== p.id)]) }

  const cabecalho = <Cabecalho icone="🌎" titulo="Comunidade" descricao="Os clubes compartilhando. Respeito e segurança em primeiro lugar." />
  if (carregando) return <div>{cabecalho}<Carregando /></div>
  if (erro) return <div>{cabecalho}<Aviso tom="erro" acao={<Botao variacao="secundario" aoTocar={carregar}>Tentar de novo</Botao>}>{textoDoErro(erro, 'Não consegui abrir a Comunidade.')}</Aviso></div>
  if (!status?.pode_ver) {
    const [icone, titulo, texto] = MOTIVO_SEM_ACESSO[status?.motivo] || ['🧩', 'Comunidade indisponível', 'Entre num clube para ver a Comunidade.']
    return <div>{cabecalho}<Vazio icone={icone} titulo={titulo} acao={<Botao variacao="secundario" para="/">Voltar ao início</Botao>}>{texto}</Vazio></div>
  }

  return (
    <div className="max-w-xl mx-auto">
      {cabecalho}
      {status.suspenso_ate && (
        <Aviso tom="erro" titulo="Sua Comunidade está pausada">
          Você recebeu avisos demais. Até {new Date(status.suspenso_ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} dá para olhar, mas não publicar nem comentar.
        </Aviso>
      )}
      {status.pode_publicar && <NovaPublicacao clubeId={clubeId} userId={profile?.id} aoPublicar={inserir} />}
      {itens.length === 0
        ? <Vazio icone="🌱" titulo="Ainda não há publicações">Seja o primeiro a compartilhar algo bom do seu clube!</Vazio>
        : (
          <div className="space-y-3">
            {itens.map((p) => (
              <Publicacao key={p.id} post={p} status={status} clubeId={clubeId} aoAtualizar={atualizar} aoRemover={remover} aoCompartilhado={inserir} />
            ))}
          </div>
        )}
      {proximo && (
        <div className="mt-4 text-center">
          <Botao variacao="secundario" carregando={maisCarregando} aoTocar={carregarMais}>Ver mais</Botao>
        </div>
      )}
      <p className="text-xs text-faint text-center mt-6">Viu algo errado? Toque em 🚩 Denunciar: o conteúdo some na hora e a diretoria revisa. <Link to="/ajuda" className="underline">Ajuda</Link></p>
    </div>
  )
}
