import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './Auth.jsx'
import { carregarContexto } from '../services/clubes.js'
import { definirClubeAtivoNoTransporte, definirEscopoAtivoNoTransporte } from '../lib/supabase.js'
import { esquecerEscopoDaAba } from './Escopo.jsx'
import {
  permissoesDoPapel, resolverClubeDaAba, podeTrocarPara, temRecursoNoVinculo, clubePadraoSemCabecalho,
  lerClubePreferido, guardarClubePreferido, esquecerClubePreferido,
} from '../lib/clube.js'
import { MARCA_PRODUTO, aplicarMarca, lerMarcaSalva, salvarMarca, esquecerMarcaSalva } from '../lib/marca.js'

// ClubeContext (o "OrganizationContext" do produto): a SESSÃO resolve, de uma vez, em quais clubes a pessoa está, qual está em uso, o papel dela
// NESSE clube, a unidade, as permissões, os recursos ligados e a marca. As telas perguntam aqui — nunca mais a `profiles.papel`/`unidade_id`
// (que são globais da pessoa) nem a um nome de clube escrito no código.
//
// Falha fechada: sem vínculo ATIVO no clube em uso, o papel é nulo e nenhuma permissão está ligada (nem em erro de rede).
// Um clube só entra em uso se a pessoa tem vínculo ativo com ele E o servidor age nele (`selecionavel`): trocar de clube nunca cria acesso.
const PERMISSOES_NENHUMA = permissoesDoPapel(null)

const VALOR_PADRAO = Object.freeze({
  carregando: true, erro: null, semVinculo: false, precisaEscolher: false, legado: false,
  vinculos: [], vinculo: null, clubeId: null, papel: null, status: null, unidadeId: null, unidadeNome: null,
  clubeDaAbaEhOPadrao: false,
  marca: MARCA_PRODUTO, recursos: {}, ...PERMISSOES_NENHUMA,
  temRecurso: () => false, trocarClube: async () => ({ ok: false, motivo: 'sem_vinculo' }), recarregar: async () => {},
})

const ClubeContext = createContext(VALOR_PADRAO)
export const useClube = () => useContext(ClubeContext)

