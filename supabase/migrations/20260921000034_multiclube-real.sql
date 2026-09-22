-- =====================================================================
-- DesbravaClube — Múltiplos clubes de verdade + entitlements de recurso
--
-- Antes: 1 clube por pessoa (gatilho), papel/unidade/status "globais" em
-- profiles (com um vínculo em organization_memberships que só ecoava o
-- perfil), "clube atual" 100% implícito (o vínculo ativo mais antigo, sem
-- seleção possível) e feature flags só de VISIBILIDADE (menos o leilão).
--
-- Agora:
--  A) Remove a restrição de 1 clube por pessoa.
--  B) organization_memberships passa a ser a fonte de verdade de papel,
--     unidade e status POR CLUBE (ganha a coluna unidade_id). profiles
--     continua sendo a identidade global (nome, foto, avatar...) — não é
--     duplicada por clube. papel/status/unidade_id em profiles viram um
--     ESPELHO do clube PRIMÁRIO da pessoa (o vínculo mais antigo), só para
--     o código que ainda não foi migrado para ler o vínculo (jogos/config
--     por unidade — ver AUDITORIA-MULTITENANT.md); deixam de ser
--     graváveis direto pelo cliente (só a RPC vinculo_gerir escreve).
--  C) clube_atual_id() passa a aceitar uma seleção EXPLÍCITA por requisição
--     (header x-clube-atual, lido via a GUC do PostgREST request.headers) —
--     mas nunca confia nela: só usa se corresponder a um vínculo ATIVO e
--     vigente de quem chama; senão cai no padrão de sempre (mais antigo).
--     Isso é por REQUISIÇÃO, não por sessão/usuário — não há estado
--     compartilhado no servidor, então duas abas do mesmo usuário podem
--     operar em clubes diferentes ao mesmo tempo sem se atropelar.
--  D) Feature flags viram autorização de verdade: quem desliga um recurso
--     bloqueia também as escritas dele (trigger central reaproveitável,
--     mesmo padrão do leilão), não só esconde a rota. Leitura nunca é
--     bloqueada (dado antigo continua visível/editável pela liderança).
--
-- Ver AUDITORIA-MULTITENANT.md ("Multi-clube real") para as decisões e os
-- limites conscientes desta fase (o motor de jogos/prêmios e a config por
-- clube continuam lendo o papel/unidade do clube PRIMÁRIO da pessoa).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) Fim do "1 clube por pessoa"
-- ---------------------------------------------------------------------
drop trigger if exists trg_um_clube_por_pessoa on public.organization_memberships;
drop function if exists public.um_clube_por_pessoa();

-- ---------------------------------------------------------------------
-- B) organization_memberships ganha unidade_id; vira a fonte de verdade
-- ---------------------------------------------------------------------
alter table public.organization_memberships
  add column if not exists unidade_id uuid references public.unidades(id);

-- A unidade do vínculo tem que ser do MESMO clube do vínculo (equivalente ao
-- que valida_unidade_do_perfil já fazia para profiles.unidade_id).
create or replace function public.valida_unidade_do_vinculo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_unit_club uuid;
begin
  if new.unidade_id is null then return new; end if;
  select club_id into v_unit_club from public.unidades where id = new.unidade_id;
  if v_unit_club is distinct from new.organizational_unit_id then
    raise exception 'A unidade escolhida pertence a outro clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.valida_unidade_do_vinculo() from public, anon, authenticated;
drop trigger if exists trg_valida_unidade_vinculo on public.organization_memberships;
create trigger trg_valida_unidade_vinculo
before insert or update of unidade_id, organizational_unit_id on public.organization_memberships
for each row execute function public.valida_unidade_do_vinculo();

-- Backfill: hoje é 1:1, então a unidade do perfil vira a unidade do vínculo
-- mais relevante da pessoa (o mesmo que sincronizar_vinculo_perfil mantinha).
update public.organization_memberships m
   set unidade_id = p.unidade_id
  from public.profiles p
 where m.user_id = p.id
   and p.unidade_id is not null
   and m.unidade_id is null
   and m.id = (
     select m2.id from public.organization_memberships m2
     where m2.user_id = p.id
     order by (m2.status in ('pendente', 'ativo')) desc, m2.created_at desc
     limit 1
   );

