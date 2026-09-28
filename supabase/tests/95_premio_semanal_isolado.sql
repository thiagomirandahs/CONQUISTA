-- Prêmio do "recorde da semana" (investigação do gate 30 + migration 350). Prova, pelo comportamento:
--   * o prêmio do clube A não interfere no clube B (nem o contrário);
--   * papel em OUTRO clube não conta (instrutor no A não disputa no A, mesmo sendo desbravador no B);
--   * vínculo suspenso/encerrado no clube não é premiado, mesmo com o maior recorde;
--   * rodar de novo não duplica o prêmio;
--   * existe a trava por clube contra execução simultânea (a prova com duas sessões reais fica no
--     relatório da rodada — um teste numa transação só não consegue abrir duas sessões).
-- Os recordes são gravados direto na semana que o prêmio fecha (agora_SP - 12h), para o teste não
-- depender do dia/hora em que a suíte roda (ver o comentário da seção 5 do teste 30).
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.mk('susp_a', 'Suspenso A', 'desbravador', 'suspenso', 'clube_a', 'A1');
select t.mk('enc_a',  'Encerrado A', 'desbravador', 'ativo',   'clube_a', 'A1');
update public.organization_memberships set status = 'encerrado' where user_id = t.id('enc_a');
select t.mk('desb_b_instr_a', 'Desb B Instr A', 'desbravador', 'ativo', 'clube_b', 'B1');
select t.mk2('desb_b_instr_a', 'instrutor', 'ativo', 'clube_a', 'A1');
insert into public.config_clube (club_id, chave, valor) values
  (t.id('clube_a'), 'reflexo_so_desbravador', 'sim'), (t.id('clube_b'), 'reflexo_so_desbravador', 'sim')
on conflict (club_id, chave) do update set valor = excluded.valor;

set local session_replication_role = replica;
insert into public.recordes (usuario_id, jogo, semana, pontos, club_id)
select t.id(u), 'reflexo', (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date, pts, t.id(c)
from (values ('membro_a', 100, 'clube_a'), ('membro_a2', 90, 'clube_a'),
             ('susp_a', 500, 'clube_a'), ('enc_a', 400, 'clube_a'), ('desb_b_instr_a', 999, 'clube_a'),
             ('membro_b', 70, 'clube_b'), ('desb_b_instr_a', 50, 'clube_b')) v(u, pts, c);
set local session_replication_role = origin;
\o

create function t.premios(p_user text, p_club text) returns bigint language sql as $$
  select count(*) from public.pontos where usuario_id = t.id(p_user) and club_id = t.id(p_club) and origem = 'campeao';
$$;

-- ---------- 1) só o clube A ----------
select public._premiar_campeao_semana_clube(t.id('clube_a'));
select t.eq('[A] o melhor desbravador ATIVO do A leva o prêmio', t.premios('membro_a', 'clube_a'), 1);
select t.eq('[A] prêmio de +20', (select sum(pontos) from public.pontos where usuario_id = t.id('membro_a') and origem = 'campeao')::bigint, 20);
select t.eq('[A] o segundo lugar não leva', t.premios('membro_a2', 'clube_a'), 0);
select t.eq('[A] suspenso no clube não leva, mesmo com o maior recorde', t.premios('susp_a', 'clube_a'), 0);
select t.eq('[A] encerrado no clube não leva, mesmo com recorde maior', t.premios('enc_a', 'clube_a'), 0);
select t.eq('[A] instrutor no A não disputa no A (ser desbravador no B não conta aqui)', t.premios('desb_b_instr_a', 'clube_a'), 0);
select t.eq('[isolamento] rodar o A não deu prêmio nenhum no B',
  (select count(*) from public.pontos where club_id = t.id('clube_b') and origem = 'campeao'), 0);
select t.eq('[isolamento] o aviso do A ficou só no A',
  (select count(*) from public.notificacoes where titulo = '🏆 Recorde da semana!' and club_id = t.id('clube_b')), 0);

-- ---------- 2) não duplica ----------
select public._premiar_campeao_semana_clube(t.id('clube_a'));
select public.premiar_campeao_semana();
select t.eq('[idempotente] rodar o A de novo (e o cron geral) não paga de novo', t.premios('membro_a', 'clube_a'), 1);
select t.eq('[idempotente] nem repete o aviso',
  (select count(*) from public.notificacoes where titulo = '🏆 Recorde da semana!' and club_id = t.id('clube_a')), 1);

-- ---------- 3) o clube B, com o cron geral já rodado ----------
select t.eq('[B] o desbravador do B leva no B', t.premios('membro_b', 'clube_b'), 1);
select t.eq('[B] quem é desbravador no B mas ficou atrás não leva', t.premios('desb_b_instr_a', 'clube_b'), 0);
select t.eq('[B] o campeão do A não ganhou nada no B', t.premios('membro_a', 'clube_b'), 0);
select t.eq('[B] e o campeão do B não ganhou nada no A', t.premios('membro_b', 'clube_a'), 0);

-- ---------- 4) execução simultânea: a trava existe e é por clube ----------
select t.ok('[concorrência] o prêmio trava por clube antes de conferir "já premiei?"',
  pg_get_functiondef('public._premiar_campeao_semana_clube'::regproc) ~ 'pg_advisory_xact_lock\(hashtextextended\(''premiar_campeao_semana:'' \|\| p_club_id');
select t.eq('[concorrência] só cron/service_role executam o prêmio',
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in ('_premiar_campeao_semana_clube', 'premiar_campeao_semana')
      and grantee in ('anon', 'authenticated', 'PUBLIC')), 0);

select t.fim();
rollback;
