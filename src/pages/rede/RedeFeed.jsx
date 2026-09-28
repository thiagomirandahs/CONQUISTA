import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/Auth.jsx'
import { useClube } from '../../context/Clube.jsx'
import { carregarFeed } from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { Carregando } from '../../ui/index.jsx'
import { useRede } from './contexto.js'
import { AvatarRede, CARD, ListaDePosts, PILL_CLARA, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'

// Feed da Rede DBV: abas Todos · Meu clube, composer que abre a tela de publicar, cartões de post.
const ABAS = [['todos', 'Todos'], ['meu_clube', 'Meu clube']]

export default function RedeFeed() {
  const { profile } = useAuth()
  const { clubeId } = useClube()
  const { status } = useRede()
  const [filtro, setFiltro] = useState('todos')
  const [itens, setItens] = useState([])
  const [proximo, setProximo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [mais, setMais] = useState(false)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async (f) => {
    setCarregando(true); setErro(null)
    try {
      const r = await carregarFeed(f)
      setItens(r?.itens || []); setProximo(r?.proximo || null)
    } catch (e) { setErro(e) }
    setCarregando(false)
  }, [])
  useEffect(() => { carregar(filtro) }, [carregar, filtro, clubeId])

  async function carregarMais() {
    if (!proximo || mais) return
    setMais(true)
    try {
      const r = await carregarFeed(filtro, proximo)
      setItens((a) => [...a, ...(r?.itens || []).filter((n) => !a.some((x) => x.id === n.id))]); setProximo(r?.proximo || null)
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui carregar mais.')) }
    setMais(false)
  }

  return (
    <div>
      {status?.suspenso_ate && (
        <div role="status" className="mb-4 rounded-3xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          Sua rede está pausada até {new Date(status.suspenso_ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Dá para olhar, mas não publicar nem comentar.
        </div>
      )}
      {status?.pode_publicar && (
        <Link to="/rede/publicar" className={`${CARD} flex items-center gap-3 p-3 mb-4 min-h-[64px]`}>
          <AvatarRede nome={profile?.nome} />
          <span className={`flex-1 rounded-full bg-[#f4f6fb] px-4 py-3 text-sm ${TXT_SUAVE}`}>No que você está pensando?</span>
        </Link>
      )}
      <div role="tablist" aria-label="Filtro do feed" className="grid grid-cols-2 gap-1 p-1 rounded-full bg-white border border-[#e8eaf3] mb-4">
        {ABAS.map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" aria-selected={filtro === chave} onClick={() => setFiltro(chave)}
            className={`min-h-[44px] rounded-full text-sm font-bold ${filtro === chave ? 'bg-[#141a3a] text-white' : TXT_SUAVE}`}>{rotulo}</button>
        ))}
      </div>
      {carregando ? <Carregando />
        : erro ? (
          <div className={`${CARD} p-6 text-center`}>
            <p className={TXT}>{textoDoErro(erro, 'Não consegui abrir o feed.')}</p>
            <button type="button" onClick={() => carregar(filtro)} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
          </div>
        ) : (
          <ListaDePosts itens={itens} setItens={setItens} proximo={proximo} carregarMais={carregarMais} maisCarregando={mais}
            status={status} clubeId={clubeId}
            vazio={<VazioRede titulo="Ainda não há publicações">Seja o primeiro a compartilhar algo bom do seu clube!</VazioRede>} />
        )}
    </div>
  )
}
