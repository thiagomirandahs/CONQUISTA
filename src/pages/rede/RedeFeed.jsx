import { Link } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/Auth.jsx'
import { carregarFeed, carregarStories } from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { useRede, useUnidadeDaRede } from './contexto.js'
import { EsqueletoFeed, Icone, ListaDePosts, PILL_CLARA, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'
import { FileiraStories, NovoStory, ViewerStories } from './Stories.jsx'

// Feed da Rede DBV: fileira de stories no topo, filtro discreto "Todos ▾ · Meu clube" e os posts de ponta
// a ponta (identidade marinho + dourado, Fase 6). Enquanto carrega, esqueletos no formato do post e das
// bolinhas; feed vazio oferece "Publicar" a quem publica. O ➕ da barra de baixo leva à tela de publicar.
// Coordenação (490): "Meu clube" vira "Minha área" — posts dos clubes da coordenação (o servidor filtra).
// Duas abas (515): "Meu Clube" (padrão) e "Comunidade" (publicações de liderança de todos os clubes).
// Organização (517): "Meu Clube" = conversa interna (feed, stories, desafios); "Comunidade" = conteúdo interclubes
// (conquistas, atividades, eventos, avisos, fotos permitidas), sem desafios. Uma só Comunidade.
// Stories para todos na Comunidade (535, decisão do dono de 02/10/2026): a aba Comunidade ganha a MESMA faixa de
// stories no topo, com os stories de alcance 'comunidade' de todos os clubes; o "+" dali publica para todos os clubes
// (confirmação explícita). Não existe amigos/seguir nem aprovação prévia. A faixa do Meu Clube continua igual.
// Cada aba faz UMA chamada (a da Comunidade só quando a aba é aberta); as fotos são assinadas pelo viewer, sob demanda.
const abasDoFeed = (coordenacao) => [['meu_clube', coordenacao ? 'Minha área' : 'Meu Clube'], ['comunidade', 'Comunidade']]
const SUBTITULO = { meu_clube: 'Só o seu clube vê', comunidade: 'Todos os clubes da Rede' }
const ALCANCE_DA_ABA = { meu_clube: 'clube', comunidade: 'comunidade' }
const marcarVisto = (gs, id) => (Array.isArray(gs) ? gs.map((g) => {
  if (!g.stories.some((s) => s.id === id)) return g
  const stories = g.stories.map((s) => (s.id === id ? { ...s, visto: true } : s))
  return { ...g, stories, todos_vistos: g.meu || stories.every((s) => s.visto) }
}) : gs)

export default function RedeFeed() {
  const { profile } = useAuth()
  const clubeId = useUnidadeDaRede()   // clube em uso ou unidade de coordenação (490)
  // `eu` = o meu perfil GATEADO pela rede (500): personagem ou foto só com autorização; nunca profile.foto
  const { status, eu } = useRede()
  const [filtro, setFiltro] = useState('meu_clube')
  const [itens, setItens] = useState([])
  const [proximo, setProximo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [mais, setMais] = useState(false)
  const [erro, setErro] = useState(null)
  const [grupos, setGrupos] = useState(null)      // Meu Clube: null = ainda carregando (fileira-esqueleto)
  // Comunidade: undefined = ainda não pedida; null = carregando; false = o servidor ainda não oferece (sem a faixa)
  const [gruposCom, setGruposCom] = useState(undefined)
  const [aberto, setAberto] = useState(null)       // { alcance, indice } do grupo no viewer
  const [arquivoStory, setArquivoStory] = useState(null)   // { arquivo, alcance }
  const inputStory = useRef(null)

  const carregar = useCallback(async (f) => {
    setCarregando(true); setErro(null)
    try {
      const r = await carregarFeed(f)
      setItens(r?.itens || []); setProximo(r?.proximo || null)
    } catch (e) { setErro(e) }
    setCarregando(false)
  }, [])
  useEffect(() => { carregar(filtro) }, [carregar, filtro, clubeId])

  const recarregarStories = useCallback(async () => {
    try { setGrupos((await carregarStories()) || []) } catch { setGrupos([]) }
  }, [])
  useEffect(() => { recarregarStories() }, [recarregarStories, clubeId])

  const recarregarStoriesCom = useCallback(async () => {
    try {
      const r = await carregarStories('comunidade')
      setGruposCom(r === null ? false : (r || []))   // null = banco ainda sem a 535: a aba fica sem a faixa
    } catch { setGruposCom([]) }
  }, [])
  // trocou de clube: a faixa da Comunidade é pedida de novo quando a aba abrir
  useEffect(() => { setGruposCom(undefined) }, [clubeId])
  useEffect(() => {
    if (filtro !== 'comunidade' || gruposCom !== undefined) return
    setGruposCom(null)
    recarregarStoriesCom()
  }, [filtro, gruposCom, recarregarStoriesCom])

  async function carregarMais() {
    if (!proximo || mais) return
    setMais(true)
    try {
      const r = await carregarFeed(filtro, proximo)
      setItens((a) => [...a, ...(r?.itens || []).filter((n) => !a.some((x) => x.id === n.id))]); setProximo(r?.proximo || null)
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui carregar mais.')) }
    setMais(false)
  }

  // o viewer avisa: visto (anel fica cinza) / removido (recarrega ao fechar)
  const mudouStory = useCallback(({ tipo, id }) => {
    if (tipo !== 'visto') return
    setGrupos((gs) => marcarVisto(gs || [], id))
    setGruposCom((gs) => marcarVisto(gs, id))
  }, [])
  // o story de alcance comunidade de alguém do meu clube aparece nas duas faixas: recarrega a que já foi pedida
  const comPedida = Array.isArray(gruposCom)
  const recarregarFaixas = useCallback(() => {
    recarregarStories()
    if (comPedida) recarregarStoriesCom()
  }, [recarregarStories, recarregarStoriesCom, comPedida])
  const fecharViewer = useCallback(() => { setAberto(null); recarregarFaixas() }, [recarregarFaixas])
  const alcanceDaAba = ALCANCE_DA_ABA[filtro]
  const gruposDoViewer = aberto ? (aberto.alcance === 'comunidade' ? gruposCom : grupos) : null
  const euNaFaixa = eu || { id: profile?.id, nome: profile?.nome }

  return (
    <div>
      {status?.suspenso_ate && (
        <div role="status" className="m-3 rounded-2xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          Sua rede está pausada até {new Date(status.suspenso_ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Dá para olhar, mas não publicar nem comentar.
        </div>
      )}

      <div role="tablist" aria-label="Filtro do feed" className="grid grid-cols-2 border-y border-[var(--rede-linha)]">
        {abasDoFeed(!!status?.coordenacao).map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" id={`aba-feed-${chave}`} aria-selected={filtro === chave} tabIndex={filtro === chave ? 0 : -1}
            onClick={() => setFiltro(chave)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const outra = abasDoFeed(!!status?.coordenacao).find(([c]) => c !== chave)[0]
              setFiltro(outra)
              document.getElementById(`aba-feed-${outra}`)?.focus()
            }}
            className={`min-h-[44px] px-2 text-[15px] border-b-2 ${filtro === chave ? `font-bold ${TXT} border-[var(--rede-acao)]` : `font-medium ${TXT_SUAVE} border-transparent`}`}>
            {rotulo}
          </button>
        ))}
      </div>

      <p data-testid="subtitulo-aba" className={`px-3 pt-2 text-xs font-semibold ${TXT_SUAVE}`}>{SUBTITULO[filtro]}</p>

      {/* um só seletor de foto para as duas faixas; o alcance é o da aba em que o "+" foi tocado */}
      <label htmlFor="rede-story-foto" className="sr-only">Foto do story</label>
      <input ref={inputStory} id="rede-story-foto" type="file" accept="image/*" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setArquivoStory({ arquivo: f, alcance: alcanceDaAba }); e.target.value = '' }} />

      {filtro === 'comunidade' && gruposCom !== false && (
        <FileiraStories alcance="comunidade" grupos={gruposCom || null} eu={euNaFaixa} podePublicar={!!status?.pode_publicar}
          aoAbrir={(i) => setAberto({ alcance: 'comunidade', indice: i })} aoNovo={() => inputStory.current?.click()} />
      )}

      {filtro === 'meu_clube' && (
        <>
          <FileiraStories grupos={grupos} eu={euNaFaixa} podePublicar={!!status?.pode_publicar}
            aoAbrir={(i) => setAberto({ alcance: 'clube', indice: i })} aoNovo={() => inputStory.current?.click()} />

          <Link to="/rede/desafios" data-testid="atalho-desafios"
            className="mx-3 mb-2 min-h-[44px] rounded-2xl bg-[var(--rede-superficie)] px-3 flex items-center gap-2 text-sm font-semibold text-[var(--rede-ink)] no-underline">
            <Icone nome="trofeu" className="w-5 h-5 text-[var(--rede-acao)]" /> Desafios do clube
            <Icone nome="seta" className="w-4 h-4 -rotate-90 ml-auto text-[var(--rede-ink-suave)]" />
          </Link>
        </>
      )}

      {carregando ? <EsqueletoFeed />
        : erro ? (
          <div className="p-6 text-center">
            <p className={TXT}>{textoDoErro(erro, 'Não consegui abrir o feed.')}</p>
            <button type="button" onClick={() => carregar(filtro)} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
          </div>
        ) : (
          <ListaDePosts itens={itens} setItens={setItens} proximo={proximo} carregarMais={carregarMais} maisCarregando={mais}
            status={status} clubeId={clubeId}
            vazio={<VazioRede titulo={filtro === 'comunidade' ? 'Ainda não há publicações na Comunidade' : 'Ainda não há publicações'} acao={status?.pode_publicar ? { rotulo: 'Publicar', para: '/rede/publicar' } : null}>
              {filtro === 'comunidade' ? 'Aqui ficam as publicações que a liderança dos clubes compartilha com todos. Os stories de todos os clubes aparecem nas bolinhas lá em cima.'
                : status?.coordenacao ? 'Seja o primeiro a compartilhar algo bom da sua área!' : 'Seja o primeiro a compartilhar algo bom do seu clube!'}
            </VazioRede>} />
        )}

      {aberto !== null && Array.isArray(gruposDoViewer) && gruposDoViewer[aberto.indice] && (
        <ViewerStories key={aberto.alcance} grupos={gruposDoViewer} inicio={aberto.indice} aoFechar={fecharViewer} aoMudar={mudouStory} />
      )}
      {arquivoStory && (
        <NovoStory arquivo={arquivoStory.arquivo} alcance={arquivoStory.alcance} clubeId={clubeId} userId={profile?.id}
          aoFechar={() => setArquivoStory(null)} aoPublicado={() => { setArquivoStory(null); recarregarFaixas() }} />
      )}
    </div>
  )
}
