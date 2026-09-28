-- Migration 410: painéis por plano. Só o admin da plataforma inclui/remove recurso do plano; o clube
-- do plano perde/ganha acesso na hora (servidor); nada é apagado; a diretoria não burla por
-- recurso_definir nem por club_features; tudo auditado; remoção com clube exige confirmação.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin101', '{"tipo":"fundador","nome":"Admin 101"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin101'), 'operacao', 'teste 101');
insert into public.billing_plans (id, chave, versao, nome, recursos) values (public.curriculo_uuid('t101:plano'), 'teste-101', 1, 'Plano 101', null);
insert into public.billing_plans (id, chave, versao, nome, recursos) values (public.curriculo_uuid('t101:vazio'), 'teste-101-vazio', 1, 'Plano 101 sem clube', array['agenda']);
insert into t.ids (chave, id) values ('plano101', public.curriculo_uuid('t101:plano')), ('vazio101', public.curriculo_uuid('t101:vazio'));
insert into public.billing_accounts (id, nome, status) values (public.curriculo_uuid('t101:conta'), 'Conta 101 [TESTE]', 'ativa');
insert into public.subscriptions (id, billing_account_id, plan_id, status, ciclo)
values (public.curriculo_uuid('t101:assin'), public.curriculo_uuid('t101:conta'), t.id('plano101'), 'ativa', 'anual');
insert into public.subscription_clubs (subscription_id, club_id) values (public.curriculo_uuid('t101:assin'), t.id('clube_a'));
insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'agenda', true)
on conflict (club_id, feature) do update set enabled = true;
insert into public.eventos (titulo, data, club_id) values ('Acampamento 101', current_date, t.id('clube_a'));
\o

select t.ok('antes: agenda liberada no clube A', public.recurso_habilitado_no_clube(t.id('clube_a'), 'agenda'));

-- ---------- só o admin ----------
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('diretoria não lista os planos do admin', 'select public.admin_planos_recursos()', 'Sem permissão');
select t.throws('diretoria não tira recurso do plano', format('select public.admin_plano_recurso_definir(%L, %L, false, true)', t.id('plano101'), 'agenda'), 'Sem permissão');
select t.throws('diretoria não vê o impacto', format('select public.admin_plano_recurso_impacto(%L, %L)', t.id('plano101'), 'agenda'), 'Sem permissão');
select t.tenta(format($q$update public.billing_plans set recursos = array['agenda'] where id = %L$q$, t.id('plano101')));
select t.como_anon();
select t.throws('anônimo não altera', format('select public.admin_plano_recurso_definir(%L, %L, false, true)', t.id('plano101'), 'agenda'), null);
reset role;
select t.ok('...e o plano continua "todos"', (select recursos is null from public.billing_plans where id = t.id('plano101')));

-- ---------- a tela do admin ----------
select t.como('admin101');
select t.eq('lista o plano com o catálogo inteiro',
  t.n(format($q$select count(*) from json_array_elements(public.admin_planos_recursos()) p, json_array_elements(p->'recursos') r where (p->>'id')::uuid = %L$q$, t.id('plano101'))),
  t.n('select count(*) from public.recursos_catalogo'));
select t.eq('...e conta 1 clube no plano',
  t.txt(format($q$select p->>'clubes' from json_array_elements(public.admin_planos_recursos()) p where (p->>'id')::uuid = %L$q$, t.id('plano101'))), '1');
select t.eq('impacto: 1 clube usando a agenda', (public.admin_plano_recurso_impacto(t.id('plano101'), 'agenda') ->> 'clubes_usando'), '1');

-- ---------- remoção pede confirmação ----------
select t.eq('1ª chamada só devolve o impacto', (public.admin_plano_recurso_definir(t.id('plano101'), 'agenda', false) ->> 'precisa_confirmar'), 'true');
reset role;
select t.ok('...sem mudar nada', (select recursos is null from public.billing_plans where id = t.id('plano101')));
select t.como('admin101');
select t.eq('plano sem clube: remove sem pedir confirmação', (public.admin_plano_recurso_definir(t.id('vazio101'), 'agenda', false) ->> 'alterado'), 'true');
select t.eq('confirmado: remove', (public.admin_plano_recurso_definir(t.id('plano101'), 'agenda', false, true) ->> 'alterado'), 'true');
reset role;
select t.ok('"todos" virou lista explícita sem a agenda',
  (select recursos is not null and not ('agenda' = any (recursos)) and 'mural' = any (recursos) from public.billing_plans where id = t.id('plano101')));

