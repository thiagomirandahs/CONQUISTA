// Ícones decorativos: o nome acessível continua no texto do destino.
const caminhos = {
  '/inicio': 'm3 10 9-7 9 7v11h-6v-7H9v7H3Z',
  '/jornada': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4 5-2 6-6 2 2-6Z',
  '/meu-clube': 'm3 21 9-18 9 18ZM9 21l3-7 3 7',
  '/jogos': 'M7 7h10c3 0 4 3 4 7s-2 5-4 2l-1-1H8l-1 1c-2 3-4 2-4-2s1-7 4-7Zm0 3v5m-2-2.5h4m7-1h.01m2 2h.01',
  '/gestao': 'M4 7h16M4 17h16M8 4v6m8 4v6',
  '/eu': 'M16 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 21v-3a8 6 0 0 1 16 0v3',
  '/meu-filho': 'M10 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm10 1a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM1 21v-4a6 5 0 0 1 12 0v4m1-8a6 5 0 0 1 9 4v4',
  '/institucional': 'm3 9 9-6 9 6ZM5 10v9m7-9v9m7-9v9M3 21h18',
  '/criar-clube': 'm3 21 9-18 9 18ZM9 21l3-7 3 7',
}
export default function IconeDestino({ para, fallback }) {
  const d = caminhos[para]
  return d ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={d} /></svg> : <span aria-hidden="true">{fallback}</span>
}
