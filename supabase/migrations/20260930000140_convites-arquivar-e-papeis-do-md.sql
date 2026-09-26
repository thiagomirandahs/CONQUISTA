-- =============================================================================
--  Hierarquia (continuação da 130):
--   A) Convites de coordenação INATIVOS (revogado / expirado / esgotado) podem ser "apagados" da lista do
--      /admin. Apagar = ARQUIVAR (arquivado_em/arquivado_por), NÃO delete físico: o convite continua no
--      banco porque hierarchy_invite_uses (ON DELETE CASCADE) e o metadata.convite_id dos vínculos apontam
--      para ele — um DELETE apagaria o histórico de quem entrou por qual link. Cada arquivamento deixa
--      trilha em platform_admin_audit. Convite ATIVO não se apaga: só se revoga (e depois se apaga).
--   B) Papéis do Ministério Jovem/Desbravadores no nível CAMPO (Associação/Missão), além de
--      coordenador_geral e diretor_mda:
--        secretario_md   → "Secretário(a) do MD"
--        associado_md    → "Associado(a) do MD" (diretor associado de desbravadores do campo)
--        departamental_jovem → "Departamental" (diretor/departamental JA do campo)
--      Mesmas capacidades (só leitura agregada, portal) — nenhum acesso a dado operacional de clube.
--
--  Segurança: RPCs SECURITY DEFINER, search_path ''. Não altera nenhuma linha existente (nem do Tenant
--  001 "filhos-da-conquista", nem do clube "Exército da colina"): só colunas novas (nulas), funções e
--  constraint de papel estendida. Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- B) papéis do campo
-- ---------------------------------------------------------------------------
alter table public.organization_memberships drop constraint if exists organization_memberships_role_valido;
alter table public.organization_memberships add constraint organization_memberships_role_valido
  check (role in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais',
                   'coordenador_distrital', 'coordenador_regional', 'coordenador_geral', 'diretor_mda',
                   'secretario_md', 'associado_md', 'departamental_jovem',
                   'coordenador_uniao', 'diretor_uniao', 'coordenador_divisao'));

create or replace function public._validar_role_por_tipo_unidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tipo text; v_validos text[];
begin
  select type into v_tipo from public.organizational_units where id = new.organizational_unit_id;
  if v_tipo is null then raise exception 'Unidade organizacional não encontrada.'; end if;
  v_validos := case v_tipo
    when 'clube' then array['desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais']
    when 'distrito' then array['coordenador_distrital']
    when 'regiao' then array['coordenador_regional']
    when 'campo' then array['coordenador_geral', 'diretor_mda', 'secretario_md', 'associado_md', 'departamental_jovem']
    when 'uniao' then array['coordenador_uniao', 'diretor_uniao']
    when 'divisao' then array['coordenador_divisao']
    else null end;
  if v_validos is null then
    raise exception 'Vínculo em unidade do tipo "%" ainda não tem papéis modelados nesta fase.', v_tipo;
  end if;
  if new.role <> all (v_validos) then
    raise exception 'Papel "%" não é válido para uma unidade organizacional do tipo "%" (válidos: %).', new.role, v_tipo, array_to_string(v_validos, ', ');
  end if;
  return new;
end;
$$;

create or replace function public._capacidades_institucionais(p_role text) returns jsonb
language sql immutable as $$
  select case
    when p_role in ('coordenador_distrital', 'coordenador_regional', 'coordenador_geral', 'diretor_mda',
                    'secretario_md', 'associado_md', 'departamental_jovem',
                    'coordenador_uniao', 'diretor_uniao', 'coordenador_divisao')
      then jsonb_build_object('ver_clubes', true, 'ver_painel', true, 'decidir_workflow', true)
    else jsonb_build_object('ver_clubes', false, 'ver_painel', false, 'decidir_workflow', false) end;
$$;
revoke all on function public._capacidades_institucionais(text) from public, anon, authenticated;

create or replace function public._hier_tipo_do_papel(p_papel text) returns text
language sql immutable set search_path = '' as $$
  select case p_papel
    when 'coordenador_distrital' then 'distrito' when 'coordenador_regional' then 'regiao'
    when 'coordenador_geral' then 'campo' when 'diretor_mda' then 'campo'
    when 'secretario_md' then 'campo' when 'associado_md' then 'campo' when 'departamental_jovem' then 'campo'
    when 'coordenador_uniao' then 'uniao' when 'diretor_uniao' then 'uniao'
    when 'coordenador_divisao' then 'divisao' end;
$$;
revoke all on function public._hier_tipo_do_papel(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A) arquivar convites inativos
-- ---------------------------------------------------------------------------
alter table public.hierarchy_invites add column if not exists arquivado_em timestamptz;
alter table public.hierarchy_invites add column if not exists arquivado_por uuid references auth.users(id) on delete set null;
create index if not exists idx_hierarchy_invites_visiveis on public.hierarchy_invites (created_at desc) where arquivado_em is null;

create or replace function public._hier_convite_situacao(p_i public.hierarchy_invites) returns text
language sql stable set search_path = '' as $$
  select case when p_i.revoked_at is not null then 'revogado' when p_i.expires_at <= now() then 'expirado'
              when p_i.usos >= p_i.max_usos then 'esgotado' else 'valido' end;
$$;
revoke all on function public._hier_convite_situacao(public.hierarchy_invites) from public, anon, authenticated;

