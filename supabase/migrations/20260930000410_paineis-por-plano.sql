-- =============================================================================
--  Painéis por plano (28/09): o dono escolhe, no /admin, quais recursos cada plano libera.
--
--  O motor já existia (migration 48): `billing_plans.recursos` é o TETO de módulos do plano
--  (NULL = todos) e entra em `recurso_habilitado_no_clube`, `recursos_do_clube`, nos gatilhos
--  `trg_exigir_recurso` e em `recurso_definir` (201). Faltava só a PORTA do dono, sem SQL.
--
--  Regras:
--    * Só administrador da plataforma altera (`_exigir_admin_plataforma`); cada mudança vai para
--      `platform_admin_audit` com o antes/depois e quantos clubes foram afetados.
--    * Muda a versão do plano NO LUGAR (só a coluna `recursos`; preço, limites e versão ficam).
--      Todo clube com assinatura naquele plano sente a mudança na hora.
--    * REMOVER do plano não apaga nada: `club_features` e os dados do recurso ficam intactos; o
--      recurso só fica inacessível (leitura/escrita barradas pelo servidor, tela escondida).
--      INCLUIR de volta devolve tudo exatamente como estava (inclusive a escolha da diretoria).
--    * Remoção que afeta clube exige confirmação explícita: a 1ª chamada devolve o impacto
--      (`precisa_confirmar`) e não altera nada.
--    * Não remove 'leilao' de plano com leilão ABERTO em clube do plano (mesma regra do 201).
--    * Plano com recursos = NULL ("todos") vira a lista explícita do catálogo ao remover o 1º.
--    * Recurso `somente_plataforma` (especialidades): o plano continua sendo só o teto. Incluir
--      no plano NÃO liga nada no clube — quem liga é `admin_recurso_do_clube_definir`, clube a clube.
-- =============================================================================

-- clubes cuja assinatura vigente está neste plano
create or replace function public._clubes_do_plano(p_plan_id uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.organizational_units o
   where o.type = 'clube'
     and exists (select 1 from public.subscriptions s
                  where s.id = public.assinatura_do_clube_id(o.id) and s.plan_id = p_plan_id);
$$;
revoke all on function public._clubes_do_plano(uuid) from public, anon, authenticated;

create or replace function public._plano_recurso_impacto(p_plan_id uuid, p_feature text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select id from public._clubes_do_plano(p_plan_id) id)
  select jsonb_build_object(
    'recurso', p_feature,
    'clubes_no_plano', (select count(*) from c),
    'clubes_usando', (select count(*) from c where public.recurso_habilitado_no_clube(c.id, p_feature)),
    'leiloes_abertos', case when p_feature = 'leilao' then
        (select count(*) from public.leiloes l where l.status = 'aberto' and l.club_id in (select id from c)) else 0 end,
    'clubes', coalesce((select jsonb_agg(o.nome order by o.nome) from (
        select o.nome from public.organizational_units o where o.id in (select id from c) order by o.nome limit 20) o), '[]'::jsonb));
$$;
revoke all on function public._plano_recurso_impacto(uuid, text) from public, anon, authenticated;

-- a tela: todos os planos com a lista completa do catálogo e o que cada um inclui
create or replace function public.admin_planos_recursos() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'chave', p.chave, 'versao', p.versao, 'nome', p.nome, 'status', p.status, 'ativo', p.ativo,
      'publico', p.publico, 'todos', p.recursos is null,
      'clubes', (select count(*) from public._clubes_do_plano(p.id)),
      'recursos', (select json_agg(json_build_object(
                     'chave', c.chave, 'nome', c.nome, 'descricao', c.descricao, 'icone', c.icone,
                     'somente_plataforma', c.somente_plataforma,
                     'incluido', p.recursos is null or c.chave = any (p.recursos)) order by c.ordem, c.chave)
                   from public.recursos_catalogo c)
    ) order by p.ativo desc, p.chave, p.versao desc)
    from public.billing_plans p), '[]'::json);
end;
$$;
revoke all on function public.admin_planos_recursos() from public, anon;
grant execute on function public.admin_planos_recursos() to authenticated;

create or replace function public.admin_plano_recurso_impacto(p_plan_id uuid, p_feature text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  if not exists (select 1 from public.billing_plans where id = p_plan_id) then raise exception 'Plano não encontrado.'; end if;
  if not exists (select 1 from public.recursos_catalogo where chave = p_feature) then raise exception 'Recurso desconhecido.'; end if;
  return public._plano_recurso_impacto(p_plan_id, p_feature);
end;
$$;
revoke all on function public.admin_plano_recurso_impacto(uuid, text) from public, anon;
grant execute on function public.admin_plano_recurso_impacto(uuid, text) to authenticated;

create or replace function public.admin_plano_recurso_definir(
  p_plan_id uuid, p_feature text, p_incluir boolean, p_confirmar boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_plan record; v_cat record; v_antes text[]; v_depois text[]; v_imp jsonb;
begin
  perform public._exigir_admin_plataforma();
  if p_incluir is null then raise exception 'Informe se o recurso entra ou sai do plano.'; end if;
  select * into v_plan from public.billing_plans where id = p_plan_id for update;
  if not found then raise exception 'Plano não encontrado.'; end if;
  select * into v_cat from public.recursos_catalogo where chave = p_feature;
  if not found then raise exception 'Recurso desconhecido.'; end if;

  v_antes := v_plan.recursos;
  if p_incluir then
    if v_antes is null or p_feature = any (v_antes) then
      return jsonb_build_object('alterado', false, 'incluido', true);
    end if;
    v_depois := array_append(v_antes, p_feature);
  else
    if v_antes is not null and not (p_feature = any (v_antes)) then
      return jsonb_build_object('alterado', false, 'incluido', false);
    end if;
    v_imp := public._plano_recurso_impacto(p_plan_id, p_feature);
    if (v_imp ->> 'leiloes_abertos')::int > 0 then
      raise exception 'Há leilão aberto em clube deste plano: encerre ou cancele antes de tirar o leilão do plano.';
    end if;
    if (v_imp ->> 'clubes_no_plano')::int > 0 and not coalesce(p_confirmar, false) then
      return jsonb_build_object('alterado', false, 'precisa_confirmar', true, 'impacto', v_imp);
    end if;
    v_depois := array_remove(coalesce(v_antes,
                  (select array_agg(c.chave order by c.ordem, c.chave) from public.recursos_catalogo c)), p_feature);
  end if;

  update public.billing_plans set recursos = v_depois where id = p_plan_id;
  perform public._admin_auditar(case when p_incluir then 'plano_recurso_incluido' else 'plano_recurso_removido' end,
    'plano', p_plan_id, jsonb_build_object('plano', v_plan.chave, 'versao', v_plan.versao, 'recurso', p_feature,
      'antes', to_jsonb(v_antes), 'depois', to_jsonb(v_depois),
      'clubes_afetados', coalesce((v_imp ->> 'clubes_no_plano')::int, (select count(*) from public._clubes_do_plano(p_plan_id)))));
  return jsonb_build_object('alterado', true, 'incluido', p_incluir, 'recursos', to_jsonb(v_depois));
end;
$$;
revoke all on function public.admin_plano_recurso_definir(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.admin_plano_recurso_definir(uuid, text, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
