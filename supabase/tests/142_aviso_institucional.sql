-- AVISO INSTITUCIONAL (migration 536): coordenação -> liderança dos clubes da SUA área; plataforma -> todos os clubes.
-- Prova: o distrital alcança só os clubes do distrito dele (A, não B) e só a LIDERANÇA; destino "todos" é recusado a ele;
-- coordenador de outro distrito só alcança o dele; diretoria de clube, membro, header de escopo forjado, anon: negados;
-- admin da plataforma alcança todos os clubes e pode mandar para todos os membros; quem não é admin não usa p_plataforma;
-- título curto/destino inválido recusados; texto sem caracteres de controle; limite diário; auditoria; um evento de push por clube;
-- nenhuma tabela nova; grants.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('c142_dist', '{"tipo":"fundador","nome":"Coord Distrital 142"}'::jsonb);
select t.signup('c142_outro', '{"tipo":"fundador","nome":"Coord Outro 142"}'::jsonb);
select t.signup('adm142', '{"tipo":"fundador","nome":"Admin 142"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm142'), 'operacao');
create function t.un142(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t142:' || p_chave), p_tipo, p_nome, null,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t142:' || p_chave));
end $$;
select t.un142('campo142', 'campo', 'Associação 142', null);
select t.un142('r142', 'regiao', 'Região 142', 'campo142');
select t.un142('d142', 'distrito', 'Distrito 142', 'r142');
select t.un142('d142b', 'distrito', 'Distrito 142 B', 'r142');
update public.organizational_units set parent_id = t.id('d142') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d142b') where id = t.id('clube_b');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c142_dist'), t.id('d142'), 'coordenador_distrital', 'ativo'),
       (t.id('c142_outro'), t.id('d142b'), 'coordenador_distrital', 'ativo');
create function t.no_escopo142(p_pessoa text, p_unid text) returns void language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_unid))::text, true);
end $$;
create function t.avisos142(p_clube text, p_titulo_like text) returns bigint language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  select count(*) into n from public.notificacoes where club_id = t.id(p_clube) and titulo like p_titulo_like;
  return n;
end $$;
grant usage on schema t to public;
grant insert, select on t.ids to public;
\o

-- ==================== alcance (sem gravar) ====================
select t.no_escopo142('c142_dist', 'd142');
select t.eq('alcance do distrital: pode e alcança 1 clube', (public.aviso_institucional_alcance(false)->>'pode') || '/' || (public.aviso_institucional_alcance(false)->>'clubes'), 'true/1');
select t.eq('alcance cita a origem (o distrito)', public.aviso_institucional_alcance(false)->>'origem', 'Distrito 142');
select t.eq('alcance da plataforma para quem não é admin: não pode', (public.aviso_institucional_alcance(true)->>'pode'), 'false');

-- ==================== o distrital envia ====================
select set_config('t142.r', public.aviso_institucional_enviar('Reunião do distrito', 'Sábado às 15h na sede.', 'lideranca', false)::text, true) is not null;
reset role;
select t.eq('envio ok para 1 clube, 0 falhas', (current_setting('t142.r')::json ->> 'clubes') || '/' || (current_setting('t142.r')::json ->> 'falhas'), '1/0');
select t.eq('o aviso chegou ao clube A (da área)', t.avisos142('clube_a', '📣 Distrito 142: Reunião do distrito%'), 1::bigint);
select t.eq('NÃO chegou ao clube B (outro distrito)', t.avisos142('clube_b', '📣%Reunião do distrito%'), 0::bigint);
select t.eq('é aviso da liderança (para=lideranca), tipo geral, com corpo',
  (select para || '/' || tipo || '/' || corpo from public.notificacoes where club_id = t.id('clube_a') and titulo like '📣 Distrito 142:%'), 'lideranca/geral/Sábado às 15h na sede.');
select t.eq('gerou UM evento de push (clube A)', (select count(*) from public.push_eventos e join public.notificacoes n on n.push_evento_id = e.id where n.titulo like '📣 Distrito 142:%'), 1::bigint);
select t.eq('auditado (quem, origem, destino, nº de clubes)',
  (select detalhe->>'origem' || '/' || (detalhe->>'destino') || '/' || (detalhe->>'clubes') from public.auditoria_operacoes where operacao = 'aviso_institucional' and ator = t.id('c142_dist') order by id desc limit 1), 'Distrito 142/lideranca/1');
select t.eq('o texto do aviso NÃO foi gravado na auditoria (só o tamanho do título)',
  (select (detalhe::text like '%Reunião%')::text from public.auditoria_operacoes where operacao = 'aviso_institucional' and ator = t.id('c142_dist') order by id desc limit 1), 'false');

-- recusas do distrital
select t.no_escopo142('c142_dist', 'd142');
select t.throws('distrital NÃO envia para "todos os membros"', $$select public.aviso_institucional_enviar('Aviso geral', null, 'todos', false)$$, 'só para a liderança');
select t.throws('título curto é recusado', $$select public.aviso_institucional_enviar('ab', null, 'lideranca', false)$$, 'título');
select t.throws('destino inválido é recusado', $$select public.aviso_institucional_enviar('Aviso válido', null, 'qualquer', false)$$, 'Destino inválido');
select t.throws('p_plataforma sem ser admin é recusado', $$select public.aviso_institucional_enviar('Aviso válido', null, 'lideranca', true)$$, 'Sem permissão');
select set_config('t142.c', public.aviso_institucional_enviar(E'Linha\x01 com\x02 controle', E'corpo\x03 ok', 'lideranca', false)::text, true) is not null;
reset role;
select t.eq('caracteres de controle saem do texto', (select titulo || '|' || corpo from public.notificacoes where club_id = t.id('clube_a') and titulo like '📣 Distrito 142: Linha%'), '📣 Distrito 142: Linha com controle|corpo ok');

