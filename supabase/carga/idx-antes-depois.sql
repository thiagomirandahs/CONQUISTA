\set ON_ERROR_STOP on
select md5('carga:user:1:20')::uuid as uid, md5('carga:clube:1')::uuid as clube \gset
select set_config('request.jwt.claim.sub', :'uid', false);
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);
select set_config('request.headers', json_build_object('x-clube-atual', :'clube')::text, false);
set role authenticated;
\echo '### chat (50 ultimas)'
explain (analyze, buffers, costs off, timing off) select m.id from public.chat_mensagens m join public.chat_conversas c on c.id=m.conversa_id and c.tipo='geral' and c.club_id=public.clube_atual_id() order by m.created_at desc limit 50;
\echo '### mural (30 ultimas)'
explain (analyze, buffers, costs off, timing off) select f.id from public.fotos f where f.club_id=public.clube_atual_id() order by f.created_at desc limit 30;
\echo '### notificacoes (20 ultimas)'
explain (analyze, buffers, costs off, timing off) select n.id from public.notificacoes n where n.club_id=public.clube_atual_id() order by n.created_at desc limit 20;
reset role;
