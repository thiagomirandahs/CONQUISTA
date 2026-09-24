-- =====================================================================================================
--  PRÉ-VOO DA PRODUÇÃO — SOMENTE LEITURA. Não cria, não altera e não apaga nada.
--
--  Cobre as migrations 20260921000001 .. 20260930000080 (o SaaS multi-clube) aplicadas sobre a
--  produção LEGADA (as migrations 20260701* .. 20260909*). São 41 verificações, uma por linha.
--
--  Como usar:
--    1. No SQL Editor da produção, ANTES da janela: cole o arquivo inteiro e rode (Ctrl+Enter).
--    2. Leia a primeira linha, RESUMO. Só abra a janela com RESUMO = ok.
--    3. Rode de novo no dia da janela, imediatamente antes de começar (leilão, sessões e cron mudam).
--    Linha "travada": outra sessão segura (ou espera na fila) um AccessExclusiveLock numa tabela que a
--    verificação lê; o pré-voo não fica preso atrás dela. sessoes-longas-e-locks diz qual é o pid.
--    Resolva a sessão e rode de novo.
--
--  Saída: (verificacao, status, detalhe, correcao) — RESUMO primeiro, depois PROBLEMA, AVISO, ok.
--    PROBLEMA  para a janela. A migration aborta no meio, ou grava resultado errado / abre falha em
--              silêncio. Corrija (coluna correcao) e rode o pré-voo de novo.
--    AVISO     não para a janela, mas exige uma decisão ou um passo na janela. Leia antes de seguir.
--    ok        nada encontrado (o detalhe pode trazer um número informativo).
--  detalhe = quantos achados + até 5 exemplos, só com ids e nomes de objeto (nunca e-mail ou nome
--  de pessoa). "não deu para conferir" = falta o objeto de que a verificação precisa (ou ele tem
--  outro tipo: colunas-legadas-... ou extensoes-obrigatorias diz o que falta), o papel não o lê
--  (falta USAGE no schema ou SELECT na tabela) ou outra sessão o travou.
--
--  É UM comando SELECT só, sem DDL/DML e sem tabela temporária: roda dentro de
--  `begin transaction read only` como `postgres` (scripts/testar-preflight.mjs e o ensaio provam).
--  O único ajuste é set_config('lock_timeout', '5s', true) antes da primeira leitura, e só se ninguém
--  definiu lock_timeout: é LOCAL à transação (não vaza para a conexão do SQL Editor) e troca uma
--  espera sem fim por um erro em 5 s, se um lock aparecer depois da guarda.
--  Robusto a banco diferente do esperado: os objetos são procurados no catálogo (to_regclass num
--  schema sem USAGE dá "permission denied", não NULL) e toda consulta que lê tabela, coluna, schema
--  ou extensão que pode faltar roda por query_to_xml(), só depois de a guarda (coluna `precisa`)
--  confirmar que os objetos existem com o tipo esperado, são legíveis e não estão travados.
--  Nenhuma falta derruba o pré-voo inteiro.
--
--  Fica FORA desta consulta, de propósito:
--    · a conferência da colagem do pacote curricular (40 e 43) — BLOCO À PARTE no fim do arquivo;
--    · o que só se confere no meio da janela ou fora do banco (front publicado, APK, Edge Function,
--      admin da plataforma, valores anuais do currículo...) — está no runbook
--      (supabase/infra/DEPLOY-E-RECUPERACAO.md e supabase/ROLLOUT-CORRECOES-MULTITENANT.md).
--
--  Para ESTENDER a uma migration nova (2026093*...):
--    · objeto novo (tabela/função) → acrescente o nome às listas de upgrade-parcial-ou-objetos-saas;
--    · pré-condição nova sobre o legado → uma linha nova em `checagem`: id kebab-case, nivel, precisa,
--      se_faltar ('nivel' ou 'ok'), consulta (devolve uma coluna `item`, um achado por linha, com
--      ids — nunca e-mail/nome de pessoa), info (opcional, número informativo) e correcao;
--    · precisa = TODA coluna que a consulta lê, com o tipo que ela supõe: 'esquema.tabela.coluna:tipo'
--      (tipo como no format_type, com timestamptz abreviado; alternativas com |). 'esquema.*' quando a
--      consulta chama pg_get_constraintdef/indexdef/expr/triggerdef, que travam junto com a tabela,
--      sobre tabelas quaisquer do schema. {{tabelas_legadas}} e {{funcoes_legadas}} na consulta viram
--      os arrays da CTE `listas`;
--    · um caso negativo em supabase/tests/upgrade/preflight-casos.mjs para cada verificação nova
--      (node scripts/testar-preflight.mjs exige cobertura de 100%) e atualize o intervalo acima.
-- =====================================================================================================
with
checagem (ordem, id, nivel, precisa, se_faltar, consulta, info, correcao) as (values

-- ------------------------------------------------------------------------------------------ PROBLEMA
( 1, 'upgrade-parcial-ou-objetos-saas', 'PROBLEMA', array['public.*', 'supabase_migrations.*'], 'nivel',
$c$
with ledger(esquema, tabela, coluna, nsp, rel) as (
  select l.esquema, l.tabela, l.coluna, n.oid, c.oid
    from (values ('public', 'migracoes_aplicadas', 'arquivo'), ('supabase_migrations', 'schema_migrations', 'version')) l(esquema, tabela, coluna)
    join pg_namespace n on n.nspname = l.esquema
    join pg_class c on c.relnamespace = n.oid and c.relname = l.tabela
),
le as (
  select l.*, coalesce(has_schema_privilege(l.nsp, 'USAGE') and has_table_privilege(l.rel, 'SELECT'), false) as legivel,
         exists (select 1 from pg_attribute a where a.attrelid = l.rel and a.attname = l.coluna and a.attnum > 0 and not a.attisdropped) as tem_coluna
    from ledger l
)
select 'tabela do SaaS já existe: public.' || t as item
  from unnest(array[
    'alerta_destinos', 'alerta_entregas', 'alertas', 'app_erros', 'auditoria_operacoes',
    'billing_account_contacts', 'billing_accounts', 'billing_events', 'billing_invoices', 'billing_plans',
    'billing_policies', 'billing_prices', 'billing_providers', 'chat_mensagens_apagadas', 'class_completion_events',
    'class_completion_snapshots', 'class_documents', 'class_investitures', 'class_requirements', 'class_sections',
    'classes', 'club_badges', 'club_entry_codes', 'club_features', 'club_invites',
    'club_provisioning_status', 'club_storage_objetos', 'club_storage_uso', 'club_team_invites', 'cron_falhas',
    'curriculum_achievements', 'curriculum_dependencies', 'curriculum_versions', 'document_signatures', 'document_templates',
    'dynamic_content_definitions', 'dynamic_content_values', 'entrada_tentativas', 'experience_audiences', 'experience_events',
    'experience_participations', 'experience_reports', 'experience_rewards', 'experience_seasons', 'experience_stages',
    'experience_submissions', 'experience_templates', 'experiences', 'infra_falhas', 'infra_heartbeat',
    'investiture_reviews', 'investiture_workflow_runs', 'investiture_workflow_stages', 'investiture_workflows', 'member_badges',
    'member_classes', 'member_requirement_options', 'member_requirements', 'member_specialties', 'member_specialty_requirements',
    'onboarding_sessions', 'organization_memberships', 'organizational_units', 'platform_admin_audit', 'platform_admins',
    'push_evento_destinatarios', 'push_eventos', 'push_tentativas', 'recursos_catalogo', 'requirement_approvals',
    'requirement_option_groups', 'requirement_options', 'specialties', 'specialty_offerings', 'specialty_requirements',
    'subscription_clubs', 'subscription_events', 'subscriptions', 'support_grants', 'workflow_stage_decisions'
  ]) t
 where to_regclass('public.' || t) is not null
union all
select 'função do SaaS já existe: ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p
 where p.pronamespace = to_regnamespace('public')
   and p.proname in (
    'clube_legado_id', 'clube_atual_id', 'tem_vinculo_unidade', 'pode_gerir_no_clube',
    'membro_ativo_no_clube', 'pode_financeiro_no_clube', 'lideranca_gere_usuario', 'vinculo_gerir',
    'curriculo_importar_classes_regulares', 'classe_iniciar', '_snapshot_hash', '_documento_token',
    'eh_admin_plataforma', '_push_disparar', 'storage_reconciliar', 'clube_codigo_gerar',
    '_auditar', '_recusar_linha', 'provisionar_clube', 'mensalidades_ano'
  )
union all
select 'não deu para ler ' || l.esquema || '.' || l.tabela || ' (' || current_user || ' sem USAGE no schema ou SELECT na tabela): confira esse ledger com o dono dele'
  from le l where not l.legivel
union all
-- só os 45 nomes que as migrations 01..50 gravam; um hotfix legado (AAAA-MM-DD-nome.sql) de outro dia não é upgrade parcial
select 'migracoes_aplicadas já registra ' || x.arquivo
  from (select case when l.legivel and l.tem_coluna
                    then query_to_xml($x$select regexp_replace(arquivo::text, '[[:cntrl:]' || chr(65534) || chr(65535) || ']+', ' ', 'g') as arquivo
                                           from public.migracoes_aplicadas
                                          where arquivo::text in (select '2026-09-21-' || s || '.sql' from unnest(array[
    'fundacao-saas-multitenant', 'mapear-perfis-legados-tenant-001', 'tenantiza-unidades', 'tenantiza-nucleo-operacional',
    'isola-perfis-e-gestao', 'isola-fotos-por-clube', 'recursos-por-clube', 'tenantiza-temporadas-e-ranking', 'tenantiza-agenda',
    'tenantiza-notificacoes', 'tenantiza-mensalidades', 'convites-responsaveis', 'papeis-vinculos-e-escopo-legado',
    'rls-por-clube-e-blindagem-de-responsaveis', 'leilao-cron-e-escopo', 'isolamento-de-rpcs-e-storage', 'convites-e-push-por-clube',
    'correcoes-da-revisao', 'regressoes-de-desempenho-e-compat', 'config-por-clube-e-provisionamento', 'duelos-por-clube',
    'missoes-e-devocional-por-clube', 'leilao-por-clube', 'jogos-por-clube', 'chat-bichinho-biblia-por-clube',
    'remove-helpers-legados', 'conteudo-por-clube', 'correcoes-das-revisoes-da-rodada-2', 'multiclube-real',
    'jogos-sem-papel-de-profiles', 'motor-curricular-classes', 'especialidades-e-dependencias', 'motor-de-regras-curriculares',
    'catalogo-oficial-classes', 'importar-classes-regulares-2026-1', 'regras-bloqueiam-envio-e-aprovacao',
    'importador-versao-nova-e-escolha-aberta', 'importar-classes-regulares-2026-2', 'snapshot-curricular-e-investidura',
    'documento-e-verificacao-publica', 'hierarquia-institucional-e-workflow-investidura', 'escopo-institucional-e-portal',
    'fundacao-comercial-saas', 'motor-de-experiencias', 'inicio-contextual'
                                          ]) s)
                                          order by 1$x$, false, false, '') end as doc
          from le l where l.tabela = 'migracoes_aplicadas') d,
       xmltable('/table/row' passing d.doc columns arquivo text path 'arquivo') x
union all
select 'ledger do CLI já registra a versão ' || x.v
  from (select case when l.legivel and l.tem_coluna
                    then query_to_xml($x$select regexp_replace(version::text, '[[:cntrl:]' || chr(65534) || chr(65535) || ']+', ' ', 'g') as v
                                           from supabase_migrations.schema_migrations
                                          where version::text >= '20260921000001' order by 1$x$, false, false, '') end as doc
          from le l where l.tabela = 'schema_migrations') d,
       xmltable('/table/row' passing d.doc columns v text path 'v') x
$c$, null,
$t$Não recomece do 01 sobre um upgrade parcial. Se o ledger registra versões, continue da primeira que falta, conferindo pelo CONJUNTO (nunca pelo max(version)). Objeto do SaaS sem registro em ledger nenhum: restaure o backup (PITR) de antes da tentativa. Se for só resto vazio de teste manual (sem dado real): drop do objeto e delete da linha do ledger antes da janela. Ledger que o papel não lê: grant usage/select a ele (como o dono) e rode de novo.$t$),

( 2, 'ledger-do-cli-supabase_migrations-ausente', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
with l as (select to_regnamespace('supabase_migrations') as nsp,
                  (select c.oid from pg_class c
                    where c.relnamespace = to_regnamespace('supabase_migrations') and c.relname = 'schema_migrations') as rel)
select 'supabase_migrations.schema_migrations não existe: o insert do ledger anexado a cada migration aborta (e desfaz) a migration' as item
  from l where l.rel is null
union all
select 'o papel ' || current_user || ' não consegue ler e gravar em supabase_migrations.schema_migrations (falta USAGE no schema, SELECT ou INSERT na tabela)'
  from l
 where l.rel is not null
   and not coalesce(has_schema_privilege(l.nsp, 'USAGE') and has_table_privilege(l.rel, 'SELECT')
                    and has_table_privilege(l.rel, 'INSERT'), false)
union all
select 'supabase_migrations.schema_migrations sem a coluna ' || c || ' (o insert do runbook grava version, name e statements)'
  from l, unnest(array['version', 'name', 'statements']) c
 where l.rel is not null
   and not exists (select 1 from pg_attribute a where a.attrelid = l.rel and a.attname = c and a.attnum > 0 and not a.attisdropped)
$c$, null,
$t$Antes da janela, no SQL Editor: create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text); Se existe e o papel não lê/grava: grant usage on schema supabase_migrations to postgres; grant select, insert on supabase_migrations.schema_migrations to postgres; (como o dono).$t$),

( 3, 'papel-ou-status-fora-do-vocabulario', 'PROBLEMA',
  array['public.profiles.papel:text', 'public.profiles.status:text'], 'nivel',
$c$
select 'papel ' || coalesce(quote_literal(papel), 'nulo') || ': ' || count(*) || ' perfil(is)' as item
  from public.profiles
 where papel is null or papel not in ('desbravador', 'conselheiro', 'instrutor', 'tesoureiro', 'diretoria', 'pais')
 group by papel
union all
select 'status ' || coalesce(quote_literal(status), 'nulo') || ': ' || count(*) || ' perfil(is)'
  from public.profiles
 where status is null or status not in ('ativo', 'pendente', 'inativo', 'rejeitado')
 group by status
$c$, null,
$t$Não aborta: a 02/13 reescreve em silêncio (papel vira desbravador, status vira suspenso) e a 34 copia de volta — um líder com 'Diretoria' ou 'Ativo' perde a liderança. Normalize com a diretoria: update public.profiles set papel = '<valor do vocabulário>' where id = '<id>'; update public.profiles set status = lower(btrim(status)) where status <> lower(btrim(status)); o que sobrar, decida entre ativo e inativo.$t$),

