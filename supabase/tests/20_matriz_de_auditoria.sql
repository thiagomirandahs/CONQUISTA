-- MATRIZ DE AUDITORIA multi-tenant, EXECUTÁVEL (a versão legível está em supabase/AUDITORIA-MULTITENANT.md).
-- Garante, por ESTRUTURA, que nenhum módulo voltou a depender do "reino legado" e que uma tabela/rotina nova
-- não entra no banco sem decidir a que clube pertence. Se este teste falhar depois de uma migration nova, a
-- migration esqueceu de tenantizar (ou de declarar a exceção aqui, com o motivo).
begin;
\ir _lib.sql
\ir _fixtures.sql

-- ---------- 1) toda tabela pertence a um clube OU está na lista de exceções (com o motivo) ----------
create table t.excecoes (tabela text primary key, motivo text not null);
insert into t.excecoes values
  ('organizational_units',     'raiz: o próprio clube/unidade organizacional'),
  ('organization_memberships', 'vínculo pessoa x clube (organizational_unit_id é o clube)'),
  ('profiles',                 'identidade global da pessoa (não é por clube); os clubes dela vêm de organization_memberships, que pode ter N vínculos'),
  ('push_subscriptions',       'dispositivo da PESSOA; a Edge Function só envia via push_destinatarios(club_id)'),
  ('push_tokens',              'dispositivo da PESSOA (APK); idem'),
  ('migracoes_aplicadas',      'ledger da plataforma (não tem dado de clube)'),
  ('cron_falhas',              'registro INTERNO das falhas de cron (club_id só informativo, opcional; sem acesso de usuário)'),
  ('biblia_livros',           'conteúdo da Bíblia (plataforma)'),
  ('biblia_versiculos',        'conteúdo da Bíblia (plataforma)'),
  ('recursos_catalogo',        'catálogo de recursos da PLATAFORMA (o que o app oferece + o padrão); a escolha de cada clube fica em club_features (club_id)'),
  ('curriculum_versions',      'currículo oficial/versionado é conteúdo da PLATAFORMA (compartilhado/global); progresso, evidência, avaliação e investidura SÃO por clube (member_classes/member_requirements/requirement_approvals/investiture_reviews, todas com club_id)'),
  ('classes',                  'catálogo de classes da PLATAFORMA (parte do currículo versionado, ver curriculum_versions)'),
  ('class_sections',           'catálogo de seções da PLATAFORMA (parte do currículo versionado)'),
  ('class_requirements',       'catálogo de requisitos da PLATAFORMA (parte do currículo versionado)'),
  ('specialties',              'catálogo de especialidades da PLATAFORMA (parte do currículo versionado, ver curriculum_versions)'),
  ('specialty_requirements',   'catálogo de requisitos de especialidade da PLATAFORMA'),
  ('curriculum_dependencies',  'dependência declarativa entre itens do CATÁLOGO (classe/especialidade concluída); a satisfação é checada por pessoa via curriculum_achievements (histórico portátil, fase 2.6), nunca a declaração em si'),
  ('dynamic_content_definitions', 'catálogo de conteúdo anual/dinâmico da PLATAFORMA (o "slot": ex. curso de leitura do ano) — fase 2.6; o valor vigente é resolvido por período (data), nunca por clube'),
  ('dynamic_content_values',    'valores versionados por período de vigência do catálogo acima — conteúdo da PLATAFORMA, mesma resposta pra todo clube na mesma data'),
  ('requirement_option_groups', 'regra "N de M" declarada sobre um requisito do CATÁLOGO curricular (plataforma) — a mesma regra vale em qualquer clube; a satisfação é calculada por pessoa'),
  ('requirement_options',       'opções de um grupo N-de-M do catálogo (plataforma)'),
  ('curriculum_achievements',   'HISTÓRICO CURRICULAR PORTÁTIL da PESSOA (fase 2.6): pertence à identidade global (usuario_id), não a um clube. club_id_origem é PROVENIÊNCIA imutável de quem emitiu (só ele revoga), não escopo de acesso. Só o fato curricular — nunca pontos/presença/mensalidade/mensagem/arquivo (teste 35)'),
  ('class_completion_snapshots', 'SNAPSHOT IMUTÁVEL da conclusão de classe (fase 4): pertence à pessoa (usuario_id) e segue a visibilidade da conquista portátil; club_id_origem é proveniência de quem selou (só ele revoga). Gatilho recusa UPDATE de conteúdo e DELETE (teste 39)'),
  ('class_completion_events',    'trilha de auditoria IMUTÁVEL das transições de conclusão (fase 4); operacional do clube (club_id), leitura por dono/liderança'),
  ('class_investitures',         'evento de investidura (fase 4): pertence à pessoa, segue a visibilidade da conquista; club_id é o clube que registrou (proveniência), não escopo'),
  ('document_templates',         'catálogo de templates de documento da PLATAFORMA (fase 4.1): versionado; o documento emitido fixa o template. Sem club_id'),
  ('class_documents',            'DOCUMENTO emitido (Caderno DesbravaClube, fase 4.1): aponta pro snapshot selado; token público aleatório; segue a visibilidade da conquista (usuario_id + club_id_origem). A verificação pública é por RPC (resumo mínimo), nunca leitura da tabela (teste 40)'),
  ('investiture_workflows',      'catálogo de WORKFLOWS de investidura da PLATAFORMA (fase 4.2): versionado (chave+versão), declarativo. Sem club_id — a mesma definição vale pra qualquer clube'),
  ('investiture_workflow_stages','etapas declarativas de um workflow do catálogo acima (fase 4.2): escopo/papéis/ordem são dado da PLATAFORMA, não de um clube'),
  ('investiture_workflow_runs',  'execução do workflow para UM snapshot (fase 4.2): pertence à pessoa (usuario_id) e segue a visibilidade da conquista portátil; club_id_origem é o clube da conclusão (proveniência), não escopo — hierarquia pode envolver mais de um clube/unidade'),
  ('workflow_stage_decisions',   'decisão IMUTÁVEL de uma etapa (fase 4.2): segue a visibilidade da conquista; escopo_organizational_unit_id é a unidade RESOLVIDA pela hierarquia (clube, distrito, região...) — pode não ser o clube da pessoa. Gatilho recusa UPDATE/DELETE (teste 41)'),
  ('document_signatures',        'INTERFACE DE DADOS preparada pra futura assinatura eletrônica (fase 4.3): nasce e fica VAZIA — nenhuma RPC escreve nela; hoje só existe aprovacao_sistema (que não é assinatura digital). Segue a visibilidade da conquista (usuario_id + club_id_origem); club_id_origem é proveniência do emissor, não escopo (teste 42)'),
  -- ----- fase 5: camada COMERCIAL. Deliberadamente NÃO é por clube: quem contrata é a conta/cliente,
  -- que pode cobrir N clubes. O elo com o clube mora em subscription_clubs (que tem club_id). Misturar
  -- assinatura com clube é justamente o erro que o teste 43 impede (assinatura não é vínculo).
  ('billing_accounts',           'CONTA/CLIENTE comercial (fase 5): é o contratante, não um clube — uma conta pode cobrir vários clubes (subscription_clubs, que tem club_id). Visível só pro contato da conta e pra operação da plataforma'),
  ('billing_account_contacts',   'pessoa x conta COMERCIAL (fase 5): papel comercial (titular/financeiro/leitura), nunca papel eclesiástico — não é organization_memberships e não dá acesso a dado de clube'),
  ('billing_plans',              'CATÁLOGO versionado de planos da PLATAFORMA (fase 5): a mesma definição vale pra qualquer cliente; preço e composição não moram no React'),
  ('billing_prices',             'preços versionados do catálogo acima (fase 5): da plataforma, não de um clube'),
  ('billing_policies',           'política comercial (carência/suspensão) da PLATAFORMA, versionada (fase 5); nunca_apagar_dados tem CHECK — não há política que apague dado de clube'),
  ('subscriptions',              'ASSINATURA da conta comercial (fase 5): pertence à conta, não a um clube; os clubes cobertos ficam em subscription_clubs'),
  ('subscription_events',        'histórico das transições comerciais de uma assinatura (fase 5): auditoria da conta, não do clube'),
  ('billing_invoices',           'COBRANÇA de uma assinatura (fase 5): da conta comercial; nenhum dado operacional de clube passa por aqui'),
  ('billing_providers',          'interface de PROVEDOR de pagamento (fase 5): catálogo da plataforma; hoje só o mock local'),
  ('billing_events',             'eventos de WEBHOOK recebidos (fase 5): idempotentes por unique (provider, evento_externo_id); operação interna — nem o contato da conta lê'),
  ('platform_admins',            'ADMINISTRAÇÃO DA PLATAFORMA (fase 5): papel de operação do produto, deliberadamente FORA de organization_memberships — não é autoridade eclesiástica e não ganha policy nenhuma sobre dado de clube (teste 43)'),
  ('platform_admin_audit',       'auditoria IMUTÁVEL das ações administrativas da plataforma (fase 5): alvo pode ser conta, assinatura ou clube — por isso alvo_tipo/alvo_id genéricos, não club_id'),
  ('onboarding_sessions',        'estado RETOMÁVEL do cadastro de um clube novo (fase 5): pertence à PESSOA que está cadastrando; o club_id só existe depois da etapa que cria o clube (por isso nullable)'),
  -- ----- fase 6: motor de experiências. TUDO que é do clube tem club_id (experiences, stages,
  -- audiences, participations, submissions, rewards, seasons, events, reports, badges). Só o CATÁLOGO
  -- de modelos da plataforma fica de fora, pela mesma razão do currículo oficial.
  ('experience_templates',       'catálogo de MODELOS de experiência da PLATAFORMA (fase 6): versionado (chave+versão) e igual pra todo clube. O clube COPIA pra uma instância dele (experiences.club_id) — mudar o modelo depois não altera a cópia publicada (teste 44)');
