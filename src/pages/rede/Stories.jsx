import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  apagarStory, marcarStoryVisto, prepararFotoStory, publicarStory, urlDaFoto, tempoRelativo, confirmacaoDeStory, QUEM_VE_STORY,
} from '../../services/rede.js'
import { tamanhoLegivel } from '../../lib/imagem.js'
import { useFechavel } from '../../lib/useFechavel.js'
import { avisar } from '../../ui/avisos.jsx'
import { AnelStory, AvatarRede, Denuncia, EsqueletoStories, Icone, PILL, SeloCoordenacao, TXT, TXT_SUAVE, avatarPersonagemDe, textoDoErro } from './componentes.jsx'

// =============================================================================
//  STORIES da Rede DBV (migration 480): fileira de bolinhas (rolagem horizontal SÓ dentro dela),
//  viewer em tela cheia e o envio de um story novo.
//  Regra de hoje (decisão do dono, 29/09/2026): publica direto depois da confirmação; dura 24 h.
//  Visual (Fase 6): anel dourado→âmbar = story novo; anel na cor de linha = visto; "+" marinho.
//  Enquanto os grupos não chegam (`grupos` = null), uma fileira de 5 bolinhas-esqueleto.
//  Stories para todos na Comunidade (535): a MESMA fileira/viewer/envio servem às duas abas; `alcance` diz qual
//  ('clube' = só o seu clube; 'comunidade' = todos os clubes da Rede, com o nome do clube embaixo de cada pessoa).
//  Mídia sob demanda: a fileira só traz caminhos; o viewer assina a foto do story aberto e pré-carrega só o próximo.
// =============================================================================

export const DURACAO_STORY_MS = 5000
const PASSO_MS = 50

const primeiroNome = (nome) => String(nome || '').split(/\s+/)[0] || 'Membro'

