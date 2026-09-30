-- Impressão digital das comprovações ANTIGAS (só colunas que existiam antes da fase 7): rode antes e depois das
-- migrations 510-512 e compare. Nada disso pode mudar. Só leitura.
select 'requirement_submissions' as tabela, count(*) as linhas,
       md5(coalesce(string_agg(x::text, '' order by x::text), '')) as hash
  from (select id, member_requirement_id, tentativa_numero, tipo_evidencia_entregue, evidencia_texto, evidencia_path, enviado_em, usuario_id, club_id from public.requirement_submissions) x
union all
select 'member_requirements', count(*), md5(coalesce(string_agg(x::text, '' order by x::text), ''))
  from (select id, member_class_id, requirement_id, usuario_id, club_id, status, evidencia_texto, evidencia_path, enviado_em from public.member_requirements) x
union all
select 'requirement_approvals', count(*), md5(coalesce(string_agg(x::text, '' order by x::text), ''))
  from (select id, member_requirement_id, member_specialty_requirement_id, decisao, comentario, avaliado_por, avaliado_papel, submission_id, created_at from public.requirement_approvals) x
union all
select 'member_specialty_requirements', count(*), md5(coalesce(string_agg(x::text, '' order by x::text), ''))
  from (select id, member_specialty_id, specialty_requirement_id, usuario_id, club_id, status, evidencia_texto, evidencia_path from public.member_specialty_requirements) x
union all
select 'member_classes', count(*), md5(coalesce(string_agg(x::text, '' order by x::text), ''))
  from (select id, usuario_id, club_id, class_id, status from public.member_classes) x
union all
select 'class_completion_snapshots', count(*), md5(coalesce(string_agg(x::text, '' order by x::text), ''))
  from (select id, conteudo::text from public.class_completion_snapshots) x;
