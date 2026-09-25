-- Teste de CONTRATO (estrutural, como a matriz de auditoria): trava pra sempre que código
-- operacional novo volte a ler profiles.papel/profiles.status/profiles.unidade_id como fonte de
-- autorização, pontuação, premiação, jogos ou contexto de clube (migration 35 — limpeza final da
-- fase multi-clube). organization_memberships é a ÚNICA fonte operacional de papel/unidade/status
-- POR CLUBE; profiles continua com esses 3 campos só como ESPELHO de compatibilidade do clube
-- primário (documentado em AUDITORIA-MULTITENANT.md), nunca fonte de decisão nova.
--
-- Não varre arquivo — varre o BANCO (pg_get_functiondef/pg_get_viewdef/pg_policies), pegando o
-- texto LIVE de cada função (já com toda redefinição de migration aplicada).
--
-- ARMADILHA DESTA MIGRATION (documentada pra não se repetir): no dialeto de regex do Postgres
-- (ARE), \b é BACKSPACE literal, não limite de palavra — \y é o certo (\m/\M para início/fim de
-- palavra). \b nunca bate com nada de verdade, então um padrão tipo '\bp\.papel\b' NUNCA acusa
-- nada (falso negativo silencioso). E um padrão largo tipo 'profiles[^,;()]*\.status' sem alias
-- rastreado pode casar "profiles ... (nada a ver) ... m.status" por cima de um JOIN inteiro (falso
-- positivo). Por isso aqui: (a) sempre \y, nunca \b; (b) rastreia o APELIDO de verdade que a
-- função deu a "profiles" antes de checar esse apelido + papel/status/unidade_id.
begin;
\ir _lib.sql
\ir _fixtures.sql

create function t.exigir_alias_de_profiles(p_def text) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), '{}')
  from regexp_matches(p_def, '\mprofiles\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\M', 'gi') m
  where lower(m[1]) not in ('references','on','set','where','from','join','and','or','using','returning','into','values','select');
$$;

create function t.le_papel_operacional(p_def text) returns boolean language plpgsql immutable as $$
declare v_alias text;
begin
  if p_def ~* 'profiles\.(papel|unidade_id|status)\y' then return true; end if;
  foreach v_alias in array t.exigir_alias_de_profiles(p_def) loop
    if p_def ~* ('\y' || v_alias || '\.(papel|unidade_id|status)\y') then return true; end if;
  end loop;
  return false;
end;
$$;

-- ---------- 1) nenhuma FUNÇÃO do public lê profiles.papel/.status/.unidade_id (fora as exceções do espelho) ----------
create table t.excecoes_espelho (funcao text primary key, motivo text not null);
insert into t.excecoes_espelho values
  ('reconciliar_perfis_dos_vinculos', 'É O PRÓPRIO mecanismo do espelho: compara profiles.papel/status/unidade_id (o espelho) com o vínculo pra decidir SE precisa atualizar — não é decisão de negócio nova, é a rede de segurança do espelho em si.'),
  ('entrada_solicitar', 'migration 104: lê profiles.papel = ''pais'' só para dar ao PEDIDO pendente o papel de responsável (em vez do papel do código). Não autoriza nada — a liderança ainda aprova, e o vínculo com o filho é outro processo. profiles.papel e não o metadata do Auth porque o metadata o próprio usuário altera; o perfil ele não altera.');
select t.eq('nenhuma função pública NOVA decide autorização, pontuação, premiação, jogos ou contexto olhando profiles.papel/.status/.unidade_id (fora o mecanismo do espelho, declarado acima)',
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname not in (select funcao from t.excecoes_espelho)
     and t.le_papel_operacional(pg_get_functiondef(p.oid))), 0);

-- ---------- 2) nenhuma VIEW do public depende disso ----------
select t.eq('nenhuma view pública lê profiles.papel/.status/.unidade_id',
  (select count(*) from pg_views where schemaname = 'public' and t.le_papel_operacional(definition)), 0);

-- ---------- 3) nenhuma POLICY de RLS (em qualquer schema) depende disso ----------
select t.eq('nenhuma policy de RLS lê profiles.papel/.status/.unidade_id',
  (select count(*) from pg_policies
    where schemaname in ('public', 'storage')
      and (t.le_papel_operacional(coalesce(qual, '')) or t.le_papel_operacional(coalesce(with_check, '')))), 0);

-- ---------- 4) organization_memberships é a fonte: toda função "*_no_clube" consulta ela ----------
select t.ok('as funções de autorização por clube (pode_gerir_no_clube, membro_ativo_no_clube, pode_financeiro_no_clube) leem organization_memberships',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pode_gerir_no_clube', 'membro_ativo_no_clube', 'pode_financeiro_no_clube')
      and pg_get_functiondef(p.oid) ~* 'organization_memberships') = 3);

-- ---------- 5) defesa em profundidade: papel/status/unidade_id de profiles continuam travados por coluna ----------
-- (a prova COMPORTAMENTAL já existe em 06/09/11/22 — isto é a prova ESTRUTURAL, direto no catálogo)
select t.eq('authenticated não tem UPDATE em profiles.papel (só a RPC vinculo_gerir, via SECURITY DEFINER, grava)',
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'papel'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'), 0);
select t.eq('authenticated não tem UPDATE em profiles.status', (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'status'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'), 0);
select t.eq('authenticated não tem UPDATE em profiles.unidade_id', (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'unidade_id'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'), 0);

-- ---------- 6) toda inserção em gameplay/pontos que já sabe o clube grava club_id explícito ----------
-- (o gatilho genérico ainda ACEITA sem club_id — pra não quebrar rotina antiga — mas confere
-- vínculo quando vem explícito; aqui só confirma que os gatilhos das tabelas de jogo existem)
select t.eq('as 9 tabelas de gameplay (jogos, recordes, bichinho, bíblia, missões, devocional) usam o gatilho genérico corrigido',
  (select count(*) from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_proc p on p.oid = tg.tgfoid
   where p.proname = 'definir_club_por_usuario' and not tg.tgisinternal
     and c.relname in ('missoes_feitas', 'devocional', 'trilha_jogos', 'partidas', 'recordes',
                        'chefao_golpes', 'bichinhos', 'biblia_leituras', 'biblia_leitura_atual')), 9);
select t.eq('pontos.club_id é confirmado (não adivinhado) quando quem grava já informa o clube',
  (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
    where c.relname = 'pontos' and p.proname = 'definir_club_ponto' and not tg.tgisinternal), 1);

-- ---------- 7) o próprio mecanismo de espelho (exceções conscientes) continua existindo e coerente ----------
select t.eq('o gatilho vínculo -> perfil (o espelho) existe em organization_memberships',
  (select count(*) from pg_trigger t2 join pg_class c on c.oid = t2.tgrelid
    where c.relname = 'organization_memberships' and t2.tgname = 'trg_sync_perfil_do_vinculo' and not t2.tgisinternal), 1);
select t.eq('a reconciliação (rede de segurança do espelho) existe e é a versão NOVA (vínculo -> perfil)',
  (select count(*) from pg_proc where proname = 'reconciliar_perfis_dos_vinculos' and pronamespace = 'public'::regnamespace), 1);
select t.eq('a função antiga (perfil -> vínculo) NÃO existe mais — a direção é só uma',
  (select count(*) from pg_proc where proname = 'reconciliar_vinculos_perfis' and pronamespace = 'public'::regnamespace), 0);

select t.fim();
rollback;
