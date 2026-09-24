-- =============================================================================
--  Fase 8.4 — o caminho de produto para uma pessoa entrar num SEGUNDO clube.
--
--  O QUE A VALIDAÇÃO MULTI-CLUBE ENCONTROU, e é o achado central da fase:
--
--  O produto é vendido como multi-clube. O banco modela isso corretamente (uma identidade,
--  N vínculos), a RLS trata corretamente, e 54 arquivos de teste exercitam pessoas com vínculo em
--  dois clubes. Mas TODOS eles criam esses vínculos com SQL direto (`t.mk2` nos fixtures).
--
--  Varrendo o banco: só três funções inserem em `organization_memberships` —
--    handle_new_user ....... o PRIMEIRO vínculo, no cadastro
--    onboarding_etapa ...... o vínculo do fundador no clube que ele acabou de criar
--    sincronizar_vinculo_perfil ... espelho interno
--  e `organization_memberships` não tem policy de INSERT nenhuma (só de SELECT).
--
--  Ou seja: **não existia caminho para uma pessoa já cadastrada entrar num segundo clube.**
--  `vinculo_gerir` só altera vínculo existente. O onboarding grava convites em
--  `club_team_invites` — com colunas `aceito_por` e `aceito_em` prontas — e NADA os lia.
--  A aceitação foi desenhada e nunca implementada, e o convite morria na tabela.
--
--  Este arquivo trava o caminho que faltava, e trava principalmente o que ele NÃO pode virar:
--  um convite não pode ser aceito por outra pessoa, não pode escalar papel, não pode ressuscitar
--  vínculo encerrado sem decisão da liderança, e não pode ser reutilizado.
-- =============================================================================
begin;
\ir _lib.sql
\ir _fixtures.sql

\o /dev/null
alter default privileges in schema t grant select on tables to public;
-- 'forasteiro' tem conta e vínculo SÓ no clube A. É a pessoa que o clube B quer convidar.
select t.mk('forasteiro', 'Forasteiro do A', 'instrutor', 'ativo', 'clube_a', 'A1');
-- e-mail previsível: t.mk usa "<chave>@teste.local"
create function t.email(p_chave text) returns text language sql stable
security definer set search_path = '' as $$
  select email from auth.users where id = t.id(p_chave);
$$;
\o

select t.eq('o forasteiro começa com vínculo em UM clube só',
  t.n($q$select count(*) from public.organization_memberships where user_id = t.id('forasteiro')$q$), 1);

-- =============================================================================
--  1. Quem pode convidar
-- =============================================================================
select t.como('membro_b');
select t.pedir_clube('clube_b');
select t.throws('membro comum não convida ninguém para o clube',
  $q$select public.convite_equipe_criar(t.email('forasteiro'), 'instrutor')$q$, 'Sem permissão');
reset role;

select t.como('lider_b');
select t.pedir_clube('clube_b');
select t.throws('nem a diretoria convida para um papel inválido',
  $q$select public.convite_equipe_criar(t.email('forasteiro'), 'presidente')$q$, 'Papel inválido');
select t.throws('...nem convida com e-mail vazio',
  $q$select public.convite_equipe_criar('  ', 'instrutor')$q$, 'Informe o e-mail');
select t.permitido('a diretoria de B convida o forasteiro como instrutor',
  $q$select public.convite_equipe_criar(t.email('forasteiro'), 'instrutor')$q$, 0);
-- Repetir o convite não duplica: é o mesmo convite, não dois.
select t.permitido('convidar de novo o mesmo e-mail não duplica',
  $q$select public.convite_equipe_criar(t.email('forasteiro'), 'instrutor')$q$, 0);
reset role;
select t.eq('existe UM convite pendente de B para o forasteiro',
  t.n($q$select count(*) from public.club_team_invites
       where club_id = t.id('clube_b') and email = t.email('forasteiro') and status = 'pendente'$q$), 1);

-- =============================================================================
--  2. Quem pode aceitar — e quem não pode
-- =============================================================================
\o /dev/null
create table t.conv as select id from public.club_team_invites
 where club_id = t.id('clube_b') and email = t.email('forasteiro');
\o

