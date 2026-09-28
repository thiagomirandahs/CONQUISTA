import { createContext, useContext } from 'react'

// Situação da pessoa na rede (comunidade_meu_status): quem pode ver, publicar, papel, suspensão.
// O LayoutRede carrega uma vez; as telas leem daqui. O servidor continua decidindo tudo.
export const RedeContexto = createContext({ status: null, recarregar: () => {} })
export const useRede = () => useContext(RedeContexto)
