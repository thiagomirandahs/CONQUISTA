-- Impressão digital do TENANT 001 (só leitura; rode antes e depois de uma migration/deploy e compare).
-- Cada linha: tabela | linhas | hash das colunas ESTÁVEIS (nada de updated_at). Se a tabela não existir, pula.
with t as (
  select id from public.organizational_units where slug = 'filhos-da-conquista'
)
select 'tenant001_ativo' as item, (select (select count(*) from t))::text as linhas, '' as hash
union all select 'vinculos_ativos', (select count(*)::text from public.organization_memberships m, t where m.organizational_unit_id = t.id and m.status = 'ativo'), ''
union all select 'memberships', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), ''))
  from (select m.id, m.user_id, m.role, m.status, m.unidade_id from public.organization_memberships m, t where m.organizational_unit_id = t.id) x
union all select 'perfis', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, papel, status, unidade_id from public.profiles) x
union all select 'unidades', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, nome, club_id from public.unidades) x
union all select 'mensalidades', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select * from public.mensalidades) x
union all select 'club_features', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select club_id, feature, enabled from public.club_features) x
union all select 'member_classes', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, usuario_id, club_id, class_id, status from public.member_classes) x
union all select 'member_requirements', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, member_class_id, requirement_id, usuario_id, club_id, status, evidencia_texto, evidencia_path, enviado_em from public.member_requirements) x
union all select 'requirement_submissions', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, enviado_em, usuario_id, club_id from public.requirement_submissions) x
union all select 'requirement_approvals', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, member_requirement_id, member_specialty_requirement_id, decisao, comentario, avaliado_por, avaliado_papel, submission_id, created_at from public.requirement_approvals) x
union all select 'member_specialty_requirements', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, member_specialty_id, specialty_requirement_id, usuario_id, club_id, status, evidencia_texto, evidencia_path from public.member_specialty_requirements) x
union all select 'class_completion_snapshots', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, conteudo::text from public.class_completion_snapshots) x
union all select 'classes_catalogo', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, curriculum_version_id, codigo, manifesto_id from public.classes) x
union all select 'class_requirements', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, section_id, codigo, descricao, tipo_evidencia, evidencia_obrigatoria, manifesto_id from public.class_requirements) x
union all select 'storage_' || bucket_id, count(*)::text, md5(coalesce(string_agg(name, '' order by name), '')) from storage.objects group by bucket_id
union all select 'storage_buckets', count(*)::text, md5(coalesce(string_agg(x::text, '' order by x::text), '')) from (select id, public from storage.buckets) x
order by 1;
