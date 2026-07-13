-- =====================================================================
--  Filhos da Conquista — Jogos da Trilha (ativar/desativar por jogo)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente.
--
--  A Trilha passa a deixar a crianca ESCOLHER qual jogo jogar no dia (entre
--  os ativos). A lideranca liga/desliga cada jogo por aqui. 'memoria' (o
--  original) ja vem ligado; os novos vem desligados pra lideranca ativar.
-- =====================================================================

create table if not exists public.jogos_trilha (
  chave text primary key,          -- 'memoria' | 'genius' | ...
  nome text not null,
  emoji text,
  ativo boolean not null default false,
  ordem int default 0
);
alter table public.jogos_trilha enable row level security;
drop policy if exists "ler jogos_trilha" on public.jogos_trilha;
create policy "ler jogos_trilha" on public.jogos_trilha for select to authenticated using (true);
drop policy if exists "gerir jogos_trilha" on public.jogos_trilha;
create policy "gerir jogos_trilha" on public.jogos_trilha for all to authenticated
  using (public.pode_gerir()) with check (public.pode_gerir());

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('memoria', 'Jogo da Memória', '🧠', true,  1),
  ('genius',  'Siga a Sequência', '🎮', false, 2)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