-- ---------- o clube perde o acesso (servidor) ----------
select t.ok('clube A: agenda fora do plano', not public.recurso_habilitado_no_clube(t.id('clube_a'), 'agenda'));
select t.eq('recursos_do_clube (o que o app lê) diz desligado', public.recursos_do_clube(t.id('clube_a')) ->> 'agenda', 'false');
select t.ok('outro recurso do plano segue ligado', public.recurso_habilitado_no_clube(t.id('clube_a'), 'mural'));
select t.ok('clube B (sem esse plano) não é afetado', public.recurso_habilitado_no_clube(t.id('clube_b'), 'agenda'));
select t.throws('escrita nova na agenda é barrada', format($q$insert into public.eventos (titulo, data, club_id) values ('x', current_date, %L)$q$, t.id('clube_a')), 'desabilitado');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('operacao_permitida aponta o PLANO', public.operacao_permitida('agenda') ->> 'bloqueio', 'plano');

-- ---------- a diretoria não burla ----------
select t.throws('recurso_definir recusa religar', $q$select public.recurso_definir('agenda', true)$q$, 'não faz parte do plano');
select t.tenta(format($q$update public.club_features set enabled = true where club_id = %L and feature = 'agenda'$q$, t.id('clube_a')));
reset role;
select t.ok('...e mexer em club_features direto não religa', not public.recurso_habilitado_no_clube(t.id('clube_a'), 'agenda'));

-- ---------- dados preservados ----------
select t.eq('o evento continua no banco', (select count(*) from public.eventos where club_id = t.id('clube_a') and titulo = 'Acampamento 101'), 1);
select t.eq('a escolha da diretoria (club_features) continua lá', (select enabled::text from public.club_features where club_id = t.id('clube_a') and feature = 'agenda'), 'true');

-- ---------- religar devolve tudo ----------
select t.como('admin101');
select t.eq('incluir de volta', (public.admin_plano_recurso_definir(t.id('plano101'), 'agenda', true) ->> 'alterado'), 'true');
select t.eq('incluir de novo é inofensivo', (public.admin_plano_recurso_definir(t.id('plano101'), 'agenda', true) ->> 'alterado'), 'false');
reset role;
select t.ok('clube A tem a agenda de volta', public.recurso_habilitado_no_clube(t.id('clube_a'), 'agenda'));
select t.eq('...com o mesmo evento', (select count(*) from public.eventos where club_id = t.id('clube_a') and titulo = 'Acampamento 101'), 1);

-- ---------- somente da plataforma ----------
select t.como('admin101');
select t.eq('especialidades já estão no plano (o "todos" virou lista com elas)', (public.admin_plano_recurso_definir(t.id('plano101'), 'especialidades', true) ->> 'alterado'), 'false');
reset role;
select t.ok('especialidades no plano NÃO ligam sozinhas no clube', not public.recurso_habilitado_no_clube(t.id('clube_a'), 'especialidades'));
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('...e a diretoria continua sem ligar', $q$select public.recurso_definir('especialidades', true)$q$, 'liberado pela plataforma');
reset role;

-- ---------- validação ----------
select t.como('admin101');
select t.throws('recurso inventado', format('select public.admin_plano_recurso_definir(%L, %L, true)', t.id('plano101'), 'teletransporte'), 'Recurso desconhecido');
select t.throws('plano inexistente', format('select public.admin_plano_recurso_definir(%L, %L, true)', gen_random_uuid(), 'agenda'), 'Plano não encontrado');
reset role;

-- ---------- auditoria ----------
select t.eq('auditou remoção (2) e inclusão (1); no-op não audita',
  (select count(*) from public.platform_admin_audit where admin_user_id = t.id('admin101') and alvo_tipo = 'plano'
     and acao in ('plano_recurso_removido', 'plano_recurso_incluido')), 3);
select t.eq('a remoção registra quantos clubes afetou',
  (select detalhe ->> 'clubes_afetados' from public.platform_admin_audit where acao = 'plano_recurso_removido' and alvo_id = t.id('plano101')), '1');
select t.eq('a chamada sem confirmação não auditou', (select count(*) from public.platform_admin_audit where acao = 'plano_recurso_removido' and alvo_id = t.id('plano101')), 1);

select t.fim();
rollback;
