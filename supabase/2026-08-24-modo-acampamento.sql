-- =====================================================================
--  Filhos da Conquista — Modo Acampamento (2026-08-24)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Como funciona: a liderança lança a colocação (1º/2º/3º/4º lugar) das
--  unidades numa atividade do acampamento, cada colocação vale os pontos
--  que a liderança definir (editável na tela) — os pontos vão direto pra
--  unidade (somam no ranking geral, junto com o resto). Dá pra usar várias
--  vezes ao longo do acampamento (uma vez por atividade/prova).
--
--  SEGURANÇA: só liderança (instrutor/diretoria) lança, via função
--  security definer — sem policy de INSERT direta em pontos por aqui
--  (a policy já existente da tabela pontos cobre lançamento de unidade
--  por pode_gerir(), mas a função evita ter que confiar em cada chamada
--  isolada + valida "sem colocação repetida" no servidor, não só na tela).
-- =====================================================================

create or replace function public.lancar_colocacao_acampamento(p_atividade text, p_colocacoes jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_unidade_id uuid;
  v_posicao int;
  v_pontos int;
  v_motivo text;
  v_posicoes_usadas int[] := '{}';
  v_lancados int := 0;
begin
  if not public.pode_gerir() then
    raise exception 'Só a liderança pode lançar pontuação do acampamento.';
  end if;
  if p_colocacoes is null or jsonb_typeof(p_colocacoes) <> 'array' or jsonb_array_length(p_colocacoes) = 0 then
    raise exception 'Lance ao menos uma colocação.';
  end if;

  for v_item in select * from jsonb_array_elements(p_colocacoes) loop
    v_unidade_id := nullif(v_item->>'unidade_id', '')::uuid;
    v_posicao := nullif(v_item->>'posicao', '')::int;
    v_pontos := coalesce(nullif(v_item->>'pontos', '')::int, 0);

    if v_unidade_id is null then raise exception 'Colocação sem unidade.'; end if;
    if not exists (select 1 from public.unidades where id = v_unidade_id) then
      raise exception 'Unidade não encontrada.';
    end if;

    if v_posicao is not null then
      if v_posicao <= 0 then raise exception 'Colocação inválida.'; end if;
      if v_posicao = any(v_posicoes_usadas) then
        raise exception 'Duas unidades não podem ficar na mesma colocação.';
      end if;
      v_posicoes_usadas := v_posicoes_usadas || v_posicao;
    end if;

    if v_pontos <> 0 then
      v_motivo := 'Acampamento'
        || case when coalesce(trim(p_atividade), '') <> '' then ': ' || trim(p_atividade) else '' end
        || case when v_posicao is not null then ' — ' || v_posicao || 'º lugar' else '' end;
      insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por)
      values (v_unidade_id, 'acampamento', v_pontos, v_motivo, v_uid);
      v_lancados := v_lancados + 1;
    end if;
  end loop;

  if v_lancados = 0 then raise exception 'Nenhuma unidade com pontos pra lançar.'; end if;

  return json_build_object('ok', true, 'lancados', v_lancados);
end;
$$;
grant execute on function public.lancar_colocacao_acampamento(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
