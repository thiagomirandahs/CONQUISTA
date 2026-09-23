-- =============================================================================
--  FASE 5 — Fundação comercial SaaS (migration 48).
--
--  Prova, sem integrar nenhum gateway, que:
--    * assinatura NÃO é vínculo (inadimplência/cancelamento não apagam nem desligam ninguém);
--    * as TRÊS camadas (plano → clube → usuário) existem e são distintas, e a operação só acontece
--      quando as três permitem — reaproveitando os gatilhos de entitlement que já existiam;
--    * o onboarding é retomável e idempotente (repetir etapa não cria 2 clubes nem 2 assinaturas);
--    * admin da plataforma enxerga operação SaaS e NADA de dado de clube;
--    * suporte assistido exige autorização explícita, prazo, motivo e auditoria — e ainda não abre nada;
--    * webhook é idempotente desde o primeiro dia;
--    * o Tenant 001 continua idêntico, inclusive depois de receber o plano legado/fundador.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

-- Fase 8.2: `recurso_disponivel_no_plano` deixou de ser chamavel por `authenticated` — era por
-- ela que o vetor comercial de QUALQUER clube vazava (o red-team leu plano, overrides e
-- suspensao de um clube pagante com uma conta sem vinculo nenhum).
--
-- As sondas abaixo perguntam o que o PLANO contem, nao quem pode perguntar — logo rodam como
-- postgres. `t.pg()` faz isso sem mexer no papel da sessao: quem estava logado continua logado
-- no proximo assert.
create function t.pg(p_sql text) returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin execute p_sql into v; return v; exception when others then return 'ERRO: ' || sqlerrm; end $$;
\set ON_ERROR_STOP on
\o /dev/null

-- ---------- gente que chega pra ABRIR clube (cadastro real, tipo 'fundador') ----------
select t.signup('fundador_x', '{"tipo":"fundador","nome":"Fundador X"}'::jsonb);
select t.signup('fundador_y', '{"tipo":"fundador","nome":"Fundador Y"}'::jsonb);
select t.signup('admin_saas', '{"tipo":"fundador","nome":"Admin da Plataforma"}'::jsonb);
select t.signup('equipe_1',   '{"tipo":"fundador","nome":"Equipe Um"}'::jsonb);
select t.signup('equipe_2',   '{"tipo":"fundador","nome":"Equipe Dois"}'::jsonb);
-- controle: cadastro NORMAL (o de sempre) — tem que continuar caindo no clube legado
select t.signup('cadastro_normal', '{"nome":"Cadastro Normal"}'::jsonb);

-- bootstrap do administrador da plataforma: só o service_role/banco escreve aqui (não há RPC
-- que promova ninguém — quem é admin não se auto-promove).
insert into public.platform_admins (user_id, papel, motivo) values (t.id('admin_saas'), 'operacao', 'bootstrap de teste');
\o

-- =============================================================================
-- 1) CADASTRO DE FUNDADOR NÃO ENTRA NO TENANT 001
-- =============================================================================
select t.eq('fundador nasce SEM nenhum vínculo (o clube dele ainda não existe)',
  t.n(format($q$select count(*) from public.organization_memberships where user_id = %L$q$, t.id('fundador_x'))), 0);
select t.eq('...mas a identidade existe (profiles)',
  t.n(format($q$select count(*) from public.profiles where id = %L$q$, t.id('fundador_x'))), 1);
select t.eq('o Tenant 001 NÃO ganhou membro nenhum por causa do fundador',
  t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L and user_id in (%L, %L, %L)$q$,
      t.id('clube_a'), t.id('fundador_x'), t.id('fundador_y'), t.id('admin_saas'))), 0);
select t.eq('CONTROLE: o cadastro público normal continua caindo no clube legado (nada mudou pra quem já usa)',
  t.n(format($q$select count(*) from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$,
      t.id('cadastro_normal'), t.id('clube_a'))), 1);

-- =============================================================================
-- 2) ONBOARDING — retomável, idempotente e sem pular etapa (cliente comercial 1)
-- =============================================================================
select t.como('fundador_x');
select t.eq('onboarding_iniciar devolve a etapa "conta"', t.txt($q$select public.onboarding_iniciar() ->> 'etapa'$q$), 'conta');
select t.eq('IDEMPOTENTE: iniciar de novo devolve a MESMA sessão',
  t.txt($q$select (public.onboarding_iniciar() ->> 'id')$q$),
  t.txt($q$select (public.onboarding_estado() ->> 'id')$q$));

select t.permitido('etapa "conta" cria a conta comercial',
  $q$select public.onboarding_etapa('conta', '{"nome":"Cliente Um","email":"um@teste.local"}'::jsonb)$q$);
select t.permitido('repetir a etapa "conta" é aceito (reedição)',
  $q$select public.onboarding_etapa('conta', '{"nome":"Cliente Um (corrigido)"}'::jsonb)$q$);
select t.eq('...e NUNCA cria uma segunda conta comercial', t.n($q$select count(*) from public.billing_accounts$q$), 1);

select t.throws('não dá pra PULAR etapa (o servidor manda na ordem, não o cliente)',
  $q$select public.onboarding_etapa('clube', '{"nome":"Clube Pulado"}'::jsonb)$q$, 'Termine a etapa');
reset role;   -- conferir pelo ESTADO do banco, não pela visão (com RLS) de quem ainda não tem clube
select t.eq('...e nenhum clube foi criado na tentativa de pular',
  t.n($q$select count(*) from public.organizational_units where nome = 'Clube Pulado'$q$), 0);
