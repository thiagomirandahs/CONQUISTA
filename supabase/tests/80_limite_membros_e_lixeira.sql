-- Migrations 220/221/310: limite de membros ajustável por clube (admin da plataforma). A lixeira de
-- membros inativos (221) foi DESLIGADA de vez na 310: nada é movido nem apagado; só "recuperar".
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
select t.signup('admin80', '{"tipo":"fundador","nome":"Admin 80"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin80'), 'operacao', 'teste 80');
-- saiu_b: sai do clube B, mas continua ATIVO no clube A (a conta global tem que sobreviver)
select t.mk('saiu_b', 'Joana Saiu Pereira', 'desbravador', 'ativo', 'clube_b', 'B1', date '2013-02-02');
select t.mk2('saiu_b', 'desbravador', 'ativo', 'clube_a', 'A1');
-- so_b: só existe no clube B (no expurgo, a conta de login some junto)
select t.mk('so_b', 'Pedro Só B', 'desbravador', 'ativo', 'clube_b', 'B1');
-- recente_b: saiu há só 30 dias (não pode ir)
select t.mk('recente_b', 'Recente B', 'desbravador', 'ativo', 'clube_b', 'B1');
-- velho_a: saiu do Tenant 001 há muito tempo (Tenant 001 fica em dry-run)
select t.mk('velho_a', 'Velho A', 'desbravador', 'ativo', 'clube_a', 'A1');
select t.mk('pais_extra_b', 'Pais Extra B', 'pais', 'pendente', 'clube_b');

-- dados do saiu_b nos dois clubes
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('saiu_b'), 'manual', 11, 'ponto saiu_b no B', t.id('clube_b'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('saiu_b'), 'manual', 13, 'ponto saiu_b no A', t.id('clube_a'));
insert into public.pontos (usuario_id, origem, pontos, motivo, club_id) values (t.id('so_b'), 'manual', 5, 'ponto so_b', t.id('clube_b'));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('imagens', t.id('clube_b')::text || '/comprovacoes/saiu-b.jpg', t.id('saiu_b')::text, '{"size": 100, "mimetype": "image/jpeg"}'),
       ('imagens', t.id('clube_a')::text || '/comprovacoes/saiu-a.jpg', t.id('saiu_b')::text, '{"size": 100, "mimetype": "image/jpeg"}');
insert into public.entregas (atividade_id, usuario_id, texto, foto_url)
values (t.id('atv_b'), t.id('saiu_b'), 'entrega saiu_b', 'https://x.supabase.co/storage/v1/object/sign/imagens/' || t.id('clube_b')::text || '/comprovacoes/saiu-b.jpg?token=abc');
insert into public.entregas (atividade_id, usuario_id, texto, foto_url)
values (t.id('atv_a'), t.id('saiu_b'), 'entrega saiu_b no A', t.id('clube_a')::text || '/comprovacoes/saiu-a.jpg');
-- registro IMUTÁVEL (recusa DELETE): tem que ir e voltar inteiro
insert into public.class_completion_events (usuario_id, club_id, tipo, observacao)
values (t.id('saiu_b'), t.id('clube_b'), 'requisitos_concluidos', 'evento saiu_b');
\o

-- ============================ 1) LIMITE DE MEMBROS ============================
select t.como('lider_b');
select t.throws('diretoria não ajusta limite', format($q$select public.admin_clube_limite_membros_definir(%L, 999, 'x')$q$, t.id('clube_b')), 'Sem permissão');
select t.throws('diretoria não lê limite do admin', format($q$select public.admin_clube_limite_membros(%L)$q$, t.id('clube_b')), 'Sem permissão');
reset role;
select t.eq('anon sem EXECUTE nas RPCs novas',
  t.n($q$select count(*) from unnest(array['admin_clube_limite_membros(uuid)','admin_clube_limite_membros_definir(uuid, int, text)',
         'admin_lixeira_config()','admin_lixeira_listar(uuid)','admin_lixeira_recuperar(uuid, text)','lixeira_rotina()']) f
        where has_function_privilege('anon', 'public.' || f, 'execute')$q$), 0);
select t.ok('authenticated não roda a rotina', not has_function_privilege('authenticated', 'public.lixeira_rotina()', 'execute'));
select t.ok('lixeira sem acesso direto', not has_table_privilege('authenticated', 'public.lixeira_linhas', 'select'));

