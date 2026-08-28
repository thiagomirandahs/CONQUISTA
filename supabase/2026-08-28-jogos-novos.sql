-- =====================================================================
--  Filhos da Conquista — 4 jogos novos do motor (2026-08-28)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  🏀 Arremesso (basquete)  🎣 Pescaria (pesca)  🔦 Caverna (caverna)
--  🏹 Arco e Flecha (arco) — todos jogos NORMAIS (estrelas 1x/dia, entram no
--  rodízio dos Jogos do Dia). Entram DESLIGADOS — ligar em Gestão -> 🎮.
--
--  Todos rodam no motor Phaser (precisam de WebGL): a coluna requer_webgl
--  marca isso pra eles NÃO serem exigidos no bônus de "completar o dia"
--  (nem todo celular os roda). Pode rodar antes OU depois do
--  2026-08-28-jogos-do-dia.sql — os dois criam a coluna (idempotente).
-- =====================================================================

alter table public.jogos_trilha add column if not exists requer_webgl boolean not null default false;

insert into public.jogos_trilha (chave, nome, emoji, ativo, ordem) values
  ('basquete', 'Arremesso', '🏀', false, 23),
  ('pesca', 'Pescaria', '🎣', false, 24),
  ('caverna', 'Caverna', '🔦', false, 25),
  ('arco', 'Arco e Flecha', '🏹', false, 26)
on conflict (chave) do nothing;

update public.jogos_trilha set requer_webgl = true
  where chave in ('futebol', 'basquete', 'pesca', 'caverna', 'arco');

notify pgrst, 'reload schema';
