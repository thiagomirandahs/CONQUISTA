-- Administração da Plataforma por CLUBE (migration 103): quem entra, o que vê, o que NÃO vê.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
-- hierarquia institucional mínima acima do clube A
insert into public.organizational_units (id, type, nome, slug, metadata) values
  (public.curriculo_uuid('t71:campo'), 'campo', 'Campo 71', 't71-campo', '{"test_only":true}'),
  (public.curriculo_uuid('t71:regiao'), 'regiao', 'Região 71', 't71-regiao', '{"test_only":true}'),
  (public.curriculo_uuid('t71:distrito'), 'distrito', 'Distrito 71', 't71-distrito', '{"test_only":true}')
on conflict (id) do nothing;
insert into t.ids (chave, id) values ('campo', public.curriculo_uuid('t71:campo')), ('regiao', public.curriculo_uuid('t71:regiao')), ('distrito', public.curriculo_uuid('t71:distrito'));
update public.organizational_units set parent_id = t.id('campo') where id = t.id('regiao');
update public.organizational_units set parent_id = t.id('regiao') where id = t.id('distrito');
update public.organizational_units set parent_id = t.id('distrito') where id = t.id('clube_a');

select t.mk('coord_dist', 'Coord Distrital 71', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('coord_dist');
select t.mk2('coord_dist', 'coordenador_distrital', 'ativo', 'distrito');
select t.mk('coord_reg', 'Coord Regional 71', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('coord_reg');
select t.mk2('coord_reg', 'coordenador_regional', 'ativo', 'regiao');
select t.mk('coord_campo', 'Coord Campo 71', 'desbravador', 'pendente', 'clube_a');
delete from public.organization_memberships where user_id = t.id('coord_campo');
select t.mk2('coord_campo', 'coordenador_geral', 'ativo', 'campo');

select t.signup('admin_saas', '{"tipo":"fundador","nome":"Admin da Plataforma"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_saas'), 'operacao', 'bootstrap de teste');
select t.signup('fundador71', '{"tipo":"fundador","nome":"Fulano Setenta"}'::jsonb);
insert into public.onboarding_sessions (id, user_id, etapa, status, dados)
values (public.curriculo_uuid('t71:sessao'), t.id('fundador71'), 'dados_basicos', 'em_andamento',
        '{"email":"segredo71@teste.local","nome":"Fulano Setenta"}'::jsonb);
insert into t.ids (chave, id) values ('sessao71', public.curriculo_uuid('t71:sessao'));
\o

-- ==================== 1) quem NÃO é admin da plataforma é recusado (API, não só a tela) ====================
select t.como('membro_a');
select t.throws('membro comum: admin_visao_geral recusada', 'select public.admin_visao_geral()', 'Sem permissão');
select t.throws('membro comum: admin_clubes_listar recusada', 'select public.admin_clubes_listar()', 'Sem permissão');
select t.como('lider_a');
select t.throws('diretoria do clube: admin_clubes_listar recusada', 'select public.admin_clubes_listar()', 'Sem permissão');
select t.throws('diretoria do clube: admin_clube_detalhe do PRÓPRIO clube recusada',
  format('select public.admin_clube_detalhe(%L)', t.id('clube_a')), 'Sem permissão');
select t.como('coord_dist');
select t.throws('distrital: admin_planos_listar recusada', 'select public.admin_planos_listar()', 'Sem permissão');
select t.como('coord_reg');
select t.throws('regional: admin_assinaturas_listar recusada', 'select public.admin_assinaturas_listar()', 'Sem permissão');
select t.como('coord_campo');
select t.throws('campo: admin_onboarding_listar recusada', 'select public.admin_onboarding_listar()', 'Sem permissão');
reset role;
select t.eq('anon não tem EXECUTE em nenhuma RPC nova',
  t.n($q$select count(*) from unnest(array['admin_clubes_listar()','admin_clube_detalhe(uuid)','admin_planos_listar()',
          'admin_assinaturas_listar()','admin_onboarding_listar()','admin_visao_geral()']) f
         where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);

-- ==================== 2) o admin da plataforma entra ====================
select set_config('t71.nclubes', (select count(*) from public.organizational_units where type = 'clube')::text, true) is not null;
select t.como('admin_saas');
select t.eq('admin: lista TODOS os clubes (inclusive sem conta comercial)',
  t.n($q$select count(*) from json_array_elements(public.admin_clubes_listar())$q$),
  current_setting('t71.nclubes')::bigint);
