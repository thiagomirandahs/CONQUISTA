begin;

do $$
declare
  v_count integer;
  v_slug text;
begin
  if (select count(*) from public.organizational_units) <> 2 then
    raise exception 'Esperadas exatamente duas unidades organizacionais no seed local';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  set local role authenticated;

  select count(*), min(slug)
    into v_count, v_slug
  from public.organizational_units;

  if v_count <> 1 or v_slug <> 'filhos-da-conquista' then
    raise exception 'Tenant 001 atravessou isolamento: count=%, slug=%', v_count, v_slug;
  end if;

  select count(*), min(nome)
    into v_count, v_slug
  from public.unidades;

  if v_count <> 1 or v_slug <> 'Unidade Tenant 001' then
    raise exception 'Tenant 001 leu unidade de outro clube: count=%, nome=%', v_count, v_slug;
  end if;

  select count(*) into v_count from public.organization_memberships;
  if v_count <> 1 then
    raise exception 'Tenant 001 leu vínculos de outro usuário: %', v_count;
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  set local role authenticated;

  select count(*), min(slug)
    into v_count, v_slug
  from public.organizational_units;

  if v_count <> 1 or v_slug <> 'clube-teste-tenant-002' then
    raise exception 'Tenant 002 atravessou isolamento: count=%, slug=%', v_count, v_slug;
  end if;

  select count(*), min(nome)
    into v_count, v_slug
  from public.unidades;

  if v_count <> 1 or v_slug <> 'Unidade Tenant 002' then
    raise exception 'Tenant 002 leu unidade de outro clube: count=%, nome=%', v_count, v_slug;
  end if;

  select count(*) into v_count from public.organization_memberships;
  if v_count <> 1 then
    raise exception 'Tenant 002 leu vínculos de outro usuário: %', v_count;
  end if;

  reset role;
end
$$;

rollback;
