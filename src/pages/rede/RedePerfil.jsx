import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useClube } from '../../context/Clube.jsx'
import { carregarPerfil, carregarPostsDoPerfil } from '../../services/rede.js'
import { avisar } from '../../ui/avisos.jsx'
import { Carregando } from '../../ui/index.jsx'
import { useRede } from './contexto.js'
import { AvatarRede, CARD, GRADIENTE, ListaDePosts, TXT, TXT_SUAVE, VazioRede, textoDoErro } from './componentes.jsx'

// Perfil da Rede DBV (/rede/perfil = o meu; /rede/perfil/:id = de outra pessoa). A foto de rosto só vem
// do servidor com a autorização de uso de imagem; sem ela, iniciais. Nada de classes aqui (decisão do dono).
const ABAS = [['publicacoes', 'Publicações'], ['conquistas', 'Conquistas'], ['desafios', 'Desafios']]
const VAZIO = {
  publicacoes: ['📝', 'Nenhuma publicação ainda'],
  conquistas: ['🎖️', 'Nenhuma conquista publicada'],
  desafios: ['🏅', 'Ainda não participou de desafios'],
  salvos: ['🔖', 'Nada salvo', 'Toque no marcador de um post para guardar aqui. Só você vê.'],
}

// trocar de perfil (/rede/perfil/a -> /rede/perfil/b) remonta tudo do zero
export default function RedePerfil() {
  const { id } = useParams()
  return <Perfil key={id || 'eu'} id={id} />
}

function Perfil({ id }) {
  const { clubeId } = useClube()
  const { status } = useRede()
  const [perfil, setPerfil] = useState(null)
  const [erro, setErro] = useState(null)
  const [aba, setAba] = useState('publicacoes')
  const [itens, setItens] = useState(null)
  const [proximo, setProximo] = useState(null)
  const [mais, setMais] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarPerfil(id || null).then((p) => { if (vivo) setPerfil(p) }).catch((e) => { if (vivo) setErro(e) })
    return () => { vivo = false }
  }, [id])

  const carregarAba = useCallback(async (a) => {
    setItens(null)
    try {
      const r = await carregarPostsDoPerfil(id || null, a)
      setItens(r?.itens || []); setProximo(r?.proximo || null)
    } catch (e) { setItens([]); avisar.info(textoDoErro(e, 'Não consegui carregar.')) }
  }, [id])
  useEffect(() => { if (perfil) carregarAba(aba) }, [perfil, aba, carregarAba])

  async function carregarMais() {
    if (!proximo || mais) return
    setMais(true)
    try {
      const r = await carregarPostsDoPerfil(id || null, aba, proximo)
      setItens((x) => [...x, ...(r?.itens || [])]); setProximo(r?.proximo || null)
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui carregar mais.')) }
    setMais(false)
  }

  if (erro) return <div className={`${CARD} p-6 text-center`}><p className={TXT}>{textoDoErro(erro, 'Não consegui abrir o perfil.')}</p></div>
  if (!perfil) return <Carregando />
  const abas = perfil.eu ? [...ABAS, ['salvos', 'Salvos']] : ABAS
  const [icone, titulo, texto] = VAZIO[aba]
  const desde = perfil.desde ? `${perfil.papel === 'desbravador' ? 'Desbravador(a)' : 'No clube'} desde ${perfil.desde}` : null

  return (
    <div>
      <section className={`${CARD} overflow-hidden mb-4`} aria-label={`Perfil de ${perfil.nome}`}>
        <div className={`${GRADIENTE} h-24`} aria-hidden="true" />
        <div className="px-4 pb-4 -mt-12 text-center">
          <div className="inline-block"><AvatarRede nome={perfil.nome} foto={perfil.foto} tamanho="w-24 h-24" texto="text-2xl" /></div>
          <h1 className={`text-xl font-black ${TXT} mt-2`}>{perfil.nome}</h1>
          <p className="mt-1"><span className="inline-block text-xs font-bold text-[#3b2bd9] bg-[#eef1ff] rounded-full px-3 py-1">🛡️ {perfil.clube}</span></p>
          {desde && <p className={`text-sm ${TXT_SUAVE} mt-2`}>{desde}</p>}
          <dl className="grid grid-cols-3 gap-2 mt-4">
            {[['Publicações', perfil.publicacoes], ['Conquistas', perfil.conquistas], ['Pontos da rede', perfil.pontos]].map(([r, v]) => (
              <div key={r} className="rounded-2xl bg-[#f5f6fb] py-2">
                <dt className={`text-[11px] font-bold ${TXT_SUAVE}`}>{r}</dt>
                <dd className={`text-lg font-black ${TXT}`}>{v ?? 0}</dd>
              </div>
            ))}
          </dl>
          {perfil.eu && !perfil.imagem_autorizada && (
            <p className={`text-xs ${TXT_SUAVE} mt-3`}>Sua foto de rosto aparece na rede quando a diretoria arquivar a autorização de uso de imagem.</p>
          )}
        </div>
      </section>
      <div role="tablist" aria-label="Abas do perfil" className="flex gap-1 p-1 rounded-full bg-white border border-[#e8eaf3] mb-4">
        {abas.map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}
            className={`flex-1 min-w-0 min-h-[44px] rounded-full text-xs sm:text-sm font-bold truncate ${aba === chave ? 'bg-[#141a3a] text-white' : TXT_SUAVE}`}>{rotulo}</button>
        ))}
      </div>
      {itens === null ? <Carregando linhas={2} /> : (
        <ListaDePosts itens={itens} setItens={setItens} proximo={proximo} carregarMais={carregarMais} maisCarregando={mais}
          status={status} clubeId={clubeId} vazio={<VazioRede icone={icone} titulo={titulo}>{texto}</VazioRede>} />
      )}
    </div>
  )
}