select t.eq('TODA tabela do public tem club_id obrigatório OU está declarada como exceção (tabelas que precisam decidir):',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'club_id' and a.attnotnull and not a.attisdropped)
      and c.relname not in (select tabela from t.excecoes)), 0);
select t.eq('...e as exceções declaradas existem de fato (a lista não apodrece)',
  (select count(*) from t.excecoes e where not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = e.tabela)), 0);
select t.eq('toda tabela com club_id aponta para organizational_units (FK)',
  (select count(*) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.organizational_units'::regclass and a.attnum = any(k.conkey))), 0);
select t.eq('toda tabela com club_id tem RLS ligado', (select count(*) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'club_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity), 0);

-- ---------- 2) ninguém depende mais do reino legado ----------
select t.eq('nenhum gatilho "exigir ... legado" em tabela pública', (select count(*) from pg_trigger where not tgisinternal and tgname ~ 'exigir.*legado'), 0);
select t.eq('os helpers legados (pode_gerir / pode_aprovar / eh_membro_ativo / eh_financeiro) NÃO existem mais',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('pode_gerir', 'pode_aprovar', 'eh_membro_ativo', 'eh_financeiro')), 0);
select t.eq('policies de tabela do public só citam o clube legado na 1 exceção declarada (unidades visíveis no cadastro público)',
  (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace
      and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'clube_legado_id\(\)'
      and c.relname || '.' || p.polname not in ('unidades.anon le unidades tenant legado')), 0);
select t.eq('funções de negócio só citam clube_legado_id() nas exceções declaradas (cadastro público, sincronização de vínculo, catálogo-modelo, defaults do banco)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'clube_legado_id\(\)'
      and p.proname not in ('handle_new_user', 'reconciliar_vinculos_perfis', 'sincronizar_vinculo_perfil', 'provisionar_clube', '_prov_jogos',
                            'catalogo_jogo_definir', '_prov_conteudo', 'definir_club_foto', 'definir_club_notificacao', 'definir_club_ponto', 'clube_legado_id')), 0);
select t.eq('nenhuma DEFAULT de coluna aponta para o clube legado (defaults valem o clube de quem chama)',
  (select count(*) from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.relnamespace = 'public'::regnamespace
      and pg_get_expr(d.adbin, d.adrelid) ~ 'clube_legado_id\(\)'), 0);

-- ---------- 3) avisos (notificacoes) sempre ganham clube ----------
select t.eq('toda função que insere em notificacoes informa o clube (club_id) ou é aviso pessoal (para_usuario)',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~* 'insert into public\.notificacoes'
      and p.prosrc !~* 'club_id' and p.prosrc !~* 'para_usuario'), 0);