select t.como('fundador_x');

select t.permitido('etapa "dados_basicos"',
  $q$select public.onboarding_etapa('dados_basicos', '{"documento":"00.000.000/0001-00","telefone":"81999999999"}'::jsonb)$q$);
select t.permitido('etapa "clube" cria o clube e a assinatura em trial',
  $q$select public.onboarding_etapa('clube', '{"nome":"Clube Alfa","plano":"essencial"}'::jsonb)$q$);

-- ⬇ o coração da idempotência: repetir a etapa 4 não pode duplicar nada
select t.permitido('repetir a etapa "clube"', $q$select public.onboarding_etapa('clube', '{"nome":"Clube Alfa"}'::jsonb)$q$);
reset role;   -- o clube ainda não tem diretoria: como fundador_x a RLS o esconderia e o teste passaria por engano
select t.eq('IDEMPOTENTE: continua existindo UM clube novo', t.n($q$select count(*) from public.organizational_units where nome = 'Clube Alfa'$q$), 1);
select t.eq('IDEMPOTENTE: continua existindo UMA assinatura', t.n($q$select count(*) from public.subscriptions$q$), 1);
select t.eq('IDEMPOTENTE: continua existindo UM clube coberto', t.n($q$select count(*) from public.subscription_clubs$q$), 1);

reset role;
\o /dev/null
insert into t.ids select 'clube1', club_id from public.onboarding_sessions where user_id = t.id('fundador_x');
insert into t.ids select 'conta1', billing_account_id from public.onboarding_sessions where user_id = t.id('fundador_x');
insert into t.ids select 'assin1', subscription_id from public.onboarding_sessions where user_id = t.id('fundador_x');
\o

-- ---------- interrupção: fecha o navegador aqui e volta depois ----------
select t.como('fundador_x');
select t.eq('INTERROMPEU na etapa 4: ao voltar, o servidor diz exatamente onde parar',
  t.txt($q$select public.onboarding_estado() ->> 'etapa'$q$), 'identidade');
select t.eq('...e a sessão retomada já traz o clube criado',
  t.txt($q$select (public.onboarding_estado() ->> 'club_id')$q$), t.txt(format($q$select %L::text$q$, t.id('clube1'))));

-- ---------- o provisionamento existente foi REUTILIZADO (config, jogos, chat, conteúdo) ----------
reset role;
select t.eq('provisionamento: o clube novo nasceu com a config padrão',
  t.n(format($q$select count(*) from public.config_clube where club_id = %L$q$, t.id('clube1'))), 6);
select t.ok('provisionamento: o clube novo nasceu com o catálogo de jogos',
  t.n(format($q$select count(*) from public.jogos_trilha where club_id = %L$q$, t.id('clube1'))) > 0);
select t.eq('provisionamento: o clube novo nasceu com o chat geral',
  t.n(format($q$select count(*) from public.chat_conversas where club_id = %L and tipo = 'geral'$q$, t.id('clube1'))), 1);
select t.ok('provisionamento: o clube novo nasceu com conteúdo inicial',
  t.n(format($q$select count(*) from public.desafios where club_id = %L$q$, t.id('clube1'))) > 0);
select t.eq('provisionamento conferido e registrado como ok',
  t.txt(format($q$select status from public.club_provisioning_status where club_id = %L$q$, t.id('clube1'))), 'ok');

-- ---------- termina o onboarding ----------
select t.como('fundador_x');
select t.permitido('etapa "identidade"', $q$select public.onboarding_etapa('identidade', '{"sigla":"CA","lema":"Sempre alerta","cor_primaria":"#123456"}'::jsonb)$q$);
select t.permitido('etapa "diretor" (quem cadastrou vira a diretoria do clube novo)', $q$select public.onboarding_etapa('diretor', '{}'::jsonb)$q$);
select t.permitido('repetir "diretor" não duplica vínculo', $q$select public.onboarding_etapa('diretor', '{}'::jsonb)$q$);
reset role;
select t.eq('...continua UM vínculo de diretoria no clube novo',
  t.n(format($q$select count(*) from public.organization_memberships where user_id = %L and organizational_unit_id = %L$q$,
      t.id('fundador_x'), t.id('clube1'))), 1);
select t.como('fundador_x');
select t.permitido('etapa "configuracao"', $q$select public.onboarding_etapa('configuracao', '{"pix":"pix-do-alfa"}'::jsonb)$q$);
select t.permitido('etapa "recursos"', $q$select public.onboarding_etapa('recursos', '{"recursos":{"mural":true,"bichinho":false}}'::jsonb)$q$);
select t.throws('etapa "recursos" recusa ligar o que o PLANO não inclui',
  $q$select public.onboarding_etapa('recursos', '{"recursos":{"leilao":true}}'::jsonb)$q$, 'não está incluído no plano');
