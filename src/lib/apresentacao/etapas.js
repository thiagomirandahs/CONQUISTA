// Conteúdo da página "Conheça o DesbravaClube" (/conheca): a apresentação do produto em 8 etapas.
// Só conteúdo — a tela mora em src/pages/site/Conheca.jsx.
//
// Cada etapa: { id, numero, titulo, descricao, imagem?: { src, alt }, video?: { youtubeId, poster? }, cta?: { rotulo, para } }
//   · `imagem` ausente → a tela mostra a ilustração-padrão (número dourado + emblema do produto).
//   · `video` ausente → sem player. Quando existir, é SEMPRE o YouTube sem cookie (youtube-nocookie.com,
//     a única origem que a CSP autoriza em frame-src) e só monta o iframe depois de a pessoa tocar em play.
//   · Os textos descrevem só o que o produto faz hoje (CLAUDE.md e src/lib/tutorial/conteudo.js). Nada de
//     prometer recurso que ainda não existe.

export const ETAPAS = Object.freeze([
  {
    id: 'o-que-e', numero: 1, titulo: 'O que é o DesbravaClube',
    descricao: 'É o clube de Desbravadores na palma da mão: classes, avaliações, avisos e o dia a dia da unidade num só aplicativo. Feito para o celular, funciona bem mesmo com internet fraca. Cada clube tem o seu espaço, com a sua marca e a sua equipe.',
  },
  {
    id: 'criar-ou-entrar', numero: 2, titulo: 'Criando ou entrando em um clube',
    descricao: 'A diretoria cria o clube em poucos minutos e recebe um link e um QR Code de inscrição. Desbravadores, pais e equipe entram por esse link, pelo convite ou escolhendo o clube no cadastro. Toda entrada fica pendente até a diretoria aprovar, e o papel de cada pessoa é definido pelo servidor.',
  },
  {
    id: 'area-do-desbravador', numero: 3, titulo: 'Área do Desbravador',
    descricao: 'Início, Jornada, Clube, Jogos e Eu: tudo o que o desbravador precisa cabe em cinco abas. Ele acompanha pontos, ranking, missão do dia e desafios da semana, e joga mesmo sem internet. Os pais acompanham pelo "Meu Filho" depois que o vínculo é confirmado.',
  },
  {
    id: 'classes', numero: 4, titulo: 'Classes e requisitos',
    descricao: 'O desbravador abre a classe, lê cada requisito e envia a comprovação por texto ou foto. A liderança avalia: aprova ou pede correção com um comentário, e cada tentativa fica no histórico. Concluída a classe, a investidura passa pelo clube, pelo distrito e pela região, e o documento sai em PDF.',
  },
  {
    id: 'especialidades', numero: 5, titulo: 'Especialidades',
    descricao: 'As especialidades seguem a mesma lógica das classes: requisito a requisito, com envio e avaliação. O clube liga o recurso quando quiser usar. O catálogo de especialidades e mestrados pode ser consultado no app.',
  },
  {
    id: 'rede-dbv', numero: 6, titulo: 'Rede DBV',
    descricao: 'A Rede DBV é o espaço social dos clubes, com publicações e stories de 24 horas. Toda foto só aparece depois que a diretoria aprova, e qualquer denúncia esconde o conteúdo na hora. É um recurso opcional: cada clube decide se liga.',
  },
  {
    id: 'gestao', numero: 7, titulo: 'Gestão do clube',
    descricao: 'Na Gestão, a diretoria aprova cadastros, convida a equipe com o cargo certo, organiza unidades e define a identidade do clube. Conselheiros fazem a chamada e os apontamentos da reunião; instrutores avaliam requisitos e montam desafios e experiências. Cada papel vê só as ferramentas que lhe cabem.',
  },
  {
    id: 'coordenacao', numero: 8, titulo: 'Coordenação e administração',
    descricao: 'Distrito, região e associação acompanham os clubes abaixo deles pelo portal, só com números agregados: nada de fotos, conversas ou dados de criança. A coordenação participa da aprovação das investiduras e registra visitas. Cada clube tem uma licença anual, com teste grátis para começar.',
    cta: { rotulo: 'Quero começar', para: '/adquirir' },
  },
])

export const CTA_FINAL = Object.freeze({ rotulo: 'Quero começar', para: '/adquirir' })

// Origem única do player: a CSP (vite-plugin-csp.js) só autoriza iframes daqui.
export const ORIGEM_DO_PLAYER = 'https://www.youtube-nocookie.com'

// Monta a URL de embed. `autoplay=1` só porque o iframe nasce DEPOIS do toque em play — nunca toca sozinho.
export function urlDoVideo(youtubeId) {
  const id = String(youtubeId || '').replace(/[^A-Za-z0-9_-]/g, '')
  return `${ORIGEM_DO_PLAYER}/embed/${id}?autoplay=1&rel=0`
}

// `#etapa-4` → índice 3; qualquer coisa fora do intervalo cai na primeira.
export function indiceDoHash(hash) {
  const m = /^#etapa-(\d+)$/.exec(String(hash || ''))
  if (!m) return 0
  const n = Number(m[1])
  return n >= 1 && n <= ETAPAS.length ? n - 1 : 0
}
