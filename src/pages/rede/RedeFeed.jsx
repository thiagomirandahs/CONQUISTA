import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/Auth.jsx'
import { carregarFeed, carregarStories } from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { useRede, useUnidadeDaRede } from './contexto.js'
import { EsqueletoFeed, ListaDePosts, PILL_CLARA, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'
import { FileiraStories, NovoStory, ViewerStories } from './Stories.jsx'

// Feed da Rede DBV: fileira de stories no topo, filtro discreto "Todos ▾ · Meu clube" e os posts de ponta
// a ponta (identidade marinho + dourado, Fase 6). Enquanto carrega, esqueletos no formato do post e das
// bolinhas; feed vazio oferece "Publicar" a quem publica. O ➕ da barra de baixo leva à tela de publicar.
// Coordenação (490): "Meu clube" vira "Minha área" — posts dos clubes da coordenação (o servidor filtra).
// Duas abas (515): "Meu Clube" (padrão) e "Comunidade" (publicações de liderança de todos os clubes).
const abasDoFeed = (coordenacao) => [['meu_clube', coordenacao ? 'Minha área' : 'Meu Clube'], ['comunidade', 'Comunidade']]

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
  const [grupos, setGrupos] = useState(null)      // null = ainda carregando (fileira-esqueleto)
  const [aberto, setAberto] = useState(null)       // índice do grupo no viewer
  const [arquivoStory, setArquivoStory] = useState(null)
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
    setGrupos((gs) => (gs || []).map((g) => {
      if (!g.stories.some((s) => s.id === id)) return g
      const stories = g.stories.map((s) => (s.id === id ? { ...s, visto: true } : s))
      return { ...g, stories, todos_vistos: g.meu || stories.every((s) => s.visto) }
    }))
  }, [])
  const fecharViewer = useCallback(() => { setAberto(null); recarregarStories() }, [recarregarStories])

  return (
    <div>
      {status?.suspenso_ate && (
        <div role="status" className="m-3 rounded-2xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          Sua rede está pausada até {new Date(status.suspenso_ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Dá para olhar, mas não publicar nem comentar.
        </div>
      )}

      <FileiraStories grupos={grupos} eu={eu || { id: profile?.id, nome: profile?.nome }} podePublicar={!!status?.pode_publicar}
        aoAbrir={(i) => setAberto(i)} aoNovo={() => inputStory.current?.click()} />
      <label htmlFor="rede-story-foto" className="sr-only">Foto do story</label>
      <input ref={inputStory} id="rede-story-foto" type="file" accept="image/*" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setArquivoStory(f); e.target.value = '' }} />

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
              {filtro === 'comunidade' ? 'A Comunidade mostra o que a liderança dos clubes compartilha com todos.'
                : status?.coordenacao ? 'Seja o primeiro a compartilhar algo bom da sua área!' : 'Seja o primeiro a compartilhar algo bom do seu clube!'}
            </VazioRede>} />
        )}

      {aberto !== null && grupos?.[aberto] && (
        <ViewerStories grupos={grupos} inicio={aberto} aoFechar={fecharViewer} aoMudar={mudouStory} />
      )}
      {arquivoStory && (
        <NovoStory arquivo={arquivoStory} clubeId={clubeId} userId={profile?.id}
          aoFechar={() => setArquivoStory(null)} aoPublicado={() => { setArquivoStory(null); recarregarStories() }} />
      )}
    </div>
  )
}
