-- =====================================================================
-- DesbravaClube — Correções multi-tenant 1/5: papéis, vínculos, cadastro e escopo legado
--
-- Aplicar depois de 20260921000012. Idempotente. Ordem de rollout (produção é
-- manual): ver supabase/ROLLOUT-CORRECOES-MULTITENANT.md.
--
-- O QUE CORRIGE
--  * Papel "pais" (responsável) deixa de contar como "membro do clube": novos
--    helpers separam membro de responsável. Vocabulário único: 'responsavel' -> 'pais'.
--  * Cadastro comum (handle_new_user) agora cria VÍNCULO pendente no clube certo; a
--    diretoria daquele clube o enxerga, aprova (update do status do perfil) e o
--    vínculo acompanha (perfil -> vínculo, sempre). Um clube por pessoa.
--  * pode_gerir()/pode_aprovar()/eh_membro_ativo()/eh_financeiro() eram GLOBAIS
--    (profiles.papel, sem clube). Passam a valer para o clube LEGADO (Tenant 001):
--    tudo que ainda não foi tenantizado (leilão, jogos, missões, chat, duelos,
--    config_clube...) fica fechado para qualquer outro clube (falha fechada).
--  * ACL: as default ACLs do Supabase davam EXECUTE a anon em toda função nova.
--    Revoga de PUBLIC/anon e conserta o cadastro público (anon lê as unidades do
--    clube legado: a policy precisa executar clube_legado_id()).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Convites: colunas usadas pelo cadastro (uso e revogação rastreáveis)
-- ---------------------------------------------------------------------
alter table public.club_invites add column if not exists revoked_at timestamptz;
alter table public.club_invites add column if not exists used_by uuid references public.profiles(id) on delete set null;
alter table public.club_invites add column if not exists revoked_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- 1) Vocabulário de papéis: 'responsavel' vira 'pais'
-- ---------------------------------------------------------------------
update public.organization_memberships set role = 'pais' where role = 'responsavel';
alter table public.organization_memberships drop constraint if exists organization_memberships_role_valido;
alter table public.organization_memberships add constraint organization_memberships_role_valido
  check (role in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais'));

-- Tradução perfil -> vínculo (uma só fonte, usada pelo gatilho e pela reconciliação)
create or replace function public._papel_do_vinculo(p_papel text) returns text
language sql immutable set search_path = '' as $$
  select case when p_papel in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais')
              then p_papel else 'desbravador' end;
$$;
create or replace function public._status_do_vinculo(p_status text) returns text
language sql immutable set search_path = '' as $$
  select case p_status when 'ativo' then 'ativo' when 'pendente' then 'pendente'
                       when 'rejeitado' then 'encerrado' else 'suspenso' end;
$$;

-- ---------------------------------------------------------------------
-- 2) Helpers de clube
-- ---------------------------------------------------------------------
-- Clube (tipo 'clube') a que a pessoa pertence: vínculo pendente/ativo. INTERNA.
create or replace function public.clube_do_usuario(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organizational_unit_id
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = p_user_id
    and m.status in ('pendente', 'ativo')
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by (m.status = 'ativo') desc, m.starts_at, m.created_at
  limit 1;
$$;

-- Clube do chamador (vínculo ATIVO). Só clubes: vínculos em igreja/campo não entram.
create or replace function public.clube_atual_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organizational_unit_id
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = auth.uid() and m.status = 'ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at
  limit 1;
$$;

-- MEMBRO ativo do clube = qualquer papel MENOS 'pais'. É o que dá acesso aos dados
-- do clube; o responsável só entra pelo portal "Meus Filhos" (RPC).
create or replace function public.membro_ativo_no_clube(p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
      and m.role <> 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
$$;

-- Clube da pessoa mesmo quando ela está DESATIVADA/rejeitada (vínculo suspenso/encerrado): a
-- liderança do clube precisa continuar enxergando, reativando, redefinindo a senha e excluindo.
-- Vínculo pendente/ativo tem prioridade; senão vale o mais recente. INTERNA.
create or replace function public.clube_vinculo_do_usuario(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organizational_unit_id
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = p_user_id
  order by (m.status in ('pendente', 'ativo') and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) desc,
           m.created_at desc
  limit 1;
$$;

-- Liderança (instrutor/diretoria) do clube da pessoa-alvo (inclui pessoa desativada/rejeitada
-- do PRÓPRIO clube; quem já mudou para outro clube deixa de ser gerida pelo clube antigo).
create or replace function public.lideranca_gere_usuario(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(public.clube_vinculo_do_usuario(p_user_id));
$$;

-- Mesma regra para pasta do storage ("<uuid do dono>/arquivo"); nome que não é uuid = false.
create or replace function public.lideranca_gere_pasta(p_pasta text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_pasta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.lideranca_gere_usuario(p_pasta::uuid) else false end;
$$;

-- Colega de clube visível para um MEMBRO: alvo ativo e que não seja responsável.
create or replace function public.compartilha_clube_com(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_memberships eu
    join public.organization_memberships alvo on alvo.organizational_unit_id = eu.organizational_unit_id
    where eu.user_id = auth.uid() and alvo.user_id = p_user_id
      and eu.role <> 'pais' and eu.status = 'ativo'
      and alvo.role <> 'pais' and alvo.status = 'ativo'
      and eu.starts_at <= now() and (eu.ends_at is null or eu.ends_at > now())
      and alvo.starts_at <= now() and (alvo.ends_at is null or alvo.ends_at > now())
  );
$$;

-- Financeiro do clube: tesoureiro ou diretoria.
create or replace function public.pode_financeiro_no_clube(p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = p_club_id
      and m.role in ('tesoureiro', 'diretoria') and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
$$;

-- ---------------------------------------------------------------------
-- 3) Helpers LEGADOS: eram globais (profiles.papel) -> agora valem para o Tenant 001.
--    Tudo que usa pode_gerir()/eh_membro_ativo()... e ainda não foi tenantizado fica
--    fechado para outros clubes até ser migrado (leilão, jogos, missões, chat...).
-- ---------------------------------------------------------------------
create or replace function public.pode_gerir() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(public.clube_legado_id());
$$;
create or replace function public.pode_aprovar() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(public.clube_legado_id());
$$;
create or replace function public.eh_membro_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.membro_ativo_no_clube(public.clube_legado_id());
$$;
create or replace function public.eh_financeiro() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_financeiro_no_clube(public.clube_legado_id());
$$;

-- Apontar presença/pontos de uma pessoa: liderança do clube DELA, ou o conselheiro da
-- mesma unidade (ambos membros ativos do mesmo clube). Já é por clube (não legado).
create or replace function public.pode_apontar(alvo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(public.clube_do_usuario(alvo))
      or exists (
        select 1 from public.profiles eu
        join public.profiles d on d.unidade_id = eu.unidade_id
        where eu.id = auth.uid() and eu.papel = 'conselheiro' and eu.status = 'ativo'
          and d.id = alvo and d.papel = 'desbravador'
          and public.membro_ativo_no_clube(public.clube_do_usuario(alvo))
      );
$$;

-- ---------------------------------------------------------------------
-- 4) Um clube por pessoa (evita a ambiguidade de "qual é o meu clube")
-- ---------------------------------------------------------------------
create or replace function public.um_clube_por_pessoa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('pendente', 'ativo') and (new.ends_at is null or new.ends_at > now())
     and exists (select 1 from public.organizational_units u where u.id = new.organizational_unit_id and u.type = 'clube')
     and exists (
       select 1 from public.organization_memberships o
       join public.organizational_units ou on ou.id = o.organizational_unit_id and ou.type = 'clube'
       where o.user_id = new.user_id and o.id <> new.id
         and o.organizational_unit_id <> new.organizational_unit_id
         and o.status in ('pendente', 'ativo') and (o.ends_at is null or o.ends_at > now())
     ) then
    raise exception 'Esta pessoa já pertence a outro clube. Encerre o vínculo anterior antes de criar outro.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_um_clube_por_pessoa on public.organization_memberships;
create trigger trg_um_clube_por_pessoa
before insert or update of status, organizational_unit_id, ends_at, user_id on public.organization_memberships
for each row execute function public.um_clube_por_pessoa();

-- A unidade do perfil tem que ser do MESMO clube da pessoa.
create or replace function public.valida_unidade_do_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_unit_club uuid; v_user_club uuid;
begin
  if new.unidade_id is null then return new; end if;
  select club_id into v_unit_club from public.unidades where id = new.unidade_id;
  v_user_club := coalesce(nullif(current_setting('app.signup_club', true), '')::uuid, public.clube_do_usuario(new.id));
  if v_user_club is not null and v_unit_club is distinct from v_user_club then
    raise exception 'A unidade escolhida pertence a outro clube.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_valida_unidade_perfil on public.profiles;
create trigger trg_valida_unidade_perfil
before insert or update of unidade_id on public.profiles
for each row execute function public.valida_unidade_do_perfil();

-- ---------------------------------------------------------------------
-- 5) Perfil -> vínculo (sempre nessa direção). Cria o vínculo no cadastro e o mantém
--    alinhado quando a liderança aprova, rejeita, desativa ou muda o cargo.
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_vinculo_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public._papel_do_vinculo(new.papel);
  v_status text := public._status_do_vinculo(new.status);
  v_signup text := nullif(current_setting('app.signup_club', true), '');
  v_row uuid; v_club uuid;
begin
  select m.id, m.organizational_unit_id into v_row, v_club
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = new.id
  order by (m.status in ('pendente', 'ativo')) desc, m.created_at desc
  limit 1;

  if v_row is null then
    v_club := coalesce(v_signup::uuid, (select club_id from public.unidades where id = new.unidade_id), public.clube_legado_id());
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, v_role, v_status,
            jsonb_build_object('source', case when v_signup is not null then 'cadastro' else 'sincronia-perfil' end));
  else
    update public.organization_memberships
       set role = v_role, status = v_status, updated_at = now()
     where id = v_row and (role is distinct from v_role or status is distinct from v_status);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_00_sync_vinculo_perfil on public.profiles;
create trigger trg_00_sync_vinculo_perfil
after insert or update of papel, status on public.profiles
for each row execute function public.sincronizar_vinculo_perfil();

-- Rede de segurança (roda ao final desta migration e pode ser rodada sempre):
-- corrige perfil sem vínculo e vínculo fora de compasso com o perfil. Devolve o nº de ajustes.
create or replace function public.reconciliar_vinculos_perfis() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_criados int := 0; v_alinhados int := 0;
begin
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  select p.id,
         coalesce((select u.club_id from public.unidades u where u.id = p.unidade_id), public.clube_legado_id()),
         public._papel_do_vinculo(p.papel), public._status_do_vinculo(p.status),
         '{"source":"reconciliacao"}'::jsonb
  from public.profiles p
  where not exists (
    select 1 from public.organization_memberships m
    join public.organizational_units ou on ou.id = m.organizational_unit_id and ou.type = 'clube'
    where m.user_id = p.id);
  get diagnostics v_criados = row_count;

  with atual as (
    select distinct on (m.user_id) m.id, m.user_id
    from public.organization_memberships m
    join public.organizational_units ou on ou.id = m.organizational_unit_id and ou.type = 'clube'
    order by m.user_id, (m.status in ('pendente', 'ativo')) desc, m.created_at desc
  )
  update public.organization_memberships m
     set role = public._papel_do_vinculo(p.papel), status = public._status_do_vinculo(p.status), updated_at = now()
    from atual a join public.profiles p on p.id = a.user_id
   where m.id = a.id
     and (m.role is distinct from public._papel_do_vinculo(p.papel)
          or m.status is distinct from public._status_do_vinculo(p.status));
  get diagnostics v_alinhados = row_count;
  return v_criados + v_alinhados;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) Cadastro (auth.users -> perfil). Membro: perfil PENDENTE + vínculo pendente no
--    clube da unidade escolhida (sem unidade = clube legado, que é o cadastro público
--    de hoje). Responsável: só com convite válido (1 uso, não revogado, não expirado).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tipo text := v_meta->>'tipo';
  v_token text := v_meta->>'convite_responsavel';
  v_inv public.club_invites;
  v_unidade uuid;
  v_club uuid;
begin
  if v_tipo = 'pais' then
    if coalesce(v_token, '') = '' then raise exception 'Cadastro de responsável exige convite do clube.'; end if;
    select * into v_inv from public.club_invites
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and revoked_at is null and expires_at > now()
     for update;
    if v_inv.id is null then raise exception 'Convite inválido, usado, revogado ou expirado.'; end if;
    perform set_config('app.signup_club', v_inv.club_id::text, true);
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'pais', 'ativo');
    update public.club_invites set used_at = now(), used_by = new.id where id = v_inv.id;
  else
    v_unidade := nullif(v_meta->>'unidade_id', '')::uuid;
    if v_unidade is not null then
      select club_id into v_club from public.unidades where id = v_unidade;
      if v_club is null then raise exception 'Unidade inválida.'; end if;
    else
      v_club := public.clube_legado_id();
    end if;
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, nascimento, unidade_id, cargo, papel, status)
    values (new.id, v_meta->>'nome', (nullif(v_meta->>'nascimento', ''))::date, v_unidade,
            v_meta->>'cargo', 'desbravador', 'pendente');
  end if;
  perform set_config('app.signup_club', '', true);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 7) Perfil: quem pode ler, editar e promover
