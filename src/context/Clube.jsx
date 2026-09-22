import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './Auth.jsx'
import { carregarContexto } from '../services/clubes.js'
import { definirClubeAtivoNoTransporte } from '../lib/supabase.js'
import {
  permissoesDoPapel, escolherClubeAtual, podeTrocarPara, temRecursoNoVinculo,
  lerClubePreferido, guardarClubePreferido, esquecerClubePreferido,
} from '../lib/clube.js'
import { MARCA_LEGADA, aplicarMarca, lerMarcaSalva, salvarMarca } from '../lib/marca.js'

// ClubeContext (o "OrganizationContext" do produto): a SESSÃO resolve, de uma vez, em quais clubes a pessoa está, qual está em uso, o papel dela
// NESSE clube, a unidade, as permissões, os recursos ligados e a marca. As telas perguntam aqui — nunca mais a `profiles.papel`/`unidade_id`
// (que são globais da pessoa) nem a um nome de clube escrito no código.
//
// Falha fechada: sem vínculo ATIVO no clube em uso, o papel é nulo e nenhuma permissão está ligada (nem em erro de rede).
// Um clube só entra em uso se a pessoa tem vínculo ativo com ele E o servidor age nele (`selecionavel`): trocar de clube nunca cria acesso.
const PERMISSOES_NENHUMA = permissoesDoPapel(null)

const VALOR_PADRAO = Object.freeze({
  carregando: true, erro: null, semVinculo: false, legado: false,
  vinculos: [], vinculo: null, clubeId: null, papel: null, status: null, unidadeId: null, unidadeNome: null,
  marca: MARCA_LEGADA, recursos: {}, ...PERMISSOES_NENHUMA,
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
  const [marcaSalva] = useState(() => lerMarcaSalva())

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
  const clubeId = useMemo(
    () => escolherClubeAtual({ vinculos, servidorClubeId: contexto?.servidorClubeId, preferidoId }),
    [vinculos, contexto, preferidoId],
  )
  const vinculo = useMemo(() => vinculos.find((v) => v.clubeId === clubeId) || null, [vinculos, clubeId])

  const marca = vinculo?.marca || marcaSalva || MARCA_LEGADA
  useEffect(() => { aplicarMarca(marca) }, [marca])
  useEffect(() => { if (vinculo && contexto && !contexto.legado) salvarMarca(vinculo.clubeId, vinculo.marca) }, [vinculo, contexto])
  useEffect(() => { if (!uid && estado.uid) esquecerClubePreferido() }, [uid, estado.uid])   // saiu: a escolha não fica no aparelho
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
    semVinculo: !carregando && !erro && !!uid && !vinculo,
    legado: !!contexto?.legado,
    vinculos, vinculo, clubeId, status: vinculo?.status || null,
    unidadeId: vinculo?.unidadeId ?? null, unidadeNome: vinculo?.unidadeNome ?? null,
    marca, recursos: vinculo?.status === 'ativo' ? vinculo.recursos : {},
    ...(vinculo && vinculo.status === 'ativo' ? permissoesDoPapel(papel) : PERMISSOES_NENHUMA),
    temRecurso: (chave) => temRecursoNoVinculo(vinculo, chave),
    trocarClube, recarregar,
  }), [carregando, erro, uid, contexto, vinculos, vinculo, clubeId, marca, papel, trocarClube, recarregar])

  return <ClubeContext.Provider value={valor}>{children}</ClubeContext.Provider>
}
