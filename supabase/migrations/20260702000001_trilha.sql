-- =====================================================================
--  Filhos da Conquista — Trilha do Acampamento (v1: Jogo da Memória)
--
--  Mini-jogo diário (1x/dia): a criança joga e AVANÇA 1 posto na trilha
--  (6 postos, um por classe). Ganha 10 pontos + estrelas (desempenho).
--  Pontos entram no ranking. Cheat-resistant: pontos fixos + 1x/dia.
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
-- =====================================================================

create table if not exists public.trilha_jogos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.profiles(id) on delete cascade,
  data date not null,
  tipo text,
  estrelas int default 1,
  created_at timestamptz default now(),
  unique (usuario_id, data)
);
alter table public.trilha_jogos enable row level security;
drop policy if exists "ler trilha_jogos" on public.trilha_jogos;
create policy "ler trilha_jogos" on public.trilha_jogos for select to authenticated
  using (usuario_id = auth.uid() or public.pode_gerir());

-- Meu progresso na trilha (jogou hoje? quantos passos no total)
create or replace function public.meu_progresso_trilha()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_feito boolean := false; v_passos int := 0;
begin
  if v_uid is null then return json_build_object('feito', false, 'passos', 0); end if;
  v_feito := exists (select 1 from public.trilha_jogos where usuario_id = v_uid and data = v_hoje);
  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;
  return json_build_object('feito', v_feito, 'passos', v_passos);
end;
$$;
grant execute on function public.meu_progresso_trilha() to authenticated;

-- Registra o jogo do dia: +10 pontos, avança 1 passo, 1x/dia
create or replace function public.registrar_jogo(p_tipo text, p_estrelas int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_estrelas int := greatest(1, least(3, coalesce(p_estrelas, 1)));
  v_pontos int := 10;
  v_passos int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  insert into public.trilha_jogos (usuario_id, data, tipo, estrelas)
  values (v_uid, v_hoje, coalesce(p_tipo, 'memoria'), v_estrelas);
  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'trilha', v_pontos, 'Trilha ' || to_char(v_hoje, 'DD/MM') || ' (' || v_estrelas || '*)');
  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;
  return json_build_object('pontos', v_pontos, 'estrelas', v_estrelas, 'passos', v_passos);
exception when unique_violation then
  raise exception 'Você já jogou hoje! Volte amanhã. 🙂';
end;
$$;
grant execute on function public.registrar_jogo(text, int) to authenticated;

notify pgrst, 'reload schema';