-- ---------- 4) rotinas de cron: uma rodada por clube, nada chamável por usuário ----------
select t.eq('as rotinas de cron NÃO são executáveis por usuário logado nem anon',
  (select count(*) from cron.job j join pg_proc p on p.proname = regexp_replace(j.command, '^\s*select\s+public\.(\w+)\(\).*$', '\1', 'i') and p.pronamespace = 'public'::regnamespace
    where has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')), 0);
select t.eq('as rotinas por-clube do cron (_x_clube) NÃO são executáveis por usuário',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^_(premiar|lembrar|chefao).*_clube$'
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0);
select t.eq('os 6 laços de cron dos jogos passam por TODOS os clubes',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('premiar_melhores_do_dia', 'premiar_campeao_semana', 'premiar_rodada_semana', 'lembrar_ausentes', 'lembrar_jogos_do_dia', 'chefao_premiar')
      and p.prosrc ~ 'organizational_units' and p.prosrc ~ 'type = ''clube'''), 6);

-- ---------- 5) storage ----------
select t.eq('bucket "comprovacoes" (fotos de missão/atividade de MENORES) é PRIVADO', (select count(*) from storage.buckets where id = 'comprovacoes' and not public), 1);
select t.eq('bucket "imagens" (avatar/mural/emblema de menores) é PRIVADO: a leitura é por URL assinada, só de quem passa na policy do clube (teste 25)',
  (select count(*) from storage.buckets where id = 'imagens' and not public), 1);
