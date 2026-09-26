-- =============================================================================
--  Hierarquia gerida no /admin + convites de coordenação + clube escolhe a região (com confirmação).
--
--  DECISÃO DO DONO DO PRODUTO (implementada aqui):
--   1) A árvore acima do clube (Divisão → União → Associação/Missão[campo] → Região → Distrito, níveis
--      opcionais) é criada/editada/desativada SÓ pela administração da plataforma. Cada clube é ligado
--      a um distrito/região/campo (parent_id) — só o admin grava parent_id de clube.
--      União/Divisão ganham papéis: coordenador_uniao, diretor_uniao, coordenador_divisao — com o MESMO
--      princípio do portal (migration 47): só AGREGADO; nunca chat, foto, financeiro, evidência ou dado
--      de responsável. Nenhuma policy de RLS nova em dado operacional.
--   2) No onboarding a diretoria ESCOLHE a unidade numa lista → nasce um PEDIDO pendente
--      (club_hierarchy_requests). O clube só vai para debaixo da unidade quando o admin confirma (ou
--      altera). Ninguém se coloca sob um coordenador sozinho.
--   3) Coordenador é nomeado NA UNIDADE; o acesso aos clubes é DERIVADO da árvore a cada requisição
--      (_clubes_descendentes, migration 47) — clube novo entra sozinho, clube movido/vínculo encerrado
--      sai no mesmo instante. Nada é copiado clube a clube.
--   4) Convite por LINK (hierarchy_invites), token só como hash sha256 (padrão de club_entry_codes/
--      club_invites): modo 'fixo' (unidade+papel definidos pelo admin → vínculo ATIVO ao aceitar) e modo
--      'escolha' (papel definido, a pessoa escolhe a unidade → vínculo PENDENTE até o admin confirmar).
--      Expiração obrigatória e limite de usos. Rate limit como na 104 (origem, sem login) e como na 71
--      (por pessoa, com login).
--
--  Segurança: todas as RPCs são SECURITY DEFINER com search_path ''; as de admin exigem
--  _exigir_admin_plataforma() e deixam trilha em platform_admin_audit (padrão da 103/109).
--  Esta migration NÃO altera nenhuma linha existente (nem do Tenant 001 "filhos-da-conquista", nem do
--  clube "Exército da colina", nem de ninguém): só cria tabelas/funções e troca definições.
--  Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) papéis de União e Divisão (mesmo gatilho da 46, estendido)
-- ---------------------------------------------------------------------------
alter table public.organization_memberships drop constraint if exists organization_memberships_role_valido;
alter table public.organization_memberships add constraint organization_memberships_role_valido
  check (role in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais',
                   'coordenador_distrital', 'coordenador_regional', 'coordenador_geral', 'diretor_mda',
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
    when 'campo' then array['coordenador_geral', 'diretor_mda']
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

-- mesmas capacidades (só leitura agregada) — nada aqui concede dado operacional de clube
create or replace function public._capacidades_institucionais(p_role text) returns jsonb
language sql immutable as $$
  select case
    when p_role in ('coordenador_distrital', 'coordenador_regional', 'coordenador_geral', 'diretor_mda',
                    'coordenador_uniao', 'diretor_uniao', 'coordenador_divisao')
      then jsonb_build_object('ver_clubes', true, 'ver_painel', true, 'decidir_workflow', true)
    else jsonb_build_object('ver_clubes', false, 'ver_painel', false, 'decidir_workflow', false) end;
$$;
revoke all on function public._capacidades_institucionais(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) helpers de hierarquia
-- ---------------------------------------------------------------------------
create or replace function public._hier_nivel(p_tipo text) returns int
language sql immutable set search_path = '' as $$
  select case p_tipo when 'divisao' then 1 when 'uniao' then 2 when 'campo' then 3 when 'regiao' then 4
                     when 'distrito' then 5 when 'igreja' then 6 when 'clube' then 7 end;
$$;
revoke all on function public._hier_nivel(text) from public, anon, authenticated;

-- papel institucional → tipo de unidade onde ele vale
create or replace function public._hier_tipo_do_papel(p_papel text) returns text
language sql immutable set search_path = '' as $$
  select case p_papel
    when 'coordenador_distrital' then 'distrito' when 'coordenador_regional' then 'regiao'
    when 'coordenador_geral' then 'campo' when 'diretor_mda' then 'campo'
    when 'coordenador_uniao' then 'uniao' when 'diretor_uniao' then 'uniao'
    when 'coordenador_divisao' then 'divisao' end;
$$;
revoke all on function public._hier_tipo_do_papel(text) from public, anon, authenticated;

create or replace function public._hier_caminho(p_unit uuid) returns text
language sql stable security definer set search_path = '' as $$
  with recursive cadeia as (
    select id, parent_id, nome, 0 as prof from public.organizational_units where id = p_unit
    union all
    select o.id, o.parent_id, o.nome, c.prof + 1 from public.organizational_units o join cadeia c on o.id = c.parent_id
    where c.prof < 10
  )
  select string_agg(nome, ' › ' order by prof desc) from cadeia;
$$;
revoke all on function public._hier_caminho(uuid) from public, anon, authenticated;

-- pai válido para uma unidade de tipo p_tipo (e, na edição, sem ciclo com p_self)
create or replace function public._hier_validar_pai(p_tipo text, p_parent uuid, p_self uuid default null) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_pai public.organizational_units;
begin
  if p_parent is null then return; end if;
  select * into v_pai from public.organizational_units where id = p_parent;
  if not found then raise exception 'Unidade superior não encontrada.'; end if;
  if v_pai.type in ('clube', 'igreja') then raise exception 'Um clube não pode ficar debaixo de outro clube ou igreja.'; end if;
  if v_pai.status <> 'ativo' then raise exception 'A unidade superior "%" está desativada.', v_pai.nome; end if;
  if public._hier_nivel(v_pai.type) >= public._hier_nivel(p_tipo) then
    raise exception 'Uma unidade do tipo "%" não pode ficar debaixo de "%" (%).', p_tipo, v_pai.nome, v_pai.type;
  end if;
  if p_self is not null and exists (
    with recursive sobe as (
      select id, parent_id from public.organizational_units where id = p_parent
      union all
      select o.id, o.parent_id from public.organizational_units o join sobe s on o.id = s.parent_id
    ) select 1 from sobe where id = p_self) then
    raise exception 'Isso criaria um ciclo na hierarquia.';
  end if;
end;
$$;
revoke all on function public._hier_validar_pai(text, uuid, uuid) from public, anon, authenticated;

-- diretoria ATIVA e vigente do clube (quem pode pedir a região do clube)
create or replace function public._hier_eh_diretoria(p_uid uuid, p_club uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_memberships m
                  where m.user_id = p_uid and m.organizational_unit_id = p_club and m.role = 'diretoria'
                    and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()));