-- O convite é NOMINAL. Outra pessoa não o aceita, nem sabendo o id.
select t.como('membro_a2');
select t.throws('outra pessoa não aceita um convite que não é dela',
  $q$select public.convite_equipe_aceitar((select id from t.conv))$q$, 'não encontrado');
reset role;
select t.eq('...e nenhum vínculo foi criado para ela',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_b')$q$), 0);

-- Id inexistente responde a MESMA coisa que convite alheio: não é oráculo.
select t.como('membro_a2');
select t.eq('convite alheio e convite inexistente dão a mesma resposta',
  t.txt($q$select public.convite_equipe_aceitar((select id from t.conv))$q$),
  t.txt($q$select public.convite_equipe_aceitar('11111111-2222-3333-4444-555555555555'::uuid)$q$));
reset role;

-- A pessoa certa aceita.
select t.como('forasteiro');
select t.ok('o forasteiro enxerga o convite dele',
  t.n($q$select json_array_length(public.convites_da_equipe())$q$) = 1);
select t.permitido('e aceita', $q$select public.convite_equipe_aceitar((select id from t.conv))$q$, 0);
reset role;

select t.eq('agora ele tem vínculo nos DOIS clubes',
  t.n($q$select count(*) from public.organization_memberships where user_id = t.id('forasteiro')$q$), 2);
select t.eq('...com o papel que foi convidado no clube B',
  t.txt($q$select role from public.organization_memberships
         where user_id = t.id('forasteiro') and organizational_unit_id = t.id('clube_b')$q$), 'instrutor');
select t.eq('...e ativo (a liderança já avalizou ao convidar)',
  t.txt($q$select status from public.organization_memberships
         where user_id = t.id('forasteiro') and organizational_unit_id = t.id('clube_b')$q$), 'ativo');
select t.eq('...sem unidade (instrutor de clube não nasce numa unidade)',
  t.txt($q$select coalesce(unidade_id::text, 'nulo') from public.organization_memberships
         where user_id = t.id('forasteiro') and organizational_unit_id = t.id('clube_b')$q$), 'nulo');
select t.eq('o convite ficou marcado como aceito, por quem aceitou',
  t.txt($q$select (aceito_por = t.id('forasteiro'))::text from public.club_team_invites
         where id = (select id from t.conv)$q$), 'true');

-- O vínculo ANTIGO não foi tocado: identidade é uma, vínculos são vários.
select t.eq('o vínculo em A continua intacto, com o papel de lá',
  t.txt($q$select role || '/' || status from public.organization_memberships
         where user_id = t.id('forasteiro') and organizational_unit_id = t.id('clube_a')$q$), 'instrutor/ativo');
select t.eq('...e a unidade em A continua a mesma',
  t.txt($q$select (unidade_id = t.id('A1'))::text from public.organization_memberships
         where user_id = t.id('forasteiro') and organizational_unit_id = t.id('clube_a')$q$), 'true');

-- =============================================================================
--  3. Idempotência e reuso
-- =============================================================================
select t.como('forasteiro');
select t.throws('aceitar de novo o mesmo convite é recusado',
  $q$select public.convite_equipe_aceitar((select id from t.conv))$q$, 'não encontrado');
reset role;
select t.eq('...e continua havendo UM vínculo em B, não dois',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('forasteiro') and organizational_unit_id = t.id('clube_b')$q$), 1);

-- Convite para quem JÁ está no clube: não cria um segundo vínculo nem rebaixa o papel.
select t.como('lider_b');
select t.pedir_clube('clube_b');
select t.permitido('B convida alguém que já está lá (por engano)',
  $q$select public.convite_equipe_criar(t.email('membro_b'), 'diretoria')$q$, 0);
reset role;
\o /dev/null
create table t.conv2 as select id from public.club_team_invites
 where club_id = t.id('clube_b') and email = t.email('membro_b');
