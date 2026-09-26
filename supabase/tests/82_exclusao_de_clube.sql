-- Migration 280: exclusão de clube em duas fases (arquivar -> recuperar -> expurgo), só admin da
-- plataforma; Tenant 001 protegido; licença liberada; expurgo só do clube e das contas exclusivas.
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin82', '{"tipo":"fundador","nome":"Admin 82"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin82'), 'operacao', 'teste 82');

-- hierarquia: clube B debaixo de um distrito
insert into public.organizational_units (type, nome, slug, metadata) values ('distrito', 'Distrito 82', 'distrito-82', '{"test_only":true}');
insert into t.ids (chave, id) select 'distrito82', id from public.organizational_units where slug = 'distrito-82';
update public.organizational_units set parent_id = t.id('distrito82') where id = t.id('clube_b');

-- licença do clube B (só ele): trial vigente
insert into public.billing_accounts (nome) values ('Conta 82');
insert into t.ids (chave, id) select 'conta82', id from public.billing_accounts where nome = 'Conta 82';
delete from public.subscription_clubs where club_id = t.id('clube_b');
insert into public.subscriptions (billing_account_id, plan_id, status, trial_ate)
select t.id('conta82'), (select id from public.billing_plans order by created_at limit 1), 'trial', now() + interval '10 days';
insert into t.ids (chave, id) select 'sub82', id from public.subscriptions where billing_account_id = t.id('conta82');
insert into public.subscription_clubs (subscription_id, club_id) values (t.id('sub82'), t.id('clube_b'));

select t.mk('pend82', 'Pendente 82', 'desbravador', 'pendente', 'clube_b', 'B1');

-- código de entrada do B
insert into public.club_entry_codes (club_id, codigo_hash, prefixo) values (t.id('clube_b'), md5('cod82'), 'DC-82');

-- Storage: um objeto no prefixo do B e um no do A
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('imagens', t.id('clube_b')::text || '/mural/b82.jpg', t.id('membro_b')::text, '{"size": 10}'),
       ('imagens', t.id('clube_a')::text || '/mural/a82.jpg', t.id('membro_a')::text, '{"size": 10}');
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('membro_b'), 'manual', 7, 'ponto 82', t.id('clube_b'));

-- clube C (para a rotina de expurgo por retenção)
insert into public.organizational_units (type, nome, slug, metadata) values ('clube', 'Clube C 82', 'clube-c-82', '{"test_only":true}');
insert into t.ids (chave, id) select 'clube_c', id from public.organizational_units where slug = 'clube-c-82';
select t.mk('so_c', 'Só C', 'diretoria', 'ativo', 'clube_c');

create temp table t82 (chave text primary key, valor text);
grant all on t82 to authenticated;
insert into t82 select 'pontos_a', count(*)::text from public.pontos where club_id = t.id('clube_a');
insert into t82 select 'vinc_a', count(*)::text from public.organization_memberships where organizational_unit_id = t.id('clube_a');
insert into t82 select 'ativ_a', count(*)::text from public.atividades where club_id = t.id('clube_a');
\o

