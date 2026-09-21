-- =====================================================================
--  Filhos da Conquista — Missões: aprovação das de FOTO + novo placar
--
--  Placar do quiz: acertou = 10, tentou (errou) = 5, não fez = 0.
--  Missão de FOTO (prática, ex.: "faça um nó e tire foto") NÃO pontua na
--  hora: fica PENDENTE e a liderança aprova (aí vale 10) ou reprova (0).
--  Devocional e desafios de quiz continuam pontuando na hora (10/5).
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
-- =====================================================================

-- Status da missão do dia (pendente/aprovada/reprovada) + pontos previstos
alter table public.devocional add column if not exists status text not null default 'aprovada';
alter table public.devocional add column if not exists pontos_dados int default 0;

-- Registrar a missão (pontua na hora se for quiz; foto vai pra aprovação)
create or replace function public.registrar_missao(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_tipo text := 'devocional';
  v_correta int; v_pede_foto boolean := true; v_precisa_aprovar boolean := false;
  v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;

  if v_idx % 2 = 1 then
    with d as (
      select ds.correta, ds.pede_foto, row_number() over (order by ds.created_at, ds.id) - 1 as i
      from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
    ), n as (select count(*) c from d)
    select d.correta, d.pede_foto into v_correta, v_pede_foto
    from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));
    if found then v_tipo := 'desafio'; end if;
  end if;

  if v_tipo = 'devocional' then
    with v as (
      select vs.correta, row_number() over (order by vs.created_at, vs.id) - 1 as i
      from public.versiculos vs where vs.ativo
    ), n as (select count(*) c from v)
    select v.correta into v_correta from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
    v_pede_foto := true;
  end if;

  -- missão prática de foto (desafio com foto) precisa de aprovação; quiz pontua na hora
  v_precisa_aprovar := (v_tipo = 'desafio' and v_pede_foto);
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := case when v_acertou then 10 else 5 end;

  if v_precisa_aprovar then
    insert into public.devocional (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, false, 'pendente', 10);
    return json_build_object('status', 'pendente');
  else
    insert into public.devocional (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, v_acertou, 'aprovada', v_pontos);
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (acertou)' else '' end);
    return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'status', 'aprovada');
  end if;
exception when unique_violation then
  raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_missao(text, int) to authenticated;

-- Resumo do usuário (agora com o status da missão de hoje)
create or replace function public.meu_resumo_devocional()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false; v_foto text; v_status text; v_seq int := 0; v_d date;
begin
  if v_uid is null then return json_build_object('feito', false, 'sequencia', 0); end if;
  select foto_url, status into v_foto, v_status from public.devocional where usuario_id = v_uid and data = v_hoje;
  v_feito := found;
  v_d := case when v_feito then v_hoje else v_hoje - 1 end;
  loop
    exit when not exists (select 1 from public.devocional where usuario_id = v_uid and data = v_d);
    v_seq := v_seq + 1; v_d := v_d - 1;
  end loop;
  return json_build_object('feito', v_feito, 'foto', v_foto, 'sequencia', v_seq, 'status', v_status);
end;
$$;
grant execute on function public.meu_resumo_devocional() to authenticated;

-- Missões de foto aguardando aprovação (só liderança)
create or replace function public.missoes_pendentes()
returns table (id uuid, nome text, foto_url text, data date)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  return query
  select d.id, p.nome, d.foto_url, d.data
  from public.devocional d join public.profiles p on p.id = d.usuario_id
  where d.status = 'pendente' order by d.created_at;
end;
$$;
grant execute on function public.missoes_pendentes() to authenticated;

-- Aprovar (vira pontos) ou reprovar (0) uma missão de foto (só liderança)
create or replace function public.avaliar_missao(p_id uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ativo' and papel in ('instrutor','diretoria')) then
    raise exception 'Sem permissão (apenas diretoria/instrutor).';
  end if;
  select * into v_row from public.devocional where id = p_id and status = 'pendente';
  if not found then raise exception 'Missão não encontrada ou já avaliada.'; end if;
  if p_aprovar then
    update public.devocional set status = 'aprovada' where id = p_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_row.usuario_id, 'missao', coalesce(v_row.pontos_dados, 10), 'Missão ' || to_char(v_row.data, 'DD/MM') || ' (aprovada)');
  else
    update public.devocional set status = 'reprovada' where id = p_id;
  end if;
end;
$$;
grant execute on function public.avaliar_missao(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