-- ==================== outro distrito: só o dele ====================
select t.no_escopo142('c142_outro', 'd142b');
select t.eq('o outro distrital alcança só o clube B', public.aviso_institucional_alcance(false)->>'clubes', '1');
select set_config('t142.o', public.aviso_institucional_enviar('Aviso do outro distrito', null, 'lideranca', false)::text, true) is not null;
reset role;
select t.eq('chegou ao B', t.avisos142('clube_b', '📣 Distrito 142 B: Aviso do outro distrito%'), 1::bigint);
select t.eq('NÃO chegou ao A', t.avisos142('clube_a', '📣%Aviso do outro distrito%'), 0::bigint);

-- ==================== quem NÃO pode ====================
select t.como('lider_a');
select t.throws('diretoria de clube NÃO envia aviso institucional', $$select public.aviso_institucional_enviar('Aviso válido', null, 'lideranca', false)$$, 'Sem permissão');
select t.eq('diretoria de clube: alcance negado', public.aviso_institucional_alcance(false)->>'pode', 'false');
select t.como('membro_a');
select t.throws('membro comum NÃO envia', $$select public.aviso_institucional_enviar('Aviso válido', null, 'lideranca', false)$$, 'Sem permissão');
-- header de escopo forjado: um vínculo inexistente nesse escopo é ignorado
select t.como('lider_a');
select set_config('request.headers', json_build_object('x-escopo-atual', t.id('d142'))::text, true);
select t.throws('escopo forjado (sem vínculo ativo naquela unidade) NÃO dá acesso', $$select public.aviso_institucional_enviar('Aviso válido', null, 'lideranca', false)$$, 'Sem permissão');
select t.como_anon();
select t.throws('anon não executa', $$select public.aviso_institucional_enviar('Aviso válido', null, 'lideranca', false)$$, 'permission denied');
select t.throws('anon não executa o alcance', $$select public.aviso_institucional_alcance(false)$$, 'permission denied');
reset role;

-- ==================== plataforma ====================
select t.como('adm142');
select set_config('t142.al', public.aviso_institucional_alcance(true)::text, true) is not null;
reset role;
select t.ok('alcance da plataforma = todos os clubes ativos (e pode)', (current_setting('t142.al')::json->>'clubes')::int = (select count(*) from public.organizational_units where type = 'clube' and status = 'ativo') and (current_setting('t142.al')::json->>'pode')::boolean);
select t.como('adm142');
select set_config('t142.p', public.aviso_institucional_enviar('Manutenção geral', 'Hoje à noite.', 'todos', true)::text, true) is not null;
reset role;
select t.ok('plataforma: enviou para todos os clubes ativos, 0 falhas',
  (current_setting('t142.p')::json ->> 'clubes')::int = (select count(*) from public.organizational_units where type = 'clube' and status = 'ativo') and (current_setting('t142.p')::json ->> 'falhas')::int = 0);
select t.eq('plataforma: chegou ao clube A para TODOS os membros', (select para from public.notificacoes where club_id = t.id('clube_a') and titulo = '📣 DesbravaClube: Manutenção geral'), 'todos');
select t.eq('plataforma: chegou ao clube B', t.avisos142('clube_b', '📣 DesbravaClube: Manutenção geral'), 1::bigint);
select t.eq('plataforma: auditado como plataforma', (select (detalhe->>'plataforma') from public.auditoria_operacoes where operacao = 'aviso_institucional' and ator = t.id('adm142') order by id desc limit 1), 'true');

-- ==================== limite diário (5 por pessoa; o distrital já enviou 2 + 1 recusado conta zero) ====================
select t.no_escopo142('c142_dist', 'd142');
select public.aviso_institucional_enviar('Aviso de limite 3', null, 'lideranca', false);
select public.aviso_institucional_enviar('Aviso de limite 4', null, 'lideranca', false);
select public.aviso_institucional_enviar('Aviso de limite 5', null, 'lideranca', false);
select set_config('t142.l', public.aviso_institucional_enviar('Aviso de limite 6', null, 'lideranca', false)::text, true) is not null;
reset role;
select t.eq('o 6º envio do dia é barrado (ok=false, motivo=limite)', (current_setting('t142.l')::json ->> 'ok') || '/' || (current_setting('t142.l')::json ->> 'motivo'), 'false/limite');
select t.eq('o barrado não criou aviso', t.avisos142('clube_a', '📣 Distrito 142: Aviso de limite 6%'), 0::bigint);

-- ==================== estrutura ====================
select t.ok('nenhuma tabela nova de aviso (só funções)', not exists (select 1 from pg_tables where schemaname = 'public' and tablename ~ 'aviso_instituc|avisos_instituc'));
select t.ok('funções: security definer, search_path fixo, anon sem execute',
  (select bool_and(prosecdef and coalesce(proconfig::text, '') like '%search_path%' and not has_function_privilege('anon', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute'))
     from pg_proc where pronamespace = 'public'::regnamespace and proname in ('aviso_institucional_enviar', 'aviso_institucional_alcance')));
select t.eq('as duas funções existem sem sobrecarga', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('aviso_institucional_enviar', 'aviso_institucional_alcance')), 2::bigint);
select t.fim();
rollback;
