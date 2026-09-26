-- =============================================================================
--  VITRINE AUTOMÁTICA PARA TODOS OS CLUBES (decisão do dono, 26/09: "os clubes cadastrados são meus; os
--  próximos a gente nem pergunta, já deixa aparecendo"). Adaptação da regra preparada para o aceite dos
--  Termos (ainda não publicados): todo clube ATIVO aparece em /clubes só com dados INSTITUCIONAIS
--  (nome, sigla, lema, cor, logo, cidade/UF, região/distrito). CONTATOS e nome do diretor continuam
--  OPT-IN (LGPD: dado pessoal). A diretoria pode pedir para ocultar; o admin modera (oculto_moderacao).
-- =============================================================================
alter table public.club_showcase add column if not exists oculto_diretoria boolean not null default false;
alter table public.club_showcase add column if not exists oculto_diretoria_em timestamptz;

-- região/distrito: a unidade pai mais próxima do tipo distrito/região (nome institucional)
create or replace function public._vitrine_regiao(p_parent uuid) returns text
language sql stable security definer set search_path = '' as $$
  with recursive sobe as (
    select id, parent_id, type, nome, 1 as nivel from public.organizational_units where id = p_parent
    union all
    select o.id, o.parent_id, o.type, o.nome, s.nivel + 1 from public.organizational_units o join sobe s on o.id = s.parent_id
     where s.nivel < 6
  )
  select nome from sobe where type in ('distrito', 'regiao') order by nivel limit 1;
$$;
revoke all on function public._vitrine_regiao(uuid) from public, anon, authenticated;

-- o clube PODE aparecer na lista? (única regra de visibilidade, usada pelas RPCs públicas e pelo admin)
create or replace function public._vitrine_clube_listavel(o public.organizational_units, s public.club_showcase)
returns boolean language sql stable security definer set search_path = '' as $$
  select o.type = 'clube' and o.status = 'ativo' and o.slug is not null
     and not coalesce(s.oculto_moderacao, false)
     and not coalesce(s.oculto_diretoria, false)
     and true;
$$;
revoke all on function public._vitrine_clube_listavel(public.organizational_units, public.club_showcase) from public, anon, authenticated;

-- o cartão como o PÚBLICO vê. s pode ser NULL (clube listado pelo aceite, sem cartão preenchido).
-- Extras e contatos: só com o cartão ligado (opt-in da 190).
create or replace function public._vitrine_cartao_publico(s public.club_showcase, o public.organizational_units, p_completo boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'slug', o.slug,
    'nome', o.nome,
    'sigla', o.metadata -> 'marca' ->> 'sigla',
    'lema', o.metadata -> 'marca' ->> 'lema',
    'cor', o.metadata -> 'marca' ->> 'cor_primaria',
    'logo_url', o.metadata -> 'marca' ->> 'logo_url',
    'cidade', s.cidade,
    'estado', s.estado,
    'regiao', public._vitrine_regiao(o.parent_id)
  ) || case when p_completo and coalesce(s.ativo and s.aceite_contato, false) then jsonb_strip_nulls(jsonb_build_object(
    'apresentacao', s.apresentacao,
    'reuniao_dia', s.reuniao_dia,
    'reuniao_horario', s.reuniao_horario,
    'reuniao_local', s.reuniao_local,
    'diretor_nome', case when s.publicar_nome then s.diretor_nome end,
    'whatsapp', case when s.publicar_whatsapp then s.diretor_whatsapp end,
    'email', case when s.publicar_email then s.diretor_email end,
    'link_inscricao', s.link_inscricao
  )) else '{}'::jsonb end);
$$;
revoke all on function public._vitrine_cartao_publico(public.club_showcase, public.organizational_units, boolean) from public, anon, authenticated;

create or replace function public.vitrine_clubes_publico()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._vitrine_registrar_acesso();
  return coalesce((
    select jsonb_agg(public._vitrine_cartao_publico(s, o, false) order by o.nome)
      from public.organizational_units o
      left join public.club_showcase s on s.club_id = o.id
     where o.type = 'clube' and public._vitrine_clube_listavel(o, s)
  ), '[]'::jsonb);
end $$;
revoke all on function public.vitrine_clubes_publico() from public;
grant execute on function public.vitrine_clubes_publico() to anon, authenticated;

