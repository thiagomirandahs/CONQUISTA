// Telas REAIS do aplicativo (capturas com dados FICTÍCIOS: "Clube Águias do Vale", Lucas, Marina).
// Tamanhos são os da imagem — vão como width/height no <img> para a página não "pular" ao carregar.
const BASE = '/landing/app'

export const TELAS = Object.freeze({
  inicio: {
    src: `${BASE}/inicio.webp`, largura: 540, altura: 1168, rotulo: 'Início',
    alt: 'Tela Início do aplicativo: saudação ao desbravador, cartão da classe Amigo com 32% de progresso, aviso de correção pedida pelo instrutor e atalhos para Rede DBV e Minha classe.',
  },
  classe: {
    src: `${BASE}/classe.webp`, largura: 540, altura: 1168, rotulo: 'Minha Classe',
    alt: 'Tela Minha Classe: classe Amigo com 8 de 25 requisitos aprovados, um aguardando correção, barra de progresso e as seções de requisitos.',
  },
  requisitos: {
    src: `${BASE}/requisitos.webp`, largura: 390, altura: 844, rotulo: 'Requisitos',
    alt: 'Lista de requisitos da classe, por seção, cada um com seu status (por exemplo, "Não iniciado") e o texto oficial do requisito.',
  },
  rede: {
    src: `${BASE}/rede.webp`, largura: 540, altura: 1168, rotulo: 'Rede DBV',
    alt: 'Tela da Rede DBV, aba Meu Clube: fileira de stories, atalho para os desafios do clube e duas publicações da coordenação do Clube Águias do Vale.',
  },
  gestao: {
    src: `${BASE}/gestao.webp`, largura: 540, altura: 1168, rotulo: 'Gestão',
    alt: 'Tela Gestão, as ferramentas da liderança: Avaliar, Documentos, Inscrições com link e QR Code, Aprovações, Apontamentos e Usuários.',
  },
})
