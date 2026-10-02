-- =============================================================================
--  538 — 3 jogos de perguntas do ecossistema DBV entram no catálogo de TODOS os clubes (desligados)
--
--  Quiz DBV ('quizdbv'), Verdadeiro ou Falso DBV ('vfdbv') e Qual é a Classe? ('classedbv').
--  O conteúdo vive no app (src/features/jogos/conteudo/dbv.js, conferido contra o manifesto das Classes);
--  aqui só o catálogo, para a liderança poder ligar em Gestão -> Jogos da Trilha e para o servidor aceitar a partida.
--  Nascem DESLIGADOS em todos os clubes (nenhum clube muda de comportamento até a liderança ligar). Clube novo
--  herda o catálogo do clube legado (_prov_jogos). Aditiva e idempotente (on conflict do nothing).
-- =============================================================================
do $$
declare v_ordem int;
begin
  select coalesce(max(ordem), 0) into v_ordem from public.jogos_trilha;
  perform public.catalogo_jogo_definir('quizdbv',   'Quiz DBV',                 '🧭', v_ordem + 1);
  perform public.catalogo_jogo_definir('vfdbv',     'Verdadeiro ou Falso DBV',  '⚖️', v_ordem + 2);
  perform public.catalogo_jogo_definir('classedbv', 'Qual é a Classe?',         '🎖️', v_ordem + 3);
end $$;

notify pgrst, 'reload schema';
