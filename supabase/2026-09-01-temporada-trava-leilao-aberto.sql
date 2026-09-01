-- =====================================================================
--  Filhos da Conquista — Temporada NÃO vira com leilão aberto (2026-09-01)
--
--  BUG encontrado na auditoria do leilão: se a diretoria iniciar uma NOVA
--  TEMPORADA enquanto existe um leilão ABERTO, o corte de pontos passa a ser
--  "agora" (temporada_inicio() = now()), então a carteira de TODAS as
--  unidades cai a ~0. No fechamento do leilão o peso vira 0 -> o rateio capa
--  cada parcela em 0 -> NINGUÉM é descontado, mas os itens ainda vão pros
--  vencedores. Resultado: itens de graça e nenhum ponto gasto.
--
--  CORREÇÃO: bloquear nova_temporada() enquanto houver leilão aberto. A
--  diretoria precisa ENCERRAR (desconta com a carteira certa) ou CANCELAR
--  (ninguém perde pontos) o leilão antes de zerar o ranking.
--
--  Redefine nova_temporada — MESMA lógica, só adiciona o guard após o lock.
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
-- =====================================================================

create or replace function public.nova_temporada(p_campeao_individual text, p_campeao_unidade text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_num int;
begin
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo' and papel = 'diretoria') then
    raise exception 'Só a diretoria pode iniciar uma nova temporada.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nova_temporada')); -- serializa cliques simultâneos

  -- NOVO: não deixa virar a temporada com leilão aberto (senão as carteiras
  -- zeram e os itens do leilão sairiam de graça no fechamento).
  if exists (select 1 from public.leiloes where status = 'aberto') then
    raise exception 'Encerre ou cancele o leilão aberto antes de iniciar uma nova temporada.';
  end if;

  update public.temporadas
     set fim = now(), campeao_individual = p_campeao_individual, campeao_unidade = p_campeao_unidade
   where fim is null;

  select coalesce(max(numero), 0) + 1 into v_num from public.temporadas;
  insert into public.temporadas (numero, inicio, criado_por) values (v_num, now(), v_uid);

  return json_build_object('numero', v_num);
end;
$$;
grant execute on function public.nova_temporada(text, text) to authenticated;

notify pgrst, 'reload schema';
