-- Migrations 220/221: limite de membros ajustável por clube (admin da plataforma) e lixeira de
-- membros inativos/que saíram (dry-run, mover, recuperar, expurgo com retenção).
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
         'admin_lixeira_config()','admin_lixeira_config_definir(text, int, int, int)','admin_lixeira_clube_modo(uuid, text)',
         'admin_lixeira_listar(uuid)','admin_lixeira_simular(uuid)','admin_lixeira_recuperar(uuid, text)','lixeira_rotina()']) f
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

-- ============================ 2) LIXEIRA ============================
\o /dev/null
update public.organization_memberships set status = 'encerrado' where user_id in (t.id('saiu_b'), t.id('so_b'), t.id('recente_b')) and organizational_unit_id = t.id('clube_b');
update public.organization_memberships set status = 'encerrado' where user_id = t.id('velho_a') and organizational_unit_id = t.id('clube_a');
\o
select t.ok('gatilho grava inativo_desde ao encerrar',
  (select inativo_desde is not null from public.organization_memberships where user_id = t.id('saiu_b') and organizational_unit_id = t.id('clube_b')));
\o /dev/null
update public.organization_memberships set inativo_desde = now() - interval '61 days' where user_id in (t.id('saiu_b'), t.id('so_b')) and organizational_unit_id = t.id('clube_b');
update public.organization_memberships set inativo_desde = now() - interval '30 days' where user_id = t.id('recente_b') and organizational_unit_id = t.id('clube_b');
update public.organization_memberships set inativo_desde = now() - interval '400 days' where user_id = t.id('velho_a') and organizational_unit_id = t.id('clube_a');
\o
select t.eq('padrão global = dry_run', (select modo from public.lixeira_config), 'dry_run');
select t.eq('Tenant 001 nasce com modo próprio dry_run', (select modo from public.lixeira_config_clube where club_id = t.id('clube_a')), 'dry_run');

-- ---- 2a) DRY-RUN: só marca ----
insert into t80 select 'linhas_antes', (select count(*) from public.pontos)::text || '/' || (select count(*) from public.organization_memberships)::text || '/' || (select count(*) from public.entregas)::text;
select t.como_cron();
select public.lixeira_rotina() > 0;
select t.eq('dry-run NÃO altera nada (pontos/vínculos/entregas)',
  (select count(*) from public.pontos)::text || '/' || (select count(*) from public.organization_memberships)::text || '/' || (select count(*) from public.entregas)::text,
  (select valor from t80 where chave = 'linhas_antes'));
select t.eq('dry-run não cria pacote', t.n('select count(*) from public.lixeira_pacotes'), 0);
select t.eq('dry-run marca quem saiu há 60+ dias no B (saiu_b, so_b)',
  t.n(format($q$select count(*) from public.lixeira_marcacoes where club_id = %L$q$, t.id('clube_b'))), 2);
select t.eq('quem saiu há 30 dias não é marcado',
  t.n(format($q$select count(*) from public.lixeira_marcacoes where user_id = %L$q$, t.id('recente_b'))), 0);
select t.eq('nome aparece mascarado', (select nome_exibicao from public.lixeira_marcacoes where user_id = t.id('saiu_b')), 'Joana P.');
select t.eq('Tenant 001 marcado (velho_a) mas intacto',
  t.n(format($q$select count(*) from public.lixeira_marcacoes where user_id = %L$q$, t.id('velho_a'))), 1);

-- ---- 2b) só admin configura / vê ----
select t.como('lider_b');
select t.throws('diretoria não vê a lixeira', format($q$select public.admin_lixeira_listar(%L)$q$, t.id('clube_b')), 'Sem permissão');
select t.throws('diretoria não liga a rotina', format($q$select public.admin_lixeira_clube_modo(%L, 'ativo')$q$, t.id('clube_b')), 'Sem permissão');
select t.throws('diretoria não muda a config', $q$select public.admin_lixeira_config_definir('ativo')$q$, 'Sem permissão');
select t.como('admin80');
select t.eq('admin vê as marcações do B',
  t.n(format($q$select json_array_length(public.admin_lixeira_listar(%L) -> 'marcacoes')$q$, t.id('clube_b'))), 2);
select t.throws('Tenant 001 não pode ficar sem modo próprio', format($q$select public.admin_lixeira_clube_modo(%L, null)$q$, t.id('clube_a')), 'fundador');
-- global vai para ATIVO: o Tenant 001 continua em dry-run (só muda quando ligado explicitamente)
select t.permitido('admin liga o modo global ativo', $q$select public.admin_lixeira_config_definir('ativo')$q$);
reset role;
select t.ok('auditoria da config', exists (select 1 from public.platform_admin_audit where acao = 'lixeira_config'));