-- ============================ permissões ============================
select t.eq('anon sem EXECUTE nas RPCs novas',
  t.n($q$select count(*) from unnest(array['admin_clube_excluir(uuid, text, text)','admin_clube_recuperar(uuid, text)',
         'admin_clube_expurgar_agora(uuid, text)','admin_clube_exclusao_config()','admin_clube_exclusao_config_definir(int, boolean, text)',
         'admin_clubes_excluidos_listar()','clube_exclusao_rotina()']) f
        where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);
select t.ok('authenticated não roda a rotina', not has_function_privilege('authenticated', 'public.clube_exclusao_rotina()', 'execute'));
select t.ok('registro de exclusões sem acesso direto', not has_table_privilege('authenticated', 'public.clube_exclusoes', 'select'));

select t.como('lider_b');
select t.throws('diretoria do clube não exclui o próprio clube',
  format($q$select public.admin_clube_excluir(%L, 'Clube B (teste)', 'motivo qualquer')$q$, t.id('clube_b')), 'Sem permissão');
select t.throws('não-admin não lista a lixeira de clubes', $q$select public.admin_clubes_excluidos_listar()$q$, 'Sem permissão');
select t.throws('não-admin não libera o fundador', $q$select public.admin_clube_exclusao_config_definir(null, true, 'quero apagar')$q$, 'Sem permissão');

-- ============================ fundador ============================
select t.como('admin82');
select t.throws('Tenant 001 bloqueado por padrão',
  format($q$select public.admin_clube_excluir(%L, (select nome from public.organizational_units where id = %L), 'teste de bloqueio')$q$,
         t.id('clube_a'), t.id('clube_a')), 'fundador');
select t.eq('padrão: liberação do fundador desligada', t.txt($q$select public.admin_clube_exclusao_config() ->> 'permitir_excluir_fundador'$q$), 'false');
select t.throws('liberar o fundador exige motivo', $q$select public.admin_clube_exclusao_config_definir(null, true, null)$q$, 'motivo');

-- ============================ confirmação ============================
select t.throws('nome errado recusado',
  format($q$select public.admin_clube_excluir(%L, 'Clube Errado', 'encerrou as atividades')$q$, t.id('clube_b')), 'nome do clube');
select t.throws('motivo obrigatório',
  format($q$select public.admin_clube_excluir(%L, 'Clube B (teste)', '  ')$q$, t.id('clube_b')), 'motivo');

-- ============================ FASE 1: excluir ============================
select t.ok('B aparece na vitrine antes', public.vitrine_clubes_publico()::text like '%Clube B (teste)%');
select t.eq('excluir devolve ok',
  t.txt(format($q$select public.admin_clube_excluir(%L, '  clube b (TESTE) ', 'clube encerrou as atividades') ->> 'ok'$q$, t.id('clube_b'))), 'true');
reset role;
insert into t82 select 'exclusao_b', id::text from public.clube_exclusoes where clube_uuid = t.id('clube_b') and status = 'excluido';

select t.eq('clube B com status excluido', t.txt(format($q$select status from public.organizational_units where id = %L$q$, t.id('clube_b'))), 'excluido');
select t.eq('nada apagado: pontos do B continuam', t.n(format($q$select count(*) from public.pontos where club_id = %L and motivo = 'ponto 82'$q$, t.id('clube_b'))), 1);
select t.eq('nenhum vínculo ativo/pendente no B', t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L and status in ('ativo','pendente')$q$, t.id('clube_b'))), 0);
select t.eq('todos os vínculos do B marcados', t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L and metadata ->> 'clube_excluido' is null$q$, t.id('clube_b'))), 0);
select t.eq('vínculo no A de quem é dos dois continua ativo',
  t.n(format($q$select count(*) from public.organization_memberships where user_id = %L and organizational_unit_id = %L and status = 'ativo'$q$, t.id('multi_dois_papeis'), t.id('clube_a'))), 1);
select t.ok('B some da vitrine', public.vitrine_clubes_publico()::text not like '%Clube B (teste)%');
select t.eq('B some do painel da coordenação (fora da árvore)',
  t.n(format($q$select count(*) from public._clubes_descendentes(%L) d where d.club_id = %L$q$, t.id('distrito82'), t.id('clube_b'))), 0);
select t.eq('licença liberada: nenhuma assinatura viva no B', t.txt(format($q$select coalesce(public._admin_assinatura_viva_do_clube(%L)::text, 'nenhuma')$q$, t.id('clube_b'))), 'nenhuma');
select t.eq('assinatura cancelada (só status)', t.txt(format($q$select status from public.subscriptions where id = %L$q$, t.id('sub82'))), 'cancelada');
select t.ok('evento de cancelamento registrado', exists (select 1 from public.subscription_events where subscription_id = t.id('sub82') and para = 'cancelada' and origem = 'admin'));
select t.ok('código de entrada revogado', not exists (select 1 from public.club_entry_codes where club_id = t.id('clube_b') and revoked_at is null));
select t.ok('exclusão auditada', exists (select 1 from public.platform_admin_audit where acao = 'clube_excluir' and alvo_id = t.id('clube_b') and admin_user_id = t.id('admin82')));

select t.como('membro_b');
select t.pedir_clube('clube_b');
select t.eq('membro do B pedindo o B: sem clube em uso', t.txt($q$select coalesce(public.clube_atual_id()::text, 'nenhum')$q$), 'nenhum');
select t.esquecer_clube_pedido();
select t.eq('membro do B sem pedir: sem clube em uso', t.txt($q$select coalesce(public.clube_atual_id()::text, 'nenhum')$q$), 'nenhum');
select t.como('multi_dois_papeis');
select t.pedir_clube('clube_b');
select t.eq('quem é de A e B não entra mais no B', t.txt($q$select coalesce(public.clube_atual_id()::text, 'nenhum')$q$), 'nenhum');
select t.pedir_clube('clube_a');
select t.eq('... mas continua no A', public.clube_atual_id(), t.id('clube_a'));

