-- Motor dos desafios globais: rodízio semanal (fase 3)
-- Rodar depois de 2026-10-17-ranking-global-base.sql.
-- A função não cria conteúdo nem atribui estrelas; apenas escolhe jogos do catálogo.

create or replace function public.ranking_global_planejar_semana(
  p_temporada_id uuid,
  p_semana smallint,
  p_chaves text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_inicio date;
  v_fim date;
  v_qtd int := 0;
begin
  if v_uid is null or not public.pode_gerir() then
    raise exception 'Apenas a liderança pode planejar desafios.';
  end if;
  if not exists (select 1 from public.ranking_global_temporadas where id = p_temporada_id and status in ('planejamento','aberta')) then
    raise exception 'Temporada global inválida ou encerrada.';
  end if;
  if p_semana < 1 or p_semana > 53 then raise exception 'Semana inválida.'; end if;
  if exists (select 1 from public.ranking_global_desafios where temporada_id=p_temporada_id and semana=p_semana and ativo) then
    raise exception 'Esta semana já foi planejada.';
  end if;

  select inicio + ((p_semana - 1) * 7), least(fim, inicio + ((p_semana * 7) - 1))
    into v_inicio, v_fim from public.ranking_global_temporadas where id=p_temporada_id;

  -- A lista opcional permite uma curadoria previamente aprovada. Sem lista,
  -- o rodízio prioriza menor uso, não usado na semana anterior e depois chave.
  insert into public.ranking_global_desafios
    (temporada_id, semana, chave, familia, dificuldade, estrelas_max, disponivel_de, disponivel_ate)
  select p_temporada_id, p_semana, j.chave, 'jogo', 'media', 3,
    v_inicio::timestamptz, (v_fim + 1)::timestamptz
  from public.jogos_trilha j
  where j.ativo
    and (p_chaves is null or j.chave = any(p_chaves))
    and not exists (
      select 1 from public.ranking_global_desafios anterior
       where anterior.temporada_id=p_temporada_id and anterior.semana=p_semana-1
         and anterior.chave=j.chave and anterior.ativo
    )
  order by (
    select count(*) from public.ranking_global_desafios historico
     where historico.chave=j.chave and historico.temporada_id=p_temporada_id
  ), j.ordem nulls last, j.chave
  limit 3;

  get diagnostics v_qtd = row_count;
  if v_qtd <> 3 then
    delete from public.ranking_global_desafios where temporada_id=p_temporada_id and semana=p_semana;
    raise exception 'Não há três jogos elegíveis para esta semana.';
  end if;

  return jsonb_build_object('ok',true,'temporada_id',p_temporada_id,'semana',p_semana,'desafios',v_qtd);
end;
$$;

revoke all on function public.ranking_global_planejar_semana(uuid, smallint, text[]) from public, anon;
grant execute on function public.ranking_global_planejar_semana(uuid, smallint, text[]) to authenticated;

create or replace function public.ranking_global_desafios_abertos(p_temporada_id uuid default null)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'temporada_id',d.temporada_id,'semana',d.semana,'chave',d.chave,
    'familia',d.familia,'dificuldade',d.dificuldade,'estrelas_max',d.estrelas_max,
    'disponivel_de',d.disponivel_de,'disponivel_ate',d.disponivel_ate
  ) order by d.semana, d.id),'[]'::jsonb)
  from public.ranking_global_desafios d
  where d.ativo and (p_temporada_id is null or d.temporada_id=p_temporada_id)
    and (d.disponivel_de is null or d.disponivel_de <= now())
    and (d.disponivel_ate is null or d.disponivel_ate > now());
$$;

revoke all on function public.ranking_global_desafios_abertos(uuid) from public, anon;
grant execute on function public.ranking_global_desafios_abertos(uuid) to authenticated;