-- ---- 2c) ATIVO: move para a lixeira ----
select t.como_cron();
select public.lixeira_rotina() > 0;
select t.eq('pontos do saiu_b no B foram para a lixeira',
  t.n(format($q$select count(*) from public.pontos where usuario_id = %L and club_id = %L$q$, t.id('saiu_b'), t.id('clube_b'))), 0);
select t.eq('...os do clube A ficaram', t.n(format($q$select count(*) from public.pontos where usuario_id = %L and club_id = %L$q$, t.id('saiu_b'), t.id('clube_a'))), 1);
select t.eq('vínculo do B saiu da tabela', t.n(format($q$select count(*) from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('saiu_b'), t.id('clube_b'))), 0);
select t.eq('vínculo do A intacto (ativo)', t.txt(format($q$select status from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('saiu_b'), t.id('clube_a'))), 'ativo');
select t.eq('registro imutável foi junto', t.n(format($q$select count(*) from public.class_completion_events where usuario_id = %L$q$, t.id('saiu_b'))), 0);
select t.eq('entrega do B foi, a do A ficou', t.n(format($q$select count(*) from public.entregas where usuario_id = %L$q$, t.id('saiu_b'))), 1);
select t.eq('2 pacotes na lixeira do B', t.n(format($q$select count(*) from public.lixeira_pacotes where club_id = %L and status = 'na_lixeira'$q$, t.id('clube_b'))), 2);
select t.eq('foto de comprovação do B marcada (1), a do A não',
  t.txt(format($q$select storage::text from public.lixeira_pacotes where user_id = %L$q$, t.id('saiu_b'))),
  jsonb_build_array(jsonb_build_object('bucket', 'imagens', 'name', t.id('clube_b')::text || '/comprovacoes/saiu-b.jpg'))::text);
select t.eq('...e o arquivo ainda existe (só marcado)', t.n(format($q$select count(*) from storage.objects where name = %L$q$, t.id('clube_b')::text || '/comprovacoes/saiu-b.jpg')), 1);
select t.eq('Tenant 001 (dry-run próprio) NÃO moveu ninguém',
  t.n(format($q$select count(*) from public.organization_memberships where user_id = %L$q$, t.id('velho_a'))), 1);
select t.eq('...e nenhum pacote no Tenant 001', t.n(format($q$select count(*) from public.lixeira_pacotes where club_id = %L$q$, t.id('clube_a'))), 0);
select t.eq('recente_b continua', t.n(format($q$select count(*) from public.organization_memberships where user_id = %L$q$, t.id('recente_b'))), 1);
select t.ok('arquivamento auditado (rotina)', exists (select 1 from public.platform_admin_audit where acao = 'lixeira_arquivar' and admin_user_id is null));

-- ---- 2d) RECUPERAR ----
insert into t80 select 'pac_saiu', id::text from public.lixeira_pacotes where user_id = t.id('saiu_b');
select t.como('lider_b');
select t.throws('diretoria não recupera', format($q$select public.admin_lixeira_recuperar(%L)$q$, (select valor from t80 where chave = 'pac_saiu')), 'Sem permissão');
select t.como('admin80');
select t.eq('admin lista o pacote com data prevista de expurgo',
  t.n(format($q$select count(*) from json_array_elements(public.admin_lixeira_listar(%L) -> 'pacotes') p where p ->> 'expurgo_previsto_em' is not null$q$, t.id('clube_b'))), 2);
select t.eq('admin recupera', t.txt(format($q$select public.admin_lixeira_recuperar(%L, 'pedido da diretoria') ->> 'ok'$q$, (select valor from t80 where chave = 'pac_saiu'))), 'true');
reset role;
select t.eq('pontos voltaram', t.n(format($q$select count(*) from public.pontos where usuario_id = %L and club_id = %L$q$, t.id('saiu_b'), t.id('clube_b'))), 1);
select t.eq('entrega voltou (com a foto)', t.n(format($q$select count(*) from public.entregas where usuario_id = %L and foto_url like '%%saiu-b.jpg%%'$q$, t.id('saiu_b'))), 1);
select t.eq('imutável voltou', t.n(format($q$select count(*) from public.class_completion_events where usuario_id = %L and observacao = 'evento saiu_b'$q$, t.id('saiu_b'))), 1);
select t.eq('vínculo voltou INATIVO (encerrado)', t.txt(format($q$select status from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('saiu_b'), t.id('clube_b'))), 'encerrado');
select t.eq('pacote recuperado e linhas liberadas', t.txt(format($q$select status || '/' || (select count(*) from public.lixeira_linhas where pacote_id = %L) from public.lixeira_pacotes where id = %L$q$,
  (select valor from t80 where chave = 'pac_saiu'), (select valor from t80 where chave = 'pac_saiu'))), 'recuperado/0');
