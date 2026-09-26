-- =============================================================================
--  /admin: a listagem de clubes passa a devolver a MARCA pública do clube (logo, sigla, cor) e o
--  teto de membros do plano, para o painel mostrar a logo de cada clube e "membros x limite".
--
--  Mudança mínima sobre a 103: mesma função, mesmas colunas, mesma checagem
--  _exigir_admin_plataforma(), mesmo security definer/search_path. Só ACRESCENTA campos:
--    logo_url, sigla, cor_primaria  -> metadata.marca (já é público: aparece no convite/inscrição)
--    membros_limite                 -> plano_limite(clube, 'membros') (null = sem limite)
--    vinculado_a_nome/_tipo         -> unidade-mãe (região/distrito/associação), só o nome
--  Nenhum dado de pessoa. admin_clube_detalhe reaproveita esta função e herda os campos.
-- =============================================================================

create or replace function public.admin_clubes_listar() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(c order by c.criado_em desc) from (
    select o.id as club_id, o.nome, o.slug, o.status, o.created_at as criado_em,
           a.assinatura_id, a.assinatura_status, a.ciclo, a.trial_ate, a.periodo_fim, a.provider,
           a.plano_chave, a.plano_versao, a.plano_nome,
           coalesce(u.bytes, 0) as armazenamento_bytes, coalesce(u.objetos, 0) as armazenamento_objetos,
           lim.mb as armazenamento_limite_mb,
           case when lim.mb > 0 then round(coalesce(u.bytes, 0) * 100.0 / (lim.mb * 1048576), 1) end as armazenamento_pct,
           public._admin_situacao_armazenamento(coalesce(u.bytes, 0), lim.mb) as armazenamento_situacao,
           public.limite_uso(o.id, 'membros') as membros,
           ob.status as onboarding_status, ob.etapa as onboarding_etapa,
           coalesce(ps.status, 'nao_verificado') as provisionamento,
           -- 240: marca pública + teto de membros + unidade-mãe
           nullif(o.metadata #>> '{marca,logo_url}', '') as logo_url,
           nullif(o.metadata #>> '{marca,sigla}', '') as sigla,
           nullif(o.metadata #>> '{marca,cor_primaria}', '') as cor_primaria,
           public.plano_limite(o.id, 'membros') as membros_limite,
           pai.nome as vinculado_a_nome, pai.type as vinculado_a_tipo
      from public.organizational_units o
      left join public.organizational_units pai on pai.id = o.parent_id
      left join lateral (
        select s.id as assinatura_id, s.status as assinatura_status, s.ciclo, s.trial_ate, s.periodo_fim, s.provider,
               p.chave as plano_chave, p.versao as plano_versao, p.nome as plano_nome
          from public.subscription_clubs sc
          join public.subscriptions s on s.id = sc.subscription_id
          join public.billing_plans p on p.id = s.plan_id
         where sc.club_id = o.id
         order by (s.status = 'cancelada'), s.created_at desc limit 1) a on true
      left join public.club_storage_uso u on u.club_id = o.id
      left join lateral (select public.plano_limite(o.id, 'armazenamento_mb') as mb) lim on true
      left join lateral (select os.status, os.etapa from public.onboarding_sessions os
                          where os.club_id = o.id order by os.created_at desc limit 1) ob on true
      left join public.club_provisioning_status ps on ps.club_id = o.id
     where o.type = 'clube') c), '[]'::json);
end;
$$;

revoke all on function public.admin_clubes_listar() from public, anon;
grant execute on function public.admin_clubes_listar() to authenticated;

notify pgrst, 'reload schema';
