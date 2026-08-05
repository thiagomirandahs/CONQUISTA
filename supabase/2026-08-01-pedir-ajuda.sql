-- =====================================================================
--  Filhos da Conquista — "🆘 Pedir ajuda a um amigo" (jogos) 2026-08-01
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole tudo -> Run.
--  Idempotente. Nada é apagado.
--
--  Nos jogos de palavra difíceis (Anagrama, Forca, Termo), a criança que travar
--  pode mandar o desafio pra um AMIGO escolhido. O amigo resolve e:
--    • quem pediu recebe a resposta e avança;
--    • quem ajudou ganha +5 pontos (no máximo 3 ajudas premiadas por dia).
--
--  Segurança: a tabela `ajudas` fica TOTALMENTE trancada (RLS sem policy +
--  revoke). Tudo passa pelas RPCs abaixo (security definer), que nunca devolvem
--  a 'resposta' pro ajudante — ele precisa REALMENTE resolver.
-- =====================================================================

create table if not exists public.ajudas (
  id uuid primary key default gen_random_uuid(),
  de_id uuid not null references public.profiles(id) on delete cascade,   -- quem pediu
  para_id uuid not null references public.profiles(id) on delete cascade,  -- o amigo escolhido
  jogo text not null,                       -- 'anagrama' | 'forca' | 'termo'
  enunciado jsonb not null,                 -- o que o amigo vê pra resolver (SEM a resposta)
  resposta text not null,                   -- validação server-side (nunca vai pro ajudante)
  status text not null default 'aberto',    -- aberto | resolvido | recusado | cancelado
  resolvido_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists ajudas_para_aberto_idx on public.ajudas (para_id) where status = 'aberto';
create index if not exists ajudas_de_idx on public.ajudas (de_id);

-- Tranca total: ninguém lê/escreve direto. Só as RPCs security definer abaixo.
alter table public.ajudas enable row level security;
revoke all on table public.ajudas from anon, authenticated;

-- Normaliza (tira acento e caixa) pra comparar a resposta com folga.
create or replace function public.norm_txt(t text)
returns text language sql immutable set search_path = '' as $$
  select upper(trim(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
$$;

-- 1) PEDIR AJUDA -------------------------------------------------------
create or replace function public.pedir_ajuda(p_para uuid, p_jogo text, p_enunciado jsonb, p_resposta text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nome text;
  v_nomejogo text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then raise exception 'Sem permissão.'; end if;
  if p_jogo not in ('anagrama', 'forca', 'termo') then raise exception 'Jogo inválido.'; end if;
  if p_para = v_uid then raise exception 'Escolha um amigo (não você mesmo).'; end if;
  if not exists (select 1 from public.profiles where id = p_para and status = 'ativo' and papel <> 'pais') then
    raise exception 'Amigo inválido.';
  end if;
  if coalesce(trim(p_resposta), '') = '' then raise exception 'Desafio sem resposta.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':pedir_ajuda'));
  -- só 1 pedido aberto por vez: o novo cancela o anterior
  update public.ajudas set status = 'cancelado' where de_id = v_uid and status = 'aberto';

  insert into public.ajudas (de_id, para_id, jogo, enunciado, resposta)
  values (v_uid, p_para, p_jogo, p_enunciado, p_resposta)
  returning id into v_id;

  select nome into v_nome from public.profiles where id = v_uid;
  select nome into v_nomejogo from public.jogos_trilha where chave = p_jogo;

  -- notificação direcionada ao amigo (feita aqui dentro pois o cliente não pode inserir notificação)
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
  values ('🆘 Pedido de ajuda!',
    coalesce(v_nome, 'Um amigo') || ' precisou da sua ajuda no ' || coalesce(v_nomejogo, p_jogo) || '! Abra os 🎮 Jogos e ajude.',
    'geral', '/trilha', 'pessoal', p_para, v_uid);

  return v_id;
end;
$$;
grant execute on function public.pedir_ajuda(uuid, text, jsonb, text) to authenticated;
revoke execute on function public.pedir_ajuda(uuid, text, jsonb, text) from public, anon;

-- 2) AJUDAS RECEBIDAS (abertas) — NUNCA devolve a resposta ---------------
create or replace function public.ajudas_recebidas()
returns json language sql stable security definer set search_path = '' as $$
  select case when public.eh_membro_ativo() then coalesce((
    select json_agg(json_build_object(
      'id', a.id, 'jogo', a.jogo, 'enunciado', a.enunciado,
      'de_nome', p.nome, 'de_foto', p.foto, 'criado_em', a.criado_em
    ) order by a.criado_em)
    from public.ajudas a join public.profiles p on p.id = a.de_id
    where a.para_id = auth.uid() and a.status = 'aberto'
  ), '[]'::json) else '[]'::json end;
$$;
grant execute on function public.ajudas_recebidas() to authenticated;
revoke execute on function public.ajudas_recebidas() from public, anon;

-- 3) RESOLVER AJUDA (+5 pro ajudante, máx 3/dia) ------------------------
create or replace function public.resolver_ajuda(p_id uuid, p_tentativa text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_a public.ajudas%rowtype;
  v_nome text;
  v_nomejogo text;
  v_teste boolean;
  v_ja int;
  v_ganhou int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then raise exception 'Sem permissão.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':resolver_ajuda:' || v_hoje::text));

  select * into v_a from public.ajudas where id = p_id and para_id = v_uid and status = 'aberto';
  if not found then return json_build_object('ok', false, 'erro', 'sumiu'); end if;

  if public.norm_txt(p_tentativa) <> public.norm_txt(v_a.resposta) then
    return json_build_object('ok', false);  -- errou; pode tentar de novo
  end if;

  update public.ajudas set status = 'resolvido', resolvido_por = v_uid, resolvido_em = now() where id = p_id;

  -- +5 pro ajudante, no máximo 3 ajudas premiadas por dia (conta teste não pontua)
  select coalesce(teste, false) into v_teste from public.profiles where id = v_uid;
  if not coalesce(v_teste, false) then
    select count(*) into v_ja from public.pontos
    where usuario_id = v_uid and origem = 'ajuda'
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje;
    if v_ja < 3 then
      select nome into v_nome from public.profiles where id = v_a.de_id;
      select nome into v_nomejogo from public.jogos_trilha where chave = v_a.jogo;
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (v_uid, 'ajuda', 5, '🤝 Ajudou ' || coalesce(v_nome, 'um amigo') || ' no ' || coalesce(v_nomejogo, v_a.jogo));
      v_ganhou := 5;
    end if;
  end if;

  -- avisa quem pediu (com o nome do ajudante)
  select nome into v_nome from public.profiles where id = v_uid;
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
  values ('🎉 Você foi ajudado!',
    coalesce(v_nome, 'Um amigo') || ' resolveu seu desafio! Abra o jogo pra ver a resposta.',
    'geral', '/trilha', 'pessoal', v_a.de_id, v_uid);

  return json_build_object('ok', true, 'ganhou', v_ganhou);
end;
$$;
grant execute on function public.resolver_ajuda(uuid, text) to authenticated;
revoke execute on function public.resolver_ajuda(uuid, text) from public, anon;

-- 4) STATUS (quem pediu fica checando) — só o dono do pedido ------------
create or replace function public.ajuda_status(p_id uuid)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_a public.ajudas%rowtype;
  v_nome text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into v_a from public.ajudas where id = p_id and de_id = v_uid;
  if not found then return json_build_object('status', 'nao'); end if;
  if v_a.resolvido_por is not null then
    select nome into v_nome from public.profiles where id = v_a.resolvido_por;
  end if;
  return json_build_object(
    'status', v_a.status,
    'resposta', case when v_a.status = 'resolvido' then v_a.resposta else null end,
    'ajudante', v_nome
  );
end;
$$;
grant execute on function public.ajuda_status(uuid) to authenticated;
revoke execute on function public.ajuda_status(uuid) from public, anon;

-- 5) CANCELAR (quem pediu desiste) e RECUSAR (o amigo não pode) ---------
create or replace function public.cancelar_ajuda(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  update public.ajudas set status = 'cancelado'
  where id = p_id and de_id = v_uid and status = 'aberto';
end;
$$;
grant execute on function public.cancelar_ajuda(uuid) to authenticated;
revoke execute on function public.cancelar_ajuda(uuid) from public, anon;

create or replace function public.recusar_ajuda(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  update public.ajudas set status = 'recusado'
  where id = p_id and para_id = v_uid and status = 'aberto';
end;
$$;
grant execute on function public.recusar_ajuda(uuid) to authenticated;
revoke execute on function public.recusar_ajuda(uuid) from public, anon;

notify pgrst, 'reload schema';