$$;
revoke all on function public._hier_eh_diretoria(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) tabelas: pedido de região do clube, convites de coordenação e usos
-- ---------------------------------------------------------------------------
create table if not exists public.club_hierarchy_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_pedida_id uuid not null references public.organizational_units(id) on delete cascade,
  unidade_final_id uuid references public.organizational_units(id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'recusado', 'cancelado')),
  solicitado_por uuid references auth.users(id) on delete set null,
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_club_hierarchy_request_pendente on public.club_hierarchy_requests (club_id) where status = 'pendente';
create index if not exists idx_club_hierarchy_requests_status on public.club_hierarchy_requests (status, created_at);
alter table public.club_hierarchy_requests enable row level security;
revoke all on public.club_hierarchy_requests from public, anon, authenticated;

create table if not exists public.hierarchy_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  prefixo text not null,
  papel text not null check (public._hier_tipo_do_papel(papel) is not null),
  modo text not null check (modo in ('fixo', 'escolha')),
  unidade_id uuid references public.organizational_units(id) on delete cascade,
  tipo_unidade text not null,
  rotulo text,
  max_usos int not null default 1 check (max_usos between 1 and 50),
  usos int not null default 0 check (usos >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hierarchy_invites_modo_unidade check ((modo = 'fixo') = (unidade_id is not null))
);
alter table public.hierarchy_invites enable row level security;
revoke all on public.hierarchy_invites from public, anon, authenticated;

