begin;

do $$
declare
  v_count integer;
  v_slug text;
  v_tenant_002 uuid;
  v_unidade_002 uuid;
begin
  if (select count(*) from public.organizational_units) <> 2 then
    raise exception 'Esperadas exatamente duas unidades organizacionais no seed local';
  end if;

  select id into v_tenant_002
  from public.organizational_units
  where slug = 'clube-teste-tenant-002';

  select id into v_unidade_002
  from public.unidades
  where nome = 'Unidade Tenant 002';

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

  select count(*), min(titulo) into v_count, v_slug from public.atividades;
  if v_count <> 1 or v_slug <> 'Atividade Tenant 001' then
    raise exception 'Tenant 001 leu atividade de outro clube: count=%, titulo=%', v_count, v_slug;
  end if;

  select count(*), min(texto) into v_count, v_slug from public.entregas;
  if v_count <> 1 or v_slug <> 'Entrega Tenant 001' then
    raise exception 'Tenant 001 leu entrega de outro clube: count=%, texto=%', v_count, v_slug;
  end if;

  select count(*), min(motivo) into v_count, v_slug from public.pontos;
  if v_count <> 1 or v_slug <> 'Ponto Tenant 001' then
    raise exception 'Tenant 001 leu ponto de outro clube: count=%, motivo=%', v_count, v_slug;
  end if;

  select json_array_length(public.ranking_totais() -> 'pessoas') into v_count;
  if v_count <> 1 then
    raise exception 'Ranking total do Tenant 001 cruzou clubes: % pessoas', v_count;
  end if;

  select count(*), min(nome) into v_count, v_slug from public.profiles;
  if v_count <> 1 or v_slug <> 'Usuário Tenant 001' then
    raise exception 'Tenant 001 leu perfil de outro clube: count=%, nome=%', v_count, v_slug;
  end if;

  select count(*), min(nome) into v_count, v_slug from public.listar_usuarios();
  if v_count <> 1 or v_slug <> 'Usuário Tenant 001' then
    raise exception 'listar_usuarios atravessou clubes para Tenant 001: count=%, nome=%', v_count, v_slug;
  end if;

  select count(*), min(legenda) into v_count, v_slug from public.fotos;
  if v_count <> 1 or v_slug <> 'Foto Tenant 001' then
    raise exception 'Tenant 001 leu foto de outro clube: count=%, legenda=%', v_count, v_slug;
  end if;

  select count(*) into v_count from public.club_features where feature = 'leilao' and enabled;
  if v_count <> 1 then
    raise exception 'Tenant 001 não recebeu o recurso de leilão esperado';
  end if;

  select count(*) into v_count from public.temporadas where fim is null;
  if v_count <> 1 then
    raise exception 'Tenant 001 leu temporada de outro clube: %', v_count;
  end if;

  select count(*) into v_count from public.organization_memberships;
  if v_count <> 1 then
    raise exception 'Tenant 001 leu vínculos de outro usuário: %', v_count;
  end if;

  begin
    insert into public.unidades (nome, club_id)
    values ('Escrita cruzada bloqueada', v_tenant_002);
    raise exception 'Tenant 001 conseguiu criar unidade no Tenant 002';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.pontos (unidade_id, origem, pontos, motivo)
    values (v_unidade_002, 'teste', 1, 'Escrita cruzada bloqueada');
    raise exception 'Tenant 001 conseguiu lançar ponto no Tenant 002';
  exception when insufficient_privilege then
    null;
  end;

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

  select count(*), min(titulo) into v_count, v_slug from public.atividades;
  if v_count <> 1 or v_slug <> 'Atividade Tenant 002' then
    raise exception 'Tenant 002 leu atividade de outro clube: count=%, titulo=%', v_count, v_slug;
  end if;

  select count(*), min(texto) into v_count, v_slug from public.entregas;
  if v_count <> 1 or v_slug <> 'Entrega Tenant 002' then
    raise exception 'Tenant 002 leu entrega de outro clube: count=%, texto=%', v_count, v_slug;
  end if;

  select count(*), min(motivo) into v_count, v_slug from public.pontos;
  if v_count <> 1 or v_slug <> 'Ponto Tenant 002' then
    raise exception 'Tenant 002 leu ponto de outro clube: count=%, motivo=%', v_count, v_slug;
  end if;

  select json_array_length(public.ranking_totais() -> 'pessoas') into v_count;
  if v_count <> 1 then
    raise exception 'Ranking total do Tenant 002 cruzou clubes: % pessoas', v_count;
  end if;

  select count(*), min(nome) into v_count, v_slug from public.profiles;
  if v_count <> 1 or v_slug <> 'Usuário Tenant 002' then
    raise exception 'Tenant 002 leu perfil de outro clube: count=%, nome=%', v_count, v_slug;
  end if;

  select count(*), min(nome) into v_count, v_slug from public.listar_usuarios();
  if v_count <> 1 or v_slug <> 'Usuário Tenant 002' then
    raise exception 'listar_usuarios atravessou clubes para Tenant 002: count=%, nome=%', v_count, v_slug;
  end if;

  select count(*), min(legenda) into v_count, v_slug from public.fotos;
  if v_count <> 1 or v_slug <> 'Foto Tenant 002' then
    raise exception 'Tenant 002 leu foto de outro clube: count=%, legenda=%', v_count, v_slug;
  end if;

  select count(*) into v_count from public.club_features where feature = 'leilao' and enabled;
  if v_count <> 0 then
    raise exception 'Tenant 002 recebeu leilão apesar do recurso estar desativado';
  end if;

  select count(*) into v_count from public.temporadas where fim is null;
  if v_count <> 1 then
    raise exception 'Tenant 002 leu temporada de outro clube: %', v_count;
  end if;

  select count(*) into v_count from public.organization_memberships;
  if v_count <> 1 then
    raise exception 'Tenant 002 leu vínculos de outro usuário: %', v_count;
  end if;

  reset role;
end
$$;

rollback;
