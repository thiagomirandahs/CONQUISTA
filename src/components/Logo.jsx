import { useState } from 'react'

// Mostra a logo do clube (public/logo.png).
// Se o arquivo ainda não existir, mostra um emblema "FC" no lugar.
export default function Logo({ className = 'w-12 h-12' }) {
  const [erro, setErro] = useState(false)

  if (erro) {
    return (
      <div className={`${className} grid place-items-center rounded-full bg-dourado text-azul font-extrabold`}>
        FC
      </div>
    )
  }

  return (
    <img
      src="/logo.png"
      alt="Filhos da Conquista"
      className={`${className} object-contain`}
      onError={() => setErro(true)}
    />
  )
}
