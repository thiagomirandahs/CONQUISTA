-- =====================================================================
--  Filhos da Conquista — Push no celular + aviso diário de aniversário
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. (Também está em supabase/schema.sql.)
--
--  Se "create extension pg_cron" der erro de permissão, habilite antes em
--  Database -> Extensions -> pg_cron, e rode este arquivo de novo.
-- =====================================================================

-- 1) Inscrições de push (cada aparelho que ativou os avisos) -----------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
-- Cada pessoa gerencia as próprias inscrições. O ENVIO é feito pela Edge
-- Function com a service_role (que ignora o RLS), então não precisa de policy de leitura pública.
drop policy if exists "minhas inscricoes" on public.push_subscriptions;
create policy "minhas inscricoes" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Aviso automático de aniversário -----------------------------------------
-- Insere uma notificação 'todos' pra cada aniversariante do dia. Como o webhook
-- de push escuta a tabela notificacoes, o push sai junto automaticamente.
create or replace function public.notif_aniversariantes_hoje()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select nome from public.profiles
    where status = 'ativo' and nascimento is not null
      and to_char(nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🎂 Aniversário hoje!',
            'Hoje é aniversário de ' || coalesce(r.nome, 'um membro') || '. Mande os parabéns! 🥳',
            'aniversario', '/ranking', 'todos');
  end loop;
end;
$$;

-- 3) Agenda a tarefa pra rodar todo dia às 12:00 UTC (~09:00 de Brasília) -----
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('aniversariantes-do-dia');
exception when others then null;  -- ainda não existia: tudo bem
end $$;
select cron.schedule('aniversariantes-do-dia', '0 12 * * *', $$ select public.notif_aniversariantes_hoje(); $$);

notify pgrst, 'reload schema';
