-- =============================================================================
--  544 — MODERAÇÃO DA PLATAFORMA SEM PERFIL: 3 colunas "moderado_por" passam a apontar para auth.users
--
--  Achado da auditoria de 05/10/2026: a conta de administrador da plataforma NÃO tem linha em `profiles`. A moderação pelo /admin
--  (admin_comunidade_moderar -> _comunidade_aplicar_moderacao) grava auth.uid() em comunidade_posts.moderado_por,
--  comunidade_comentarios.moderado_por e rede_stories.moderado_por, que eram FK para profiles(id) — aprovar, recusar, restaurar ou
--  remover um item da Rede pelo /admin falhava com violação de chave estrangeira (mesmo defeito do aviso geral, do desafio e dos
--  termos da triagem, já corrigidos nas 537 e 539). A FK passa a apontar para auth.users(id) com a MESMA regra (ON DELETE SET NULL).
--  Nenhum dado muda (todo profiles.id é um auth.users.id). Idempotente.
-- =============================================================================
do $$
declare r record;
begin
  for r in select * from (values
      ('comunidade_posts', 'moderado_por', 'comunidade_posts_moderado_por_fkey'),
      ('comunidade_comentarios', 'moderado_por', 'comunidade_comentarios_moderado_por_fkey'),
      ('rede_stories', 'moderado_por', 'rede_stories_moderado_por_fkey')) as v(tabela, coluna, nome)
  loop
    if exists (select 1 from pg_constraint c where c.conname = r.nome and c.conrelid = ('public.' || r.tabela)::regclass
                  and c.confrelid = 'public.profiles'::regclass) then
      execute format('alter table public.%I drop constraint %I', r.tabela, r.nome);
      execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
                     r.tabela, r.nome, r.coluna);
    end if;
  end loop;
end $$;