\o
select t.como('membro_b');
select t.permitido('a pessoa aceita', $q$select public.convite_equipe_aceitar((select id from t.conv2))$q$, 0);
reset role;
select t.eq('continua com UM vínculo em B',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b')$q$), 1);
-- Esta é a decisão que precisa estar escrita: aceitar convite NÃO promove quem já é do clube.
-- Promoção é ato da liderança, por `vinculo_gerir`, com a pessoa ciente — não um efeito colateral
-- de clicar num link. Senão um convite mal endereçado vira escalada de privilégio.
select t.eq('...e o papel dela NÃO foi promovido pelo convite',
  t.txt($q$select role from public.organization_memberships
         where user_id = t.id('membro_b') and organizational_unit_id = t.id('clube_b')$q$), 'desbravador');

-- =============================================================================
--  4. O convite é do clube que convidou — não de outro
-- =============================================================================
select t.como('lider_a');
select t.pedir_clube('clube_a');
select t.eq('a diretoria de A não enxerga os convites de B',
  t.nv($q$select count(*) from public.club_team_invites where club_id = t.id('clube_b')$q$), 0);
reset role;

-- E o vínculo criado carrega o clube do CONVITE, não o clube em uso de quem aceitou.
-- (a pessoa aceita o convite de B enquanto está operando em A — o alvo é o convite)
\o /dev/null
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.convite_equipe_criar(t.email('membro_a2'), 'conselheiro');
reset role;
create table t.conv3 as select id from public.club_team_invites
 where club_id = t.id('clube_b') and email = t.email('membro_a2');
\o
select t.como('membro_a2');
select t.pedir_clube('clube_a');   -- operando em A, aceitando convite de B
select t.permitido('aceita o convite de B enquanto opera em A',
  $q$select public.convite_equipe_aceitar((select id from t.conv3))$q$, 0);
reset role;
select t.eq('o vínculo nasceu no clube do CONVITE (B), não no clube em uso (A)',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_b')$q$), 1);
select t.eq('...e nada foi criado em A por engano',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('membro_a2') and organizational_unit_id = t.id('clube_a')$q$), 1);

-- =============================================================================
--  5. Revogar
-- =============================================================================
select t.como('lider_b');
select t.pedir_clube('clube_b');
select t.permitido('B convida mais alguém', $q$select public.convite_equipe_criar('ninguem@teste.local', 'instrutor')$q$, 0);
reset role;
\o /dev/null
create table t.conv4 as select id from public.club_team_invites
 where club_id = t.id('clube_b') and email = 'ninguem@teste.local';
\o
select t.como('lider_b');
select t.pedir_clube('clube_b');
select t.permitido('...e revoga o convite',
  $q$select public.convite_equipe_revogar((select id from t.conv4))$q$, 0);
reset role;
select t.eq('o convite revogado sai da lista de pendentes',
  t.n($q$select count(*) from public.club_team_invites
       where club_id = t.id('clube_b') and email = 'ninguem@teste.local' and status = 'pendente'$q$), 0);

-- =============================================================================
--  6. A superfície
-- =============================================================================
select t.eq('só quem está logado convida/aceita/revoga',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('convite_equipe_criar','convite_equipe_aceitar','convite_equipe_revogar','convites_da_equipe')
         and has_function_privilege('anon', p.oid, 'execute')$q$), 0);
select t.eq('as quatro existem e são chamáveis por authenticated',
  t.n($q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('convite_equipe_criar','convite_equipe_aceitar','convite_equipe_revogar','convites_da_equipe')
         and has_function_privilege('authenticated', p.oid, 'execute')$q$), 4);

-- =============================================================================
--  7. OS CASOS DE BORDA DO CONVITE (fase 8.5, item 7)
--
--  O convite de equipe nasceu na fase 8.4 a partir de uma tabela que o onboarding usava só para
--  GUARDAR e-mails — nunca tinha sido um convite de verdade. Por isso faltavam duas coisas que a
--  tabela irmã (o convite de responsável, `club_invites`) já tinha desde a fase 5: PRAZO, e um
--  papel que a tabela de fato aceite.
-- =============================================================================

-- ---- VENCIDO: um convite sem prazo não é um convite, é uma chave ----
-- Sem prazo, a diretoria convida alguém, a pessoa não entra, passam dois anos, a diretoria mudou,
-- o clube mudou — e o link continua criando vínculo ATIVO com papel de liderança.
\o /dev/null
select t.como('lider_b'); select t.pedir_clube('clube_b');
select public.convite_equipe_criar('vencido@teste.local', 'instrutor');
reset role;
insert into t.ids (chave, id) select 'conv_vencido', id from public.club_team_invites
 where club_id = t.id('clube_b') and email = 'vencido@teste.local';