( 4, 'dados-que-violam-constraints-novas', 'PROBLEMA',
  array['public.unidades.nome:text', 'public.temporadas.fim:timestamptz', 'public.temporadas.numero:integer',
        'public.mensalidades.desbravador_id:uuid', 'public.mensalidades.mes:integer', 'public.mensalidades.ano:integer',
        'public.leiloes.status:text', 'public.chat_conversas.tipo:text', 'public.jogos_liberados.chave:text',
        'public.recordes.jogo:text', 'public.jogos_trilha.chave:text'], 'nivel',
$c$
select '03: unidade com nome repetido: ' || nome || ' (x' || count(*) || ')' as item
  from public.unidades group by nome having count(*) > 1
union all
select '08: ' || count(*) || ' temporadas abertas (fim nulo)' from public.temporadas where fim is null having count(*) > 1
union all
select '08: número de temporada repetido: ' || numero || ' (x' || count(*) || ')' from public.temporadas group by numero having count(*) > 1
union all
select '11: mensalidade repetida: desbravador ' || desbravador_id || ' ' || mes || '/' || ano || ' (x' || count(*) || ')'
  from public.mensalidades where desbravador_id is not null group by desbravador_id, mes, ano having count(*) > 1
union all
select '23: ' || count(*) || ' leilões abertos ao mesmo tempo' from public.leiloes where status = 'aberto' having count(*) > 1
union all
select '25: ' || count(*) || ' conversas do tipo geral' from public.chat_conversas where tipo = 'geral' having count(*) > 1
union all
select '24: jogos_liberados com chave fora do catálogo: ' || l.chave
  from public.jogos_liberados l where not exists (select 1 from public.jogos_trilha j where j.chave = l.chave)
union all
select '24: recordes com jogo fora do catálogo: ' || r.jogo || ' (x' || count(*) || ')'
  from public.recordes r where not exists (select 1 from public.jogos_trilha j where j.chave = r.jogo) group by r.jogo
$c$, null,
$t$(03) renomeie ou una as unidades, movendo antes profiles.unidade_id, pontos, duelos e a conversa da unidade; (08) feche as temporadas abertas a mais (update public.temporadas set fim = now() where id = '<extra>') e renumere as repetidas; (11) apague as mensalidades repetidas, mantendo a paga ou a mais recente; (23) encerre ou cancele pelo app os leilões abertos a mais; (25) mova as mensagens para uma conversa geral só e apague as outras; (24) apague liberações e recordes órfãos ou cadastre o jogo em jogos_trilha.$t$),

( 5, 'colunas-legadas-ausentes-ou-divergentes', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
with inv(tabela, arquivo, cols) as (values
  ('ajudas', '20260801000001_pedir-ajuda.sql',
   'id:uuid,de_id:uuid,para_id:uuid,jogo:text,enunciado:jsonb,resposta:text,status:text,resolvido_por:uuid,criado_em:timestamptz,resolvido_em:timestamptz'),
  ('atividades', '20260701000000_legacy_baseline.sql',
   'id:uuid,titulo:text,descricao:text,categoria:text,pontos:integer,prazo:date,alvo:text,criterios:jsonb,criado_por:uuid,created_at:timestamptz'),
  ('biblia_leitura_atual', '20260826000002_biblia-antifarm.sql',
   'usuario_id:uuid,livro_abrev:text,capitulo:integer,aberto_em:timestamptz'),
  ('biblia_leituras', '20260826000001_biblia.sql',
   'usuario_id:uuid,livro_abrev:text,capitulo:integer,lido_em:timestamptz'),
  ('biblia_livros', '20260826000001_biblia.sql',
   'abrev:text,nome:text,ordem:integer,testamento:text,capitulos:integer'),
  ('biblia_versiculos', '20260826000001_biblia.sql',
   'livro_abrev:text,capitulo:integer,versiculo:integer,texto:text'),
  ('bichinhos', '20260826000003_bichinho.sql',
   'usuario_id:uuid,especie:text,nome:text,fome:integer,higiene:integer,felicidade:integer,atualizado_em:timestamptz,ultimo_cuidado_em:timestamptz,pontuado_em:timestamptz,dias_cuidados:integer,cuidados_total:integer,ofensiva:integer,vivo:boolean,morto_em:timestamptz,nascido_em:timestamptz,item:text,cenario:text,cor:text,olhos:text,dormindo_desde:timestamptz,movel:text'),
  ('chat_conversas', '20260824000002_chat.sql',
   'id:uuid,tipo:text,unidade_id:uuid,created_at:timestamptz'),
  ('chat_mensagens', '20260824000002_chat.sql',
   'id:uuid,conversa_id:uuid,autor_id:uuid,texto:text,created_at:timestamptz,apagada:boolean,apagada_por:uuid,apagada_em:timestamptz'),
  ('chat_participantes', '20260824000002_chat.sql',
   'conversa_id:uuid,usuario_id:uuid'),
  ('chefao_golpes', '20260829000003_chefao-fds.sql',
   'id:uuid,usuario_id:uuid,criado_em:timestamptz,dano:integer'),
  ('config_clube', '20260714000003_portal-pais.sql',
   'chave:text,valor:text'),
  ('desafios', '20260701000000_legacy_baseline.sql',
   'id:uuid,tema:text,texto:text,pergunta:text,opcoes:jsonb,correta:integer,classe:text,pede_foto:boolean,ativo:boolean,created_at:timestamptz'),
  ('desafios_unidade', '20260714000001_duelos.sql',
   'id:uuid,titulo:text,descricao:text,pontos:integer,dias:integer,ativo:boolean,created_at:timestamptz,tipo:text,meta:integer'),
  ('devocional', '20260701000000_legacy_baseline.sql',
   'id:uuid,usuario_id:uuid,data:date,foto_url:text,acertou_quiz:boolean,created_at:timestamptz,status:text,pontos_dados:integer'),
  ('duelos', '20260714000001_duelos.sql',
   'id:uuid,desafio_id:uuid,titulo:text,pontos:integer,unidade_a:uuid,unidade_b:uuid,criado_por:uuid,prazo:date,status:text,vencedor:text,julgado_por:uuid,julgado_em:timestamptz,created_at:timestamptz'),
  ('entregas', '20260701000000_legacy_baseline.sql',
   'id:uuid,atividade_id:uuid,usuario_id:uuid,texto:text,foto_url:text,status:text,pontos_dados:integer,avaliado_por:uuid,created_at:timestamptz,feedback:text'),
  ('eventos', '20260709000001_agenda.sql',
   'id:uuid,titulo:text,tipo:text,data:date,hora:text,local:text,descricao:text,criado_por:uuid,created_at:timestamptz,data_fim:date'),
  ('fotos', '20260701000000_legacy_baseline.sql',
   'id:uuid,url:text,legenda:text,evento:text,autor_id:uuid,aprovada:boolean,created_at:timestamptz,thumb:text'),
  ('jogos_liberados', '20260828000004_jogos-do-dia.sql',
   'chave:text,data:date,liberado_por:uuid,criado_em:timestamptz'),
  ('jogos_trilha', '20260709000002_jogos-trilha.sql',
   'chave:text,nome:text,emoji:text,ativo:boolean,ordem:integer,requer_webgl:boolean'),
  ('leilao_itens', '20260818000001_leilao.sql',
   'id:uuid,leilao_id:uuid,nome:text,emoji:text,descricao:text,preco_base:integer,incremento_minimo:integer,ordem:integer,created_at:timestamptz,vencedor_lance_id:uuid'),
  ('leilao_lance_unidades', '20260818000001_leilao.sql',
   'lance_id:uuid,unidade_id:uuid,confirmado:boolean'),
  ('leilao_lances', '20260818000001_leilao.sql',
   'id:uuid,item_id:uuid,criado_por:uuid,valor:integer,status:text,created_at:timestamptz'),
  ('leiloes', '20260818000001_leilao.sql',
   'id:uuid,titulo:text,fecha_em:timestamptz,status:text,criado_por:uuid,encerrado_em:timestamptz,created_at:timestamptz'),
  ('mensalidades', '20260701000000_legacy_baseline.sql',
   'id:uuid,desbravador_id:uuid,mes:integer,ano:integer,valor:numeric,status:text,data_pagamento:date,registrado_por:uuid,created_at:timestamptz'),
  ('migracoes_aplicadas', '20260828000006_ledger-migrations.sql',
   'arquivo:text,aplicada_em:timestamptz'),
  ('missoes_feitas', '20260701010009_devocional-popup.sql',
   'id:uuid,usuario_id:uuid,data:date,foto_url:text,acertou_quiz:boolean,status:text,pontos_dados:integer,created_at:timestamptz'),
  ('notificacoes', '20260701000000_legacy_baseline.sql',
   'id:uuid,titulo:text,corpo:text,tipo:text,link:text,para:text,criado_por:uuid,created_at:timestamptz,para_usuario:uuid'),
  ('partidas', '20260829000001_anticheat-partidas.sql',
   'id:uuid,usuario_id:uuid,jogo:text,iniciado_em:timestamptz,validade_em:timestamptz,consumida_em:timestamptz,ultima_submissao_em:timestamptz,resultado:integer,suspeita:boolean,motivo_suspeita:text'),
  ('pontos', '20260701000000_legacy_baseline.sql',
   'id:uuid,usuario_id:uuid,origem:text,pontos:integer,motivo:text,data:timestamptz,lancado_por:uuid,unidade_id:uuid,marca:jsonb,entrega_id:uuid'),
  ('profiles', '20260701000000_legacy_baseline.sql',
   'id:uuid,nome:text,foto:text,nascimento:date,papel:text,cargo:text,unidade_id:uuid,status:text,created_at:timestamptz,notif_visto_em:timestamptz,teste:boolean,avatar:jsonb,avatar_tipo:text'),
  ('push_subscriptions', '20260701000000_legacy_baseline.sql',
   'id:uuid,user_id:uuid,endpoint:text,p256dh:text,auth:text,created_at:timestamptz'),
  ('push_tokens', '20260909000001_push-tokens.sql',
   'token:text,user_id:uuid,plataforma:text,created_at:timestamptz'),
  ('recordes', '20260724000005_reflexo-recordes.sql',
   'id:uuid,usuario_id:uuid,jogo:text,semana:date,pontos:integer,atualizado_em:timestamptz'),
  ('responsaveis', '20260714000003_portal-pais.sql',
   'id:uuid,responsavel_id:uuid,desbravador_id:uuid,nome_digitado:text,status:text,criado_em:timestamptz,aprovado_por:uuid,aprovado_em:timestamptz'),
  ('temporadas', '20260709000003_temporadas.sql',
   'id:uuid,numero:integer,inicio:timestamptz,fim:timestamptz,campeao_individual:text,campeao_unidade:text,criado_por:uuid,created_at:timestamptz'),
  ('trilha_jogos', '20260702000001_trilha.sql',
   'id:uuid,usuario_id:uuid,data:date,tipo:text,estrelas:integer,created_at:timestamptz'),
  ('unidades', '20260701000000_legacy_baseline.sql',
   'id:uuid,nome:text,cor:text,emblema:text,conselheiro_id:uuid,created_at:timestamptz,lema:text,grito:text,bandeira:text'),
  ('versiculos', '20260701000000_legacy_baseline.sql',
   'id:uuid,texto:text,referencia:text,pergunta:text,opcoes:jsonb,correta:integer,ativo:boolean,created_at:timestamptz,livro_abrev:text,capitulo:integer,versiculo_num:integer')
),
arquivo_da_coluna(tabela, coluna, arquivo) as (values
  ('bichinhos', 'item', '20260826000004_bichinho-itens.sql'), ('bichinhos', 'cenario', '20260827000001_bichinho-visual.sql'),
  ('bichinhos', 'cor', '20260827000001_bichinho-visual.sql'), ('bichinhos', 'olhos', '20260827000001_bichinho-visual.sql'),
  ('bichinhos', 'dormindo_desde', '20260828000001_bichinho-sono.sql'), ('bichinhos', 'movel', '20260829000002_bichinho-moveis.sql'),
  ('desafios_unidade', 'tipo', '20260715000001_duelo-progresso.sql'), ('desafios_unidade', 'meta', '20260715000001_duelo-progresso.sql'),
  ('entregas', 'feedback', '20260706000001_importantes.sql'), ('eventos', 'data_fim', '20260831000001_agenda-data-fim.sql'),
  ('fotos', 'thumb', '20260714000002_mural-thumb.sql'), ('jogos_trilha', 'requer_webgl', '20260828000003_jogo-dardos.sql'),
  ('notificacoes', 'para_usuario', '20260706000001_importantes.sql'), ('pontos', 'entrega_id', '20260706000001_importantes.sql'),
  ('profiles', 'teste', '20260715000005_modo-teste.sql'), ('profiles', 'avatar', '20260824000001_avatar.sql'),
  ('profiles', 'avatar_tipo', '20260824000001_avatar.sql'), ('trilha_jogos', 'created_at', '20260828000004_jogos-do-dia.sql'),
  ('unidades', 'lema', '20260713000002_identidade-unidade.sql'), ('unidades', 'grito', '20260713000002_identidade-unidade.sql'),
  ('unidades', 'bandeira', '20260713000002_identidade-unidade.sql'), ('versiculos', 'livro_abrev', '20260826000001_biblia.sql'),
  ('versiculos', 'capitulo', '20260826000001_biblia.sql'), ('versiculos', 'versiculo_num', '20260826000001_biblia.sql')
),
esperado as (
  select i.tabela, split_part(x, ':', 1) as coluna, split_part(x, ':', 2) as tipo
    from inv i cross join lateral unnest(string_to_array(i.cols, ',')) x
),
atual as (
  select c.relname::text as tabela, a.attname::text as coluna,
         replace(format_type(a.atttypid, null), 'timestamp with time zone', 'timestamptz') as tipo,
         a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = '' as obrigatoria_sem_default
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = to_regnamespace('public') and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
)
select 'tabela public.' || i.tabela || ' ausente (rode ' || i.arquivo || ')' as item
  from inv i where to_regclass('public.' || i.tabela) is null
union all
select 'coluna public.' || e.tabela || '.' || e.coluna
       || case when a.coluna is null then ' ausente' || coalesce(' (rode ' || ac.arquivo || ')', '')
               else ' é ' || a.tipo || ', esperado ' || e.tipo end
  from esperado e
  left join atual a on a.tabela = e.tabela and a.coluna = e.coluna
  left join arquivo_da_coluna ac on ac.tabela = e.tabela and ac.coluna = e.coluna
 where to_regclass('public.' || e.tabela) is not null and (a.coluna is null or a.tipo <> e.tipo)
union all
select 'coluna public.' || a.tabela || '.' || a.coluna || ' só existe aqui e é NOT NULL sem default: o insert do SaaS que não a conhece falha'
  from atual a
 where a.obrigatoria_sem_default and a.tabela in (select tabela from inv)
   and not exists (select 1 from esperado e where e.tabela = a.tabela and e.coluna = a.coluna)
$c$, null,
$t$Tabela ou coluna ausente: rode antes o SQL legado indicado (ou ache-o com git grep -n <coluna> supabase/migrations/20260[7-9]*). Tipo diferente: alter table ... alter column ... type ... using ..., depois de limpar os valores que não convertem (nascimento em text aborta a 39). Coluna extra NOT NULL sem default: dê um default a ela ou remova-a.$t$),

