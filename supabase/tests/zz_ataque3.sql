\set ON_ERROR_STOP on
begin;
\ir _lib.sql
\ir _fixtures.sql

insert into public.billing_accounts (nome) values ('Conta do Clube B');
insert into t.ids (chave, id) select 'conta_b', id from public.billing_accounts where nome='Conta do Clube B';
insert into public.subscriptions (billing_account_id, plan_id, status, ciclo, provider_ref)
select t.id('conta_b'), p.id, 'ativa', 'mensal', 'ref_b' from public.billing_plans p where p.chave='essencial' and p.versao=1;
insert into t.ids (chave, id) select 'sub_b', id from public.subscriptions where provider_ref='ref_b';
insert into public.subscription_clubs (subscription_id, club_id) values (t.id('sub_b'), t.id('clube_b'));

\echo ''
\echo '########## A15 — CADEIA DE COLHEITA: como um diretor do clube A descobre o UUID do clube B ##########'
-- dir_a_membro_b tem vinculo ATIVO no clube A (diretoria) e no clube B (desbravador).
-- lider_a gere o clube A. _pode_ver_conquista_curricular deixa lider_a ver as conquistas
-- dessa pessoa vindas de QUALQUER clube de origem -> revela o uuid do clube B.
insert into t.ids (chave, id) select 'classe_qualquer', id from public.classes limit 1;
insert into public.curriculum_achievements (usuario_id, tipo, classe_id, club_id_origem, concluida_em)
values (t.id('dir_a_membro_b'), 'classe', t.id('classe_qualquer'), t.id('clube_b'), now());