create table if not exists public.hierarchy_invite_uses (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.hierarchy_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_id uuid references public.organization_memberships(id) on delete set null,
  unidade_id uuid references public.organizational_units(id) on delete set null,
  status_inicial text not null,
  created_at timestamptz not null default now(),
  unique (invite_id, user_id)
);
alter table public.hierarchy_invite_uses enable row level security;
revoke all on public.hierarchy_invite_uses from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) ADMIN — leitura da árvore e pendências
-- ---------------------------------------------------------------------------
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
    -- clubes: só id/nome/status/pai — nenhuma contagem de pessoas nem dado operacional
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
        'situacao', case when i.revoked_at is not null then 'revogado' when i.expires_at <= now() then 'expirado'
                         when i.usos >= i.max_usos then 'esgotado' else 'valido' end) order by i.created_at desc)
      from (select * from public.hierarchy_invites order by created_at desc limit 100) i), '[]'::json)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) ADMIN — unidades (criar / editar / ativar-desativar)
-- ---------------------------------------------------------------------------
create or replace function public.admin_unidade_criar(p_tipo text, p_nome text, p_parent_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_id uuid; v_nome text := btrim(coalesce(p_nome, ''));
begin
  if p_tipo not in ('divisao', 'uniao', 'campo', 'regiao', 'distrito') then
    raise exception 'Tipo inválido: use divisão, união, associação/missão (campo), região ou distrito.';
  end if;
  if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'Nome inválido (2 a 120 caracteres).'; end if;
  perform public._hier_validar_pai(p_tipo, p_parent_id);
  insert into public.organizational_units (type, nome, parent_id, metadata)
  values (p_tipo, v_nome, p_parent_id, jsonb_build_object('origem', 'admin_hierarquia'))
  returning id into v_id;
  perform public._admin_auditar('hierarquia_unidade_criar', 'organizational_unit', v_id,
    jsonb_build_object('tipo', p_tipo, 'nome', v_nome, 'parent_id', p_parent_id));
  return json_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_unidade_editar(p_id uuid, p_nome text, p_parent_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_u public.organizational_units; v_nome text := btrim(coalesce(p_nome, ''));
begin
  select * into v_u from public.organizational_units where id = p_id for update;
  if not found or v_u.type not in ('divisao', 'uniao', 'campo', 'regiao', 'distrito') then
    raise exception 'Unidade não encontrada (clubes são ligados pela ação "vincular clube").';
  end if;
  if length(v_nome) < 2 or length(v_nome) > 120 then raise exception 'Nome inválido (2 a 120 caracteres).'; end if;
  perform public._hier_validar_pai(v_u.type, p_parent_id, p_id);
  update public.organizational_units set nome = v_nome, parent_id = p_parent_id, updated_at = now() where id = p_id;
  perform public._admin_auditar('hierarquia_unidade_editar', 'organizational_unit', p_id,
    jsonb_build_object('nome_de', v_u.nome, 'nome_para', v_nome, 'parent_de', v_u.parent_id, 'parent_para', p_parent_id));
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_unidade_status(p_id uuid, p_ativo boolean, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_u public.organizational_units; v_novo text;
begin
  select * into v_u from public.organizational_units where id = p_id for update;
  if not found or v_u.type not in ('divisao', 'uniao', 'campo', 'regiao', 'distrito') then
    raise exception 'Unidade não encontrada.';
  end if;
  v_novo := case when p_ativo then 'ativo' else 'inativo' end;
  if v_u.status = v_novo then return json_build_object('ok', true, 'sem_mudanca', true); end if;
  if not p_ativo then
    if exists (select 1 from public.organizational_units f where f.parent_id = p_id and f.status = 'ativo') then
      raise exception 'Mova ou desative antes as unidades e clubes que estão debaixo de "%".', v_u.nome;
    end if;
    if exists (select 1 from public.organization_memberships m where m.organizational_unit_id = p_id
                and m.status in ('ativo', 'pendente') and m.ends_at is null) then
      raise exception 'Encerre antes os vínculos de coordenação de "%".', v_u.nome;
    end if;
    -- convites que apontam para ela deixam de valer
    update public.hierarchy_invites set revoked_at = now(), revoked_by = v_admin
     where unidade_id = p_id and revoked_at is null;
  else
    perform public._hier_validar_pai(v_u.type, v_u.parent_id, p_id);
  end if;
  update public.organizational_units set status = v_novo, updated_at = now() where id = p_id;
  perform public._admin_auditar(case when p_ativo then 'hierarquia_unidade_ativar' else 'hierarquia_unidade_desativar' end,
    'organizational_unit', p_id, jsonb_build_object('nome', v_u.nome, 'motivo', p_motivo));
  return json_build_object('ok', true, 'status', v_novo);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) ADMIN — clube na árvore (vincular direto / decidir pedido)
-- ---------------------------------------------------------------------------
create or replace function public._hier_clube_mover(p_club_id uuid, p_unidade_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_c public.organizational_units; v_u public.organizational_units;
begin
  select * into v_c from public.organizational_units where id = p_club_id and type = 'clube' for update;
  if not found then raise exception 'Clube não encontrado.'; end if;
  if p_unidade_id is not null then
    select * into v_u from public.organizational_units where id = p_unidade_id;
    if not found or v_u.type not in ('distrito', 'regiao', 'campo') then
      raise exception 'Um clube só pode ser ligado a um distrito, uma região ou uma associação/missão.';
    end if;
    if v_u.status <> 'ativo' then raise exception 'A unidade "%" está desativada.', v_u.nome; end if;
  end if;
  update public.organizational_units set parent_id = p_unidade_id, updated_at = now() where id = p_club_id;
  return v_c.parent_id;   -- o pai anterior (para a auditoria)
end;
$$;
revoke all on function public._hier_clube_mover(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_clube_vincular(p_club_id uuid, p_unidade_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_antes uuid; v_pedido uuid;
begin
  v_antes := public._hier_clube_mover(p_club_id, p_unidade_id);
  -- havia pedido pendente? o admin decidiu por cima dele (confirmou ou alterou)
  update public.club_hierarchy_requests
     set status = 'confirmado', unidade_final_id = p_unidade_id, decidido_por = v_admin, decidido_em = now(),
         motivo = coalesce(nullif(btrim(p_motivo), ''), 'definido pela administração'), updated_at = now()
   where club_id = p_club_id and status = 'pendente'
  returning id into v_pedido;
  perform public._admin_auditar('hierarquia_clube_vincular', 'club', p_club_id,
    jsonb_build_object('parent_de', v_antes, 'parent_para', p_unidade_id, 'pedido_id', v_pedido, 'motivo', p_motivo));
  return json_build_object('ok', true, 'parent_id', p_unidade_id);
end;
$$;

create or replace function public.admin_pedido_clube_decidir(p_pedido_id uuid, p_confirmar boolean,
  p_unidade_id uuid default null, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_r public.club_hierarchy_requests; v_final uuid; v_antes uuid;
begin
  select * into v_r from public.club_hierarchy_requests where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_r.status <> 'pendente' then raise exception 'Este pedido já foi decidido (%).', v_r.status; end if;
  if p_confirmar then
    v_final := coalesce(p_unidade_id, v_r.unidade_pedida_id);
    v_antes := public._hier_clube_mover(v_r.club_id, v_final);
    update public.club_hierarchy_requests
       set status = 'confirmado', unidade_final_id = v_final, decidido_por = v_admin, decidido_em = now(),
           motivo = nullif(btrim(p_motivo), ''), updated_at = now()
     where id = v_r.id;
  else
    update public.club_hierarchy_requests
       set status = 'recusado', decidido_por = v_admin, decidido_em = now(),
           motivo = nullif(btrim(p_motivo), ''), updated_at = now()
     where id = v_r.id;
  end if;
  perform public._admin_auditar(case when p_confirmar then 'hierarquia_pedido_confirmar' else 'hierarquia_pedido_recusar' end,
    'club', v_r.club_id, jsonb_build_object('pedido_id', v_r.id, 'pedida', v_r.unidade_pedida_id, 'final', v_final,
                                           'alterado', v_final is not null and v_final <> v_r.unidade_pedida_id,
                                           'parent_de', v_antes, 'motivo', p_motivo));
  return json_build_object('ok', true, 'status', case when p_confirmar then 'confirmado' else 'recusado' end, 'parent_id', v_final);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) ADMIN — vínculos de coordenação (confirmar pendente / recusar / remover)
--    Remover = status 'encerrado' + ends_at: escopo_atual_id() deixa de honrar NA HORA.
-- ---------------------------------------------------------------------------
create or replace function public.admin_coordenador_decidir(p_membership_id uuid, p_confirmar boolean, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_m public.organization_memberships; v_tipo text;
begin
  select m.* into v_m from public.organization_memberships m where m.id = p_membership_id for update;
  select type into v_tipo from public.organizational_units where id = v_m.organizational_unit_id;
  if v_m.id is null or v_tipo is null or v_tipo = 'clube' then raise exception 'Vínculo de coordenação não encontrado.'; end if;
  if v_m.status <> 'pendente' then raise exception 'Este vínculo não está aguardando confirmação (%).', v_m.status; end if;
  if p_confirmar then
    update public.organization_memberships set status = 'ativo', updated_at = now(),
           metadata = metadata || jsonb_build_object('confirmado_por', v_admin, 'confirmado_em', now())
     where id = v_m.id;
  else
    update public.organization_memberships set status = 'encerrado', ends_at = clock_timestamp(), updated_at = now(),
           metadata = metadata || jsonb_build_object('recusado_por', v_admin, 'motivo', p_motivo)
     where id = v_m.id;
  end if;
  perform public._admin_auditar(case when p_confirmar then 'hierarquia_coordenador_confirmar' else 'hierarquia_coordenador_recusar' end,
    'organization_membership', v_m.id,
    jsonb_build_object('unidade_id', v_m.organizational_unit_id, 'papel', v_m.role, 'user_id', v_m.user_id, 'motivo', p_motivo));
  return json_build_object('ok', true, 'status', case when p_confirmar then 'ativo' else 'encerrado' end);
end;
$$;

create or replace function public.admin_coordenador_remover(p_membership_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_m public.organization_memberships; v_tipo text;
begin
  select m.* into v_m from public.organization_memberships m where m.id = p_membership_id for update;
  select type into v_tipo from public.organizational_units where id = v_m.organizational_unit_id;
  if v_m.id is null or v_tipo is null or v_tipo = 'clube' then raise exception 'Vínculo de coordenação não encontrado.'; end if;
  if v_m.status = 'encerrado' then return json_build_object('ok', true, 'sem_mudanca', true); end if;
  update public.organization_memberships set status = 'encerrado', ends_at = clock_timestamp(), updated_at = now(),
         metadata = metadata || jsonb_build_object('removido_por', v_admin, 'motivo', p_motivo)
   where id = v_m.id;
  perform public._admin_auditar('hierarquia_coordenador_remover', 'organization_membership', v_m.id,
    jsonb_build_object('unidade_id', v_m.organizational_unit_id, 'papel', v_m.role, 'user_id', v_m.user_id,
                       'status_de', v_m.status, 'motivo', p_motivo));
  return json_build_object('ok', true, 'status', 'encerrado');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) ADMIN — convites de coordenação
-- ---------------------------------------------------------------------------
create or replace function public.admin_convite_hierarquia_gerar(p_papel text, p_unidade_id uuid default null,
  p_dias int default 7, p_max_usos int default 1, p_rotulo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_tipo text := public._hier_tipo_do_papel(p_papel);
        v_u public.organizational_units; v_token text; v_id uuid; v_exp timestamptz; v_rotulo text;
begin
  if v_tipo is null then raise exception 'Papel de coordenação inválido.'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then raise exception 'Validade inválida: use de 1 a 90 dias.'; end if;
  if p_max_usos is null or p_max_usos < 1 or p_max_usos > 50 then raise exception 'Número de usos inválido: use de 1 a 50.'; end if;
  if p_unidade_id is not null then
    select * into v_u from public.organizational_units where id = p_unidade_id;
    if not found then raise exception 'Unidade não encontrada.'; end if;
    if v_u.type <> v_tipo then raise exception 'Esse papel vale numa unidade do tipo "%", não "%".', v_tipo, v_u.type; end if;
    if v_u.status <> 'ativo' then raise exception 'A unidade "%" está desativada.', v_u.nome; end if;
  elsif not exists (select 1 from public.organizational_units where type = v_tipo and status = 'ativo') then
    raise exception 'Não há nenhuma unidade do tipo "%" ativa para a pessoa escolher. Crie a unidade antes.', v_tipo;
  end if;
  v_exp := now() + make_interval(days => p_dias);
  v_token := encode(extensions.gen_random_bytes(16), 'hex');   -- 128 bits; só sai daqui UMA vez
  v_rotulo := coalesce(nullif(btrim(p_rotulo), ''), p_papel || coalesce(' — ' || v_u.nome, ' (escolha da unidade)'));
  insert into public.hierarchy_invites (token_hash, prefixo, papel, modo, unidade_id, tipo_unidade, rotulo, max_usos, expires_at, criado_por)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 6), p_papel,
          case when p_unidade_id is null then 'escolha' else 'fixo' end, p_unidade_id, v_tipo, left(v_rotulo, 160),
          p_max_usos, v_exp, v_admin)
  returning id into v_id;
  perform public._admin_auditar('hierarquia_convite_gerar', 'hierarchy_invite', v_id,
    jsonb_build_object('papel', p_papel, 'unidade_id', p_unidade_id, 'modo', case when p_unidade_id is null then 'escolha' else 'fixo' end,
                       'dias', p_dias, 'max_usos', p_max_usos, 'rotulo', v_rotulo));
  return json_build_object('ok', true, 'id', v_id, 'token', v_token, 'expira_em', v_exp,
                           'modo', case when p_unidade_id is null then 'escolha' else 'fixo' end);
end;
$$;

create or replace function public.admin_convite_hierarquia_revogar(p_id uuid, p_motivo text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := public._exigir_admin_plataforma(); v_i public.hierarchy_invites;
begin
  select * into v_i from public.hierarchy_invites where id = p_id for update;
  if not found then raise exception 'Convite não encontrado.'; end if;
  if v_i.revoked_at is not null then return json_build_object('ok', true, 'sem_mudanca', true); end if;
  update public.hierarchy_invites set revoked_at = now(), revoked_by = v_admin where id = p_id;
  perform public._admin_auditar('hierarquia_convite_revogar', 'hierarchy_invite', p_id, jsonb_build_object('motivo', p_motivo));
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) PÚBLICO/PESSOA — abrir e aceitar convite de coordenação
-- ---------------------------------------------------------------------------
-- mesmo limite da 104 (por origem + teto global), gravando na mesma tabela de tentativas públicas
create or replace function public._hier_convite_limite_publico(p_acertou boolean default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_origem text := public._entrada_origem();
begin
  if p_acertou is null then
    return (select count(*) from public.entrada_tentativas_publicas
             where origem_hash = v_origem and not acertou and quando > now() - interval '10 minutes') >= 10
        or (select count(*) from public.entrada_tentativas_publicas
             where not acertou and quando > now() - interval '10 minutes') >= 300;
  end if;
  insert into public.entrada_tentativas_publicas (origem_hash, acertou) values (v_origem, p_acertou);
  return false;
end;
$$;
revoke all on function public._hier_convite_limite_publico(boolean) from public, anon, authenticated;

create or replace function public._hier_convite_valido(p_token text) returns public.hierarchy_invites
language sql stable security definer set search_path = '' as $$
  select * from public.hierarchy_invites
   where token_hash = encode(extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256'), 'hex')
     and revoked_at is null and expires_at > now() and usos < max_usos;
$$;
revoke all on function public._hier_convite_valido(text) from public, anon, authenticated;

create or replace function public.convite_hierarquia_abrir(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_i public.hierarchy_invites; v_achou boolean;
begin
  if public._hier_convite_limite_publico(null) then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;
  v_i := public._hier_convite_valido(p_token);
  v_achou := v_i.id is not null;
  perform public._hier_convite_limite_publico(v_achou);
  -- inválido, vencido, revogado, esgotado e inexistente: MESMA resposta
  if not v_achou then return json_build_object('encontrado', false); end if;
  return json_build_object(
    'encontrado', true, 'papel', v_i.papel, 'modo', v_i.modo, 'tipo_unidade', v_i.tipo_unidade, 'expira_em', v_i.expires_at,
    'unidade', (select json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type, 'caminho', public._hier_caminho(u.id))
                  from public.organizational_units u where u.id = v_i.unidade_id),
    -- no modo escolha, só nomes das unidades do tipo certo (nada de pessoas/clubes)
    'opcoes', case when v_i.modo = 'escolha' then coalesce((
        select json_agg(json_build_object('id', u.id, 'nome', u.nome, 'caminho', public._hier_caminho(u.id)) order by u.nome)
          from public.organizational_units u where u.type = v_i.tipo_unidade and u.status = 'ativo'), '[]'::json) end
  );
end;
$$;

create or replace function public.convite_hierarquia_aceitar(p_token text, p_unidade_id uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_i public.hierarchy_invites; v_achou boolean; v_unid uuid; v_u public.organizational_units;
        v_ja public.organization_memberships; v_status text; v_mid uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.'; end if;

  select * into v_i from public.hierarchy_invites
   where token_hash = encode(extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256'), 'hex')
     and revoked_at is null and expires_at > now() and usos < max_usos
   for update;
  v_achou := found;
  perform public._entrada_registrar_tentativa(v_achou);
  if not v_achou then return json_build_object('encontrado', false); end if;

  if exists (select 1 from public.hierarchy_invite_uses where invite_id = v_i.id and user_id = v_uid) then
    return json_build_object('encontrado', true, 'ok', true, 'ja_era', true);
  end if;

  v_unid := case when v_i.modo = 'fixo' then v_i.unidade_id else p_unidade_id end;
  if v_unid is null then raise exception 'Escolha a sua unidade na lista.'; end if;
  select * into v_u from public.organizational_units where id = v_unid;
  if not found or v_u.type <> v_i.tipo_unidade or v_u.status <> 'ativo' then
    raise exception 'Unidade inválida para este convite.';
  end if;

  select * into v_ja from public.organization_memberships
   where user_id = v_uid and organizational_unit_id = v_unid and role = v_i.papel
     and status in ('ativo', 'pendente', 'suspenso') and ends_at is null
   for update;
  if found then
    if v_ja.status = 'suspenso' then raise exception 'Seu vínculo nesta unidade está suspenso. Fale com a administração.'; end if;
    return json_build_object('encontrado', true, 'ok', true, 'ja_era', true, 'situacao', v_ja.status, 'unidade', v_u.nome);
  end if;

  -- link FIXO (unidade escolhida pelo admin) = ativo; link com ESCOLHA = pendente até o admin confirmar
  v_status := case when v_i.modo = 'fixo' then 'ativo' else 'pendente' end;
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_unid, v_i.papel, v_status,
          jsonb_build_object('source', 'convite_hierarquia', 'convite_id', v_i.id, 'modo', v_i.modo))
  returning id into v_mid;
  insert into public.hierarchy_invite_uses (invite_id, user_id, membership_id, unidade_id, status_inicial)
  values (v_i.id, v_uid, v_mid, v_unid, v_status);
  update public.hierarchy_invites set usos = usos + 1 where id = v_i.id;

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', v_status,
                           'papel', v_i.papel, 'unidade', v_u.nome, 'unidade_id', v_u.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) CLUBE — escolher a região/distrito (vira pedido; só o admin confirma)
-- ---------------------------------------------------------------------------
create or replace function public.hierarquia_opcoes_para_clube() returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type, 'caminho', public._hier_caminho(u.id))
                           order by public._hier_caminho(u.id)), '[]'::json)
    from public.organizational_units u
   where u.type in ('distrito', 'regiao', 'campo') and u.status = 'ativo' and auth.uid() is not null;
$$;

create or replace function public.clube_hierarquia_situacao(p_club_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._hier_eh_diretoria(v_uid, p_club_id) then
    raise exception 'Sem permissão (apenas a diretoria deste clube).';
  end if;
  return json_build_object(
    'atual', (select json_build_object('id', pa.id, 'nome', pa.nome, 'tipo', pa.type, 'caminho', public._hier_caminho(pa.id))
                from public.organizational_units c join public.organizational_units pa on pa.id = c.parent_id where c.id = p_club_id),
    'pedido', (select json_build_object('id', r.id, 'status', r.status, 'motivo', r.motivo, 'em', r.created_at, 'decidido_em', r.decidido_em,
                                        'unidade', json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.type))
                 from public.club_hierarchy_requests r join public.organizational_units u on u.id = r.unidade_pedida_id
                where r.club_id = p_club_id and r.status <> 'cancelado' order by r.created_at desc limit 1)
  );
end;
$$;

create or replace function public.clube_hierarquia_solicitar(p_club_id uuid, p_unidade_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_u public.organizational_units; v_id uuid;
begin
  if v_uid is null or not public._hier_eh_diretoria(v_uid, p_club_id) then
    raise exception 'Sem permissão (apenas a diretoria deste clube).';
  end if;
  select * into v_u from public.organizational_units where id = p_unidade_id;
  if not found or v_u.type not in ('distrito', 'regiao', 'campo') or v_u.status <> 'ativo' then
    raise exception 'Escolha um distrito, uma região ou uma associação/missão da lista.';
  end if;
  if (select parent_id from public.organizational_units where id = p_club_id) = p_unidade_id then
    return json_build_object('ok', true, 'ja_vinculado', true);
  end if;
  -- troca de ideia: o pedido anterior (ainda não decidido) é cancelado; só existe UM pendente por clube
  update public.club_hierarchy_requests set status = 'cancelado', updated_at = now()
   where club_id = p_club_id and status = 'pendente';
  insert into public.club_hierarchy_requests (club_id, unidade_pedida_id, solicitado_por)
  values (p_club_id, p_unidade_id, v_uid) returning id into v_id;
  return json_build_object('ok', true, 'pedido_id', v_id, 'status', 'pendente');
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['admin_hierarquia()', 'admin_unidade_criar(text, text, uuid)', 'admin_unidade_editar(uuid, text, uuid)',
                           'admin_unidade_status(uuid, boolean, text)', 'admin_clube_vincular(uuid, uuid, text)',
                           'admin_pedido_clube_decidir(uuid, boolean, uuid, text)', 'admin_coordenador_decidir(uuid, boolean, text)',
                           'admin_coordenador_remover(uuid, text)', 'admin_convite_hierarquia_gerar(text, uuid, int, int, text)',
                           'admin_convite_hierarquia_revogar(uuid, text)', 'convite_hierarquia_aceitar(text, uuid)',
                           'hierarquia_opcoes_para_clube()', 'clube_hierarquia_situacao(uuid)', 'clube_hierarquia_solicitar(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.convite_hierarquia_abrir(text) from public;
grant execute on function public.convite_hierarquia_abrir(text) to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-30-hierarquia-no-admin-e-convites-de-coordenacao.sql')
on conflict (arquivo) do update set aplicada_em = now();
