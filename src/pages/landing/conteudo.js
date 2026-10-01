// Conteúdo da landing (/). Só texto — a tela mora em src/pages/Landing.jsx.
//
// VERACIDADE: cada afirmação aqui foi classificada em LANDING-VERACIDADE.md (raiz do projeto) como
// DISPONÍVEL / EM TESTE / PLANEJADO, e só entra o que é DISPONÍVEL hoje no produto.
//   · Rede DBV existe e é liberada clube a clube → "para clubes habilitados", nunca abertura geral.
//   · Fora de propósito (em preparação ou sem produto): catálogo de Especialidades, audiolivros, Classes de
//     Liderança, pagamento online, vídeos. Os testes (Landing.test.jsx) travam essas ausências.
//   · Mensalidades = CONTROLE do que está pago/pendente + chave Pix do clube. Não há pagamento dentro do app.

// 6 áreas do aplicativo (emoji = o mesmo ícone da tela correspondente no app)
export const AREAS = Object.freeze([
  { id: 'classe', icone: '🎖️', titulo: 'Minha Classe', onde: 'Aba Jornada', texto: 'O desbravador vê a classe atual, o progresso e cada requisito, e comprova com foto ou texto.' },
  { id: 'rede', icone: '🌎', titulo: 'Rede DBV', onde: 'Clubes habilitados', texto: 'Uma comunidade entre os Clubes, com stories, conquistas e desafios, sob moderação.' },
  { id: 'gestao', icone: '⚙️', titulo: 'Gestão', onde: 'Para a liderança', texto: 'Inscrições, aprovações, membros, presença, mensalidades, avisos, documentos e avaliações.' },
  { id: 'desenvolvimento', icone: '🏆', titulo: 'Desenvolvimento', onde: 'Aba Jornada', texto: 'Missões, desafios, pontos e ranking por unidade, para manter a turma em movimento.' },
  { id: 'familia', icone: '👨‍👩‍👧', titulo: 'Família', onde: 'Meu Filho', texto: 'Depois que a diretoria confirma o vínculo, o responsável acompanha pontos, presenças e a mensalidade pendente.' },
  { id: 'coordenacao', icone: '🗺️', titulo: 'Coordenação', onde: 'Portal próprio', texto: 'Distrito e região acompanham os clubes da sua área, só com números agregados.' },
])

// Faixa "Veja como funciona": 4 telas reais, uma legenda curta sob cada uma
export const FAIXA = Object.freeze([
  { tela: 'inicio', titulo: 'Início', legenda: 'A classe em andamento, o que pede atenção e atalhos para o dia a dia.' },
  { tela: 'classe', titulo: 'Minha Classe', legenda: 'Progresso por requisito, aprovados, aguardando avaliação e correções.' },
  { tela: 'rede', titulo: 'Rede DBV', legenda: 'Meu Clube (stories, publicações e desafios) e Comunidade (o que a liderança compartilha).' },
  { tela: 'gestao', titulo: 'Gestão', legenda: 'As ferramentas da liderança, organizadas por tarefa.' },
])

// Fluxo do clube em 7 passos
export const FLUXO = Object.freeze([
  { titulo: 'Entra', texto: 'A diretoria se cadastra e cria o espaço do clube em poucos minutos.' },
  { titulo: 'Define a identidade', texto: 'Nome, sigla, lema, cores e logo do clube, que aparecem para a equipe e para os desbravadores.' },
  { titulo: 'Compartilha o link ou o QR Code', texto: 'Quem quer entrar usa o link, o QR Code ou o código de inscrição do clube.' },
  { titulo: 'Aprova os membros', texto: 'Toda entrada fica pendente até a diretoria aprovar. O cargo de cada pessoa é definido pelo sistema.' },
  { titulo: 'Organiza atividades e desenvolvimento', texto: 'Unidades, presença, pontos, avisos, agenda, desafios e missões num só lugar.' },
  { titulo: 'Acompanha as Classes', texto: 'Comprovações, avaliações e histórico de cada desbravador, com documento em PDF ao concluir.' },
  { titulo: 'Participa da Rede DBV', texto: 'Quando o clube é habilitado, a turma entra na comunidade entre os clubes.' },
])

// Classes: tudo que existe hoje no fluxo da classe
export const CLASSES_ITENS = Object.freeze([
  'Classe atual e progresso, requisito por requisito',
  'Requisitos oficiais das classes regulares e avançadas',
  'Comprovação por foto ou texto, com relato complementar em cada requisito',
  'Relatório estruturado para o que pede mais que uma marcação',
  'Avaliação pela liderança: aprova ou pede correção com comentário',
  'Histórico de todas as tentativas, sem perder nada no reenvio',
  'Classes anteriores e registro de classe já concluída',
  'Documento em PDF com assinatura e QR Code de verificação',
])
export const CLASSES_REGULARES = Object.freeze(['Amigo', 'Companheiro', 'Pesquisador', 'Pioneiro', 'Excursionista', 'Guia'])