export function ClubeProvider({ children }) {
  const { session } = useAuth()
  const uid = session?.user?.id || null
  // resposta do servidor JÁ ligada ao usuário que a pediu (nunca mostra o contexto de outra pessoa)
  const [estado, setEstado] = useState({ uid: null, contexto: null, erro: null })
  const [escolha, setEscolha] = useState({ uid: null, clubeId: null })
  // A marca guardada é DE QUEM está logado, e é relida quando a identidade muda. Ela existe para o
  // primeiro quadro depois de a sessão ser reconhecida (o app reabrindo com sessão viva) não piscar
  // o tema do produto antes da resposta do servidor.
  //
  // Sem `uid` — a tela de entrada, antes de alguém se identificar — ela é NULA por definição: ali
  // não há contexto de clube, e sem contexto de clube a identidade é a do produto. Era aqui que a
  // marca do clube de quem saiu (ou de quem usou o aparelho antes) aparecia para a próxima pessoa.
  const marcaSalva = useMemo(() => lerMarcaSalva(uid), [uid])
  // "a sessão acabou NESTA aba" — ver o efeito de saída mais abaixo. Fica declarado aqui, junto do
  // resto do estado, porque `marca` o consulta antes daquele ponto do arquivo.
  const [saiu, setSaiu] = useState(false)

  // quem está logado AGORA: uma resposta atrasada de outra pessoa (troca de conta no meio do pedido) é descartada
  const uidAtual = useRef(uid)
  useEffect(() => { uidAtual.current = uid }, [uid])

  const buscar = useCallback(async (para) => {
    try {
      const contexto = await carregarContexto(para)
      if (uidAtual.current === para) setEstado({ uid: para, contexto, erro: null })
    } catch (erro) {
      if (uidAtual.current === para) setEstado({ uid: para, contexto: null, erro })
    }
  }, [])

  useEffect(() => {
    if (!uid) return undefined
    let vivo = true
    // pede logo o clube guardado NESTA aba (se houver) — sem isso, a 1ª resposta viria no clube
    // padrão do servidor e só corrigiria depois de um recarregar()
    definirClubeAtivoNoTransporte(lerClubePreferido(uid))
    carregarContexto(uid)
      .then((contexto) => { if (vivo) setEstado({ uid, contexto, erro: null }) })
      .catch((erro) => { if (vivo) setEstado({ uid, contexto: null, erro }) })
    return () => { vivo = false }
  }, [uid])

  // sem sessão o contexto de ninguém vale; enquanto a resposta do usuário atual não chega, está carregando
  const carregando = !!uid && estado.uid !== uid
  const contexto = uid && estado.uid === uid ? estado.contexto : null
  const erro = uid && estado.uid === uid ? estado.erro : null
  const vinculos = useMemo(() => contexto?.vinculos || [], [contexto])

  const preferidoId = useMemo(() => (uid ? (escolha.uid === uid ? escolha.clubeId : lerClubePreferido(uid)) : null), [uid, escolha])
  const resolucao = useMemo(
    () => resolverClubeDaAba({ vinculos, servidorClubeId: contexto?.servidorClubeId, preferidoId }),
    [vinculos, contexto, preferidoId],
  )
  const clubeId = resolucao.clubeId
  const vinculo = useMemo(() => vinculos.find((v) => v.clubeId === clubeId) || null, [vinculos, clubeId])

  // "O clube que você usava não vale mais, e há outros — escolha." É um estado de tela, não um
  // erro: nada quebrou, a pessoa só perdeu acesso a um dos clubes dela e precisa dizer para onde ir.
  // Só existe depois da resposta do servidor: enquanto carrega, não se sabe nada.
  const precisaEscolher = !carregando && !erro && !!uid && resolucao.situacao === 'precisa_escolher'

  // A aba REGISTRA o clube que resolveu, mesmo sem ninguém ter trocado de clube. Sem isto, uma aba
  // que nunca trocou não teria marca própria em sessionStorage e, ao recarregar, seguiria a semente
  // que a OUTRA aba reescreveu — que é exatamente o defeito que o item 2 manda corrigir.
  useEffect(() => { if (uid && clubeId) guardarClubePreferido(uid, clubeId) }, [uid, clubeId])

  // A marca some NO MESMO QUADRO em que o clube deixa de valer. Se dependesse da próxima resposta
  // do servidor, a tela de "escolha outro clube" apareceria vestida com as cores e o logo do clube
  // que a pessoa acabou de perder.
  const marcaGuardada = saiu || precisaEscolher ? null : marcaSalva
  const marca = vinculo?.marca || marcaGuardada || MARCA_PRODUTO
  useEffect(() => { aplicarMarca(marca) }, [marca])
  useEffect(() => {
    if (vinculo && contexto && !contexto.legado) salvarMarca(vinculo.clubeId, vinculo.marca, uid)
  }, [vinculo, contexto, uid])
  // SAIR é diferente de FECHAR, e a marca guardada tem de tratar os dois casos de formas opostas.
  //
  // Guardar a marca (`cq.marca.v1`) existe por um bom motivo: quem fecha o app e volta vê o nome e
  // as cores do próprio clube já na tela de entrada, em vez do tema padrão piscando até o servidor
  // responder. Isso é feature, e continua.
  //
  // Sair é outra coisa: é o gesto de entregar o aparelho. Medido no navegador nesta fase — depois
  // de sair do clube B, a TELA DE LOGIN seguia com a sigla, o nome, o lema, as cores e o "desde"
  // de B. No tablet do clube ou no celular de casa, a próxima pessoa abre e vê a identidade do
  // clube de quem usou antes. `esquecerMarcaSalva()` estava escrita em lib/marca.js desde sempre e
  // nunca era chamada por ninguém.
  //
  // Junto com a marca vai TODO o contexto: o clube da aba, a semente do aparelho, o escopo
  // institucional e o que o transporte ainda mandaria nos headers. O que sobrevive de propósito é o
  // tema claro/escuro, que é preferência do APARELHO e não diz nada sobre clube nem sobre pessoa.
  useEffect(() => {
    if (!uid && estado.uid) {
      esquecerClubePreferido()
      esquecerMarcaSalva()
      esquecerEscopoDaAba(estado.uid)
      definirClubeAtivoNoTransporte(null)
      definirEscopoAtivoNoTransporte(null)
      setSaiu(true)
    }
    if (uid) setSaiu(false)
  }, [uid, estado.uid])
  // toda chamada ao servidor (desta aba) passa a pedir o clube EM USO — cobre a resolução inicial
  // (preferidoId), uma troca de clube e a volta ao padrão quando a preferência deixa de valer
  useEffect(() => { definirClubeAtivoNoTransporte(clubeId) }, [clubeId])

  const trocarClube = useCallback(async (id) => {
    const r = podeTrocarPara(vinculos, id)
    if (!r.ok) return r
    guardarClubePreferido(uid, id)
    setEscolha({ uid, clubeId: id })
    return { ok: true }
  }, [vinculos, uid])

  const recarregar = useCallback(async () => { if (uid) await buscar(uid) }, [uid, buscar])

  const papel = vinculo && vinculo.status === 'ativo' ? vinculo.papel : null
  const valor = useMemo(() => ({
    carregando, erro,
    // `semVinculo` é "não há clube nenhum para você". `precisaEscolher` é "havia, e agora você
    // precisa dizer qual" — a tela trata os dois de formas diferentes, então o contexto os separa.
    semVinculo: !carregando && !erro && !!uid && !vinculo && !precisaEscolher,
    precisaEscolher,
    legado: !!contexto?.legado,
    vinculos, vinculo, clubeId, status: vinculo?.status || null,
    unidadeId: vinculo?.unidadeId ?? null, unidadeNome: vinculo?.unidadeNome ?? null,
    // true só quando é CERTO que o clube desta aba é o que o servidor usa sem header — o do tempo
    // real. Na dúvida é false (ver clubePadraoSemCabecalho): o chat usa isto para decidir se precisa
    // do reforço periódico, e errar para "não precisa" deixaria a aba do clube secundário surda.
    clubeDaAbaEhOPadrao: !!clubeId && clubePadraoSemCabecalho(vinculos) === clubeId,
    marca, recursos: vinculo?.status === 'ativo' ? vinculo.recursos : {},
    ...(vinculo && vinculo.status === 'ativo' ? permissoesDoPapel(papel) : PERMISSOES_NENHUMA),
    temRecurso: (chave) => temRecursoNoVinculo(vinculo, chave),
    trocarClube, recarregar,
  }), [carregando, erro, uid, contexto, vinculos, vinculo, clubeId, marca, papel, precisaEscolher, trocarClube, recarregar])

  return <ClubeContext.Provider value={valor}>{children}</ClubeContext.Provider>
}
