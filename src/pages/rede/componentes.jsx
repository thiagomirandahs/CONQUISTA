import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useImagem } from '../../lib/imagens.js'
import {
  curtir, salvar, compartilhar, denunciar, apagar, carregarComentarios, comentar, urlDaFoto, tempoRelativo,
  MOTIVOS_DENUNCIA, CATEGORIAS_CONQUISTA, iniciais,
} from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { Folha, Carregando, mensagemDeErro } from '../../ui/index.jsx'

// =============================================================================
//  Peças da REDE DBV: visual próprio (fundo claro, gradiente azul→roxo, cards brancos bem
//  arredondados, ícones de linha, botões pill). Sem neon, sem piscar. Alvos ≥ 44px.
// =============================================================================

export const GRADIENTE = 'bg-gradient-to-r from-[#2f5bff] to-[#6a3cff]'
export const CARD = 'bg-white rounded-3xl shadow-[0_2px_14px_-6px_rgba(20,30,80,0.18)] border border-[#e8eaf3]'
export const PILL = 'min-h-[44px] px-4 rounded-full font-bold text-sm inline-flex items-center justify-center gap-2'
export const PILL_PRIMARIA = `${PILL} ${GRADIENTE} text-white shadow-[0_8px_18px_-10px_#4b3cff] disabled:opacity-60`
export const PILL_CLARA = `${PILL} bg-[#eef1ff] text-[#2a2f7a] disabled:opacity-60`
export const TXT = 'text-[#141a3a]'
export const TXT_SUAVE = 'text-[#5c6386]'

// Erro que o servidor escreveu PARA a pessoa (regras da Comunidade): mostramos como veio.
const ERRO_DA_REDE = /Comunidade|responsável|pausada|Adultos de outro clube|não está disponível|não publicam|denunciar o que|limite|Espere|Escreva|legenda|texto pode|comentário pode|Foto inválida|foto|desafio|conquista|descrição|perfil|salvos|ocultar|restaurar/i
export const textoDoErro = (e, contexto) => {
  const m = String(e?.message || '')
  return ERRO_DA_REDE.test(m) && m.length < 200 ? m : mensagemDeErro(e, contexto)
}

// ---------------------------------------------------------------- ícones de linha
const TRACOS = {
  casa: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  trofeu: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M9.5 17h5',
  mais: 'M12 5v14M5 12h14',
  pessoa: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  menu: 'M4 7h16M4 12h16M4 17h16',
  coracao: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z',
  balao: 'M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z',
  repetir: 'M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4',
  marcador: 'M6.5 4h11v16l-5.5-4-5.5 4z',
  bandeira: 'M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11',
  sair: 'M14 5h4.5v14H14M10 8l-4 4 4 4M6 12h9',
  voltar: 'M15 5l-7 7 7 7',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  escudo: 'M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  lixo: 'M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13',
}
export function Icone({ nome, cheio = false, className = 'w-6 h-6', titulo }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={cheio ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={titulo ? undefined : 'true'} role={titulo ? 'img' : undefined}>
      {titulo && <title>{titulo}</title>}
      <path d={TRACOS[nome]} />
    </svg>
  )
}

// ---------------------------------------------------------------- avatar (foto só com autorização)
// O servidor só manda `foto` quando a autorização de uso de imagem está arquivada e o responsável não
// desligou. Sem ela: iniciais num círculo com o gradiente da rede.
export function AvatarRede({ nome, foto, tamanho = 'w-11 h-11', texto = 'text-sm' }) {
  const src = useImagem(foto || null)
  const [erro, setErro] = useState(false)
  if (foto && src && !erro) {
    return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setErro(true)}
      className={`${tamanho} shrink-0 rounded-full object-cover ring-2 ring-white`} />
  }
  return (
    <span aria-hidden="true" className={`${tamanho} ${texto} ${GRADIENTE} shrink-0 rounded-full grid place-items-center font-extrabold text-white ring-2 ring-white`}>
      {iniciais(nome)}
    </span>
  )
}