select t.como('lider_a');
select t.pedir_clube('clube_a');
select 'lider_a ve organizational_units' as ctx, t.nv('select count(*) from public.organizational_units') as clubes_na_tabela;
select 'PASSO 1 — colher uuid alheio via curriculum_achievements' as passo,
       t.nv('select count(*) from public.curriculum_achievements where club_id_origem <> '''||t.id('clube_a')||'''') as linhas_alheias,
       t.txt('select club_id_origem::text from public.curriculum_achievements where club_id_origem <> '''||t.id('clube_a')||''' limit 1') as uuid_colhido,
       t.txt('select (club_id_origem = '''||t.id('clube_b')||''')::text from public.curriculum_achievements where club_id_origem <> '''||t.id('clube_a')||''' limit 1') as eh_o_clube_b;
select 'PASSO 2 — usar o uuid colhido em recurso_situacao' as passo,
       t.txt('select public.recurso_situacao((select club_id_origem from public.curriculum_achievements where club_id_origem <> '''||t.id('clube_a')||''' limit 1), ''classes'')::text') as retorno;
select 'PASSO 3 — vetor completo do clube colhido' as passo,
       string_agg(c.chave || '=' || (public.recurso_situacao((select club_id_origem from public.curriculum_achievements where club_id_origem <> t.id('clube_a') limit 1), c.chave) ->> 'no_plano'), ' ' order by c.chave) as vetor
from public.recursos_catalogo c;
select 'CONTROLE — o mesmo lider_a tenta ler a assinatura direto' as passo,
       t.nv('select count(*) from public.subscriptions') as subs,
       t.nv('select count(*) from public.subscription_clubs') as sub_clubs,
       t.nv('select count(*) from public.billing_accounts') as contas,
       t.nv('select count(*) from public.club_features where club_id = '''||t.id('clube_b')||'''') as features_b;

\echo ''
\echo '########## A16 — o remendo do laudo (fechar por clube) fecha mesmo? e o que SOBRA? ##########'
reset role;
create or replace function public.recurso_situacao(p_club_id uuid, p_feature text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_club_id is null or p_club_id is distinct from public.clube_atual_id() then null else
    jsonb_build_object(
      'recurso', p_feature,
      'no_plano', public.recurso_disponivel_no_plano(p_club_id, p_feature),
      'no_clube', coalesce((select enabled from public.club_features where club_id = p_club_id and feature = p_feature),
                           (select padrao from public.recursos_catalogo where chave = p_feature), false),
      'efetivo', public.recurso_habilitado_no_clube(p_club_id, p_feature)) end;
$$;
select t.como('lider_a'); select t.pedir_clube('clube_a');
select 'COM O REMENDO: lider_a -> clube B' as ctx, coalesce(t.txt('select public.recurso_situacao('''||t.id('clube_b')||''',''mural'')::text'),'<NULL>') as r;
select 'COM O REMENDO: lider_a -> proprio clube A' as ctx, coalesce(t.txt('select public.recurso_situacao('''||t.id('clube_a')||''',''mural'')::text'),'<NULL>') as r;
select 'RESIDUO 1: recurso_disponivel_no_plano(clube_B, classes) segue aberta' as ctx,
       t.txt('select public.recurso_disponivel_no_plano('''||t.id('clube_b')||''',''classes'')::text') as r;
select 'RESIDUO 1b: vetor completo pela irma, apos o remendo' as ctx,
       string_agg(c.chave||'='||public.recurso_disponivel_no_plano(t.id('clube_b'), c.chave)::text, ' ' order by c.chave) as vetor
from public.recursos_catalogo c;
select t.como('pais_a'); select t.pedir_clube('clube_a');
select 'RESIDUO 2: pais (menor privilegio) ainda le a camada comercial do PROPRIO clube' as ctx,
       coalesce(t.txt('select public.recurso_situacao('''||t.id('clube_a')||''',''mural'')::text'),'<NULL>') as r,
       t.txt('select public.membro_ativo_no_clube('''||t.id('clube_a')||''')::text') as membro_ativo,
       t.txt('select public.operacao_permitida(''mural'',''ver'')::text') as operacao_permitida_ja_entrega;

\echo ''
\echo '########## A17 — o teste 24 realmente e cego? (indices do oidvector) ##########'
reset role;
select 'recurso_situacao' as f,
       array_lower(proargtypes::oid[],1) as lb, array_upper(proargtypes::oid[],1) as ub,
       pronargs, array_length(proargtypes::oid[],1) as len,
       (proargtypes::oid[])[1]::regtype::text as tipos_1,
       coalesce((proargtypes::oid[])[2]::regtype::text,'<NULL>') as tipos_2,
       (proargtypes::oid[])[0]::regtype::text as tipos_0
from pg_proc where oid='public.recurso_situacao(uuid,text)'::regprocedure;

-- quantas funcoes com uuid o teste 24 varre DE VERDADE por posicao
create function t.chamada24(p_nome text, p_tipos oid[], p_pos int, p_alvo uuid, p_outros uuid) returns text language plpgsql as $$
declare j int; v_args text[] := '{}'; v_tipo text;
begin
  for j in 1..coalesce(array_length(p_tipos, 1), 0) loop
    v_tipo := p_tipos[j]::regtype::text;
    v_args := v_args || case
      when j = p_pos then format('%L::uuid', p_alvo)
      when v_tipo = 'uuid' then format('%L::uuid', p_outros)
      when v_tipo = 'text' then quote_literal('x')
      when v_tipo = 'integer' then '1'
      when v_tipo = 'boolean' then 'true'
      when v_tipo = 'jsonb' then '''{}''::jsonb'
      when v_tipo = 'uuid[]' then '''{}''::uuid[]'
      else null end;
    if v_args[j] is null then return null; end if;
  end loop;
  return format('select (public.%I(%s))::text', p_nome, array_to_string(v_args, ', '));
end $$;

select f.pronargs as n_args,
       count(*) filter (where f.sql is not null) as chamadas_montadas,
       count(*) filter (where f.sql is not null and f.valida) as chamadas_com_TIPOS_CERTOS,
       count(*) filter (where f.sql is not null and not f.valida) as chamadas_com_ARGUMENTOS_TROCADOS
from (
  select pr.proname, pr.pronargs, i,
         t.chamada24(pr.proname, pr.proargtypes::oid[], i, '11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid) as sql,
         -- valida = a posicao i (1-based REAL) e mesmo uuid
         ((string_to_array(pg_get_function_identity_arguments(pr.oid), ', '))[i] like '% uuid') as valida
  from pg_proc pr, generate_series(1,10) i
  where pr.pronamespace='public'::regnamespace and pr.prokind='f' and not pr.proretset
    and pr.prorettype <> 'trigger'::regtype and i <= pr.pronargs
    and 'uuid'::regtype::oid = any (pr.proargtypes::oid[])
    and has_function_privilege('authenticated', pr.oid, 'execute')
    and not (coalesce(pr.proargtypes::oid[])[i] is not distinct from null and false)
) f
group by f.pronargs order by 1;

-- a chamada que o teste 24 monta HOJE para recurso_situacao
select 'SQL que o teste 24 monta para recurso_situacao, arg 2' as ctx,
       t.chamada24('recurso_situacao', (select proargtypes::oid[] from pg_proc where oid='public.recurso_situacao(uuid,text)'::regprocedure), 2,
                   '11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid) as sql_montado;
select 'e o arg 1?' as ctx,
       coalesce(t.chamada24('recurso_situacao', (select proargtypes::oid[] from pg_proc where oid='public.recurso_situacao(uuid,text)'::regprocedure), 1,
                   '11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid),'<pulado pelo continue: tipos[1] = text>') as sql_montado;

select t.fim();
rollback;
