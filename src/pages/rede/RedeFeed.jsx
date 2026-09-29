import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/Auth.jsx'
import { carregarFeed, carregarStories } from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { Carregando } from '../../ui/index.jsx'
import { useRede, useUnidadeDaRede } from './contexto.js'
import { Icone, ListaDePosts, PILL_CLARA, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'
import { FileiraStories, NovoStory, ViewerStories } from './Stories.jsx'

// Feed da Rede DBV no estilo Instagram: fileira de stories no topo, filtro discreto "Todos ▾ · Meu clube"
// e os posts de ponta a ponta. O ➕ do topo e da barra de baixo levam à tela de publicar.
// Coordenação (490): "Meu clube" vira "Minha área" — posts dos clubes da coordenação (o servidor filtra).
const abasDoFeed = (coordenacao) => [['todos', 'Todos'], ['meu_clube', coordenacao ? 'Minha área' : 'Meu clube']]

export default function RedeFeed() {
  const { profile } = useAuth()
  const clubeId = useUnidadeDaRede()   // clube em uso ou unidade de coordenação (490)
  // `eu` = o meu perfil GATEADO pela rede (500): personagem ou foto só com autorização; nunca profile.foto
  const { status, eu } = useRede()
  const [filtro, setFiltro] = useState('todos')
  const [itens, setItens] = useState([])
  const [proximo, setProximo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [mais, setMais] = useState(false)
  const [erro, setErro] = useState(null)
  const [grupos, setGrupos] = useState([])
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
    setGrupos((gs) => gs.map((g) => {
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

      <div role="tablist" aria-label="Filtro do feed" className="flex items-center gap-1 px-3 py-1.5 border-y border-[var(--rede-linha)]">
        {abasDoFeed(!!status?.coordenacao).map(([chave, rotulo], i) => (
          <span key={chave} className="flex items-center">
            {i > 0 && <span aria-hidden="true" className={`${TXT_SUAVE} px-1`}>·</span>}
            <button type="button" role="tab" aria-selected={filtro === chave} onClick={() => setFiltro(chave)}
              className={`min-h-[44px] px-2 inline-flex items-center gap-0.5 text-[15px] ${filtro === chave ? `font-bold ${TXT}` : `font-medium ${TXT_SUAVE}`}`}>
              {rotulo}{chave === 'todos' && <Icone nome="seta" className="w-4 h-4" />}
            </button>
          </span>
        ))}
      </div>

      {carregando ? <div className="p-4"><Carregando /></div>
        : erro ? (
          <div className="p-6 text-center">
            <p className={TXT}>{textoDoErro(erro, 'Não consegui abrir o feed.')}</p>
            <button type="button" onClick={() => carregar(filtro)} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
          </div>
        ) : (
          <ListaDePosts itens={itens} setItens={setItens} proximo={proximo} carregarMais={carregarMais} maisCarregando={mais}
            status={status} clubeId={clubeId}
            vazio={<VazioRede titulo="Ainda não há publicações">
              {status?.coordenacao ? 'Seja o primeiro a compartilhar algo bom da sua área!' : 'Seja o primeiro a compartilhar algo bom do seu clube!'}
            </VazioRede>} />
        )}

      {aberto !== null && grupos[aberto] && (
        <ViewerStories grupos={grupos} inicio={aberto} aoFechar={fecharViewer} aoMudar={mudouStory} />
      )}
      {arquivoStory && (
        <NovoStory arquivo={arquivoStory} clubeId={clubeId} userId={profile?.id}
          aoFechar={() => setArquivoStory(null)} aoPublicado={() => { setArquivoStory(null); recarregarStories() }} />
      )}
    </div>
  )
}
