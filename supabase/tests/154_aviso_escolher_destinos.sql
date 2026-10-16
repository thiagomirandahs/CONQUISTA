-- Aviso institucional com ESCOLHA de destinatários (migration 554): clube(s), região/distrito, ou todos da área.
-- Um alvo FORA da área é ignorado (nunca amplia o alcance); a lista de destinos mostra só a área da pessoa.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('c154_dist', '{"tipo":"fundador","nome":"Coord Distrital 154"}'::jsonb);
select t.signup('c154_outro', '{"tipo":"fundador","nome":"Coord Outro 154"}'::jsonb);
select t.signup('adm154', '{"tipo":"fundador","nome":"Admin 154"}'::jsonb);
insert into public.platform_admins (user_id, papel) values (t.id('adm154'), 'operacao');
create function t.un154(p_chave text, p_tipo text, p_nome text, p_pai text) returns void language plpgsql as $$
begin
  insert into public.organizational_units (id, type, nome, slug, parent_id, metadata)
  values (public.curriculo_uuid('t154:' || p_chave), p_tipo, p_nome, null,
          case when p_pai is not null then t.id(p_pai) end, '{"test_only":true}');
  insert into t.ids (chave, id) values (p_chave, public.curriculo_uuid('t154:' || p_chave));
end $$;
select t.un154('campo154', 'campo', 'Associação 154', null);
select t.un154('r154', 'regiao', 'Região 154', 'campo154');
select t.un154('d154', 'distrito', 'Distrito 154', 'r154');
select t.un154('d154b', 'distrito', 'Distrito 154 B', 'r154');
update public.organizational_units set parent_id = t.id('d154') where id = t.id('clube_a');
update public.organizational_units set parent_id = t.id('d154b') where id = t.id('clube_b');
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c154_dist'), t.id('d154'), 'coordenador_distrital', 'ativo'),
       (t.id('c154_outro'), t.id('d154b'), 'coordenador_distrital', 'ativo');
create function t.no_escopo154(p_pessoa text, p_unid text) returns void language plpgsql as $$
begin
  perform t.como(p_pessoa);
  perform set_config('request.headers', json_build_object('x-escopo-atual', t.id(p_unid))::text, true);
end $$;
create function t.avisos154(p_clube text, p_titulo_like text) returns bigint language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  select count(*) into n from public.notificacoes where club_id = t.id(p_clube) and titulo like p_titulo_like;
  return n;
end $$;
grant usage on schema t to public;
grant insert, select on t.ids to public;
\o


\o /dev/null
select t.signup('c154_reg', '{"tipo":"fundador","nome":"Coord Regional 154"}'::jsonb);
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('c154_reg'), t.id('r154'), 'coordenador_regional', 'ativo');
\o

-- distrital (só o distrito d154, que tem o clube A)
select t.no_escopo154('c154_dist', 'd154');
select t.eq('destinos do distrital: o distrito e o clube A (nunca o B)',
  (select string_agg(x->>'tipo' || ':' || (x->>'id'), ',' order by x->>'tipo') from jsonb_array_elements(public.aviso_institucional_destinos(false)->'unidades') x),
  'clube:' || t.id('clube_a') || ',distrito:' || t.id('d154'));
select t.eq('sem escolha: alcança 1 clube (todos da área, como antes)', (public.aviso_institucional_alcance(false, null)->>'clubes')::bigint, 1::bigint);
select t.eq('escolher um clube de FORA da área não alcança nada', (public.aviso_institucional_alcance(false, array[t.id('clube_b')])->>'clubes')::bigint, 0::bigint);
select t.throws('...e enviar só para ele é recusado', format($q$select public.aviso_institucional_enviar('Aviso teste', null, 'lideranca', false, array[%L]::uuid[])$q$, t.id('clube_b')), 'Escolha pelo menos um clube');
reset role;

-- regional (região r154: distritos d154 e d154b, clubes A e B)
select t.no_escopo154('c154_reg', 'r154');
select t.eq('regional sem escolha: 2 clubes', (public.aviso_institucional_alcance(false, null)->>'clubes')::bigint, 2::bigint);
select t.eq('escolhendo o distrito B: só o clube B', (public.aviso_institucional_alcance(false, array[t.id('d154b')])->>'clubes')::bigint, 1::bigint);
select t.eq('escolhendo os dois clubes: 2', (public.aviso_institucional_alcance(false, array[t.id('clube_a'), t.id('clube_b')])->>'clubes')::bigint, 2::bigint);
select t.eq('destinos do regional: região, 2 distritos e 2 clubes', jsonb_array_length(public.aviso_institucional_destinos(false)->'unidades')::bigint, 5::bigint);
select set_config('t154.r', public.aviso_institucional_enviar('Reunião de diretoria', 'Sábado 9h', 'lideranca', false, array[t.id('d154b')])::text, true);
reset role;
select t.eq('enviou para 1 clube (o do distrito escolhido)', ((current_setting('t154.r')::jsonb)->>'clubes')::bigint, 1::bigint);
select t.eq('o aviso chegou no clube B', t.avisos154('clube_b', '%Reunião de diretoria%'), 1::bigint);
select t.eq('...e NÃO no clube A', t.avisos154('clube_a', '%Reunião de diretoria%'), 0::bigint);
select t.eq('auditoria registra que houve escolha', (select count(*) from public.auditoria_operacoes where operacao = 'aviso_institucional' and ator = t.id('c154_reg') and (detalhe->>'escolha')::boolean), 1::bigint);

-- regional não manda para "todos os membros" (só liderança), com ou sem escolha
select t.no_escopo154('c154_reg', 'r154');
select t.throws('coordenação não envia para todos os membros', format($q$select public.aviso_institucional_enviar('Aviso teste', null, 'todos', false, array[%L]::uuid[])$q$, t.id('clube_a')), 'só para a liderança');
reset role;

-- plataforma: escolhe a região inteira
select t.como('adm154');
select t.eq('admin escolhendo a região: os clubes dela', (public.aviso_institucional_alcance(true, array[t.id('r154')])->>'clubes')::bigint, 2::bigint);
reset role;

-- quem não é coordenação nem admin
select t.como('lider_a');
select t.eq('diretoria de clube não vê destinos', (public.aviso_institucional_destinos(false)->>'pode')::boolean::int::bigint, 0::bigint);
reset role;

select t.fim();
rollback;