( 6, 'funcoes-legadas-ausentes-ou-com-assinatura-diferente', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
with esperado(nome, args, retorno) as (values
  ('_biblia_segundos_min','p_livro_abrev text, p_capitulo integer','integer'), ('_bichinho_estagio','p_dias integer','integer'),
  ('_bichinho_nivel_cenario','p_v text','integer'), ('_bichinho_nivel_cor','p_v text','integer'),
  ('_bichinho_nivel_item','p_item text','integer'), ('_bichinho_nivel_movel','p_v text','integer'),
  ('_bichinho_nivel_olhos','p_v text','integer'), ('_chat_tem_palavrao','p_texto text','boolean'),
  ('_leilao_fechar_core','p_id uuid','json'), ('_max_pontos_arcade','p_jogo text, p_segundos numeric','integer'),
  ('_min_segundos_jogo','p_jogo text','integer'), ('ajuda_status','p_id uuid','json'),
  ('ajudas_recebidas','','json'), ('aprovar_entrega','p_entrega_id uuid','json'),
  ('aprovar_vinculo','p_id uuid, p_desbravador_id uuid','json'), ('atividade_jogos','','json'),
  ('avaliar_missao','p_id uuid, p_aprovar boolean','void'), ('biblia_confirmar_leitura','p_livro_abrev text, p_capitulo integer','json'),
  ('biblia_iniciar_leitura','p_livro_abrev text, p_capitulo integer','json'), ('bichinho_acordar','','json'),
  ('bichinho_adotar','p_nome text, p_especie text','json'), ('bichinho_cuidar','p_acao text','json'),
  ('bichinho_dormir','','json'), ('bichinho_equipar','p_item text','json'),
  ('bichinho_vestir','p_campo text, p_valor text','json'), ('bonus_todos_jogos','','json'),
  ('cancelar_ajuda','p_id uuid','void'), ('cancelar_duelo','p_id uuid','json'),
  ('cancelar_leilao','p_id uuid','json'), ('chat_apagar_mensagem','p_mensagem_id uuid','json'),
  ('chat_enviar_direta','p_destinatario_id uuid, p_texto text','json'), ('chat_enviar_geral','p_texto text','json'),
  ('chat_enviar_unidade','p_texto text','json'), ('chat_pode_ver','p_conversa_id uuid','boolean'),
  ('chat_todas_conversas','','TABLE(conversa_id uuid, tipo text, unidade_id uuid, total_mensagens bigint, ultima_mensagem text, ultima_em timestamp with time zone)'), ('chefao_config','p_nome text, p_emoji text, p_vida integer, p_versiculo text, p_inicio date, p_ativo boolean','json'),
  ('chefao_estado','','json'), ('chefao_golpe','','json'),
  ('chefao_premiar','','void'), ('classe_por_nascimento','nasc date','text'),
  ('confirmar_lance_conjunto','p_lance_id uuid','json'), ('criar_duelo','p_desafio_id uuid, p_unidade_b uuid','json'),
  ('criar_leilao','p_titulo text, p_fecha_em timestamp with time zone, p_itens jsonb','json'), ('dar_lance','p_item_id uuid, p_valor integer, p_unidades_extra uuid[]','json'),
  ('devocional_feito_hoje','','boolean'), ('eh_financeiro','','boolean'),
  ('eh_membro_ativo','','boolean'), ('eh_teste','','boolean'),
  ('encerrar_leilao','p_id uuid','json'), ('excluir_usuario','p_id uuid','json'),
  ('fechar_leiloes_vencidos','','void'), ('handle_new_user','','trigger'),
  ('iniciar_jogo','p_tipo text','json'), ('jogos_do_dia','p_data date','TABLE(chave text, nome text, emoji text)'),
  ('julgar_duelo','p_id uuid, p_vencedor text','json'), ('lancar_colocacao_acampamento','p_atividade text, p_colocacoes jsonb','json'),
  ('leilao_saldo_unidade','p_unidade_id uuid','integer'), ('lembrar_ausentes','','void'),
  ('lembrar_jogos_do_dia','','void'), ('liberar_jogo','p_chave text','json'),
  ('limita_pontos_conselheiro','','trigger'), ('listar_usuarios','','TABLE(id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text, teste boolean)'),
  ('meu_bichinho','','json'), ('meu_progresso_trilha','','json'),
  ('meu_resumo_devocional','','json'), ('meu_resumo_missoes','','json'),
  ('meu_total_pontos','','integer'), ('meus_filhos','','json'),
  ('minha_leitura_biblia','','json'), ('minha_unidade','','uuid'),
  ('missao_do_dia','','TABLE(tipo text, texto text, referencia text, tema text, pergunta text, opcoes jsonb, pede_foto boolean, classe text)'), ('missoes_pendentes','','TABLE(id uuid, nome text, foto_url text, data date)'),
  ('nivel_por_pontos','p_pontos integer','integer'), ('norm_txt','t text','text'),
  ('notif_aniversariantes_hoje','','void'), ('notif_cadastro_aprovado','','trigger'),
  ('notif_duelo','','trigger'), ('notif_entrega_avaliada','','trigger'),
  ('notif_eventos_amanha','','void'), ('notif_leilao','','trigger'),
  ('notif_missao_avaliada','','trigger'), ('notif_nova_atividade','','trigger'),
  ('notif_novo_cadastro','','trigger'), ('notif_pontos_unidade','','trigger'),
  ('nova_temporada','p_campeao_individual text, p_campeao_unidade text','json'), ('pedir_ajuda','p_para uuid, p_jogo text, p_enunciado jsonb, p_resposta text','uuid'),
  ('pedir_vinculo','p_nome text','json'), ('pets_do_clube','','TABLE(dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text, especie text, pet_nome text, estagio integer, item text, cenario text, cor text, olhos text, movel text, vivo boolean, ofensiva integer, dormindo boolean)'),
  ('pode_apontar','alvo uuid','boolean'), ('pode_aprovar','','boolean'),
  ('pode_gerir','','boolean'), ('pontos_temporada_unidade','p_unidade_id uuid','integer'),
  ('premiar_campeao_semana','','void'), ('premiar_melhores_do_dia','','void'),
  ('premiar_rodada_semana','','void'), ('progresso_duelo','p_id uuid','json'),
  ('progresso_lado','p_uni uuid, p_tipo text, p_meta integer, p_desde timestamp with time zone','json'), ('protege_campos_perfil','','trigger'),
  ('ranking_semana','','json'), ('ranking_totais','','json'),
  ('ranking_trilha','','json'), ('recordes_semana','p_jogo text','json'),
  ('recusar_ajuda','p_id uuid','void'), ('recusar_lance_conjunto','p_lance_id uuid','json'),
  ('reflexo_so_desbravador','','boolean'), ('registrar_devocional','p_resposta integer','json'),
  ('registrar_jogo','p_tipo text, p_estrelas integer, p_partida uuid','json'), ('registrar_missao','p_foto_url text, p_resposta integer','json'),
  ('registrar_recorde','p_jogo text, p_pontos integer, p_partida uuid','json'), ('rejeitar_vinculo','p_id uuid','json'),
  ('resetar_senha_membro','alvo uuid, nova_senha text','void'), ('resolver_ajuda','p_id uuid, p_tentativa text','json'),
  ('rodizio_ligado','','boolean'), ('salvar_avatar','p_avatar jsonb, p_tipo text','json'),
  ('salvar_reuniao','p_data date, p_motivo text, p_itens jsonb','integer'), ('status_jogos_do_dia','','json'),
  ('temporada_inicio','','timestamp with time zone'), ('trancar_jogo','p_chave text','json'),
  ('versiculo_do_dia','','TABLE(id uuid, texto text, referencia text, pergunta text, opcoes jsonb)'), ('vinculos_pendentes','','json')
),
-- quantos parâmetros com DEFAULT a versão do repo tem (as demais: nenhum). O CREATE OR REPLACE das
-- migrations não consegue TIRAR um default ("cannot remove parameter defaults from existing function").
com_default(nome, n) as (values ('dar_lance', 1), ('jogos_do_dia', 1), ('registrar_jogo', 1), ('registrar_recorde', 1), ('salvar_avatar', 1))
select e.nome || '(' || e.args || '): ausente' as item
  from esperado e
 where not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('public') and p.proname = e.nome)
union all
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') → ' || pg_get_function_result(p.oid)
       || ': assinatura diferente ou sobrecarga extra'
  from esperado e
  join pg_proc p on p.pronamespace = to_regnamespace('public') and p.proname = e.nome
 where pg_get_function_identity_arguments(p.oid) <> e.args or pg_get_function_result(p.oid) <> e.retorno
union all
select p.proname || ': ' || p.pronargdefaults || ' DEFAULT(s) aqui, ' || coalesce(d.n, 0) || ' no repo — o CREATE OR REPLACE da migration aborta'
       || ' (cannot remove parameter defaults): (' || pg_get_function_arguments(p.oid) || ')'
  from esperado e
  join pg_proc p on p.pronamespace = to_regnamespace('public') and p.proname = e.nome
  left join com_default d on d.nome = e.nome
 where pg_get_function_identity_arguments(p.oid) = e.args and pg_get_function_result(p.oid) = e.retorno
   and p.pronargdefaults > coalesce(d.n, 0)
$c$, null,
$t$Sobrecarga extra: drop function public.<nome>(<tipos antigos>), depois de confirmar que o front publicado não a chama. Mesmo nome com parâmetro/retorno diferente, ou ausente: rode de novo o SQL legado mais novo que a define (ex.: fechar_leiloes_vencidos em 20260818000001_leilao.sql + correções do leilão; salvar_reuniao em 20260706000002_varredura-urgentes.sql; biblia_* em 20260826000002_biblia-antifarm.sql; bichinho_* em 20260829000002_bichinho-moveis.sql). DEFAULT a mais: só um drop tira o default — drop function public.<nome>(<tipos>); e rode de novo o SQL legado que a define (confirme antes que o front publicado não chama a função sem esse parâmetro).$t$),

( 7, 'objetos-legados-de-outro-dono', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
select 'função public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '): dono ' || pg_get_userbyid(p.proowner)
       || ' — o CREATE OR REPLACE / ALTER FUNCTION da migration aborta (must be owner)' as item
  from pg_proc p
 where p.pronamespace = to_regnamespace('public') and p.proname = any ({{funcoes_legadas}})
   and not pg_has_role(current_user, p.proowner, 'USAGE')
union all
select case c.relkind when 'v' then 'view' else 'tabela' end || ' public.' || c.relname || ': dono ' || pg_get_userbyid(c.relowner)
       || ' — o ALTER TABLE / CREATE POLICY da migration aborta (must be owner)'
  from pg_class c
 where c.relnamespace = to_regnamespace('public') and c.relkind in ('r', 'p', 'v')
   and (c.relname = any ({{tabelas_legadas}}) or c.relname = 'chat_mensagens_visiveis')
   and not pg_has_role(current_user, c.relowner, 'USAGE')
 order by 1
$c$, null,
$t$As migrations recriam funções e alteram tabelas legadas como o papel do SQL Editor (postgres), e isso exige ser o dono. Só o dono atual (ou um superusuário) troca o dono: alter function public.<nome>(<tipos>) owner to postgres; / alter table public.<tabela> owner to postgres; (idem alter view public.chat_mensagens_visiveis). Se o dono for supabase_admin, peça ao suporte do Supabase. Rode o pré-voo com o MESMO papel das migrations.$t$),

( 8, 'funcoes-que-chamam-funcoes-dropadas', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
-- rodizio_ligado() e reflexo_so_desbravador() não entram: a 20 e a 24 as dropam e recriam com a mesma
-- assinatura, e o plpgsql resolve a chamada na execução (o drop sem cascade é com dependentes-de-...)
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') chama um helper que a 26 dropa (dono ' || pg_get_userbyid(p.proowner) || ')' as item
  from pg_proc p
 where p.pronamespace = to_regnamespace('public')
   and p.prosrc ~ '(pode_gerir|pode_aprovar|eh_membro_ativo|eh_financeiro)\s*\(\s*\)'
   and p.proname not in (
        '_leilao_fechar_core', 'ajudas_recebidas', 'aprovar_entrega', 'aprovar_vinculo', 'atividade_jogos', 'avaliar_missao',
        'bonus_todos_jogos', 'cancelar_duelo', 'cancelar_leilao', 'chat_apagar_mensagem', 'chat_enviar_direta', 'chat_enviar_geral',
        'chat_enviar_unidade', 'chat_pode_ver', 'chat_todas_conversas', 'chefao_config', 'chefao_estado', 'chefao_golpe',
        'chefao_premiar', 'confirmar_lance_conjunto', 'criar_duelo', 'criar_leilao', 'dar_lance', 'eh_financeiro',
        'eh_membro_ativo', 'encerrar_leilao', 'excluir_usuario', 'fechar_leiloes_vencidos', 'handle_new_user', 'iniciar_jogo',
        'jogos_do_dia', 'julgar_duelo', 'lancar_colocacao_acampamento', 'lembrar_ausentes', 'lembrar_jogos_do_dia', 'liberar_jogo',
        'limita_pontos_conselheiro', 'listar_usuarios', 'meu_total_pontos', 'meus_filhos', 'missao_do_dia', 'missoes_pendentes',
        'notif_aniversariantes_hoje', 'notif_duelo', 'notif_eventos_amanha', 'notif_leilao', 'notif_missao_avaliada', 'notif_nova_atividade',
        'notif_novo_cadastro', 'notif_pontos_unidade', 'nova_temporada', 'pedir_ajuda', 'pedir_vinculo', 'pets_do_clube',
        'pode_apontar', 'pode_aprovar', 'pode_gerir', 'pontos_temporada_unidade', 'premiar_campeao_semana', 'premiar_melhores_do_dia',
        'premiar_rodada_semana', 'progresso_duelo', 'progresso_lado', 'protege_campos_perfil', 'ranking_semana', 'ranking_totais',
        'ranking_trilha', 'recordes_semana', 'recusar_lance_conjunto', 'reflexo_so_desbravador', 'registrar_devocional', 'registrar_jogo',
        'registrar_missao', 'registrar_recorde', 'rejeitar_vinculo', 'resetar_senha_membro', 'resolver_ajuda', 'rodizio_ligado',
        'status_jogos_do_dia', 'temporada_inicio', 'trancar_jogo', 'versiculo_do_dia', 'vinculos_pendentes'
  )
 order by 1
$c$, null,
$t$Não aborta: quebra em runtime com 'function ... does not exist'. Função órfã: drop function public.<assinatura> (no Cartão de Classe: marcar_requisito(uuid), desmarcar_requisito(uuid) e avaliar_requisito(uuid, uuid, boolean), depois de backup). Se estiver em uso, reescreva com pode_gerir_no_clube(clube_atual_id()), membro_ativo_no_clube(...) ou pode_financeiro_no_clube(...).$t$),

