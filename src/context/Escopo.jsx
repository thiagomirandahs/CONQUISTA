import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './Auth.jsx'
import { carregarContextoInstitucional } from '../services/institucional.js'
import { definirEscopoAtivoNoTransporte } from '../lib/supabase.js'

// EscopoContext — a jornada INSTITUCIONAL, paralela ao ClubeContext (que segue intacto).
// Identidade → vínculos institucionais → escopo em uso → capacidades naquele escopo → dados permitidos.
//
// Um distrito/região/campo NÃO é um clube: tem contexto próprio, header próprio (x-escopo-atual) e
// capacidades próprias. Quem só tem vínculo de clube fica com a lista vazia e nunca vê o portal.
// Falha fechada: sem escopo em uso, nenhuma capacidade está ligada.
const SEM_CAPACIDADES = Object.freeze({ ver_clubes: false, ver_painel: false, decidir_workflow: false })

const VALOR_PADRAO = Object.freeze({
  carregando: true, erro: null, escopos: [], escopo: null, escopoId: null,
  temEscopo: false, capacidades: SEM_CAPACIDADES,
  trocarEscopo: async () => {}, recarregar: async () => {},
})

const EscopoContext = createContext(VALOR_PADRAO)
export const useEscopo = () => useContext(EscopoContext)

// Guarda a escolha POR ABA (sessionStorage): duas abas podem estar em escopos diferentes.
//
// Nota histórica que vale registrar: este comentário dizia "como o clube", e não era verdade — o
// clube usava localStorage, compartilhado entre abas. A assimetria passou despercebida por fases
// porque só aparece com a mesma conta em duas abas. Desde a fase 8.5 os dois usam o mesmo padrão,
// e agora o "como o clube" descreve o que o código faz.
const chaveAba = (uid) => `escopo_atual:${uid}`
const lerEscopoPreferido = (uid) => { try { return sessionStorage.getItem(chaveAba(uid)) || null } catch { return null } }
const guardarEscopoPreferido = (uid, id) => { try { id ? sessionStorage.setItem(chaveAba(uid), id) : sessionStorage.removeItem(chaveAba(uid)) } catch { /* sem storage */ } }
// Exportado para o ClubeProvider limpar na SAÍDA. A chave é por uid, então não vazaria para outra
// pessoa de qualquer forma — mas "não vaza" e "não sobrevive" são coisas diferentes, e o item 4 da
// fase 8.5 pede a segunda.
export const esquecerEscopoDaAba = (uid) => guardarEscopoPreferido(uid, null)

export function EscopoProvider({ children }) {
  const { session } = useAuth()
  const uid = session?.user?.id || null
  const [estado, setEstado] = useState({ uid: null, contexto: null, erro: null, carregando: true })
  const uidAtual = useRef(uid)
  useEffect(() => { uidAtual.current = uid }, [uid])

  const buscar = useCallback(async (para) => {
    try {
      const contexto = await carregarContextoInstitucional()
      if (uidAtual.current === para) setEstado({ uid: para, contexto, erro: null, carregando: false })
    } catch (erro) {
      if (uidAtual.current === para) setEstado({ uid: para, contexto: null, erro, carregando: false })
    }
  }, [])

  useEffect(() => {
    if (!uid) { setEstado({ uid: null, contexto: null, erro: null, carregando: false }); return undefined }
    definirEscopoAtivoNoTransporte(lerEscopoPreferido(uid))
    buscar(uid)
    return () => {}
  }, [uid, buscar])

  // Quem tem UM único escopo não deveria ter que "escolher" nada: entra direto nele. Com mais de um, a
  // escolha continua explícita (o seletor aparece). Em qualquer caso quem valida é o servidor — entrar
  // num escopo nunca cria acesso, só diz em qual deles agir.
  const contexto = estado.contexto
  useEffect(() => {
    if (!uid || !contexto) return
    const lista = contexto.escopos || []
    if (contexto.escopo_atual_id || lista.length !== 1) return
    const unico = lista[0]
    if (!unico?.selecionavel) return
    definirEscopoAtivoNoTransporte(unico.escopo_id)
    guardarEscopoPreferido(uid, unico.escopo_id)
    buscar(uid)
  }, [uid, contexto, buscar])

  const trocarEscopo = useCallback(async (escopoId) => {
    if (!uid) return
    definirEscopoAtivoNoTransporte(escopoId)
    guardarEscopoPreferido(uid, escopoId)
    setEstado((e) => ({ ...e, carregando: true }))
    await buscar(uid)
  }, [uid, buscar])

  const valor = useMemo(() => {
    const escopos = estado.contexto?.escopos || []
    const emUso = escopos.find((e) => e.em_uso) || null
    return {
      carregando: estado.carregando,
      erro: estado.erro,
      escopos,
      escopo: emUso,
      escopoId: emUso?.escopo_id || null,
      temEscopo: escopos.length > 0,
      capacidades: emUso?.capacidades || SEM_CAPACIDADES,
      trocarEscopo,
      recarregar: () => buscar(uid),
    }
  }, [estado, trocarEscopo, buscar, uid])

  return <EscopoContext.Provider value={valor}>{children}</EscopoContext.Provider>
}
