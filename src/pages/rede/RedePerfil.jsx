import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { carregarPerfil, carregarPostsDoPerfil, caminhoDaMiniatura } from '../../services/rede.js'
import { useFotoComunidadeComEstado } from '../../lib/fotosComunidade.js'
import { avisar } from '../../ui/avisos.jsx'
import { Carregando, Folha } from '../../ui/index.jsx'
import { useRede, useUnidadeDaRede } from './contexto.js'
import {
  AvatarRede, CartaoPost, EsqueletoFeed, Icone, ListaDePosts, PILL_CLARA, SELO_DOURADO, SELO_MARINHO, SeloCoordenacao, TXT, TXT_SUAVE, VazioRede,
  avatarPersonagemDe, textoDoErro,
} from './componentes.jsx'

// Perfil da Rede DBV (/rede/perfil = o meu; /rede/perfil/:id = de outra pessoa): avatar grande à esquerda,
// contadores à direita, nome, "Clube · Unidade" (a unidade só quando o servidor mandar, 502), selos DBV (papel em
// marinho, coordenação em dourado); abas por ícone com sublinhado DOURADO — Fotos (grade 3 colunas), Textos
// (lista), Conquistas, Desafios e Salvos (só no meu). A foto de rosto só vem do servidor com a autorização
// de uso de imagem; sem ela, iniciais. Nada de classes aqui (decisão do dono).
const PAPEL = { desbravador: 'Desbravador(a)', conselheiro: 'Conselheiro(a)', instrutor: 'Instrutor(a)', tesoureiro: 'Tesoureiro(a)', diretoria: 'Diretoria', pais: 'Responsável' }
const ABAS = [
  ['fotos', 'Publicações', 'grade'],
  ['textos', 'Textos', 'texto'],
  ['conquistas', 'Conquistas', 'escudo'],
  ['desafios', 'Desafios', 'trofeu'],
]
const ABA_DO_SERVIDOR = { fotos: 'publicacoes', textos: 'publicacoes' }
const VAZIO = {
  fotos: ['📷', 'Nenhuma foto ainda'],
  textos: ['📝', 'Nenhum texto ainda'],
  conquistas: ['🎖️', 'Nenhuma conquista publicada'],
  desafios: ['🏅', 'Ainda não participou de desafios'],
  salvos: ['🔖', 'Nada salvo', 'Toque no marcador de um post para guardar aqui. Só você vê.'],
}

// trocar de perfil (/rede/perfil/a -> /rede/perfil/b) remonta tudo do zero
export default function RedePerfil() {
  const { id } = useParams()
  return <Perfil key={id || 'eu'} id={id} />
}