( 9, 'dependentes-de-funcoes-dropadas', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
with esperadas(esquema, tabela, politica) as (values
  ('public','atividades','editar atividade'), ('public','atividades','gerir atividades'), ('public','biblia_leitura_atual','ler minha leitura atual'),
  ('public','biblia_leituras','ler minhas leituras biblia'), ('public','bichinhos','ler meu bichinho'), ('public','config_clube','gerir config'),
  ('public','desafios','gerir desafios'), ('public','desafios','ler desafios'), ('public','desafios_unidade','gerir desafios_unidade'),
  ('public','devocional','ler devocional'), ('public','duelos','apagar duelo'), ('public','entregas','apagar entrega'),
  ('public','entregas','corrigir entrega'), ('public','entregas','ler entregas'), ('public','eventos','gerir eventos'),
  ('public','fotos','apagar foto'), ('public','fotos','ler fotos'), ('public','jogos_liberados','ler liberacoes'),
  ('public','jogos_trilha','gerir jogos_trilha'), ('public','mensalidades','gerir mensalidades'), ('public','mensalidades','ler mensalidades'),
  ('public','migracoes_aplicadas','ledger leitura lideranca'), ('public','missoes_feitas','ler missoes_feitas'), ('public','notificacoes','criar notificacao'),
  ('public','notificacoes','ler notificacoes'), ('public','partidas','auditoria partidas lideranca'), ('public','pontos','apagar pontos'),
  ('public','pontos','lancar pontos'), ('public','pontos','ler pontos'), ('public','profiles','admin atualiza perfis'),
  ('public','profiles','ler perfis'), ('public','recordes','apagar recordes'), ('public','recordes','ler recordes'),
  ('public','responsaveis','apagar responsaveis'), ('public','responsaveis','ler responsaveis'), ('public','trilha_jogos','apagar trilha_jogos'),
  ('public','trilha_jogos','ler trilha_jogos'), ('public','unidades','gerir unidades'), ('public','versiculos','gerir versiculos'),
  ('public','versiculos','ler versiculos'), ('storage','objects','apagar imagens'), ('storage','objects','atualizar imagens'),
  ('storage','objects','comprovacao dono ou lideranca le')
)
select distinct pg_describe_object(d.classid, d.objid, d.objsubid) || ' depende de ' || d.refobjid::regprocedure::text
       || ' (a 05/20/26 dropa sem cascade e aborta)' as item
  from pg_depend d
  left join pg_policy pol on d.classid = 'pg_policy'::regclass and pol.oid = d.objid
  left join pg_class c on c.oid = pol.polrelid
  left join pg_namespace n on n.oid = c.relnamespace
  left join pg_rewrite rw on d.classid = 'pg_rewrite'::regclass and rw.oid = d.objid
 where d.refclassid = 'pg_proc'::regclass and d.deptype = 'n'
   and d.refobjid in (select p.oid from pg_proc p where p.pronamespace = to_regnamespace('public') and p.pronargs = 0
                        and p.proname in ('pode_gerir', 'pode_aprovar', 'eh_membro_ativo', 'eh_financeiro',
                                          'listar_usuarios', 'rodizio_ligado', 'reflexo_so_desbravador'))
   and not (pol.oid is not null and (n.nspname::text, c.relname::text, pol.polname::text) in (select esquema, tabela, politica from esperadas))
   and not (rw.oid is not null and rw.ev_class = to_regclass('public.chat_mensagens_visiveis'))
 order by 1
$c$, null,
$t$Faça backup e confirme com a diretoria que o objeto não é usado (caso conhecido: o Cartão de Classe deixou as policies 'gerir classe_requisitos' e 'ler requisito_cumprido'; drop table public.requisito_cumprido, public.classe_requisitos e as 3 funções dele). No mínimo, drop do objeto listado (drop policy "<nome>" on <tabela> / drop view ...) ou reescreva-o com pode_gerir_no_clube(...) antes da janela.$t$),

(10, 'policies-fora-do-repo', 'PROBLEMA', array['public.*', 'storage.*'], 'nivel',
$c$
with conhecidas(esquema, tabela, politica) as (values
  ('public','atividades','editar atividade'), ('public','atividades','gerir atividades'), ('public','atividades','ler atividades'),
  ('public','biblia_leitura_atual','ler minha leitura atual'), ('public','biblia_leituras','ler minhas leituras biblia'), ('public','biblia_livros','ler livros biblia'),
  ('public','biblia_versiculos','ler versiculos biblia'), ('public','bichinhos','ler meu bichinho'), ('public','chat_conversas','ler minhas conversas'),
  ('public','chat_mensagens','ler mensagens'), ('public','chat_participantes','ler participantes'), ('public','config_clube','gerir config'),
  ('public','config_clube','ler config'), ('public','desafios','gerir desafios'), ('public','desafios','ler desafios'),
  ('public','desafios_unidade','gerir desafios_unidade'), ('public','desafios_unidade','ler desafios_unidade'), ('public','devocional','ler devocional'),
  ('public','duelos','apagar duelo'), ('public','duelos','ler duelos'), ('public','entregas','apagar entrega'),
  ('public','entregas','corrigir entrega'), ('public','entregas','criar entrega'), ('public','entregas','ler entregas'),
  ('public','entregas','reenviar entrega'), ('public','eventos','gerir eventos'), ('public','eventos','ler eventos'),
  ('public','fotos','apagar foto'), ('public','fotos','ler fotos'), ('public','fotos','postar foto'),
  ('public','jogos_liberados','ler liberacoes'), ('public','jogos_trilha','gerir jogos_trilha'), ('public','jogos_trilha','ler jogos_trilha'),
  ('public','leilao_itens','ler leilao_itens'), ('public','leilao_lance_unidades','ler leilao_lance_unidades'), ('public','leilao_lances','ler leilao_lances'),
  ('public','leiloes','ler leiloes'), ('public','mensalidades','gerir mensalidades'), ('public','mensalidades','ler mensalidades'),
  ('public','migracoes_aplicadas','ledger leitura lideranca'), ('public','missoes_feitas','ler missoes_feitas'), ('public','notificacoes','criar notificacao'),
  ('public','notificacoes','ler notificacoes'), ('public','partidas','auditoria partidas lideranca'), ('public','pontos','apagar pontos'),
  ('public','pontos','lancar pontos'), ('public','pontos','ler pontos'), ('public','profiles','admin atualiza perfis'),
  ('public','profiles','editar proprio perfil'), ('public','profiles','ler perfis'), ('public','push_subscriptions','minhas inscricoes'),
  ('public','push_tokens','meus tokens push'), ('public','recordes','apagar recordes'), ('public','recordes','ler recordes'),
  ('public','responsaveis','apagar responsaveis'), ('public','responsaveis','ler responsaveis'), ('public','temporadas','ler temporadas'),
  ('public','trilha_jogos','apagar trilha_jogos'), ('public','trilha_jogos','ler trilha_jogos'), ('public','unidades','gerir unidades'),
  ('public','unidades','ler unidades publico'), ('public','versiculos','gerir versiculos'), ('public','versiculos','ler versiculos'),
  ('storage','objects','apagar imagens'), ('storage','objects','atualizar imagens'), ('storage','objects','comprovacao dono envia'),
  ('storage','objects','comprovacao dono ou lideranca le'), ('storage','objects','ler imagens publico'), ('storage','objects','subir imagens')
)
select p.schemaname || '.' || p.tablename || ' "' || p.policyname || '" (' || p.cmd || ' ' || p.roles::text || '): '
       || case when 'anon' = any (p.roles) and p.schemaname = 'public' then 'a 72 ABORTA (policy para anon)'
               when p.cmd in ('INSERT', 'UPDATE', 'DELETE') and 'authenticated' = any (p.roles) and p.qual is null and p.with_check is null
                 then 'a 68 ABORTA (escrita sem predicado)'
               when coalesce(p.qual, '') || coalesce(p.with_check, '') ~ '(pode_gerir|pode_aprovar|eh_membro_ativo|eh_financeiro)\s*\(\s*\)'
                 then 'a 26 ABORTA (usa helper dropado)'
               when 'public' = any (p.roles) then 'vale também para anon: vaza entre clubes, sem erro'
               else 'sobrevive a todas as migrations: soma (OR) com as policies por clube' end as item
  from pg_policies p
 where p.schemaname in ('public', 'storage')
   -- tabela só de produção (fora do inventário e sem club_id): nenhuma migration a toca, nem a trava
   -- da 68/72 (que só olha tabelas com club_id) — vai para objetos-em-tabelas-so-de-producao (AVISO)
   and (p.schemaname = 'storage' or p.tablename::text = any ({{tabelas_legadas}})
        or exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
                    where c.relnamespace = to_regnamespace('public') and c.relname = p.tablename
                      and a.attname = 'club_id' and a.attnum > 0 and not a.attisdropped))
   and (p.schemaname::text, p.tablename::text, p.policyname::text) not in (select esquema, tabela, politica from conhecidas)
 order by 1
$c$, null,
$t$Descubra a origem de cada policy e remova-a antes da janela: drop policy "<nome>" on <esquema>.<tabela>. Se o acesso fizer falta, recrie-a DEPOIS do upgrade, por clube (pode_gerir_no_clube/membro_ativo_no_clube e clube_atual_id()), nunca TO public/anon. Se precisar ficar, traga-a para o repo e para o pre_dados.sql. (Policy de tabela que só existe em produção sai em objetos-em-tabelas-so-de-producao.)$t$),

(11, 'constraints-e-indices-unicos-fora-do-padrao', 'PROBLEMA', array['public.*'], 'nivel',
$c$
with tabelas(t) as (select unnest({{tabelas_legadas}})),
-- chaves que as migrations dropam (20, 24, 11/14/74, 35; 81/82): uma FK apoiada nelas faz o drop abortar
chaves_dropadas(nome) as (select unnest(array[
    'config_clube_pkey', 'jogos_trilha_pkey', 'jogos_liberados_pkey', 'mensalidades_desbravador_id_mes_ano_key',
    'recordes_usuario_id_jogo_semana_key', 'trilha_jogos_usuario_data_tipo_key', 'responsaveis_par_aprovado_key'
  ])),
unicos(nome) as (select unnest(array[
    'ajudas_pkey', 'atividades_pkey', 'biblia_leitura_atual_pkey', 'biblia_leituras_pkey', 'biblia_livros_pkey',
    'biblia_versiculos_pkey', 'bichinhos_pkey', 'chat_conversas_pkey', 'uma_conversa_geral', 'uma_conversa_por_unidade',
    'chat_mensagens_pkey', 'chat_participantes_pkey', 'chefao_golpes_pkey', 'config_clube_pkey', 'desafios_pkey',
    'desafios_unidade_pkey', 'devocional_pkey', 'devocional_usuario_id_data_key', 'duelos_par_aberto_key', 'duelos_pkey',
    'entregas_atividade_id_usuario_id_key', 'entregas_pkey', 'eventos_pkey', 'fotos_pkey', 'jogos_liberados_pkey',
    'jogos_trilha_pkey', 'leilao_itens_pkey', 'leilao_lance_unidades_pkey', 'leilao_lances_pkey', 'leiloes_pkey',
    'um_leilao_aberto', 'mensalidades_desbravador_id_mes_ano_key', 'mensalidades_pkey', 'migracoes_aplicadas_pkey', 'missoes_feitas_pkey',
    'missoes_feitas_usuario_id_data_key', 'notificacoes_pkey', 'partidas_pkey', 'pontos_pkey', 'profiles_pkey',
    'push_subscriptions_endpoint_key', 'push_subscriptions_pkey', 'push_tokens_pkey', 'recordes_pkey', 'recordes_usuario_id_jogo_semana_key',
    'responsaveis_par_aprovado_key', 'responsaveis_pkey', 'temporadas_pkey', 'uma_temporada_aberta', 'trilha_jogos_pkey',
    'trilha_jogos_usuario_data_tipo_key', 'unidades_pkey', 'versiculos_pkey'
  ])),
checks(nome) as (select unnest(array[
    'profiles_avatar_tipo_valido', 'desafios_unidade_tipo_valido', 'duelos_status_valido', 'duelos_unidades_diferentes', 'duelos_vencedor_valido',
    'responsaveis_status_valido', 'leiloes_status_valido', 'leilao_itens_incremento_valido', 'leilao_itens_preco_valido', 'leilao_lances_status_valido',
    'leilao_lances_valor_valido', 'chat_conversas_tipo_valido', 'chat_conversas_unidade_coerente', 'chat_mensagens_texto_valido', 'biblia_livros_testamento_check',
    'bichinhos_cenario_ok', 'bichinhos_cor_ok', 'bichinhos_especie_valida', 'bichinhos_item_ok', 'bichinhos_movel_ok',
    'bichinhos_nome_ok', 'bichinhos_olhos_ok'
  ])),
fks(nome) as (select unnest(array[
    'profiles_id_fkey', 'profiles_unidade_id_fkey', 'atividades_criado_por_fkey', 'entregas_atividade_id_fkey', 'entregas_avaliado_por_fkey',
    'entregas_usuario_id_fkey', 'pontos_entrega_id_fkey', 'pontos_lancado_por_fkey', 'pontos_unidade_id_fkey', 'pontos_usuario_id_fkey',
    'fotos_autor_id_fkey', 'mensalidades_desbravador_id_fkey', 'mensalidades_registrado_por_fkey', 'notificacoes_criado_por_fkey', 'notificacoes_para_usuario_fkey',
    'push_subscriptions_user_id_fkey', 'versiculos_livro_abrev_fkey', 'devocional_usuario_id_fkey', 'missoes_feitas_usuario_id_fkey', 'trilha_jogos_usuario_id_fkey',
    'eventos_criado_por_fkey', 'temporadas_criado_por_fkey', 'duelos_criado_por_fkey', 'duelos_desafio_id_fkey', 'duelos_julgado_por_fkey',
    'duelos_unidade_a_fkey', 'duelos_unidade_b_fkey', 'responsaveis_aprovado_por_fkey', 'responsaveis_desbravador_id_fkey', 'responsaveis_responsavel_id_fkey',
    'recordes_jogo_fkey', 'recordes_usuario_id_fkey', 'ajudas_de_id_fkey', 'ajudas_para_id_fkey', 'ajudas_resolvido_por_fkey',
    'leiloes_criado_por_fkey', 'leilao_itens_leilao_id_fkey', 'leilao_itens_vencedor_lance_id_fkey', 'leilao_lances_criado_por_fkey', 'leilao_lances_item_id_fkey',
    'leilao_lance_unidades_lance_id_fkey', 'leilao_lance_unidades_unidade_id_fkey', 'chat_conversas_unidade_id_fkey', 'chat_participantes_conversa_id_fkey', 'chat_participantes_usuario_id_fkey',
    'chat_mensagens_apagada_por_fkey', 'chat_mensagens_autor_id_fkey', 'chat_mensagens_conversa_id_fkey', 'biblia_versiculos_livro_abrev_fkey', 'biblia_leituras_livro_abrev_fkey',
    'biblia_leituras_usuario_id_fkey', 'biblia_leitura_atual_livro_abrev_fkey', 'biblia_leitura_atual_usuario_id_fkey', 'bichinhos_usuario_id_fkey', 'jogos_liberados_chave_fkey',
    'jogos_liberados_liberado_por_fkey', 'chefao_golpes_usuario_id_fkey', 'push_tokens_user_id_fkey'
  ])),
rel as (select c.oid, c.relname::text as t from pg_class c where c.relnamespace = to_regnamespace('public') and c.relname in (select t from tabelas))
select 'índice único fora do repo em ' || r.t || ': ' || i.relname || ' — ' || pg_get_indexdef(x.indexrelid) as item
  from pg_index x join pg_class i on i.oid = x.indexrelid join rel r on r.oid = x.indrelid
 where x.indisunique and i.relname not in (select nome from unicos)
union all
select 'índice único/PK esperado ausente: ' || u.nome
  from unicos u
 where not exists (select 1 from pg_class i where i.relnamespace = to_regnamespace('public') and i.relname = u.nome and i.relkind = 'i')
union all
select 'CHECK fora do repo em ' || r.t || ': ' || k.conname || ' — ' || pg_get_constraintdef(k.oid)
  from pg_constraint k join rel r on r.oid = k.conrelid
 where k.contype = 'c' and k.conname not in (select nome from checks)
union all
select 'CHECK chat_conversas_tipo_valido sem geral (o chat-geral.sql não rodou): ' || pg_get_constraintdef(k.oid)
  from pg_constraint k
 where k.conrelid = to_regclass('public.chat_conversas') and k.conname = 'chat_conversas_tipo_valido'
   and pg_get_constraintdef(k.oid) not like '%geral%'
union all
select 'FK fora do repo: ' || k.conrelid::regclass::text || ' ' || k.conname || ' — ' || pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid
 where k.contype = 'f'
   -- FK de tabela legada, ou FK de qualquer tabela apoiada numa chave que as migrations dropam; a FK de
   -- tabela só de produção para outra chave (profiles_pkey, unidades_pkey...) não aborta nada: sai em
   -- objetos-em-tabelas-so-de-producao (AVISO)
   and (k.conrelid in (select oid from rel)
        or (k.confrelid in (select oid from rel)
            and k.conindid in (select i.oid from pg_class i where i.relnamespace = to_regnamespace('public')
                                  and i.relname in (select nome from chaves_dropadas))))
   and c.relnamespace not in (select oid from pg_namespace where nspname in ('auth', 'storage'))
   and k.conname not in (select nome from fks)
 order by 1
$c$, null,
$t$Equivalente com outro nome: renomeie para o padrão (alter table ... rename constraint <nome> to <padrão> / alter index ... rename to ...). Índice único extra que duplica o padrão: drop index public.<nome>. CHECK em profiles.status/papel: remova-o ou amplie para aceitar 'suspenso' e 'encerrado'. FK extra para config_clube, jogos_trilha, jogos_liberados, mensalidades ou recordes (chave que a migration dropa): remova-a. PK ausente em pontos/unidades: limpe duplicatas e nulos e alter table ... add primary key (id). chat_conversas_tipo_valido sem 'geral': rode 20260826000005_chat-geral.sql.$t$),

