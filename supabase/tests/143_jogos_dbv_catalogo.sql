-- Jogos DBV (migration 538): entram no catálogo de todos os clubes DESLIGADOS; liderança liga só no próprio clube;
-- o jogo é aceito pelo servidor (registrar_jogo) depois de ligado; idempotente; clube novo herda o catálogo.
begin;
\ir _lib.sql
\ir _fixtures.sql

select t.eq('os 3 jogos DBV existem no catálogo do clube A', (select count(*) from public.jogos_trilha where club_id = t.id('clube_a') and chave in ('quizdbv', 'vfdbv', 'classedbv')), 3::bigint);
select t.eq('...e no do clube B', (select count(*) from public.jogos_trilha where club_id = t.id('clube_b') and chave in ('quizdbv', 'vfdbv', 'classedbv')), 3::bigint);
select t.eq('nascem DESLIGADOS em todos os clubes', (select count(*) from public.jogos_trilha where chave in ('quizdbv', 'vfdbv', 'classedbv') and ativo), 0::bigint);
select t.eq('um catálogo por clube: nenhuma duplicata', (select count(*) from (select club_id, chave from public.jogos_trilha group by 1, 2 having count(*) > 1) d), 0::bigint);
select t.ok('ordem depois dos jogos antigos', (select min(ordem) from public.jogos_trilha where chave = 'quizdbv') > (select max(ordem) from public.jogos_trilha where chave in ('memoria', 'socorro')));

-- rodar de novo não duplica
select public.catalogo_jogo_definir('quizdbv', 'Quiz DBV', '🧭', 99);
select t.eq('repetir não duplica nem religa', (select count(*) from public.jogos_trilha where club_id = t.id('clube_a') and chave = 'quizdbv' and not ativo), 1::bigint);

-- liderança liga só o do próprio clube; membro não liga
select t.como('lider_a');
select t.permitido('líder A liga o Quiz DBV', $q$update public.jogos_trilha set ativo = true where chave = 'quizdbv'$q$);
select t.como('membro_a');
select t.bloqueado('membro NÃO liga jogo DBV', $q$update public.jogos_trilha set ativo = true where chave = 'vfdbv'$q$);
reset role;
select t.eq('o Quiz DBV do clube B continua desligado', (select ativo from public.jogos_trilha where club_id = t.id('clube_b') and chave = 'quizdbv'), false);

-- jogar: o servidor aceita o jogo ligado, 1x por dia
select t.como('membro_a');
select t.eq('membro A joga o Quiz DBV: 3 estrelas = 30 pontos', t.txt($q$select public.registrar_jogo('quizdbv', 3)->>'pontos'$q$), '30');
select t.throws('o mesmo jogo só uma vez ao dia', $q$select public.registrar_jogo('quizdbv', 3)$q$, 'já jogou');
reset role;
select t.fim();
rollback;
