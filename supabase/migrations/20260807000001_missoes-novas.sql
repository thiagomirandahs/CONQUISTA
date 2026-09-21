-- =====================================================================
--  Filhos da Conquista - Missoes NOVAS (quiz renovado) 2026-08-07
--  Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--  Desativa os quizzes antigos (ativo=false, reversivel em Gestao->Conteudo)
--  e liga 49 perguntas NOVAS, fact-checadas. As de FOTO continuam.
-- =====================================================================

-- 1) esconde os quizzes antigos (so os de texto; foto continua)
update public.desafios set ativo = false where pede_foto = false;

-- 2) liga as novas
insert into public.desafios (tema, pergunta, opcoes, correta, classe, pede_foto, ativo)
select v.tema, v.pergunta, v.opcoes::jsonb, v.correta, null, false, true
from (values
  ('Biblia', 'Qual foi o primeiro homem criado por Deus, segundo o livro de Genesis?', '["Adao","Noe","Abraao","Caim"]', 0),
  ('Biblia', 'Em quantos dias Deus criou o mundo, descansando no setimo?', '["Sete dias","Seis dias","Tres dias","Doze dias"]', 1),
  ('Biblia', 'Quem construiu uma arca para salvar sua familia e os animais do diluvio?', '["Moises","Jose","Noe","Davi"]', 2),
  ('Biblia', 'Qual patriarca Deus chamou para deixar sua terra e prometeu tornar uma grande nacao?', '["Jaco","Samuel","Elias","Abraao"]', 3),
  ('Biblia', 'Qual era o nome do filho que Abraao teve com Sara na velhice?', '["Isaque","Ismael","Esau","Levi"]', 0),
  ('Biblia', 'Jose, filho de Jaco, foi vendido pelos seus irmaos e acabou em qual pais?', '["Babilonia","Egito","Canaa","Assiria"]', 1),
  ('Biblia', 'Quem Deus usou para tirar o povo de Israel da escravidao no Egito?', '["Josue","Aarao","Moises","Gideao"]', 2),
  ('Biblia', 'Quantos mandamentos Deus entregou a Moises no monte Sinai?', '["Sete","Doze","Cinco","Dez"]', 3),
  ('Biblia', 'Qual mar se abriu para o povo de Israel atravessar fugindo do exercito do Egito?', '["Mar Vermelho","Mar da Galileia","Mar Morto","Mar Mediterraneo"]', 0),
  ('Biblia', 'Qual jovem pastor derrotou o gigante Golias com uma funda e uma pedra?', '["Saul","Davi","Jonatas","Salomao"]', 1),
  ('Biblia', 'Qual rei de Israel ficou famoso por sua grande sabedoria e construiu o templo em Jerusalem?', '["Davi","Saul","Salomao","Ezequias"]', 2),
  ('Biblia', 'Qual profeta foi engolido por um grande peixe depois de fugir de Deus?', '["Daniel","Elias","Isaias","Jonas"]', 3),
  ('Biblia', 'Qual profeta foi jogado na cova dos leoes e Deus o protegeu?', '["Daniel","Jeremias","Ezequiel","Jonas"]', 0),
  ('Biblia', 'Em qual cidade Jesus nasceu, segundo os evangelhos?', '["Nazare","Belem","Jerusalem","Cafarnaum"]', 1),
  ('Biblia', 'Qual era o nome da mae de Jesus?', '["Marta","Ana","Maria","Isabel"]', 2),
  ('Biblia', 'Quem batizou Jesus no rio Jordao?', '["Pedro","Paulo","Andre","Joao Batista"]', 3),
  ('Biblia', 'Quantos discipulos (apostolos) Jesus escolheu para segui-lo de perto?', '["Doze","Sete","Dez","Quatro"]', 0),
  ('Biblia', 'Na parabola de Jesus, o que o bom pastor deixa para procurar a ovelha perdida?', '["O rebanho de cabras","As noventa e nove ovelhas","A casa dele","O campo de trigo"]', 1),
  ('Biblia', 'Qual milagre Jesus fez para alimentar uma grande multidao com pouca comida?', '["Transformou pedras em pao","Fez chover pao do ceu","Multiplicou cinco paes e dois peixes","Encheu potes de trigo"]', 2),
  ('Biblia', 'Qual e o primeiro livro da Biblia?', '["Exodo","Salmos","Mateus","Genesis"]', 3),
  ('Clube', 'Qual e o Lema do Clube de Desbravadores?', '["O amor de Cristo me motiva","Sempre pronto para servir","Servir a Deus e a patria","Um por todos e todos por um"]', 0),
  ('Clube', 'Como comeca o Voto dos Desbravadores?', '["Prometo fazer o meu melhor todos os dias","Pela graca de Deus, serei puro, bondoso e leal","Diante de Deus e desta patrulha, prometo servir","Com a ajuda de Deus, cumprirei meu dever"]', 1),
  ('Clube', 'O que diz o Alvo dos Desbravadores?', '["Levar o evangelho ate os confins da terra","Preparar um povo para a volta de Jesus","A mensagem do advento a todo mundo em minha geracao","Anunciar as boas novas em todas as nacoes"]', 2),
  ('Clube', 'Com quantos itens (topicos) e formada a Lei do Desbravador?', '["Dez","Sete","Doze","Oito"]', 3),
  ('Clube', 'Com que idade a crianca entra na classe Amigo, a primeira classe regular dos Desbravadores?', '["10 anos","8 anos","11 anos","12 anos"]', 0),
  ('Clube', 'Qual e a classe regular do Desbravador de 12 anos?', '["Companheiro","Pesquisador","Pioneiro","Excursionista"]', 1),
  ('Clube', 'Qual e a classe regular correspondente aos 13 anos?', '["Pesquisador","Excursionista","Pioneiro","Guia"]', 2),
  ('Clube', 'Qual e a ultima das classes regulares dos Desbravadores, feita aos 15 anos?', '["Excursionista","Pioneiro","Companheiro","Guia"]', 3),
  ('Clube', 'Qual e a classe regular do Desbravador de 11 anos?', '["Companheiro","Amigo","Pesquisador","Pioneiro"]', 0),
  ('Clube', 'Na ordem unida, qual comando faz o grupo ficar imovel e em posicao firme?', '["Descansar","Sentido","Direita, volver","Meia-volta"]', 1),
  ('Clube', 'Como sao chamadas as insignias que o Desbravador conquista ao aprender um assunto especifico, como Natacao ou Nos e Amarras?', '["Medalhas","Distintivos de honra","Especialidades","Trofeus"]', 2),
  ('Clube', 'Qual peca do uniforme, usada em volta do pescoco, e um simbolo marcante do Desbravador?', '["A boina","A gravata","A faixa","O lenco"]', 3),
  ('Clube', 'Na ordem unida, qual comando serve para o grupo comecar a marchar para frente?', '["Ordinario, marche","Alto","Sentido","Cobrir a fila"]', 0),
  ('Clube', 'Qual e o nome da classe regular do Desbravador de 14 anos?', '["Pioneiro","Excursionista","Pesquisador","Guia"]', 1),
  ('Natureza', 'Numa bussola, a agulha magnetica aponta principalmente para qual direcao?', '["Sul","Leste","Norte","Oeste"]', 2),
  ('Natureza', 'Se voce ficar de frente para o nascer do Sol, o Sol esta surgindo em que direcao?', '["Oeste","Norte","Sul","Leste"]', 3),
  ('Natureza', 'Qual grupo de estrelas e muito usado para ajudar a achar o Sul no ceu do Brasil?', '["O Cruzeiro do Sul","A Ursa Maior","As Tres Marias","Orion"]', 0),
  ('Natureza', 'As plantas verdes fabricam seu proprio alimento usando luz do Sol num processo chamado:', '["Digestao","Fotossintese","Respiracao","Evaporacao"]', 1),
  ('Natureza', 'Qual desses animais e um mamifero?', '["O tubarao","A tartaruga","O golfinho","O sapo"]', 2),
  ('Seguranca', 'Numa fogueira de acampamento, qual e a atitude mais segura ao terminar?', '["Deixar as brasas acesas para reacender depois","Jogar folhas secas por cima","Cobrir com um pano e ir dormir","Apagar bem o fogo com agua ou terra ate esfriar"]', 3),
  ('Seguranca', 'Ao montar a barraca no acampamento, qual e o melhor lugar?', '["Num terreno plano e um pouco alto, longe de rios que podem transbordar","Bem no fundo de um vale, perto do rio","Embaixo de uma arvore velha com galhos secos","No meio de uma trilha muito usada"]', 0),
  ('Seguranca', 'Para nadar com seguranca, qual e a orientacao mais importante?', '["Nadar sozinho para treinar coragem","Nadar sempre acompanhado e em lugar permitido, com um adulto por perto","Ir para a parte funda mesmo sem saber nadar","Nadar longe da margem para explorar"]', 1),
  ('Seguranca', 'Para se proteger do sol forte e evitar queimaduras, o mais indicado e:', '["Ficar horas no sol do meio-dia sem protecao","Passar oleo de cozinha na pele","Usar protetor solar, bone e beber bastante agua","So se proteger quando a pele ja estiver vermelha"]', 2),
  ('Seguranca', 'Se voce se perder numa trilha, qual e a atitude mais segura?', '["Sair correndo por qualquer caminho para achar a saida","Se esconder no mato ate anoitecer","Descer por um barranco ingreme para ir mais rapido","Parar, manter a calma e esperar ajuda num lugar visivel"]', 3),
  ('Saude', 'Quando devemos lavar as maos com agua e sabao?', '["Antes de comer e depois de usar o banheiro","So quando elas estao visivelmente sujas","Apenas uma vez por dia, de manha","So depois de brincar na terra"]', 0),
  ('Saude', 'Qual desses alimentos e a opcao mais saudavel para o dia a dia?', '["Refrigerante","Frutas e verduras","Salgadinho de pacote","Bala e chiclete"]', 1),
  ('Saude', 'Qual bebida e a mais indicada para matar a sede e manter o corpo hidratado?', '["Refrigerante","Energetico","Agua","Suco artificial bem doce"]', 2),
  ('Saude', 'Quantas vezes por dia o ideal e escovar os dentes?', '["Uma vez por semana","So quando sentir dor de dente","Apenas antes de dormir, de vez em quando","Pelo menos duas a tres vezes, depois das refeicoes"]', 3),
  ('Saude', 'Por que dormir bem a noite e importante para criancas e adolescentes?', '["Porque o sono ajuda o corpo a descansar, crescer e ter energia","Porque faz a pessoa ficar mais alta na mesma noite","Porque substitui a necessidade de comer","Porque deixa a pessoa mais forte que fazer qualquer exercicio"]', 0)
) as v(tema, pergunta, opcoes, correta)
where not exists (select 1 from public.desafios d where d.pergunta = v.pergunta);

notify pgrst, 'reload schema';
