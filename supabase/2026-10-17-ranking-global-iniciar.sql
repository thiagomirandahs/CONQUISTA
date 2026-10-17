-- Motor dos desafios globais: iniciar uma partida (fase 4)
-- Rodar depois do motor semanal e da migration de partidas.

create or replace function public.ranking_global_iniciar(p_desafio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_desafio public.ranking_global_desafios%rowtype;
  v_partida json;
  v_tentativas int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_desafio from public.ranking_global_desafios
   where id=p_desafio_id and ativo;
  if not found then raise exception 'Desafio indisponível.'; end if;
  if v_desafio.disponivel_de is not null and now() < v_desafio.disponivel_de then raise exception 'O desafio ainda não abriu.'; end if;
  if v_desafio.disponivel_ate is not null and now() >= v_desafio.disponivel_ate then raise exception 'O desafio já encerrou.'; end if;

  select count(*) into v_tentativas
    from public.ranking_global_resultados where desafio_id=p_desafio_id and usuario_id=v_uid;
  if v_tentativas >= 2 then raise exception 'Você já usou as duas tentativas deste desafio.'; end if;

  -- A mesma trava de partida usada pelos jogos atuais: dono, validade e jogo
  -- são registrados no servidor antes de a criança começar.
  v_partida := public.iniciar_jogo(v_desafio.chave);
  return jsonb_build_object('ok',true,'desafio_id',v_desafio.id,'chave',v_desafio.chave,
    'semana',v_desafio.semana,'estrelas_max',v_desafio.estrelas_max,
    'partida_id',v_partida->>'id','validade_em',v_partida->>'validade_em');
end;
$$;

revoke all on function public.ranking_global_iniciar(uuid) from public, anon;
grant execute on function public.ranking_global_iniciar(uuid) to authenticated;
