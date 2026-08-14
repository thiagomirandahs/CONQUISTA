-- =====================================================================
--  Filhos da Conquista — Lembrete de AUSÊNCIA + painel de atividade 2026-08-06
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Precisa de pg_cron ativo pro lembrete.
--
--  🎮 Quem ficar 2+ dias sem jogar recebe "Sentimos sua falta!" (1x a cada 2
--  dias, pra não encher o saco). Roda de manhã (10h de Brasília).
--  📊 atividade_jogos(): painel da liderança — quantos jogaram hoje/na semana e
--  quem está sumido (2+ dias sem jogar).
-- =====================================================================

-- 1) LEMBRETE DE AUSÊNCIA (cron 10h) -----------------------------------
create or replace function public.lembrar_ausentes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  -- idempotência: no máximo 1x por dia
  if coalesce((select valor from public.config_clube where chave = 'lembrete_ausencia_dia'), '') = v_hoje::text then
    return;
  end if;

  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      -- 2+ dias sem jogar: nada ontem nem hoje
      and not exists (select 1 from public.trilha_jogos t where t.usuario_id = p.id and t.data >= v_hoje - 1)
      -- não repetir: não lembrado nos últimos 2 dias
      and not exists (
        select 1 from public.notificacoes n
        where n.para_usuario = p.id and n.titulo = '🎮 Sentimos sua falta!'
          and (n.created_at at time zone 'America/Sao_Paulo')::date >= v_hoje - 1
      )
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Sentimos sua falta!',
      'Já faz uns dias que você não joga! Vem ganhar pontos — tem jogo novo te esperando. 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;

  insert into public.config_clube (chave, valor) values ('lembrete_ausencia_dia', v_hoje::text)
  on conflict (chave) do update set valor = excluded.valor;
end;
$$;
revoke all on function public.lembrar_ausentes() from public, anon, authenticated, service_role;

-- 2) PAINEL DE ATIVIDADE (só liderança) --------------------------------
create or replace function public.atividade_jogos()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
begin
  if not public.pode_gerir() then raise exception 'Sem permissão (apenas liderança).'; end if;
  return json_build_object(
    'hoje',   (select count(distinct usuario_id) from public.trilha_jogos where data = v_hoje),
    'semana', (select count(distinct usuario_id) from public.trilha_jogos where data >= v_seg),
    'total',  (select count(*) from public.profiles where status = 'ativo' and papel = 'desbravador' and coalesce(teste, false) = false),
    'ausentes', coalesce((
      select json_agg(json_build_object('id', p.id, 'nome', p.nome, 'foto', p.foto, 'ultimo', u.ultimo)
                      order by u.ultimo nulls first, p.nome)
      from public.profiles p
      left join (select usuario_id, max(data) ultimo from public.trilha_jogos group by usuario_id) u on u.usuario_id = p.id
      where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
        and (u.ultimo is null or u.ultimo < v_hoje - 1)
    ), '[]'::json)
  );
end;
$$;
grant execute on function public.atividade_jogos() to authenticated;
revoke execute on function public.atividade_jogos() from public, anon;

-- 3) Agenda: lembrete de ausência às 10h de Brasília = 13:00 UTC --------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron NÃO está ativo — ative em Database > Extensions (pg_cron) e re-rode este script.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'lembrar-ausentes') then
    perform cron.unschedule('lembrar-ausentes');
  end if;
  perform cron.schedule('lembrar-ausentes', '0 13 * * *', 'select public.lembrar_ausentes()');
  raise notice 'Agendado: lembrar-ausentes (10h de Brasília).';
end $$;

notify pgrst, 'reload schema';
