import { createContext, useContext } from 'react'
import { useClube } from '../../context/Clube.jsx'

// Situação da pessoa na rede (comunidade_meu_status): quem pode ver, publicar, papel, suspensão.
// O LayoutRede carrega uma vez; as telas leem daqui. O servidor continua decidindo tudo.
export const RedeContexto = createContext({ status: null, recarregar: () => {} })
export const useRede = () => useContext(RedeContexto)

// Unidade em que a pessoa está NA REDE (migration 490): o clube em uso, ou — entrando como coordenação —
// a unidade de coordenação (distrito, região…). É o primeiro pedaço do caminho da foto no bucket e o
// "Meu clube"/"Minha área" do feed. Vem do servidor (status.unidade_id); sem ele, o clube em uso.
export function useUnidadeDaRede() {
  const { clubeId } = useClube()
  const { status } = useRede()
  return status?.unidade_id || clubeId || null
}
