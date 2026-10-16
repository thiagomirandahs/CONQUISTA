-- 549 — Validade de autoridade e isolamento de operações sensíveis.
-- Preserva as alterações dinâmicas de permissões/auditoria/histórico anteriores.
begin;
-- Clientes da API não precisam criar objetos na superfície pública do banco.
revoke create on schema public from public,anon,authenticated;
do $$ begin
  if to_regprocedure('public._seg549_excluir_usuario(uuid)') is null then
    alter function public.excluir_usuario(uuid) rename to _seg549_excluir_usuario;
  end if;
  if to_regprocedure('public._seg549_rejeitar_vinculo(uuid)') is null then
    alter function public.rejeitar_vinculo(uuid) rename to _seg549_rejeitar_vinculo;
  end if;
end $$;
revoke all on function public._seg549_excluir_usuario(uuid) from public,anon,authenticated,service_role;
revoke all on function public._seg549_rejeitar_vinculo(uuid) from public,anon,authenticated,service_role;

create or replace function public.excluir_usuario(p_id uuid) returns json
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.clube_atual_id() is null or not public.pode_administrar_clube(public.clube_atual_id()) then
    raise exception 'Só a diretoria com vínculo vigente pode excluir usuários.';
  end if;
  if not public._tem_vinculo(p_id,public.clube_atual_id(),false) then
    raise exception 'Só a diretoria do clube desta pessoa pode excluir usuários.';
  end if;
  -- Não revela responsabilidade global de um UUID alheio: checa vínculo primeiro.
  if exists(select 1 from public.platform_admins where user_id=p_id) then
    raise exception 'Esta conta tem responsabilidades fora do clube. Desative o vínculo em vez de excluir a conta.';
  end if;
  return public._seg549_excluir_usuario(p_id);
end $$;
revoke all on function public.excluir_usuario(uuid) from public,anon;
grant execute on function public.excluir_usuario(uuid) to authenticated;

create or replace function public.rejeitar_vinculo(p_id uuid) returns json
language plpgsql security definer set search_path='' as $$
declare v_club uuid;
begin
  select club_id into v_club from public.responsaveis where id=p_id;
  if v_club is null or v_club is distinct from public.clube_atual_id() or not public.pode_administrar_clube(v_club) then
    raise exception 'Só a diretoria do clube em uso com vínculo vigente.';
  end if;
  return public._seg549_rejeitar_vinculo(p_id);
end $$;
revoke all on function public.rejeitar_vinculo(uuid) from public,anon;
grant execute on function public.rejeitar_vinculo(uuid) to authenticated;

-- Não notifica quem está fora da validade do vínculo, ainda que status seja ativo.
create or replace function public._push_publico(p_club_id uuid,p_para text,p_para_usuario uuid)
returns setof uuid language sql stable security definer set search_path='' as $$
  select m.user_id from public.organization_memberships m
  where p_club_id is not null and m.organizational_unit_id=p_club_id and m.status='ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    and ((p_para_usuario is not null and m.user_id=p_para_usuario)
      or (p_para_usuario is null and p_para='lideranca' and m.role in ('instrutor','diretoria'))
      or (p_para_usuario is null and p_para='todos' and m.role<>'pais'));
$$;
revoke all on function public._push_publico(uuid,text,uuid) from public,anon,authenticated;

-- Corrige a definição VIVA do suporte, sem apagar ajustes feitos depois da migration 290.
do $$
declare original text; corrigido text;
begin
  original := pg_get_functiondef('public.suporte_chamado_abrir(text,text,text,text,text,jsonb)'::regprocedure);
  if original not like '%pg_advisory_xact_lock(549,%' then
    corrigido := replace(original,
      '  -- limite: 5 chamados abertos por pessoa em 24h',
      E'  -- Serializa chamadas da mesma conta antes de contar tickets.\n  perform pg_catalog.pg_advisory_xact_lock(549,pg_catalog.hashtext(v_uid::text));\n  -- limite: 5 chamados abertos por pessoa em 24h');
    if corrigido=original then raise exception 'Ponto de correção do limite de suporte não encontrado.'; end if;
    execute corrigido;
  end if;
end $$;
do $$
declare original text; corrigido text;
begin
  original := pg_get_functiondef('public.suporte_chamado_abrir(text,text,text,text,text,jsonb)'::regprocedure);
  if original like '%m.status = ''ativo'' and m.role = ''diretoria''%' then
    corrigido := replace(original,
      'm.status = ''ativo'' and m.role = ''diretoria''',
      'm.status = ''ativo'' and m.role = ''diretoria'' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())');
    execute corrigido;
  elsif original not like '%public.pode_administrar_clube(%' and original not like '%m.ends_at > now()%' then
    raise exception 'Checagem da prioridade de suporte não encontrada.';
  end if;
end $$;
insert into public.migracoes_aplicadas(arquivo) values('2026-10-14-autoridade-vigente-e-protecao-dados.sql') on conflict(arquivo) do nothing;
notify pgrst,'reload schema';
commit;