function Miniatura({ post, aoAbrir }) {
  // miniatura (~30 KB, migration 555) primeiro; post antigo sem miniatura: cai na foto inteira
  const min = caminhoDaMiniatura(post.foto)
  const [cheia, setCheia] = useState(!min)
  const { url, falhou } = useFotoComunidadeComEstado(cheia ? post.foto : min)
  useEffect(() => { if (falhou && !cheia) setCheia(true) }, [falhou, cheia])
  return (
    <button type="button" onClick={() => aoAbrir(post)} aria-label={post.foto_alt || `Foto de ${post.autor?.nome}`}
      className="relative block aspect-square bg-[var(--rede-superficie)] overflow-hidden">
      {url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="w-full h-full object-cover" />}
      {falhou && cheia && <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-[var(--rede-ink-suave)]" data-testid="miniatura-indisponivel">Foto indisponível</span>}
      {post.status === 'em_analise' && <span className="absolute left-1 top-1 text-xs font-semibold bg-[var(--rede-alerta-suave)] text-[var(--rede-alerta)] rounded-full px-1.5">Em análise</span>}
    </button>
  )
}

function Perfil({ id }) {
  const clubeId = useUnidadeDaRede()   // clube em uso ou unidade de coordenação (490)
  const { status } = useRede()
  const [perfil, setPerfil] = useState(null)
  const [erro, setErro] = useState(null)
  const [tentativa, setTentativa] = useState(0)   // "Tentar de novo" recarrega o perfil
  const [aba, setAba] = useState('fotos')
  const [itens, setItens] = useState(null)
  const [proximo, setProximo] = useState(null)
  const [mais, setMais] = useState(false)
  const [aberto, setAberto] = useState(null)

  useEffect(() => {
    let vivo = true
    carregarPerfil(id || null).then((p) => { if (vivo) setPerfil(p) }).catch((e) => { if (vivo) setErro(e) })
    return () => { vivo = false }
  }, [id, tentativa])

  const carregarAba = useCallback(async (a) => {
    setItens(null)
    try {
      const r = await carregarPostsDoPerfil(id || null, ABA_DO_SERVIDOR[a] || a)
      setItens(r?.itens || []); setProximo(r?.proximo || null)
    } catch (e) { setItens([]); avisar.info(textoDoErro(e, 'Não consegui carregar.')) }
  }, [id])
  useEffect(() => { if (perfil) carregarAba(aba) }, [perfil, aba, carregarAba])

  async function carregarMais() {
    if (!proximo || mais) return
    setMais(true)
    try {
      const r = await carregarPostsDoPerfil(id || null, ABA_DO_SERVIDOR[aba] || aba, proximo)
      setItens((x) => [...x, ...(r?.itens || []).filter((n) => !x.some((y) => y.id === n.id))]); setProximo(r?.proximo || null)   // sem repetidos
    } catch (e) { avisar.info(textoDoErro(e, 'Não consegui carregar mais.')) }
    setMais(false)
  }

  if (erro) return (
    <div className="p-6 text-center">
      <p className={TXT}>{textoDoErro(erro, 'Não consegui abrir o perfil.')}</p>
      <button type="button" onClick={() => { setErro(null); setTentativa((t) => t + 1) }} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
    </div>
  )
  if (!perfil) return <div className="p-4"><Carregando /></div>
  const abas = perfil.eu ? [...ABAS, ['salvos', 'Salvos', 'marcador']] : ABAS
  const [icone, titulo, texto] = VAZIO[aba]
  const desde = perfil.desde ? `${perfil.papel === 'desbravador' ? 'Desbravador(a)' : 'No clube'} desde ${perfil.desde}` : null
  const lista = itens === null ? null
    : aba === 'fotos' ? itens.filter((p) => p.foto)
      : aba === 'textos' ? itens.filter((p) => !p.foto) : itens
  const atualizar = (p) => { setItens((a) => a.map((x) => (x.id === p.id ? p : x))); setAberto(p) }
  const remover = (pid) => { setItens((a) => a.filter((x) => x.id !== pid)); setAberto(null) }

  return (
    <div>
      <section className="px-4 pt-4 pb-3" aria-label={`Perfil de ${perfil.nome}`}>
        <div className="flex items-center gap-5">
          <AvatarRede nome={perfil.nome} foto={perfil.foto} avatarPersonagem={avatarPersonagemDe(perfil)} tamanho="w-[84px] h-[84px]" texto="text-2xl" />
          <dl className="flex-1 grid grid-cols-3 text-center">
            {[['Publicações', perfil.publicacoes], ['Conquistas', perfil.conquistas], ['Pontos da rede', perfil.pontos]].map(([r, v]) => (
              <div key={r} className="flex flex-col-reverse">
                <dt className={`text-[12px] ${TXT_SUAVE} leading-tight`}>{r}</dt>
                <dd className={`text-[18px] font-bold ${TXT}`}>{v ?? 0}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex items-start justify-between gap-2 mt-3">
          <div className="min-w-0">
            <h1 className={`text-[15px] font-bold ${TXT}`}>{perfil.nome}{perfil.coordenacao && <SeloCoordenacao />}</h1>
            <p className={`text-[14px] ${TXT}`} data-testid="perfil-clube">{[perfil.clube, perfil.unidade].filter(Boolean).join(' · ')}</p>
            {desde && <p className={`text-[13px] ${TXT_SUAVE}`}>{desde}</p>}
            <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid="selos-perfil">
              {perfil.coordenacao
                ? <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${SELO_DOURADO}`}>Coordenação</span>
                : PAPEL[perfil.papel] && <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${SELO_MARINHO}`}>{PAPEL[perfil.papel]}</span>}
              {perfil.conquistas > 0 && <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${SELO_DOURADO}`}>🏅 {perfil.conquistas} {perfil.conquistas === 1 ? 'conquista' : 'conquistas'}</span>}
            </div>
          </div>
          {perfil.eu && (
            <Link to="/rede/mais" aria-label="Mais opções da rede" className="shrink-0 w-11 h-11 rounded-xl bg-[var(--rede-superficie)] grid place-items-center text-[var(--rede-ink)]">
              <Icone nome="menu" />
            </Link>
          )}
        </div>
        {/* só o dono recebe imagem_autorizada (500); quem usa o personagem não precisa do aviso (o desenho já aparece) */}
        {perfil.eu && !perfil.imagem_autorizada && perfil.avatar_tipo !== 'personagem' && (
          <p className={`text-xs ${TXT_SUAVE} mt-2`} data-testid="aviso-foto-eu">Sua foto de rosto aparece na rede quando a diretoria do seu clube arquivar a autorização de uso de imagem (papel assinado). Até lá, todos veem as suas iniciais.</p>
        )}
      </section>

      <div role="tablist" aria-label="Abas do perfil" className="flex border-y border-[var(--rede-linha)]">
        {abas.map(([chave, rotulo, ic]) => (
          <button key={chave} type="button" role="tab" id={`aba-perfil-${chave}`} aria-selected={aba === chave} aria-label={rotulo} title={rotulo} onClick={() => setAba(chave)}
            className={`flex-1 min-w-0 min-h-[52px] flex flex-col items-center justify-center gap-0.5 border-b-2 ${aba === chave ? 'border-[var(--rede-destaque)] text-[var(--rede-acao)]' : `border-transparent ${TXT_SUAVE}`}`}>
            <Icone nome={ic} className="w-[22px] h-[22px]" />
            {/* nome embaixo do ícone (o escudo de "Conquistas" ninguém entendia só pelo desenho) */}
            <span className="text-xs font-semibold leading-none truncate max-w-full px-0.5">{rotulo}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`painel-perfil-${aba}`} aria-labelledby={`aba-perfil-${aba}`} tabIndex={0} className="focus:outline-none">
      {lista === null ? <EsqueletoFeed quantidade={1} />
        : aba === 'fotos' ? (
          lista.length === 0 ? <VazioRede icone={icone} titulo={titulo}>{texto}</VazioRede> : (
            <>
              <div className="grid grid-cols-3 gap-[2px]" data-testid="grade-fotos">
                {lista.map((p) => <Miniatura key={p.id} post={p} aoAbrir={setAberto} />)}
              </div>
              {proximo && <div className="py-4 text-center"><button type="button" onClick={carregarMais} className="min-h-[44px] px-4 text-sm font-semibold text-[var(--rede-acao)]">{mais ? 'Carregando…' : 'Ver mais'}</button></div>}
            </>
          )
        ) : (
          <ListaDePosts itens={lista} setItens={(f) => setItens((a) => (typeof f === 'function' ? f(a) : f))} proximo={proximo}
            carregarMais={carregarMais} maisCarregando={mais} status={status} clubeId={clubeId}
            vazio={<VazioRede icone={icone} titulo={titulo}>{texto}</VazioRede>} />
        )}
      </div>

      <Folha tom="rede" aberta={!!aberto} aoFechar={() => setAberto(null)} titulo="Publicação">
        {aberto && <div className="-mx-5"><CartaoPost post={aberto} status={status} clubeId={clubeId} aoAtualizar={atualizar} aoRemover={remover} /></div>}
      </Folha>
    </div>
  )
}