select t.permitido('etapa "equipe" registra os convites', $q$select public.onboarding_etapa('equipe', '{"emails":["a@teste.local","b@teste.local"],"papel":"instrutor"}'::jsonb)$q$);
select t.permitido('repetir "equipe" não duplica convite', $q$select public.onboarding_etapa('equipe', '{"emails":["a@teste.local"],"papel":"instrutor"}'::jsonb)$q$);
reset role;
select t.eq('...continuam 2 convites de equipe', t.n(format($q$select count(*) from public.club_team_invites where club_id = %L$q$, t.id('clube1'))), 2);
select t.como('fundador_x');
select t.eq('etapa "pronto" conclui o cadastro', t.txt($q$select public.onboarding_etapa('pronto', '{}'::jsonb) ->> 'status'$q$), 'concluido');
select t.eq('...e o estado volta a dizer que não há cadastro em andamento',
  t.txt($q$select (public.onboarding_estado() -> 'tem_sessao')::text$q$), 'false');
-- achado da inspeção visual: sem esta marca, quem concluiu reencontrava a tela de "comece agora" e
-- podia abrir um SEGUNDO clube sem querer. O servidor precisa dizer "já concluiu", não só "não há sessão".
select t.eq('...dizendo explicitamente que JÁ CONCLUIU (não é convite a criar outro clube)',
  t.txt($q$select (public.onboarding_estado() -> 'concluido')::text$q$), 'true');
select t.eq('...e devolvendo o clube que foi criado',
  t.txt($q$select public.onboarding_estado() ->> 'club_id'$q$), t.txt(format($q$select %L::text$q$, t.id('clube1'))));

-- =============================================================================
-- 3) SEGUNDO CLIENTE COMERCIAL, INDEPENDENTE
-- =============================================================================
select t.como('fundador_y');
select t.permitido('cliente 2: inicia', $q$select public.onboarding_iniciar()$q$);
select t.permitido('cliente 2: conta',  $q$select public.onboarding_etapa('conta', '{"nome":"Cliente Dois"}'::jsonb)$q$);
select t.permitido('cliente 2: dados',  $q$select public.onboarding_etapa('dados_basicos', '{}'::jsonb)$q$);
select t.permitido('cliente 2: clube',  $q$select public.onboarding_etapa('clube', '{"nome":"Clube Beta","plano":"essencial"}'::jsonb)$q$);
select t.permitido('cliente 2: diretor', $q$select public.onboarding_etapa('identidade', '{}'::jsonb)$q$);
select t.permitido('cliente 2: vira diretoria', $q$select public.onboarding_etapa('diretor', '{}'::jsonb)$q$);
reset role;
\o /dev/null
insert into t.ids select 'clube2', club_id from public.onboarding_sessions where user_id = t.id('fundador_y');
insert into t.ids select 'conta2', billing_account_id from public.onboarding_sessions where user_id = t.id('fundador_y');
insert into t.ids select 'assin2', subscription_id from public.onboarding_sessions where user_id = t.id('fundador_y');
\o
select t.eq('dois clientes comerciais independentes', t.n($q$select count(*) from public.billing_accounts$q$), 2);
select t.eq('duas assinaturas independentes', t.n($q$select count(*) from public.subscriptions$q$), 2);
select t.ok('...e cada uma com o seu próprio clube',
  t.txt(format($q$select (%L::uuid <> %L::uuid)::text$q$, t.id('clube1'), t.id('clube2'))) = 'true');

-- slug gerado sem colisão e sem acento
select t.eq('o clube novo ganhou slug próprio', t.txt(format($q$select slug from public.organizational_units where id = %L$q$, t.id('clube1'))), 'clube-alfa');

-- ---------- múltiplos clubes na MESMA assinatura (o modelo permite) ----------
\o /dev/null
insert into public.organizational_units (type, nome, slug) values ('clube', 'Clube Alfa Filial', 'clube-alfa-filial');
insert into t.ids select 'clube1b', id from public.organizational_units where slug = 'clube-alfa-filial';
insert into public.subscription_clubs (subscription_id, club_id) values (t.id('assin1'), t.id('clube1b'));
\o
select t.eq('uma assinatura pode cobrir VÁRIOS clubes',
  t.n(format($q$select public.limite_uso(%L, 'clubes')$q$, t.id('clube1'))), 2);
select t.eq('...e o plano vale igual no clube irmão',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'jogos')::text$q$, t.id('clube1b'))), 'true');

-- =============================================================================
-- 4) AS TRÊS CAMADAS: plano → clube → usuário
-- =============================================================================
-- o plano "essencial" NÃO inclui leilão nem classes
select t.eq('camada 1 (plano): "leilao" não está no plano essencial',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'leilao')::text$q$, t.id('clube1'))), 'false');
select t.eq('camada 1 (plano): "jogos" está no plano essencial',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'jogos')::text$q$, t.id('clube1'))), 'true');

-- a diretoria LIGA o leilão no clube: a camada do clube aceita, mas a do plano continua barrando
select t.como('fundador_x');
select t.pedir_clube('clube1');
select t.permitido('a diretoria pode ligar o recurso no clube (camada 2 é dela)', $q$select public.recurso_definir('leilao', true)$q$);
select t.eq('camada 2 (clube) ligada...', t.txt(format($q$select (public.recurso_situacao(%L, 'leilao') -> 'no_clube')::text$q$, t.id('clube1'))), 'true');
select t.eq('...mas o EFETIVO continua falso, porque o plano não inclui',
  t.txt(format($q$select (public.recurso_situacao(%L, 'leilao') -> 'efetivo')::text$q$, t.id('clube1'))), 'false');
select t.eq('operacao_permitida diz QUAL camada barrou: plano',
  t.txt($q$select public.operacao_permitida('leilao', 'gerir') ->> 'bloqueio'$q$), 'plano');