-- o relógio anda: o convite fica velho
update public.club_team_invites set expires_at = now() - interval '1 second' where id = t.id('conv_vencido');
select t.signup('convidado_vencido', jsonb_build_object('nome', 'Vencido', 'email', 'vencido@teste.local'));
\o
select t.eq('[vencido] o convite tem prazo, e ele é de 14 dias',
  t.txt($q$select ((expires_at - created_at) between interval '13 days' and interval '15 days')::text
         from public.club_team_invites where club_id = t.id('clube_b') and email = t.email('forasteiro')$q$), 'true');
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.eq('[vencido] a liderança vê a situação "vencido" na lista do clube',
  t.txt($q$select c ->> 'situacao' from json_array_elements(public.convites_do_clube()) c
         where c ->> 'email' = 'vencido@teste.local'$q$), 'vencido');
reset role;

-- ---- PAPEL: a função aceitava um papel que a TABELA recusa ----
-- `convite_equipe_criar` validava contra uma lista que incluía 'desbravador'; o CHECK da tabela
-- não. Convidar um desbravador passava pela validação e morria no CHECK, com um 23514 cru na cara
-- de quem convidou. O alinhamento foi da FUNÇÃO para a tabela, e a direção importa: este convite
-- cria vínculo ATIVO sem aprovação, o que cabe para quem a liderança avaliza pessoalmente e não
-- para uma criança, cujo cadastro existe justamente para o clube conferir quem é.
select t.como('lider_b'); select t.pedir_clube('clube_b');
select t.throws('[papel] desbravador não entra por convite de equipe — e a recusa é clara, não um erro de constraint',
  $q$select public.convite_equipe_criar('crianca@teste.local', 'desbravador')$q$, 'Papel inválido');
reset role;
-- Medido FORA da RLS, como postgres: a pergunta e "nada foi gravado em lugar nenhum", e nao "eu
-- nao consigo ver o que foi gravado" — que sao coisas diferentes e se parecem no resultado.
select t.eq('[papel] ...e nada foi gravado',
  (select count(*) from public.club_team_invites where email = 'crianca@teste.local'), 0);

-- ---- A RECUSA NÃO É UM ORÁCULO ----
-- vencido, alheio, já usado e inexistente respondem todos a MESMA coisa. Separar as mensagens
-- deixaria quem tenta ids ao acaso descobrir quais existem pela diferença no texto.
\o /dev/null
create function t.recusa_convite(p_id text) returns text language plpgsql as $$
begin execute format('select public.convite_equipe_aceitar(%L::uuid)', p_id); return 'SEM ERRO';
exception when others then return sqlstate || ':' || sqlerrm; end $$;
\o
select t.como('convidado_vencido');
select t.eq('[oráculo] convite VENCIDO responde igual a um id inexistente',
  t.txt(format($q$select t.recusa_convite(%L)$q$, t.id('conv_vencido'))),
  t.txt($q$select t.recusa_convite('11111111-2222-3333-4444-555555555555')$q$));
reset role;
select t.como('membro_a2');
select t.eq('[oráculo] convite ALHEIO responde igual a um id inexistente',
  t.txt(format($q$select t.recusa_convite(%L)$q$, t.id('conv_vencido'))),
  t.txt($q$select t.recusa_convite('11111111-2222-3333-4444-555555555555')$q$));
reset role;
select t.como('forasteiro');
select t.eq('[oráculo] convite JÁ USADO responde igual a um id inexistente',
  t.txt(format($q$select t.recusa_convite(%L)$q$, (select id from t.conv))),
  t.txt($q$select t.recusa_convite('11111111-2222-3333-4444-555555555555')$q$));
reset role;
select t.eq('[vencido] e nenhum vínculo nasceu de convite vencido',
  t.n($q$select count(*) from public.organization_memberships
       where user_id = t.id('convidado_vencido') and organizational_unit_id = t.id('clube_b')$q$), 0);

select t.fim();
rollback;