// Rede DBV
export const REDE_ITENS = Object.freeze([
  ['Meu Clube', 'Só o seu clube vê: publicações, stories de 24 horas e desafios. É o espaço do dia a dia da turma.'],
  ['Comunidade', 'Reúne os clubes habilitados. Quem publica para todos os clubes é a liderança (diretoria e instrutor).'],
  ['Conquistas e desafios', 'O perfil mostra as conquistas, e os desafios do clube movimentam a turma.'],
  ['Interação com cuidado', 'Curtir, comentar e salvar. Não existe mensagem privada.'],
  ['Moderação', 'Triagem de texto no servidor; qualquer denúncia oculta o conteúdo na hora e avisa a diretoria.'],
])
export const REDE_NAO_E = Object.freeze([
  'Não é uma rede social aberta: só entra quem é de um clube habilitado.',
  'Criança só participa com a autorização dos responsáveis, e foto de rosto só com autorização de imagem.',
  'Sem mensagem privada e sem troca de contatos nas publicações.',
])

// Gestão (cartões no estilo da tela Gestão do app: ícone, título, subtítulo)
export const GESTAO_ITENS = Object.freeze([
  { icone: '🔗', titulo: 'Inscrições', texto: 'Link, QR Code e código para novos membros' },
  { icone: '✅', titulo: 'Aprovações', texto: 'Liberar novos cadastros e definir o cargo' },
  { icone: '👥', titulo: 'Membros e unidades', texto: 'Quem é de cada unidade, com histórico' },
  { icone: '📋', titulo: 'Presença e pontos', texto: 'Chamada, pontos da reunião e ranking' },
  { icone: '💰', titulo: 'Mensalidades', texto: 'Controle do pago e do pendente, com a chave Pix do clube' },
  { icone: '📣', titulo: 'Avisos e agenda', texto: 'Comunicados e compromissos do clube' },
  { icone: '📄', titulo: 'Documentos', texto: 'PDF dos documentos de classe, com QR Code' },
  { icone: '🔎', titulo: 'Avaliações', texto: 'Fila única, com o histórico de cada tentativa' },
])

export const SEGURANCA = Object.freeze([
  ['escudo', 'Dados das crianças protegidos', 'As fotos, evidências e dados dos seus membros não ficam públicos.'],
  ['camadas', 'Cada clube isolado', 'Os dados do seu clube não aparecem para nenhum outro.'],
  ['usuario', 'Acesso por cargo', 'Cada pessoa do seu clube vê e faz só o que o cargo dela permite.'],
  ['responsaveis', 'Responsáveis confirmados', 'O vínculo com o filho só vale depois que a diretoria confirma.'],
  ['historico', 'Histórico de ações', 'Suas aprovações, assinaturas e revogações ficam registradas.'],
  ['cadeado', 'Proteção de menores na Rede DBV', 'Participação com autorização dos responsáveis, moderação e denúncia que oculta na hora.'],
])

export const PERGUNTAS = Object.freeze([
  ['Funciona no celular?', 'Sim. O DesbravaClube foi feito primeiro para o seu celular e também funciona no computador e no tablet. Você não precisa instalar: abre pelo navegador e pode adicionar à tela inicial.'],
  ['Como funcionam as Classes?', 'Seu desbravador vê os requisitos e envia a comprovação com foto ou texto. Você avalia: aprova ou pede correção com um comentário. Cada tentativa fica no histórico.'],
  ['O que os responsáveis veem?', 'Depois que a diretoria confirma o vínculo, o responsável acompanha pontos, presenças e faltas e a mensalidade pendente, e registra o consentimento do filho.'],
  ['Como os membros entram no meu clube?', 'Você compartilha o link ou o QR Code do seu clube; quem acessa pede a entrada e você aprova.'],
  ['O que é a Rede DBV? É uma rede social aberta?', 'Não. É uma comunidade entre Clubes de Desbravadores, com moderação e proteção de menores. Está disponível para clubes habilitados e é liberada aos poucos, clube a clube.'],
  ['Existe acesso para a coordenação?', 'Sim. Coordenação distrital e regional tem um painel próprio, só com números agregados. Os dados privados de cada clube continuam sob a gestão do clube.'],
  ['Como funciona a licença?', 'É uma licença anual para o seu clube, não uma mensalidade. Você vê os valores em Planos e, por enquanto, combina o pagamento direto com a gente.'],
])

// Título e descrição da rota "/" (também usados por testes e pelo index.html estático, que repete o resumo)
export const META_LANDING = Object.freeze({
  titulo: 'DesbravaClube — plataforma para Clubes de Desbravadores',
  descricao: 'Gestão, desenvolvimento e conexão dos Clubes de Desbravadores: classes com avaliação, documentos com QR Code, gestão do clube e Rede DBV, pelo celular.',
})
