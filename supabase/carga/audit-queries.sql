-- =====================================================================
-- Fase 8 — QUERY AUDIT das operações críticas, com o dataset sintético carregado.
-- Roda como um usuário REAL (role authenticated + jwt), para que a RLS entre na conta.
-- Cada bloco imprime o tempo e o plano resumido.
-- =====================================================================
\set ON_ERROR_STOP on
\timing off

-- quem somos: um desbravador do clube de carga 1
select md5('carga:user:1:20')::uuid as uid, md5('carga:clube:1')::uuid as clube \gset

\echo '================= CONTEXTO: quem sou eu (toda abertura do app) ================='
select set_config('request.jwt.claim.sub', :'uid', false);
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);
select set_config('request.headers', json_build_object('x-clube-atual', :'clube')::text, false);
set role authenticated;

explain (analyze, buffers, costs off, timing off, summary on) select public.meu_contexto();

\echo '================= HOME: meu_inicio() ================='
explain (analyze, buffers, costs off, timing off, summary on) select public.meu_inicio();

\echo '================= RANKING individual (top 50) ================='
explain (analyze, buffers, costs off, timing off, summary on)
select p.id, p.nome, coalesce(sum(pt.pontos), 0) total
from public.profiles p
join public.organization_memberships m on m.user_id = p.id and m.organizational_unit_id = public.clube_atual_id() and m.status='ativo'
left join public.pontos pt on pt.usuario_id = p.id and pt.club_id = public.clube_atual_id()
group by p.id, p.nome order by total desc limit 50;

\echo '================= CHAT: ultimas 50 mensagens da conversa geral ================='
explain (analyze, buffers, costs off, timing off, summary on)
select m.id, m.texto, m.created_at from public.chat_mensagens m
join public.chat_conversas c on c.id = m.conversa_id and c.tipo='geral' and c.club_id = public.clube_atual_id()
order by m.created_at desc limit 50;

\echo '================= MURAL: ultimas 30 fotos ================='
explain (analyze, buffers, costs off, timing off, summary on)
select f.id, f.url, f.created_at from public.fotos f
where f.club_id = public.clube_atual_id() order by f.created_at desc limit 30;

\echo '================= EXPERIENCIAS do clube ================='
explain (analyze, buffers, costs off, timing off, summary on) select public.experiencias_do_clube(false);

reset role;
\echo '================= LIDERANCA: fila de avaliacao ================='
select md5('carga:user:1:1')::uuid as lider \gset
select set_config('request.jwt.claim.sub', :'lider', false);
select set_config('request.jwt.claims', json_build_object('sub', :'lider', 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off, timing off, summary on) select public.avaliacoes_pendentes();

\echo '================= LIDERANCA: minha_classe de um membro (avaliar) ================='
explain (analyze, buffers, costs off, timing off, summary on)
select count(*) from public.member_requirements where club_id = public.clube_atual_id() and status='aguardando_avaliacao';

reset role;
