// Compartilhado por scripts/restaurar-staging.mjs (item 8) e scripts/drill-migration.mjs (item 9).
// ---------------------------------------------------------------------------
//  O MANIFESTO: o que PRECISA voltar, contado fora da RLS. É calculado igual na origem e no
//  destino, e as duas saídas são comparadas campo a campo.
// ---------------------------------------------------------------------------
export const MANIFESTO_SQL = `
select json_build_object(
  'migracao',        (select max(version) from supabase_migrations.schema_migrations),
  'contas',          (select count(*) from auth.users),
  'identidades_auth',(select count(*) from auth.identities),
  'vinculos_ativos', (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select organizational_unit_id, count(*) n from public.organization_memberships where status = 'ativo' group by 1) x
                       join public.organizational_units u on u.id = x.organizational_unit_id),
  'pessoas_multiclube', (select count(*) from (select m.user_id from public.organization_memberships m
                       join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
                       where m.status = 'ativo' group by 1 having count(*) > 1) y),
  'pontos',          (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select club_id, sum(pontos) n from public.pontos group by 1) x join public.organizational_units u on u.id = x.club_id),
  'mensalidades',    (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select club_id, count(*) n from public.mensalidades group by 1) x join public.organizational_units u on u.id = x.club_id),
  'fotos',           (select coalesce(json_object_agg(u.nome, x.n order by u.nome), '{}') from
                       (select club_id, count(*) n from public.fotos group by 1) x join public.organizational_units u on u.id = x.club_id),
  'matriculas',      (select coalesce(json_object_agg(status, n order by status), '{}') from (select status, count(*) n from public.member_classes group by 1) x),
  'requisitos_aprovados', (select count(*) from public.member_requirements where status = 'aprovado'),
  'documentos',      (select count(*) from public.class_documents),
  'objetos_storage', (select coalesce(json_object_agg(bucket_id, n order by bucket_id), '{}') from (select bucket_id, count(*) n from storage.objects group by 1) x),
  'cron_jobs',       (select count(*) from cron.job),
  'policies',        (select count(*) from pg_policies where schemaname = 'public'),
  'funcoes',         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  'gatilhos',        (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and not t.tgisinternal),
  'tabelas_com_rls', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)
);`