select t.como('admin82');
select t.eq('B some da lista de clubes do admin',
  t.n(format($q$select count(*) from json_array_elements(public.admin_clubes_listar()) c where (c ->> 'club_id')::uuid = %L$q$, t.id('clube_b'))), 0);
select t.eq('lixeira de clubes lista o B com data prevista de expurgo',
  t.n($q$select count(*) from json_array_elements(public.admin_clubes_excluidos_listar() -> 'clubes') c
          where c ->> 'slug' = 'clube-b-teste' and c ->> 'status' = 'excluido' and c ->> 'expurgo_previsto_em' is not null
            and c ->> 'motivo' = 'clube encerrou as atividades'$q$), 1);
select t.throws('excluir de novo recusado',
  format($q$select public.admin_clube_excluir(%L, 'Clube B (teste)', 'de novo aqui')$q$, t.id('clube_b')), 'lixeira');

-- ============================ RECUPERAR ============================
select t.eq('recuperar devolve ok',
  t.txt(format($q$select public.admin_clube_recuperar(%L, 'engano') ->> 'ok'$q$, (select valor from t82 where chave = 'exclusao_b'))), 'true');
reset role;
select t.eq('B volta ativo', t.txt(format($q$select status from public.organizational_units where id = %L$q$, t.id('clube_b'))), 'ativo');
select t.eq('B volta para a árvore', t.txt(format($q$select parent_id::text from public.organizational_units where id = %L$q$, t.id('clube_b'))), t.id('distrito82')::text);
select t.eq('vínculo do membro_b volta ativo', t.txt(format($q$select status from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('membro_b'), t.id('clube_b'))), 'ativo');
select t.eq('pendente volta pendente', t.txt(format($q$select status from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('pend82'), t.id('clube_b'))), 'pendente');
select t.eq('quem já estava suspenso continua suspenso',
  t.txt(format($q$select status from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('suspenso_so_b'), t.id('clube_b'))), 'suspenso');
select t.eq('marcas removidas', t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L and metadata ? 'clube_excluido'$q$, t.id('clube_b'))), 0);
select t.eq('assinatura volta ao status que tinha (trial vigente)', t.txt(format($q$select status from public.subscriptions where id = %L$q$, t.id('sub82'))), 'trial');
select t.ok('código de entrada volta', exists (select 1 from public.club_entry_codes where club_id = t.id('clube_b') and revoked_at is null));
select t.ok('B volta à vitrine', public.vitrine_clubes_publico()::text like '%Clube B (teste)%');
select t.ok('recuperação auditada', exists (select 1 from public.platform_admin_audit where acao = 'clube_recuperar' and alvo_id = t.id('clube_b')));
select t.como('membro_b');
select t.pedir_clube('clube_b');
select t.eq('membro do B volta a usar o B', public.clube_atual_id(), t.id('clube_b'));

-- trial vencido na lixeira volta como "aguardando pagamento"
select t.como('admin82');
select public.admin_clube_excluir(t.id('clube_b'), 'Clube B (teste)', 'segunda exclusão') is not null;
reset role;
update public.subscriptions set trial_ate = now() - interval '1 day' where id = t.id('sub82');
delete from t82 where chave = 'exclusao_b';
insert into t82 select 'exclusao_b', id::text from public.clube_exclusoes where clube_uuid = t.id('clube_b') and status = 'excluido';
select t.como('admin82');
select public.admin_clube_recuperar((select valor from t82 where chave = 'exclusao_b')::uuid) is not null;
reset role;
select t.eq('trial vencido volta como pagamento_pendente', t.txt(format($q$select status from public.subscriptions where id = %L$q$, t.id('sub82'))), 'pagamento_pendente');

