-- Ranking global: registro protegido de resultados (fase 2)
-- Rodar depois de 2026-10-17-ranking-global-base.sql e da migration de partidas.
-- O cliente nunca recebe INSERT direto na tabela de resultados.

create or replace function public.registrar_ranking_global(
  p_desafio_id uuid,
  p_partida_id uuid,
  p_estrelas smallint,
  p_aproveitamento numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_desafio public.ranking_global_desafios%rowtype;
  v_partida public.partidas%rowtype;
  v_tentativa smallint;
  v_estrelas smallint;
  v_aproveitamento numeric(5,2);
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_desafio_id is null or p_partida_id is null then
    raise exception 'Desafio e partida são obrigatórios.';
  end if;

  select * into v_desafio
    from public.ranking_global_desafios
   where id = p_desafio_id and ativo;
  if not found then raise exception 'Desafio global indisponível.'; end if;

  if v_desafio.disponivel_de is not null and now() < v_desafio.disponivel_de then
    raise exception 'Este desafio ainda não abriu.';
  end if;
  if v_desafio.disponivel_ate is not null and now() > v_desafio.disponivel_ate then
    raise exception 'O prazo deste desafio terminou.';
  end if;

  select * into v_partida from public.partidas
   where id = p_partida_id and usuario_id = v_uid
     and jogo = v_desafio.chave and consumida_em is null;
  if not found then raise exception 'Partida inválida, expirada ou já utilizada.'; end if;
  if v_partida.validade_em < now() then raise exception 'A partida expirou.'; end if;

  select coalesce(max(tentativa), 0) + 1 into v_tentativa
    from public.ranking_global_resultados
   where desafio_id = p_desafio_id and usuario_id = v_uid;
  if v_tentativa > 2 then raise exception 'Limite de tentativas atingido.'; end if;

  v_estrelas := greatest(0, least(v_desafio.estrelas_max, coalesce(p_estrelas, 0)));
  v_aproveitamento := greatest(0, least(100, coalesce(p_aproveitamento, 0)))::numeric(5,2);

  update public.partidas
     set consumida_em = now(), resultado = v_estrelas
   where id = p_partida_id and consumida_em is null;
  if not found then raise exception 'A partida já foi consumida.'; end if;

  insert into public.ranking_global_resultados
    (desafio_id, usuario_id, tentativa, estrelas, aproveitamento, primeira_tentativa, validado_em)
  values
    (p_desafio_id, v_uid, v_tentativa, v_estrelas, v_aproveitamento, v_tentativa = 1, now());

  return jsonb_build_object(
    'ok', true, 'tentativa', v_tentativa, 'estrelas', v_estrelas,
    'aproveitamento', v_aproveitamento
  );
exception when unique_violation then
  raise exception 'Esta tentativa já foi registrada.';
end;
$$;

revoke all on function public.registrar_ranking_global(uuid, uuid, smallint, numeric) from public, anon;
grant execute on function public.registrar_ranking_global(uuid, uuid, smallint, numeric) to authenticated;