select t.eq('bucket "publico" é o ÚNICO bucket público (asset realmente público; só a liderança do clube grava)',
  (select count(*) from storage.buckets where public and id <> 'publico'), 0);
select t.como('lider_a');
select t.eq('líder A vê o comprovante do membro do clube A', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like %L$q$, t.id('membro_a') || '/%')), 1);
select t.como('lider_b');
select t.eq('líder B NÃO vê o comprovante do membro do clube A', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like %L$q$, t.id('membro_a') || '/%')), 0);
select t.como('membro_b');
select t.eq('membro B NÃO vê o comprovante do membro do clube A', t.nv(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like %L$q$, t.id('membro_a') || '/%')), 0);
select t.eq('membro B vê o PRÓPRIO comprovante', t.n(format($q$select count(*) from storage.objects where bucket_id = 'comprovacoes' and name like %L$q$, t.id('membro_b') || '/%')), 1);
select t.como_anon();
select t.eq('anon não lista comprovantes', t.nv($q$select count(*) from storage.objects where bucket_id = 'comprovacoes'$q$), 0);
select t.eq('anon não lista o bucket de imagens (privado)', t.nv($q$select count(*) from storage.objects where bucket_id = 'imagens'$q$), 0);
reset role;
insert into storage.objects (bucket_id, name, owner) values ('imagens', 'mural/foto-do-a.jpg', t.id('membro_a'));
select t.como('lider_b');
-- (o Storage bloqueia DELETE/UPDATE direto por SQL; a barreira de verdade é o predicado das policies apagar/atualizar/ler imagens)
select t.eq('líder B NÃO enxerga (nem pode apagar/trocar) a imagem do membro do clube A', t.nv($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = 'mural/foto-do-a.jpg'$q$), 0);
select t.eq('o predicado das policies de apagar/atualizar: líder B NÃO gere o dono do clube A', t.txt(format($q$select public.lideranca_gere_usuario(%L)::text$q$, t.id('membro_a'))), 'false');
select t.como('lider_a');
select t.eq('líder A enxerga a imagem do membro do PRÓPRIO clube', t.n($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = 'mural/foto-do-a.jpg'$q$), 1);
select t.eq('o predicado das policies: líder A gere o dono do próprio clube', t.txt(format($q$select public.lideranca_gere_usuario(%L)::text$q$, t.id('membro_a'))), 'true');
select t.como('membro_b');
select t.eq('membro B NÃO enxerga a imagem do clube A pela listagem', t.nv($q$select count(*) from storage.objects where bucket_id = 'imagens' and name = 'mural/foto-do-a.jpg'$q$), 0);
reset role;

select t.fim();
rollback;
