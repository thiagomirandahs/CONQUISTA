-- =====================================================================
--  Filhos da Conquista — LEDGER de migrations (2026-08-28)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Rode UMA vez. Idempotente. Nada é apagado.
--
--  Cria a tabela que registra QUAIS migrations já foram aplicadas — pra você
--  nunca mais rodar um arquivo antigo depois de um novo (o que reverteria uma
--  função sem avisar). Ver supabase/GUIA-MIGRATIONS.md.
-- =====================================================================

create table if not exists public.migracoes_aplicadas (
  arquivo text primary key,
  aplicada_em timestamptz not null default now()
);

-- Só a diretoria/instrutor enxerga (auditoria); ninguém escreve pela API —
-- o registro é feito pelo próprio SQL de cada migration.
alter table public.migracoes_aplicadas enable row level security;
grant select on public.migracoes_aplicadas to authenticated;

drop policy if exists "ledger leitura lideranca" on public.migracoes_aplicadas;
create policy "ledger leitura lideranca" on public.migracoes_aplicadas
  for select to authenticated using (public.pode_gerir());

-- Registra a si mesmo (exemplo do padrão que toda migration deve seguir no fim):
insert into public.migracoes_aplicadas (arquivo)
values ('2026-08-28-ledger-migrations.sql')
on conflict (arquivo) do update set aplicada_em = now();

notify pgrst, 'reload schema';
