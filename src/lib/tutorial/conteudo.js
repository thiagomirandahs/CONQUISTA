// Conteúdo do tutorial (/ajuda no app e no site). Módulo de DADOS, sem React: dá para reusar em outra tela,
// no site e nos testes. Tudo aqui descreve o app como ele funciona HOJE (lido das telas reais). Mudou uma
// tela? Atualize o tópico dela.
//
// Campos de um tópico:
//   id          âncora (/ajuda#id) — os botões "?" das telas apontam para cá
//   papel       seção (chave de PAPEIS_DO_TUTORIAL)
//   rota        tela real do app (atalho "Abrir essa tela" — só aparece se o papel abre essa rota)
//   recurso     recurso do clube de que o tópico depende (desligado no clube = o tópico some no app)
//   soNoApp     não aparece no site público (ex.: recurso que ainda está fora do piloto)
//   palavras    sinônimos para a busca

export const PAPEIS_DO_TUTORIAL = [
  { chave: 'desbravador', titulo: 'Desbravador', icone: '🧒', resumo: 'Sua classe, missões, jogos, ranking e o cantinho da sua unidade.' },
  { chave: 'responsavel', titulo: 'Responsável (pais)', icone: '👨‍👩‍👧', resumo: 'Acompanhar o seu filho e pedir o vínculo com ele.' },
  { chave: 'conselheiro', titulo: 'Conselheiro', icone: '🧭', resumo: 'Chamada, pontos da reunião e o cantinho da unidade.' },
  { chave: 'instrutor', titulo: 'Instrutor / Capelão', icone: '🎖️', resumo: 'Avaliar classes, investidura, documentos, desafios, missões e experiências.' },
  { chave: 'diretoria', titulo: 'Diretoria', icone: '🏕️', resumo: 'Criar e configurar o clube, receber inscrições, montar a equipe e cuidar do plano.' },
  { chave: 'coordenacao', titulo: 'Coordenação', icone: '🏛️', resumo: 'Portal do distrito/região e visitas aos clubes.' },
  { chave: 'geral', titulo: 'Para todos', icone: '🛟', resumo: 'Atualizar o app, internet, fotos e privacidade.' },
]

