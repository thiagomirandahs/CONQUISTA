// Mini-tours por área (Fase 6, item 6). Lógica PURA: passos, quem vê e o "já visto" por usuário + tour.
// O componente que mostra é src/components/TourDaArea.jsx; quem dispara é a tela da área (Início, Minha Classe,
// Gestão; a Rede DBV vai usar `useTourDaArea('rede')` quando o gatilho for ligado lá).
//
// "Já visto": localStorage por usuário e tour, 1x neste aparelho. O primeiros-passos mantém a chave antiga
// (`dc:tour-visto:<uid>`), para quem já viu o tour genérico não ver de novo.

export const TOURS = {
  'primeiros-passos': {
    titulo: 'Primeiros passos',
    passos: [
      { icone: '🏠', titulo: 'Início', texto: 'Aqui aparece o que é importante agora: o que falta na sua classe, avisos e atalhos do dia.' },
      { icone: '🎖️', titulo: 'Jornada', texto: 'Sua classe e tudo o que você está conquistando: requisitos, missões e experiências do clube.' },
      { icone: '🏕️', titulo: 'Clube', texto: 'Ranking, o cantinho da sua unidade e as outras coisas do clube.' },
      { icone: '👤', titulo: 'Eu', texto: 'Seu perfil, trocar de clube, atualizar o app e "Ajuda / Como usar" — onde você pode rever este tour.' },
    ],
  },
  classes: {
    titulo: 'Classes',
    passos: [
      { icone: '🎖️', titulo: 'Escolher a classe', texto: 'Comece pela classe da sua idade. Se tiver mais de uma, cada uma fica numa aba.' },
      { icone: '📋', titulo: 'Requisitos', texto: 'A classe é dividida em requisitos. Toque em um para ver o que pede e como comprovar (texto ou foto).' },
      { icone: '📤', titulo: 'Enviar para avaliação', texto: 'Fez o requisito? Escreva ou tire a foto e toque em enviar. Ele fica "em avaliação" até o instrutor olhar.' },
      { icone: '✏️', titulo: 'Correção do avaliador', texto: 'Se o avaliador pedir correção, o comentário dele aparece no requisito. Ajuste e envie de novo.' },
    ],
  },
  rede: {
    titulo: 'Rede DBV',
    passos: [
      { icone: '📰', titulo: 'Feed', texto: 'Duas abas: Meu Clube (só o seu clube vê, com stories e desafios) e Comunidade (o que a liderança publica para todos os clubes da Rede).' },
      { icone: '⭕', titulo: 'Stories', texto: 'As bolinhas no topo são stories: ficam no ar por 24 horas.' },
      { icone: '➕', titulo: 'Publicar', texto: 'Toque em ➕ para publicar. Antes de enviar, o app pergunta se você tem certeza: fica visível só para o seu clube (ou para a Rede, quando a liderança publica na Comunidade).' },
      { icone: '🚩', titulo: 'Denunciar', texto: 'Viu algo errado? Toque em ⋮ → Denunciar. O conteúdo some na hora e a diretoria do clube é avisada.' },
      { icone: '🖼️', titulo: 'Autorização de imagem', texto: 'A foto de rosto só aparece com a autorização de imagem arquivada pela diretoria. Sem ela, aparecem as iniciais.' },
    ],
  },
  gestao: {
    titulo: 'Gestão',
    papeis: ['diretoria', 'instrutor'],
    passos: [
      { icone: '🔎', titulo: 'Fila de avaliações', texto: 'No topo ficam os requisitos esperando avaliação. Aprove ou peça correção com um comentário.' },
      { icone: '👥', titulo: 'Membros', texto: 'Em Pessoas você acompanha os membros do clube (aprovar cadastros e equipe são da diretoria).' },
      { icone: '🧰', titulo: 'Recursos', texto: 'As ferramentas aparecem por grupo e só as que o seu papel pode usar. Toque em ? para ver o passo a passo.' },
    ],
  },
}

export const IDS_DOS_TOURS = Object.keys(TOURS)

/** A pessoa (papel no clube em uso) pode ver este tour? */
export function tourPermitido(id, papel) {
  const t = TOURS[id]
  if (!t) return false
  return !t.papeis || t.papeis.includes(papel)
}

/** Tours que aparecem em /ajuda ("Rever tour"), filtrados pelo papel. */
export function toursDoPapel(papel) {
  return IDS_DOS_TOURS.filter((id) => tourPermitido(id, papel)).map((id) => ({ id, titulo: TOURS[id].titulo }))
}

export const chaveDoTourDaArea = (uid, id) => (id === 'primeiros-passos' ? `dc:tour-visto:${uid}` : `dc:tour-visto:${uid}:${id}`)

export function tourDaAreaVisto(uid, id) {
  if (!uid) return true
  try { return globalThis.localStorage?.getItem(chaveDoTourDaArea(uid, id)) === '1' } catch { return false }
}

export function marcarTourDaAreaVisto(uid, id) {
  if (!uid) return
  try { globalThis.localStorage?.setItem(chaveDoTourDaArea(uid, id), '1') } catch { /* sem armazenamento: tudo bem */ }
}