(12, 'gatilhos-fora-do-repo', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
with conhecidos(tabela, gatilho, funcao) as (values
  ('auth.users','on_auth_user_created','handle_new_user'), ('public.pontos','trg_limita_pontos_conselheiro','limita_pontos_conselheiro'),
  ('public.pontos','trg_notif_pontos_unidade','notif_pontos_unidade'), ('public.profiles','trg_notif_cadastro_aprovado','notif_cadastro_aprovado'),
  ('public.profiles','trg_notif_novo_cadastro','notif_novo_cadastro'), ('public.profiles','trg_protege_perfil','protege_campos_perfil'),
  ('public.duelos','trg_notif_duelo','notif_duelo'), ('public.entregas','trg_notif_entrega_avaliada','notif_entrega_avaliada'),
  ('public.leiloes','trg_notif_leilao','notif_leilao'), ('public.missoes_feitas','trg_notif_missao_avaliada','notif_missao_avaliada'),
  ('public.atividades','trg_notif_nova_atividade','notif_nova_atividade')
),
-- tabela e função pelo catálogo: to_regclass('auth.users') sem USAGE em auth dá "permission denied"
k as (
  select k.*,
         (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = split_part(k.tabela, '.', 1) and c.relname = split_part(k.tabela, '.', 2)) as rel,
         (select p.oid from pg_proc p where p.pronamespace = to_regnamespace('public') and p.proname = k.funcao and p.pronargs = 0) as fn
    from conhecidos k
)
select 'gatilho fora do repo: ' || n.nspname || '.' || c.relname || ' ' || t.tgname || ' → ' || t.tgfoid::regprocedure::text
       || case t.tgenabled when 'D' then ' (desligado)' else '' end as item
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal
   -- só tabela legada e auth.users; gatilho de tabela só de produção sai em objetos-em-tabelas-so-de-producao
   and ((n.nspname = 'public' and c.relname::text = any ({{tabelas_legadas}})) or (n.nspname = 'auth' and c.relname = 'users'))
   and (n.nspname || '.' || c.relname, t.tgname::text) not in (select tabela, gatilho from conhecidos)
   and not (n.nspname = 'public' and c.relname = 'notificacoes' and t.tgfoid::regprocedure::text like 'supabase_functions.http_request%')
union all
select 'gatilho do repo desligado ou apontando para outra função: ' || k.tabela || ' ' || t.tgname || ' → ' || t.tgfoid::regprocedure::text
  from pg_trigger t join k on t.tgrelid = k.rel and k.gatilho = t.tgname
 where t.tgenabled = 'D' or t.tgfoid is distinct from k.fn
union all
select 'gatilho do repo ausente: ' || k.tabela || ' ' || k.gatilho
  from k
 where not exists (select 1 from pg_trigger t where t.tgrelid = k.rel and t.tgname = k.gatilho)
 order by 1
$c$, null,
$t$Gatilho de teto com outro nome: renomeie para um que ordene DEPOIS de trg_definir_club_ponto (o legado usa trg_limita_pontos_conselheiro). Webhooks/gatilhos manuais em profiles e auth.users: remova, ou desligue durante a janela (alter table ... disable trigger ...) e religue depois. Garanta um único on_auth_user_created executando public.handle_new_user(), como no baseline (20260701000000_legacy_baseline.sql:72-74).$t$),

(13, 'extensoes-obrigatorias', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
-- pelo catálogo: to_regprocedure/to_regclass num schema sem USAGE dá "permission denied" (a falta de
-- USAGE é com permissoes-do-papel-do-sql-editor)
select 'pgcrypto: falta extensions.' || f.nome || '(' || replace(f.args, ' ', '') || ') (a 44/45 abortam; convite, cadastro de responsável, senha e todo INSERT em notificacoes da 55 quebram)' as item
  from (values ('digest', 'text, text'), ('gen_random_bytes', 'integer'), ('crypt', 'text, text'), ('gen_salt', 'text')) f(nome, args)
 where not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('extensions') and p.proname = f.nome
                      and pg_get_function_identity_arguments(p.oid) = f.args)
union all
select 'pg_cron ausente: a 53, 54, 55 e 57 chamam cron.schedule/cron.job e ABORTAM'
 where not exists (select 1 from pg_class c where c.relnamespace = to_regnamespace('cron') and c.relname = 'job')
union all
select 'supabase_vault ausente: depois da 52 todo INSERT em notificacoes aborta (e a operação que o gerou)'
 where not exists (select 1 from pg_class c where c.relnamespace = to_regnamespace('vault') and c.relname = 'decrypted_secrets')
union all
select 'pg_net ausente e indisponível para instalar: a 52 aborta no create extension'
 where not exists (select 1 from pg_extension where extname = 'pg_net')
   and not exists (select 1 from pg_available_extensions where name = 'pg_net')
$c$, null,
$t$Em Database > Extensions, antes da janela: habilite pgcrypto no schema extensions (se estiver em public: alter extension pgcrypto set schema extensions), pg_cron e supabase_vault. Sem pg_cron a janela para: as migrations 53+ abortam.$t$),

(14, 'permissoes-do-papel-do-sql-editor', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
with me as (select r.rolname, r.rolsuper from pg_roles r where r.rolname = current_user),
so as (select (select c.oid from pg_class c where c.relnamespace = to_regnamespace('storage') and c.relname = 'objects') as objetos,
              (select c.oid from pg_class c where c.relnamespace = to_regnamespace('storage') and c.relname = 'buckets') as buckets)
select 'sem USAGE no schema ' || s.nome || ': ' || s.efeito as item
  from (values ('auth', 'as policies e funções com auth.uid()/auth.users das migrations abortam'),
               ('extensions', 'as migrations que chamam extensions.* (pgcrypto, a partir da 12) abortam'),
               ('storage', 'as policies e gatilhos de storage.objects (16, 18, 31, 54, 69) abortam'),
               ('cron', 'a 53, 54, 55 e 57 (cron.schedule) abortam'),
               ('vault', 'o gatilho de push (52/55) não lê os segredos: todo INSERT em notificacoes aborta'),
               ('net', 'o gatilho de push (52/55) não chama net.http_post: todo INSERT em notificacoes aborta')) s(nome, efeito)
 where to_regnamespace(s.nome) is not null and not coalesce(has_schema_privilege(to_regnamespace(s.nome), 'USAGE'), false)
union all
select 'storage.objects ou storage.buckets não existe (o Storage não está instalado)'
  from so where so.objetos is null or so.buckets is null
union all
select 'sem permissão de criar/remover policy em storage.objects (16, 18, 31 e 69 abortam)'
  from me, so
 where so.objetos is not null and not me.rolsuper
   and not coalesce(pg_has_role(current_user, (select relowner from pg_class where oid = so.objetos), 'MEMBER'), false)
   and coalesce(current_setting('supautils.policy_grants', true), '') !~ ('"' || current_user || '"\s*:\s*\[[^]]*"storage\.objects"')
union all
select 'sem privilégio TRIGGER em storage.objects (a 54 aborta)'
  from so where so.objetos is not null and not has_table_privilege(so.objetos, 'TRIGGER')
union all
select 'sem privilégio ' || p || ' em storage.buckets (28/31/32 abortam)'
  from so, unnest(array['INSERT', 'UPDATE', 'SELECT']) p
 where so.buckets is not null and not has_table_privilege(so.buckets, p)
union all
select 'storage.objects sem a coluna owner_id (Storage desatualizado: a 31 aborta)'
  from so
 where so.objetos is not null
   and not exists (select 1 from pg_attribute a where a.attrelid = so.objetos and a.attname = 'owner_id' and a.attnum > 0 and not a.attisdropped)
union all
select 'não pode fazer SET session_replication_role (a 49 aborta no bloco S do seed)'
  from me
 where not me.rolsuper
   and not exists (select 1 from pg_roles pr
                    where pr.rolname = current_setting('supautils.privileged_role', true)
                      and pg_has_role(current_user, pr.oid, 'MEMBER')
                      and coalesce(current_setting('supautils.privileged_role_allowed_configs', true), '') ~ '(^|[ ,])session_replication_role([ ,]|$)')
$c$, null,
$t$Rode o pré-voo com o MESMO papel das migrations (postgres, no SQL Editor). Prova direta do SET, sem gravar nada: do $$ begin set local session_replication_role = replica; end $$; tem de rodar sem erro — se falhar, retire da cópia aplicada o bloco 'S) TRÊS EXPERIÊNCIAS PILOTO' da 49 (só semeia dado [TESTE]). Falta de USAGE num schema: grant usage on schema <schema> to postgres; (como o dono do schema; auth, storage, cron, vault e net pelo suporte do Supabase, se preciso). Falta de policy/TRIGGER/buckets/owner_id: resolva com o suporte do Supabase (atualizar o Storage ou conceder o privilégio).$t$),

(15, 'default-acl-de-funcoes', 'PROBLEMA', '{}'::text[], 'nivel',
$c$
select 'o default ACL de funções do postgres (global ou em public) não dá EXECUTE a ' || g as item
  from unnest(array['authenticated', 'service_role']) g
 where not exists (select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
                    where d.defaclrole = to_regrole('postgres') and d.defaclobjtype = 'f'
                      and d.defaclnamespace in (0::oid, to_regnamespace('public')::oid)
                      and a.grantee = to_regrole(g) and a.privilege_type = 'EXECUTE')
$c$, null,
$t$Antes da janela: alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role; (sem isso, funções criadas depois da 13 sem GRANT explícito dão 'permission denied' em runtime: aprovar/editar membro, leilão, convites).$t$),

(16, 'buckets-de-storage', 'PROBLEMA',
  array['storage.buckets.id:text', 'storage.buckets.name:text', 'storage.buckets.public:boolean', 'storage.objects.bucket_id:text'], 'nivel',
$c$
select 'bucket comprovacoes não existe: o front desvia as comprovações (inclusive vídeo) para imagens, que a 28 limita a imagem de 15 MB' as item
 where not exists (select 1 from storage.buckets where id = 'comprovacoes')
union all
select 'bucket comprovacoes está PÚBLICO: a restrição da 69 não vale para a URL pública'
 where exists (select 1 from storage.buckets where id = 'comprovacoes' and public)
union all
select 'bucket imagens não existe: a 28 e a 32 não fazem nada e o app perde o destino das fotos'
 where not exists (select 1 from storage.buckets where id = 'imagens')
union all
select 'já existe bucket id/name publico (' || b.id || ', ' || (select count(*) from storage.objects o where o.bucket_id = b.id) || ' objetos): a 31 o reconfigura ou aborta'
  from storage.buckets b where b.id = 'publico' or b.name = 'publico'
$c$, null,
$t$Rode 20260828000008_storage-comprovacoes.sql antes da janela (a policy dele com pode_gerir() é trocada na 16). Bucket comprovacoes público: update storage.buckets set public = false where id = 'comprovacoes'. Bucket 'publico' já existente: mova/renomeie o bucket e os objetos — esse nome fica reservado para a marca dos clubes.$t$),

(17, 'metadados-de-storage-que-abortam-a-54', 'PROBLEMA',
  array['storage.objects.bucket_id:text', 'storage.objects.name:text', 'storage.objects.metadata:jsonb'], 'nivel',
$c$
select o.bucket_id || '/' || o.name || ': metadata.size = ' || coalesce(quote_literal(o.metadata->>'size'), 'nulo')
       || ' não é inteiro >= 0 (o ::bigint da carga inicial da 54 aborta)' as item
  from storage.objects o
 where o.metadata ? 'size' and coalesce(o.metadata->>'size', '') !~ '^[0-9]{1,18}$'
union all
select o.bucket_id || '/' || o.name || ': dono com prefixo de uuid mas uuid inválido (o ::uuid da 54 aborta)'
  from storage.objects o
 where coalesce(to_jsonb(o)->>'owner_id', to_jsonb(o)->>'owner') ~ '^[0-9a-f]{8}-'
   and coalesce(to_jsonb(o)->>'owner_id', to_jsonb(o)->>'owner') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 order by 1
$c$, null,
$t$Reenvie o arquivo pelo app/painel (recalcula o metadata) ou remova o objeto lixo. Com owner_id malformado: anule-o ou grave o uuid certo, antes da janela.$t$),

(18, 'pontos-fora-do-teto', 'PROBLEMA',
  array['public.pontos.id:uuid', 'public.pontos.pontos:integer|bigint|smallint|numeric'], 'nivel',
$c$
select 'ponto ' || id || ': ' || pontos || ' pontos' as item
  from public.pontos where pontos not between -1000000 and 1000000
 order by abs(pontos::numeric) desc
$c$, null,
$t$A 28 cria pontos_valor_razoavel (±1.000.000) NOT VALID: essas linhas passam a falhar em qualquer UPDATE (excluir_usuario zera lancado_por) e as somas ::int estouram. Com a diretoria, estorne ou corrija antes da janela (lançamento de ajuste ou update do valor).$t$),

