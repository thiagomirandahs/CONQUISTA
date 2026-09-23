// Navegação por JORNADA (fase 7). Lógica pura, testável; o AppLayout só desenha.
//
// O que mudou e por quê (ver AUDITORIA-UX.md):
//   Antes: uma entrada de menu para cada módulo — 16 itens para o desbravador, 17 para a diretoria.
//   Medido a 360×800: 8 dos 17 ficavam ABAIXO da dobra da gaveta, incluindo Minha Classe,
//   Especialidades, Experiências e a própria Gestão.
//   Agora: no máximo 5 DESTINOS, que mudam conforme o papel. Cada destino é um hub com as telas
//   daquele assunto. Nenhuma rota foi removida — o que mudou foi por onde se chega.
//
// Regra de ouro: isto é NAVEGAÇÃO. A segurança continua no RLS e nas RPCs do servidor; esconder um
// destino nunca é a trava — é só não mostrar o que não faz sentido para aquele papel.
import { RECURSO_POR_ROTA } from './permissoes.js'

// ---------------------------------------------------------------- destinos
export const DESTINO = {
  inicio: { to: '/inicio', label: 'Início', icon: '🏠' },
  jornada: { to: '/jornada', label: 'Jornada', icon: '🎖️' },
  clube: { to: '/meu-clube', label: 'Clube', icon: '🏕️' },
  jogos: { to: '/jogos', label: 'Jogos', icon: '🎮' },
  gestao: { to: '/gestao', label: 'Gestão', icon: '⚙️' },
  eu: { to: '/eu', label: 'Eu', icon: '👤' },
  filhos: { to: '/meu-filho', label: 'Meus filhos', icon: '👨‍👩‍👧' },
  portal: { to: '/institucional', label: 'Portal', icon: '🏛️' },
  criarClube: { to: '/criar-clube', label: 'Criar meu clube', icon: '🏕️' },
}

// ---------------------------------------------------------------- o que vive em cada hub
// `recurso` = feature flag do clube (mesma fonte de sempre). Sem recurso = tela do núcleo.
export const HUB_JORNADA = [
  { to: '/minha-classe', label: 'Minha Classe', icon: '🎖️', desc: 'Os requisitos da sua classe', recurso: 'classes' },
  { to: '/minhas-especialidades', label: 'Especialidades', icon: '🏅', desc: 'As suas especialidades', recurso: 'classes' },
  { to: '/experiencias', label: 'Experiências', icon: '✨', desc: 'Desafios e campanhas do clube', recurso: 'experiencias' },
  { to: '/atividades', label: 'Atividades', icon: '📋', desc: 'Tarefas com entrega', recurso: 'atividades' },
  { to: '/missoes', label: 'Missões', icon: '🎯', desc: 'A missão de hoje', recurso: 'missoes' },
  { to: '/biblia', label: 'Bíblia', icon: '📖', desc: 'Sua leitura e progresso', recurso: 'biblia' },
]

export const HUB_CLUBE = [
  { to: '/ranking', label: 'Ranking', icon: '🏆', desc: 'Quem está mandando bem' },
  { to: '/unidades', label: 'Unidades', icon: '🏠', desc: 'As unidades do clube' },
  { to: '/mural', label: 'Mural', icon: '📸', desc: 'As fotos do clube', recurso: 'mural' },
  { to: '/agenda', label: 'Agenda', icon: '📅', desc: 'Reuniões e eventos', recurso: 'agenda' },
  { to: '/chat', label: 'Chat', icon: '💬', desc: 'Conversas do clube', recurso: 'chat' },
]

export const HUB_JOGOS = [
  { to: '/trilha', label: 'Trilha de jogos', icon: '🎮', desc: 'Jogue e suba na trilha', recurso: 'jogos' },
  { to: '/desafios', label: 'Desafios', icon: '🏁', desc: 'Desafios entre unidades', recurso: 'desafios' },
  { to: '/chefao', label: 'Chefão', icon: '⚔️', desc: 'O clube contra o chefão', recurso: 'chefao' },
  { to: '/bichinho', label: 'Bichinho', icon: '🐾', desc: 'Cuide do seu bichinho', recurso: 'bichinho' },
  { to: '/pets-clube', label: 'Bichinhos do clube', icon: '🐶', desc: 'Os bichinhos de todo mundo', recurso: 'bichinho' },
  { to: '/leilao', label: 'Leilão', icon: '🏛️', desc: 'Lances com os pontos da unidade', recurso: 'leilao' },
]

const liberado = (item, temRecurso) => !item.recurso || temRecurso(item.recurso)
export const itensDoHub = (hub, temRecurso) => hub.filter((i) => liberado(i, temRecurso))

// ---------------------------------------------------------------- destinos por papel
// `extras`: { temEscopo } — quem também tem vínculo institucional.
export function destinosDoPapel({ ehPais, temGestao } = {}, temRecurso = () => true, extras = {}) {
  if (ehPais) return [DESTINO.filhos, DESTINO.eu]
  const base = [DESTINO.inicio, DESTINO.jornada, DESTINO.clube]
  // A liderança não perde os jogos: eles passam a viver dentro de Clube, porque ela não é o público
  // deles — e o 4º destino dela precisa ser a operação do clube.
  base.push(temGestao ? DESTINO.gestao : DESTINO.jogos)
  base.push(DESTINO.eu)
  void temRecurso; void extras
  return base
}

// Quem NÃO tem vínculo de clube (coordenador institucional, fundador recém-cadastrado) nunca entra
// no app do clube — e antes desta fase ficava numa tela com um único botão "Sair". Agora tem destino.
export function destinosSemClube({ temEscopo } = {}) {
  const d = []
  if (temEscopo) d.push(DESTINO.portal)
  d.push(DESTINO.criarClube)
  return d
}

// Para onde a pessoa vai ao entrar.
export function rotaInicial(papel) { return papel === 'pais' ? '/meu-filho' : '/inicio' }

// ---------------------------------------------------------------- compatibilidade
// A gaveta lateral do PC continua existindo e mostra TODAS as telas liberadas, agrupadas por hub:
// no desktop há espaço, e quem já conhecia o app continua achando tudo onde esperava.
export function gruposDoMenuLateral(perms, temRecurso) {
  if (perms?.ehPais) return [{ titulo: 'Meus filhos', itens: [DESTINO.filhos] }]
  const grupos = [
    { titulo: 'Jornada', itens: itensDoHub(HUB_JORNADA, temRecurso) },
    { titulo: 'Clube', itens: itensDoHub(HUB_CLUBE, temRecurso) },
    { titulo: 'Jogos', itens: itensDoHub(HUB_JOGOS, temRecurso) },
  ].filter((g) => g.itens.length > 0)
  if (perms?.temGestao) grupos.push({ titulo: 'Liderança', itens: [DESTINO.gestao] })
  return grupos
}

export { RECURSO_POR_ROTA }
