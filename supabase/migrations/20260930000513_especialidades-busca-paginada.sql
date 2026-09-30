-- =============================================================================
--  Fase 7 — Especialidades em ESCALA: busca, filtro por área/situação e paginação por cursor.
--
--  Motivo: especialidades_disponiveis() devolve TODAS as especialidades (com JSON aninhado) numa chamada e
--  não mostra as que a pessoa já iniciou/concluiu. Com as ~552 especialidades (milhares de requisitos) isso não
--  serve para celular em 4G. Esta RPC devolve só uma PÁGINA leve (sem requisitos), com o progresso da pessoa e a
--  dependência já resolvidas, e a lista de áreas na primeira página.
--
--  · paginação por CURSOR (categoria, código): estável, sem "pular" nem repetir linha entre páginas;
--  · busca por nome/código (ILIKE com curingas escapados); filtro por área; situação: todas | disponiveis |
--    iniciadas | concluidas;
--  · só o clube em uso, só recurso ligado, só catálogo OFICIAL publicado (mesmas regras de especialidades_disponiveis).
--  Nenhum dado de outra pessoa entra: o progresso é sempre o de auth.uid().
-- =============================================================================
create index if not exists idx_specialties_lista on public.specialties (curriculum_version_id, categoria, codigo) where ativo;
create index if not exists idx_specialty_requirements_por_especialidade on public.specialty_requirements (specialty_id) where ativo;
create index if not exists idx_member_specialties_pessoa on public.member_specialties (usuario_id, club_id, specialty_id);

create or replace function public.especialidades_buscar(
  p_busca text default null, p_area text default null, p_situacao text default 'todas',
  p_limite int default 30, p_depois text default null)
returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
  v_lim int := least(greatest(coalesce(p_limite, 30), 1), 50);
  v_busca text := nullif(btrim(left(coalesce(p_busca, ''), 60)), '');
  v_padrao text; v_cat text; v_cod text; v_itens json; v_prox text; v_ultimo text; v_total int; v_areas json; v_n int;
begin
  if v_uid is null or v_club is null or not public.membro_ativo_no_clube(v_club) then
    return json_build_object('itens', '[]'::json, 'proximo', null, 'total', 0, 'areas', '[]'::json);
  end if;
  perform public._exigir_especialidades_habilitado(v_club);
  if p_situacao not in ('todas', 'disponiveis', 'iniciadas', 'concluidas') then raise exception 'Situação inválida.'; end if;
  if v_busca is not null then v_padrao := '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  if p_depois is not null then
    if p_depois !~ '^[^|]{1,80}\|[^|]{1,40}$' then raise exception 'Cursor inválido.'; end if;
    v_cat := split_part(p_depois, '|', 1); v_cod := split_part(p_depois, '|', 2);
  end if;

  with base as (
    select sp.id, sp.codigo, sp.nome, sp.categoria, sp.nivel,
           ms.id as ms_id, ms.status as ms_status
      from public.specialties sp
      join public.curriculum_versions v on v.id = sp.curriculum_version_id and v.status = 'publicado' and v.origem = 'oficial'
      left join public.member_specialties ms on ms.usuario_id = v_uid and ms.club_id = v_club and ms.specialty_id = sp.id and ms.status <> 'cancelada'
     where sp.ativo
       and (p_area is null or sp.categoria = p_area)
       and (v_padrao is null or sp.nome ilike v_padrao escape '\' or sp.codigo ilike v_padrao escape '\')
       and case p_situacao
             when 'disponiveis' then ms.id is null
             when 'iniciadas' then ms.status = 'em_andamento'
             when 'concluidas' then ms.status = 'concluida'
             else true end
  ), pagina as (
    -- uma linha a mais que o limite: é assim que se sabe se existe próxima página
    select b.*, row_number() over (order by b.categoria, b.codigo) as rn
      from (select * from base
             where p_depois is null or (categoria, codigo) > (v_cat, v_cod)
             order by categoria, codigo limit v_lim + 1) b
  )
  select (select count(*) from base),
         (select coalesce(json_agg(json_build_object(
             'specialty_id', q.id, 'codigo', q.codigo, 'nome', q.nome, 'categoria', q.categoria, 'nivel', q.nivel,
             'total_requisitos', (select count(*) from public.specialty_requirements r where r.specialty_id = q.id and r.ativo),
             'situacao', case when q.ms_id is null then 'disponivel' else q.ms_status end,
             'member_specialty_id', q.ms_id,
             'percentual', case when q.ms_id is null then null else public.especialidade_percentual(q.ms_id) end,
             'dependencias_pendentes', case when q.ms_id is null then to_json(public.dependencias_pendentes('specialty', q.id, v_uid, v_club)) else '[]'::json end
           ) order by q.rn), '[]'::json) from pagina q where q.rn <= v_lim),
         (select count(*) from pagina),
         (select q.categoria || '|' || q.codigo from pagina q where q.rn = v_lim)
    into v_total, v_itens, v_n, v_ultimo;
  if v_n > v_lim then v_prox := v_ultimo; end if;

  if p_depois is null then
    select coalesce(json_agg(json_build_object('categoria', a.categoria, 'total', a.n) order by a.categoria), '[]'::json) into v_areas
      from (select sp.categoria, count(*) n from public.specialties sp
              join public.curriculum_versions v on v.id = sp.curriculum_version_id and v.status = 'publicado' and v.origem = 'oficial'
             where sp.ativo group by sp.categoria) a;
  end if;
  return json_build_object('itens', v_itens, 'proximo', v_prox, 'total', v_total, 'areas', coalesce(v_areas, '[]'::json));
end;
$$;
revoke all on function public.especialidades_buscar(text, text, text, int, text) from public, anon;
grant execute on function public.especialidades_buscar(text, text, text, int, text) to authenticated;

notify pgrst, 'reload schema';