(19, 'leiloes-abertos-em-risco', 'PROBLEMA',
  array['public.leiloes.id:uuid', 'public.leiloes.titulo:text', 'public.leiloes.fecha_em:timestamptz', 'public.leiloes.status:text',
        'public.leilao_itens.id:uuid', 'public.leilao_itens.leilao_id:uuid', 'public.leilao_lances.id:uuid',
        'public.leilao_lances.item_id:uuid', 'public.leilao_lances.status:text', 'public.leilao_lance_unidades.lance_id:uuid'], 'nivel',
$c$
with l as (
  select le.id, le.titulo, le.fecha_em,
         (select count(*) from public.leilao_itens it join public.leilao_lances lc on lc.item_id = it.id
           where it.leilao_id = le.id and lc.status in ('ativo', 'pendente')
             and (select count(*) from public.leilao_lance_unidades lu where lu.lance_id = lc.id) > 1) as conjuntos
    from public.leiloes le where le.status = 'aberto'
)
select 'leilão ' || id || ' (' || coalesce(titulo, '?') || ', fecha ' || to_char(fecha_em, 'YYYY-MM-DD HH24:MI TZ') || '): '
       || case when fecha_em < clock_timestamp() + interval '24 hours'
               then 'fecha nas próximas 24h — se cair entre a 08 e a 15, o cron fecha com saldo 0 e o vencedor leva sem pagar'
               else conjuntos || ' lance(s) conjunto(s) vivo(s) — depois da 60 o saldo coletivo conta em dobro em confirmar_lance_conjunto' end as item
  from l
 where fecha_em < clock_timestamp() + interval '24 hours' or conjuntos > 0
 order by fecha_em
$c$, null,
$t$Rode no dia da janela. Encerre ou cancele pelo app os leilões listados, ou pause o job durante o upgrade: select cron.alter_job((select jobid from cron.job where jobname = 'fechar-leiloes-vencidos'), active := false); e reative depois da 28. Não abra leilão com lance conjunto até corrigir confirmar_lance_conjunto (somar de volta sum(r.parcela) de public._leilao_rateio(l.id)).$t$),

(20, 'cron-jobs-conflitantes', 'PROBLEMA',
  array['cron.job.jobid:bigint|integer', 'cron.job.jobname:text|name', 'cron.job.username:text|name'], 'ok',
$c$
select 'job ' || j.jobid || ' ' || coalesce(j.jobname, '(sem nome)') || ': nome reservado por uma migration do SaaS (53/54/55/57) — o job novo NÃO é criado' as item
  from cron.job j where j.jobname in ('expurgar-app-erros', 'reconciliar-armazenamento', 'expurgar-push', 'alertas')
union all
select 'job ' || j.jobid || ' ' || coalesce(j.jobname, '(sem nome)') || ' roda como ' || j.username || ' (sem superusuário): perde EXECUTE com o revoke da 13 e falha calado'
  from cron.job j left join pg_roles r on r.rolname = j.username
 where j.username <> 'postgres' and not coalesce(r.rolsuper, false)
 order by 1
$c$, null,
$t$Antes da janela: select cron.unschedule('<nome>'); para o job homônimo (ou renomeie-o). Os jobs de outro papel: recrie como postgres no SQL Editor (unschedule e schedule).$t$),

(21, 'pacote-curricular-colado-integro', 'AVISO', '{}'::text[], 'nivel',
$c$
select 'conferência pendente, fora do banco: a colagem de ~39 KB da 40 e da 43 só existe na janela — confira-a com o BLOCO À PARTE no fim deste arquivo (sha256)' as item
$c$, null,
$t$Na janela, antes da 40 e antes da 43: desligue o Intellisense do SQL Editor, recarregue a aba, cole com Ctrl+V (nunca digitando) e rode o BLOCO À PARTE com a MESMA colagem. Se ele devolver uma linha, NÃO aplique: o importador não recalcula o sha256 e publicaria um currículo OFICIAL corrompido.$t$),

-- ---------------------------------------------------------------------------------------------- AVISO
(22, 'sessoes-longas-e-locks', 'AVISO', '{}'::text[], 'nivel',
$c$
select 'pid ' || pid || ' (' || coalesce(usename::text, '?') || coalesce(', ' || nullif(application_name, ''), '') || '): transação aberta há '
       || date_trunc('second', clock_timestamp() - xact_start) || ', ' || coalesce(state, '?')
       || coalesce(', esperando ' || wait_event_type, '') as item
  from pg_stat_activity
 where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
   and xact_start is not null and xact_start < clock_timestamp() - interval '30 seconds'
union all
-- AccessExclusiveLock (ALTER/DROP/LOCK) concedido OU na fila, de qualquer idade: bloqueia toda leitura da
-- tabela — inclusive a do pré-voo, que por isso diz "travada" nas verificações que a leem
select 'pid ' || coalesce(l.pid::text, '? (transação preparada)') || ': ' || case when l.granted then 'segura' else 'espera na fila por' end
       || ' AccessExclusiveLock em ' || n.nspname || '.' || c.relname || ' — toda leitura dessa tabela fica presa atrás dele'
  from pg_locks l join pg_class c on c.oid = l.relation join pg_namespace n on n.oid = c.relnamespace
 where l.locktype = 'relation' and l.mode = 'AccessExclusiveLock'
   and l.database = (select d.oid from pg_database d where d.datname = current_database())
   and l.pid is distinct from pg_backend_pid()
   and n.nspname in ('public', 'storage', 'auth', 'cron', 'vault', 'net', 'supabase_migrations')
 order by 1
$c$, null,
$t$Faça a janela em horário combinado e sem uso; antes de cada migration a lista tem de vir vazia. Comece cada execução com set lock_timeout = '15s'; — a migration é atômica e falha rápido em vez de congelar o app. Lock de outra sessão (ou verificação "travada"): descubra quem é (select * from pg_stat_activity where pid = <pid>), espere terminar ou, combinado com quem a abriu, select pg_terminate_backend(<pid>); e rode o pré-voo de novo.$t$),

(23, 'tesoureiro-ativo-vs-mensalidades_ano', 'AVISO', array['public.profiles.papel:text', 'public.profiles.status:text'], 'nivel',
$c$
-- A 59 cria mensalidades_ano com o portão de gestão (instrutor/diretoria) e só a 80 o troca por
-- pode_financeiro_no_clube. Antes da janela não há o que corrigir no banco: é um passo da janela.
with t as (select count(*) as n from public.profiles where papel = 'tesoureiro' and status = 'ativo'),
f as (select p.oid, p.proname, p.prosrc from pg_proc p where p.pronamespace = to_regnamespace('public') and p.proname = 'mensalidades_ano')
select 'public.' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ') já existe com o portão da 59 (sem pode_financeiro_no_clube): '
       || t.n || ' tesoureiro(s) ativo(s) veem a aba Ano inteiro vazia (todos como NÃO PAGO)' as item
  from f, t
 where t.n > 0 and f.prosrc !~ 'pode_financeiro_no_clube'
union all
select t.n || ' tesoureiro(s) ativo(s): a 20260924000059 cria mensalidades_ano com o portão de gestão e só a 20260930000080 o troca por pode_financeiro_no_clube — a janela vai até a 80, sem parar entre as duas'
  from t
 where t.n > 0 and not exists (select 1 from f)
$c$, null,
$t$Aplique a 20260930000080 (mensalidades_ano com pode_financeiro_no_clube) na mesma janela, logo depois da 59; nunca pare entre as duas. Não se corrige promovendo o tesoureiro a diretoria.$t$),

(24, 'webhook-de-push-do-painel', 'AVISO', array['public.notificacoes'], 'ok',
$c$
select 'gatilho ' || t.tgname || case t.tgenabled when 'D' then ' (desligado)' else '' end || ' em notificacoes → '
       || t.tgfoid::regprocedure::text
       || case when pg_get_triggerdef(t.oid) ilike '%x-push-webhook-secret%' then ' (manda x-push-webhook-secret)'
               else ' (sem x-push-webhook-secret: vira 401 e alerta crítico depois da 55/57)' end as item
  from pg_trigger t join pg_proc f on f.oid = t.tgfoid
 where t.tgrelid = to_regclass('public.notificacoes') and not t.tgisinternal
   and (f.pronamespace::regnamespace::text in ('supabase_functions', 'net') or f.proname like 'http%')
 order by 1
$c$, null,
$t$Na janela, nesta ordem: 1) aplicar até a 58; 2) publicar a enviar-push nova; 3) criar os segredos no Vault; 4) apagar o hook em Database > Webhooks; 5) inserir uma notificação de teste e conferir 200 em net._http_response e 'entregue' em push_tentativas. Não preencha o Vault com o hook e a função antiga no ar (cada aviso tocaria duas vezes).$t$),

(25, 'segredos-de-push-no-vault', 'AVISO', array['vault.secrets.name:text|name'], 'ok',
$c$
select 'falta o segredo ' || n || ' no Vault' as item
  from unnest(array['push_edge_url', 'push_webhook_secret']) n
 where not exists (select 1 from vault.secrets s where s.name = n)
$c$, null,
$t$É o passo 3 da ordem da janela (ver webhook-de-push-do-painel): select vault.create_secret('https://<ref>.supabase.co/functions/v1/enviar-push', 'push_edge_url', 'URL da Edge Function enviar-push'); e select vault.create_secret('<mesmo valor do PUSH_WEBHOOK_SECRET>', 'push_webhook_secret', 'Fechadura do webhook de push');. Sem eles, o gatilho da 52 não envia nada e a 57 abre push_degradado.$t$),

(26, 'cron-jobs-desconhecidos-ou-ausentes', 'AVISO',
  array['cron.job.jobid:bigint|integer', 'cron.job.jobname:text|name', 'cron.job.active:boolean'], 'ok',
$c$
with legado(nome) as (select unnest(array[
    'aniversariantes-do-dia', 'lembrete-eventos', 'campeao-recorde-semana', 'rodada-semana', 'lembrar-jogos-do-dia',
    'lembrar-ausentes', 'fechar-leiloes-vencidos', 'melhores-do-dia', 'chefao-fim'
  ]))
select 'job ' || coalesce(j.jobname, '(sem nome, id ' || j.jobid || ')') || ': fora do repo — depois da 70 grava sem clube e passa a falhar em silêncio' as item
  from cron.job j
 where coalesce(j.jobname, '') not in (select nome from legado)
   and coalesce(j.jobname, '') not in ('expurgar-app-erros', 'reconciliar-armazenamento', 'expurgar-push', 'alertas')
union all
select 'job ' || j.jobname || ': do repo, mas desativado' from cron.job j where j.jobname in (select nome from legado) and not j.active
union all
select 'job ' || l.nome || ': do repo, mas ausente (a rotina não roda hoje e continuará sem rodar)'
  from legado l where not exists (select 1 from cron.job j where j.jobname = l.nome)
 order by 1
$c$, null,
$t$Job fora do repo: select cron.unschedule('<nome>'), ou reescreva a função que ele chama para gravar com club_id explícito ou com para_usuario. Job do repo ausente/desativado: rode de novo o SQL legado que o agenda (ou cron.alter_job(..., active := true)).$t$),

(27, 'colunas-so-em-producao-em-profiles', 'AVISO', '{}'::text[], 'nivel',
$c$
select 'public.profiles.' || a.attname || ' (' || format_type(a.atttypid, a.atttypmod) || '): fica sem UPDATE depois da 34' as item
  from pg_attribute a
 where a.attrelid = to_regclass('public.profiles') and a.attnum > 0 and not a.attisdropped
   and a.attname not in ('id', 'nome', 'foto', 'nascimento', 'papel', 'cargo', 'unidade_id', 'status', 'created_at',
                         'notif_visto_em', 'teste', 'avatar', 'avatar_tipo')
 order by 1
$c$, null,
$t$A 34 regrava o UPDATE de profiles só em (nome, foto, nascimento, cargo, notif_visto_em, teste, avatar, avatar_tipo). Se o app usa a coluna, inclua-a nesse GRANT ou crie uma RPC; se não usa, remova-a.$t$),

(28, 'funcoes-fora-do-repo-ou-de-outro-dono', 'AVISO', '{}'::text[], 'nivel',
$c$
-- só função FORA do repo (a legada de outro dono, que a migration recria, é PROBLEMA em objetos-legados-de-outro-dono)
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '): fora do repo'
       || case when p.prosrc ~* 'insert\s+into\s+(public\.)?(notificacoes|pontos|fotos)\M' then ', grava em pontos/notificacoes/fotos (depois da 70, sem clube, falha)' else '' end
       || case when p.proowner is distinct from to_regrole('postgres')::oid then ', dono ' || pg_get_userbyid(p.proowner) || ' (o GRANT/REVOKE da 13 só avisa)' else '' end as item
  from pg_proc p
 where p.pronamespace = to_regnamespace('public')
   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
   and p.proname::text <> all ({{funcoes_legadas}})
 order by 1
$c$, null,
$t$Revise cada linha: apague a função se estiver morta; se estiver em uso e gravar em pontos/notificacoes/fotos, reescreva-a com club_id explícito ou para_usuario. Dono diferente: alter function ... owner to postgres (ou mova extensões instaladas em public para o schema extensions).$t$),

(29, 'objetos-em-tabelas-so-de-producao', 'AVISO', array['public.*'], 'nivel',
$c$
-- tabela de public fora do inventário legado e sem club_id: nenhuma migration a toca (nem a trava da
-- 68/72), então FK, gatilho e policy dela não abortam nada — mas atravessam o upgrade sem clube
with so_prod as (
  select c.oid, c.relname::text as t
    from pg_class c
   where c.relnamespace = to_regnamespace('public') and c.relkind in ('r', 'p')
     and c.relname::text <> all ({{tabelas_legadas}})
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'club_id' and a.attnum > 0 and not a.attisdropped)
)
select 'FK de ' || s.t || ' para tabela legada: ' || k.conname || ' — ' || pg_get_constraintdef(k.oid) as item
  from pg_constraint k join so_prod s on s.oid = k.conrelid join pg_class rf on rf.oid = k.confrelid
 where k.contype = 'f' and rf.relnamespace = to_regnamespace('public') and rf.relname::text = any ({{tabelas_legadas}})
   -- a apoiada numa chave que as migrations dropam é PROBLEMA em constraints-e-indices-unicos-fora-do-padrao
   and not exists (select 1 from pg_class i where i.oid = k.conindid
                      and i.relname in ('config_clube_pkey', 'jogos_trilha_pkey', 'jogos_liberados_pkey', 'mensalidades_desbravador_id_mes_ano_key',
                                        'recordes_usuario_id_jogo_semana_key', 'trilha_jogos_usuario_data_tipo_key', 'responsaveis_par_aprovado_key'))
union all
select 'gatilho em ' || s.t || ': ' || t.tgname || ' → ' || t.tgfoid::regprocedure::text || case t.tgenabled when 'D' then ' (desligado)' else '' end
  from pg_trigger t join so_prod s on s.oid = t.tgrelid
 where not t.tgisinternal
union all
select 'policy em ' || p.tablename || ': "' || p.policyname || '" (' || p.cmd || ' ' || p.roles::text || ')'
       || case when p.roles && array['public', 'anon']::name[] then ' — aberta a anon, sem clube' else '' end
  from pg_policies p
 where p.schemaname = 'public' and p.tablename::text in (select t from so_prod)
 order by 1