-- recurso no plano, mas DESLIGADO pelo clube -> a camada que barra é a do clube
select t.permitido('a diretoria desliga um recurso que ESTÁ no plano', $q$select public.recurso_definir('bichinho', false)$q$);
select t.eq('operacao_permitida diz QUAL camada barrou: clube',
  t.txt($q$select public.operacao_permitida('bichinho', 'gerir') ->> 'bloqueio'$q$), 'clube');
select t.eq('plano + clube ok e usuário com permissão: permitido',
  t.txt($q$select (public.operacao_permitida('mural', 'gerir') -> 'permitido')::text$q$), 'true');

-- usuário sem permissão: a terceira camada
\o /dev/null
reset role;
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('equipe_1'), t.id('clube1'), 'desbravador', 'ativo');
\o
select t.como('equipe_1');
select t.pedir_clube('clube1');
select t.eq('camada 3 (usuário): membro comum não GERE, mesmo com plano e clube liberados',
  t.txt($q$select public.operacao_permitida('mural', 'gerir') ->> 'bloqueio'$q$), 'usuario');
select t.eq('...mas USAR o recurso ele pode',
  t.txt($q$select (public.operacao_permitida('mural', 'usar') -> 'permitido')::text$q$), 'true');

-- =============================================================================
-- 5) MUDANÇA DE PLANO — só a plataforma; downgrade abaixo do uso não apaga nada
-- =============================================================================
select t.como('fundador_x');
select t.pedir_clube('clube1');
select t.throws('o CLIENTE não muda o próprio plano pelo app',
  format($q$select public.plano_mudar(%L, 'completo')$q$, t.id('assin1')), 'administração da plataforma');
select t.eq('a tela do clube diz explicitamente que trocar de plano não é ato dele',
  t.txt($q$select (public.assinatura_do_clube() -> 'pode_mudar_plano')::text$q$), 'false');
select t.eq('a diretoria enxerga o plano em que está', t.txt($q$select public.assinatura_do_clube() #>> '{plano,chave}'$q$), 'essencial');
select t.eq('...e que o status é trial', t.txt($q$select public.assinatura_do_clube() ->> 'status'$q$), 'trial');

select t.como('admin_saas');
select t.permitido('a plataforma faz UPGRADE', format($q$select public.plano_mudar(%L, 'completo')$q$, t.id('assin1')));
select t.eq('upgrade liberou o leilão no plano',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'leilao')::text$q$, t.id('clube1'))), 'true');
reset role;
select t.eq('...e agora o efetivo segue a escolha do clube (que já tinha ligado)',
  t.txt(format($q$select public.recurso_habilitado_no_clube(%L, 'leilao')::text$q$, t.id('clube1'))), 'true');

-- enche o clube de administradores pra que o plano "gratuito" (2) fique abaixo do uso, e cria uma
-- mensalidade ENQUANTO o plano ainda inclui o recurso (ela tem que sobreviver ao downgrade)
\o /dev/null
reset role;
insert into public.organization_memberships (user_id, organizational_unit_id, role, status)
values (t.id('equipe_2'), t.id('clube1'), 'diretoria', 'ativo');
update public.organization_memberships set role = 'tesoureiro' where user_id = t.id('equipe_1') and organizational_unit_id = t.id('clube1');
insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por, club_id)
values (t.id('equipe_1'), 3, 2026, 10, 'pendente', t.id('fundador_x'), t.id('clube1'));
\o
select t.eq('o clube tem 3 administradores', t.n(format($q$select public.limite_uso(%L, 'administradores')$q$, t.id('clube1'))), 3);

select t.como('admin_saas');
select t.eq('DOWNGRADE abaixo do uso pede confirmação explícita',
  t.txt(format($q$select (public.plano_mudar(%L, 'gratuito') -> 'precisa_confirmar')::text$q$, t.id('assin1'))), 'true');
select t.eq('...e sem confirmar NADA muda (continua no completo)',
  t.txt(format($q$select p.chave from public.subscriptions s join public.billing_plans p on p.id = s.plan_id where s.id = %L$q$, t.id('assin1'))), 'completo');
select t.eq('confirmando, o downgrade é aplicado',
  t.txt(format($q$select (public.plano_mudar(%L, 'gratuito', null, true) -> 'ok')::text$q$, t.id('assin1'))), 'true');
reset role;
select t.eq('...e NADA foi apagado: os 3 administradores continuam lá',
  t.n(format($q$select public.limite_uso(%L, 'administradores')$q$, t.id('clube1'))), 3);
select t.eq('o que para é o CRESCIMENTO: novo administrador é recusado pelo teto do plano',
  t.txt(format($q$select public.plano_limite(%L, 'administradores')::text$q$, t.id('clube1'))), '2');
select t.throws('novo vínculo de diretoria é barrado enquanto o uso estiver acima do teto',
  format($q$insert into public.organization_memberships (user_id, organizational_unit_id, role, status) values (%L, %L, 'diretoria', 'ativo')$q$,
         t.id('fundador_y'), t.id('clube1')), 'administradores');

-- o plano gratuito não inclui mensalidades: a ESCRITA NOVA para, pelo gatilho que já existia
select t.eq('havia 1 mensalidade no clube antes do downgrade',
  t.n(format($q$select count(*) from public.mensalidades where club_id = %L$q$, t.id('clube1'))), 1);
