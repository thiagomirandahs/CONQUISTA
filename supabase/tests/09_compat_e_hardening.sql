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
select t.eq('nenhuma função do public é chamável por anon (exceto o cadastro público e a verificação pública de documento)',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('clube_legado_id', 'documento_verificar')), 0);
select t.ok('clube_legado_id continua chamável por anon (a policy do cadastro precisa)', has_function_privilege('anon', 'public.clube_legado_id()', 'execute'));
select t.ok('documento_verificar é chamável por anon (verificação pública por token; só o resumo mínimo)', has_function_privilege('anon', 'public.documento_verificar(text)', 'execute'));
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
-- "1 vínculo por pessoa" saiu nesta fase (múltiplos clubes é o ponto da migration 34) — as 3
-- checagens de perfil x vínculo agora comparam com o clube PRIMÁRIO da pessoa (o único que
-- profiles espelha), não com QUALQUER vínculo (ver 27_multiclube_real.sql pra cobertura real
-- de gente em 2+ clubes com papel/unidade diferentes).
select t.eq('todo perfil tem vínculo de clube',
  (select count(*) from public.profiles p where not exists (select 1 from public.organization_memberships m where m.user_id = p.id)), 0);
select t.eq('o papel do vínculo PRIMÁRIO bate com o papel do perfil',
  (select count(*) from public.profiles p join public.organization_memberships m
     on m.user_id = p.id and m.organizational_unit_id = public.clube_primario_do_usuario(p.id)
    where m.status in ('pendente','ativo') and m.role <> p.papel), 0);
select t.eq('o status do vínculo PRIMÁRIO bate com o status do perfil (ativo/pendente)',
  (select count(*) from public.profiles p join public.organization_memberships m
     on m.user_id = p.id and m.organizational_unit_id = public.clube_primario_do_usuario(p.id)
    where p.status in ('ativo','pendente') and m.status <> p.status), 0);
select t.eq('a unidade de cada perfil é do mesmo clube do vínculo PRIMÁRIO',
  (select count(*) from public.profiles p join public.unidades u on u.id = p.unidade_id
    join public.organization_memberships m
      on m.user_id = p.id and m.organizational_unit_id = public.clube_primario_do_usuario(p.id) and m.status in ('pendente','ativo')
    where u.club_id <> m.organizational_unit_id), 0);
select t.eq('todo vínculo tem papel do vocabulário oficial',
  (select count(*) from public.organization_memberships where role not in ('desbravador','conselheiro','instrutor','diretoria','tesoureiro','pais')), 0);

-- ---------- idempotência: reaplicar as migrations novas não pode quebrar nem duplicar ----------
-- Reaplicar a 13 (que recria o gatilho "1 clube por pessoa") DENTRO desta transação ressuscita
-- por um instante uma regra que as migrations mais novas (34) já removeram; os fixtures de
-- multi-clube (t.mk2) não existiam quando essa regra valia, então saem daqui antes do replay —
-- a cobertura deles é 27_multiclube_real.sql, não este teste de idempotência.
delete from public.organization_memberships m
 using public.organization_memberships m2
 where m.user_id = m2.user_id and m.organizational_unit_id <> m2.organizational_unit_id and m.ctid > m2.ctid;
select count(*) as vinculos_antes, (select count(*) from public.club_features) as feats_antes from public.organization_memberships \gset
-- a lista sai da PASTA: da 13 em diante, toda migration nova entra sozinha neste teste
\o /dev/null
\! ls /tmp/cq_migrations/2026092100001[3-9]_*.sql /tmp/cq_migrations/202609210000[2-9][0-9]_*.sql | sort | sed 's/^/\\i /' > /tmp/cq_reapply.sql
\o
\i /tmp/cq_reapply.sql
select t.eq('reaplicar as migrations não muda a quantidade de vínculos', (select count(*) from public.organization_memberships), :'vinculos_antes'::bigint);
select t.eq('reaplicar as migrations não muda os recursos do clube', (select count(*) from public.club_features), :'feats_antes'::bigint);

select t.fim();
rollback;
