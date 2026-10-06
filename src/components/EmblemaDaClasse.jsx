import { useState } from 'react'
import { corDaClasse, ehClasseAvancada, regularDaAvancada } from '../lib/corDaClasse.js'

// Emblema da classe. Desde 06/10/2026 o dono AUTORIZOU o uso das imagens oficiais (mesma fonte dos emblemas das
// especialidades, mda.wiki.br): public/classes/<classe>.png, 70×70. A Classe Avançada usa a imagem da regular
// pareada (é o mesmo cartão) e ganha um selo de 3 estrelas para diferenciar de relance.
// Se a imagem faltar ou falhar, volta o escudo PRÓPRIO do app (SVG na cor da classe, estrela e a inicial).
// `imagem` (prop) ou IMAGENS_AUTORIZADAS ainda mandam por cima, se um dia for preciso trocar uma classe.
const CLASSES_COM_IMAGEM = ['amigo', 'companheiro', 'pesquisador', 'pioneiro', 'excursionista', 'guia']
export const IMAGENS_AUTORIZADAS = {}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const ESTRELA = 'l2.2 4.6 5 .6 -3.7 3.4 1 5 -4.5-2.5 -4.5 2.5 1-5 -3.7-3.4 5-.6 Z'

export const imagemDaClasse = (nome) => {
  const chave = regularDaAvancada(nome) || normalizar(nome)
  return CLASSES_COM_IMAGEM.includes(chave) ? `/classes/${chave}.png` : null
}

export default function EmblemaDaClasse({ nome, tamanho = 48, imagem = null, className = '' }) {
  const [falhou, setFalhou] = useState(false)
  const src = imagem || IMAGENS_AUTORIZADAS[normalizar(nome)] || (falhou ? null : imagemDaClasse(nome))
  if (src) {
    const avancada = ehClasseAvancada(nome)
    return (
      <span data-testid="emblema-classe" data-avancada={avancada ? 'true' : 'false'} aria-hidden="true"
        className={`relative inline-block shrink-0 ${className}`} style={{ width: tamanho, height: tamanho }}>
        <img src={src} alt="" width={tamanho} height={tamanho} decoding="async" onError={() => setFalhou(true)} className="block h-full w-full object-contain drop-shadow" />
        {avancada && (
          <span data-testid="emblema-detalhe-avancada" className="absolute -bottom-1 -right-1 rounded-full bg-amber-400 px-1 text-[9px] font-black leading-4 text-slate-900 ring-2 ring-white">★★★</span>
        )}
      </span>
    )
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
