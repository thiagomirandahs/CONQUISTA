-- =============================================================================
--  539 — ADMIN DA PLATAFORMA SEM PERFIL: 3 colunas "quem fez" passam a apontar para auth.users (e não mais para profiles)
--
--  Achado de 02/10/2026: "Criar desafio" da Rede DBV pelo /admin falhava com violação de chave estrangeira
--  (rede_desafios_criado_por_fkey). A conta de administrador da plataforma NÃO tem linha em `profiles` (mesmo achado da 537, no aviso geral),
--  e `rede_desafios.criado_por`, `comunidade_termos.criado_por` (lista de termos da triagem) e `comunidade_moderacao_log.por`
--  (moderação feita pela plataforma) eram FK para `profiles(id)`. As três RPCs gravam auth.uid() — que existe em auth.users, não em profiles.
--
--  Correção: a FK passa a apontar para auth.users(id) com a MESMA regra (ON DELETE SET NULL). Nenhum dado muda (todo profiles.id é um auth.users.id);
--  nenhuma função é reescrita. Colunas já eram anuláveis. Idempotente (só troca a FK se ela ainda aponta para profiles).
-- =============================================================================
do $$
declare r record;
begin
  for r in select * from (values
      ('rede_desafios', 'criado_por', 'rede_desafios_criado_por_fkey'),
      ('comunidade_termos', 'criado_por', 'comunidade_termos_criado_por_fkey'),
      ('comunidade_moderacao_log', 'por', 'comunidade_moderacao_log_por_fkey')) as v(tabela, coluna, nome)
  loop
    if exists (select 1 from pg_constraint c where c.conname = r.nome and c.conrelid = ('public.' || r.tabela)::regclass
                  and c.confrelid = 'public.profiles'::regclass) then
      execute format('alter table public.%I drop constraint %I', r.tabela, r.nome);
      execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
                     r.tabela, r.nome, r.coluna);
    end if;
  end loop;
end $$;
