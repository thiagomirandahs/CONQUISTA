// Menu do app: quais abas cada pessoa vê NO CLUBE em uso. Lógica pura (testável); o AppLayout só desenha.
// Entra: o que a pessoa é (permissões do vínculo) e quais recursos o clube liga (feature flags). Sai: a lista de abas.
import { RECURSO_POR_ROTA } from './permissoes.js'

export const ABAS_BASE = [
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/desafios', label: 'Desafios', icon: '🏁' },
  { to: '/chefao', label: 'Chefão', icon: '⚔️' },
  { to: '/missoes', label: 'Missões', icon: '🎯' },
  { to: '/trilha', label: 'Jogos', icon: '🎮' },
  { to: '/leilao', label: 'Leilão', icon: '🏛️' },
  { to: '/chat', label: 'Chat', icon: '💬' },
  { to: '/biblia', label: 'Bíblia', icon: '📖' },
  { to: '/bichinho', label: 'Bichinho', icon: '🐾' },
  { to: '/agenda', label: 'Agenda', icon: '📅' },
  { to: '/atividades', label: 'Atividades', icon: '📋' },
  { to: '/unidades', label: 'Unidades', icon: '🏠' },
  { to: '/mural', label: 'Mural', icon: '📸' },
  { to: '/minha-classe', label: 'Minha Classe', icon: '🎖️' },
]

// Barra inferior do celular: as telas que a criançada mais usa, sempre à mão (as que o clube desligou saem da barra).
export const ABAS_RODAPE_BASE = [
  { to: '/ranking', label: 'Ranking', icon: '🏆' },
  { to: '/desafios', label: 'Desafios', icon: '🏁' },
  { to: '/trilha', label: 'Jogos', icon: '🎮' },
  { to: '/biblia', label: 'Bíblia', icon: '📖' },
  { to: '/bichinho', label: 'Bichinho', icon: '🐾' },
]

const liberada = (aba, temRecurso) => !RECURSO_POR_ROTA[aba.to] || temRecurso(RECURSO_POR_ROTA[aba.to])

// O responsável (pais) só tem o portal do filho; os demais veem as abas dos recursos que o clube usa (+ Gestão para quem tem gestão).
export function abasDoMenu({ ehPais, temGestao }, temRecurso) {
  if (ehPais) return [{ to: '/meu-filho', label: 'Meu Filho', icon: '👨‍👩‍👧' }]
  const abas = ABAS_BASE.filter((aba) => liberada(aba, temRecurso))
  return temGestao ? [...abas, { to: '/gestao', label: 'Gestão', icon: '⚙️' }] : abas
}

export function abasDoRodape(temRecurso) {
  return ABAS_RODAPE_BASE.filter((aba) => liberada(aba, temRecurso))
}
