import { useEffect, useRef } from 'react'
import { registrarFechador } from './camadas.js'

// Enquanto `aberta` for verdadeira, o botão físico de voltar do Android chama `fechar` (ver src/lib/camadas.js).
export function useFechavel(aberta, fechar) {
  const ref = useRef(fechar)
  ref.current = fechar
  useEffect(() => {
    if (!aberta) return undefined
    return registrarFechador(() => ref.current?.())
  }, [aberta])
}
