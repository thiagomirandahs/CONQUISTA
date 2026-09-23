-- PROVA DE CONCEITO (não aplicada): o custo do chat é a função de RLS avaliada LINHA A LINHA.
-- `chat_pode_ver(conversa_id)` é STABLE, então o planejador a chama uma vez por linha candidata.
-- Aqui mede-se o MESMO resultado com um predicado que o índice consegue usar, para saber quanto
-- da conta é a função e quanto é leitura de dado.
select md5('carga:user:1:20')::uuid as uid, md5('carga:clube:1')::uuid as clube \gset
select set_config('request.jwt.claim.sub', :'uid', false);
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);
select set_config('request.headers', json_build_object('x-clube-atual', :'clube')::text, false);

\echo '### A) hoje: como a RLS avalia (funcao por linha) — rodando como o DONO para isolar o custo'
explain (analyze, buffers, costs off, timing off)
select m.id from public.chat_mensagens m
where public.chat_pode_ver(m.conversa_id)
  and m.conversa_id = (select id from public.chat_conversas where club_id = :'clube' and tipo='geral')
order by m.created_at desc limit 50;

\echo '### B) hipotese: mesmo resultado, filtrando primeiro pelo club_id que JA existe na linha'
explain (analyze, buffers, costs off, timing off)
select m.id from public.chat_mensagens m
where m.club_id = :'clube'
  and m.conversa_id = (select id from public.chat_conversas where club_id = :'clube' and tipo='geral')
order by m.created_at desc limit 50;

\echo '### C) B + indice (conversa_id, created_at desc)'
create index if not exists idx_poc_chat on public.chat_mensagens (conversa_id, created_at desc);
analyze public.chat_mensagens;
explain (analyze, buffers, costs off, timing off)
select m.id from public.chat_mensagens m
where m.club_id = :'clube'
  and m.conversa_id = (select id from public.chat_conversas where club_id = :'clube' and tipo='geral')
order by m.created_at desc limit 50;
drop index public.idx_poc_chat;
