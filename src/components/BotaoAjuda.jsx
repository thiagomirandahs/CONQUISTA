import { Link, useInRouterContext } from 'react-router-dom'

// "?" discreto no cabeçalho das telas principais: abre o tutorial direto no tópico daquela tela (/ajuda#topico).
// Fora de um Router (telas montadas sozinhas nos testes) vira um <a> comum — nunca quebra a tela que o usa.
const BASE = 'inline-grid h-11 w-11 shrink-0 place-items-center rounded-full border text-base font-extrabold'
const NORMAL = 'border-line bg-surface text-muted active:bg-surface2'
const SOBRE_ESCURO = 'border-white/30 bg-white/15 text-white active:bg-white/25'

export default function BotaoAjuda({ topico, sobreEscuro = false, className = '' }) {
  const noRouter = useInRouterContext()
  const destino = `/ajuda#${topico}`
  const props = { 'aria-label': 'Como usar esta tela', title: 'Como usar esta tela', 'data-testid': 'botao-ajuda', className: `${BASE} ${sobreEscuro ? SOBRE_ESCURO : NORMAL} ${className}` }
  return noRouter ? <Link to={destino} {...props}>?</Link> : <a href={destino} {...props}>?</a>
}
