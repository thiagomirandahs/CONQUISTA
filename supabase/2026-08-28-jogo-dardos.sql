-- =====================================================================
--  Filhos da Conquista — 🎯 Dardos (2026-08-28)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  🎯 Dardos: a mira dança sozinha sobre o alvo (cada dardo mais rápido) e a
--  criança toca na hora certa. Mosca 3 / verde 2 / resto 1 — máx 15 em 5
--  dardos (12+ = 3⭐, 7+ = 2⭐). Jogo NORMAL (estrelas 1x/dia, entra no
--  rodízio). Entra DESLIGADO — ligar em Gestão -> 🎮. Requer WebGL (motor):
--  não é exigido no bônus de completar o dia.
-- =====================================================================

alter table public.jogos_trilha add column if not exists requer_webgl boolean not null default false;

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('dardos', 'Dardos', '🎯', false, 27)
on conflict (chave) do nothing;

update public.jogos_trilha set requer_webgl = true where chave = 'dardos';

notify pgrst, 'reload schema';
