import { useState } from 'react'
import { useImagem } from '../lib/imagens.js'

// <img> para imagem do bucket PRIVADO 'imagens' (mural, emblema/bandeira de unidade...): o banco guarda a URL de sempre e o
// componente troca por uma URL assinada na hora de exibir (lib/imagens.js). URL de fora do bucket (blob:, externa) sai como está.
// Enquanto assina — ou se a imagem não abrir — mostra uma caixa neutra do MESMO tamanho (a tela não "pula").
// `as` permite usar um <motion.img> (o lightbox do mural).
export default function ImagemPrivada({ src, alt = '', as: Tag = 'img', className = '', ...resto }) {
  const url = useImagem(src)
  const [falhouEm, setFalhouEm] = useState(null)      // qual `src` falhou (trocar o src dá outra chance, sem efeito)

  if (!src) return null
  if (!url || falhouEm === src) return <span aria-hidden="true" className={`${className} block bg-black/10`} />
  return <Tag src={url} alt={alt} className={className} onError={() => setFalhouEm(src)} {...resto} />
}