select t.eq('admin: um clube sem conta comercial (como o Tenant 001) aparece, com assinatura vazia',
  t.n($q$select count(*) from json_array_elements(public.admin_clubes_listar()) c where c ->> 'assinatura_id' is null$q$) > 0, true);
select t.ok('admin: detalhe do clube A abre', (select (public.admin_clube_detalhe(t.id('clube_a')) -> 'clube' ->> 'club_id')::uuid = t.id('clube_a')));
select t.eq('admin: o detalhe mostra a hierarquia acima do clube (só tipo e nome)',
  t.txt($q$select public.admin_clube_detalhe(t.id('clube_a')) -> 'hierarquia' ->> 'tipo'$q$), 'distrito');
select t.throws('admin: clube inexistente dá erro claro', format('select public.admin_clube_detalhe(%L)', gen_random_uuid()), 'Clube não encontrado');
select t.ok('admin: visão geral tem as métricas', (select (public.admin_visao_geral() ->> 'clubes_total')::int >= 2));
select t.ok('admin: assinaturas e onboarding abrem', (select public.admin_assinaturas_listar() is not null and public.admin_onboarding_listar() is not null));

-- ==================== 3) o que o admin NÃO vê ====================
select set_config('t71.saida', public.admin_clubes_listar()::text || public.admin_clube_detalhe(t.id('clube_a'))::text
  || public.admin_onboarding_listar()::text || public.admin_assinaturas_listar()::text || public.admin_visao_geral()::text, true) is not null;
select t.eq('o onboarding NÃO expõe o campo dados da sessão',
  t.n($q$select count(*) from json_array_elements(public.admin_onboarding_listar()) o where o::jsonb ? 'dados'$q$), 0);
reset role;
select t.ok('a saída do admin tem conteúdo (a checagem abaixo não é vazia por engano)', length(current_setting('t71.saida')) > 200);
select t.eq('nenhuma saída do admin traz nome de pessoa do clube A (conferido como superusuário, sem RLS)',
  t.n($q$select count(*) from public.profiles p join public.organization_memberships m on m.user_id = p.id
        where m.organizational_unit_id = t.id('clube_a') and length(p.nome) > 3
          and current_setting('t71.saida') like '%' || p.nome || '%'$q$), 0);
select t.ok('a sessão de cadastro de teste aparece no onboarding do admin', current_setting('t71.saida') like '%' || t.id('sessao71')::text || '%');
select t.ok('...mas o e-mail e o nome digitados no cadastro NÃO aparecem', current_setting('t71.saida') not like '%segredo71@%' and current_setting('t71.saida') not like '%Fulano Setenta%');
select t.eq('admin: planos listam TODAS as versões, inclusive as fora da vitrine',
  t.n($q$select count(*) from json_array_elements(public.admin_planos_listar())$q$), t.n($q$select count(*) from public.billing_plans$q$));
select t.eq('ser admin da plataforma NÃO cria vínculo de clube',
  t.n($q$select count(*) from public.organization_memberships where user_id = t.id('admin_saas')$q$), 0);
select t.como('admin_saas');
select t.eq('...e o admin não enxerga pontos do clube pela RLS (continua fora do clube)',
  t.n($q$select count(*) from public.pontos$q$), 0);

-- ==================== 4) situação de armazenamento ====================
reset role;
select t.eq('situação: sem limite', public._admin_situacao_armazenamento(10, null), 'sem_limite');
select t.eq('situação: normal', public._admin_situacao_armazenamento(1048576, 10), 'normal');
select t.eq('situação: próximo (≥80%)', public._admin_situacao_armazenamento(9 * 1048576, 10), 'proximo');
select t.eq('situação: atingido', public._admin_situacao_armazenamento(10 * 1048576, 10), 'atingido');

select * from t.fim();
rollback;
