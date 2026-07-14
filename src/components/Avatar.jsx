import { useState } from 'react'

// Avatar do desbravador: mostra a FOTO se houver; senão, um emoji ou a inicial do nome.
// Quando os desbravadores subirem foto, é só passar `foto="url"`.
export default function Avatar({ foto, nome = '?', emoji, cor = '#1e3a8a', size = 'w-12 h-12', textSize = 'text-lg' }) {
  const [erro, setErro] = useState(false)

  if (foto && !erro) {
    return (
      <img src={foto} alt={nome}
        loading="lazy" decoding="async"
        onError={() => setErro(true)}
        className={`${size} rounded-full object-cover shadow ring-2 ring-white`} />
    )
  }

  if (emoji) {
    return (
      <div className={`${size} ${textSize} rounded-full grid place-items-center shadow ring-2 ring-white`}
        style={{ backgroundColor: cor + '22' }}>
        <span>{emoji}</span>
      </div>
    )
  }

  return (
    <div className={`${size} ${textSize} rounded-full grid place-items-center text-white font-extrabold shadow ring-2 ring-white`}
      style={{ backgroundColor: cor }}>
      {(nome || '?')[0]?.toUpperCase()}
    </div>
  )
}