create or replace function public.admin_convite_hierarquia_apagar(p_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_i public.hierarchy_invites; v_sit text;
begin
  select * into v_i from public.hierarchy_invites where id = p_id for update;
  if not found then raise exception 'Convite não encontrado.'; end if;
  if v_i.arquivado_em is not null then return json_build_object('ok', true, 'sem_mudanca', true); end if;
  v_sit := public._hier_convite_situacao(v_i);
  if v_sit = 'valido' then
    raise exception 'Este convite ainda está válido. Revogue-o antes de apagar.';
  end if;
  update public.hierarchy_invites set arquivado_em = now(), arquivado_por = v_admin where id = p_id;
  perform public._admin_auditar('hierarquia_convite_apagar', 'hierarchy_invite', p_id,
    jsonb_build_object('situacao', v_sit, 'rotulo', v_i.rotulo, 'papel', v_i.papel, 'usos', v_i.usos, 'motivo', p_motivo));
  return json_build_object('ok', true, 'situacao', v_sit);
end;
$$;

create or replace function public.admin_convites_hierarquia_limpar_inativos() returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_ids uuid[];
begin
  with alvo as (
    select i.id from public.hierarchy_invites i
     where i.arquivado_em is null and public._hier_convite_situacao(i) <> 'valido'
     for update
  ), feito as (
    update public.hierarchy_invites h set arquivado_em = now(), arquivado_por = v_admin
      from alvo where h.id = alvo.id returning h.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from feito;
  if cardinality(v_ids) > 0 then
    -- uma linha por convite: a trilha de cada um fica pesquisável pelo alvo_id
    perform public._admin_auditar('hierarquia_convite_apagar', 'hierarchy_invite', x,
      jsonb_build_object('em_lote', true)) from unnest(v_ids) x;
  end if;
  return json_build_object('ok', true, 'apagados', cardinality(v_ids));
end;
$$;

-- admin_hierarquia: igual à 130, mas a lista de convites esconde os arquivados
create or replace function public.admin_hierarquia() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return json_build_object(
    'unidades', coalesce((select json_agg(json_build_object(
        'id', u.id, 'parent_id', u.parent_id, 'tipo', u.type, 'nome', u.nome, 'status', u.status,
        'coordenadores', coalesce((select json_agg(json_build_object(
            'membership_id', m.id, 'nome', p.nome, 'papel', m.role, 'status', m.status, 'desde', m.starts_at)
            order by m.status, p.nome)
          from public.organization_memberships m join public.profiles p on p.id = m.user_id
         where m.organizational_unit_id = u.id and m.status in ('ativo', 'pendente', 'suspenso')
           and (m.ends_at is null or m.ends_at > now())), '[]'::json)
      ) order by public._hier_nivel(u.type), u.nome)
      from public.organizational_units u where u.type in ('divisao', 'uniao', 'campo', 'regiao', 'distrito')), '[]'::json),
    'clubes', coalesce((select json_agg(json_build_object('id', c.id, 'parent_id', c.parent_id, 'nome', c.nome, 'status', c.status)
                          order by c.nome)
                        from public.organizational_units c where c.type = 'clube'), '[]'::json),
    'pedidos_clube', coalesce((select json_agg(json_build_object(
        'id', r.id, 'club_id', r.club_id, 'clube', c.nome,
        'unidade_pedida', json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type, 'caminho', public._hier_caminho(u.id)),
        'unidade_atual', (select json_build_object('id', pa.id, 'nome', pa.nome, 'tipo', pa.type) from public.organizational_units pa where pa.id = c.parent_id),
        'solicitado_em', r.created_at) order by r.created_at)
      from public.club_hierarchy_requests r
      join public.organizational_units c on c.id = r.club_id
      join public.organizational_units u on u.id = r.unidade_pedida_id
     where r.status = 'pendente'), '[]'::json),
    'coordenadores_pendentes', coalesce((select json_agg(json_build_object(
        'membership_id', m.id, 'nome', p.nome, 'papel', m.role,
        'unidade', json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type, 'caminho', public._hier_caminho(u.id)),
        'convite', (select i.rotulo from public.hierarchy_invites i where i.id::text = m.metadata ->> 'convite_id'),
        'desde', m.created_at) order by m.created_at)
      from public.organization_memberships m
      join public.organizational_units u on u.id = m.organizational_unit_id and u.type <> 'clube'
      join public.profiles p on p.id = m.user_id
     where m.status = 'pendente' and m.ends_at is null), '[]'::json),
    'convites', coalesce((select json_agg(json_build_object(
        'id', i.id, 'prefixo', i.prefixo, 'papel', i.papel, 'modo', i.modo, 'rotulo', i.rotulo,
        'unidade', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type) from public.organizational_units u where u.id = i.unidade_id),
        'tipo_unidade', i.tipo_unidade, 'max_usos', i.max_usos, 'usos', i.usos, 'expira_em', i.expires_at,
        'revogado_em', i.revoked_at, 'criado_em', i.created_at,
        'situacao', public._hier_convite_situacao(i)) order by i.created_at desc)
      from (select * from public.hierarchy_invites where arquivado_em is null order by created_at desc limit 100) i), '[]'::json),
    'convites_arquivados', (select count(*) from public.hierarchy_invites where arquivado_em is not null)
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_hierarquia()', 'admin_convite_hierarquia_apagar(uuid, text)',
                           'admin_convites_hierarquia_limpar_inativos()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-convites-arquivar-e-papeis-do-md.sql')
on conflict (arquivo) do update set aplicada_em = now();
