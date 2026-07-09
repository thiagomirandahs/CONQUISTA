-- =====================================================================
--  Filhos da Conquista — Agenda do clube (eventos + lembrete na véspera)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Reusa o push que já existe (o lembrete entra em
--  notificacoes e o webhook manda pro celular sozinho).
--
--  Se "create extension pg_cron" der erro de permissão, habilite antes em
--  Database -> Extensions -> pg_cron e rode de novo.
-- =====================================================================

-- 1) Eventos: todos leem (é a agenda); só a liderança cria/edita -----------
create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text,                       -- Reunião | Acampamento | Passeio | Culto | Evento
  data date not null,
  hora text,                       -- ex.: '15:00'
  local text,
  descricao text,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_eventos_data on public.eventos(data);
alter table public.eventos enable row level security;
drop policy if exists "ler eventos" on public.eventos;
create policy "ler eventos" on public.eventos for select to authenticated using (true);
drop policy if exists "gerir eventos" on public.eventos;
create policy "gerir eventos" on public.eventos for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

-- 2) Lembrete na véspera: avisa TODOS dos eventos de AMANHÃ -----------------
create or replace function public.notif_eventos_amanha()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_amanha date := ((now() at time zone 'America/Sao_Paulo')::date + 1);
begin
  for r in select titulo, hora, local from public.eventos where data = v_amanha loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values (
      '📅 Amanhã: ' || r.titulo,
      nullif(concat_ws(' · ', nullif(r.hora, ''), nullif(r.local, '')), ''),
      'geral', '/agenda', 'todos');
  end loop;
end;
$$;

-- 3) Agenda o lembrete pra rodar todo dia às 12:00 UTC (~09:00 de Brasília)
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('lembrete-eventos');
exception when others then null;  -- ainda não existia: tudo bem
end $$;
select cron.schedule('lembrete-eventos', '0 12 * * *', $$ select public.notif_eventos_amanha(); $$);

notify pgrst, 'reload schema';
