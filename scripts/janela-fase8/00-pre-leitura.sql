-- JANELA FASE 8 — LEITURA (somente leitura; rode ANTES de cada migration e depois, e compare). Não imprime dados pessoais: só contagens/hashes.
\set ON_ERROR_STOP on
begin read only;
select 'ledger_max' as item, max(version) as valor from supabase_migrations.schema_migrations;
select 'ledger_total' as item, count(*)::text as valor from supabase_migrations.schema_migrations;
select 'ledger_514_527' as item, coalesce(string_agg(version, ',' order by version), 'nenhuma') as valor from supabase_migrations.schema_migrations where version between '20260930000514' and '20260930000527';
-- manutenção (se ligada, as escritas ficam bloqueadas)
select 'manutencao' as item, coalesce((select (to_jsonb(m)->>'ativo') from public.plataforma_manutencao m limit 1), 'tabela/linha ausente') as valor;
-- vínculos por papel/status (todos os clubes) e Tenant 001
select 'memberships_status_' || status as item, count(*)::text as valor from public.organization_memberships group by status order by 1;
select 'tenant001_memberships_' || m.role || '_' || m.status as item, count(*)::text as valor
  from public.organization_memberships m join public.organizational_units o on o.id = m.organizational_unit_id and o.slug = 'filhos-da-conquista' group by m.role, m.status order by 1;
-- matrículas por versão/status (sem nomes de pessoas)
select 'matriculas_' || v.versao || '_' || mc.status as item, count(*)::text as valor
  from public.member_classes mc join public.classes c on c.id = mc.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id group by v.versao, mc.status order by 1;
-- conquistas (tabela pode ganhar colunas nas migrations; só contagens)
select 'conquistas_classe_total' as item, count(*)::text as valor from public.curriculum_achievements where tipo = 'classe';
select 'conquistas_classe_ativas' as item, count(*)::text as valor from public.curriculum_achievements where tipo = 'classe' and status = 'ativa';
-- Storage por bucket (contagem e bytes)
select 'storage_' || bucket_id as item, count(*)::text || ' obj / ' || coalesce(sum((metadata->>'size')::bigint), 0)::text || ' bytes' as valor from storage.objects group by bucket_id order by 1;
-- sem nascimento (impacto da regra da 519) e matrícula em versão arquivada (impacto da 523)
select 'ativos_sem_nascimento' as item, count(distinct m.user_id)::text as valor
  from public.organization_memberships m join public.profiles p on p.id = m.user_id
 where m.status = 'ativo' and m.role <> 'pais' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()) and p.nascimento is null;
select 'matriculas_versao_arquivada' as item, count(*)::text as valor
  from public.member_classes mc join public.classes c on c.id = mc.class_id join public.curriculum_versions v on v.id = c.curriculum_version_id where mc.status <> 'cancelada' and v.status <> 'publicado';
-- sessões/locks longos que atrapalhariam um lock_timeout de 5 s
select 'transacoes_abertas_ha_mais_de_30s' as item, count(*)::text as valor from pg_stat_activity where state <> 'idle' and xact_start < now() - interval '30 seconds' and pid <> pg_backend_pid();
commit;