select t.como('admin_saas');
select t.eq('gratuito não inclui mensalidades',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'mensalidades')::text$q$, t.id('clube1'))), 'false');
\o /dev/null
reset role;
\o
select t.throws('o gatilho de entitlement que JÁ EXISTIA passa a respeitar o plano (nenhum gate novo)',
  format($q$insert into public.mensalidades (desbravador_id, mes, ano, valor, status, registrado_por, club_id) values (%L, 4, 2026, 10, 'pendente', %L, %L)$q$,
         t.id('equipe_1'), t.id('fundador_x'), t.id('clube1')), 'desabilitado');
select t.eq('...e a mensalidade que já existia CONTINUA lá (nada é apagado)',
  t.n(format($q$select count(*) from public.mensalidades where club_id = %L$q$, t.id('clube1'))), 1);

-- =============================================================================
-- 6) INADIMPLÊNCIA → SUSPENSÃO → REATIVAÇÃO (provider mock, pelo receptor de webhook)
-- =============================================================================
\o /dev/null
reset role;
insert into public.billing_invoices (subscription_id, competencia, valor_centavos, vence_em, provider, provider_ref)
values (t.id('assin2'), date_trunc('month', current_date)::date, 4900, current_date - 3, 'mock', 'cob-2');
\o
select t.como_service();
select t.eq('webhook "pagamento_atrasado" dentro da carência: só pagamento pendente',
  t.txt(format($q$select public.billing_webhook_receber('mock', 'ev-atraso-1', 'pagamento_atrasado', %L::jsonb) #>> '{resultado,status}'$q$,
        json_build_object('cobranca_ref', 'cob-2')::text)), 'pagamento_pendente');

\o /dev/null
reset role;
update public.billing_invoices set vence_em = current_date - 20 where provider_ref = 'cob-2';
\o
select t.eq('passada a carência: inadimplente', t.txt(format($q$select public.assinatura_avaliar(%L)$q$, t.id('assin2'))), 'inadimplente');
select t.eq('inadimplente NÃO desliga o clube: os recursos seguem disponíveis',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'jogos')::text$q$, t.id('clube2'))), 'true');

\o /dev/null
reset role;
update public.billing_invoices set vence_em = current_date - 200 where provider_ref = 'cob-2';
\o
select t.eq('atraso longo: suspensa', t.txt(format($q$select public.assinatura_avaliar(%L)$q$, t.id('assin2'))), 'suspensa');
select t.eq('suspensa PARA a escrita nova de recurso opcional',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'jogos')::text$q$, t.id('clube2'))), 'false');
select t.eq('...mas o VÍNCULO das pessoas continua exatamente como estava',
  t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L and status = 'ativo'$q$, t.id('clube2'))), 1);
select t.como('fundador_y');
select t.pedir_clube('clube2');
select t.eq('a pessoa do clube suspenso continua membro ativo e com clube em uso',
  t.txt(format($q$select public.membro_ativo_no_clube(%L)::text$q$, t.id('clube2'))), 'true');
select t.eq('...e continua enxergando o próprio clube', t.txt($q$select public.clube_atual_id()::text$q$), t.txt(format($q$select %L::text$q$, t.id('clube2'))));

-- reativação: pagamento aprovado
select t.como_service();
select t.eq('webhook "pagamento_aprovado" REATIVA a assinatura',
  t.txt(format($q$select public.billing_webhook_receber('mock', 'ev-pago-1', 'pagamento_aprovado', %L::jsonb) #>> '{resultado,status}'$q$,
        json_build_object('cobranca_ref', 'cob-2')::text)), 'ativa');
select t.eq('...a cobrança ficou paga', t.txt($q$select status from public.billing_invoices where provider_ref = 'cob-2'$q$), 'paga');
select t.eq('...e os recursos voltaram',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'jogos')::text$q$, t.id('clube2'))), 'true');

-- =============================================================================
-- 7) WEBHOOK DUPLICADO (reentrega do MESMO evento)
-- =============================================================================
select t.eq('a reentrega é reconhecida como duplicada',
  t.txt(format($q$select (public.billing_webhook_receber('mock', 'ev-pago-1', 'pagamento_aprovado', %L::jsonb) -> 'duplicado')::text$q$,
        json_build_object('cobranca_ref', 'cob-2')::text)), 'true');
select t.eq('...e NÃO grava um segundo evento', t.n($q$select count(*) from public.billing_events where evento_externo_id = 'ev-pago-1'$q$), 1);
select t.eq('...e NÃO gera uma segunda transição comercial',
  t.n(format($q$select count(*) from public.subscription_events where subscription_id = %L and motivo = 'pagamento aprovado'$q$, t.id('assin2'))), 1);

-- =============================================================================
-- 8) CANCELAMENTO — histórico, não faxina
-- =============================================================================
select t.como_service();
select t.eq('webhook de cancelamento cancela a assinatura',
  t.txt(format($q$select public.billing_webhook_receber('mock', 'ev-cancel-1', 'cancelamento', %L::jsonb) #>> '{resultado,status}'$q$,
        json_build_object('subscription_id', t.id('assin2'), 'motivo', 'cliente pediu')::text)), 'cancelada');
select t.eq('cancelada é terminal: não se "descancela" (assina-se de novo)',
  t.txt(format($q$select public.assinatura_avaliar(%L)$q$, t.id('assin2'))), 'cancelada');
select t.throws('transição inválida é recusada',
  format($q$select public._assinatura_transicionar(%L, 'ativa', 'na marra')$q$, t.id('assin2')), 'Transição comercial inválida');