-- ============================ EXPURGO (botão) ============================
select t.como('admin82');
select public.admin_clube_excluir(t.id('clube_b'), 'Clube B (teste)', 'terceira exclusão, agora vai') is not null;
reset role;
delete from t82 where chave = 'exclusao_b';
insert into t82 select 'exclusao_b', id::text from public.clube_exclusoes where clube_uuid = t.id('clube_b') and status = 'excluido';
select t.como('lider_b');
select t.throws('não-admin não expurga', format($q$select public.admin_clube_expurgar_agora(%L, 'APAGAR')$q$, (select valor from t82 where chave = 'exclusao_b')), 'Sem permissão');
select t.como('admin82');
select t.throws('expurgo exige a palavra APAGAR', format($q$select public.admin_clube_expurgar_agora(%L, 'apagar')$q$, (select valor from t82 where chave = 'exclusao_b')), 'APAGAR');
select t.eq('expurgo agora devolve ok', t.txt(format($q$select public.admin_clube_expurgar_agora(%L, 'APAGAR') ->> 'ok'$q$, (select valor from t82 where chave = 'exclusao_b'))), 'true');
reset role;
select t.ok('linha do clube B apagada', not exists (select 1 from public.organizational_units where id = t.id('clube_b')));
select t.eq('nenhuma linha com club_id do B em tabela nenhuma',
  (select sum(t.n(format('select count(*) from public.%I where club_id = %L', c.relname, t.id('clube_b'))))::bigint
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
    where c.relkind = 'r' and a.atttypid = 'uuid'::regtype), 0::bigint);
select t.eq('dados do A intactos: pontos', t.n(format($q$select count(*) from public.pontos where club_id = %L$q$, t.id('clube_a'))), (select valor::bigint from t82 where chave = 'pontos_a'));
select t.eq('dados do A intactos: atividades', t.n(format($q$select count(*) from public.atividades where club_id = %L$q$, t.id('clube_a'))), (select valor::bigint from t82 where chave = 'ativ_a'));
select t.eq('dados do A intactos: vínculos', t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L$q$, t.id('clube_a'))), (select valor::bigint from t82 where chave = 'vinc_a'));
select t.ok('conta exclusiva do B apagada (membro_b)', not exists (select 1 from auth.users where id = t.id('membro_b')));
select t.ok('conta exclusiva do B apagada (lider_b)', not exists (select 1 from auth.users where id = t.id('lider_b')));
select t.ok('conta de quem é de A e B fica', exists (select 1 from auth.users where id = t.id('multi_dois_papeis')));
select t.ok('conta de pais de dois clubes fica', exists (select 1 from auth.users where id = t.id('pais_2clubes')));
select t.ok('admin da plataforma fica', exists (select 1 from auth.users where id = t.id('admin82')));
select t.ok('objeto do Storage do B apagado', not exists (select 1 from storage.objects where name = t.id('clube_b')::text || '/mural/b82.jpg'));
select t.ok('objeto do Storage do A fica', exists (select 1 from storage.objects where name = t.id('clube_a')::text || '/mural/a82.jpg'));
select t.ok('assinatura (histórico comercial) fica', exists (select 1 from public.subscriptions where id = t.id('sub82')));
select t.eq('registro vira expurgado', t.txt(format($q$select status from public.clube_exclusoes where id = %L$q$, (select valor from t82 where chave = 'exclusao_b'))), 'expurgado');
select t.ok('expurgo auditado', exists (select 1 from public.platform_admin_audit where acao = 'clube_expurgar' and alvo_id = t.id('clube_b') and admin_user_id = t.id('admin82')));

-- ============================ EXPURGO (rotina, retenção) ============================
select t.como('admin82');
select public.admin_clube_excluir(t.id('clube_c'), 'Clube C 82', 'teste da retenção') is not null;
select t.eq('retenção padrão 30 dias', t.txt($q$select public.admin_clube_exclusao_config() ->> 'dias_retencao'$q$), '30');
reset role;
select t.eq('rotina: dentro da retenção nada é apagado', public.clube_exclusao_rotina()::bigint, 0::bigint);
select t.ok('C ainda existe', exists (select 1 from public.organizational_units where id = t.id('clube_c')));
update public.clube_exclusoes set excluido_em = now() - interval '31 days' where clube_uuid = t.id('clube_c');
select t.eq('rotina: vencido é expurgado', public.clube_exclusao_rotina()::bigint, 1::bigint);
select t.ok('C apagado', not exists (select 1 from public.organizational_units where id = t.id('clube_c')));
select t.ok('conta exclusiva do C apagada', not exists (select 1 from auth.users where id = t.id('so_c')));
select t.ok('Tenant 001 continua lá', exists (select 1 from public.organizational_units where id = t.id('clube_a') and status = 'ativo'));

select t.fim();
rollback;
