import { useState } from 'react'
import { gradienteDoTitulo, iniciaisDoTitulo } from '../../lib/leitura.js'

// Capa do livro. Sem capa cadastrada (ou se a imagem falhar): placeholder gerado — gradiente + iniciais.
// Nunca inventa imagem.
export default function CapaLivro({ titulo, url, className = 'h-24 w-16' }) {
  const [quebrou, setQuebrou] = useState(false)
  if (url && !quebrou) {
    return (
      <img src={url} alt={`Capa de ${titulo}`} loading="lazy" decoding="async" onError={() => setQuebrou(true)}
        className={`${className} shrink-0 rounded-lg object-cover shadow-soft`} />
    )
  }
  return (
    <div role="img" aria-label={`Capa de ${titulo}`} data-testid="capa-placeholder" style={{ backgroundImage: gradienteDoTitulo(titulo) }}
      className={`${className} grid shrink-0 place-items-center rounded-lg text-lg font-extrabold tracking-wide text-amber-300 shadow-soft`}>
      <span aria-hidden="true">{iniciaisDoTitulo(titulo)}</span>
    </div>
  )
}
