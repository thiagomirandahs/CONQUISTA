-- =====================================================================
--  Filhos da Conquista — Jogar VÁRIOS jogos por dia (2026-07-14)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Antes: trava de "1 jogo por dia" (unique usuario_id, data) — feita quando só
--  existia o Jogo da Memória. Isso impedia jogar o 2º jogo mesmo sendo outro.
--
--  Agora: "1 vez por dia POR JOGO" (unique usuario_id, data, tipo). A criança
--  pode jogar os 4, mas cada um só 1x no dia (não dá pra repetir o mesmo e
--  ficar farmando ponto).
--
--  PONTOS (decisão do dono): o 1º jogo do dia vale 10; cada jogo EXTRA vale 5.
--  Jogando os 4: 10 + 5 + 5 + 5 = 25 pontos no dia.
-- =====================================================================

-- 1) tipo nunca pode ser nulo (senão a trava nova não pega)
update public.trilha_jogos set tipo = 'memoria' where tipo is null;
alter table public.trilha_jogos alter column tipo set default 'memoria';
alter table public.trilha_jogos alter column tipo set not null;

-- 2) Derruba a trava antiga (usuario_id, data) — qualquer que seja o nome dela
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'trilha_jogos' and c.contype = 'u'
      -- ::text é obrigatório: attname é do tipo `name` e o Postgres NÃO tem
      -- operador name[] = text[] (sem o cast, o script inteiro dá rollback).
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['data', 'usuario_id']
  loop
    execute format('alter table public.trilha_jogos drop constraint %I', r.conname);
  end loop;
end $$;

-- 3) Trava nova: 1 vez por dia POR JOGO
create unique index if not exists trilha_jogos_usuario_data_tipo_key
  on public.trilha_jogos (usuario_id, data, tipo);

-- 4) registrar_jogo: 1º do dia = 10 pontos; jogos extras = 5
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

  -- ANTI-TRAPAÇA 1: o jogo precisa EXISTIR no catálogo. Sem isso, como a trava
  -- agora inclui o 'tipo', dava pra chamar a função com tipos inventados
  -- ('x1','x2'...) e ganhar pontos sem limite.
  -- NÃO exigimos 'ativo' de propósito: se a liderança desativar um jogo enquanto
  -- a criança está jogando, ela não perde o esforço. O teto continua garantido
  -- pela trava (1x por dia por jogo do catálogo).
  if not exists (select 1 from public.jogos_trilha where chave = v_tipo) then
    raise exception 'Jogo inválido.';
  end if;

  -- ANTI-TRAPAÇA 2: serializa as chamadas do MESMO usuário no MESMO dia, senão
  -- duas jogadas simultâneas leem "nenhum jogo hoje" e ganham 10 pontos as duas.
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

-- 5) meu_progresso_trilha: diz QUAIS jogos já foram jogados hoje (pra tela marcar)
create or replace function public.meu_progresso_trilha()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_passos int := 0;
  v_hoje_tipos json;
begin
  if v_uid is null then
    return json_build_object('feito', false, 'passos', 0, 'hoje', '[]'::json);
  end if;

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;

  select coalesce(json_agg(tipo), '[]'::json) into v_hoje_tipos
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  return json_build_object(
    'feito', exists (select 1 from public.trilha_jogos where usuario_id = v_uid and data = v_hoje),
    'passos', v_passos,
    'hoje', v_hoje_tipos
  );
end;
$$;
grant execute on function public.meu_progresso_trilha() to authenticated;

notify pgrst, 'reload schema';
