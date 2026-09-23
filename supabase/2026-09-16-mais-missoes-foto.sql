-- =====================================================================
--  Filhos da Conquista — Mais missões de FOTO no rodízio diário (2026-09-16)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente (só insere pergunta que ainda não existe). Nada é apagado.
--  FUNCIONA NOS DOIS BANCOS: no banco ANTIGO (sem clubes) e no banco multi-clube
--  (depois das migrations 20260921…27, em que cada clube tem o SEU conteúdo).
--
--  PROBLEMA: em 2026-08-07 (missoes-novas.sql) desativamos os quizzes de
--  texto antigos e entraram 49 perguntas novas — mas só 2 missões com foto
--  continuavam ativas no total. Como missao_do_dia() sorteia por rodízio
--  dentro de TODOS os desafios ativos, a missão de foto virou ~1 chance em
--  25 por dia: na prática, sumiu (relatado pelo dono: "aparece missão, mas
--  nunca a de foto"). Este arquivo só ACRESCENTA 10 missões de foto novas
--  (tema variado, sem quiz — igual o padrão das 2 que já existiam), pra
--  foto voltar a aparecer de vez em quando (~1 em 5-6 dias) sem dominar o
--  rodízio. Nenhuma função é alterada — as missões normais já funcionam.
-- =====================================================================

do $missoes$
declare
  v_multiclube boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'desafios' and column_name = 'club_id');
begin
  if not v_multiclube then
    -- banco ANTIGO: um clube só
    insert into public.desafios (tema, pergunta, opcoes, correta, classe, pede_foto, ativo)
    select v.tema, v.pergunta, '[]'::jsonb, 0, null, true, true
    from (values
      ('Uniforme', 'Vista seu uniforme (ou pelo menos o lenço) do Desbravador e tire uma foto bem caprichada!'),
      ('Serviço', 'A Lei do Desbravador manda ser útil. Ajude em uma tarefa lá de casa (lavar louça, arrumar a cama, varrer...) e tire uma foto fazendo isso!'),
      ('Natureza', 'Vá até um jardim, praça ou quintal e tire uma foto de um inseto, passarinho ou bichinho da natureza (sem machucar ele, viu?)!'),
      ('Devocional', 'Tire uma foto de um momento de devocional em família — pode ser lendo a Bíblia, orando ou cantando um hino juntos!'),
      ('Acampamento', 'Monte (ou desenhe) uma barraca e tire uma foto! Pode ser de brinquedo, de verdade, ou até um desenho bem caprichado.'),
      ('Natureza', 'Encontre 3 folhas de formatos diferentes e tire uma foto delas juntas!'),
      ('Clube', 'Desenhe o emblema (distintivo) do seu clube de Desbravadores e tire uma foto do desenho!'),
      ('Orientação', 'Se você tem uma bússola em casa (ou no celular), tire uma foto dela apontando pro Norte!'),
      ('Voto', 'Escreva numa folha uma frase do Voto do Desbravador que você mais gosta e tire uma foto segurando ela!'),
      ('Primeiros Socorros', 'Monte um kit de primeiros socorros simples (band-aid, gaze...) e tire uma foto dele!')
    ) as v(tema, pergunta)
    where not exists (select 1 from public.desafios d where d.pergunta = v.pergunta);
  else
    -- banco MULTI-CLUBE: o conteúdo é de cada clube — acrescenta em todos (só onde a pergunta ainda não existe)
    execute $sql$
      insert into public.desafios (club_id, tema, pergunta, opcoes, correta, classe, pede_foto, ativo)
      select c.id, v.tema, v.pergunta, '[]'::jsonb, 0, null, true, true
      from public.organizational_units c
      cross join (values
        ('Uniforme', 'Vista seu uniforme (ou pelo menos o lenço) do Desbravador e tire uma foto bem caprichada!'),
        ('Serviço', 'A Lei do Desbravador manda ser útil. Ajude em uma tarefa lá de casa (lavar louça, arrumar a cama, varrer...) e tire uma foto fazendo isso!'),
        ('Natureza', 'Vá até um jardim, praça ou quintal e tire uma foto de um inseto, passarinho ou bichinho da natureza (sem machucar ele, viu?)!'),
        ('Devocional', 'Tire uma foto de um momento de devocional em família — pode ser lendo a Bíblia, orando ou cantando um hino juntos!'),
        ('Acampamento', 'Monte (ou desenhe) uma barraca e tire uma foto! Pode ser de brinquedo, de verdade, ou até um desenho bem caprichado.'),
        ('Natureza', 'Encontre 3 folhas de formatos diferentes e tire uma foto delas juntas!'),
        ('Clube', 'Desenhe o emblema (distintivo) do seu clube de Desbravadores e tire uma foto do desenho!'),
        ('Orientação', 'Se você tem uma bússola em casa (ou no celular), tire uma foto dela apontando pro Norte!'),
        ('Voto', 'Escreva numa folha uma frase do Voto do Desbravador que você mais gosta e tire uma foto segurando ela!'),
        ('Primeiros Socorros', 'Monte um kit de primeiros socorros simples (band-aid, gaze...) e tire uma foto dele!')
      ) as v(tema, pergunta)
      where c.type = 'clube'
        and not exists (select 1 from public.desafios d where d.club_id = c.id and d.pergunta = v.pergunta)
    $sql$;
  end if;
end
$missoes$;

notify pgrst, 'reload schema';
