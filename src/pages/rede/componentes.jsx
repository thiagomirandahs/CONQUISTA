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
//  Peças da REDE DBV — ESTILO INSTAGRAM (refeito em 29/09/2026 a pedido do dono): fundo BRANCO,
//  posts de ponta a ponta (sem card com margem), separador fino, ícones de linha, azul de ação
//  #3b5bff, anéis de story azul→roxo. Nada de sublinhado em nomes/rótulos, nada de neon.
//  Mobile-first 375–430 px, alvos ≥ 44 px, sem rolagem lateral da página.
// =============================================================================

export const AZUL = '#3b5bff'
export const GRADIENTE = 'bg-gradient-to-tr from-[#3b5bff] to-[#8b5cf6]'
export const CARD = 'bg-white rounded-2xl border border-[#e2e8f0]'
export const PILL = 'min-h-[44px] px-4 rounded-full font-semibold text-sm inline-flex items-center justify-center gap-2 no-underline'
export const PILL_PRIMARIA = `${PILL} bg-[#3b5bff] text-white disabled:opacity-50`
export const PILL_CLARA = `${PILL} bg-[#f1f5f9] text-[#0f172a] disabled:opacity-50`
export const TXT = 'text-[#0f172a]'
export const TXT_SUAVE = 'text-[#64748b]'
export const LINHA = 'border-[#eef1f5]'

// Erro que o servidor escreveu PARA a pessoa (regras da Comunidade): mostramos como veio.
const ERRO_DA_REDE = /Comunidade|Rede DBV|responsável|pausada|Adultos de outro clube|não está disponível|não publicam|denunciar o que|limite|Espere|Escreva|legenda|texto pode|texto do story|comentário pode|Foto inválida|foto|story|desafio|conquista|descrição|perfil|salvos|ocultar|restaurar|clube/i
export const textoDoErro = (e, contexto) => {
  const m = String(e?.message || '')
  return ERRO_DA_REDE.test(m) && m.length < 200 ? m : mensagemDeErro(e, contexto)
}

// ---------------------------------------------------------------- ícones de linha (SVG inline)
const TRACOS = {
  casa: 'M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5.5h3V20H18V9.5',
  busca: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l4.5 4.5',
  trofeu: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M9.5 17h5',
  mais: 'M12 5v14M5 12h14',
  maisQuadrado: 'M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4ZM12 8v8M8 12h8',
  pessoa: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  menu: 'M4 7h16M4 12h16M4 17h16',
  pontos: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  coracao: 'M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z',
  balao: 'M20 11.5a8 8 0 0 1-11.6 7.2L4 20l1.3-4.2A8 8 0 1 1 20 11.5Z',
  enviar: 'M21 3.5 10.5 14M21 3.5l-6.5 17-4-6.5-7-4z',
  repetir: 'M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4',
  marcador: 'M6.5 4h11v16l-5.5-4-5.5 4z',
  bandeira: 'M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11',
  sair: 'M14 5h4.5v14H14M10 8l-4 4 4 4M6 12h9',
  voltar: 'M15 5l-7 7 7 7',
  fechar: 'M6 6l12 12M18 6 6 18',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  escudo: 'M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  lixo: 'M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13',
  grade: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  texto: 'M5 6h14M5 10.5h14M5 15h10M5 19.5h6',
  seta: 'M6 9l6 6 6-6',
  sino: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
}
export function Icone({ nome, cheio = false, className = 'w-6 h-6', titulo, traco = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill={cheio ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={nome === 'pontos' ? 3 : traco} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={titulo ? undefined : 'true'} role={titulo ? 'img' : undefined}>
      {titulo && <title>{titulo}</title>}
      <path d={TRACOS[nome]} />
    </svg>
  )
}

// ---------------------------------------------------------------- avatar (foto só com autorização)
// O servidor só manda `foto` quando a autorização de uso de imagem está arquivada e o responsável não
// desligou. Sem ela: iniciais num círculo claro.
export function AvatarRede({ nome, foto, tamanho = 'w-9 h-9', texto = 'text-xs' }) {
  const src = useImagem(foto || null)
  const [erro, setErro] = useState(false)
  if (foto && src && !erro) {
    return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setErro(true)}
      className={`${tamanho} shrink-0 rounded-full object-cover bg-[#f1f5f9]`} />
  }
  return (
    <span aria-hidden="true" className={`${tamanho} ${texto} shrink-0 rounded-full grid place-items-center font-bold text-[#3b5bff] bg-[#eef2ff]`}>
      {iniciais(nome)}
    </span>
  )
}

