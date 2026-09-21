-- Prioridade 5: o push "para todos" (e "liderança", "pessoal") só alcança aparelhos
-- do CLUBE da notificação. A seleção de destinatários é uma função SQL (só o
-- service_role executa) que a Edge Function chama; aqui ela é testada de ponta a ponta,
-- junto com as notificações automáticas (aniversário, agenda) que agora nascem por clube.
begin;
\ir _lib.sql
\ir _fixtures.sql

create function t.qtd_push(p_club text, p_para text, p_pessoa text default null) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from public.push_destinatarios($1, $2, $3)' into v
    using case when p_club is null then null else t.id(p_club) end, p_para, case when p_pessoa is null then null else t.id(p_pessoa) end;
  return v;
exception when others then return -1;
end $$;
create function t.push_de(p_club text, p_para text, p_pessoa text default null) returns text
language plpgsql as $$
declare v text;
begin
  execute 'select coalesce(string_agg(replace(endpoint, ''https://push.teste/'', ''''), '','' order by endpoint), ''-'') from public.push_destinatarios($1, $2, $3)' into v
    using case when p_club is null then null else t.id(p_club) end, p_para, case when p_pessoa is null then null else t.id(p_pessoa) end;
  return v;
exception when others then return 'ERRO: ' || sqlerrm;
end $$;

-- quem pode executar a seleção de destinatários: SÓ o service_role (a Edge Function)
select t.ok('push_destinatarios existe', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'push_destinatarios'));
select t.eq('anon NÃO executa push_destinatarios', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'push_destinatarios' and has_function_privilege('anon', p.oid, 'execute')), 0);
select t.eq('authenticated NÃO executa push_destinatarios', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'push_destinatarios' and has_function_privilege('authenticated', p.oid, 'execute')), 0);
select t.eq('service_role executa push_destinatarios', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'push_destinatarios' and has_function_privilege('service_role', p.oid, 'execute')), 1);

-- ---------- destinatários por clube ----------
select t.como_service();
select t.eq('push "todos" do clube A: só membros ativos do A (sem responsável, sem clube B)', t.push_de('clube_a', 'todos'), 'instrutor_a,lider_a,membro_a');
select t.eq('push "lideranca" do clube A: só a liderança do A', t.push_de('clube_a', 'lideranca'), 'instrutor_a,lider_a');
select t.eq('push "pessoal" para membro do A com clube A', t.push_de('clube_a', 'pessoal', 'membro_a'), 'membro_a');
select t.eq('push "pessoal" para pessoa do clube B usando clube A = ninguém', t.push_de('clube_a', 'pessoal', 'membro_b'), '-');
select t.eq('push "todos" do clube B: só membros ativos do B', t.push_de('clube_b', 'todos'), 'lider_b,membro_b');
select t.eq('push "lideranca" do clube B', t.push_de('clube_b', 'lideranca'), 'lider_b');
select t.eq('push sem clube NUNCA vira broadcast', t.push_de(null, 'todos'), '-');
select t.eq('push com "para" desconhecido não envia', t.push_de('clube_a', 'qualquer'), '-');
select t.eq('push "pessoal" sem destinatário nunca vira broadcast', t.push_de('clube_a', 'pessoal', null), '-');
reset role;

-- pessoa suspensa (perfil inativo) deixa de receber push do clube
set local session_replication_role = replica;
update public.profiles set status = 'inativo' where id = t.id('membro_a');
update public.organization_memberships set status = 'suspenso' where user_id = t.id('membro_a');
set local session_replication_role = origin;
select t.como_service();
select t.eq('push "todos": membro suspenso não recebe mais', t.push_de('clube_a', 'todos'), 'instrutor_a,lider_a');
reset role;

-- ---------- o clube da notificação é sempre o de quem a criou / de quem a recebe ----------
select t.como('lider_a');
select t.permitido('líder A cria aviso geral', format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por) values ('Aviso push A', 'x', 'geral', '/', 'todos', %L)$q$, t.id('lider_a')));
select t.bloqueado('líder A não cria aviso no clube B (club_id forjado)', format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, club_id) values ('Aviso forjado', 'x', 'geral', '/', 'todos', %L, %L)$q$, t.id('lider_a'), t.id('clube_b')));
select t.bloqueado('líder A não manda aviso pessoal a quem é do clube B', format($q$insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por) values ('Pessoal forjado', 'x', 'geral', '/', 'pessoal', %L, %L)$q$, t.id('membro_b'), t.id('lider_a')));
reset role;
select t.eq('aviso do líder A nasce no clube A', (select club_id from public.notificacoes where titulo = 'Aviso push A'), t.id('clube_a'));

-- ---------- rotinas automáticas (cron, sem sessão): notificam SÓ o próprio clube ----------
-- aniversariantes de hoje nos dois clubes
update public.profiles set nascimento = (now() at time zone 'America/Sao_Paulo')::date - interval '12 years' where id in (t.id('membro_a'), t.id('membro_b'));
set local session_replication_role = replica;
update public.profiles set status = 'ativo' where id = t.id('membro_a');
update public.organization_memberships set status = 'ativo' where user_id = t.id('membro_a');
set local session_replication_role = origin;
delete from public.notificacoes where tipo = 'aniversario';
select t.como_cron();
select public.notif_aniversariantes_hoje();
reset role;
select t.eq('aniversário do membro_a avisa só o clube A', (select count(*) from public.notificacoes where tipo = 'aniversario' and corpo like '%Membro A%' and club_id = t.id('clube_a')), 1);
select t.eq('aniversário do membro_b avisa só o clube B', (select count(*) from public.notificacoes where tipo = 'aniversario' and corpo like '%Membro B%' and club_id = t.id('clube_b')), 1);
select t.eq('aniversário do clube B NÃO vaza para o clube A', (select count(*) from public.notificacoes where tipo = 'aniversario' and corpo like '%Membro B%' and club_id = t.id('clube_a')), 0);
select t.eq('aniversário do clube A NÃO vaza para o clube B', (select count(*) from public.notificacoes where tipo = 'aniversario' and corpo like '%Membro A%' and club_id = t.id('clube_b')), 0);
select t.como('lider_b');
select t.eq('líder B só lê o aniversário do próprio clube', t.nv($q$select count(*) from public.notificacoes where tipo = 'aniversario' and corpo like '%Membro A%'$q$), 0);

-- eventos de amanhã nos dois clubes
reset role;
update public.eventos set data = (now() at time zone 'America/Sao_Paulo')::date + 1 where titulo in ('Evento A', 'Evento B');
delete from public.notificacoes where titulo like '%Amanhã%';
select t.como_cron();
select public.notif_eventos_amanha();
reset role;
select t.eq('lembrete do Evento A nasce no clube A', (select count(*) from public.notificacoes where titulo like '%Evento A%' and titulo like '%Amanhã%' and club_id = t.id('clube_a')), 1);
select t.eq('lembrete do Evento B nasce no clube B', (select count(*) from public.notificacoes where titulo like '%Evento B%' and titulo like '%Amanhã%' and club_id = t.id('clube_b')), 1);
select t.eq('lembrete do Evento B NÃO aparece no clube A', (select count(*) from public.notificacoes where titulo like '%Evento B%' and titulo like '%Amanhã%' and club_id = t.id('clube_a')), 0);

-- rotinas de cron não são chamáveis por usuário
select t.ok('authenticated NÃO executa notif_aniversariantes_hoje', not has_function_privilege('authenticated', 'public.notif_aniversariantes_hoje()', 'execute'));
select t.ok('anon NÃO executa notif_eventos_amanha', not has_function_privilege('anon', 'public.notif_eventos_amanha()', 'execute'));

select t.fim();
rollback;
