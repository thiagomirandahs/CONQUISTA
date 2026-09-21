-- =====================================================================
--  Filhos da Conquista — Conta de TESTE (2026-07-15)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Uma conta marcada como TESTE pode usar o app à vontade sem sujar nada:
--   * NÃO ganha pontos (nada entra em public.pontos);
--   * NÃO trava no "1x por dia" (repete jogo, missão e devocional sem limite,
--     porque simplesmente não grava o registro do dia);
--   * SOME do ranking e da média da unidade (filtrado no app).
--
--  Quem marca: a diretoria, em Gestão -> 👥 Usuários.
--  As funções só ganham UM atalho no começo — o resto fica idêntico pra todo
--  mundo, então nada muda pras crianças de verdade.
-- =====================================================================

alter table public.profiles add column if not exists teste boolean not null default false;

create or replace function public.eh_teste()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select teste from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.eh_teste() to authenticated;

-- ---------------------------------------------------------------------
-- JOGOS: conta de teste joga sem limite e sem pontuar
-- ---------------------------------------------------------------------
create or replace function public.registrar_jogo(p_tipo text, p_estrelas int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_estrelas int := greatest(1, least(3, coalesce(p_estrelas, 1)));
  v_tipo text := coalesce(nullif(p_tipo, ''), 'memoria');
  v_ja int;
  v_pontos int;
  v_passos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  if not exists (select 1 from public.jogos_trilha where chave = v_tipo) then
    raise exception 'Jogo inválido.';
  end if;

  -- MODO TESTE: não grava nada (nem o jogo do dia, nem pontos) — então dá pra
  -- repetir à vontade. Sai antes de qualquer insert.
  if public.eh_teste() then
    return json_build_object('pontos', 0, 'estrelas', v_estrelas, 'passos', 0, 'extra', false, 'teste', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  v_pontos := case when v_ja = 0 then 10 else 5 end;

  insert into public.trilha_jogos (usuario_id, data, tipo, estrelas)
  values (v_uid, v_hoje, v_tipo, v_estrelas);

  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'trilha', v_pontos,
          'Jogo ' || v_tipo || ' ' || to_char(v_hoje, 'DD/MM') || ' (' || v_estrelas || '*)');

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;

  return json_build_object(
    'pontos', v_pontos, 'estrelas', v_estrelas, 'passos', v_passos, 'extra', (v_ja > 0)
  );
exception when unique_violation then
  raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
end;
$$;
grant execute on function public.registrar_jogo(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- MISSÃO: idem (o quiz ainda é conferido, pra dar pra testar o acerto)
-- ---------------------------------------------------------------------
create or replace function public.registrar_missao(p_foto_url text, p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_classe text; v_correta int; v_pede_foto boolean := false;
  v_acertou boolean := false; v_pontos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select public.classe_por_nascimento(nascimento) into v_classe from public.profiles where id = v_uid;
  with d as (
    select ds.correta, ds.pede_foto, row_number() over (order by ds.created_at, ds.id) - 1 as i
    from public.desafios ds where ds.ativo and (ds.classe = v_classe or ds.classe is null)
  ), n as (select count(*) c from d)
  select d.correta, d.pede_foto into v_correta, v_pede_foto
  from d cross join n where n.c > 0 and d.i = (v_idx % nullif(n.c, 0));

  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);
  v_pontos := case when v_acertou then 10 else 5 end;

  -- MODO TESTE: confere o quiz (pra ver o acerto na tela) mas não grava nada.
  if public.eh_teste() then
    return json_build_object('acertou', v_acertou, 'pontos', 0, 'status', 'aprovada', 'teste', true);
  end if;

  if v_pede_foto then
    insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, false, 'pendente', 10);
    return json_build_object('status', 'pendente');
  else
    insert into public.missoes_feitas (usuario_id, data, foto_url, acertou_quiz, status, pontos_dados)
    values (v_uid, v_hoje, p_foto_url, v_acertou, 'aprovada', v_pontos);
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'missao', v_pontos, 'Missão ' || to_char(v_hoje, 'DD/MM') || case when v_acertou then ' (acertou)' else '' end);
    return json_build_object('acertou', v_acertou, 'pontos', v_pontos, 'status', 'aprovada');
  end if;
exception when unique_violation then raise exception 'Você já fez a missão de hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_missao(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- DEVOCIONAL: idem
-- ---------------------------------------------------------------------
create or replace function public.registrar_devocional(p_resposta int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_idx int := (v_hoje - date '2026-01-01');
  v_correta int; v_acertou boolean := false;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  with v as (
    select vs.correta, row_number() over (order by vs.created_at, vs.id) - 1 as i
    from public.versiculos vs where vs.ativo
  ), n as (select count(*) c from v)
  select v.correta into v_correta from v cross join n where n.c > 0 and v.i = (v_idx % nullif(n.c, 0));
  v_acertou := (p_resposta is not null and v_correta is not null and p_resposta = v_correta);

  -- MODO TESTE: confere o quiz mas não grava nada (o popup volta sempre).
  if public.eh_teste() then
    return json_build_object('acertou', v_acertou, 'pontos', 0, 'teste', true);
  end if;

  insert into public.devocional (usuario_id, data, acertou_quiz)
  values (v_uid, v_hoje, v_acertou);
  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'devocional', 5, 'Devocional ' || to_char(v_hoje, 'DD/MM'));
  return json_build_object('acertou', v_acertou, 'pontos', 5);
exception when unique_violation then
  raise exception 'Você já fez o devocional de hoje! 🙂';
end;
$$;
grant execute on function public.registrar_devocional(int) to authenticated;

-- ---------------------------------------------------------------------
-- A lista de usuários passa a mostrar quem está em teste (pra liderança ver).
-- Precisa de DROP porque muda o formato de retorno (coluna nova).
-- ---------------------------------------------------------------------
drop function if exists public.listar_usuarios();
create function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text, teste boolean)
language sql security definer set search_path = '' as $$
  select p.id, p.nome, p.foto, p.papel, p.status, p.unidade_id, u.email::text, coalesce(p.teste, false)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where exists (
    select 1 from public.profiles eu
    where eu.id = auth.uid() and eu.status = 'ativo' and eu.papel in ('instrutor','diretoria')
  )
  order by p.nome;
$$;
grant execute on function public.listar_usuarios() to authenticated;

notify pgrst, 'reload schema';