// Anel do story em volta do avatar: colorido = não visto; cinza = visto; sem anel = sem story.
export function AnelStory({ estado = 'nenhum', children }) {
  if (estado === 'nenhum') return children
  return (
    <span className={`inline-grid place-items-center rounded-full p-[2.5px] ${estado === 'novo' ? GRADIENTE : 'bg-[#cbd5e1]'}`}>
      <span className="rounded-full bg-white p-[2px] grid place-items-center">{children}</span>
    </span>
  )
}

// ---------------------------------------------------------------- foto do post (largura total, 4:5)
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

  if (!url) return <div className="w-full aspect-[4/5] bg-[#f1f5f9] animate-pulse" aria-label="Carregando a foto" />
  // sem link de download nem "abrir em nova aba": a foto só vive dentro do app
  return (
    <div className="relative select-none w-full aspect-[4/5] bg-[#f1f5f9] overflow-hidden" onClick={tocar} data-testid="foto-post">
      <img src={url} alt={alt || 'Foto da publicação'} loading="lazy" decoding="async" draggable={false}
        onContextMenu={(e) => e.preventDefault()} className="block w-full h-full object-cover" />
      {coracao > 0 && (
        <span key={coracao} className="rede-coracao pointer-events-none absolute inset-0 grid place-items-center text-white drop-shadow-lg" data-testid="coracao">
          <Icone nome="coracao" cheio className="w-24 h-24" />
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- texto com #hashtags em azul
export function TextoRico({ texto }) {
  const partes = String(texto || '').split(/(#[\p{L}\p{N}_]+)/u)
  return partes.map((p, i) => (p.startsWith('#') && p.length > 1
    ? <span key={i} className="text-[#3b5bff]">{p}</span>
    : <span key={i}>{p}</span>))
}

function Legenda({ nome, texto }) {
  const [aberta, setAberta] = useState(false)
  const longa = texto.length > 125
  const visivel = longa && !aberta ? `${texto.slice(0, 110).trimEnd()}… ` : texto
  return (
    <p className={`px-3 text-[14px] leading-snug ${TXT} whitespace-pre-line break-words`}>
      <span className="font-semibold mr-1.5">{nome}</span>
      <TextoRico texto={visivel} />
      {longa && !aberta && (
        <button type="button" onClick={() => setAberta(true)} className={`${TXT_SUAVE} min-h-[44px] -my-3 px-1`}>mais</button>
      )}
    </p>
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
      {itens === null ? <Carregando linhas={2} /> : itens.length === 0
        ? <p className={`text-sm ${TXT_SUAVE} text-center py-4`}>Ninguém comentou ainda.</p>
        : (
          <ul className="space-y-4 mb-4">
            {itens.map((c) => (
              <li key={c.id} className="flex gap-3">
                <AvatarRede nome={c.autor?.nome} foto={c.autor?.foto} tamanho="w-8 h-8" texto="text-[10px]" />
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] ${TXT} break-words`}><span className="font-semibold mr-1.5">{c.autor?.nome}</span>{c.texto}</p>
                  <p className={`text-xs ${TXT_SUAVE}`}>{c.autor?.clube}
                    {!c.meu && <button type="button" onClick={() => setDenunciarId(c.id)} className="min-h-[44px] ml-2 font-semibold">Denunciar</button>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      {podeComentar && (
        <form onSubmit={enviar} className="sticky bottom-0 bg-white pt-2 flex items-end gap-2 border-t border-[#eef1f5]">
          <label htmlFor={`comentar-${post.id}`} className="sr-only">Escreva um comentário</label>
          <textarea id={`comentar-${post.id}`} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} rows={1}
            placeholder="Escreva algo gentil…" className="flex-1 min-h-[44px] rounded-2xl bg-[#f1f5f9] px-3 py-2.5 text-sm text-[#0f172a] resize-none" />
          <button type="submit" disabled={!texto.trim() || enviando} className={`${PILL} text-[#3b5bff] disabled:opacity-40`}>{enviando ? '…' : 'Comentar'}</button>
        </form>
      )}
      {recusa && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-2 mt-2">{recusa}</p>}
      {bloqueadoPorRegra && <p className={`text-xs ${TXT_SUAVE} mt-3`}>Adultos de outro clube não comentam em publicações de desbravadores. Você pode curtir 🙂</p>}
      <Denuncia aberta={!!denunciarId} aoFechar={() => setDenunciarId(null)} tipo="comentario" id={denunciarId}
        aoOcultar={() => { const n = (itens || []).filter((c) => c.id !== denunciarId); setItens(n); aoContar(n.length) }} />
    </Folha>
  )
}

const ROTULO_CONQUISTA = Object.fromEntries(CATEGORIAS_CONQUISTA.map(([k, r, i]) => [k, `${i} ${r}`]))

// selos pequenos coloridos
function Selo({ post }) {
  if (post.tipo === 'desafio' && post.desafio) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6d28d9] bg-[#f3e8ff] rounded-full px-2.5 py-0.5">🏅 Desafio: {post.desafio.titulo}</span>
  }
  if (post.tipo === 'conquista') {
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#047857] bg-[#d1fae5] rounded-full px-2.5 py-0.5">Conquista · {ROTULO_CONQUISTA[post.conquista] || 'Conquista'}</span>
  }
  return null
}

// Avatar + nome + "Clube · há 8 h" num link só (alvo grande, sem sublinhado) que abre o perfil.
function Cabeca({ autor, criadoEm, pequeno = false }) {
  const miolo = (
    <>
      <AvatarRede nome={autor?.nome} foto={autor?.foto} tamanho={pequeno ? 'w-7 h-7' : 'w-9 h-9'} />
      <span className="min-w-0 block">
        <span className={`font-semibold ${TXT} truncate block text-[14px] leading-tight`}>{autor?.nome}</span>
        <span className={`text-xs ${TXT_SUAVE} truncate block`}>{autor?.clube}{criadoEm ? ` · ${tempoRelativo(criadoEm)}` : ''}</span>
      </span>
    </>
  )
  return autor?.id
    ? <Link to={`/rede/perfil/${autor.id}`} aria-label={autor?.nome} className="flex items-center gap-2.5 min-w-0 no-underline">{miolo}</Link>
    : <div className="flex items-center gap-2.5 min-w-0">{miolo}</div>
}

function BotaoIcone({ rotulo, pressionado, onClick, children, disabled, className = '' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={rotulo} aria-pressed={pressionado}
      className={`min-h-[44px] min-w-[44px] px-1.5 rounded-full inline-flex items-center justify-center gap-1 text-[13px] font-semibold ${TXT} ${className}`}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- o post (de ponta a ponta)
export function CartaoPost({ post, status, clubeId, aoAtualizar, aoRemover, aoCompartilhado }) {
  const [comentariosAbertos, setComentariosAbertos] = useState(false)
  const [menuAberto, setMenuAberto] = useState(false)
  const [denunciaAberta, setDenunciaAberta] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const podePublicar = !!status?.pode_publicar
  const eh = post.repost
  const noAr = post.status !== 'em_analise'
  const soTexto = !post.foto && !post.foto_expirada && !eh && !!post.legenda

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
    setMenuAberto(false)
    const alvo = eh && !eh.indisponivel ? eh.id : post.id
    if (!(await avisar.confirmar({ titulo: 'Compartilhar na rede?', descricao: 'Ela aparece no feed de todos os clubes com o seu nome.', rotulo: 'Compartilhar', cancelar: 'Voltar', perigo: false }))) return
    try {
      const r = await compartilhar(alvo)
      if (r?.ok) { avisar.sucesso(r.mensagem); aoCompartilhado?.(r.post) } else avisar.info(r?.mensagem)
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui compartilhar.')) }
  }

  async function apagarMeu() {
    setMenuAberto(false)
    if (!(await avisar.confirmar({ titulo: 'Apagar esta publicação?', rotulo: 'Apagar' }))) return
    try { await apagar('post', post.id); aoRemover(post.id); avisar.sucesso('Publicação apagada.') }
    catch (e) { avisar.info(textoDoErro(e, 'Não consegui apagar.')) }
  }

  return (
    <article aria-label={`Publicação de ${post.autor?.nome}`} data-testid="post" className={`bg-white border-b ${LINHA} pb-2`}>
      <header className="flex items-center justify-between gap-1 pl-3 pr-1 py-1.5">
        <Cabeca autor={post.autor} criadoEm={post.criado_em} />
        <div className="flex items-center shrink-0">
          {post.status === 'em_analise' && <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5 mr-1">Em análise</span>}
          {noAr && podePublicar && <BotaoIcone rotulo="Compartilhar na rede" onClick={repostar}><Icone nome="enviar" className="w-[22px] h-[22px]" /></BotaoIcone>}
          <BotaoIcone rotulo="Mais opções" onClick={() => setMenuAberto(true)}><Icone nome="pontos" className="w-5 h-5" /></BotaoIcone>
        </div>
      </header>
      {(post.tipo === 'desafio' || post.tipo === 'conquista') && <div className="px-3 pb-2"><Selo post={post} /></div>}

      {post.foto && <FotoDoPost path={post.foto} alt={post.foto_alt} aoDuploToque={noAr ? () => alternarCurtida(true) : undefined} />}
      {!post.foto && post.foto_expirada && (
        <p className={`mx-3 rounded-2xl bg-[#f8fafc] border ${LINHA} p-4 text-center text-sm ${TXT_SUAVE}`}>📷 Foto expirada (as fotos ficam 90 dias na rede)</p>
      )}
      {soTexto && (
        <div className={`mx-3 rounded-2xl bg-[#f8fafc] border ${LINHA} px-4 py-5`} data-testid="post-texto">
          <p className={`text-[19px] leading-snug font-medium ${TXT} whitespace-pre-line break-words`}><TextoRico texto={post.legenda} /></p>
        </div>
      )}
      {eh && (
        <div className={`mx-3 mt-1 border ${LINHA} rounded-2xl overflow-hidden`} data-testid="repost">
          <p className={`text-xs font-semibold ${TXT_SUAVE} px-3 pt-2 flex items-center gap-1`}><Icone nome="repetir" className="w-4 h-4" /> Compartilhou</p>
          {eh.indisponivel
            ? <p className={`text-sm ${TXT_SUAVE} p-3`}>Esta publicação não está mais disponível.</p>
            : (<>
                <div className="px-3 py-2"><Cabeca autor={eh.autor} criadoEm={eh.criado_em} pequeno /></div>
                {eh.foto && <FotoDoPost path={eh.foto} alt={eh.foto_alt} />}
                {eh.legenda && <p className={`px-3 py-2 ${TXT} text-sm whitespace-pre-line break-words`}><TextoRico texto={eh.legenda} /></p>}
              </>)}
        </div>
      )}

      {noAr && (
        <div className="flex items-center px-1.5 pt-1">
          <BotaoIcone rotulo={`Curtir, ${post.curtidas} curtidas`} pressionado={!!post.eu_curti} disabled={ocupado} onClick={() => alternarCurtida()}>
            <Icone nome="coracao" cheio={!!post.eu_curti} className={`w-[26px] h-[26px] ${post.eu_curti ? 'text-[#e11d48]' : ''}`} /> {post.curtidas}
          </BotaoIcone>
          <BotaoIcone rotulo={`Ver ${post.comentarios} comentários`} onClick={() => setComentariosAbertos(true)}>
            <Icone nome="balao" className="w-[25px] h-[25px]" /> {post.comentarios}
          </BotaoIcone>
          <span className="flex-1" />
          <BotaoIcone rotulo={post.eu_salvei ? 'Tirar dos salvos' : 'Salvar'} pressionado={!!post.eu_salvei} onClick={alternarSalvo}>
            <Icone nome="marcador" cheio={!!post.eu_salvei} className="w-[25px] h-[25px]" />
          </BotaoIcone>
        </div>
      )}
      {post.status === 'em_analise' && <p className={`px-3 pb-1 text-xs ${TXT_SUAVE}`}>Sua foto aparece para todos assim que a diretoria do seu clube aprovar.</p>}
      {post.legenda && !soTexto && <Legenda nome={post.autor?.nome} texto={post.legenda} />}
      {noAr && post.comentarios > 0 && (
        <button type="button" onClick={() => setComentariosAbertos(true)} className={`px-3 min-h-[36px] text-[13px] ${TXT_SUAVE}`}>
          Ver {post.comentarios === 1 ? 'o comentário' : `os ${post.comentarios} comentários`}
        </button>
      )}

      <Folha aberta={menuAberto} aoFechar={() => setMenuAberto(false)} titulo="Opções">
        <div className="grid gap-2">
          {noAr && podePublicar && <button type="button" onClick={repostar} className={`${PILL_CLARA} justify-start w-full`}><Icone nome="repetir" className="w-5 h-5" /> Compartilhar na rede</button>}
          {post.meu
            ? <button type="button" onClick={apagarMeu} className={`${PILL_CLARA} justify-start w-full text-red-700`}><Icone nome="lixo" className="w-5 h-5" /> Apagar publicação</button>
            : noAr && <button type="button" onClick={() => { setMenuAberto(false); setDenunciaAberta(true) }} className={`${PILL_CLARA} justify-start w-full text-red-700`}><Icone nome="bandeira" className="w-5 h-5" /> Denunciar</button>}
        </div>
      </Folha>
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
      <div>
        {itens.map((p) => (
          <CartaoPost key={p.id} post={p} status={status} clubeId={clubeId} aoAtualizar={atualizar} aoRemover={remover} aoCompartilhado={inserir} />
        ))}
      </div>
      {proximo && (
        <div className="py-4 text-center">
          <button type="button" onClick={carregarMais} disabled={maisCarregando} className={PILL_CLARA}>{maisCarregando ? 'Carregando…' : 'Ver mais'}</button>
        </div>
      )}
    </>
  )
}

export function VazioRede({ icone = '🌱', titulo, children }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-4xl mb-2" aria-hidden="true">{icone}</div>
      <p className={`font-bold ${TXT}`}>{titulo}</p>
      {children && <p className={`text-sm ${TXT_SUAVE} mt-1`}>{children}</p>}
    </div>
  )
}