// ---------------------------------------------------------------- fileira
export function FileiraStories({ grupos, eu, podePublicar, aoAbrir, aoNovo, alcance = 'clube' }) {
  if (!grupos) return <EsqueletoStories />
  const meu = grupos.find((g) => g.meu)
  const outros = grupos.filter((g) => !g.meu)
  const naComunidade = alcance === 'comunidade'
  return (
    <div role="list" aria-label={naComunidade ? 'Stories da Comunidade' : 'Stories'} data-testid="fileira-stories" data-alcance={alcance}
      className="flex gap-3 overflow-x-auto overscroll-x-contain px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {(podePublicar || meu) && (
        <div role="listitem" className="shrink-0 w-[72px] flex flex-col items-center gap-1">
          <div className="relative">
            <button type="button" onClick={() => (meu ? aoAbrir(grupos.indexOf(meu)) : aoNovo())}
              aria-label={meu ? 'Ver o seu story' : naComunidade ? 'Criar o seu story para a Comunidade' : 'Criar o seu story'} className="rounded-full">
              <AnelStory estado={meu ? 'novo' : 'nenhum'}>
                {/* `eu` vem de rede_perfil() (gateado), nunca do profile do Auth: a mesma cara que os outros veem */}
                <AvatarRede nome={eu?.nome} foto={eu?.foto} avatarPersonagem={avatarPersonagemDe(eu)} tamanho={meu ? 'w-[60px] h-[60px]' : 'w-[66px] h-[66px]'} texto="text-base" />
              </AnelStory>
            </button>
            {podePublicar && (
              <button type="button" onClick={aoNovo} aria-label={naComunidade ? 'Adicionar story na Comunidade' : 'Adicionar story'}
                className="alvo-livre absolute -right-1 -bottom-1 w-7 h-7 rounded-full bg-[var(--rede-acao)] text-[var(--rede-sobre-acao)] grid place-items-center ring-[3px] ring-[var(--rede-bg)]">
                <Icone nome="mais" className="w-4 h-4" traco={2.6} />
              </button>
            )}
          </div>
          <span className={`text-[11px] ${TXT_SUAVE} truncate max-w-full`}>Seu story</span>
        </div>
      )}
      {outros.map((g) => (
        <div role="listitem" key={g.autor?.id} className="shrink-0 w-[72px] flex flex-col items-center gap-1">
          <button type="button" onClick={() => aoAbrir(grupos.indexOf(g))} className="rounded-full"
            aria-label={`Story de ${g.autor?.nome}${naComunidade && g.autor?.clube ? `, ${g.autor.clube}` : ''}${g.todos_vistos ? ' (visto)' : ''}`} data-visto={g.todos_vistos ? 'sim' : 'nao'}>
            <AnelStory estado={g.todos_vistos ? 'visto' : 'novo'}>
              <AvatarRede nome={g.autor?.nome} foto={g.autor?.foto} avatarPersonagem={avatarPersonagemDe(g.autor)} tamanho="w-[60px] h-[60px]" texto="text-base" />
            </AnelStory>
          </button>
          <span className={`text-[11px] ${TXT} truncate max-w-full`}>{primeiroNome(g.autor?.nome)}</span>
          {naComunidade && g.autor?.clube && (
            <span data-testid="clube-do-story" className={`-mt-1 text-[10px] leading-tight ${TXT_SUAVE} truncate max-w-full`}>{g.autor.clube}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- viewer em tela cheia
// Barras de progresso no topo; avança sozinho em 5 s; toque à direita avança, à esquerda volta;
// segurar pausa; arrastar para baixo (ou ✕ / Esc) fecha. Nome + clube + tempo no topo; denunciar.
export function ViewerStories({ grupos, inicio = 0, aoFechar, aoMudar }) {
  useFechavel(true, aoFechar)   // o botão físico de voltar do Android fecha o story (auditoria de navegação 05/10/2026)
  const [gi, setGi] = useState(inicio)
  const [si, setSi] = useState(() => Math.max(0, (grupos[inicio]?.stories || []).findIndex((s) => !s.visto && !grupos[inicio]?.meu)))
  const [decorrido, setDecorrido] = useState(0)
  const [segurando, setSegurando] = useState(false)
  const [denuncia, setDenuncia] = useState(false)
  const [url, setUrl] = useState(null)
  const toque = useRef({ em: 0, y: 0, duracao: 0 })
  const assinadas = useRef(new Map())   // caminho -> promessa da URL assinada (só o story aberto e o próximo)
  const grupo = grupos[gi]
  const story = grupo?.stories?.[si]
  const pausado = segurando || denuncia || !url

  const fechar = useCallback(() => aoFechar?.(), [aoFechar])
  const proximo = useCallback(() => {
    setDecorrido(0)
    if (si + 1 < (grupo?.stories?.length || 0)) { setSi(si + 1); return }
    if (gi + 1 < grupos.length) { setGi(gi + 1); setSi(0); return }
    fechar()
  }, [si, gi, grupo, grupos.length, fechar])
  const anterior = useCallback(() => {
    setDecorrido(0)
    if (si > 0) { setSi(si - 1); return }
    if (gi > 0) { const g = grupos[gi - 1]; setGi(gi - 1); setSi(Math.max(0, (g?.stories?.length || 1) - 1)) }
  }, [si, gi, grupos])

  // foto do story (URL assinada curta), SOB DEMANDA: nada é assinado/baixado antes de o story abrir.
  const assinar = useCallback((caminho) => {
    const mapa = assinadas.current
    if (!mapa.has(caminho)) mapa.set(caminho, Promise.resolve().then(() => urlDaFoto(caminho)).catch(() => null))
    return mapa.get(caminho)
  }, [])
  const fotoAtual = story?.foto
  // o próximo na ordem (mesma pessoa ou a primeira da próxima): o único que é pré-carregado
  const fotoSeguinte = (grupo?.stories?.[si + 1] || grupos[gi + 1]?.stories?.[0])?.foto || null
  useEffect(() => {
    if (!fotoAtual) return undefined
    let vivo = true
    setUrl(null)
    assinar(fotoAtual).then((u) => {
      if (!vivo) return
      setUrl(u || 'indisponivel')
      if (!u || !fotoSeguinte) return
      assinar(fotoSeguinte).then((prox) => {
        if (!vivo || !prox || typeof Image === 'undefined') return
        const img = new Image()
        img.decoding = 'async'
        img.src = prox
      })
    })
    return () => { vivo = false }
  }, [fotoAtual, fotoSeguinte, assinar])

  // marca visto (o meu não conta)
  const idAtual = story?.id
  const precisaMarcar = !!story && !grupo?.meu && !story.visto
  useEffect(() => {
    if (!precisaMarcar) return
    marcarStoryVisto(idAtual).catch(() => {})
    aoMudar?.({ tipo: 'visto', id: idAtual })
  }, [idAtual, precisaMarcar, aoMudar])

  // relógio: avança sozinho
  useEffect(() => {
    if (!idAtual || pausado) return undefined
    const t = setInterval(() => setDecorrido((d) => d + PASSO_MS), PASSO_MS)
    return () => clearInterval(t)
  }, [idAtual, pausado])
  useEffect(() => { if (decorrido >= DURACAO_STORY_MS) proximo() }, [decorrido, proximo])

  useEffect(() => { if (!idAtual) fechar() }, [idAtual, fechar])

  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'Escape') fechar()
      else if (e.key === 'ArrowRight') proximo()
      else if (e.key === 'ArrowLeft') anterior()
    }
    document.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [fechar, proximo, anterior])

  if (!grupo || !story) return null

  const segurar = (e) => { toque.current = { em: Date.now(), y: e.clientY ?? 0, duracao: 0 }; setSegurando(true) }
  const soltar = (e) => {
    setSegurando(false)
    toque.current.duracao = Date.now() - toque.current.em
    if ((e.clientY ?? 0) - toque.current.y > 90) fechar()   // arrastou para baixo
  }
  // depois de segurar (pausa) o dedo solta e o navegador ainda dispara "click": não conta como toque
  const foiToque = () => { const ok = toque.current.duracao < 250; toque.current.duracao = 0; return ok }

  async function apagarMeu() {
    setSegurando(true)
    if (!(await avisar.confirmar({ titulo: 'Apagar este story?', rotulo: 'Apagar', cancelar: 'Voltar' }))) { setSegurando(false); return }
    try {
      await apagarStory(story.id)
      avisar.sucesso('Story apagado.')
      aoMudar?.({ tipo: 'removido', id: story.id })
      fechar()
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui apagar.')); setSegurando(false) }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Story de ${grupo.autor?.nome}`} data-testid="viewer-story"
      data-pausado={pausado ? 'sim' : 'nao'}
      className="fixed inset-0 z-[70] bg-black text-white select-none touch-none"
      onPointerDown={segurar} onPointerUp={soltar} onPointerCancel={() => setSegurando(false)}>
      <div className="relative mx-auto h-full max-w-[480px]">
        {url && url !== 'indisponivel'
          ? <img src={url} alt={story.texto || `Story de ${grupo.autor?.nome}`} draggable={false} onContextMenu={(e) => e.preventDefault()}
              className="absolute inset-0 w-full h-full object-contain" />
          : <div className="absolute inset-0 grid place-items-center text-sm text-white/70">{url ? 'Foto indisponível' : 'Carregando…'}</div>}

        {/* zonas de toque: esquerda volta, direita avança */}
        <button type="button" aria-label="Story anterior" onClick={() => foiToque() && anterior()} className="absolute left-0 top-0 h-full w-1/3" />
        <button type="button" aria-label="Próximo story" onClick={() => foiToque() && proximo()} className="absolute right-0 top-0 h-full w-2/3" />

        <div className="absolute inset-x-0 top-0 pt-[max(8px,var(--seguro-topo))] px-2 bg-gradient-to-b from-black/60 to-transparent pb-6">
          <div className="flex gap-1" aria-hidden="true">
            {grupo.stories.map((s, i) => (
              <div key={s.id} className="h-[3px] flex-1 rounded-full bg-white/35 overflow-hidden">
                <div data-testid="barra-story" className="h-full bg-white"
                  style={{ width: `${i < si ? 100 : i > si ? 0 : Math.min(100, (decorrido / DURACAO_STORY_MS) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <AvatarRede nome={grupo.autor?.nome} foto={grupo.autor?.foto} avatarPersonagem={avatarPersonagemDe(grupo.autor)} tamanho="w-8 h-8" texto="text-[10px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold truncate">{grupo.autor?.nome}{grupo.autor?.coordenacao && <SeloCoordenacao />} <span className="font-normal text-white/75">· {tempoRelativo(story.criado_em)}</span></p>
              <p className="text-[11px] text-white/75 truncate">{grupo.autor?.clube}{story.alcance === 'comunidade' && <span data-testid="alcance-story"> · Todos os clubes</span>}</p>
            </div>
            {story.status === 'em_analise' && <span className="text-[11px] font-semibold bg-amber-400 text-black rounded-full px-2 py-0.5">Em análise</span>}
            {grupo.meu
              ? <button type="button" aria-label="Apagar story" onPointerDown={(e) => e.stopPropagation()} onClick={apagarMeu} className="relative z-10 w-11 h-11 grid place-items-center"><Icone nome="lixo" /></button>
              : <button type="button" aria-label="Denunciar" onPointerDown={(e) => e.stopPropagation()} onClick={() => setDenuncia(true)} className="relative z-10 w-11 h-11 grid place-items-center"><Icone nome="bandeira" /></button>}
            <button type="button" aria-label="Fechar" onPointerDown={(e) => e.stopPropagation()} onClick={fechar} className="relative z-10 w-11 h-11 grid place-items-center"><Icone nome="fechar" /></button>
          </div>
        </div>

        {story.texto && (
          <p className="pointer-events-none absolute inset-x-4 bottom-[max(28px,var(--seguro-baixo))] text-center text-[17px] font-semibold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,.8)] break-words">
            {story.texto}
          </p>
        )}
      </div>
      <Denuncia aberta={denuncia} aoFechar={() => setDenuncia(false)} tipo="story" id={story.id}
        aoOcultar={() => { aoMudar?.({ tipo: 'removido', id: story.id }); proximo() }} />
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- story novo (prévia + confirmação)
export function NovoStory({ arquivo, clubeId, userId, aoFechar, aoPublicado, alcance = 'clube' }) {
  useFechavel(true, aoFechar)
  const [foto, setFoto] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [erro, setErro] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    setErro('')
    prepararFotoStory(arquivo).then((r) => {
      if (!vivo) return
      setFoto(r); setPrevia(URL.createObjectURL?.(r.arquivo) || null)
    }).catch((e) => { if (vivo) setErro(textoDoErro(e, 'Não consegui preparar a foto.')) })
    return () => { vivo = false }
  }, [arquivo])
  useEffect(() => () => { if (previa) URL.revokeObjectURL?.(previa) }, [previa])

  async function publicar() {
    if (!foto || enviando) return
    if (!(await avisar.confirmar(confirmacaoDeStory(alcance)))) return
    setEnviando(true); setErro('')
    try {
      const r = await publicarStory({ foto, texto: texto.trim(), clubeId, userId, alcance })
      if (r?.ok) { avisar.sucesso(r.mensagem); aoPublicado?.() } else setErro(r?.mensagem || 'Não foi possível publicar.')
    } catch (e) { setErro(textoDoErro(e, 'Não consegui publicar o story.')) }
    setEnviando(false)
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alcance === 'comunidade' ? 'Novo story na Comunidade' : 'Novo story'} data-alcance={alcance} className="fixed inset-0 z-[70] bg-black text-white flex flex-col">
      <div className="flex items-center justify-between px-2 pt-[max(8px,var(--seguro-topo))]">
        <button type="button" onClick={aoFechar} aria-label="Fechar" className="w-11 h-11 grid place-items-center"><Icone nome="voltar" /></button>
        <p className="font-semibold">{alcance === 'comunidade' ? 'Novo story · Comunidade' : 'Novo story'}</p>
        <span className="w-11" />
      </div>
      <div className="relative flex-1 min-h-0 mx-auto w-full max-w-[480px]">
        {previa ? <img src={previa} alt="Prévia do story" className="absolute inset-0 w-full h-full object-contain" />
          : !erro && <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Otimizando a foto…</p>}
      </div>
      <div className="mx-auto w-full max-w-[480px] px-3 pb-[max(12px,var(--seguro-baixo))] pt-2 space-y-2">
        <p data-testid="quem-ve-story" className="text-[13px] font-semibold text-white">{QUEM_VE_STORY[alcance] || QUEM_VE_STORY.clube}</p>
        {foto && <p className="text-[11px] text-white/70" data-testid="tamanho-story">Foto otimizada: {tamanhoLegivel(foto.antes)} → {tamanhoLegivel(foto.depois)} · localização removida</p>}
        <label htmlFor="story-texto" className="sr-only">Texto do story (opcional)</label>
        <input id="story-texto" value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 120))} maxLength={120}
          placeholder="Escreva algo (opcional)" className="w-full min-h-[44px] rounded-full bg-white/15 px-4 text-sm text-white placeholder:text-white/60" />
        {erro && <p role="alert" className="text-sm text-amber-900 bg-amber-100 rounded-2xl p-2">{erro}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={aoFechar} className={`${PILL} flex-1 bg-white/15 text-white`}>Voltar</button>
          <button type="button" onClick={publicar} disabled={!foto || enviando} className={`${PILL} flex-1 bg-[var(--rede-destaque)] text-[var(--rede-sobre-destaque)] disabled:opacity-50`}>
            {enviando ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
