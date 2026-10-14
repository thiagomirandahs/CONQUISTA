-- ALTERA O BANCO. Aplicar somente após validar o PR e confirmar backup recuperável.
-- Pacote atômico das migrations 548 e 549; mantém seu registro no ledger do app.
-- Não cria MFA nem publica frontend/Edge. Nenhuma credencial é necessária neste arquivo.
begin;

-- 548 — Auditoria da superfície sem login (14/10/2026).
-- Reduz abuso das RPCs públicas, inclusive chamadas com códigos válidos.
-- Nenhum dado interno é tornado público; mantém verificação e vitrine previstas.
create table if not exists public.anon_rpc_cotas (
  servico text not null,
  origem_hash text not null,
  janela timestamptz not null,
  chamadas int not null check (chamadas > 0),
  primary key(servico, origem_hash, janela)
);
alter table public.anon_rpc_cotas enable row level security;
revoke all on public.anon_rpc_cotas from public, anon, authenticated;

-- Contadores atômicos substituem a suposição de que COUNT+INSERT serializa requisições.
-- A origem é a derivação já usada pela aplicação. O teto global independe de IP falsificado.
create or replace function public._anon_rpc_consumir(p_servico text,p_origem_limite int,p_global_limite int) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_janela timestamptz := to_timestamp(floor(extract(epoch from now())/600)*600);
        v_origem text := public._entrada_origem(); v_n int;
begin
  if auth.uid() is not null then return true; end if;
  insert into public.anon_rpc_cotas as c(servico,origem_hash,janela,chamadas)
    values(p_servico,'global',v_janela,1)
    on conflict(servico,origem_hash,janela) do update set chamadas=c.chamadas+1
      where c.chamadas < p_global_limite returning chamadas into v_n;
  if v_n is null then return false; end if;
  v_n := null;
  insert into public.anon_rpc_cotas as c(servico,origem_hash,janela,chamadas)
    values(p_servico,v_origem,v_janela,1)
    on conflict(servico,origem_hash,janela) do update set chamadas=c.chamadas+1
      where c.chamadas < p_origem_limite returning chamadas into v_n;
  if random()<0.02 then delete from public.anon_rpc_cotas where janela<now()-interval '1 day'; end if;
  return v_n is not null;
end $$;
revoke all on function public._anon_rpc_consumir(text,int,int) from public,anon,authenticated,service_role;

do $$ begin
  if to_regprocedure('public._anon_548_entrada_abrir_publico(text)') is null then
    alter function public.entrada_abrir_publico(text) rename to _anon_548_entrada_abrir_publico;
  end if;