select t.ok('recuperação auditada', exists (select 1 from public.platform_admin_audit where acao = 'lixeira_recuperar' and admin_user_id = t.id('admin80')));
select t.como_cron();
select public.lixeira_rotina() > 0;
select t.eq('recuperado não volta para a lixeira na rodada seguinte (carência)',
  t.n(format($q$select count(*) from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$, t.id('saiu_b'), t.id('clube_b'))), 1);

-- ---- 2e) EXPURGO respeita a retenção ----
\o /dev/null
delete from public.lixeira_poupados;
update public.organization_memberships set inativo_desde = now() - interval '61 days' where user_id = t.id('saiu_b') and organizational_unit_id = t.id('clube_b');
select public.lixeira_rotina();
update public.lixeira_pacotes set arquivado_em = now() - interval '89 days' where club_id = t.id('clube_b') and status = 'na_lixeira';
select public.lixeira_rotina();
\o
select t.eq('com 89 dias na lixeira (retenção 90): nada expurgado',
  t.n(format($q$select count(*) from public.lixeira_pacotes where club_id = %L and status = 'na_lixeira'$q$, t.id('clube_b'))), 2);
select t.como('admin80');
select t.permitido('admin reduz a retenção para 30 dias', $q$select public.admin_lixeira_config_definir(null, null, 30)$q$);
select t.como_cron();
select public.lixeira_rotina() > 0;
select t.eq('com a retenção vencida: os 2 pacotes expurgados',
  t.n(format($q$select count(*) from public.lixeira_pacotes where club_id = %L and status = 'expurgado'$q$, t.id('clube_b'))), 2);
select t.eq('linhas guardadas apagadas', t.n('select count(*) from public.lixeira_linhas'), 0);
select t.eq('foto de comprovação do B apagada do Storage', t.n(format($q$select count(*) from storage.objects where name = %L$q$, t.id('clube_b')::text || '/comprovacoes/saiu-b.jpg')), 0);
select t.eq('foto do clube A intacta', t.n(format($q$select count(*) from storage.objects where name = %L$q$, t.id('clube_a')::text || '/comprovacoes/saiu-a.jpg')), 1);
select t.eq('conta de saiu_b (vínculo no A) mantida', t.n(format($q$select count(*) from auth.users where id = %L$q$, t.id('saiu_b'))), 1);
select t.eq('...e os dados dela no A intactos', t.n(format($q$select count(*) from public.pontos where usuario_id = %L and club_id = %L$q$, t.id('saiu_b'), t.id('clube_a'))), 1);
select t.eq('conta de so_b (sem outro vínculo) removida', t.n(format($q$select count(*) from auth.users where id = %L$q$, t.id('so_b'))), 0);
select t.eq('pacote expurgado sem nome', t.n('select count(*) from public.lixeira_pacotes where status = ''expurgado'' and nome_exibicao is not null'), 0);
select t.ok('expurgo auditado', exists (select 1 from public.platform_admin_audit where acao = 'lixeira_expurgar'));
select t.ok('execuções registradas', (select count(*) from public.lixeira_execucoes where club_id = t.id('clube_b')) >= 4);

-- ---- 2f) regra de "sem login" começa desligada; ligada, não pega diretoria ----
select t.eq('sem_login desligado por padrão', t.txt('select coalesce(sem_login_dias::text, ''desligado'') from public.lixeira_config'), 'desligado');
\o /dev/null
update public.lixeira_config set sem_login_dias = 90;
update auth.users set last_sign_in_at = now() - interval '200 days', created_at = now() - interval '300 days' where id in (t.id('membro_b'), t.id('lider_b'));
\o
select t.ok('com a regra ligada: membro sem login é candidato',
  exists (select 1 from public._lixeira_candidatos(t.id('clube_b')) where user_id = t.id('membro_b') and motivo = 'sem_login'));
select t.ok('...diretoria nunca', not exists (select 1 from public._lixeira_candidatos(t.id('clube_b')) where user_id = t.id('lider_b')));

select t.fim();
rollback;
