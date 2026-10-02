// Trilha do Aspirante: as lições para quem acabou de entrar no clube. Conteúdo = acervo do Guia do Aspirante
// (supabase/fontes/guia-do-aspirante-uneb-2012.md) e da página de história do site adventistas.org, em palavras próprias.
// Cada lição tem um texto curto, pontos para fixar e um mini-quiz de 3 perguntas sorteadas do banco dos jogos DBV
// (`quiz` = trechos do enunciado; o teste garante que cada trecho acha UMA pergunta).
import { HISTORIA } from '../jogos/conteudo/historia.js'
import { MANUAL } from '../jogos/conteudo/manual.js'
import { SIMBOLOS } from '../jogos/conteudo/simbolos.js'

export const BANCO = [...HISTORIA, ...MANUAL, ...SIMBOLOS]

export function acharPergunta(trecho) {
  const achadas = BANCO.filter((h) => h.q.includes(trecho))
  return achadas.length === 1 ? achadas[0] : null
}

export const LICOES = [
  {
    id: 'bem-vindo', icone: '👋', titulo: 'Bem-vindo ao clube',
    resumo: 'O Clube de Desbravadores é uma organização da Igreja Adventista do Sétimo Dia para juvenis e adolescentes, com seus líderes. Ele quer ajudar você a crescer no físico, no mental e no espiritual: aprender, se divertir, fazer amigos e amar o Criador.',
    pontos: [
      'As classes começam aos 10 anos, com Amigo, e seguem até Líder Máster Avançado, aos 20.',
      'Você faz classes e especialidades dentro da sua unidade, junto com o conselheiro.',
      'Antes da cerimônia do lenço, estude este guia: ele é o primeiro manual do aspirante.',
    ],
    quiz: ['Em que ano o Clube de Desbravadores foi oficializado', 'Como o clube se chama nos Estados Unidos', 'Dos 10 até qual idade vai o programa'],
  },
  {
    id: 'voto-lei', icone: '📜', titulo: 'O Voto e a Lei',
    resumo: 'O Voto é a promessa do desbravador: ser puro, bondoso e leal, guardar a Lei e ser servo de Deus e amigo de todos. A Lei tem 8 itens e mostra como o desbravador vive. Os dois precisam ser sabidos de cor para a cerimônia do lenço.',
    pontos: [
      'Lei: 1) observar a devoção matinal; 2) cumprir fielmente a parte que me corresponde; 3) cuidar do meu corpo; 4) manter a consciência limpa.',
      '5) ser cortês e obediente; 6) andar com reverência na casa de Deus; 7) ter sempre um cântico no coração; 8) ir onde Deus mandar.',
      'O que cada item pede: "manter a consciência limpa" é não mentir nem enganar; "cuidar de meu corpo" é ser temperante e ter bom condicionamento físico; "ter sempre um cântico no coração" é ser alegre e um raio de sol para os outros.',
      '"Pela graça de Deus" lembra que só cumprimos a vontade de Deus quando confiamos que Ele nos ajuda.',
      'Treine em voz alta com a sua unidade: repetir junto ajuda a gravar.',
    ],
    quiz: ['Quantos itens tem a Lei', 'Qual é o primeiro item da Lei', 'Qual item da Lei inclui não mentir', 'o desbravador promete ser puro, bondoso e o quê', 'Qual item da Lei fala em ser temperante', 'Qual item da Lei pede para ser alegre'],
  },
  {
    id: 'alvo-lema', icone: '🎯', titulo: 'Alvo, Lema e Objetivo',
    resumo: 'Além do Voto e da Lei, o clube tem três frases que mostram para onde ele caminha. O Alvo diz o que queremos levar ao mundo, o Lema diz o que nos move e o Objetivo diz para que o clube existe. Existe também o Voto de Fidelidade à Bíblia.',
    pontos: [
      'Alvo: a mensagem do advento a todo o mundo em minha geração.',
      'Lema: o amor de Cristo me motiva. Amamos porque Ele nos amou primeiro.',
      'Objetivo: salvar do pecado e guiar no serviço.',
      'Voto de Fidelidade à Bíblia: a Palavra de Deus é a única regra de fé e prática, e a mensagem dela é um Salvador crucificado, ressurreto e prestes a vir.',
    ],
    quiz: ['Qual é o Alvo dos Desbravadores', 'Qual é o Lema dos Desbravadores', 'Qual é o Objetivo dos Desbravadores', 'Voto de Fidelidade à Bíblia'],
  },
  {
    id: 'emblema', icone: '🔺', titulo: 'O emblema e as cores',
    resumo: 'O triângulo lembra Lucas 2:52: crescimento físico, mental e espiritual. O escudo é a fé em Jesus e a espada é a Bíblia, a Palavra de Deus escrita. Cada cor também tem um significado.',
    pontos: [
      'Azul: lealdade. Amarelo: excelência dos ideais.',
      'Branco: pureza e santidade. Vermelho: o sangue de Cristo, que nos dá redenção.',
      'O triângulo está invertido de propósito: lembra o que Jesus ensinou, que quem está mais alto deve ser o mais pronto a servir. Os três lados são a Trindade e também o crescimento físico, mental e espiritual.',
      'O escudo lembra que Deus é o nosso escudo (Gênesis 15:1) e a fé (Efésios 6:16). A espada é a Palavra de Deus, a "espada do Espírito" (Efésios 6:17).',
    ],
    quiz: ['No emblema dos Desbravadores, o que o triângulo', 'O que o triângulo invertido do emblema ensina', 'Os três lados do triângulo', 'Qual texto bíblico chama Deus de escudo', 'Em qual texto a Palavra de Deus é chamada de "espada', 'o azul simboliza'],
  },
  {
    id: 'bandeira', icone: '🚩', titulo: 'Nossa bandeira',
    resumo: 'A bandeira do clube tem 4 cores e mede 90 cm de altura por 135 cm de largura. É dividida em 4 partes, duas azuis e duas brancas, com o triângulo no centro. O nome do clube vai embaixo, à direita, em letras brancas.',
    pontos: ['O triângulo central mede 30 cm por 30 cm.', 'A bandeira oficial foi projetada em 1948 por um pastor da Associação Central da Califórnia.', 'Conhecer e explicar a bandeira é um dos requisitos do lenço.'],
    quiz: ['Quantas cores tem a bandeira', 'Quais são as medidas da bandeira', 'Onde fica escrito o nome do clube na bandeira', 'Em que ano foi projetada a bandeira'],
  },
  {
    id: 'hino', icone: '🎵', titulo: 'O Hino e o Maranata',
    resumo: 'O hino nasceu de uma ideia do Pr. Henry Bergh, em maio de 1949, durante uma viagem de carro. Foi aprovado sem mudanças pela comissão de música dos Arautos do Rei e oficializado em 1952. A saudação Maranata é feita com a mão direita levantada e o polegar curvado.',
    pontos: [
      'Os 4 dedos lembram os 4 "A": Amar, Anunciar, Apressar e Aguardar a vinda de Jesus.',
      'O polegar curvado é o desbravador ajoelhado, pronto a servir.',
      'O hino se canta em todas as reuniões e programações especiais, com todos na posição de sentido.',
      'Para o lenço, você precisa conhecer e cantar o hino.',
    ],
    quiz: ['Em que ano o hino dos Desbravadores foi oficializado', 'O que os quatro dedos levantados', 'o polegar curvado representa', 'Em que posição devem estar todos'],
  },
  {
    id: 'unidade', icone: '🏕️', titulo: 'Sua unidade e o clube',
    resumo: 'O clube se divide em unidades de no máximo 8 membros, lideradas por um conselheiro adulto (conselheira nas unidades femininas). É na unidade que você faz classes e especialidades. O clube é dirigido por um(a) diretor(a), com os diretores associados.',
    pontos: [
      'O capitão e o secretário são desbravadores escolhidos pela unidade, por um período de 3 meses a 1 ano.',
      'O diretor associado cuida das unidades masculinas e a diretora associada, das femininas.',
      'Conselheiros e instrutores ensinam as classes e especialidades.',
    ],
    quiz: ['Qual é o máximo de membros de uma unidade', 'Quem é o capitão da unidade', 'Quem tem a tarefa de ensinar as classes'],
  },
  {
    id: 'uniforme', icone: '👕', titulo: 'Uniforme e classes',
    resumo: 'Quem entra no clube tem 90 dias para conseguir o uniforme oficial. Depois vem uma avaliação simples com o conteúdo deste guia e a cerimônia do lenço. O uniforme se usa com respeito, nas cerimônias pedidas pela diretoria e só por membro ativo.',
    pontos: [
      'Quem tem mais de 15 anos usa camisa branca.',
      'Classes regulares: Amigo (10), Companheiro (11), Pesquisador (12), Pioneiro (13), Excursionista (14) e Guia (15).',
      'Depois vêm Líder (16), Líder Máster (18) e Líder Máster Avançado (20).',
      'Os emblemas são os mesmos no mundo todo, mas cada Divisão define as cores e os modelos do uniforme oficial.',
      'Nos uniformes de atividades, não se usa símbolo nem estampa militar.',
    ],
    quiz: ['Quantos dias o novo desbravador tem para obter o uniforme', 'a partir de que idade se usa camisa branca', 'Em que idade começa a classe de Líder', 'quem define as cores e os modelos do uniforme'],
  },
  {
    id: 'ordem-unida', icone: '🪖', titulo: 'Ordem unida',
    resumo: 'Ordem unida são os comandos e as formações para o clube se mover junto. Há três vozes: de advertência (chama a atenção), de comando (executa a ordem) e de execução (a mais forte, que sincroniza o movimento).',
    pontos: [
      'Coluna: um atrás do outro. Fila: lado a lado.',
      'Testa é o primeiro da coluna e cauda é o último. Cobertura é a distância entre um e outro na coluna.',
      'Saber os comandos básicos é um dos requisitos do lenço.',
    ],
    quiz: ['como se chama o primeiro desbravador de uma coluna', 'o que é uma fila', 'o que é uma coluna', 'Qual dessas é uma "voz"'],
  },
  {
    id: 'historia', icone: '🌎', titulo: 'De onde viemos',
    resumo: 'A primeira ideia do clube veio em 1922, com Arthur Spalding e Harriet Holt. Nos anos 30, um casal organizou um clube em casa, em Santa Ana (Califórnia). Em 1946 o clube nasceu na igreja de Riverside, com John H. Hancock, que desenhou o triângulo. Em 1950 o clube foi oficializado no mundo. No Brasil, os primeiros clubes surgiram em 1959, em Santa Catarina e São Paulo.',
    pontos: [
      'O Pr. Henry R. Feyrabend, vindo do Canadá, fundou 7 clubes em Santa Catarina entre 1959 e 1960.',
      'Em 1961 o Pr. Wilson Sarli levou a Ribeirão Preto o lenço, as insígnias, o voto e a lei.',
      'O I Campori da Divisão Sul-Americana foi em Foz do Iguaçu, entre 1983 e 1984.',
    ],
    quiz: ['Em que ano nasceram os primeiros clubes de Desbravadores do Brasil', 'Quem desenhou o emblema', 'Qual pastor, vindo do Canadá', 'Onde foi realizado o I Campori'],
  },
]

// Requisitos da cerimônia do lenço (os 10 do manual). Quem confere é a liderança; aqui o aspirante só acompanha o preparo.
export const REQUISITOS_LENCO = [
  'Estar matriculado no clube',
  'Saber de cor o Voto e a Lei',
  'Conhecer e explicar os símbolos dos Desbravadores',
  'Conhecer e cantar o Hino',
  'Conhecer e explicar a bandeira',
  'Conhecer e explicar a saudação',
  'Saber o uso, o significado e ter o uniforme oficial',
  'Saber executar os comandos básicos de ordem unida',
  'Conhecer o surgimento e a história do clube',
  'Estar em dias com a cota do clube',
]

export const MINIMO_PARA_CONCLUIR = 2 // acertos de 3 (ou da metade, arredondando para cima)
