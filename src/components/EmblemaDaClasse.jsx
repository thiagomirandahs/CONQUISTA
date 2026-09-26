import { corDaClasse, ehClasseAvancada } from '../lib/corDaClasse.js'

// Emblema PRÓPRIO do app (SVG simples: escudo na cor da classe, estrela e a inicial). NÃO é a insígnia
// oficial da DSA — aquelas são marca registrada/direito autoral e não são usadas nem baixadas aqui.
// Classe Avançada: mesma cor da regular pareada, com detalhe próprio — um segundo contorno por dentro
// do escudo e três estrelas no lugar de uma (dá para diferenciar de relance, sem depender só de cor).
//
// Ponto de troca futuro: se o clube tiver AUTORIZAÇÃO para usar a imagem oficial, basta preencher
// IMAGENS_AUTORIZADAS (chave = nome da classe em minúsculas, sem acento → URL da imagem) ou passar a
// prop `imagem`. Com imagem, o componente mostra a imagem no lugar do desenho.
export const IMAGENS_AUTORIZADAS = {}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const ESTRELA = 'l2.2 4.6 5 .6 -3.7 3.4 1 5 -4.5-2.5 -4.5 2.5 1-5 -3.7-3.4 5-.6 Z'

export default function EmblemaDaClasse({ nome, tamanho = 48, imagem = null, className = '' }) {
  const src = imagem || IMAGENS_AUTORIZADAS[normalizar(nome)]
  if (src) {
    return <img src={src} alt="" aria-hidden="true" width={tamanho} height={tamanho} className={`shrink-0 object-contain ${className}`} />
  }
  const cor = corDaClasse(nome) || { hex: '#64748b', texto: '#ffffff', escuro: '#475569' }
  const avancada = ehClasseAvancada(nome)
  const inicial = (String(nome || '?').trim()[0] || '?').toUpperCase()
  return (
    <svg data-testid="emblema-classe" data-avancada={avancada ? 'true' : 'false'} aria-hidden="true" focusable="false" viewBox="0 0 48 56"
      width={tamanho} height={Math.round(tamanho * 56 / 48)} className={`shrink-0 drop-shadow ${className}`}>
      {/* escudo com borda branca e contorno escuro (aparece sobre fundo claro e sobre a própria cor) */}
      <path d="M24 2 L44 9 V27 C44 40 35 49 24 54 C13 49 4 40 4 27 V9 Z" fill={cor.hex} stroke="#ffffff" strokeWidth="3" />
      <path d="M24 2 L44 9 V27 C44 40 35 49 24 54 C13 49 4 40 4 27 V9 Z" fill="none" stroke={cor.escuro} strokeWidth="1" />
      {avancada && (
        // detalhe da avançada: segundo contorno por dentro do escudo
        <path data-testid="emblema-detalhe-avancada" d="M24 7 L39.5 12.5 V27 C39.5 37.5 32.5 45 24 49 C15.5 45 8.5 37.5 8.5 27 V12.5 Z"
          fill="none" stroke={cor.texto} strokeWidth="1.5" strokeDasharray="3 2" />
      )}
      {avancada ? (
        <g fill={cor.texto}>
          <path d={`M24 10 ${ESTRELA}`} transform="translate(0 0)" />
          <path d={`M24 10 ${ESTRELA}`} transform="translate(-8.5 3) scale(1)" opacity="0.9" />
          <path d={`M24 10 ${ESTRELA}`} transform="translate(8.5 3)" opacity="0.9" />
        </g>
      ) : (
        <path d={`M24 8.5 ${ESTRELA}`} fill={cor.texto} />
      )}
      {/* inicial da classe */}
      <text x="24" y="42" textAnchor="middle" fontSize="18" fontWeight="900" fontFamily="system-ui, sans-serif" fill={cor.texto}>{inicial}</text>
    </svg>
  )
}