create temp table t80 (chave text primary key, valor text);
grant all on t80 to authenticated;
insert into t80 select 'uso_b', public.limite_uso(t.id('clube_b'), 'membros')::text;
insert into t80 select 'plano_a', coalesce(public.plano_limite(t.id('clube_a'), 'membros')::text, 'sem');
insert into t80 select 'planos', md5(string_agg(limites::text, ',' order by id)) from public.billing_plans;

select t.como('admin80');
select t.throws('ajuste sem motivo recusado', format($q$select public.admin_clube_limite_membros_definir(%L, 5)$q$, t.id('clube_b')), 'motivo');
select t.eq('admin ajusta o limite do clube B para o uso atual',
  t.txt(format($q$select (public.admin_clube_limite_membros_definir(%L, %s, 'teste de teto') ->> 'limite_efetivo')$q$,
               t.id('clube_b'), (select valor from t80 where chave = 'uso_b'))), (select valor from t80 where chave = 'uso_b'));
select t.eq('admin lê: efetivo = ajuste',
  t.txt(format($q$select public.admin_clube_limite_membros(%L) #>> '{ajuste,valor}'$q$, t.id('clube_b'))), (select valor from t80 where chave = 'uso_b'));
reset role;
select t.eq('limites_do_clube (tela do clube) mostra o teto ajustado',
  t.txt(format($q$select public.limites_do_clube(%L) #>> '{membros,limite}'$q$, t.id('clube_b'))), (select valor from t80 where chave = 'uso_b'));
select t.eq('...marcado como ajustado', t.txt(format($q$select public.limites_do_clube(%L) #>> '{membros,ajustado}'$q$, t.id('clube_b'))), 'true');
select t.eq('o plano (para todos) não mudou', t.txt($q$select md5(string_agg(limites::text, ',' order by id)) from public.billing_plans$q$), (select valor from t80 where chave = 'planos'));
select t.eq('o outro clube não foi afetado', t.txt(format($q$select coalesce(public.plano_limite(%L, 'membros')::text, 'sem')$q$, t.id('clube_a'))), (select valor from t80 where chave = 'plano_a'));
select t.ok('auditoria do ajuste', exists (select 1 from public.platform_admin_audit where acao = 'limite_membros_definir' and alvo_id = t.id('clube_b')
                                            and admin_user_id = t.id('admin80') and detalhe ->> 'motivo' = 'teste de teto'));

-- pontos de entrada barrados: reativar (vinculo_gerir) e aprovar pendente
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('REATIVAR suspenso com o clube cheio: barrado com mensagem clara',
  format($q$select public.vinculo_gerir(%L, null, 'ativo')$q$, t.id('suspenso_so_b')), 'atingiu o limite de');
reset role;
select t.throws('novo vínculo ativo (convite/aprovação) barrado',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'desbravador', 'ativo')$q$,
         t.id('velho_a'), t.id('clube_b')), 'atingiu o limite de');
select t.permitido('responsável (pais) não conta nem é barrado',
  format($q$update public.organization_memberships set status = 'ativo' where user_id = %L and organizational_unit_id = %L$q$, t.id('pais_extra_b'), t.id('clube_b')));
select t.eq('...e não mexeu no uso', t.txt(format($q$select public.limite_uso(%L, 'membros')::text$q$, t.id('clube_b'))), (select valor from t80 where chave = 'uso_b'));

select t.como('admin80');
select t.permitido('admin remove o ajuste', format($q$select public.admin_clube_limite_membros_definir(%L, null)$q$, t.id('clube_b')));
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.permitido('sem ajuste (clube sem plano): reativar volta a funcionar', format($q$select public.vinculo_gerir(%L, null, 'ativo')$q$, t.id('suspenso_so_b')));
reset role;
select t.ok('auditoria da remoção', exists (select 1 from public.platform_admin_audit where acao = 'limite_membros_remover' and alvo_id = t.id('clube_b')));

-- ============================ 2) LIXEIRA DESLIGADA (migration 310) ============================
-- Decisão do dono (26/09): inativo não se apaga. A rotina não move nada, ninguém liga o modo
-- 'ativo' (nem 'dry_run'), e só sobrou o "recuperar" para algum pacote que já exista.
\o /dev/null
update public.organization_memberships set status = 'encerrado' where user_id in (t.id('saiu_b'), t.id('so_b')) and organizational_unit_id = t.id('clube_b');
update public.organization_memberships set inativo_desde = now() - interval '400 days' where user_id in (t.id('saiu_b'), t.id('so_b')) and organizational_unit_id = t.id('clube_b');
\o
select t.ok('gatilho grava inativo_desde ao encerrar',
  (select inativo_desde is not null from public.organization_memberships where user_id = t.id('saiu_b') and organizational_unit_id = t.id('clube_b')));
select t.eq('modo global = desligado', (select modo from public.lixeira_config), 'desligado');
select t.eq('nenhum clube com modo diferente de desligado', t.n($q$select count(*) from public.lixeira_config_clube where modo <> 'desligado'$q$), 0);
select t.throws('modo ativo recusado (global)', $q$update public.lixeira_config set modo = 'ativo'$q$, 'lixeira_config_sempre_desligada');
select t.throws('modo dry_run recusado (global)', $q$update public.lixeira_config set modo = 'dry_run'$q$, 'lixeira_config_sempre_desligada');
select t.throws('modo ativo recusado (clube)', format($q$insert into public.lixeira_config_clube (club_id, modo) values (%L, 'ativo')$q$, t.id('clube_b')), 'lixeira_config_clube_sempre_desligada');
select t.eq('RPCs de ligar/simular removidas',
  t.n($q$select count(*) from pg_proc where proname in ('admin_lixeira_config_definir', 'admin_lixeira_clube_modo', 'admin_lixeira_simular') and pronamespace = 'public'::regnamespace$q$), 0);
select t.eq('cron da lixeira não está agendado', t.n($q$select count(*) from cron.job where jobname = 'lixeira-membros-inativos'$q$), 0);

insert into t80 select 'linhas_antes', (select count(*) from public.pontos)::text || '/' || (select count(*) from public.organization_memberships)::text || '/' || (select count(*) from public.entregas)::text || '/' || (select count(*) from auth.users)::text;
select t.como_cron();
select t.eq('rotina é no-op', t.n('select public.lixeira_rotina()'), 0);
reset role;
select t.eq('nenhum dado apagado (pontos/vínculos/entregas/contas)',
  (select count(*) from public.pontos)::text || '/' || (select count(*) from public.organization_memberships)::text || '/' || (select count(*) from public.entregas)::text || '/' || (select count(*) from auth.users)::text,
  (select valor from t80 where chave = 'linhas_antes'));
select t.eq('nenhum pacote criado', t.n('select count(*) from public.lixeira_pacotes'), 0);
select t.throws('arquivar recusa', format($q$select public._lixeira_arquivar(%L, %L, 'vinculo_encerrado', now())$q$, t.id('clube_b'), t.id('so_b')), 'desligada');
select t.throws('expurgar recusa', $q$select public._lixeira_expurgar(gen_random_uuid())$q$, 'desligada');

select t.como('lider_b');
select t.throws('diretoria não vê a lixeira', format($q$select public.admin_lixeira_listar(%L)$q$, t.id('clube_b')), 'Sem permissão');
reset role;

-- ---- RECUPERAR um pacote que já existia (de antes do desligamento) ----
\o /dev/null
insert into public.lixeira_pacotes (id, club_id, user_id, nome_exibicao, motivo, inativo_desde)
values ('00000000-0000-0000-0000-00000000c080', t.id('clube_b'), t.id('so_b'), 'Pedro B.', 'vinculo_encerrado', now() - interval '400 days');
insert into public.lixeira_linhas (pacote_id, ordem, tabela, dados)
select '00000000-0000-0000-0000-00000000c080', 160, 'pontos', to_jsonb(p) from public.pontos p where p.usuario_id = t.id('so_b') and p.club_id = t.id('clube_b');
delete from public.pontos where usuario_id = t.id('so_b') and club_id = t.id('clube_b');
\o
select t.como('lider_b');
select t.throws('diretoria não recupera', $q$select public.admin_lixeira_recuperar('00000000-0000-0000-0000-00000000c080')$q$, 'Sem permissão');
select t.como('admin80');
select t.eq('admin recupera', t.txt($q$select public.admin_lixeira_recuperar('00000000-0000-0000-0000-00000000c080', 'teste') ->> 'ok'$q$), 'true');
reset role;
select t.eq('ponto guardado voltou', t.n(format($q$select count(*) from public.pontos where usuario_id = %L and motivo = 'ponto so_b'$q$, t.id('so_b'))), 1);
select t.eq('pacote recuperado', t.txt($q$select status from public.lixeira_pacotes where id = '00000000-0000-0000-0000-00000000c080'$q$), 'recuperado');

select t.fim();
rollback;