-- ---------------------------------------------------------------------
create or replace function public.protege_campos_perfil() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- ninguém muda o PRÓPRIO papel/status (nem a liderança): evita auto-promoção
  if new.id = auth.uid() then
    new.papel := old.papel; new.status := old.status;
  end if;
  -- fora da liderança do clube dessa pessoa, campos sensíveis não mudam
  if not public.lideranca_gere_usuario(old.id) then
    new.papel := old.papel; new.cargo := old.cargo; new.status := old.status; new.unidade_id := old.unidade_id;
  end if;
  return new;
end;
$$;

drop policy if exists "usuario le perfis do proprio clube" on public.profiles;
create policy "usuario le perfis do proprio clube" on public.profiles for select to authenticated
using (id = auth.uid() or public.compartilha_clube_com(id) or public.lideranca_gere_usuario(id));

drop policy if exists "lideranca atualiza perfis do proprio clube" on public.profiles;
create policy "lideranca atualiza perfis do proprio clube" on public.profiles for update to authenticated
using (public.lideranca_gere_usuario(id))
with check (public.lideranca_gere_usuario(id));

-- ---------------------------------------------------------------------
-- 8) ACL: EXECUTE só para quem precisa
-- ---------------------------------------------------------------------
-- Antes de tirar PUBLIC/anon, torna EXPLÍCITO o acesso que authenticated/service_role já têm hoje
-- (uma função que só tinha acesso "via PUBLIC" não pode deixar de funcionar para quem está logado).
-- Só o que já é chamável é regravado: o que foi revogado de propósito (cron, núcleo do leilão...)
-- continua fechado, mesmo se esta migration for reaplicada.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as svc_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    if r.auth_ok then execute format('grant execute on function %s to authenticated', r.f); end if;
    if r.svc_ok then execute format('grant execute on function %s to service_role', r.f); end if;
  end loop;