// ---------------------------------------------------------------- foto do post (largura total, proporção preservada)
function FotoDoPost({ path, alt, aoDuploToque }) {
  const [url, setUrl] = useState(null)
  const [coracao, setCoracao] = useState(0)
  const ultimoToque = useRef(0)
  useEffect(() => {
    let vivo = true
    urlDaFoto(path).then((u) => { if (vivo) setUrl(u) }).catch(() => {})
    return () => { vivo = false }
  }, [path])
  useEffect(() => {
    if (!coracao) return undefined
    const t = setTimeout(() => setCoracao(0), 750)
    return () => clearTimeout(t)
  }, [coracao])

  function tocar() {
    const agora = Date.now()
    if (agora - ultimoToque.current < 320) {
      ultimoToque.current = 0
      setCoracao(agora)
      aoDuploToque?.()
    } else ultimoToque.current = agora
  }

  if (!url) return <div className="w-full aspect-[4/5] bg-[#eceef6] animate-pulse" aria-label="Carregando a foto" />
  // sem link de download nem "abrir em nova aba": a foto só vive dentro do app
  return (
    <div className="relative select-none" onClick={tocar} data-testid="foto-post">
      <img src={url} alt={alt || 'Foto da publicação'} loading="lazy" decoding="async" draggable={false}
        onContextMenu={(e) => e.preventDefault()} className="block w-full h-auto bg-[#eceef6]" />
      {coracao > 0 && (
        <span key={coracao} className="rede-coracao pointer-events-none absolute inset-0 grid place-items-center text-white drop-shadow-lg" data-testid="coracao">
          <Icone nome="coracao" cheio className="w-24 h-24" />
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- denúncia
export function Denuncia({ aberta, aoFechar, tipo, id, aoOcultar }) {
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
      <p className={`text-sm ${TXT_SUAVE} mb-3`}>O conteúdo some na hora e a diretoria do clube revisa. Quem publicou não fica sabendo que foi você.</p>
      <div className="grid gap-2">
        {MOTIVOS_DENUNCIA.map(([chave, rotulo]) => (
          <button key={chave} type="button" disabled={enviando} onClick={() => enviar(chave)} className={`${PILL_CLARA} justify-start w-full`}>{rotulo}</button>
        ))}
      </div>
    </Folha>
  )
}

// ---------------------------------------------------------------- comentários (folha que sobe de baixo)
export function Comentarios({ aberta, aoFechar, post, status, clubeId, aoContar }) {
  const [itens, setItens] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [recusa, setRecusa] = useState('')
  const [denunciarId, setDenunciarId] = useState(null)
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
            placeholder="Escreva algo gentil…" className="w-full min-h-[44px] rounded-2xl bg-[#f5f6fb] border border-[#e1e4f0] px-3 py-2.5 text-sm text-[#141a3a]" />
          {recusa && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-2 mt-2">{recusa}</p>}
          <button type="submit" disabled={!texto.trim() || enviando} className={`${PILL_PRIMARIA} w-full mt-2`}>{enviando ? 'Enviando…' : 'Comentar'}</button>
        </form>
      )}
      {bloqueadoPorRegra && <p className={`text-xs ${TXT_SUAVE} mb-3`}>Adultos de outro clube não comentam em publicações de desbravadores. Você pode curtir 🙂</p>}
      {itens === null ? <Carregando linhas={2} /> : itens.length === 0
        ? <p className={`text-sm ${TXT_SUAVE} text-center py-4`}>Ninguém comentou ainda.</p>
        : (
          <ul className="space-y-3">
            {itens.map((c) => (
              <li key={c.id} className="flex gap-2">
                <AvatarRede nome={c.autor?.nome} foto={c.autor?.foto} tamanho="w-9 h-9" texto="text-xs" />
                <div className="min-w-0 flex-1 bg-[#f5f6fb] rounded-2xl px-3 py-2">
                  <p className={`text-xs font-bold ${TXT}`}>{c.autor?.nome} <span className={`font-normal ${TXT_SUAVE}`}>· {c.autor?.clube}</span></p>
                  <p className={`text-sm ${TXT} break-words`}>{c.texto}</p>
                  {!c.meu && <button type="button" onClick={() => setDenunciarId(c.id)} className={`min-h-[44px] text-xs font-bold ${TXT_SUAVE}`}>Denunciar</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      <Denuncia aberta={!!denunciarId} aoFechar={() => setDenunciarId(null)} tipo="comentario" id={denunciarId}
        aoOcultar={() => { const n = (itens || []).filter((c) => c.id !== denunciarId); setItens(n); aoContar(n.length) }} />
    </Folha>
  )
}

const ROTULO_CONQUISTA = Object.fromEntries(CATEGORIAS_CONQUISTA.map(([k, r, i]) => [k, `${i} ${r}`]))

function Etiqueta({ post }) {
  if (post.tipo === 'desafio' && post.desafio) {
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-[#4b3cff] bg-[#efeaff] rounded-full px-3 py-1">🏅 Desafio: {post.desafio.titulo}</span>
  }
  if (post.tipo === 'conquista') {
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1f5a2e] bg-[#e7f6ea] rounded-full px-3 py-1">Conquista · {ROTULO_CONQUISTA[post.conquista] || 'Conquista'}</span>
  }
  return null
}

function Cabeca({ autor, criadoEm }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <AvatarRede nome={autor?.nome} foto={autor?.foto} />
      <div className="min-w-0">
        {autor?.id
          ? <Link to={`/rede/perfil/${autor.id}`} className={`font-extrabold ${TXT} leading-tight truncate block hover:underline`}>{autor?.nome}</Link>
          : <p className={`font-extrabold ${TXT} leading-tight truncate`}>{autor?.nome}</p>}
        <p className={`text-xs ${TXT_SUAVE} truncate`}>{autor?.clube}{criadoEm ? ` · ${tempoRelativo(criadoEm)}` : ''}</p>
      </div>
    </div>
  )
}

function Acao({ rotulo, pressionado, onClick, children, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={rotulo} aria-pressed={pressionado}
      className={`min-h-[44px] min-w-[44px] px-2 rounded-full inline-flex items-center gap-1.5 text-sm font-bold ${TXT} hover:bg-[#f1f3fb]`}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- o cartão do post
export function CartaoPost({ post, status, clubeId, aoAtualizar, aoRemover, aoCompartilhado }) {
  const [comentariosAbertos, setComentariosAbertos] = useState(false)
  const [denunciaAberta, setDenunciaAberta] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const podePublicar = !!status?.pode_publicar
  const eh = post.repost
  const noAr = post.status !== 'em_analise'

  async function alternarCurtida(forcar) {
    if (ocupado) return
    const novo = forcar ?? !post.eu_curti
    if (novo === post.eu_curti) return
    setOcupado(true)
    try {
      const r = await curtir(post.id, novo)
      aoAtualizar({ ...post, curtidas: r.curtidas, eu_curti: r.eu_curti })
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui curtir.')) }
    setOcupado(false)
  }

  async function alternarSalvo() {
    try {
      const r = await salvar(post.id, !post.eu_salvei)
      aoAtualizar({ ...post, eu_salvei: r.eu_salvei })
      avisar.sucesso(r.eu_salvei ? 'Salvo no seu perfil.' : 'Tirado dos salvos.')
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui salvar.')) }
  }

  async function repostar() {
    const alvo = eh && !eh.indisponivel ? eh.id : post.id
    if (!(await avisar.confirmar({ titulo: 'Compartilhar na rede?', descricao: 'Ela aparece no feed com o seu nome.', rotulo: 'Compartilhar', perigo: false }))) return
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
    <article aria-label={`Publicação de ${post.autor?.nome}`} data-testid="post" className={`${CARD} overflow-hidden`}>
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <Cabeca autor={post.autor} criadoEm={post.criado_em} />
        {post.status === 'em_analise' && <span className="shrink-0 text-xs font-bold text-amber-800 bg-amber-100 rounded-full px-3 py-1">Em análise</span>}
      </div>
      {(post.tipo === 'desafio' || post.tipo === 'conquista') && <div className="px-4 pb-2"><Etiqueta post={post} /></div>}
      {post.status === 'em_analise' && <p className={`px-4 pb-2 text-xs ${TXT_SUAVE}`}>Sua foto aparece para todos assim que a diretoria do seu clube aprovar.</p>}
      {post.legenda && <p className={`px-4 pb-3 ${TXT} whitespace-pre-line break-words`}>{post.legenda}</p>}
      {post.foto && <FotoDoPost path={post.foto} alt={post.foto_alt} aoDuploToque={noAr ? () => alternarCurtida(true) : undefined} />}
      {!post.foto && post.foto_expirada && (
        <p className={`mx-4 mb-3 rounded-2xl bg-[#f5f6fb] p-4 text-center text-sm ${TXT_SUAVE}`}>📷 Foto expirada (as fotos ficam 90 dias na rede)</p>
      )}
      {eh && (
        <div className="mx-4 mb-3 border border-[#e8eaf3] rounded-2xl p-3 bg-[#f8f9fd]" data-testid="repost">
          <p className={`text-xs font-bold ${TXT_SUAVE} mb-2 flex items-center gap-1`}><Icone nome="repetir" className="w-4 h-4" /> Compartilhou</p>
          {eh.indisponivel
            ? <p className={`text-sm ${TXT_SUAVE}`}>Esta publicação não está mais disponível.</p>
            : (<>
                <Cabeca autor={eh.autor} criadoEm={eh.criado_em} />
                {eh.legenda && <p className={`mt-2 ${TXT} text-sm whitespace-pre-line break-words`}>{eh.legenda}</p>}
                {eh.foto && <div className="mt-2 rounded-2xl overflow-hidden"><FotoDoPost path={eh.foto} alt={eh.foto_alt} /></div>}
              </>)}
        </div>
      )}
      {noAr && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-t border-[#f0f1f7]">
          <Acao rotulo={`Curtir, ${post.curtidas} curtidas`} pressionado={!!post.eu_curti} disabled={ocupado} onClick={() => alternarCurtida()}>
            <Icone nome="coracao" cheio={!!post.eu_curti} className={`w-6 h-6 ${post.eu_curti ? 'text-[#e0245e]' : ''}`} /> {post.curtidas}
          </Acao>
          <Acao rotulo={`Ver ${post.comentarios} comentários`} onClick={() => setComentariosAbertos(true)}>
            <Icone nome="balao" /> {post.comentarios}
          </Acao>
          {podePublicar && <Acao rotulo="Compartilhar na rede" onClick={repostar}><Icone nome="repetir" /></Acao>}
          <span className="flex-1" />
          <Acao rotulo={post.eu_salvei ? 'Tirar dos salvos' : 'Salvar'} pressionado={!!post.eu_salvei} onClick={alternarSalvo}>
            <Icone nome="marcador" cheio={!!post.eu_salvei} />
          </Acao>
          {post.meu
            ? <Acao rotulo="Apagar publicação" onClick={apagarMeu}><Icone nome="lixo" /></Acao>
            : <Acao rotulo="Denunciar" onClick={() => setDenunciaAberta(true)}><Icone nome="bandeira" /></Acao>}
        </div>
      )}
      <Comentarios aberta={comentariosAbertos} aoFechar={() => setComentariosAbertos(false)} post={post} status={status} clubeId={clubeId}
        aoContar={(n) => aoAtualizar({ ...post, comentarios: n })} />
      <Denuncia aberta={denunciaAberta} aoFechar={() => setDenunciaAberta(false)} tipo="post" id={post.id}
        aoOcultar={() => aoRemover(post.id)} />
    </article>
  )
}

// Lista de posts com "ver mais" (paginação leve: 10 por vez)
export function ListaDePosts({ itens, setItens, proximo, carregarMais, maisCarregando, status, clubeId, vazio }) {
  const atualizar = (p) => setItens((a) => a.map((x) => (x.id === p.id ? p : x)))
  const remover = (id) => setItens((a) => a.filter((x) => x.id !== id))
  const inserir = (p) => { if (p) setItens((a) => [p, ...a.filter((x) => x.id !== p.id)]) }
  if (!itens.length) return vazio
  return (
    <>
      <div className="space-y-4">
        {itens.map((p) => (
          <CartaoPost key={p.id} post={p} status={status} clubeId={clubeId} aoAtualizar={atualizar} aoRemover={remover} aoCompartilhado={inserir} />
        ))}
      </div>
      {proximo && (
        <div className="mt-4 text-center">
          <button type="button" onClick={carregarMais} disabled={maisCarregando} className={PILL_CLARA}>{maisCarregando ? 'Carregando…' : 'Ver mais'}</button>
        </div>
      )}
    </>
  )
}

export function VazioRede({ icone = '🌱', titulo, children }) {
  return (
    <div className={`${CARD} p-8 text-center`}>
      <div className="text-4xl mb-2" aria-hidden="true">{icone}</div>
      <p className={`font-extrabold ${TXT}`}>{titulo}</p>
      {children && <p className={`text-sm ${TXT_SUAVE} mt-1`}>{children}</p>}
    </div>
  )
}
