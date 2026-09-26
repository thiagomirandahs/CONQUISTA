-- Cargos DA UNIDADE (26/09) — pedido do dono: "precisa pôr também os cargos das unidades".
--
-- Fonte oficial: Manual Administrativo do Clube de Desbravadores (Divisão Sul-Americana,
-- adventistas.org/desbravadores), seção 3.2 "Sistema de Unidades" e 3.2.2 "Os oficiais da Unidade":
--   * "Toda Unidade é coordenada por um Conselheiro e, no máximo, um Conselheiro Associado."
--   * funções principais dos desbravadores: Capitão e Secretário;
--   * outros cargos a critério da unidade/clube: Tesoureiro, Almoxarife, Coordenador de recreação,
--     Padioleiro e Capelão (o Capelão da unidade trabalha com o Capelão do clube).
--   * quem não tem função é Desbravador (membro comum) = cargo_unidade NULL.
--
-- Modelo: coluna organization_memberships.cargo_unidade (o VÍNCULO já guarda a unidade_id da pessoa
-- naquele clube desde a migration 34, então o cargo fica junto — por clube e por unidade, nunca no
-- profile global). Cada cargo é ÚNICO por unidade (1 conselheiro, no máximo 1 associado, 1 capitão...).
-- É informativo/organizacional: NÃO muda role/permissões. Só a DIRETORIA do clube define (RPC).
-- Ao trocar de unidade ou sair do status ativo, o cargo cai (não "vaza" para a unidade nova).

alter table public.organization_memberships add column if not exists cargo_unidade text;

alter table public.organization_memberships drop constraint if exists organization_memberships_cargo_unidade_valido;
alter table public.organization_memberships add constraint organization_memberships_cargo_unidade_valido check (
  cargo_unidade is null or (
    unidade_id is not null and cargo_unidade in (
      'conselheiro', 'conselheiro_associado', 'capitao', 'secretario',
      'tesoureiro', 'capelao', 'almoxarife', 'coordenador_recreacao', 'padioleiro')));

-- um cargo por unidade (vínculos vigentes)
create unique index if not exists uq_cargo_por_unidade
  on public.organization_memberships (unidade_id, cargo_unidade)
  where cargo_unidade is not null and ends_at is null;

create or replace function public.limpa_cargo_unidade() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.cargo_unidade is not null and (
       new.unidade_id is distinct from old.unidade_id
    or new.status <> 'ativo' or new.ends_at is not null
    or new.role = 'pais') then
    new.cargo_unidade := null;
  end if;
  return new;
end $$;
revoke all on function public.limpa_cargo_unidade() from public, anon, authenticated;
drop trigger if exists trg_limpa_cargo_unidade on public.organization_memberships;
create trigger trg_limpa_cargo_unidade
before update of unidade_id, status, ends_at, role on public.organization_memberships
for each row execute function public.limpa_cargo_unidade();

-- Diretoria define (ou limpa, com p_cargo null/'desbravador') o cargo de um membro na unidade dele.
create or replace function public.unidade_definir_cargo(p_user_id uuid, p_cargo text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_club uuid := public.clube_atual_id();
  v_cargo text := nullif(nullif(btrim(coalesce(p_cargo, '')), ''), 'desbravador');
  v_m public.organization_memberships;
  v_ocupante uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if v_club is null or public.papel_no_clube(auth.uid(), v_club) is distinct from 'diretoria' then
    raise exception 'Sem permissão (apenas a diretoria deste clube define cargos da unidade).';
  end if;
  if v_cargo is not null and v_cargo not in ('conselheiro', 'conselheiro_associado', 'capitao', 'secretario',
      'tesoureiro', 'capelao', 'almoxarife', 'coordenador_recreacao', 'padioleiro') then
    raise exception 'Cargo de unidade inválido.';
  end if;

  select * into v_m from public.organization_memberships m
   where m.user_id = p_user_id and m.organizational_unit_id = v_club
     and m.status = 'ativo' and m.ends_at is null
   order by m.starts_at, m.created_at, m.id limit 1
   for update;
  if not found then raise exception 'Membro não encontrado neste clube.'; end if;

  if v_cargo is not null then
    if v_m.unidade_id is null then raise exception 'Coloque a pessoa numa unidade antes de dar um cargo.'; end if;
    if v_m.role = 'pais' then raise exception 'Responsável não tem cargo de unidade.'; end if;
    if v_cargo in ('conselheiro', 'conselheiro_associado') and v_m.role = 'desbravador' then
      raise exception 'Conselheiro(a) da unidade é da liderança — mude o cargo no clube primeiro.';
    end if;
    select m.user_id into v_ocupante from public.organization_memberships m
     where m.unidade_id = v_m.unidade_id and m.cargo_unidade = v_cargo and m.ends_at is null and m.id <> v_m.id;
    if v_ocupante is not null then
      raise exception 'Esta unidade já tem alguém nesse cargo. Tire o cargo da outra pessoa primeiro.';
    end if;
  end if;

  update public.organization_memberships set cargo_unidade = v_cargo, updated_at = now() where id = v_m.id;
  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'unidade_id', v_m.unidade_id, 'cargo_unidade', v_cargo);
end $function$;
revoke all on function public.unidade_definir_cargo(uuid, text) from public, anon;
grant execute on function public.unidade_definir_cargo(uuid, text) to authenticated;

-- Leitura: quem tem cargo em cada unidade DO CLUBE DA ABA (qualquer membro ativo do clube vê a
-- "diretoria da unidade"). Só vínculos ativos; nada de outro clube.
create or replace function public.cargos_unidade_do_clube()
returns table (user_id uuid, unidade_id uuid, cargo_unidade text)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null or v_club is null or public.papel_no_clube(auth.uid(), v_club) is null then
    return;
  end if;
  return query
    select m.user_id, m.unidade_id, m.cargo_unidade
      from public.organization_memberships m
     where m.organizational_unit_id = v_club and m.status = 'ativo' and m.ends_at is null
       and m.cargo_unidade is not null and m.unidade_id is not null;
end $function$;
revoke all on function public.cargos_unidade_do_clube() from public, anon;
grant execute on function public.cargos_unidade_do_clube() to authenticated;