-- Papel/unidade/status de UM CLUBE específico (fonte de verdade: o vínculo).
-- Só considera vínculo ATIVO e vigente — usado por quem decide permissão.
create or replace function public.papel_no_clube(p_user_id uuid, p_club_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.organization_memberships m
  where m.user_id = p_user_id and m.organizational_unit_id = p_club_id
    and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at, m.id
  limit 1;
$$;

create or replace function public.unidade_no_clube(p_user_id uuid, p_club_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.unidade_id
  from public.organization_memberships m
  where m.user_id = p_user_id and m.organizational_unit_id = p_club_id
    and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at, m.id
  limit 1;
$$;

revoke all on function public.papel_no_clube(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unidade_no_clube(uuid, uuid) from public, anon, authenticated;

-- clube_do_usuario / clube_vinculo_do_usuario (migration 13): mesmo desempate — dois vínculos
-- criados na MESMA transação têm starts_at/created_at IDÊNTICOS (now() é fixo por transação no
-- Postgres), então o desempate precisa de algo sempre distinto (id) pra não ficar indefinido.
create or replace function public.clube_do_usuario(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organizational_unit_id
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = p_user_id
    and m.status in ('pendente', 'ativo')
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by (m.status = 'ativo') desc, m.starts_at, m.created_at, m.id
  limit 1;
$$;

create or replace function public.clube_vinculo_do_usuario(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organizational_unit_id
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = p_user_id
  order by (m.status in ('pendente', 'ativo') and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) desc,
           m.created_at desc, m.id desc
  limit 1;
$$;

-- O clube PRIMÁRIO de uma pessoa, pro espelho em profiles: É o mesmo clube_do_usuario() (garante
-- SEMPRE a mesma escolha que valida_unidade_do_perfil usa — nunca diverge, mesmo com desempate por
-- id) quando ela tem vínculo pendente/ativo em algum lugar; só cai pro mais recente de qualquer
-- status quando não tem NENHUM pendente/ativo (evita ficar sem espelho por causa de um clube só
-- com vínculos encerrados/suspensos).
create or replace function public.clube_primario_do_usuario(p_user_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(public.clube_do_usuario(p_user_id), public.clube_vinculo_do_usuario(p_user_id));
$$;
revoke all on function public.clube_primario_do_usuario(uuid) from public, anon, authenticated;

-- Direção NOVA: vínculo -> perfil (antes era perfil -> vínculo). profiles
-- deixa de ser fonte de verdade; vira um espelho do clube PRIMÁRIO, só para
-- o código legado que ainda lê profiles.papel/status/unidade_id.
create or replace function public.sincronizar_perfil_do_vinculo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_primario uuid;
  v_role text;
  v_status text;
  v_unidade uuid;
begin
  v_primario := public.clube_primario_do_usuario(v_user);
  if v_primario is null then
    return null;
  end if;
  select role, status, unidade_id into v_role, v_status, v_unidade
  from public.organization_memberships
  where user_id = v_user and organizational_unit_id = v_primario
  order by (status in ('pendente', 'ativo')) desc, created_at desc
  limit 1;
  -- unidade_id vem direto do vínculo primário (já validado ao ser gravado): passa o clube certo
  -- pro sinal que valida_unidade_do_perfil usa, em vez de deixar ele recalcular (redundante, e
  -- SEM desabilitar gatilhos — os avisos de aprovação/etc. em profiles continuam disparando).
  perform set_config('app.mirror_club', v_primario::text, true);
  update public.profiles
     set papel = coalesce(v_role, papel),
         status = coalesce(v_status, status),
         unidade_id = v_unidade
   where id = v_user
     and (papel is distinct from coalesce(v_role, papel)
          or status is distinct from coalesce(v_status, status)
          or unidade_id is distinct from v_unidade);
  perform set_config('app.mirror_club', '', true);
  return null;
end;
$$;
revoke all on function public.sincronizar_perfil_do_vinculo() from public, anon, authenticated;

-- Sai a direção antiga (perfil -> vínculo): profiles.papel/status deixam de
-- comandar o vínculo — é o contrário agora. reconciliar_vinculos_perfis() saía
-- perigosa de manter (gravaria o vínculo com o espelho, ao contrário) — sai;
-- reconciliar_perfis_dos_vinculos() (abaixo) é o equivalente na direção nova.
drop trigger if exists trg_00_sync_vinculo_perfil on public.profiles;
drop function if exists public.reconciliar_vinculos_perfis();

drop trigger if exists trg_sync_perfil_do_vinculo on public.organization_memberships;
create trigger trg_sync_perfil_do_vinculo
after insert or update of role, status, unidade_id, organizational_unit_id, starts_at, ends_at or delete
on public.organization_memberships
for each row execute function public.sincronizar_perfil_do_vinculo();

-- profiles.papel/status/unidade_id deixam de ser graváveis por QUALQUER
-- cliente direto (nem a própria liderança) — só a RPC vinculo_gerir (abaixo)
-- e o gatilho acima (que roda como dono da função, não como authenticated)
-- escrevem esses 3 campos. O GRANT de UPDATE em profiles era de TABELA
-- INTEIRA (authenticated=...w...), então revogar só a coluna não bastaria
-- (o privilégio de tabela cobre a coluna de qualquer forma): revoga a
-- tabela inteira e regrava por coluna, nas que continuam livres como antes.
revoke update on public.profiles from authenticated, anon;
grant update (nome, foto, nascimento, cargo, notif_visto_em, teste, avatar, avatar_tipo)
  on public.profiles to authenticated;

-- protege_campos_perfil() simplifica: só cargo continua editável direto (e só
-- pela liderança); papel/status/unidade_id já não chegam pela RLS/GRANT acima,
-- isto aqui é defesa em profundidade.
create or replace function public.protege_campos_perfil() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  new.papel := old.papel; new.status := old.status; new.unidade_id := old.unidade_id;
  if not public.lideranca_gere_usuario(old.id) then
    new.cargo := old.cargo;
  end if;
  return new;
end;
$$;

-- Rede de segurança (equivalente a reconciliar_vinculos_perfis, mas na direção NOVA):
-- corrige profiles que ficaram fora de compasso com o vínculo do clube PRIMÁRIO
-- (só acontece por manutenção manual que passe por cima dos gatilhos). Idempotente.
-- Linha a linha (não um UPDATE só): cada pessoa passa o PRÓPRIO clube primário pro sinal que
-- valida_unidade_do_perfil usa (mesmo mecanismo do espelho) — um UPDATE em lote não dá pra
-- sinalizar um clube DIFERENTE por linha. Roda raramente (manutenção), o loop não pesa.
create or replace function public.reconciliar_perfis_dos_vinculos() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_ajustados int := 0; r record;
begin
  for r in
    select distinct m.user_id from public.organization_memberships m
  loop
    perform set_config('app.mirror_club', public.clube_primario_do_usuario(r.user_id)::text, true);
    update public.profiles p
       set papel = vinc.role, status = vinc.status, unidade_id = vinc.unidade_id
      from (
        select role, status, unidade_id
        from public.organization_memberships
        where user_id = r.user_id and organizational_unit_id = public.clube_primario_do_usuario(r.user_id)
        order by (status in ('pendente', 'ativo')) desc, created_at desc
        limit 1
      ) vinc
     where p.id = r.user_id
       and (p.papel is distinct from vinc.role or p.status is distinct from vinc.status or p.unidade_id is distinct from vinc.unidade_id);
    if found then v_ajustados := v_ajustados + 1; end if;
  end loop;
  perform set_config('app.mirror_club', '', true);
  return v_ajustados;
end;
$$;
revoke all on function public.reconciliar_perfis_dos_vinculos() from public, anon, authenticated;

-- valida_unidade_do_perfil(): o espelho (sincronizar_perfil_do_vinculo) grava profiles.unidade_id
-- com um valor que JÁ veio validado do próprio vínculo (trg_valida_unidade_vinculo) — é redundante
-- (e, com vínculos empatados no desempate, podia ficar inconsistente) recalcular clube_do_usuario()
-- de novo aqui. O espelho passa o clube certo por um sinal de sessão (mesmo padrão do
-- app.signup_club); sem o sinal, o comportamento de sempre (recalcula) continua igual.
create or replace function public.valida_unidade_do_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_unit_club uuid; v_user_club uuid;
begin
  if new.unidade_id is null then return new; end if;
  select club_id into v_unit_club from public.unidades where id = new.unidade_id;
  v_user_club := coalesce(
    nullif(current_setting('app.mirror_club', true), '')::uuid,
    nullif(current_setting('app.signup_club', true), '')::uuid,
    public.clube_do_usuario(new.id)
  );
  if v_user_club is not null and v_unit_club is distinct from v_user_club then
    raise exception 'A unidade escolhida pertence a outro clube.';
  end if;
  return new;
end;
$$;

-- notif_novo_cadastro(): dispara logo após o INSERT em profiles, ANTES do vínculo existir
-- (handle_new_user cria os dois nessa ordem, por causa da FK) — sem o sinal de sessão, cairia
-- sempre no clube legado (clube_do_usuario(new.id) = null pra quem acabou de chegar).
create or replace function public.notif_novo_cadastro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if new.status = 'pendente' then
    v_club := coalesce(nullif(current_setting('app.signup_club', true), '')::uuid, public.clube_do_usuario(new.id));
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('👤 Novo cadastro', coalesce(new.nome, 'Alguém') || ' está aguardando aprovação',
            'cadastro', '/aprovacoes', 'lideranca', v_club);
  end if;
  return new;
end;
$$;
revoke all on function public.notif_novo_cadastro() from public, anon, authenticated;

-- Cadastro (handle_new_user): antes dependia do gatilho perfil->vínculo para
-- criar organization_memberships; agora cria os dois registros explicitamente
-- (a direção inverteu, então o cadastro não pode mais depender do gatilho).
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
    v_club := v_inv.club_id;
    -- profiles precisa nascer ANTES do vínculo (FK), mas o gatilho de "Novo cadastro" (AFTER
    -- INSERT em profiles) precisa saber o clube ANTES do vínculo existir: o mesmo sinal de
    -- sessão que valida_unidade_do_perfil já usava resolve isso pros dois lados.
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'pais', 'ativo');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, 'pais', 'ativo', '{"source":"cadastro"}'::jsonb);
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
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, unidade_id, metadata)
    values (new.id, v_club, 'desbravador', 'pendente', v_unidade, '{"source":"cadastro"}'::jsonb);
  end if;
  perform set_config('app.signup_club', '', true);
  return new;
end;
$$;

-- RPC: a liderança do clube EM USO edita papel/status/unidade do vínculo de
-- alguém NESSE clube (nunca de outro). Mesmas travas de protege_campos_perfil
-- de antes (ninguém edita o próprio vínculo; só a diretoria mexe em quem já é
-- ou vai virar diretoria/instrutor/tesoureiro).
create or replace function public.vinculo_gerir(
  p_user_id uuid, p_papel text default null, p_status text default null,
  p_unidade_id uuid default null, p_limpar_unidade boolean default false
) returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_row public.organization_memberships;
  v_role text;
  v_status text;
  v_lider constant text[] := array['diretoria', 'instrutor', 'tesoureiro'];
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  if p_user_id = v_uid then raise exception 'Você não pode alterar o próprio vínculo.'; end if;
  if not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;

  select * into v_row from public.organization_memberships
   where user_id = p_user_id and organizational_unit_id = v_club
   order by created_at desc limit 1
   for update;
  if not found then raise exception 'Esta pessoa não tem vínculo com o clube em uso.'; end if;

  v_role := coalesce(p_papel, v_row.role);
  v_status := coalesce(p_status, v_row.status);
  if v_role not in ('desbravador', 'conselheiro', 'instrutor', 'diretoria', 'tesoureiro', 'pais') then
    raise exception 'Papel inválido.';
  end if;
  -- aceita tanto o vocabulário do vínculo (pendente/ativo/suspenso/encerrado) quanto o
  -- vocabulário antigo da tela (rejeitado/inativo), pra não quebrar quem já chama assim.
  if v_status not in ('pendente', 'ativo', 'suspenso', 'encerrado') then
    v_status := public._status_do_vinculo(v_status);
  end if;

  if (v_row.role = any(v_lider) or v_role = any(v_lider))
     and (v_role is distinct from v_row.role or v_status is distinct from v_row.status)
     and not exists (
       select 1 from public.organization_memberships
        where user_id = v_uid and organizational_unit_id = v_club and role = 'diretoria' and status = 'ativo') then
    raise exception 'Sem permissão: só a diretoria muda cargo ou status de diretoria, instrutor ou tesoureiro.';
  end if;

  update public.organization_memberships
     set role = v_role,
         status = v_status,
         unidade_id = case when p_limpar_unidade then null
                           when p_unidade_id is not null then p_unidade_id
                           else unidade_id end,
         updated_at = now()
   where id = v_row.id;

  return json_build_object('ok', true);
end;
$$;
revoke all on function public.vinculo_gerir(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.vinculo_gerir(uuid, text, text, uuid, boolean) to authenticated;

-- unidade_excluir(): a exclusão de unidade fazia (no cliente) um update em profiles.unidade_id pra
-- soltar os membros ANTES de apagar a unidade — agora que a coluna não é mais gravável direto, os
-- dois passos viram uma RPC só (autorizada e atômica: sem risco de apagar a unidade com gente
-- ainda vinculada a ela, que travaria na FK de organization_memberships.unidade_id).
create or replace function public.unidade_excluir(p_unidade_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  select club_id into v_club from public.unidades where id = p_unidade_id;
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor deste clube).';
  end if;
  update public.organization_memberships set unidade_id = null
   where unidade_id = p_unidade_id and organizational_unit_id = v_club;
  delete from public.unidades where id = p_unidade_id and club_id = v_club;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.unidade_excluir(uuid) from public, anon;
grant execute on function public.unidade_excluir(uuid) to authenticated;

-- Autoatendimento: a própria pessoa escolhe a UNIDADE dela dentro do clube em uso (sempre
-- pôde — só papel/status são exclusivos da liderança). Não passa por vinculo_gerir (que é só
-- liderança); exige vínculo ativo, e a unidade tem que ser do mesmo clube (trg_valida_unidade_vinculo).
create or replace function public.minha_unidade_definir(p_unidade_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id();
begin
  if v_uid is null or v_club is null then raise exception 'Sem clube em uso.'; end if;
  update public.organization_memberships
     set unidade_id = p_unidade_id, updated_at = now()
   where user_id = v_uid and organizational_unit_id = v_club and status = 'ativo';
  if not found then raise exception 'Sem vínculo ativo neste clube.'; end if;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.minha_unidade_definir(uuid) from public, anon;
grant execute on function public.minha_unidade_definir(uuid) to authenticated;

-- organization_memberships: só é escrito por RPC/gatilho SECURITY DEFINER,
-- nunca direto pelo cliente (a policy de SELECT continua igual).
revoke insert, update, delete on public.organization_memberships from authenticated, anon;

-- lideranca_gere_usuario(): antes usava o clube "mais relevante" DO ALVO
-- (clube_vinculo_do_usuario), ignorando em qual clube quem chama está
-- operando. Com múltiplos clubes isso vazava autoridade entre os PRÓPRIOS
-- clubes de quem chama (ex.: diretor do clube A e membro do clube B usaria a
-- autoridade de A para mexer em gente do B). Agora: só vale no clube EM USO
-- de quem chama, e só se o alvo também tiver vínculo (qualquer status) nesse
-- MESMO clube.
create or replace function public.lideranca_gere_usuario(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.organization_memberships m
       where m.user_id = p_user_id and m.organizational_unit_id = public.clube_atual_id()
     );
$$;

-- diretoria_gere_usuario(): tinha a MESMA ambiguidade de lideranca_gere_usuario (usava o clube
-- "mais relevante" do ALVO, não o clube em uso de quem chama) — mesma correção.
create or replace function public.diretoria_gere_usuario(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.organizational_unit_id = public.clube_atual_id()
      and m.role = 'diretoria' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) and exists (
    select 1 from public.organization_memberships m2
    where m2.user_id = p_user_id and m2.organizational_unit_id = public.clube_atual_id()
  );
$$;

-- resetar_senha_membro / excluir_usuario: mesma correção (clube_atual_id() de
-- quem chama, não o clube "mais relevante" do alvo). tesoureiro também só a
-- diretoria redefine (como diretoria/instrutor) — regra da migration 18.
create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_atual_id(); v_papel text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club)
     or not exists (select 1 from public.organization_memberships where user_id = alvo and organizational_unit_id = v_club) then
    raise exception 'Sem permissão (apenas diretoria/instrutor do clube desta pessoa).';
  end if;
  select role into v_papel from public.organization_memberships
   where user_id = alvo and organizational_unit_id = v_club order by created_at desc limit 1;
  if v_papel in ('diretoria', 'instrutor', 'tesoureiro') and not public.diretoria_gere_usuario(alvo) then
    raise exception 'Sem permissão: só a diretoria redefine a senha de diretoria, instrutor ou tesoureiro.';
  end if;
  if nova_senha is null or length(nova_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;

-- excluir_usuario: se a pessoa tiver vínculo com OUTRO clube além do clube em
-- uso, apaga só o vínculo DESTE clube (nunca a identidade global nem o
-- vínculo do outro clube — profiles é global, não se apaga por decisão de
-- um único clube). Só apaga o perfil inteiro quando este é o único clube.
create or replace function public.excluir_usuario(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_nome text;
  v_outros_clubes int;
begin
  if v_club is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'diretoria' and m.status = 'ativo'
  ) or not exists (
    select 1 from public.organization_memberships where user_id = p_id and organizational_unit_id = v_club
  ) then
    raise exception 'Só a diretoria do clube desta pessoa pode excluir usuários.';
  end if;

  if p_id = v_uid then
    raise exception 'Você não pode excluir a si mesmo.';
  end if;

  select nome into v_nome from public.profiles where id = p_id;
  if not found then raise exception 'Usuário não encontrado.'; end if;

  select count(*) into v_outros_clubes
  from public.organization_memberships
  where user_id = p_id and organizational_unit_id <> v_club;

  if v_outros_clubes > 0 then
    delete from public.organization_memberships where user_id = p_id and organizational_unit_id = v_club;
    return json_build_object('ok', true, 'nome', v_nome, 'somente_vinculo', true);
  end if;

  update public.atividades   set criado_por     = null where criado_por     = p_id;
  update public.entregas     set avaliado_por   = null where avaliado_por   = p_id;
  update public.pontos       set lancado_por    = null where lancado_por    = p_id;
  update public.mensalidades set registrado_por = null where registrado_por = p_id;
  update public.notificacoes set criado_por     = null where criado_por     = p_id;
  update public.fotos        set autor_id       = null where autor_id       = p_id;
  delete from public.profiles where id = p_id;
  return json_build_object('ok', true, 'nome', v_nome, 'somente_vinculo', false);
end;
$$;

-- listar_usuarios(): antes devolvia profiles.papel/status/unidade_id (globais);
-- agora devolve o vínculo da pessoa NO CLUBE EM USO de quem chama. status sai traduzido pro
-- vocabulário que a tela Usuarios.jsx já entende (ativo/pendente/inativo/rejeitado) — o
-- vocabulário real do vínculo (ativo/pendente/suspenso/encerrado) fica interno.
create or replace function public.listar_usuarios()
returns table (id uuid, nome text, foto text, papel text, status text, unidade_id uuid, email text, teste boolean)
language sql security definer set search_path = '' as $$
  select p.id, p.nome, p.foto, m.role,
    case m.status when 'ativo' then 'ativo' when 'pendente' then 'pendente' when 'encerrado' then 'rejeitado' else 'inativo' end,
    m.unidade_id, u.email::text, coalesce(p.teste, false)
  from (
    select distinct on (user_id) *
    from public.organization_memberships
    where organizational_unit_id = public.clube_atual_id()
    order by user_id, (status in ('pendente', 'ativo') and starts_at <= now() and (ends_at is null or ends_at > now())) desc, created_at desc
  ) m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = p.id
  where public.pode_gerir_no_clube(public.clube_atual_id())
  order by p.nome;
$$;

-- pode_apontar(): "conselheiro da mesma unidade" comparado pelo VÍNCULO, não
-- por profiles.unidade_id/papel.
create or replace function public.pode_apontar(alvo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_gerir_no_clube(public.clube_do_usuario(alvo))
      or exists (
        select 1
        from public.organization_memberships eu
        join public.organization_memberships d
          on d.organizational_unit_id = eu.organizational_unit_id
         and d.unidade_id is not distinct from eu.unidade_id
         and d.unidade_id is not null
        where eu.user_id = auth.uid() and eu.role = 'conselheiro' and eu.status = 'ativo'
          and eu.starts_at <= now() and (eu.ends_at is null or eu.ends_at > now())
          and d.user_id = alvo and d.role = 'desbravador' and d.status = 'ativo'
          and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())
          and public.membro_ativo_no_clube(public.clube_do_usuario(alvo))
      );
$$;

-- definir_club_responsavel(): o pedido nasce no clube EM USO de quem pede (não
-- mais "o" clube do responsável, ambíguo com múltiplos vínculos). Sem sessão
-- autenticada (fixtures/rotinas internas), cai no comportamento de sempre.
-- Só recalcula no INSERT — no UPDATE (aprovar/rejeitar) o club_id já gravado
-- não muda, só valida que o desbravador escolhido é DESSE clube.
create or replace function public.definir_club_responsavel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if tg_op = 'INSERT' then
    v_club := coalesce(public.clube_atual_id(), public.clube_do_usuario(new.responsavel_id));
    if v_club is null or not exists (
      select 1 from public.organization_memberships m where m.user_id = new.responsavel_id and m.organizational_unit_id = v_club
    ) then
      raise exception 'O responsável não pertence a nenhum clube.';
    end if;
    new.club_id := v_club;
  end if;
  if new.desbravador_id is not null and not exists (
    select 1 from public.organization_memberships m where m.user_id = new.desbravador_id and m.organizational_unit_id = new.club_id
  ) then
    raise exception 'O desbravador é de outro clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.definir_club_responsavel() from public, anon, authenticated;

-- pedir_vinculo(): "só responsáveis pedem vínculo" passa a olhar o vínculo
-- 'pais' ATIVO no clube EM USO de quem pede (não profiles.papel global).
create or replace function public.pedir_vinculo(p_nome text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_club uuid := public.clube_atual_id(); v_pend int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if v_club is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'pais' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Só responsáveis pedem vínculo.';
  end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Digite o nome do seu filho(a).'; end if;

  select count(*) into v_pend from public.responsaveis
   where responsavel_id = v_uid and status = 'pendente';
  if v_pend >= 5 then raise exception 'Você já tem pedidos demais aguardando. Espere a diretoria. 🙂'; end if;

  insert into public.responsaveis (responsavel_id, nome_digitado) values (v_uid, trim(p_nome));
  return json_build_object('ok', true);
end;
$$;

-- aprovar_vinculo(): "desbravador não pais" passa a olhar o VÍNCULO no clube
-- do pedido (não profiles.papel), preservando o comportamento de aceitar
-- alvo pendente ou ativo.
create or replace function public.aprovar_vinculo(p_id uuid, p_desbravador_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status text; v_club uuid;
begin
  -- checa permissão ANTES de existência (id inexistente e id de outro clube respondem IGUAL:
  -- nenhum oráculo de UUID — a ordem original desta função, migration 18, é preservada aqui).
  select club_id into v_club from public.responsaveis where id = p_id;
  if v_club is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'diretoria' and m.status = 'ativo'
  ) then
    raise exception 'Só a diretoria do clube aprova vínculos.';
  end if;
  select status into v_status from public.responsaveis where id = p_id for update;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = p_desbravador_id and m.organizational_unit_id = v_club and m.role <> 'pais'
      and m.status in ('pendente', 'ativo')
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    raise exception 'Desbravador não encontrado neste clube.';
  end if;
  if v_status = 'aprovado' then raise exception 'Esse vínculo já foi aprovado.'; end if;

  update public.responsaveis
     set desbravador_id = p_desbravador_id, status = 'aprovado', aprovado_por = v_uid, aprovado_em = now()
   where id = p_id;
  return json_build_object('ok', true);
exception when unique_violation then
  raise exception 'Esse responsável já está vinculado a esse desbravador.';
end;
$$;

-- chat_pode_ver(): o ramo "unidade" passa a comparar a unidade do VÍNCULO no
-- clube da conversa (não profiles.unidade_id/papel globais).
create or replace function public.chat_pode_ver(p_conversa_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_club uuid; v_tipo text; v_unidade uuid; v_uid uuid := auth.uid();
begin
  select club_id, tipo, unidade_id into v_club, v_tipo, v_unidade from public.chat_conversas where id = p_conversa_id;
  if v_club is null then return false; end if;
  if public.pode_gerir_no_clube(v_club) then return true; end if;
  if not public.membro_ativo_no_clube(v_club) then return false; end if;
  if v_tipo = 'geral' then return true; end if;
  if v_tipo = 'unidade' then
    return v_unidade is not null and v_unidade is not distinct from (
      select m.unidade_id from public.organization_memberships m
      where m.user_id = v_uid and m.organizational_unit_id = v_club and m.status = 'ativo'
        and m.role in ('desbravador', 'conselheiro')
        and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    );
  end if;
  return exists (select 1 from public.chat_participantes part where part.conversa_id = p_conversa_id and part.usuario_id = v_uid);
end;
$$;

-- meus_filhos(): usava clube_do_usuario(auth.uid()) (o clube "mais relevante" da pessoa, sem
-- seleção possível) — agora usa clube_atual_id(), então um responsável em 2 clubes troca de "meus
-- filhos daqui" pra "meus filhos de lá" do MESMO jeito que qualquer outra tela troca de clube.
create or replace function public.meus_filhos()
returns json language sql security definer set search_path = '' as $$
  select coalesce(json_agg(f order by f->>'nome'), '[]'::json) from (
    select json_build_object(
      'id', c.id, 'nome', c.nome, 'foto', c.foto, 'unidade', u.nome,
      'pontos', coalesce((select sum(pontos)::int from public.pontos where usuario_id = c.id and club_id = r.club_id), 0),
      'presencas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento' and marca->>'presenca' = 'presente'), 0),
      'faltas', coalesce((select count(*) from public.pontos
                    where usuario_id = c.id and club_id = r.club_id and origem = 'apontamento' and marca->>'presenca' = 'faltou'), 0),
      'mensalidades_pendentes', coalesce((
                    select json_agg(json_build_object('mes', m.mes, 'ano', m.ano, 'valor', m.valor) order by m.ano, m.mes)
                    from public.mensalidades m where m.desbravador_id = c.id and m.club_id = r.club_id and m.status = 'pendente'), '[]'::json)
    ) as f
    from public.responsaveis r
    join public.profiles c on c.id = r.desbravador_id
    left join public.unidades u on u.id = public.unidade_no_clube(c.id, r.club_id)
    where r.responsavel_id = auth.uid() and r.status = 'aprovado'
      and r.club_id = public.clube_atual_id()
  ) t;
$$;

-- pets_do_clube(): exclusão de 'pais' passa a olhar o vínculo no clube em uso.
create or replace function public.pets_do_clube()
returns table (dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text,
               especie text, pet_nome text, estagio integer, item text, cenario text, cor text, olhos text,
               movel text, vivo boolean, ofensiva integer, dormindo boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.avatar, p.avatar_tipo, p.foto,
    b.especie, b.nome, public._bichinho_estagio(b.dias_cuidados), b.item, b.cenario, b.cor, b.olhos,
    b.movel,
    (b.vivo and (b.pontuado_em is null or b.dormindo_desde is not null
                 or now() - b.ultimo_cuidado_em <= interval '72 hours')),
    b.ofensiva,
    (b.dormindo_desde is not null)
  from public.bichinhos b
  join public.profiles p on p.id = b.usuario_id
  join public.organization_memberships m on m.user_id = b.usuario_id and m.organizational_unit_id = public.clube_atual_id()
    and m.role <> 'pais' and m.status = 'ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  where b.club_id = public.clube_atual_id()
    and public.membro_ativo_no_clube(public.clube_atual_id())
  order by b.ofensiva desc, public._bichinho_estagio(b.dias_cuidados) desc, p.nome;
$$;

-- ---------------------------------------------------------------------
-- C) clube_atual_id(): seleção explícita por requisição, sempre validada
-- ---------------------------------------------------------------------
-- O cliente PODE informar em qual clube quer operar (header x-clube-atual);
-- o servidor NUNCA confia nisso sozinho — só honra se corresponder a um
-- vínculo ATIVO e vigente de quem chama; se não, cai no padrão de sempre
-- (o vínculo ativo mais antigo). Sem o header (chamadas antigas, scripts,
-- testes), o comportamento é IDÊNTICO ao de antes.
create or replace function public.clube_atual_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_pedido uuid;
  v uuid;
begin
  if v_uid is null then return null; end if;

  begin
    v_pedido := nullif(current_setting('request.headers', true)::jsonb ->> 'x-clube-atual', '')::uuid;
  exception when others then
    v_pedido := null;
  end;

  if v_pedido is not null then
    if exists (
      select 1 from public.organization_memberships m
      where m.user_id = v_uid and m.organizational_unit_id = v_pedido
        and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
    ) then
      return v_pedido;
    end if;
    -- pedido presente mas sem vínculo ativo real: nunca confia (pode ser uma
    -- escolha desatualizada de outra aba, ou uma tentativa de forjar o
    -- clube) — cai no padrão abaixo, nunca em erro (não revela nada).
  end if;

  select m.organizational_unit_id into v
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = v_uid and m.status = 'ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at, m.id
  limit 1;
  return v;
end;
$$;

-- meu_contexto(): agora TODO vínculo ativo e vigente é selecionavel (antes só
-- o que já era o clube_atual_id() — sem seleção real possível); unidade vem
-- do PRÓPRIO vínculo (antes vinha de profiles.unidade_id, sempre a mesma
-- unidade pra qualquer clube — bug estrutural corrigido aqui).
create or replace function public.meu_contexto() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_atual uuid := public.clube_atual_id();
begin
  if v_uid is null then return jsonb_build_object('usuario_id', null, 'clube_atual_id', null, 'vinculos', '[]'::jsonb); end if;
  return jsonb_build_object('usuario_id', v_uid, 'clube_atual_id', v_atual, 'vinculos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'club_id', u.id, 'nome', u.nome, 'slug', u.slug, 'timezone', u.timezone,
      'papel', m.role, 'status', m.status,
      'selecionavel', (m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())),
      'unidade_id', un.id, 'unidade_nome', un.nome,
      'marca', public.clube_marca(u.id), 'recursos', public.recursos_do_clube(u.id)
    ) order by (u.id is not distinct from v_atual) desc, m.starts_at, m.created_at, m.id)
    from public.organization_memberships m
    join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
    left join public.unidades un on un.id = m.unidade_id
    where m.user_id = v_uid and m.status in ('pendente', 'ativo', 'suspenso')
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- D) Feature flags viram autorização real (bloqueiam escrita, não só rota)
-- ---------------------------------------------------------------------
-- Gatilho genérico e reaproveitável (mesmo padrão do leilão, mas central: UMA
-- função, N tabelas). Só bloqueia ESCRITA nova; leitura e edição do que já
-- existe (aprovar/rejeitar pendência, marcar mensalidade paga...) continuam
-- liberadas mesmo com o recurso desligado — não há gatilho em UPDATE/DELETE
-- nem em SELECT, só em INSERT (e, nas duas tabelas de estado contínuo
-- bichinhos/biblia_leitura_atual, também em UPDATE, que é como elas
-- realmente são escritas no dia a dia).
create or replace function public.exigir_recurso_habilitado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.club_id is not null and not public.recurso_habilitado_no_clube(new.club_id, tg_argv[0]) then
    raise exception 'Este recurso está desabilitado neste clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.exigir_recurso_habilitado() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('atividades', 'atividades', false), ('entregas', 'atividades', false),
    ('eventos', 'agenda', false),
    ('chat_mensagens', 'chat', false),
    ('trilha_jogos', 'jogos', false), ('recordes', 'jogos', false), ('partidas', 'jogos', false),
    ('chefao_golpes', 'chefao', false),
    ('duelos', 'desafios', false), ('desafios_unidade', 'desafios', false),
    ('missoes_feitas', 'missoes', false), ('devocional', 'missoes', false),
    ('fotos', 'mural', false),
    ('mensalidades', 'mensalidades', false),
    ('biblia_leituras', 'biblia', false),
    ('bichinhos', 'bichinho', true), ('biblia_leitura_atual', 'biblia', true)
  ) as v(tabela, feature, tambem_update) loop
    execute format('drop trigger if exists trg_exigir_recurso on public.%I', r.tabela);
    execute format(
      'create trigger trg_exigir_recurso before insert%s on public.%I for each row execute function public.exigir_recurso_habilitado(%L)',
      case when r.tambem_update then ' or update' else '' end, r.tabela, r.feature
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- E) Matriz de auditoria: a exceção de profiles muda de motivo
-- ---------------------------------------------------------------------
-- profiles não tem club_id porque a pessoa não pertence a UM clube — pertence
-- a quantos vínculos organization_memberships tiver. O teste 20 é atualizado
-- junto (comentário e motivo).

-- Conserta os dados existentes (idempotente): a direção inverteu (era perfil -> vínculo, agora é
-- vínculo -> perfil) — sem isso, quem já existia antes desta migration só teria o espelho corrigido
-- na PRÓXIMA vez que o vínculo mudasse, não agora.
select public.reconciliar_perfis_dos_vinculos();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-multiclube-real.sql')
on conflict (arquivo) do update set aplicada_em = now();