select t.eq('o clube cancelado NÃO perdeu nenhuma pessoa',
  t.n(format($q$select count(*) from public.organization_memberships where organizational_unit_id = %L$q$, t.id('clube2'))), 1);
select t.eq('...nem a configuração, nem o conteúdo provisionado',
  t.n(format($q$select count(*) from public.config_clube where club_id = %L$q$, t.id('clube2'))), 6);
select t.eq('a política comercial NÃO PODE ser configurada para apagar dados (garantia estrutural)',
  t.n($q$select count(*) from pg_constraint where conrelid = 'public.billing_policies'::regclass and conname like '%nunca_apagar%'$q$), 1);

-- =============================================================================
-- 9) ISOLAMENTO: conta comercial × dados privados
-- =============================================================================
select t.como('fundador_x');
select t.eq('o titular vê a PRÓPRIA conta comercial', t.n(format($q$select count(*) from public.billing_accounts where id = %L$q$, t.id('conta1'))), 1);
select t.eq('...e NÃO vê a conta do outro cliente', t.nv(format($q$select count(*) from public.billing_accounts where id = %L$q$, t.id('conta2'))), 0);
select t.eq('...nem a assinatura do outro cliente', t.nv(format($q$select count(*) from public.subscriptions where id = %L$q$, t.id('assin2'))), 0);
select t.eq('...nem as cobranças do outro cliente', t.nv($q$select count(*) from public.billing_invoices$q$), 0);
select t.eq('...nem os eventos de webhook (operação interna)', t.nv($q$select count(*) from public.billing_events$q$), 0);
select t.como('lider_a');
select t.eq('ser diretor de clube NÃO dá acesso a nenhuma conta comercial', t.nv($q$select count(*) from public.billing_accounts$q$), 0);
select t.eq('...nem a nenhuma assinatura', t.nv($q$select count(*) from public.subscriptions$q$), 0);
-- 3 planos públicos (o legado-fundador não é público); contam-se as CHAVES, não as versões — a fase 6
-- publicou a v2 do essencial, e é assim mesmo que módulo novo entra: por versão nova de plano.
select t.eq('o catálogo de planos, esse sim, é público pra quem está logado (o preço vem do banco)',
  t.n($q$select count(distinct chave) from public.billing_plans where publico$q$), 3);

