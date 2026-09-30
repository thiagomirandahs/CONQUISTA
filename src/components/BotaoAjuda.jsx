import { Link, useInRouterContext } from 'react-router-dom'

// "?" discreto no cabeçalho das telas principais: abre o tutorial direto no tópico daquela tela (/ajuda#topico).
// Fora de um Router (telas montadas sozinhas nos testes) vira um <a> comum — nunca quebra a tela que o usa.
// `estilo` troca a forma e as cores por completo (a Rede DBV usa o quadradinho marinho dela); sem ele, o
// círculo de sempre (`sobreEscuro` = versão para cabeçalho escuro). O alvo é sempre 44 px.
const BASE = 'inline-grid h-11 w-11 shrink-0 place-items-center text-base font-extrabold no-underline'
const NORMAL = 'rounded-full border border-line bg-surface text-muted active:bg-surface2'
const SOBRE_ESCURO = 'rounded-full border border-white/30 bg-white/15 text-white active:bg-white/25'

export default function BotaoAjuda({ topico, sobreEscuro = false, estilo, className = '' }) {
  const noRouter = useInRouterContext()
  const destino = `/ajuda#${topico}`
  const variante = estilo || (sobreEscuro ? SOBRE_ESCURO : NORMAL)
  const props = { 'aria-label': 'Como usar esta tela', title: 'Como usar esta tela', 'data-testid': 'botao-ajuda', className: `${BASE} ${variante} ${className}` }
  return noRouter ? <Link to={destino} {...props}>?</Link> : <a href={destino} {...props}>?</a>
}
