import { useState } from 'react'
import AvatarPersonagem from './AvatarPersonagem.jsx'
import { useImagem } from '../lib/imagens.js'

// Avatar do desbravador: personagem customizado > FOTO > emoji > inicial do nome.
// Quando os desbravadores subirem foto, é só passar `foto="url"`.
export default function Avatar({ foto, nome = '?', emoji, cor = '#1e3a8a', size = 'w-12 h-12', textSize = 'text-lg', avatarPersonagem }) {
  const [erro, setErro] = useState(false)
  // foto do bucket privado 'imagens': o banco guarda a URL pública de sempre; aqui vira URL assinada (null enquanto assina)
  const src = useImagem(foto)

  if (avatarPersonagem) {
    return <AvatarPersonagem avatar={avatarPersonagem} size={size} />
  }

  if (foto && src && !erro) {
    return (
      <img src={src} alt={nome}
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