export const TOPICOS = [
  // ============================================================ DESBRAVADOR
  {
    id: 'navegacao', papel: 'desbravador', icone: '🧭', titulo: 'Onde fica cada coisa (Início, Jornada, Clube, Jogos, Eu)',
    paraQueServe: 'A barra de baixo leva você às partes do app. O que aparece depende do seu papel no clube.',
    rota: '/inicio',
    passos: [
      'Início: mostra “Para você agora” — o que precisa de você hoje. Se estiver tudo certo, aparece “Você está em dia!”.',
      'Jornada: Minha Classe, Experiências, Atividades, Missões e Bíblia (só o que o seu clube usa).',
      'Clube: Ranking, Minha unidade (o cantinho), Unidades, Mural, Agenda e Chat.',
      'Jogos: Trilha de jogos, Desafios, Chefão, Bichinho e Leilão. Para a liderança, no lugar de Jogos aparece Gestão.',
      'Eu: seu perfil, trocar de clube, “Atualizar o app”, “Ajuda / Como usar” e “Sair da conta”.',
    ],
    dicas: ['Se algum item não aparece, é porque o seu clube não usa esse recurso.'],
    palavras: ['menu', 'barra', 'abas', 'inicio', 'tour'],
  },
  {
    id: 'minha-classe', papel: 'desbravador', icone: '🎖️', titulo: 'Minha Classe: começar e enviar requisitos',
    paraQueServe: 'Acompanhar a sua classe requisito por requisito e mandar a comprovação para a liderança avaliar.',
    rota: '/minha-classe', recurso: 'classes',
    passos: [
      'Abra Jornada → Minha Classe.',
      'Se ainda não tem classe, escolha uma na lista e toque em “Iniciar”. Cada classe mostra a cor e “A partir de N anos”.',
      'Toque num requisito. Se ele pede texto, escreva em “Sua resposta” o que você fez ou aprendeu.',
      'Se ele pede foto, toque em “Adicionar foto” para tirar uma foto ou escolher da galeria.',
      'Toque em “Salvar rascunho” para terminar depois, ou em “Enviar para avaliação” quando estiver pronto.',
      'Acompanhe o selo: ⏳ Aguardando avaliação, ✅ Aprovado ou ↺ Correção solicitada.',
    ],
    dicas: [
      'Correção pedida? Leia o comentário em “Ver histórico”, arrume e envie de novo.',
      'Quando todos os requisitos forem aprovados, a liderança faz a revisão final e você fica apto(a) para a investidura.',
      'Depois disso aparece o botão “📘 Ver / imprimir meu caderno de acompanhamento”.',
    ],
    problemas: [
      { quando: 'A classe está com cadeado 🔒', solucao: 'Ela ainda não é para você: normalmente é a idade ou falta um pré-requisito. O motivo aparece ao lado do cadeado. Se a sua data de nascimento estiver errada, corrija em Eu → Meu perfil.' },
      { quando: '“Escreva sua resposta antes de enviar para avaliação.”', solucao: 'Esse requisito pede texto. Escreva a resposta e envie de novo.' },
      { quando: '“Escolha uma foto de comprovação antes de enviar para avaliação.”', solucao: 'Esse requisito pede foto. Adicione a foto e envie de novo.' },
      { quando: 'O botão “Enviar para avaliação” está com cadeado', solucao: 'Tem alguma coisa antes que precisa ser feita. A lista com o motivo aparece logo abaixo.' },
    ],
    palavras: ['requisito', 'comprovacao', 'foto', 'texto', 'cadeado', 'bloqueado', 'avaliacao', 'correcao'],
  },
  {
    id: 'varias-classes', papel: 'desbravador', icone: '🗂️', titulo: 'Várias classes em abas e classes avançadas',
    paraQueServe: 'Fazer mais de uma classe ao mesmo tempo, cada uma na sua aba.',
    rota: '/minha-classe', recurso: 'classes',
    passos: [
      'Em Minha Classe, as suas classes aparecem em abas no topo, com a porcentagem feita (ou “🏅 Investido”).',
      'Toque numa aba para abrir aquela classe.',
      'Para começar outra, toque em “+ Iniciar outra classe” e depois em “Iniciar” na classe escolhida.',
      'As classes avançadas têm o selo “★ Avançada” e a mesma cor da classe regular.',
    ],
    palavras: ['abas', 'avancada', 'outra classe', 'duas classes'],
  },
  {
    id: 'cancelar-classe', papel: 'desbravador', icone: '↩️', titulo: 'Cancelar uma classe',
    paraQueServe: 'Parar uma classe que você começou por engano ou não quer fazer agora.',
    rota: '/minha-classe', recurso: 'classes',
    passos: [
      'Abra a classe em Minha Classe.',
      'No fim da tela, toque em “Cancelar esta classe”.',
      'Confira a pergunta “Cancelar a classe …?” e toque em “Sim, cancelar” (ou “Voltar” para desistir).',
    ],
    dicas: ['Nada é apagado: o progresso fica no histórico. Se iniciar a classe de novo, você continua de onde parou.'],
    problemas: [{ quando: 'Não aparece “Cancelar esta classe”', solucao: 'Só dá para cancelar classe em andamento. Classe concluída ou investida não é cancelada.' }],
    palavras: ['desistir', 'cancelar', 'parar'],
  },
  {
    id: 'missoes', papel: 'desbravador', icone: '🎯', titulo: 'Missão do dia',
    paraQueServe: 'Uma missão por dia (devocional ou desafio) que vale pontos e faz a sua sequência 🔥 crescer.',
    rota: '/missoes', recurso: 'missoes',
    passos: [
      'Abra Jornada → Missões.',
      'No devocional, responda a pergunta. No desafio, pode ser pedida uma foto.',
      'Toque em “Concluir missão 🎉”.',
      'Se teve foto, a missão fica aguardando a liderança aprovar para valer os pontos.',
    ],
    problemas: [
      { quando: '“Responda a pergunta.” ou “Anexe a foto pedida na missão.”', solucao: 'Falta completar a missão antes de concluir.' },
      { quando: '“Missão de hoje não foi aprovada.”', solucao: 'A liderança não aprovou a foto. Amanhã tem missão nova.' },
    ],
    palavras: ['devocional', 'sequencia', 'foguinho', 'pontos'],
  },
  {
    id: 'jogos', papel: 'desbravador', icone: '🎮', titulo: 'Jogos, recordes e jogar sem internet',
    paraQueServe: 'Jogar na Trilha de jogos e ganhar pontos para você e para a sua unidade.',
    rota: '/trilha', recurso: 'jogos',
    passos: [
      'Abra Jogos → Trilha de jogos.',
      'Cada jogo vale 1 vez por dia; cada ⭐ vale 10 pontos.',
      'No “🎲 Jogo da semana”, quem fizer mais estrelas até domingo ganha +20.',
      'Nos jogos sem fim (como Reflexo e Corrida) vale o recorde da semana: o maior ganha +20 no domingo.',
    ],
    dicas: ['Se o clube liga o rodízio, cada dia abrem 3 jogos — jogue os de hoje e ganhe o bônus.'],
    problemas: [
      { quando: '“Sem internet agora — seu resultado ficou guardado…”', solucao: 'Tudo bem! O resultado é enviado sozinho quando a internet voltar ou quando você abrir o app de novo (vale por até 7 dias; recorde só na mesma semana e estrelas só no mesmo dia).' },
      { quando: '“Este jogo não abriu neste aparelho”', solucao: 'Atualize o app (Eu → Atualizar o app). Se continuar, tente outro jogo.' },
    ],
    palavras: ['recorde', 'estrelas', 'offline', 'fila', 'trilha', 'jogo'],
  },
  {
    id: 'desafios', papel: 'desbravador', icone: '🏁', titulo: 'Desafios da semana e duelos',
    paraQueServe: 'Encher a sua cartela da semana e ajudar a sua unidade na corrida.',
    rota: '/desafios', recurso: 'desafios',
    passos: [
      'Abra Jogos → Desafios.',
      'Na aba “🏁 Semana”, veja “Sua cartela”: missão, jogo, devocional e atividade da semana.',
      'Complete as metas até aparecer “Cartela cheia! 🎉”.',
      'Na “🏁 Corrida das unidades” você vê como a sua unidade está.',
    ],
    dicas: ['A semana zera toda segunda-feira.'],
    palavras: ['cartela', 'duelo', 'corrida', 'semana'],
  },
  {
    id: 'ranking', papel: 'desbravador', icone: '🏆', titulo: 'Ranking',
    paraQueServe: 'Ver quem está mandando bem: as unidades e cada desbravador.',
    rota: '/ranking',
    passos: [
      'Abra Clube → Ranking.',
      'Escolha a aba “🛡️ Unidades” ou “🧒 Individual”.',
      'Toque numa unidade para ver “Como a média é feita”.',
    ],
    dicas: ['A média da unidade é justa: conta todo mundo da unidade, então unidade grande e pequena competem igual.'],
    palavras: ['pontos', 'podio', 'media', 'unidade'],
  },
  {
    id: 'perfil', papel: 'desbravador', icone: '🪪', titulo: 'Meu perfil, foto e data de nascimento',
    paraQueServe: 'Trocar a foto e conferir a data de nascimento — é ela que define a idade que libera as classes.',
    rota: '/perfil',
    passos: [
      'Abra Eu → Meu perfil.',
      'Para trocar a foto, toque em “📷 Trocar foto”.',
      'Em “🎂 Data de nascimento”, toque em “Corrigir”, escolha a nova data e toque em “Continuar”.',
      'Confira “Trocar de … para …?” e toque em “Confirmar”.',
    ],
    problemas: [
      { quando: '“A data de nascimento não pode ser no futuro.” / “confira o ano”', solucao: 'Confira o dia, o mês e principalmente o ano.' },
      { quando: 'Uma classe aparece com cadeado de idade', solucao: 'Veja se a data de nascimento está certa. Se estiver, é só esperar a idade da classe.' },
    ],
    palavras: ['nascimento', 'idade', 'foto', 'avatar', 'aniversario'],
  },
  {
    id: 'cantinho', papel: 'desbravador', icone: '🏡', titulo: 'Cantinho da unidade',
    paraQueServe: 'O espaço só da sua unidade: meditação da semana, mural de oração, presença, ajuda em casa, reuniões e caixa.',
    rota: '/cantinho', recurso: 'cantinho_unidade',
    passos: [
      'Abra Clube → Minha unidade.',
      'Meditação da semana: a mensagem que o(a) conselheiro(a) escreveu. No domingo começa uma nova.',
      'Pedidos de oração e agradecimentos: escolha “🙏 Pedido” ou “💛 Agradecimento”, escreva (até 280 letras) e envie. Se quiser, marque “Só o(a) conselheiro(a) pode ler”.',
      'Minha presença: veja as suas faltas e se foi ao culto.',
      'Ajudar os pais: escreva “Como você ajudou em casa esta semana?” e toque em “Registrar minha ajuda” (1 vez por semana). Os pontos entram quando o(a) conselheiro(a) confirmar.',
      'Reuniões: as próximas reuniões da unidade e os eventos do clube.',
      'Caixa: as anotações de entrada e saída da unidade (só anotação, nenhum pagamento passa por aqui).',
    ],
    dicas: ['O mural de oração recomeça todo domingo. Só a unidade vê.'],
    problemas: [
      { quando: '“Você ainda não está numa unidade”', solucao: 'Peça à diretoria para colocar você numa unidade.' },
      { quando: '“Este cantinho é só da unidade”', solucao: 'Cada unidade só vê o próprio cantinho (a diretoria e o conselheiro também veem).' },
    ],
    palavras: ['unidade', 'oracao', 'agradecimento', 'meditacao', 'domingo', 'caixa', 'reuniao', 'ajudar os pais', 'presenca', 'falta'],
  },
  {
    id: 'minhas-especialidades', papel: 'desbravador', icone: '🏅', titulo: 'Especialidades',
    paraQueServe: 'Acompanhar as suas especialidades, quando o clube usa esse recurso.',
    rota: '/minhas-especialidades', recurso: 'especialidades', soNoApp: true,
    passos: ['Abra Jornada → Especialidades.', 'Envie cada requisito como na Minha Classe e acompanhe a avaliação.'],
    palavras: ['especialidade'],
  },

  // ============================================================ RESPONSÁVEL
  {
    id: 'meu-filho', papel: 'responsavel', icone: '👨‍👩‍👧', titulo: 'Meu Filho: acompanhar',
    paraQueServe: 'Ver os pontos, presenças e faltas do seu filho e se há mensalidade pendente.',
    rota: '/meu-filho',
    passos: [
      'Ao entrar, o app já abre em “Meus filhos”.',
      'Cada filho tem um cartão com pontos, presenças e faltas.',
      'Se houver mensalidade pendente, aparece a chave PIX do clube — toque para copiar.',
      'Se aparecer “Consentimento … ainda não registrado”, toque em “Conceder consentimento” para registrar o seu consentimento como responsável. Dá para “Revogar” depois.',
    ],
    palavras: ['filho', 'pais', 'responsavel', 'pix', 'mensalidade', 'consentimento'],
  },
  {
    id: 'vinculo-responsavel', papel: 'responsavel', icone: '🔗', titulo: 'Pedir o vínculo com o seu filho',
    paraQueServe: 'Ligar a sua conta à do seu filho para acompanhar tudo pelo app.',
    rota: '/meu-filho',
    passos: [
      'Em “Meus filhos”, digite o nome do seu filho(a) e toque em “Pedir”.',
      'Aparece “Pedido enviado! A diretoria vai confirmar.”',
      'Quando a diretoria confirmar, o cartão do seu filho aparece.',
    ],
    dicas: ['A diretoria também pode mandar um link de convite para responsáveis (vale 14 dias e só uma vez).'],
    problemas: [{ quando: 'O pedido está “aguardando a diretoria” há muito tempo', solucao: 'Fale com a diretoria do clube: só ela confirma o vínculo.' }],
    palavras: ['vinculo', 'ligar conta', 'convite'],
  },

  // ============================================================ CONSELHEIRO
  {
    id: 'apontamentos', papel: 'conselheiro', icone: '✏️', titulo: 'Chamada e apontamentos da reunião',
    paraQueServe: 'Fazer a chamada e lançar os pontos da reunião de cada desbravador da sua unidade.',
    rota: '/apontamentos',
    passos: [
      'Abra Gestão → Apontamentos (ou “Fazer chamada” no cantinho).',
      'Confira a “Data da reunião”.',
      '“⚡ Chamada rápida”: toque em cada pessoa para alternar ✅ Presente / ❌ Faltou e toque em “💾 Salvar chamada”.',
      '“📝 Detalhado”: marque Na hora, Atrasado ou Faltou e os extras (📖 Bíblia, 👕 Uniforme, ⛪ Igreja, ⭐ Atividade). Toque em “💾 Salvar apontamentos”.',
    ],
    dicas: ['Os pontos entram no ranking na hora. Quem faltou não recebe os extras.'],
    problemas: [{ quando: '“Você ainda não tem uma unidade definida.”', solucao: 'Peça à diretoria para ligar você à sua unidade (Usuários → cargo na unidade).' }],
    palavras: ['chamada', 'presenca', 'falta', 'pontos', 'reuniao'],
  },
  {
    id: 'cantinho-conselheiro', papel: 'conselheiro', icone: '🏡', titulo: 'Cuidar do cantinho da unidade',
    paraQueServe: 'Manter o espaço da unidade vivo durante a semana.',
    rota: '/cantinho', recurso: 'cantinho_unidade',
    passos: [
      'Meditação: toque em “Escrever” (ou “Editar”), preencha a mensagem ou versículo e a referência. Vale a semana toda.',
      'Mural de oração: você pode “Esconder”, “Mostrar” ou “Apagar” mensagens. Ele zera todo domingo.',
      'Presentes e faltosos: veja quem mais faltou e toque em “Justificar” numa falta para escrever o motivo (deixar vazio tira a justificativa).',
      'Ajudar os pais: toque em “Confirmar” na ajuda registrada pelo desbravador; “Desfazer” tira os pontos.',
      'Reuniões: “+ Nova” com data, hora, local e pauta; “Tirar” remove.',
      'Caixa: “+ Lançar” uma entrada ou saída (só anotação).',
      'Planejamento: “+ Meta” com status e prazo — só você e a diretoria veem.',
    ],
    dicas: ['O total de faltas mostra só as faltas sem justificativa.'],
    palavras: ['justificar', 'falta justificada', 'meditacao', 'caixa', 'planejamento', 'meta', 'oracao'],
  },

  // ============================================================ INSTRUTOR / CAPELÃO
  {
    id: 'fila-avaliacao', papel: 'instrutor', icone: '🔎', titulo: 'Fila de avaliação (Gestão → Avaliar)',
    paraQueServe: 'Ver num lugar só tudo o que espera a sua avaliação: requisitos de classe, experiências, entregas, missões e revisão final.',
    rota: '/gestao/avaliar',
    passos: ['Abra Gestão → Avaliar.', 'Toque no grupo que quer avaliar.'],
    dicas: ['O capelão usa o mesmo acesso do instrutor.'],
    palavras: ['avaliar', 'fila', 'pendente'],
  },
  {
    id: 'avaliar-classes', papel: 'instrutor', icone: '🎖️', titulo: 'Avaliar requisitos de classe',
    paraQueServe: 'Aprovar ou pedir correção do que o desbravador enviou.',
    rota: '/avaliar-classe', recurso: 'classes',
    passos: [
      'Abra Gestão → Avaliar classes.',
      'Veja a resposta ou a foto de cada requisito.',
      'Toque em “✅ Aprovar”, ou escreva “O que precisa corrigir?” e toque em “Pedir correção”.',
    ],
    problemas: [{ quando: '“🔒 Aprovar” desativado', solucao: 'Tem uma pendência antes (a lista “Não dá pra aprovar ainda” explica).' }],
    palavras: ['aprovar', 'correcao', 'requisito'],
  },
  {
    id: 'investidura', papel: 'instrutor', icone: '🏅', titulo: 'Revisão final e investidura',
    paraQueServe: 'Conferir a classe concluída e registrar a investidura.',
    rota: '/investiduras', recurso: 'classes',
    passos: [
      'Abra Gestão → Revisão final e investidura.',
      'Abra “📘 Ver caderno de acompanhamento” para conferir.',
      'Toque em “✅ Aprovar revisão final”, ou em “↺ Pedir correção” (marque os requisitos e escreva a observação).',
      'Com o desbravador apto, preencha a data e toque em “🏅 Registrar investidura”.',
    ],
    palavras: ['investir', 'caderno', 'conclusao'],
  },
  {
    id: 'documentos', papel: 'instrutor', icone: '📄', titulo: 'Documentos de classe (PDF e assinatura)',
    paraQueServe: 'Gerar, revisar e assinar os documentos de classe emitidos.',
    rota: '/gestao/documentos', recurso: 'classes',
    passos: [
      'Abra Gestão → Documentos.',
      'Use “Gerar PDF”, “Ver/baixar” e “Revisar”.',
      'Toque em “Assinar” num documento, ou marque vários e toque em “Assinar selecionados” (com a declaração).',
    ],
    dicas: ['A assinatura é eletrônica interna do app. Quem recebe o documento pode conferir a autenticidade pelo link de verificação.'],
    palavras: ['pdf', 'assinar', 'certificado', 'documento'],
  },
  {
    id: 'avaliar-especialidades', papel: 'instrutor', icone: '🏅', titulo: 'Avaliar especialidades',
    paraQueServe: 'Criar turmas e avaliar os requisitos enviados, quando o clube usa esse recurso.',
    rota: '/avaliar-especialidades', recurso: 'especialidades', soNoApp: true,
    passos: ['Abra Gestão → Especialidades.', 'Crie a turma em “Criar turma”.', 'Na fila, toque em “✅ Aprovar” ou “Pedir correção”.'],
    palavras: ['especialidade', 'turma'],
  },
  {
    id: 'premiar-desafios', papel: 'instrutor', icone: '🏆', titulo: 'Premiar o time da semana (Desafios)',
    paraQueServe: 'Dar um bônus de pontos para a unidade que liderou a corrida da semana.',
    rota: '/desafios', recurso: 'desafios',
    passos: ['Abra Desafios.', 'Toque em “🏆 Premiar o time da semana”.', 'Escolha os pontos (1 a 200) e toque em “Premiar +N”.'],
    palavras: ['bonus', 'premio', 'corrida'],
  },
  {
    id: 'aprovar-missoes', papel: 'instrutor', icone: '🎯', titulo: 'Aprovar fotos das missões',
    paraQueServe: 'Validar as missões com foto para os pontos valerem.',
    rota: '/aprovar-missoes', recurso: 'missoes',
    passos: ['Abra Gestão → Aprovar missões.', 'Veja a foto e toque em “✅ Aprovar (+10)” ou “Reprovar”.'],
    palavras: ['missao', 'foto'],
  },
  {
    id: 'experiencias', papel: 'instrutor', icone: '✨', titulo: 'Montar experiências (desafios e campanhas)',
    paraQueServe: 'Criar desafios, campanhas e temporadas para o clube, sem programar.',
    rota: '/experiencias/novo', recurso: 'experiencias',
    passos: [
      'Abra Gestão → Montar experiências (ou “Criar” em Experiências).',
      'Comece “De um modelo” (botão “Copiar”) ou “Do zero”.',
      'Preencha título, tipo, quem conclui (cada pessoa ou a unidade), datas e recompensa. Toque em “Criar rascunho”.',
      'Adicione as etapas (o que a pessoa entrega, pontos, se a liderança valida) em “Adicionar etapa”.',
      'Escolha o público (todo o clube, uma unidade ou um papel) e toque em “Salvar público”.',
      'Toque em “Publicar”.',
    ],
    dicas: ['Depois de publicada, a estrutura da experiência não muda mais — revise antes.'],
    palavras: ['campanha', 'temporada', 'etapa', 'criar desafio'],
  },

  // ============================================================ DIRETORIA
  {
    id: 'criar-clube', papel: 'diretoria', icone: '🏕️', titulo: 'Criar o clube (primeiro acesso)',
    paraQueServe: 'Abrir o seu clube no DesbravaClube, passo a passo.',
    rota: '/criar-clube',
    passos: [
      'Crie a sua conta e entre.',
      'Preencha os dados básicos e o clube: nome, plano (começa em período de teste) e ciclo. Toque em “Criar o clube”.',
      'Escolha a identidade: sigla, lema e cor.',
      'Em “Primeiro diretor”, toque em “Sou eu”.',
      'Configure o PIX e, se quiser, a região ou distrito.',
      'Os recursos do plano já nascem ligados. Convide a equipe por e-mail.',
      'Toque em “Concluir”.',
    ],
    dicas: ['Se parar no meio, dá para voltar depois e continuar de onde parou.', 'Tem um código de cortesia? Use “🎁 Tenho um código de cortesia”.'],
    palavras: ['onboarding', 'novo clube', 'comecar', 'cadastro do clube'],
  },
  {
    id: 'inscricoes', papel: 'diretoria', icone: '🔗', titulo: 'Inscrições por link e QR Code',
    paraQueServe: 'Deixar novos membros pedirem a entrada no clube pelo celular.',
    rota: '/gestao/inscricoes',
    passos: [
      'Abra Gestão → Inscrições.',
      'Escolha o prazo e toque em “Gerar código”.',
      'Compartilhe o QR Code, o link (“Compartilhar link” / “Copiar link”) ou o código.',
      'Quem usar o link pede a entrada e aparece em “Solicitações pendentes” para você aprovar.',
    ],
    dicas: ['O código aparece por inteiro só uma vez. Perdeu? “Gerar outro” revoga o atual.', 'O código não dá cargo de liderança a ninguém: todo pedido passa pela sua aprovação.'],
    palavras: ['qr', 'link', 'codigo', 'convite', 'novo membro', 'entrar'],
  },
  {
    id: 'aprovacoes', papel: 'diretoria', icone: '✅', titulo: 'Aprovar novos cadastros',
    paraQueServe: 'Liberar quem pediu para entrar no clube.',
    rota: '/aprovacoes',
    passos: ['Abra Gestão → Aprovações.', 'Confira o pedido (cargos de liderança aparecem com ⭐).', 'Toque em “Aprovar” ou “Recusar”.'],
    palavras: ['aprovar', 'cadastro', 'pedido'],
  },
  {
    id: 'usuarios-equipe', papel: 'diretoria', icone: '👥', titulo: 'Usuários: convidar a equipe e cargos',
    paraQueServe: 'Montar a equipe da liderança, mudar papel e unidade, resetar senha.',
    rota: '/usuarios',
    passos: [
      'Abra Gestão → Usuários.',
      'Em “🤝 Convidar para a equipe”, digite o e-mail de quem já tem conta, escolha o cargo e toque em “Convidar” (o convite vale 14 dias).',
      'Cargos: Diretor(a), Associado(a) e Secretário(a) = diretoria; Tesoureiro(a) = tesouraria; Instrutor(a) e Capelão/Capelã = instrutor; Conselheiro(a) = conselheiro.',
      'Em cada pessoa, troque papel, unidade e o cargo na unidade (Conselheiro, Capitão, Secretário, Tesoureiro, Capelão e outros — cada cargo é de uma pessoa por unidade).',
      'Use 🔑 Senha para quem não consegue entrar e 🎂 Nascimento para corrigir a idade.',
    ],
    problemas: [{ quando: 'A pessoa convidada não vê o convite', solucao: 'Ela precisa ter conta com aquele e-mail. O convite aparece em Eu, no app dela.' }],
    palavras: ['equipe', 'cargo', 'senha', 'convidar', 'conselheiro', 'capelao', 'tesoureiro', 'unidade'],
  },
  {
    id: 'vinculos-pais', papel: 'diretoria', icone: '👨‍👩‍👧', titulo: 'Vínculos dos pais',
    paraQueServe: 'Confirmar quem é responsável por qual desbravador e cadastrar o PIX do clube.',
    rota: '/vinculos-pais',
    passos: [
      'Abra Gestão → Vínculos dos pais.',
      'Em “Pedidos aguardando”, escolha o desbravador certo e toque em “Confirmar vínculo” (ou “Rejeitar”).',
      'Para convidar, toque em “Gerar link” e mande ao responsável (vale 14 dias, uma vez só).',
    ],
    palavras: ['pais', 'responsavel', 'pix', 'vinculo'],
  },
  {
    id: 'unidades', papel: 'diretoria', icone: '🏠', titulo: 'Unidades',
    paraQueServe: 'Criar as unidades e cuidar da identidade delas.',
    rota: '/unidades',
    passos: ['Abra Clube → Unidades.', 'Toque em “+ Nova” e dê o nome.', 'Use “🚩 Identidade” (lema, grito, bandeira) e “📷 Emblema”.', 'Os cargos da unidade são definidos em Usuários.'],
    palavras: ['unidade', 'emblema', 'grito'],
  },
  {
    id: 'clube-config', papel: 'diretoria', icone: '🎨', titulo: 'Identidade, logo e recursos do clube',
    paraQueServe: 'Nome, cores e logo do clube, e escolher o que o clube usa.',
    rota: '/clube',
    passos: [
      'Abra Eu → Configurações do clube (ou Gestão → Identidade e recursos).',
      'Ajuste nome, sigla, lema e cores e toque em “Salvar identidade”.',
      'Toque em “Enviar logo” para colocar a logo (até 5 MB).',
      'Em Recursos, ligue ou desligue cada parte do app para o clube.',
    ],
    problemas: [
      { quando: 'O recurso não liga', solucao: 'Ele pode não estar no plano do clube ou ainda não ter sido liberado pela plataforma. Veja em Plano do clube.' },
      { quando: 'Aparece “Fora do plano deste clube”', solucao: 'O recurso não está incluído no plano. Quem responde pela conta pode ampliar o plano.' },
    ],
    palavras: ['logo', 'cores', 'identidade', 'recurso', 'desligado', 'plano'],
  },
  {
    id: 'vitrine', papel: 'diretoria', icone: '🪧', titulo: 'Cartão do clube na vitrine do site',
    paraQueServe: 'Mostrar o clube na lista pública de clubes, com dia, horário, local e contato.',
    rota: '/clube',
    passos: [
      'Em Configurações do clube, marque “Aparecer na vitrine do site”.',
      'Preencha apresentação, cidade, dia, horário e local.',
      'Escolha pelo menos um contato para publicar (nome, WhatsApp ou e-mail).',
      'Toque em “Pré-visualizar o cartão” e depois em “Salvar cartão”.',
    ],
    palavras: ['vitrine', 'site', 'divulgar', 'cartao'],
  },
  {
    id: 'plano', papel: 'diretoria', icone: '💳', titulo: 'Plano do clube',
    paraQueServe: 'Ver o que está incluído no plano e quanto já está sendo usado.',
    rota: '/planos',
    passos: ['Abra Gestão → Plano do clube.', 'Confira a situação, o uso e o que cada plano inclui.'],
    dicas: ['Se a assinatura ficar suspensa, nada do clube é apagado.'],
    palavras: ['assinatura', 'licenca', 'pagamento', 'cortesia'],
  },
  {
    id: 'visitas-clube', papel: 'diretoria', icone: '📅', titulo: 'Visitas da coordenação',
    paraQueServe: 'Confirmar ou remarcar as visitas que o distrito ou a região marcou.',
    rota: '/visitas',
    passos: ['Abra Gestão → Visitas da coordenação.', 'Toque em “Confirmar” ou em “Sugerir outra data” (data, hora e observação) e “Enviar”.'],
    palavras: ['visita', 'distrito', 'regiao'],
  },
  {
    id: 'gestao', papel: 'diretoria', icone: '⚙️', titulo: 'A tela de Gestão',
    paraQueServe: 'Todas as ferramentas da liderança, em 4 grupos: Avaliar, Pessoas, Clube e Conteúdo.',
    rota: '/gestao',
    passos: ['Toque em Gestão na barra de baixo.', 'As ferramentas mais usadas aparecem primeiro; as outras ficam em “Ver todas”.'],
    dicas: ['Cada papel vê só as ferramentas que pode usar.', 'A tesouraria cuida das Mensalidades por aqui.'],
    palavras: ['ferramentas', 'lideranca', 'mensalidades', 'avisos', 'radar'],
  },

  // ============================================================ COORDENAÇÃO
  {
    id: 'convite-coordenacao', papel: 'coordenacao', icone: '✉️', titulo: 'Aceitar o convite da coordenação',
    paraQueServe: 'Entrar no portal do seu distrito ou região.',
    rota: null,
    passos: ['Abra o link de convite que você recebeu.', 'Entre (ou crie a conta) e toque em “Aceitar convite”.', 'Se o convite pedir, escolha o distrito ou a região — aí o acesso espera a confirmação da administração.'],
    palavras: ['convite', 'distrito', 'regiao'],
  },
  {
    id: 'portal', papel: 'coordenacao', icone: '🏛️', titulo: 'Portal e painel do distrito/região',
    paraQueServe: 'Acompanhar os clubes do seu escopo e agendar visitas.',
    rota: '/institucional',
    passos: [
      'Abra Eu → Portal institucional.',
      'Escolha o “Escopo em uso”.',
      'No painel, veja clubes, membros ativos, classes em andamento e concluídas, investidos e avaliações pendentes.',
      'Abra um clube e toque em “Agendar visita” (data, hora, objetivo). A diretoria do clube é avisada.',
    ],
    dicas: ['O painel não mostra conversas, fotos, mensalidades nem as comprovações das crianças.'],
    palavras: ['portal', 'painel', 'visita', 'distrito', 'regiao', 'coordenador'],
  },

  // ============================================================ PARA TODOS
  {
    id: 'atualizar-app', papel: 'geral', icone: '🔄', titulo: 'Atualizar o app',
    paraQueServe: 'Pegar a versão mais nova quando algo parece antigo ou diferente.',
    rota: '/eu',
    passos: ['Abra Eu.', 'Toque em “Atualizar o app”.'],
    problemas: [
      { quando: 'Voltou a versão antiga / uma tela nova não aparece', solucao: 'Toque em Eu → Atualizar o app. O app também se atualiza sozinho depois de uma versão nova.' },
      { quando: 'Apareceu “Precisamos atualizar o app”', solucao: 'Toque em “Atualizar agora”. É rapidinho.' },
    ],
    palavras: ['versao', 'atualizar', 'antigo', 'tela branca', 'erro'],
  },
  {
    id: 'fotos', papel: 'geral', icone: '📷', titulo: 'Fotos que não sobem',
    paraQueServe: 'Resolver problemas ao enviar foto (classe, missão, perfil).',
    passos: ['Confira a internet.', 'Tire a foto de novo em qualidade normal.', 'Tente enviar de novo.'],
    problemas: [
      { quando: '“Essa foto é muito pesada (máx. 15 MB)”', solucao: 'Tire a foto de novo em qualidade normal (sem modo “alta resolução”).' },
      { quando: '“Esse arquivo não é uma foto válida”', solucao: 'Aceitamos JPG, PNG, WebP, GIF e HEIC. PDF e outros arquivos não entram.' },
      { quando: '“Não foi possível enviar”', solucao: 'Normalmente é a internet. Espere o sinal melhorar e tente de novo.' },
    ],
    palavras: ['foto', 'imagem', 'upload', 'pesada', 'internet'],
  },
  {
    id: 'trocar-clube', papel: 'geral', icone: '🔀', titulo: 'Participar de mais de um clube',
    paraQueServe: 'Usar a mesma conta em clubes diferentes.',
    rota: '/eu',
    passos: ['Aceite o convite do outro clube em Eu.', 'Em “Trocar de clube”, escolha o clube em uso.'],
    dicas: ['Seu papel pode ser diferente em cada clube — o app mostra as telas do papel no clube em uso.'],
    palavras: ['clube', 'trocar', 'dois clubes'],
  },
  {
    id: 'privacidade', papel: 'geral', icone: '🔒', titulo: 'Segurança e privacidade',
    paraQueServe: 'Entender como os dados do clube são protegidos.',
    passos: [
      'Cada pessoa vê só o que o papel dela permite, no clube em uso.',
      'O cantinho é só da unidade; o que é marcado “Só o(a) conselheiro(a) pode ler” fica só com ele(a).',
      'Não compartilhe a sua senha. Esqueceu? Use “Esqueci minha senha” no login ou peça à diretoria.',
      'Ao usar um celular emprestado, toque em Eu → “Sair da conta” no final.',
    ],
    palavras: ['senha', 'privacidade', 'seguranca', 'dados', 'sair'],
  },
]
