-- Regressão do gate 29 (migration 340): o papel de um PEDIDO de entrada é decidido no servidor e
-- nunca vem de profiles.papel (espelho do clube primário). Prova, pelo comportamento:
--   * papel em OUTRO clube não é herdado (nem 'pais', nem 'diretoria');
--   * o cliente não escolhe papel e não se autopromove;
--   * o pedido nasce PENDENTE, sem unidade, sem acesso a filho;
--   * conta aberta como responsável continua pedindo como 'pais' (comportamento preservado);
--   * mexer no metadata do Auth depois do cadastro não muda nada;
--   * tipo_cadastro não é gravável pelo usuário.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('resp_novo',   jsonb_build_object('nome', 'Resp Novo', 'tipo', 'pais'));
select t.signup('membro_novo', jsonb_build_object('nome', 'Membro Novo', 'nascimento', '2014-01-01'));
insert into public.organizational_units (nome, slug, type, timezone)
values ('Clube C da Entrada', 'entrada-c', 'clube', 'America/Recife');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'entrada-c';
select t.mk('lider_c', 'Lider C', 'diretoria', 'ativo', 'clube_c');
select t.como('lider_c'); select t.pedir_clube('clube_c');
select t.txt($q$select public.clube_codigo_gerar() ->> 'codigo'$q$) as cod_c \gset
reset role;
\o

-- ---------- 1) o cadastro grava o tipo da conta, uma vez ----------
select t.eq('[cadastro] conta aberta como responsável = tipo_cadastro pais',
  (select tipo_cadastro from public.profiles where id = t.id('resp_novo')), 'pais');
select t.eq('[cadastro] conta comum = tipo_cadastro membro',
  (select tipo_cadastro from public.profiles where id = t.id('membro_novo')), 'membro');

-- ---------- 2) papel de outro clube NÃO é herdado ----------
-- pais_a é 'pais' no clube A (e profiles.papel espelha 'pais'), mas a conta não foi aberta como responsável
select t.eq('[pré] o espelho de pais_a diz pais (é exatamente o dado que NÃO pode decidir)',
  (select papel from public.profiles where id = t.id('pais_a')), 'pais');
select t.como('pais_a');
select t.permitido('[herança] pais do clube A pede o clube B pela busca', $q$select public.entrada_solicitar_clube('clube-b-teste')$q$, 0);
reset role;
select t.eq('[herança] o pedido no B nasce desbravador+pendente, não herda pais do A',
  (select role || '|' || status from public.organization_memberships
    where user_id = t.id('pais_a') and organizational_unit_id = t.id('clube_b')), 'desbravador|pendente');
select t.como('pais_a');
select t.permitido('[herança] ...e pelo código do clube C', format($q$select public.entrada_solicitar(%L)$q$, :'cod_c'), 0);
reset role;
select t.eq('[herança] pelo código vale o papel do código, não o do clube A',
  (select role || '|' || status from public.organization_memberships
    where user_id = t.id('pais_a') and organizational_unit_id = t.id('clube_c')), 'desbravador|pendente');

-- diretoria no A pedindo o B: nunca vira liderança no B
select t.como('lider_a');
select t.permitido('[autopromoção] diretoria do A pede o B', $q$select public.entrada_solicitar_clube('clube-b-teste')$q$, 0);
reset role;
select t.eq('[autopromoção] no B é desbravador pendente, não diretoria',
  (select role || '|' || status from public.organization_memberships
    where user_id = t.id('lider_a') and organizational_unit_id = t.id('clube_b')), 'desbravador|pendente');
select t.eq('[autopromoção] e o vínculo dela no A continua igual',
  (select role || '|' || status from public.organization_memberships
    where user_id = t.id('lider_a') and organizational_unit_id = t.id('clube_a')), 'diretoria|ativo');

-- ---------- 3) comportamento preservado para quem abriu a conta como responsável ----------
select t.como('resp_novo');
select t.permitido('[responsável] pede o clube B', $q$select public.entrada_solicitar_clube('clube-b-teste')$q$, 0);
reset role;
select t.eq('[responsável] nasce pais+pendente, sem unidade',
  (select role || '|' || status || '|' || coalesce(unidade_id::text, 'sem') from public.organization_memberships
    where user_id = t.id('resp_novo') and organizational_unit_id = t.id('clube_b')), 'pais|pendente|sem');
select t.eq('[responsável] pedido pendente não dá vínculo com filho nenhum',
  (select count(*) from public.responsaveis where responsavel_id = t.id('resp_novo')), 0);

-- ---------- 4) o cliente não escolhe papel nem mexe no tipo ----------
select t.eq('[cliente] as RPCs de entrada só recebem o destino (slug/código), nenhum papel',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('entrada_solicitar', 'entrada_solicitar_clube') and pronargs = 1), 2);
select t.como('membro_novo');
select t.bloqueado('[cliente] não se declara responsável depois do cadastro',
  $q$update public.profiles set tipo_cadastro = 'pais' where id = auth.uid()$q$);
reset role;
-- metadata do Auth é editável pelo próprio usuário: não pode mudar o resultado
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"tipo":"pais"}' where id = t.id('membro_novo');
select t.como('membro_novo');
select t.permitido('[metadata] muda o metadata e pede o B', $q$select public.entrada_solicitar_clube('clube-b-teste')$q$, 0);
reset role;
select t.eq('[metadata] continua desbravador pendente',
  (select role || '|' || status from public.organization_memberships
    where user_id = t.id('membro_novo') and organizational_unit_id = t.id('clube_b')), 'desbravador|pendente');

-- ---------- 5) pendente não é acesso cruzado ----------
select t.como('membro_novo'); select t.pedir_clube('clube_b');
select t.eq('[pendente] não lê membros do B',
  t.nv($q$select count(*) from public.organization_memberships where organizational_unit_id = t.id('clube_b') and user_id <> auth.uid()$q$), 0);
reset role;

select t.fim();
rollback;
