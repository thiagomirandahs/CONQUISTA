import { useState } from 'react'
import { useClube } from '../context/Clube.jsx'
import { MARCA_PRODUTO } from '../lib/marca.js'

// Logo do clube em uso (marca por clube — vem do servidor). O Tenant 001 segue com a logo leve de sempre (56KB: nunca passa de ~96px na tela).
// Clube sem logo — ou com a imagem fora do ar — mostra o emblema com a SIGLA dele, nunca a logo de outro clube.
// `produto`: telas GLOBAIS (abertura, carregamento, login, cadastro) — sempre o emblema DesbravaClube,
// nunca o brasão do clube, mesmo com sessão viva. O brasão do clube fica nas superfícies internas.
export default function Logo({ className = 'w-12 h-12', produto = false }) {
  const { marca: marcaDoClube } = useClube()
  const marca = produto ? MARCA_PRODUTO : marcaDoClube
  const [falhou, setFalhou] = useState(null)      // qual URL falhou (trocar de clube dá outra chance, sem efeito)

  if (!marca.logoUrl || falhou === marca.logoUrl) {
    return (
      <div className={`${className} grid place-items-center rounded-full bg-dourado text-azul font-extrabold`}>
        {marca.sigla}
      </div>
    )
  }

  return (
    <img
      src={marca.logoUrl}
      alt={marca.nome}
      className={`${className} object-contain`}
      loading="lazy"
      decoding="async"
      onError={() => setFalhou(marca.logoUrl)}
    />
  )
}
