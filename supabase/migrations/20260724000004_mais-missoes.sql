-- =====================================================================
--  Filhos da Conquista — Pacotão de missões (2026-07-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente: só insere missão cuja PERGUNTA ainda não existe (pode
--  re-rodar sem duplicar). Nada é apagado.
--
--  31 missões novas pro rodízio diário (todas "gerais" = valem pra todas as
--  classes): 23 de quiz (Bíblia, Clube, segurança, habilidades) + 8 de FOTO
--  (vão pra aprovação da liderança, como sempre).
--
--  Depois dá pra editar/desativar qualquer uma em Gestão -> Conteúdo -> Desafios.
--  Quiz: acertou = 10 pts, errou = 5. Foto: 10 pts após aprovação.
-- =====================================================================

insert into public.desafios (tema, pergunta, opcoes, correta, classe, pede_foto, ativo)
select v.tema, v.pergunta, v.opcoes::jsonb, v.correta, null, v.pede_foto, true
from (values
  -- ---------- BÍBLIA (quiz) ----------
  ('Bíblia', 'Qual é o primeiro livro da Bíblia?',
    '["Êxodo","Gênesis","Salmos","Mateus"]', 1, false),
  ('Bíblia', 'Qual é o último livro da Bíblia?',
    '["Apocalipse","Judas","Malaquias","João"]', 0, false),
  ('Bíblia', 'Quantos livros tem a Bíblia?',
    '["27","39","70","66"]', 3, false),
  ('Bíblia', 'Quem construiu a arca?',
    '["Moisés","Abraão","Noé","Davi"]', 2, false),
  ('Bíblia', 'Quem venceu o gigante Golias?',
    '["Sansão","Davi","Saul","Josué"]', 1, false),
  ('Bíblia', 'Quem foi jogado na cova dos leões?',
    '["Daniel","José","Elias","Pedro"]', 0, false),
  ('Bíblia', 'Em que cidade Jesus nasceu?',
    '["Nazaré","Jerusalém","Belém","Jericó"]', 2, false),
  ('Bíblia', 'Quantos discípulos Jesus escolheu?',
    '["7","10","12","70"]', 2, false),
  ('Bíblia', 'Qual foi o primeiro milagre de Jesus?',
    '["Andar sobre a água","Transformar água em vinho","Multiplicar os pães","Curar um cego"]', 1, false),
  ('Bíblia', 'Que mar se abriu para o povo de Israel atravessar?',
    '["Mar Morto","Mar da Galileia","Mar Vermelho","Mar Mediterrâneo"]', 2, false),
  ('Bíblia', 'Quem foi engolido por um grande peixe?',
    '["Jonas","Pedro","Paulo","Elias"]', 0, false),
  ('Bíblia', 'Qual livro da Bíblia é cheio de cânticos e louvores?',
    '["Provérbios","Salmos","Isaías","Atos"]', 1, false),
  ('Bíblia', 'Quem era conhecido por sua força enorme?',
    '["Gideão","Sansão","Josué","Calebe"]', 1, false),
  ('Bíblia', 'Quem recebeu os Dez Mandamentos no monte Sinai?',
    '["Arão","Josué","Moisés","Abraão"]', 2, false),
  ('Bíblia', 'Quantos dias e noites choveu no dilúvio?',
    '["7","30","40","100"]', 2, false),

  -- ---------- CLUBE (quiz) ----------
  ('Clube', 'Como começa o Voto do Desbravador?',
    '["Pela graça de Deus...","Prometo ser fiel...","Eu juro...","Por minha honra..."]', 0, false),
  ('Clube', 'Complete a Lei do Desbravador: "Cuidar do meu..."',
    '["uniforme","corpo","clube","lenço"]', 1, false),
  ('Clube', 'O que a Lei do Desbravador manda observar logo cedo?',
    '["A devoção matinal","O café da manhã","O uniforme","A ordem unida"]', 0, false),

  -- ---------- SEGURANÇA E HABILIDADES (quiz) ----------
  ('Habilidades', 'Para onde aponta a agulha da bússola?',
    '["Sul","Leste","Oeste","Norte"]', 3, false),
  ('Segurança', 'O que fazer primeiro numa queimadura pequena?',
    '["Passar pasta de dente","Colocar em água fria e limpa","Estourar a bolha","Colocar gelo direto na pele"]', 1, false),
  ('Habilidades', 'Qual nó serve para unir duas cordas da mesma grossura?',
    '["Nó direito","Nó cego","Laço","Nó de gravata"]', 0, false),
  ('Segurança', 'Antes de atravessar a rua, devemos olhar...',
    '["Só para um lado","Para os dois lados","Para cima","Para o celular"]', 1, false),
  ('Segurança', 'Numa tempestade com raios, o mais seguro é...',
    '["Ficar debaixo de uma árvore alta","Procurar um abrigo fechado","Segurar objetos de metal","Continuar nadando no rio"]', 1, false)
) as v(tema, pergunta, opcoes, correta, pede_foto)
where not exists (select 1 from public.desafios d where d.pergunta = v.pergunta);

-- ---------- MISSÕES DE FOTO (vão pra aprovação da liderança) ----------
insert into public.desafios (tema, pergunta, opcoes, correta, classe, pede_foto, ativo)
select v.tema, v.pergunta, '[]'::jsonb, 0, null, true, true
from (values
  ('Devoção',       '📖 Leia um versículo da Bíblia com alguém da sua família e envie uma foto desse momento.'),
  ('Serviço',       '🤝 Ajude em uma tarefa de casa hoje (louça, quarto, lixo...) e envie uma foto ajudando.'),
  ('Clube',         '👕 Deixe seu uniforme (ou a mochila do clube) arrumadinho e envie uma foto.'),
  ('Natureza',      '🌱 Cuide de uma planta ou de um animal hoje e envie uma foto.'),
  ('Habilidades',   '🪢 Treine um nó que você aprendeu no clube e envie a foto do nó pronto.'),
  ('Criatividade',  '🎨 Faça um desenho de uma história da Bíblia que você gosta e envie a foto.'),
  ('Vida saudável', '💧 Beba bastante água hoje! Envie uma foto da sua garrafinha ou copo.'),
  ('Bondade',       '✉️ Escreva um bilhete carinhoso pra alguém (pais, avós, um amigo) e envie a foto do bilhete.')
) as v(tema, pergunta)
where not exists (select 1 from public.desafios d where d.pergunta = v.pergunta);

notify pgrst, 'reload schema';