-- =============================================================================
-- 10) ADMIN DA PLATAFORMA: opera o SaaS, não enxerga o clube
-- =============================================================================
select t.como('admin_saas');
select t.ok('admin enxerga as contas/planos/assinaturas/uso', t.n($q$select json_array_length(public.admin_contas_listar())$q$) = 2);
select t.eq('admin NÃO tem clube em uso (não é membro de nenhum)', t.txt($q$select coalesce(public.clube_atual_id()::text, 'nulo')$q$), 'nulo');
select t.eq('admin NÃO vê perfis de gente de clube nenhum', t.nv($q$select count(*) from public.profiles where id <> auth.uid()$q$), 0);
select t.eq('admin NÃO vê fotos', t.nv($q$select count(*) from public.fotos$q$), 0);
select t.eq('admin NÃO vê mensagens de chat', t.nv($q$select count(*) from public.chat_mensagens$q$), 0);
select t.eq('admin NÃO vê mensalidades', t.nv($q$select count(*) from public.mensalidades$q$), 0);
select t.eq('admin NÃO vê responsáveis', t.nv($q$select count(*) from public.responsaveis$q$), 0);
select t.eq('admin NÃO vê evidências/entregas', t.nv($q$select count(*) from public.entregas$q$), 0);
select t.eq('admin NÃO vê eventos da agenda dos clubes', t.nv($q$select count(*) from public.eventos$q$), 0);
-- A lista abaixo é a fronteira do que a operação da plataforma pode alcançar. Ela cresce com
-- MUITA parcimônia: cada nome novo aqui é uma decisão de produto, não um detalhe técnico.
-- Fase 8.1 acrescentou duas, as duas de OPERAÇÃO e deliberadamente sem conteúdo:
--   app_erros    telemetria de erro. Tem club_id e user_id (é o que permite responder "isso
--                atingiu quantas pessoas, de quantos clubes?" diante de um relato), mas nenhuma
--                coluna capaz de guardar conteúdo — sem mensagem do servidor, sem texto, sem
--                foto, sem nome. O teste 48 trava a lista de colunas exatamente por isso.
--   infra_falhas falha de infraestrutura (push sem configuração). Mesmo desenho.
-- A regra da fase 5 — "não conceda acesso a fotos, chat, evidências, responsáveis ou conteúdo
-- privado" — continua valendo inteira: os asserts logo acima provam que o admin não lê nada disso.
select t.eq('a migration 48 NÃO criou policy nenhuma que cite eh_admin_plataforma em tabela de dado de clube',
  t.n($q$select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relnamespace = 'public'::regnamespace
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'eh_admin_plataforma'
          and c.relname not in ('billing_accounts','billing_account_contacts','billing_plans','billing_prices',
                                'subscriptions','subscription_events','subscription_clubs','billing_invoices',
                                'billing_events','billing_providers','platform_admins','platform_admin_audit',
                                'support_grants','club_provisioning_status',
                                'app_erros','infra_falhas',
                                -- fase 8.2: telemetria de ENTREGA de push. Mesmo desenho das duas
                                -- acima — sem coluna de conteudo, so metadado de falha. O admin
                                -- ve "quantas entregas falharam, em que clube", nunca o que dizia.
                                'push_eventos','push_evento_destinatarios','push_tentativas',
                                -- fase 8.2: canal de alerta. Mesmo desenho — o CHECK
                                -- `alerta_sem_conteudo` proibe titulo/corpo/texto/token/email em
                                -- `dados`, porque o alerta SAI do sistema (vai para um Slack).
                                'alertas','alerta_destinos','alerta_entregas','infra_heartbeat')$q$), 0);

-- E a prova de que a exceção não abriu porta: a telemetria que o admin lê não tem como carregar
-- conteúdo de clube nenhum, porque as colunas para isso não existem.
select t.eq('as duas tabelas de operação novas não têm coluna capaz de guardar conteúdo',
  t.n($q$select count(*) from information_schema.columns
        where table_schema='public' and table_name in ('app_erros','infra_falhas')
          and column_name in ('mensagem','texto','payload','corpo','conteudo','url','foto','nome','email')$q$), 0);
-- As tabelas de push seguem a mesma regra, e uma a mais: nem a CREDENCIAL de entrega entra.
-- `push_tentativas` aponta para o aparelho por um uuid derivado, nunca pelo token/endpoint.
-- E o alerta, que e o que mais sai do sistema, tem a trava como CONSTRAINT e nao como convencao.
select t.eq('a tabela de alertas proibe conteudo por CHECK, nao por disciplina',
  t.n($q$select count(*) from pg_constraint
        where conrelid = 'public.alertas'::regclass and conname = 'alerta_sem_conteudo'$q$), 1);
-- Duas camadas, e a ordem importa: quem esta logado esbarra no GRANT antes de chegar ao CHECK.
-- Por isso a prova do CHECK roda como postgres — senao o teste passaria pelo motivo errado.
select t.throws('ninguem logado escreve alerta (a primeira camada e o GRANT)',
  $q$insert into public.alertas (categoria, chave_dedupe, severidade, resumo)
     values ('push_degradado', 'x', 'alto', 'r')$q$, 'permission denied');
reset role;
select t.throws('...e o CHECK recusa um alerta que carregue texto, mesmo vindo do servidor',
  $q$insert into public.alertas (categoria, chave_dedupe, severidade, resumo, dados)
     values ('push_degradado', 'x', 'alto', 'r', '{"corpo":"o aviso do Joao"}'::jsonb)$q$,
  'alerta_sem_conteudo');

select t.eq('as tabelas de push não guardam conteúdo nem credencial de entrega',
  t.n($q$select count(*) from information_schema.columns
        where table_schema='public' and table_name in ('push_eventos','push_evento_destinatarios','push_tentativas')
          and column_name in ('titulo','corpo','texto','payload','link','token','endpoint','p256dh','auth')$q$), 0);

select t.como('lider_a');
select t.eq('diretor de clube não é admin da plataforma', t.txt($q$select public.eh_admin_plataforma()::text$q$), 'false');
select t.throws('...e o painel da operação recusa', $q$select public.admin_contas_listar()$q$, 'administração da plataforma');
select t.bloqueado('ninguém se promove a admin da plataforma',
  format($q$insert into public.platform_admins (user_id, papel) values (%L, 'owner')$q$, t.id('lider_a')));
select t.eq('o papel de admin NÃO mora em organization_memberships (nenhum vínculo com papel de plataforma)',
  t.n($q$select count(*) from public.organization_memberships where role in ('suporte', 'operacao', 'owner')$q$), 0);

-- =============================================================================
-- 11) SUPORTE ASSISTIDO: pedido + autorização do clube + prazo + motivo + auditoria
-- =============================================================================
select t.como('admin_saas');
select t.throws('pedido sem motivo de verdade é recusado',
  format($q$select public.suporte_solicitar(%L, 'oi', 24)$q$, t.id('clube1')), 'motivo');
select t.throws('prazo fora da faixa é recusado',
  format($q$select public.suporte_solicitar(%L, 'investigar erro de provisionamento', 999)$q$, t.id('clube1')), 'prazo');
select t.permitido('pedido válido é registrado',
  format($q$select public.suporte_solicitar(%L, 'investigar erro de provisionamento relatado pela diretoria', 24)$q$, t.id('clube1')));
select t.eq('...e o acesso ainda NÃO está vigente (só foi pedido)',
  t.txt(format($q$select public.suporte_acesso_vigente(%L)::text$q$, t.id('clube1'))), 'false');
select t.eq('...e o admin continua sem ver ninguém do clube', t.nv($q$select count(*) from public.profiles where id <> auth.uid()$q$), 0);

\o /dev/null
reset role;
insert into t.ids select 'grant1', id from public.support_grants where club_id = t.id('clube1') limit 1;
\o
select t.como('admin_saas');
select t.throws('o próprio admin NÃO pode autorizar o acesso dele',
  format($q$select public.suporte_autorizar(%L, 24)$q$, t.id('grant1')), 'liderança deste clube');
select t.como('fundador_x');
select t.pedir_clube('clube1');
select t.eq('a liderança do CLUBE é quem autoriza, com prazo',
  t.txt(format($q$select public.suporte_autorizar(%L, 4) ->> 'status'$q$, t.id('grant1'))), 'autorizado');
reset role;
select t.ok('...e o prazo ficou registrado',
  t.n(format($q$select count(*) from public.support_grants where id = %L and expira_em is not null$q$, t.id('grant1'))) = 1);
