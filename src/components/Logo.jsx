import { useState } from 'react'

// Mostra a logo do clube. Usa o icon-192 (56KB) em vez do logo.png de 319KB —
// a logo nunca passa de ~96px na tela, então 192px sobra e economiza dados.
// Se o arquivo não existir, mostra um emblema "FC" no lugar.
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
      src="/icon-192.png"
      alt="Filhos da Conquista"
      className={`${className} object-contain`}
      loading="lazy"
      decoding="async"
      onError={() => setErro(true)}
    />
  )
}
