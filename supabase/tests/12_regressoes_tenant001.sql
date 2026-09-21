-- Regressões que a revisão de compatibilidade com a PRODUÇÃO (Tenant 001) apontou:
--   (1) "Excluir usuário" quebrava para quem já teve mensalidade (a FK vira NULL e o gatilho do clube reclamava);
--   (2) a foto do mural de outro clube migrava para o Tenant 001 quando o autor era excluído;
--   (3) "nova temporada" ficou mais permissiva que no legado (instrutor zerava o ranking);
--   (4) ranking / total de pontos / chat ficaram dezenas de vezes mais lentos (função chamada por LINHA).
-- Os limites de tempo são folgados de propósito (CI lento não pode dar falso vermelho), mas ficam
-- muito abaixo do que a versão com o problema levava.
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- (1) excluir usuário com histórico financeiro e fotos ----------
select t.como('lider_a');
select t.permitido('diretoria A exclui membro que tem mensalidade e foto (as FKs viram NULL)',
  format('select public.excluir_usuario(%L)', t.id('membro_a')));
reset role;
select t.eq('a mensalidade do excluído ficou preservada (caixa), sem dono e no MESMO clube',
  (select count(*) from public.mensalidades where desbravador_id is null and valor = 50 and club_id = t.id('clube_a')), 1);
select t.eq('a foto do excluído continua no clube A',
  (select count(*) from public.fotos where legenda = 'Foto A' and autor_id is null and club_id = t.id('clube_a')), 1);

select t.como('lider_b');
select t.permitido('diretoria B exclui membro B (tem mensalidade e foto)',
  format('select public.excluir_usuario(%L)', t.id('membro_b')));
reset role;
select t.eq('a foto do excluído do clube B NÃO migra para o Tenant 001',
  (select count(*) from public.fotos where legenda = 'Foto B' and club_id = t.id('clube_b')), 1);
select t.eq('...nem a mensalidade dele',
  (select count(*) from public.mensalidades where desbravador_id is null and valor = 60 and club_id = t.id('clube_b')), 1);
select t.eq('...e nada do clube B apareceu no clube A',
  (select count(*) from public.fotos where legenda = 'Foto B' and club_id = t.id('clube_a')), 0);

-- ---------- (4) desempenho: nada de função pesada chamada por linha ----------
select t.id('membro_a2') as uid, t.id('clube_a') as clube \gset
select t.id('A2') as unid \gset
set local session_replication_role = replica;
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id, data)
select :'uid'::uuid, 'manual', 1, 'carga de desempenho', :'clube'::uuid, now() - make_interval(mins => g)
from generate_series(1, 40000) g;
insert into public.chat_conversas (tipo) select 'geral' where not exists (select 1 from public.chat_conversas where tipo = 'geral');
insert into public.chat_mensagens (conversa_id, autor_id, texto)
select (select id from public.chat_conversas where tipo = 'geral'), :'uid'::uuid, 'mensagem ' || g from generate_series(1, 5000) g;
set local session_replication_role = origin;
analyze public.pontos;
analyze public.chat_mensagens;

select t.como('membro_a2');
select clock_timestamp() as t0 \gset
select (public.ranking_totais() is not null) as ok_r \gset
select clock_timestamp() as t1 \gset
select public.meu_total_pontos() as total_meu \gset
select clock_timestamp() as t2 \gset
select count(*) as pts_visiveis from public.pontos \gset
select clock_timestamp() as t3 \gset
select count(*) as msgs_visiveis from public.chat_mensagens \gset
select clock_timestamp() as t4 \gset
select public.ranking_semana() is not null as ok_s \gset
select clock_timestamp() as t5 \gset
reset role;

select round(extract(epoch from (:'t1'::timestamptz - :'t0'::timestamptz))::numeric, 3) as s_ranking,
       round(extract(epoch from (:'t2'::timestamptz - :'t1'::timestamptz))::numeric, 3) as s_meu_total,
       round(extract(epoch from (:'t3'::timestamptz - :'t2'::timestamptz))::numeric, 3) as s_pontos_rls,
       round(extract(epoch from (:'t4'::timestamptz - :'t3'::timestamptz))::numeric, 3) as s_chat_rls,
       round(extract(epoch from (:'t5'::timestamptz - :'t4'::timestamptz))::numeric, 3) as s_semana \gset
\echo    [tempos] ranking_totais= :s_ranking s; meu_total_pontos= :s_meu_total s; select_pontos_RLS= :s_pontos_rls s; select_chat_RLS= :s_chat_rls s; ranking_semana= :s_semana s

select t.ok('ranking_totais() com 40 mil pontos responde em < 1 s (era ~4 s: temporada_inicio() por linha)', :s_ranking < 1.0);
select t.ok('meu_total_pontos() com 40 mil pontos responde em < 1 s', :s_meu_total < 1.0);
select t.ok('ranking_semana() com 40 mil pontos responde em < 1 s', :s_semana < 1.0);
select t.ok('ler pontos com RLS (40 mil linhas) em < 4 s', :s_pontos_rls < 4.0);
select t.ok('ler o chat com RLS (5 mil mensagens) em < 0,5 s (era ~0,8 s; cresce linear com o histórico)', :s_chat_rls < 0.5);
select t.eq('o total de pontos do membro continua certo (40 mil linhas + os do fixture)', :total_meu::bigint, 40000);
select t.ok('o membro enxerga os pontos do clube pelo RLS (>= as 40 mil linhas)', :pts_visiveis::bigint >= 40000);
select t.eq('o membro enxerga as 5 mil mensagens do chat geral', :msgs_visiveis::bigint, 5000);

-- ---------- (3) nova temporada: só a diretoria (como no legado) ----------
select t.como('instrutor_a');
select t.bloqueado('instrutor NÃO abre nova temporada (zerar o ranking é da diretoria)', $q$select public.nova_temporada('x', 'y')$q$);
select t.como('tesoureiro_a');
select t.bloqueado('tesoureiro NÃO abre nova temporada', $q$select public.nova_temporada('x', 'y')$q$);
select t.como('lider_a');
select t.permitido('diretoria abre nova temporada do próprio clube', $q$select public.nova_temporada('a', 'b')$q$);
reset role;

select t.fim();
rollback;
