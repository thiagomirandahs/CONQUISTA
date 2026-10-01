import { corDaClasse } from '../../lib/corDaClasse.js'

// Moldura de celular feita só em CSS (borda fina, cantos arredondados) com uma TELA REAL do app dentro.
// `prioridade` = a imagem do hero (fetchpriority alto, sem lazy); as demais são lazy.
export function Celular({ tela, prioridade = false, className = '' }) {
  return (
    <div className={`rounded-[2rem] bg-[#0b1b46] p-[5px] shadow-[0_28px_50px_-24px_rgba(11,27,70,0.6)] ring-1 ring-black/5 sm:rounded-[2.4rem] sm:p-[6px] ${className}`}>
      <div className="overflow-hidden rounded-[1.6rem] bg-white sm:rounded-[2rem]">
        <img
          src={tela.src}
          alt={tela.alt}
          width={tela.largura}
          height={tela.altura}
          {...(prioridade ? { fetchPriority: 'high' } : { loading: 'lazy' })}
          decoding={prioridade ? 'sync' : 'async'}
          className="block h-auto w-full"
        />
      </div>
    </div>
  )
}

// Escudo da classe (mesma ideia do app: escudo na cor oficial da classe, com a inicial).
export function EscudoClasse({ nome, className = 'h-14 w-12' }) {
  const cor = corDaClasse(nome)?.hex || '#1d4ed8'
  return (
    <svg viewBox="0 0 48 56" className={className} aria-hidden="true" focusable="false">
      <path d="M24 2 5 9v18c0 13 8 22 19 27 11-5 19-14 19-27V9L24 2Z" fill={cor} stroke="#fff" strokeWidth="2.5" />
      <path d="M24 9.5 11 14.6V27c0 9.2 5.4 15.6 13 19.4C31.600 42.600 37 36.200 37 27V14.600L24 9.500Z" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" />
      <path d="m24 14 2.300 4.700 5.200.8-3.800 3.600.9 5.100L24 25.700l-4.600 2.500.9-5.100-3.800-3.600 5.200-.8L24 14Z" fill="#fff" />
      <text x="24" y="43" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="inherit">{nome.charAt(0)}</text>
    </svg>
  )
}