select t.como('admin_saas');
select t.eq('agora o acesso está VIGENTE pela regra...',
  t.txt(format($q$select public.suporte_acesso_vigente(%L)::text$q$, t.id('clube1'))), 'true');
select t.eq('...mas NADA foi aberto nesta fase: o admin continua sem ver gente do clube',
  t.nv($q$select count(*) from public.profiles where id <> auth.uid()$q$), 0);
select t.eq('ESTRUTURAL: nenhuma policy do banco consulta suporte_acesso_vigente (o acesso não existe ainda)',
  t.n($q$select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relnamespace = 'public'::regnamespace
          and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'suporte_acesso_vigente'$q$), 0);
select t.como('fundador_x');
select t.pedir_clube('clube1');
select t.eq('o clube pode REVOGAR a qualquer momento', t.txt(format($q$select public.suporte_revogar(%L, 'não preciso mais') ->> 'status'$q$, t.id('grant1'))), 'revogado');
select t.como('admin_saas');
select t.eq('...e o acesso deixa de estar vigente na hora',
  t.txt(format($q$select public.suporte_acesso_vigente(%L)::text$q$, t.id('clube1'))), 'false');
select t.ok('a auditoria administrativa registrou pedido, autorização e revogação',
  t.n(format($q$select count(*) from public.platform_admin_audit where alvo_id = %L and acao in ('suporte_solicitar','suporte_autorizado_pelo_clube','suporte_revogado')$q$, t.id('clube1'))) = 3);
select t.ok('a auditoria registrou a mudança de plano feita pela plataforma',
  t.n($q$select count(*) from public.platform_admin_audit where acao = 'plano_mudar'$q$) >= 2);
reset role;
select t.throws('a auditoria administrativa é IMUTÁVEL (nem o dono do banco reescreve)',
  $q$update public.platform_admin_audit set acao = 'mentira'$q$, 'imutável');
select t.throws('...e não pode ser apagada',
  $q$delete from public.platform_admin_audit$q$, 'imutável');

-- =============================================================================
-- 12) TENANT 001 INTEIRO — inclusive depois de receber o plano legado/fundador
-- =============================================================================
select t.eq('o Tenant 001 não tem assinatura nenhuma',
  t.n(format($q$select count(*) from public.subscription_clubs where club_id = %L$q$, t.id('clube_a'))), 0);
select t.eq('...então a camada do plano devolve "disponível" (comportamento de hoje, bit a bit)',
  t.pg(format($q$select public.recurso_disponivel_no_plano(%L, 'leilao')::text$q$, t.id('clube_a'))), 'true');
select t.eq('...o leilão do Tenant 001 continua ligado', t.txt(format($q$select public.recurso_habilitado_no_clube(%L, 'leilao')::text$q$, t.id('clube_a'))), 'true');
select t.eq('...e sem teto nenhum', t.txt(format($q$select coalesce(public.plano_limite(%L, 'membros')::text, 'sem-teto')$q$, t.id('clube_a'))), 'sem-teto');

\o /dev/null
reset role;
create table t.antes as select public.recursos_do_clube(t.id('clube_a')) as r;
insert into public.billing_accounts (id, nome) values ('00000000-0000-4000-8000-000000000001', 'Clube fundador (legado)');
insert into public.subscriptions (id, billing_account_id, plan_id, status)
select '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', id, 'ativa'
  from public.billing_plans where chave = 'legado-fundador' and versao = 1;
insert into public.subscription_clubs (subscription_id, club_id) values ('00000000-0000-4000-8000-000000000002', t.id('clube_a'));
\o
select t.eq('DEPOIS de receber o plano legado/fundador, os recursos do Tenant 001 são EXATAMENTE os mesmos',
  t.txt(format($q$select (select r from t.antes)::text = public.recursos_do_clube(%L)::text$q$, t.id('clube_a'))), 'true');
select t.eq('...e continua sem teto de membros',
  t.txt(format($q$select coalesce(public.plano_limite(%L, 'membros')::text, 'sem-teto')$q$, t.id('clube_a'))), 'sem-teto');
select t.eq('...e o leilão segue ligado', t.txt(format($q$select public.recurso_habilitado_no_clube(%L, 'leilao')::text$q$, t.id('clube_a'))), 'true');

-- =============================================================================
-- 13) CATÁLOGO: versionado, e os valores estão marcados como PROVISÓRIOS
-- =============================================================================
select t.eq('o catálogo é versionado (chave + versão únicos)',
  t.n($q$select count(*) from pg_constraint where conrelid = 'public.billing_plans'::regclass and contype = 'u'$q$), 1);
select t.eq('TODO preço do catálogo está marcado como provisório (nada foi decidido comercialmente)',
  t.n($q$select count(*) from public.billing_prices where not provisorio$q$), 0);
select t.eq('TODO plano do catálogo está marcado como provisório',
  t.n($q$select count(*) from public.billing_plans where not provisorio$q$), 0);
select t.throws('um plano não pode citar módulo que o app não tem',
  $q$insert into public.billing_plans (chave, versao, nome, recursos) values ('inventado', 1, 'Inventado', array['teletransporte'])$q$,
  'não existe no catálogo');
select t.eq('nenhum gateway real foi integrado: o único provedor é o mock local',
  t.txt($q$select string_agg(chave, ',' order by chave) from public.billing_providers$q$), 'mock');

select t.fim();
rollback;