$c$, null,
$t$A janela não aborta por elas. Decida com a diretoria, tabela por tabela, antes da janela: resto sem uso (ex.: o Cartão de Classe — classe_requisitos, requisito_cumprido) → backup e drop table public.<tabela> cascade; em uso → depois do upgrade a policy TO public/anon precisa virar TO authenticated por clube (pode_gerir_no_clube/membro_ativo_no_clube e clube_atual_id()), o gatilho que grava em pontos/notificacoes/fotos precisa de club_id (a 70 recusa linha sem clube) e uma FK para profiles/unidades sem ON DELETE pode travar a exclusão de membro.$t$),

(30, 'perfis-rejeitados-e-inativos', 'AVISO',
  array['public.profiles.id:uuid', 'public.profiles.status:text', 'storage.objects.name:text'], 'nivel',
$c$
select 'perfil ' || p.id || ' (rejeitado): ' || count(*) || ' objeto(s) no Storage que a liderança não consegue mais apagar depois da 69' as item
  from public.profiles p
  join storage.objects o on coalesce(to_jsonb(o)->>'owner_id', to_jsonb(o)->>'owner') = p.id::text
 where p.status = 'rejeitado'
 group by p.id
 order by 1
$c$,
$c$
select 'informativo: ' || count(*) filter (where status = 'rejeitado') || ' rejeitado(s) viram vínculo encerrado e '
       || count(*) filter (where status = 'inativo') || ' inativo(s) viram suspenso (por projeto; o original fica em metadata.legacy_status)' as item
  from public.profiles where status in ('rejeitado', 'inativo') having count(*) > 0
$c$,
$t$Depois da 69 o cadastro recusado (vínculo encerrado) sai do alcance da liderança: reset de senha, exclusão e imagens. Se o clube não quer manter esses cadastros e arquivos, apague-os ANTES da janela pela tela Usuários do app legado (excluir_usuario); depois, só um operador remove por SQL.$t$),

(31, 'nascimento-implausivel', 'AVISO',
  array['public.profiles.id:uuid', 'public.profiles.nascimento:date', 'public.profiles.papel:text', 'public.profiles.status:text'], 'nivel',
$c$
select 'perfil ' || id || ' (' || papel || ', ' || status || '): '
       || case when nascimento > current_date then 'nascimento no futuro'
               when nascimento < date '1920-01-01' then 'nascimento antes de 1920'
               else 'desbravador com ' || extract(year from age(current_date, nascimento))::int || ' anos' end as item
  from public.profiles
 where nascimento is not null
   and (nascimento > current_date or nascimento < date '1920-01-01'
        or (papel = 'desbravador' and status in ('ativo', 'pendente')
            and extract(year from age(current_date, nascimento)) not between 10 and 16))
 order by 1
$c$, null,
$t$Só pesa quando o recurso 'classes' for ligado (a 39 bloqueia classe abaixo da idade mínima). Revise com a secretaria: update public.profiles set nascimento = '<data real>' where id = '<id>'; se a data for desconhecida, grave NULL.$t$),

(32, 'push-endpoints-fora-do-padrao', 'AVISO', array['public.push_subscriptions.id:uuid', 'public.push_subscriptions.endpoint:text'], 'nivel',
$c$
select 'inscrição ' || id || ': ' || coalesce(substring(endpoint from '^[^/]*//[^/]*'), left(endpoint, 24)) || ' (' || length(endpoint) || ' caracteres)' as item
  from public.push_subscriptions
 where endpoint !~ '^https://' or length(endpoint) > 2048
 order by 1
$c$, null,
$t$O check https da 28 nasce NOT VALID: essas linhas passam a falhar em qualquer UPDATE (push_aparelho_registrar da 55) e o push para elas nunca funcionou. delete from public.push_subscriptions where endpoint !~ '^https://' or length(endpoint) > 2048; — o aparelho se registra de novo.$t$),

(33, 'uploads-que-a-28-e-a-31-recusam', 'AVISO',
  array['storage.objects.bucket_id:text', 'storage.objects.name:text', 'storage.objects.created_at:timestamptz', 'storage.objects.metadata:jsonb'], 'nivel',
$c$
select 'imagens/' || o.name || ': ' || coalesce(o.metadata->>'mimetype', '?') || ', ' || coalesce(o.metadata->>'size', '?')
       || ' bytes — a 28 só aceita image/* até 15 MB' as item
  from storage.objects o
 where o.bucket_id = 'imagens' and o.created_at > now() - interval '60 days'
   and o.metadata ? 'mimetype'
   and (coalesce(o.metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif')
        or (coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,18}$' and (o.metadata->>'size')::numeric > 15728640))
union all
select 'imagens/' || o.name || ': caminho fora do formato que pode_subir_imagem aceita (31)'
  from storage.objects o
 where o.bucket_id = 'imagens' and o.created_at > now() - interval '60 days'
   and not ((o.name ~ '^(perfis|mural|missoes|atividades)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^/]+$'
             and substring(o.name from '^[a-z]+/([0-9a-f-]{36})-') = coalesce(to_jsonb(o)->>'owner_id', to_jsonb(o)->>'owner'))
            or o.name ~ '^unidades/[0-9a-fA-F-]{36}-[^/]+$')
 order by 1
$c$, null,
$t$Descubra que versão do app gera esses uploads e distribua o APK novo antes da janela; garanta o bucket comprovacoes, para vídeo e documento não caírem em imagens.$t$),

(34, 'imagens-que-somem-depois-da-32', 'AVISO',
  array['public.profiles.id:uuid', 'public.profiles.foto:text', 'public.fotos.id:uuid', 'public.fotos.url:text', 'public.fotos.thumb:text',
        'public.unidades.id:uuid', 'public.unidades.emblema:text', 'public.unidades.bandeira:text',
        'storage.objects.bucket_id:text', 'storage.objects.name:text'], 'nivel',
$c$
with refs as (
  select 'profiles.foto' as origem, id::text as ref, foto as url from public.profiles
  union all select 'fotos.url', id::text, url from public.fotos
  union all select 'fotos.thumb', id::text, thumb from public.fotos
  union all select 'unidades.emblema', id::text, emblema from public.unidades
  union all select 'unidades.bandeira', id::text, bandeira from public.unidades
),
r as (
  select origem, ref, url,
         split_part(split_part(substring(url from '/storage/v1/object/(?:public|sign|authenticated)/imagens/(.*)$'), '?', 1), '#', 1) as caminho
    from refs where url ~ '/storage/v1/object/(public|sign|authenticated)/imagens/'
)
select r.origem || ' ' || r.ref || ': aponta para objeto que não existe neste projeto (ou para outro projeto)' as item
  from r where not exists (select 1 from storage.objects o where o.bucket_id = 'imagens' and o.name = r.caminho)
union all
select r.origem || ' ' || r.ref || ': foto do mural com ? # ou % na URL (a policy da 31 compara o sufixo literal)'
  from r where r.origem like 'fotos.%' and r.url ~ '[?#%]'
union all
select r.origem || ' ' || r.ref || ': '
       || case when split_part(o.name, '/', 1) not in ('perfis', 'mural', 'unidades') then 'pasta fora de perfis/mural/unidades — só dono e liderança verão'
               when split_part(o.name, '/', 1) = 'perfis' then 'avatar sem dono no Storage — nenhum colega verá'
               else 'emblema/bandeira sem id de unidade existente no nome' end
  from r join storage.objects o on o.bucket_id = 'imagens' and o.name = r.caminho
 where split_part(o.name, '/', 1) not in ('perfis', 'mural', 'unidades')
    or (split_part(o.name, '/', 1) = 'perfis' and coalesce(to_jsonb(o)->>'owner_id', to_jsonb(o)->>'owner', '') = '')
    or (split_part(o.name, '/', 1) = 'unidades'
        and not exists (select 1 from public.unidades u where u.id::text = substring(o.name from '^unidades/([0-9a-fA-F-]{36})-')))
 order by 1
$c$, null,
$t$Antes de aplicar a 32 (bucket imagens privado), peça o reenvio pelo app (o arquivo ganha dono e nome no formato certo), ou copie o objeto para o caminho padrão e atualize profiles.foto / unidades.emblema / unidades.bandeira. Referência morta: limpe o campo.$t$),

(35, 'comprovacoes-sem-linha-com-o-nome-exato', 'AVISO',
  array['public.entregas.id:uuid', 'public.entregas.foto_url:text', 'public.entregas.status:text',
        'public.missoes_feitas.id:uuid', 'public.missoes_feitas.foto_url:text', 'public.missoes_feitas.status:text',
        'public.devocional.id:uuid', 'public.devocional.foto_url:text', 'public.devocional.status:text',
        'storage.objects.bucket_id:text', 'storage.objects.name:text'], 'nivel',
$c$
with f as (
  select 'entregas' as origem, id, foto_url, status from public.entregas where foto_url is not null
  union all select 'missoes_feitas', id, foto_url, status from public.missoes_feitas where foto_url is not null
  union all select 'devocional', id, foto_url, status from public.devocional where foto_url is not null
)
select 'comprovacoes/' || o.name || ': nenhuma linha cita o nome exato — a liderança deixa de ver' as item
  from storage.objects o
 where o.bucket_id = 'comprovacoes' and not exists (select 1 from f where f.foto_url = o.name)
union all
select f.origem || ' ' || f.id || ': foto_url pendente gravada como URL/prefixo — a liderança deixa de ver ao avaliar'
  from f where f.status = 'pendente' and f.foto_url like '%/comprovacoes/%'
 order by 1
$c$, null,
$t$Objeto órfão: basta registrar o número (é o comportamento pretendido da 69). foto_url pendente em formato URL: update public.entregas set foto_url = regexp_replace(foto_url, '^.*/comprovacoes/([^?]+).*$', '\1') where foto_url like '%/comprovacoes/%'; (idem missoes_feitas e devocional). Avalie antes da janela as evidências órfãs que ainda estão pendentes.$t$),

(36, 'objetos-de-storage-sem-clube', 'AVISO',
  array['storage.objects.bucket_id:text', 'storage.objects.metadata:jsonb', 'public.profiles.id:uuid', 'public.profiles.status:text'], 'nivel',
$c$
select 'bucket ' || o.bucket_id || ': ' || count(*) || ' objeto(s) sem dono ativo, '
       || sum(case when coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,18}$' then (o.metadata->>'size')::numeric else 0 end) || ' bytes fora da conta do clube' as item
  from storage.objects o
  left join public.profiles p on p.id::text = coalesce(to_jsonb(o)->>'owner_id', to_jsonb(o)->>'owner') and p.status = 'ativo'
 where p.id is null
 group by o.bucket_id
 order by 1
$c$, null,
$t$A 54 atribui o clube do objeto pelo vínculo ATIVO do dono; sem dono ativo fica sem clube, fora de club_storage_uso e do limite de armazenamento (uso subcontado). Para o Tenant 001 (sem limite de plano), registre a diferença; se o número for para cobrança, dê a _storage_clube_do_objeto um fallback para clube_legado_id().$t$),

(37, 'chat-apagadas-mudam-de-texto', 'AVISO',
  array['public.chat_mensagens.apagada:boolean', 'public.chat_mensagens.texto:text', 'public.profiles.id:uuid',
        'public.profiles.papel:text', 'public.profiles.status:text', 'public.push_tokens.user_id:uuid'], 'nivel',
$c$
with apk as (
  select count(distinct t.user_id) as lideres
    from public.push_tokens t join public.profiles p on p.id = t.user_id
   where p.papel in ('diretoria', 'instrutor') and p.status = 'ativo'
)
select count(*) || ' mensagem(ns) apagada(s) passam a ter o texto "(mensagem apagada)" e ' || (select lideres from apk)
       || ' líder(es) usam o APK (push_tokens): a moderação do APK antigo lê a tabela e deixa de ver o original' as item
  from public.chat_mensagens m
 where m.apagada and m.texto <> '(mensagem apagada)'
having count(*) > 0 and (select lideres from apk) > 0
$c$,
$c$
select 'informativo: ' || count(*) || ' mensagem(ns) apagada(s) terão o texto movido pela 29 para chat_mensagens_apagadas (só a liderança do clube lê; a tela nova lê a view, nada se perde)' as item
  from public.chat_mensagens where apagada and texto <> '(mensagem apagada)' having count(*) > 0
$c$,
$t$Não há correção de dado. Distribua o APK novo junto com a janela (o front web novo já lê chat_mensagens_visiveis). Até lá, o original fica legível no SQL Editor em chat_mensagens_apagadas.$t$),

(38, 'notificacoes-para-aceita-nulo', 'AVISO', array['public.notificacoes.para'], 'nivel',
$c$
select 'notificacoes.para aceita NULL (baseline: NOT NULL default ''todos'') — um INSERT com para nulo aborta depois da 55' as item
  from pg_attribute a
 where a.attrelid = to_regclass('public.notificacoes') and a.attname = 'para' and not a.attisdropped and not a.attnotnull
union all
select 'notificacoes.para sem default ''todos'''
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where a.attrelid = to_regclass('public.notificacoes') and a.attname = 'para' and not a.attisdropped
   and coalesce(pg_get_expr(d.adbin, d.adrelid), '') not like '%todos%'
$c$, null,
$t$update public.notificacoes set para = 'todos' where para is null; alter table public.notificacoes alter column para set default 'todos', alter column para set not null;$t$),

(39, 'respostas-401-5xx-do-pg_net', 'AVISO', array['net._http_response.status_code:integer', 'net._http_response.created:timestamptz'], 'ok',
$c$
select 'HTTP ' || status_code || ': ' || count(*) || ' resposta(s) nas últimas 24h' as item
  from net._http_response
 where created > now() - interval '24 hours' and (status_code = 401 or status_code >= 500)
 group by status_code
 order by 1
$c$, null,
$t$A categoria edge_falha_repetida da 57 conta TODA resposta 401/5xx em net._http_response, não só as da enviar-push: o canal de alerta nasceria disparando. Investigue os 401/5xx atuais antes da janela; na janela, remova o hook do painel na ordem de webhook-de-push-do-painel.$t$),

(40, 'fim-de-linha-crlf-no-metodo-de-aplicacao', 'AVISO', '{}'::text[], 'nivel',
$c$
select p.proname || ' tem CR (\r) no corpo' as item
  from pg_proc p
 where p.pronamespace = to_regnamespace('public')
   and p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))
   and strpos(p.prosrc, chr(13)) > 0
 order by 1
$c$, null,
$t$O método usado até hoje preserva CR. A 56, 69 e 70 reescrevem corpos por replace() de texto (69/70 com quebra de linha): aplique as 79 migrations a partir de um checkout LF (git add --renormalize . ou clone novo; confira com git ls-files --eol supabase/migrations) e sempre pelo mesmo método. Depois da 70: select proname from pg_proc where proname in ('definir_club_ponto','definir_club_foto','definir_club_notificacao') and prosrc not like '%_recusar_linha%'; tem de vir vazio.$t$),

