-- Prioridade 6 (compatibilidade front x migrations) + hardening estrutural:
--   * o front PUBLICADO usa onConflict(desbravador_id,mes,ano) em mensalidades; o
--     front novo pode usar o alvo com club_id — as DUAS formas têm que funcionar
--     antes e depois da migration (nenhum deploy fora de ordem quebra);
--   * ninguém sem login executa RPC; rotinas internas/cron não são chamáveis por usuário;
--   * invariantes de dados (1 clube por pessoa, perfil x vínculo coerentes);
--   * as migrations novas são idempotentes (o SQL é aplicado à mão em produção).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- compat: onConflict do front publicado e do front novo ----------
select t.como('tesoureiro_a');
select t.permitido('upsert do front PUBLICADO: on conflict (desbravador_id, mes, ano)',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
            values (%L, 1, 2026, 55, 'pago', %L)
            on conflict (desbravador_id, mes, ano) do update set valor = excluded.valor, status = excluded.status$q$, t.id('membro_a'), t.id('tesoureiro_a')));
select t.eq('o upsert atualizou a linha existente (sem duplicar)', t.n(format($q$select count(*) from public.mensalidades where desbravador_id = %L and mes = 1 and ano = 2026$q$, t.id('membro_a'))), 1);
select t.eq('...e gravou o valor novo', t.txt(format($q$select valor::text from public.mensalidades where desbravador_id = %L and mes = 1 and ano = 2026$q$, t.id('membro_a'))), '55');
select t.permitido('upsert do front NOVO: on conflict (club_id, desbravador_id, mes, ano)',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
            values (%L, 1, 2026, 58, 'pago', %L)
            on conflict (club_id, desbravador_id, mes, ano) do update set valor = excluded.valor$q$, t.id('membro_a'), t.id('tesoureiro_a')));
select t.eq('...também sem duplicar', t.n(format($q$select count(*) from public.mensalidades where desbravador_id = %L and mes = 1 and ano = 2026$q$, t.id('membro_a'))), 1);
select t.como('lider_b');
select t.permitido('mesmo upsert do front publicado funciona no clube B', format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
            values (%L, 2, 2026, 60, 'pago', %L)
            on conflict (desbravador_id, mes, ano) do update set valor = excluded.valor$q$, t.id('membro_b'), t.id('lider_b')));
select t.bloqueado('...mas o upsert não atravessa clubes (líder B x membro do clube A)', format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por)
            values (%L, 1, 2026, 1, 'pago', %L)
            on conflict (desbravador_id, mes, ano) do update set valor = excluded.valor$q$, t.id('membro_a'), t.id('lider_b')));
reset role;
select t.eq('valor do membro_a não foi alterado pelo líder B', t.txt(format($q$select valor::text from public.mensalidades where desbravador_id = %L and mes = 1 and ano = 2026$q$, t.id('membro_a'))), '58');

-- contrato de resposta que o front novo lê: criar_convite_responsavel devolve token
select t.como('lider_a');
select t.ok('criar_convite_responsavel devolve {token, expires_at}', t.txt('select ((public.criar_convite_responsavel())::jsonb ?& array[''token'',''expires_at''])::text') = 'true');
reset role;

-- ---------- hardening: ACL de funções ----------
select t.eq('nenhuma função do public é chamável por anon (exceto a do cadastro público)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('clube_legado_id')), 0);
select t.ok('clube_legado_id continua chamável por anon (a policy do cadastro precisa)', has_function_privilege('anon', 'public.clube_legado_id()', 'execute'));
select t.eq('nenhuma função do public é PUBLIC-executável (herança do default do Postgres)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proacl is null), 0);
select t.eq('rotinas de cron/internas NÃO são chamáveis por usuário logado',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname in ('fechar_leiloes_vencidos','_leilao_fechar_core','_pontos_temporada_unidade_interno','temporada_inicio_clube',
                        'notif_aniversariantes_hoje','notif_eventos_amanha','premiar_campeao_semana','premiar_melhores_do_dia',
                        'premiar_rodada_semana','lembrar_ausentes','lembrar_jogos_do_dia','progresso_lado',
                        'push_destinatarios','reconciliar_vinculos_perfis','clube_do_usuario')), 0);
select t.eq('toda função SECURITY DEFINER tem search_path fixo',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')), 0);
select t.eq('toda tabela do public tem RLS ligado',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0);

-- ---------- invariantes de dados ----------
select t.eq('ninguém tem vínculo pendente/ativo em 2 clubes',
  (select count(*) from (select m.user_id from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
      where m.status in ('pendente','ativo') group by m.user_id having count(distinct m.organizational_unit_id) > 1) x), 0);
select t.eq('todo perfil tem vínculo de clube',
  (select count(*) from public.profiles p where not exists (select 1 from public.organization_memberships m where m.user_id = p.id)), 0);
select t.eq('o papel do vínculo bate com o papel do perfil',
  (select count(*) from public.profiles p join public.organization_memberships m on m.user_id = p.id
    where m.status in ('pendente','ativo') and m.role <> p.papel), 0);
select t.eq('o status do vínculo bate com o status do perfil (ativo/pendente)',
  (select count(*) from public.profiles p join public.organization_memberships m on m.user_id = p.id
    where p.status in ('ativo','pendente') and m.status <> p.status), 0);
select t.eq('a unidade de cada perfil é do mesmo clube do vínculo',
  (select count(*) from public.profiles p join public.unidades u on u.id = p.unidade_id
    join public.organization_memberships m on m.user_id = p.id and m.status in ('pendente','ativo')
    where u.club_id <> m.organizational_unit_id), 0);
select t.eq('todo vínculo tem papel do vocabulário oficial',
  (select count(*) from public.organization_memberships where role not in ('desbravador','conselheiro','instrutor','diretoria','tesoureiro','pais')), 0);

-- ---------- idempotência: reaplicar as migrations novas não pode quebrar nem duplicar ----------
select count(*) as vinculos_antes, (select count(*) from public.club_features) as feats_antes from public.organization_memberships \gset
\i /tmp/cq_migrations/20260921000013_papeis-vinculos-e-escopo-legado.sql
\i /tmp/cq_migrations/20260921000014_rls-por-clube-e-blindagem-de-responsaveis.sql
\i /tmp/cq_migrations/20260921000015_leilao-cron-e-escopo.sql
\i /tmp/cq_migrations/20260921000016_isolamento-de-rpcs-e-storage.sql
\i /tmp/cq_migrations/20260921000017_convites-e-push-por-clube.sql
select t.eq('reaplicar as migrations não muda a quantidade de vínculos', (select count(*) from public.organization_memberships), :'vinculos_antes'::bigint);
select t.eq('reaplicar as migrations não muda os recursos do clube', (select count(*) from public.club_features), :'feats_antes'::bigint);

select t.fim();
rollback;
