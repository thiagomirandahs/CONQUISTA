\set ON_ERROR_STOP on
begin;
\ir _lib.sql
\ir _fixtures.sql

insert into public.billing_accounts (nome) values ('Conta do Clube B');
insert into t.ids (chave, id) select 'conta_b', id from public.billing_accounts where nome='Conta do Clube B';
insert into public.subscriptions (billing_account_id, plan_id, status, ciclo, provider_ref)
select t.id('conta_b'), p.id, 'ativa','mensal','ref_b' from public.billing_plans p where p.chave='essencial' and p.versao=1;
insert into t.ids (chave, id) select 'sub_b', id from public.subscriptions where provider_ref='ref_b';
insert into public.subscription_clubs (subscription_id, club_id) values (t.id('sub_b'), t.id('clube_b'));
select t.signup('forasteiro','{"nome":"Forasteiro"}'::jsonb);

create function t.vetor(p_alvo uuid) returns text language sql security definer set search_path='' as $$
  select string_agg(case (public.recurso_situacao(p_alvo, c.chave) ->> 'no_plano') when 'true' then '1' else '0' end, '' order by c.chave)
  from public.recursos_catalogo c;
$$;

\echo ''
\echo '########## A18 — que planos o vetor distingue? (colisoes) ##########'
do $$
declare r record; v text;
begin
  for r in select id, chave, versao, coalesce(array_length(recursos,1),-1) as n from public.billing_plans order by chave, versao loop
    update public.subscriptions set plan_id = r.id, status='ativa' where id = t.id('sub_b');
    perform t.como('forasteiro'); v := t.txt('select t.vetor('''||t.id('clube_b')||''')'); reset role;
    insert into t.res (nome, ok, detalhe) values ('plano '||r.chave||' v'||r.versao, true, v);
  end loop;
  update public.subscriptions set status='suspensa' where id = t.id('sub_b');
  perform t.como('forasteiro'); v := t.txt('select t.vetor('''||t.id('clube_b')||''')'); reset role;
  insert into t.res (nome, ok, detalhe) values ('QUALQUER plano SUSPENSO/CANCELADO', true, v);
  perform t.como('forasteiro');
  v := t.txt('select t.vetor('''||t.id('clube_a')||''')'); reset role;
  insert into t.res (nome, ok, detalhe) values ('clube SEM assinatura (clube A)', true, v);
  perform t.como('forasteiro');
  v := t.txt('select t.vetor(''11111111-1111-1111-1111-111111111111'')'); reset role;
  insert into t.res (nome, ok, detalhe) values ('UUID INEXISTENTE (fail-open)', true, v);
  update public.subscriptions set status='ativa' where id = t.id('sub_b');
end $$;
select nome as alvo, detalhe as impressao_digital_no_plano from t.res order by id;
delete from t.res;

\echo ''
\echo '########## A17b — cobertura REAL da varredura do teste 24 ##########'
create function t.chamada24(p_nome text, p_tipos oid[], p_pos int, p_alvo uuid, p_outros uuid) returns text language plpgsql as $$
declare j int; v_args text[] := '{}'; v_tipo text;
begin
  for j in 1..coalesce(array_length(p_tipos,1),0) loop
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
  return format('select (public.%I(%s))::text', p_nome, array_to_string(v_args,', '));
end $$;

create view t.cobertura as
select pr.proname, pr.pronargs, i,
       -- o "continue when tipos[i] <> uuid" do teste 24, com o oidvector de lower bound 0:
       (((pr.proargtypes::oid[])[i] is distinct from 'uuid'::regtype::oid)
         and ((pr.proargtypes::oid[])[i] is not null)) as pulado_pelo_continue,
       t.chamada24(pr.proname, pr.proargtypes::oid[], i,
                   '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') as sql_montado,
       -- posicao i REAL (1-based) e de fato uuid?
       ((string_to_array(pg_get_function_identity_arguments(pr.oid), ', '))[i] like '%uuid') as posicao_i_eh_uuid
from pg_proc pr, generate_series(1,12) i
where pr.pronamespace='public'::regnamespace and pr.prokind='f' and not pr.proretset
  and pr.prorettype <> 'trigger'::regtype and i <= pr.pronargs
  and 'uuid'::regtype::oid = any (pr.proargtypes::oid[])
  and has_function_privilege('authenticated', pr.oid, 'execute');

select case when pronargs = 1 then '1 argumento' else '2+ argumentos' end as familia,
       count(*) filter (where posicao_i_eh_uuid) as posicoes_uuid_que_deveriam_ser_sondadas,
       count(*) filter (where posicao_i_eh_uuid and not pulado_pelo_continue and sql_montado is not null) as de_fato_sondadas,
       count(*) filter (where posicao_i_eh_uuid and (pulado_pelo_continue or sql_montado is null)) as NUNCA_sondadas
from t.cobertura group by 1 order by 1;

select 'funcoes com uuid no 1o argumento e 2+ args que a varredura NUNCA sonda' as ctx,
       count(distinct proname) as n
from t.cobertura where i = 1 and posicao_i_eh_uuid and pronargs >= 2 and (pulado_pelo_continue or sql_montado is null);

select proname, pronargs, i as posicao, coalesce(sql_montado,'<nao montou>') as sql_que_o_teste_24_roda
from t.cobertura
where proname in ('recurso_situacao','recurso_disponivel_no_plano','_experiencia_no_publico','dependencias_pendentes','unidade_ancestral','especialidade_ja_concluida_pela_pessoa','membro_ativo_no_clube')
order by proname, i;

select t.fim();
rollback;