end $$;
revoke execute on all functions in schema public from public, anon;
-- o cadastro público lista as unidades do clube legado: a policy de anon chama esta função
grant execute on function public.clube_legado_id() to anon;
-- funções internas: só outras funções (owner) as chamam
revoke execute on function public.clube_do_usuario(uuid) from authenticated;
revoke execute on function public.clube_vinculo_do_usuario(uuid) from authenticated;
revoke execute on function public._papel_do_vinculo(text) from authenticated;
revoke execute on function public._status_do_vinculo(text) from authenticated;
revoke execute on function public.reconciliar_vinculos_perfis() from authenticated;
revoke execute on function public.um_clube_por_pessoa() from authenticated;
revoke execute on function public.valida_unidade_do_perfil() from authenticated;
revoke execute on function public.sincronizar_vinculo_perfil() from authenticated;
-- funções novas daqui pra frente já nascem sem PUBLIC/anon. ATENÇÃO: o PUBLIC implícito do Postgres só
-- sai pela forma GLOBAL (sem IN SCHEMA); a forma IN SCHEMA só retira o anon explícito.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------
-- 9) Conserta os dados existentes (idempotente): perfis sem vínculo / fora de compasso
-- ---------------------------------------------------------------------
select public.reconciliar_vinculos_perfis();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-papeis-vinculos-e-escopo-legado.sql')
on conflict (arquivo) do update set aplicada_em = now();