end $$;
revoke all on function public._anon_548_entrada_abrir_publico(text) from public,anon,authenticated,service_role;
create or replace function public.entrada_abrir_publico(p_codigo text) returns json
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('entrada',120,5000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  if p_codigo is null or octet_length(p_codigo)>256 then return jsonb_build_object('encontrado',false)::json; end if;
  return public._anon_548_entrada_abrir_publico(p_codigo);
end $$;
revoke all on function public.entrada_abrir_publico(text) from public;
grant execute on function public.entrada_abrir_publico(text) to anon,authenticated;

do $$ begin
  if to_regprocedure('public._anon_548_convite_hierarquia_abrir(text)') is null then
    alter function public.convite_hierarquia_abrir(text) rename to _anon_548_convite_hierarquia_abrir;
  end if;
end $$;
revoke all on function public._anon_548_convite_hierarquia_abrir(text) from public,anon,authenticated,service_role;
create or replace function public.convite_hierarquia_abrir(p_token text) returns json
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('convite',120,5000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  if p_token is null or octet_length(p_token)>256 then return jsonb_build_object('encontrado',false)::json; end if;
  return public._anon_548_convite_hierarquia_abrir(p_token);
end $$;
revoke all on function public.convite_hierarquia_abrir(text) from public;
grant execute on function public.convite_hierarquia_abrir(text) to anon,authenticated;

do $$ begin
  if to_regprocedure('public._anon_548_documento_verificar(text)') is null then
    alter function public.documento_verificar(text) rename to _anon_548_documento_verificar;
  end if;
end $$;
revoke all on function public._anon_548_documento_verificar(text) from public,anon,authenticated,service_role;
create or replace function public.documento_verificar(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('documento',120,5000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  if p_token is null or octet_length(p_token)>256 then return jsonb_build_object('encontrado',false)::jsonb; end if;
  return public._anon_548_documento_verificar(p_token);
end $$;
revoke all on function public.documento_verificar(text) from public;
grant execute on function public.documento_verificar(text) to anon,authenticated;

do $$ begin
  if to_regprocedure('public._anon_548_vitrine_clube_publico(text)') is null then
    alter function public.vitrine_clube_publico(text) rename to _anon_548_vitrine_clube_publico;
  end if;
end $$;
revoke all on function public._anon_548_vitrine_clube_publico(text) from public,anon,authenticated,service_role;
create or replace function public.vitrine_clube_publico(p_slug text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('vitrine',300,10000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  if p_slug is null or octet_length(p_slug)>256 then return jsonb_build_object('encontrado',false)::jsonb; end if;
  return public._anon_548_vitrine_clube_publico(p_slug);
end $$;
revoke all on function public.vitrine_clube_publico(text) from public;
grant execute on function public.vitrine_clube_publico(text) to anon,authenticated;

do $$ begin
  if to_regprocedure('public._anon_548_vitrine_clubes_publico()') is null then
    alter function public.vitrine_clubes_publico() rename to _anon_548_vitrine_clubes_publico;
  end if;
end $$;
revoke all on function public._anon_548_vitrine_clubes_publico() from public,anon,authenticated,service_role;
create or replace function public.vitrine_clubes_publico() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('vitrine',300,10000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  return public._anon_548_vitrine_clubes_publico();
end $$;
revoke all on function public.vitrine_clubes_publico() from public;
grant execute on function public.vitrine_clubes_publico() to anon,authenticated;

do $$ begin
  if to_regprocedure('public._anon_548_parceiros_publico()') is null then
    alter function public.parceiros_publico() rename to _anon_548_parceiros_publico;
  end if;
end $$;
revoke all on function public._anon_548_parceiros_publico() from public,anon,authenticated,service_role;
create or replace function public.parceiros_publico() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('vitrine',300,10000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  return public._anon_548_parceiros_publico();
end $$;
revoke all on function public.parceiros_publico() from public;
grant execute on function public.parceiros_publico() to anon,authenticated;

do $$ begin
  if to_regprocedure('public._anon_548_planos_disponiveis()') is null then
    alter function public.planos_disponiveis() rename to _anon_548_planos_disponiveis;
  end if;
end $$;
revoke all on function public._anon_548_planos_disponiveis() from public,anon,authenticated,service_role;
create or replace function public.planos_disponiveis() returns json
language plpgsql security definer set search_path='' as $$
begin
  if not public._anon_rpc_consumir('planos',300,10000) then
    raise exception 'Muitas consultas. Espere alguns minutos e tente de novo.' using errcode='P0001';
  end if;
  return public._anon_548_planos_disponiveis();
end $$;
revoke all on function public.planos_disponiveis() from public;
grant execute on function public.planos_disponiveis() to anon,authenticated;

-- Métricas não aceitam a declaração do navegador como prova de login.
do $$ begin
  if to_regprocedure('public._anon_548_metrica_registrar(uuid,text,boolean,boolean)') is null then
    alter function public.metrica_registrar(uuid,text,boolean,boolean) rename to _anon_548_metrica_registrar;
  end if;
end $$;
revoke all on function public._anon_548_metrica_registrar(uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
create or replace function public.metrica_registrar(p_sessao uuid,p_origem text,p_pagina boolean default false,p_logado boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_sessao is null or p_origem is null or p_origem not in ('site','app','apk') then return; end if;
  if not public._anon_rpc_consumir('metrica',1200,12000) then return; end if;
  -- Serializa o teto de sessões NOVAS por minuto da implementação existente.
  perform pg_catalog.pg_advisory_xact_lock(548545);
  perform public._anon_548_metrica_registrar(p_sessao,p_origem,p_pagina,auth.uid() is not null);
end $$;
revoke all on function public.metrica_registrar(uuid,text,boolean,boolean) from public;
grant execute on function public.metrica_registrar(uuid,text,boolean,boolean) to anon,authenticated;

-- Lista fechada de RPCs públicas. Promoção é opcional (PR de pagamentos independente).
-- Não altera privilégios de authenticated/service_role nem rotinas pertencentes a extensões.
do $$
declare f record;
        permitidas text[] := array['public.documento_verificar(text)','public.entrada_abrir_publico(text)',
          'public.convite_hierarquia_abrir(text)','public.vitrine_clubes_publico()',
          'public.vitrine_clube_publico(text)','public.parceiros_publico()',
          'public.planos_disponiveis()','public.manutencao_estado()',
          'public.metrica_registrar(uuid,text,boolean,boolean)','public.licenca_promocao_situacao()'];
        assinatura text;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
      and d.objid=p.oid and d.deptype='e')
  loop
    execute format('revoke execute on function %s from public,anon',f.assinatura);
  end loop;
  foreach assinatura in array permitidas loop
    if to_regprocedure(assinatura) is not null then
      execute format('grant execute on function %s to anon',to_regprocedure(assinatura));
    end if;
  end loop;
end $$;
-- Nenhuma tabela operacional precisa de leitura/gravação anônima direta.
revoke all on all tables in schema public from public,anon;
revoke all on all sequences in schema public from public,anon;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
select public._manutencao_instalar_guarda();
insert into public.migracoes_aplicadas(arquivo) values('2026-10-14-auditoria-superficie-anonima.sql') on conflict(arquivo) do nothing;
notify pgrst,'reload schema';

-- 549 — Validade de autoridade e isolamento de operações sensíveis.
-- Preserva as alterações dinâmicas de permissões/auditoria/histórico anteriores.
-- Clientes da API não precisam criar objetos na superfície pública do banco.
revoke create on schema public from public,anon,authenticated;
do $$ begin
  if to_regprocedure('public._seg549_excluir_usuario(uuid)') is null then
    alter function public.excluir_usuario(uuid) rename to _seg549_excluir_usuario;
  end if;
  if to_regprocedure('public._seg549_rejeitar_vinculo(uuid)') is null then
    alter function public.rejeitar_vinculo(uuid) rename to _seg549_rejeitar_vinculo;
  end if;
end $$;
revoke all on function public._seg549_excluir_usuario(uuid) from public,anon,authenticated,service_role;
revoke all on function public._seg549_rejeitar_vinculo(uuid) from public,anon,authenticated,service_role;

create or replace function public.excluir_usuario(p_id uuid) returns json
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.clube_atual_id() is null or not public.pode_administrar_clube(public.clube_atual_id()) then
    raise exception 'Só a diretoria com vínculo vigente pode excluir usuários.';
  end if;
  if not public._tem_vinculo(p_id,public.clube_atual_id(),false) then
    raise exception 'Só a diretoria do clube desta pessoa pode excluir usuários.';
  end if;
  -- Não revela responsabilidade global de um UUID alheio: checa vínculo primeiro.
  if exists(select 1 from public.platform_admins where user_id=p_id) then
    raise exception 'Esta conta tem responsabilidades fora do clube. Desative o vínculo em vez de excluir a conta.';
  end if;
  return public._seg549_excluir_usuario(p_id);
end $$;
revoke all on function public.excluir_usuario(uuid) from public,anon;
grant execute on function public.excluir_usuario(uuid) to authenticated;

create or replace function public.rejeitar_vinculo(p_id uuid) returns json
language plpgsql security definer set search_path='' as $$
declare v_club uuid;
begin
  select club_id into v_club from public.responsaveis where id=p_id;
  if v_club is null or v_club is distinct from public.clube_atual_id() or not public.pode_administrar_clube(v_club) then
    raise exception 'Só a diretoria do clube em uso com vínculo vigente.';
  end if;
  return public._seg549_rejeitar_vinculo(p_id);
end $$;
revoke all on function public.rejeitar_vinculo(uuid) from public,anon;
grant execute on function public.rejeitar_vinculo(uuid) to authenticated;

-- Não notifica quem está fora da validade do vínculo, ainda que status seja ativo.
create or replace function public._push_publico(p_club_id uuid,p_para text,p_para_usuario uuid)
returns setof uuid language sql stable security definer set search_path='' as $$
  select m.user_id from public.organization_memberships m
  where p_club_id is not null and m.organizational_unit_id=p_club_id and m.status='ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    and ((p_para_usuario is not null and m.user_id=p_para_usuario)
      or (p_para_usuario is null and p_para='lideranca' and m.role in ('instrutor','diretoria'))
      or (p_para_usuario is null and p_para='todos' and m.role<>'pais'));
$$;
revoke all on function public._push_publico(uuid,text,uuid) from public,anon,authenticated;

-- Corrige a definição VIVA do suporte, sem apagar ajustes feitos depois da migration 290.
do $$
declare original text; corrigido text;
begin
  original := pg_get_functiondef('public.suporte_chamado_abrir(text,text,text,text,text,jsonb)'::regprocedure);
  if original not like '%pg_advisory_xact_lock(549,%' then
    corrigido := replace(original,
      '  -- limite: 5 chamados abertos por pessoa em 24h',
      E'  -- Serializa chamadas da mesma conta antes de contar tickets.\n  perform pg_catalog.pg_advisory_xact_lock(549,pg_catalog.hashtext(v_uid::text));\n  -- limite: 5 chamados abertos por pessoa em 24h');
    if corrigido=original then raise exception 'Ponto de correção do limite de suporte não encontrado.'; end if;
    execute corrigido;
  end if;
end $$;
do $$
declare original text; corrigido text;
begin
  original := pg_get_functiondef('public.suporte_chamado_abrir(text,text,text,text,text,jsonb)'::regprocedure);
  if original like '%m.status = ''ativo'' and m.role = ''diretoria''%' then
    corrigido := replace(original,
      'm.status = ''ativo'' and m.role = ''diretoria''',
      'm.status = ''ativo'' and m.role = ''diretoria'' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())');
    execute corrigido;
  elsif original not like '%public.pode_administrar_clube(%' and original not like '%m.ends_at > now()%' then
    raise exception 'Checagem da prioridade de suporte não encontrada.';
  end if;
end $$;
insert into public.migracoes_aplicadas(arquivo) values('2026-10-14-autoridade-vigente-e-protecao-dados.sql') on conflict(arquivo) do nothing;
notify pgrst,'reload schema';

commit;