create or replace function public.vitrine_clube_publico(p_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public._vitrine_registrar_acesso();
  select public._vitrine_cartao_publico(s, o, true) into v
    from public.organizational_units o
    left join public.club_showcase s on s.club_id = o.id
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.type = 'clube'
     and public._vitrine_clube_listavel(o, s);
  -- inexistente, sem aceite ou ocultado: MESMA resposta (não confirma que o slug existe)
  return coalesce(v, jsonb_build_object('encontrado', false)) || case when v is null then '{}'::jsonb else '{"encontrado":true}'::jsonb end;
end $$;
revoke all on function public.vitrine_clube_publico(text) from public;
grant execute on function public.vitrine_clube_publico(text) to anon, authenticated;

-- a diretoria lê o próprio cartão: agora também sabe se está na lista e por quê
create or replace function public.vitrine_clube_ler(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null or not (public.pode_administrar_clube(p_club_id) or public.eh_admin_plataforma()) then
    raise exception 'Clube não encontrado ou sem permissão.';
  end if;
  select coalesce(to_jsonb(s) - 'aceite_por' - 'oculto_por' - 'updated_by', jsonb_build_object('ativo', false, 'aceite_contato', false, 'oculto_diretoria', false))
         || jsonb_build_object('slug', o.slug,
                               'termos_aceitos', false,
                               'na_lista_publica', public._vitrine_clube_listavel(o, s))
    into v
    from public.organizational_units o
    left join public.club_showcase s on s.club_id = o.id
   where o.id = p_club_id and o.type = 'clube';
  if v is null then raise exception 'Clube não encontrado ou sem permissão.'; end if;
  return v;
end $$;
revoke all on function public.vitrine_clube_ler(uuid) from public, anon;
grant execute on function public.vitrine_clube_ler(uuid) to authenticated;

-- a diretoria pede para ocultar (ou voltar a mostrar) o clube na lista pública
create or replace function public.vitrine_clube_ocultar(p_club_id uuid, p_ocultar boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_club_id is null or not public.pode_administrar_clube(p_club_id)
     or not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Clube não encontrado ou sem permissão.';
  end if;
  insert into public.club_showcase as s (club_id, oculto_diretoria, oculto_diretoria_em, updated_at, updated_by)
  values (p_club_id, coalesce(p_ocultar, false), case when p_ocultar then now() end, now(), v_uid)
  on conflict (club_id) do update set
    oculto_diretoria = excluded.oculto_diretoria, oculto_diretoria_em = excluded.oculto_diretoria_em,
    updated_at = now(), updated_by = v_uid;
  return public.vitrine_clube_ler(p_club_id);
end $$;
revoke all on function public.vitrine_clube_ocultar(uuid, boolean) from public, anon;
grant execute on function public.vitrine_clube_ocultar(uuid, boolean) to authenticated;

-- admin: todos os clubes que aparecem ou poderiam aparecer (aceite ou cartão), com o motivo
create or replace function public.admin_vitrine_clubes_listar()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin_plataforma();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'club_id', o.id, 'slug', o.slug, 'nome', o.nome, 'cidade', s.cidade, 'estado', s.estado,
             'ativo', coalesce(s.ativo, false), 'aceite_contato', coalesce(s.aceite_contato, false),
             'termos_aceitos', false,
             'oculto_diretoria', coalesce(s.oculto_diretoria, false),
             'oculto_moderacao', coalesce(s.oculto_moderacao, false),
             'oculto_motivo', s.oculto_motivo, 'updated_at', s.updated_at,
             'visivel', public._vitrine_clube_listavel(o, s))
           order by o.nome)
      from public.organizational_units o
      left join public.club_showcase s on s.club_id = o.id
     where o.type = 'clube'
  ), '[]'::jsonb);
end $$;
revoke all on function public.admin_vitrine_clubes_listar() from public, anon;
grant execute on function public.admin_vitrine_clubes_listar() to authenticated;

-- moderar também clube listado só pelo aceite (sem cartão ainda): cria a linha
create or replace function public.admin_vitrine_clube_moderar(p_club_id uuid, p_ocultar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._exigir_admin_plataforma();
begin
  if p_ocultar and nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Informe o motivo para ocultar o cartão.';
  end if;
  if not exists (select 1 from public.organizational_units where id = p_club_id and type = 'clube') then
    raise exception 'Cartão não encontrado.';
  end if;
  insert into public.club_showcase as s (club_id, oculto_moderacao, oculto_motivo, oculto_em, oculto_por)
  values (p_club_id, coalesce(p_ocultar, false), case when p_ocultar then left(btrim(p_motivo), 300) end,
          case when p_ocultar then now() end, case when p_ocultar then v_uid end)
  on conflict (club_id) do update set
    oculto_moderacao = excluded.oculto_moderacao, oculto_motivo = excluded.oculto_motivo,
    oculto_em = excluded.oculto_em, oculto_por = excluded.oculto_por;
  perform public._admin_auditar(case when p_ocultar then 'vitrine_ocultar' else 'vitrine_reexibir' end, 'clube', p_club_id,
                                jsonb_build_object('motivo', p_motivo));
end $$;
revoke all on function public.admin_vitrine_clube_moderar(uuid, boolean, text) from public, anon;
grant execute on function public.admin_vitrine_clube_moderar(uuid, boolean, text) to authenticated;
