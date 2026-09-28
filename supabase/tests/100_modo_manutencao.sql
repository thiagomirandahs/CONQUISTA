-- Migration 400: MODO MANUTENÇÃO.
-- Prova: só o admin da plataforma liga/desliga/agenda; toda mudança fica na auditoria; com a
-- manutenção ligada a escrita de usuário comum é RECUSADA (tabela e Storage) e nada muda; o admin
-- continua operando; cron/service_role passam; anônimo só LÊ o estado (e não vê quem ligou).
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.classe(p text) returns uuid language sql stable security definer as $$
  select c.id from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.manifesto_id = p $$;

select t.signup('admin_saas', '{"tipo":"fundador","nome":"Admin da Plataforma"}'::jsonb);
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_saas'), 'operacao', 'bootstrap de teste');

-- ---------- estado inicial ----------
select t.como_anon();
select t.eq('anon lê o estado: desligado', (public.manutencao_estado() ->> 'ativo'), 'false');
select t.eq('anon não é admin', (public.manutencao_estado() ->> 'sou_admin'), 'false');
select t.ok('o estado público não expõe quem ligou', not (public.manutencao_estado() ? 'atualizado_por'));
select t.throws('anon NÃO liga a manutenção', 'select public.admin_manutencao_definir(true)', 'permission denied');
select t.eq('anon não lê a tabela direto', t.nv('select count(*) from public.plataforma_manutencao'), 0);
select t.throws('anon não altera a tabela direto', 'update public.plataforma_manutencao set ativo = true', 'permission denied');

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('membro comum NÃO liga a manutenção', 'select public.admin_manutencao_definir(true)', 'Sem permissão');
select t.throws('diretor de clube NÃO liga a manutenção', format('select t.como(%L); select public.admin_manutencao_definir(true)', t.id('lider_a')), 'Sem permissão');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.permitido('antes da manutenção o membro escreve normalmente',
  format('update public.profiles set nome = nome where id = %L', t.id('membro_a')));

-- ---------- aviso prévio ----------
select t.como('admin_saas');
select public.admin_manutencao_definir(false, null, now() + interval '30 minutes', 'Atualização das Classes');
select t.como('membro_a');
select t.ok('com aviso agendado todos veem o horário', (public.manutencao_estado() ->> 'aviso_inicio') is not null);
select t.eq('...e a mensagem do aviso', public.manutencao_estado() ->> 'aviso_mensagem', 'Atualização das Classes');
select t.permitido('aviso NÃO bloqueia escrita (só avisa)',
  format('update public.profiles set nome = nome where id = %L', t.id('membro_a')));

-- ---------- liga ----------
select t.como('admin_saas');
select t.eq('admin liga a manutenção', (public.admin_manutencao_definir(true, 'Voltamos às 22h') ->> 'ativo'), 'true');
select t.eq('admin vê sou_admin', (public.manutencao_estado() ->> 'sou_admin'), 'true');
select t.como_anon();
select t.eq('anon vê manutenção ligada', (public.manutencao_estado() ->> 'ativo'), 'true');
select t.eq('...com a mensagem da tela', public.manutencao_estado() ->> 'mensagem', 'Voltamos às 22h');
select t.ok('ligar limpa o aviso prévio', (public.manutencao_estado() ->> 'aviso_inicio') is null);

select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.throws('com manutenção ligada a escrita do membro é RECUSADA',
  format('update public.profiles set nome = %L where id = %L', 'Mudado', t.id('membro_a')), 'MANUTENCAO');
select t.throws('...inclusive dentro de RPC security definer (a guarda vale para o comando, não para o papel do dono)',
  format('select public.classe_iniciar(%L)', t.classe('amigo')), 'MANUTENCAO');
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.throws('diretoria também é recusada', format('update public.profiles set nome = nome where id = %L', t.id('lider_a')), 'MANUTENCAO');
select t.como('membro_a'); select t.pedir_clube('clube_a');
select t.bloqueado('upload no Storage recusado (policy restritiva)',
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('comprovacoes', %L, %L)$q$,
         t.id('membro_a')::text || '/manut.jpg', t.id('membro_a')::text));
reset role;
select t.eq('...nem a classe foi iniciada', (select count(*) from public.member_classes where usuario_id = t.id('membro_a') and club_id = t.id('clube_a')), 0);
select t.eq('...e o arquivo não entrou', (select count(*) from storage.objects where name = t.id('membro_a')::text || '/manut.jpg'), 0);
select t.eq('nada mudou no perfil do membro', (select nome from public.profiles where id = t.id('membro_a')) <> 'Mudado', true);

select t.como('admin_saas');
select t.permitido('admin da plataforma continua escrevendo (para testar)',
  format('update public.profiles set nome = nome where id = %L', t.id('admin_saas')));

select t.como_cron();
select t.permitido('pg_cron (sem JWT) segue rodando', format('update public.profiles set nome = nome where id = %L', t.id('membro_a')));
select t.como_service();
select t.eq('service_role (Edge Function) não é bloqueado', public._manutencao_bloqueia_usuario(), false);

-- ---------- desliga ----------
select t.como('admin_saas');
select t.eq('admin desliga', (public.admin_manutencao_definir(false) ->> 'ativo'), 'false');
select t.como('membro_a');
select t.permitido('desligada, o membro volta a escrever',
  format('update public.profiles set nome = nome where id = %L', t.id('membro_a')));

-- ---------- auditoria ----------
reset role;
select t.eq('auditoria: agendar + ligar + desligar = 3 registros',
  (select count(*) from public.platform_admin_audit where alvo_tipo = 'plataforma_manutencao'), 3);
select t.eq('auditoria: um "manutencao_ligar" feito pelo admin',
  (select count(*) from public.platform_admin_audit where acao = 'manutencao_ligar' and admin_user_id = t.id('admin_saas')), 1);
select t.eq('auditoria: um "manutencao_desligar"',
  (select count(*) from public.platform_admin_audit where acao = 'manutencao_desligar'), 1);

-- ---------- gate permanente ----------
select t.eq('toda tabela de public tem a guarda (fora as exceções declaradas)',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
      and c.relname not in ('plataforma_manutencao','platform_admin_audit','app_erros','entrada_tentativas_publicas',
                            'entrada_tentativas','vitrine_acessos_publicos','push_tentativas')
      and not exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 'zz_manutencao_guarda')), 0);
select t.eq('Storage tem as 3 policies restritivas de manutenção',
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'manutencao:%' and permissive = 'RESTRICTIVE'), 3);
select t.ok('anon executa manutencao_estado', has_function_privilege('anon', 'public.manutencao_estado()', 'execute'));
select t.ok('anon NÃO executa admin_manutencao_definir',
  not has_function_privilege('anon', 'public.admin_manutencao_definir(boolean,text,timestamptz,text)', 'execute'));
select t.ok('ninguém de fora executa a guarda/instalador',
  not has_function_privilege('authenticated', 'public._manutencao_instalar_guarda()', 'execute')
  and not has_function_privilege('anon', 'public._manutencao_guarda()', 'execute'));

select t.fim();
rollback;
