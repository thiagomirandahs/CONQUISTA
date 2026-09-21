-- =====================================================================
-- PRÉ-VOO da produção — SOMENTE LEITURA (não altera nada). Rode no SQL Editor ANTES de aplicar
-- as migrations 20260921000001..19 e só siga se a linha RESUMO disser "ok".
--
-- Por quê: as migrations novas dependem de tabelas/colunas/funções criadas pelos SQLs antigos
-- (ajudas, partidas, bichinho-sono, rodizio, ledger...). Se algum SQL antigo nunca foi rodado em
-- produção, a migration correspondente aborta no meio com um erro obscuro (o SQL Editor é atômico,
-- então nada quebra — mas a janela de manutenção seria perdida). Aqui o "o que falta" vem claro,
-- com o nome do arquivo antigo que precisa rodar primeiro. Também confere dados que fariam a
-- migration falhar (nome de unidade repetido, mensalidade duplicada, papel fora do vocabulário).
--
-- Resultado: uma tabela (verificacao, status, detalhe); PROBLEMA primeiro. Tudo "ok" = pode aplicar.
-- =====================================================================
with
tabelas(nome, arquivo) as (values
    ('ajudas', '2026-08-01-pedir-ajuda.sql'),
    ('atividades', 'schema base (baseline)'),
    ('biblia_leitura_atual', '2026-08-26-biblia-antifarm.sql'),
    ('biblia_leituras', '2026-08-26-biblia.sql'),
    ('biblia_livros', '2026-08-26-biblia.sql'),
    ('biblia_versiculos', '2026-08-26-biblia.sql'),
    ('bichinhos', '2026-08-26-bichinho.sql'),
    ('chat_conversas', '2026-08-24-chat.sql'),
    ('chat_mensagens', '2026-08-24-chat.sql'),
    ('chat_participantes', '2026-08-24-chat.sql'),
    ('chefao_golpes', '2026-08-29-chefao-fds.sql'),
    ('config_clube', '2026-07-14-portal-pais.sql'),
    ('desafios', 'schema base (baseline)'),
    ('desafios_unidade', '2026-07-14-duelos.sql'),
    ('devocional', 'schema base (baseline)'),
    ('duelos', '2026-07-14-duelos.sql'),
    ('entregas', 'schema base (baseline)'),
    ('eventos', '2026-07-09-agenda.sql'),
    ('fotos', 'schema base (baseline)'),
    ('jogos_liberados', '2026-08-28-jogos-do-dia.sql'),
    ('jogos_trilha', '2026-07-09-jogos-trilha.sql'),
    ('leilao_itens', '2026-08-18-leilao.sql'),
    ('leilao_lance_unidades', '2026-08-18-leilao.sql'),
    ('leilao_lances', '2026-08-18-leilao.sql'),
    ('leiloes', '2026-08-18-leilao.sql'),
    ('mensalidades', 'schema base (baseline)'),
    ('migracoes_aplicadas', '2026-08-28-ledger-migrations.sql'),
    ('missoes_feitas', '2026-06-30-devocional-popup.sql'),
    ('notificacoes', 'schema base (baseline)'),
    ('partidas', '2026-08-29-anticheat-partidas.sql'),
    ('pontos', 'schema base (baseline)'),
    ('profiles', 'schema base (baseline)'),
    ('push_subscriptions', 'schema base (baseline)'),
    ('push_tokens', '2026-09-09-push-tokens.sql'),
    ('recordes', '2026-07-24-reflexo-recordes.sql'),
    ('responsaveis', '2026-07-14-portal-pais.sql'),
    ('temporadas', '2026-07-09-temporadas.sql'),
    ('trilha_jogos', '2026-07-02-trilha.sql'),
    ('unidades', 'schema base (baseline)'),
    ('versiculos', 'schema base (baseline)')
),
colunas(tabela, coluna, arquivo) as (values
    ('bichinhos', 'dormindo_desde', '2026-08-28-bichinho-sono.sql'),
    ('profiles', 'teste', '2026-07-15-modo-teste.sql'),
    ('profiles', 'avatar_tipo', '2026-08-24-avatar.sql'),
    ('notificacoes', 'para_usuario', '2026-07-06-importantes.sql'),
    ('pontos', 'entrega_id', '2026-07-06-importantes.sql'),
    ('entregas', 'feedback', '2026-07-06-importantes.sql'),
    ('fotos', 'thumb', '2026-07-14-mural-thumb.sql'),
    ('unidades', 'lema', '2026-07-13-identidade-unidade.sql')
),
funcoes(nome, arquivo) as (values
    ('rodizio_ligado', '2026-08-28-rodizio-interruptor.sql'),
    ('eh_teste', '2026-07-15-modo-teste.sql'),
    ('eh_membro_ativo', '2026-07-14-portal-pais.sql'),
    ('meus_filhos', '2026-07-14-portal-pais.sql'),
    ('pedir_vinculo', '2026-07-14-portal-pais.sql'),
    ('aprovar_vinculo', '2026-07-14-portal-pais.sql'),
    ('rejeitar_vinculo', '2026-07-14-portal-pais.sql'),
    ('vinculos_pendentes', '2026-07-14-portal-pais.sql'),
    ('nova_temporada', '2026-07-09-temporadas.sql'),
    ('excluir_usuario', '2026-07-15-excluir-usuario.sql'),
    ('chat_pode_ver', '2026-08-24-chat.sql'),
    ('_leilao_fechar_core', '2026-08-18-leilao.sql (e as correções seguintes do leilão)'),
    ('fechar_leiloes_vencidos', '2026-08-18-leilao.sql (e as correções seguintes do leilão)'),
    ('lembrar_ausentes', '2026-08-06-lembrete-ausencia-e-atividade.sql'),
    ('lancar_colocacao_acampamento', '2026-08-24-modo-acampamento.sql'),
    ('chefao_premiar', '2026-08-29-chefao-fds.sql'),
    ('pode_gerir', 'schema base (baseline)'),
    ('pode_aprovar', 'schema base (baseline)'),
    ('eh_financeiro', 'schema base (baseline)'),
    ('pode_apontar', 'schema base (baseline)'),
    ('ranking_totais', 'schema base (baseline)'),
    ('listar_usuarios', 'schema base (baseline)'),
    ('resetar_senha_membro', 'schema base (baseline)'),
    ('handle_new_user', 'schema base (baseline)'),
    ('limita_pontos_conselheiro', '2026-07-06-depois.sql')
),
verif as (
  select 'tabela public.' || t.nome as verificacao,
         case when to_regclass('public.' || t.nome) is not null then 'ok' else 'PROBLEMA' end as status,
         case when to_regclass('public.' || t.nome) is not null then ''
              else 'não existe: rode ' || t.arquivo || ' antes' end as detalhe
  from tabelas t
  union all
  select 'coluna ' || c.tabela || '.' || c.coluna,
         case when exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = c.tabela and column_name = c.coluna)
              then 'ok' else 'PROBLEMA' end,
         case when exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = c.tabela and column_name = c.coluna)
              then '' else 'não existe: rode ' || c.arquivo || ' antes' end
  from colunas c
  union all
  select 'função public.' || f.nome || '()',
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.nome)
              then 'ok' else 'PROBLEMA' end,
         case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.nome)
              then '' else 'não existe: rode ' || f.arquivo || ' antes' end
  from funcoes f
  union all
  -- ---------- dados que fariam uma migration abortar ----------
  select 'unidades com o MESMO nome (a 000003 cria índice único por clube+nome)',
         case when exists (select 1 from public.unidades group by nome having count(*) > 1) then 'PROBLEMA' else 'ok' end,
         coalesce((select 'renomeie/una: ' || string_agg(nome || ' (x' || n || ')', ', ')
                   from (select nome, count(*) n from public.unidades group by nome having count(*) > 1) d), '')
  union all
  select 'mensalidades duplicadas (mesmo desbravador, mês e ano) — a 000014 confere',
         case when exists (select 1 from public.mensalidades where desbravador_id is not null
                           group by desbravador_id, mes, ano having count(*) > 1) then 'PROBLEMA' else 'ok' end,
         coalesce((select count(*) || ' grupo(s) duplicado(s): apague as linhas repetidas antes'
                   from (select 1 from public.mensalidades where desbravador_id is not null
                         group by desbravador_id, mes, ano having count(*) > 1) d
                   having count(*) > 0), '')
  union all
  select 'perfis com papel fora de (desbravador, conselheiro, instrutor, tesoureiro, diretoria, pais)',
         case when exists (select 1 from public.profiles
                           where papel not in ('desbravador','conselheiro','instrutor','tesoureiro','diretoria','pais'))
              then 'PROBLEMA' else 'ok' end,
         coalesce((select string_agg(distinct papel, ', ') from public.profiles
                   where papel not in ('desbravador','conselheiro','instrutor','tesoureiro','diretoria','pais')), '')
  union all
  select 'pg_cron ligado (fechamento automático do leilão e lembretes dependem dele)',
         case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'ok' else 'AVISO' end,
         case when exists (select 1 from pg_extension where extname = 'pg_cron') then ''
              else 'Database > Extensions > pg_cron (as migrations rodam sem ele, mas os jobs não existirão)' end
  union all
  select 'há pelo menos 1 usuário com papel diretoria ativo (quem vai gerir o clube depois)',
         case when exists (select 1 from public.profiles where papel = 'diretoria' and status = 'ativo') then 'ok' else 'AVISO' end,
         ''
)
select * from (
  select 'RESUMO'::text as verificacao,
         case when count(*) filter (where status = 'PROBLEMA') = 0 then 'ok' else 'PROBLEMA' end as status,
         count(*) filter (where status = 'PROBLEMA') || ' problema(s), '
           || count(*) filter (where status = 'AVISO') || ' aviso(s), '
           || count(*) filter (where status = 'ok') || ' ok' as detalhe
  from verif
  union all
  select verificacao, status, detalhe from verif
) r
order by case when verificacao = 'RESUMO' then 0 else 1 end,
         case status when 'PROBLEMA' then 0 when 'AVISO' then 1 else 2 end,
         verificacao;
