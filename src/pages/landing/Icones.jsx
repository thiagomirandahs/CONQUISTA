// Ícones de traço (24x24, currentColor) só da landing — evita dependência de biblioteca inteira.
const TRACOS = {
  membros: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.4.2 4.2 1.8 5 4.8" /></>,
  classes: <><path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" /><path d="M6 9.5V15c0 1.5 2.7 3 6 3s6-1.5 6-3V9.5" /></>,
  especialidades: <><circle cx="12" cy="9" r="5" /><path d="m9 13.5-1.5 7L12 18l4.5 2.5-1.5-7" /></>,
  presenca: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>,
  atividades: <><path d="M4 16.5 9 11l3.5 3.5L20 7" /><path d="M15 7h5v5" /></>,
  avaliacoes: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="m9 13 2 2 4-4.5" /></>,
  responsaveis: <><path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" /></>,
  mensalidades: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10.5h18M7 15h3" /></>,
  documentos: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  assinatura: <><path d="M4 19c3-1 4-5 6-5s1 4 3 4 3-3 7-3" /><path d="m15 4 5 5-7 7H8v-5l7-7Z" /></>,
  qrcode: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2" /></>,
  unidades: <><path d="M4 21V10l8-6 8 6v11" /><path d="M9 21v-6h6v6" /></>,
  indicadores: <><path d="M4 20h16" /><rect x="6" y="11" width="3" height="6" rx=".6" /><rect x="11" y="7" width="3" height="10" rx=".6" /><rect x="16" y="13" width="3" height="4" rx=".6" /></>,
  escudo: <><path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  cadeado: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  nuvem: <><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7Z" /></>,
  historico: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3 4v4h4M12 8v4.5l3 2" /></>,
  camadas: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  celular: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  seta: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  fechar: <><path d="M6 6l12 12M18 6 6 18" /></>,
  mais: <><path d="M12 5v14M5 12h14" /></>,
  usuario: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" /></>,
  bandeira: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  estrela: <><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" /></>,
}

// Extras do redesenho do site (jogos, coordenação, papelada, conversa, foto).
Object.assign(TRACOS, {
  jogos: <><rect x="2.5" y="7" width="19" height="11" rx="5" /><path d="M7.5 10.5v4M5.5 12.5h4" /><circle cx="15.5" cy="11.5" r="1" /><circle cx="18" cy="13.5" r="1" /></>,
  trofeu: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7" /></>,
  mapa: <><path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>,
  papel: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  conversa: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  foto: <><rect x="3" y="6" width="18" height="14" rx="2.5" /><circle cx="12" cy="13" r="3.5" /><path d="M8.5 6 10 3.5h4L15.5 6" /></>,
})

export function Icone({ nome, className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {TRACOS[nome]}
    </svg>
  )
}
