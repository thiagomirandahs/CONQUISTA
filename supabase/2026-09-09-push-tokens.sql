-- =====================================================================
--  Filhos da Conquista — Tokens de push NATIVO (Android/FCM) (2026-09-09)
--
--  Guarda o token FCM de cada aparelho Android (do app empacotado com
--  Capacitor). O envio (edge function enviar-push) lê esta tabela e manda o
--  aviso via FCM. iPhone/web continuam no push web (tabela push_subscriptions).
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
-- =====================================================================

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  plataforma text not null default 'android',
  created_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;
-- Cada pessoa gerencia os próprios tokens. O ENVIO é feito pela edge function
-- com a service_role (ignora RLS), então não precisa de policy de leitura ampla.
drop policy if exists "meus tokens push" on public.push_tokens;
create policy "meus tokens push" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