(41, 'sem-diretoria-ativa', 'AVISO', array['public.profiles.papel:text', 'public.profiles.status:text'], 'nivel',
$c$
select 'nenhum perfil com papel diretoria e status ativo' as item
 where not exists (select 1 from public.profiles where papel = 'diretoria' and status = 'ativo')
$c$, null,
$t$Depois do upgrade só um vínculo de diretoria ATIVO gere o clube (aprova, promove, gera o código de entrada). Antes da janela, confirme que pelo menos um diretor ativo tem o papel exatamente 'diretoria'.$t$)
),

-- ======================== motor: listas → travas → guarda → execução → resumo ========================
-- {{tabelas_legadas}} (as 40 tabelas do inventário de colunas-legadas-...) e {{funcoes_legadas}} (as 120
-- funções de funcoes-legadas-...) viram estes arrays no texto das consultas, antes de rodar.
listas(tabelas_legadas, funcoes_legadas) as (values (
$l$array[
    'ajudas', 'atividades', 'biblia_leitura_atual', 'biblia_leituras', 'biblia_livros', 'biblia_versiculos', 'bichinhos',
    'chat_conversas', 'chat_mensagens', 'chat_participantes', 'chefao_golpes', 'config_clube', 'desafios', 'desafios_unidade',
    'devocional', 'duelos', 'entregas', 'eventos', 'fotos', 'jogos_liberados', 'jogos_trilha',
    'leilao_itens', 'leilao_lance_unidades', 'leilao_lances', 'leiloes', 'mensalidades', 'migracoes_aplicadas', 'missoes_feitas',
    'notificacoes', 'partidas', 'pontos', 'profiles', 'push_subscriptions', 'push_tokens', 'recordes',
    'responsaveis', 'temporadas', 'trilha_jogos', 'unidades', 'versiculos'
  ]::text[]$l$,
$l$array[
    '_biblia_segundos_min', '_bichinho_estagio', '_bichinho_nivel_cenario', '_bichinho_nivel_cor', '_bichinho_nivel_item', '_bichinho_nivel_movel',
    '_bichinho_nivel_olhos', '_chat_tem_palavrao', '_leilao_fechar_core', '_max_pontos_arcade', '_min_segundos_jogo', 'ajuda_status',
    'ajudas_recebidas', 'aprovar_entrega', 'aprovar_vinculo', 'atividade_jogos', 'avaliar_missao', 'biblia_confirmar_leitura',
    'biblia_iniciar_leitura', 'bichinho_acordar', 'bichinho_adotar', 'bichinho_cuidar', 'bichinho_dormir', 'bichinho_equipar',
    'bichinho_vestir', 'bonus_todos_jogos', 'cancelar_ajuda', 'cancelar_duelo', 'cancelar_leilao', 'chat_apagar_mensagem',
    'chat_enviar_direta', 'chat_enviar_geral', 'chat_enviar_unidade', 'chat_pode_ver', 'chat_todas_conversas', 'chefao_config',
    'chefao_estado', 'chefao_golpe', 'chefao_premiar', 'classe_por_nascimento', 'confirmar_lance_conjunto', 'criar_duelo',
    'criar_leilao', 'dar_lance', 'devocional_feito_hoje', 'eh_financeiro', 'eh_membro_ativo', 'eh_teste',
    'encerrar_leilao', 'excluir_usuario', 'fechar_leiloes_vencidos', 'handle_new_user', 'iniciar_jogo', 'jogos_do_dia',
    'julgar_duelo', 'lancar_colocacao_acampamento', 'leilao_saldo_unidade', 'lembrar_ausentes', 'lembrar_jogos_do_dia', 'liberar_jogo',
    'limita_pontos_conselheiro', 'listar_usuarios', 'meu_bichinho', 'meu_progresso_trilha', 'meu_resumo_devocional', 'meu_resumo_missoes',
    'meu_total_pontos', 'meus_filhos', 'minha_leitura_biblia', 'minha_unidade', 'missao_do_dia', 'missoes_pendentes',
    'nivel_por_pontos', 'norm_txt', 'notif_aniversariantes_hoje', 'notif_cadastro_aprovado', 'notif_duelo', 'notif_entrega_avaliada',
    'notif_eventos_amanha', 'notif_leilao', 'notif_missao_avaliada', 'notif_nova_atividade', 'notif_novo_cadastro', 'notif_pontos_unidade',
    'nova_temporada', 'pedir_ajuda', 'pedir_vinculo', 'pets_do_clube', 'pode_apontar', 'pode_aprovar',
    'pode_gerir', 'pontos_temporada_unidade', 'premiar_campeao_semana', 'premiar_melhores_do_dia', 'premiar_rodada_semana', 'progresso_duelo',
    'progresso_lado', 'protege_campos_perfil', 'ranking_semana', 'ranking_totais', 'ranking_trilha', 'recordes_semana',
    'recusar_ajuda', 'recusar_lance_conjunto', 'reflexo_so_desbravador', 'registrar_devocional', 'registrar_jogo', 'registrar_missao',
    'registrar_recorde', 'rejeitar_vinculo', 'resetar_senha_membro', 'resolver_ajuda', 'rodizio_ligado', 'salvar_avatar',
    'salvar_reuniao', 'status_jogos_do_dia', 'temporada_inicio', 'trancar_jogo', 'versiculo_do_dia', 'vinculos_pendentes'
  ]::text[]$l$
)),
-- AccessExclusiveLock (concedido ou na fila) de OUTRA sessão: toda leitura da tabela — e do índice dela —
-- espera atrás dele. A guarda não deixa a verificação ler o que está travado (senão o pré-voo inteiro
-- ficaria preso, e a linha sessoes-longas-e-locks, que diz quem é, nunca apareceria).
travas as (
  select coalesce(ix.indrelid, l.relation) as base, lc.relnamespace as nsp,
         ln.nspname || '.' || lc.relname as nome, l.pid, l.granted
    from pg_locks l
    join pg_class lc on lc.oid = l.relation
    join pg_namespace ln on ln.oid = lc.relnamespace
    left join pg_index ix on ix.indexrelid = l.relation
   where l.locktype = 'relation' and l.mode = 'AccessExclusiveLock'
     and l.database = (select d.oid from pg_database d where d.datname = current_database())
     and l.pid is distinct from pg_backend_pid()
),
-- cada objeto de "precisa", procurado no CATÁLOGO (to_regclass num schema sem USAGE dá erro, não NULL)
item_precisa as (
  select c.id, u.p, x.esquema, x.tabela, x.coluna, x.tipos, n.oid as nsp, r.oid as rel
    from checagem c
    cross join lateral unnest(c.precisa) u(p)
    cross join lateral (select split_part(u.p, '.', 1) as esquema, split_part(split_part(u.p, '.', 2), ':', 1) as tabela,
                               split_part(split_part(u.p, '.', 3), ':', 1) as coluna, split_part(u.p, ':', 2) as tipos) x
    left join pg_namespace n on n.nspname = x.esquema
    left join pg_class r on r.relnamespace = n.oid and r.relname = x.tabela and x.tabela <> '*'
),
guarda as (
  select c.*,
         array(select distinct case when i.rel is null then i.esquema || '.' || i.tabela else i.p end
                 from item_precisa i
                where i.id = c.id and i.tabela <> '*'
                  and (i.rel is null
                       or (i.coluna <> '' and not exists (
                             select 1 from pg_attribute a
                              where a.attrelid = i.rel and a.attname = i.coluna and a.attnum > 0 and not a.attisdropped
                                and (i.tipos = ''
                                     or replace(format_type(a.atttypid, null), 'timestamp with time zone', 'timestamptz')
                                        = any (string_to_array(i.tipos, '|'))))))) as ausentes,
         array(select distinct case when not coalesce(has_schema_privilege(i.nsp, 'USAGE'), false) then 'o schema ' || i.esquema
                                    else i.esquema || '.' || i.tabela end
                 from item_precisa i
                where i.id = c.id and i.rel is not null
                  and not coalesce(has_schema_privilege(i.nsp, 'USAGE') and has_table_privilege(i.rel, 'SELECT'), false)) as sem_leitura,
         array(select distinct t.nome || case when t.granted then ' (travada pelo pid ' else ' (ALTER/DROP na fila, pid ' end
                               || coalesce(t.pid::text, '? de transação preparada') || ')'
                 from item_precisa i
                 join travas t on (i.tabela = '*' and t.nsp = i.nsp) or (i.tabela <> '*' and t.base = i.rel)
                where i.id = c.id) as travadas,
         replace(replace(c.consulta, '{{tabelas_legadas}}', l.tabelas_legadas), '{{funcoes_legadas}}', l.funcoes_legadas) as sql_consulta,
         replace(replace(c.info, '{{tabelas_legadas}}', l.tabelas_legadas), '{{funcoes_legadas}}', l.funcoes_legadas) as sql_info
    from checagem c cross join listas l
),
-- lock_timeout local (5 s) antes da primeira leitura, se ninguém o definiu: um lock que apareça depois da
-- guarda vira erro em 5 s, nunca espera sem fim. [[:cntrl:]] e U+FFFE/U+FFFF saem do texto: são
-- inválidos em XML e derrubariam o xmltable.
execucao as (
  select g.*,
         case when cardinality(g.ausentes) = 0 and cardinality(g.sem_leitura) = 0 and cardinality(g.travadas) = 0
                   and (current_setting('lock_timeout') <> '0' or set_config('lock_timeout', '5s', true) is not null) then
           query_to_xml(format($w$select count(*) as n, string_agg(item, ' | ' order by rn) filter (where rn <= 5) as amostra
                                   from (select regexp_replace(left(coalesce(q.item::text, '?'), 180), '[[:cntrl:]' || chr(65534) || chr(65535) || ']+', ' ', 'g') as item,
                                                row_number() over () as rn
                                           from (%s) q) z$w$, g.sql_consulta), false, false, '') end as doc,
         case when g.info is not null and cardinality(g.ausentes) = 0 and cardinality(g.sem_leitura) = 0 and cardinality(g.travadas) = 0
                   and (current_setting('lock_timeout') <> '0' or set_config('lock_timeout', '5s', true) is not null) then
           query_to_xml(format($w$select string_agg(regexp_replace(left(coalesce(q.item::text, ''), 300), '[[:cntrl:]' || chr(65534) || chr(65535) || ']+', ' ', 'g'), ' | ') as amostra
                                   from (%s) q$w$, g.sql_info), false, false, '') end as doc_info
    from guarda g
),
resultado as (
  select e.ordem, e.id, e.nivel, e.se_faltar, e.correcao, e.ausentes, e.sem_leitura, e.travadas, r.n, r.amostra, ri.amostra as info,
         -- se_faltar = 'ok' vale só para TABELA ausente (extensão não instalada); coluna ausente ou de outro
         -- tipo numa tabela que existe é divergência, e a verificação fica no nível dela
         not exists (select 1 from unnest(e.ausentes) x where x ~ '^[^.]+[.][^.]+[.]') as so_tabela_ausente
    from execucao e
    left join lateral xmltable('/table/row' passing e.doc columns n bigint path 'n', amostra text path 'amostra') r on true
    left join lateral xmltable('/table/row' passing e.doc_info columns amostra text path 'amostra') ri on true
),
linha as (
  select ordem, id as verificacao,
         case when cardinality(travadas) > 0 or cardinality(sem_leitura) > 0 then nivel
              when cardinality(ausentes) > 0 then case when se_faltar = 'ok' and so_tabela_ausente then 'ok' else nivel end
              when coalesce(n, 0) > 0 then nivel
              else 'ok' end as status,
         case when cardinality(travadas) > 0
                then 'não deu para conferir agora: ' || array_to_string(travadas, ', ')
                     || ' — a leitura ficaria presa atrás do lock (ver sessoes-longas-e-locks); rode de novo quando liberar'
              when cardinality(sem_leitura) > 0
                then 'não deu para conferir: ' || current_user || ' não lê ' || array_to_string(sem_leitura, ', ')
              when cardinality(ausentes) > 0 and se_faltar = 'ok' and so_tabela_ausente
                then 'nada a conferir: não existe ' || array_to_string(ausentes, ', ') || ' (colunas-legadas-... ou extensoes-obrigatorias diz se falta)'
              when cardinality(ausentes) > 0
                then 'não deu para conferir: falta (ou tem outro tipo) ' || array_to_string(ausentes, ', ')
                     || ' — ver colunas-legadas-ausentes-ou-divergentes / extensoes-obrigatorias'
              when coalesce(n, 0) > 0
                then n || ' achado(s): ' || coalesce(amostra, '?') || case when n > 5 then ' | (+' || (n - 5) || ')' else '' end
                     || coalesce(' || ' || info, '')
              else coalesce(info, 'nada encontrado') end as detalhe,
         correcao
    from resultado
)
select verificacao, status, detalhe, correcao
  from (select -1 as ordem, 'RESUMO'::text as verificacao,
               case when count(*) filter (where status = 'PROBLEMA') = 0 then 'ok' else 'PROBLEMA' end as status,
               count(*) filter (where status = 'PROBLEMA') || ' problema(s), ' || count(*) filter (where status = 'AVISO') || ' aviso(s), '
                 || count(*) filter (where status = 'ok') || ' ok — pré-voo das migrations 20260921000001..20260930000080' as detalhe,
               case when count(*) filter (where status = 'PROBLEMA') = 0
                    then 'Pode seguir: leia cada AVISO antes de abrir a janela e rode o BLOCO À PARTE na hora da 40 e da 43.'
                    else 'NÃO abra a janela: corrija cada PROBLEMA (coluna correcao) e rode o pré-voo de novo.' end as correcao
          from linha
        union all
        select ordem, verificacao, status, detalhe, case when status = 'ok' then '' else correcao end
          from linha) t
 order by case when verificacao = 'RESUMO' then 0 when status = 'PROBLEMA' then 1 when status = 'AVISO' then 2 else 3 end, ordem;

/* =====================================================================================================
   BLOCO À PARTE — pacote-curricular-colado-integro (NÃO faz parte da consulta acima; rode sozinho)

   Na janela, imediatamente antes da 20260921000040 e de novo antes da 20260921000043: copie o bloco
   abaixo (de "select" até o ";") para uma aba NOVA do SQL Editor, com o Intellisense desligado, e
   cole entre as duas tags $cq_manifesto$ o texto EXATO que está entre $cq_manifesto$ e $cq_manifesto$ na
   linha 9 do arquivo da migration (a MESMA colagem que você vai aplicar). Tem de voltar ZERO linhas.
   Se voltar uma linha, a colagem está corrompida: NÃO aplique a migration.

select 'pacote colado difere do gerado (sha256): NÃO aplique a migration' as problema
 where encode(sha256(convert_to($cq_manifesto$COLE AQUI O JSON DA LINHA 9$cq_manifesto$, 'UTF8')), 'hex')
       not in ('b2430a5117859466e581999d0633636eb4efee1e268384bd70be119be0646e53',   -- 40: classes regulares 2026.1
               '549f6ef20737c43d1c0d354d8c0334330889bf1caae9e5fa7ed65d845223e56a');  -- 43: classes regulares 2026.2

   Depois da 40, o jsonb que ela devolve tem de ter classes=6, secoes=54, requisitos=149,
   grupos_n_de_m=25, opcoes=74 e requisitos_dinamicos=6; depois da 43, opcoes=73 e arquivadas=[2026.1].
   ===================================================================================================== */
