-- =====================================================================
-- DesbravaClube — Correções multi-tenant 6/6: achados da revisão independente
--
-- Cada item foi reproduzido no banco antes de corrigir (supabase/tests/11_revisao_independente.sql):
--  A) Aviso/push forjado em outro clube: o clube da notificação era derivado de criado_por /
--     lancado_por, campos que a liderança de QUALQUER clube podia preencher com o id de outra
--     pessoa. Agora o clube vem do dado (club_id explícito do gatilho) e a atribuição só vale
--     para o próprio autor (policies restritivas de INSERT).
--  B) Chefão somava pontos de todos os clubes (e pagava prêmio a quem não era do clube legado).
--  C) atividade_jogos() listava desbravadores (menores) de outros clubes para a liderança legada.
--  D) Bucket "imagens": qualquer anônimo listava os arquivos (expondo uuids de usuários/unidades).
--  E) Instrutor promovia a diretoria e desativava a própria diretoria/tesoureiro.
--  F) Unidade/usuário de outro clube aceitos em duelo, perfil de suspenso e ponto misto.
--  G) Oráculos de existência de UUID em aprovar_entrega / revogar convite / aprovar vínculo.
-- =====================================================================

-- ==================== A) clube da notificação vem do DADO, não de quem "assina" ====================
create or replace function public.definir_club_notificacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.para_usuario is not null then
    -- aviso pessoal: sempre no clube de QUEM RECEBE (mesmo desativado)
    new.club_id := coalesce(public.clube_vinculo_do_usuario(new.para_usuario), public.clube_legado_id());
  elsif new.club_id is not null then
    -- clube explícito (gatilhos e rotinas do banco). Se vier de um cliente, a RLS confere que é o
    -- clube dele e que ele é liderança dele; não dá para "mandar" aviso para outro clube.
    null;
  elsif new.criado_por is not null and public.clube_vinculo_do_usuario(new.criado_por) is not null then
    new.club_id := public.clube_vinculo_do_usuario(new.criado_por);
  else
    new.club_id := public.clube_legado_id();
  end if;
  return new;
end;
$$;
revoke all on function public.definir_club_notificacao() from public, anon, authenticated;

create or replace function public.notif_nova_atividade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, criado_por, club_id)
  values ('📋 Nova atividade', new.titulo, 'atividade', '/atividades', 'todos', new.criado_por, new.club_id);
  return new;
end;
$$;
revoke all on function public.notif_nova_atividade() from public, anon, authenticated;

-- Atribuição: pelo app só se cria/lança "em nome próprio". Policies RESTRITIVAS (valem além das
-- permissivas) só no INSERT: editar um evento criado por outro líder continua funcionando.
drop policy if exists "atribuicao propria atividades" on public.atividades;
create policy "atribuicao propria atividades" on public.atividades as restrictive for insert to authenticated
with check (criado_por is null or criado_por = auth.uid());
drop policy if exists "atribuicao propria eventos" on public.eventos;
create policy "atribuicao propria eventos" on public.eventos as restrictive for insert to authenticated
with check (criado_por is null or criado_por = auth.uid());
drop policy if exists "atribuicao propria pontos" on public.pontos;
create policy "atribuicao propria pontos" on public.pontos as restrictive for insert to authenticated
with check (lancado_por is null or lancado_por = auth.uid());
drop policy if exists "atribuicao propria notificacoes" on public.notificacoes;
create policy "atribuicao propria notificacoes" on public.notificacoes as restrictive for insert to authenticated
with check (criado_por is null or criado_por = auth.uid());

-- ==================== D) bucket "imagens": sem listagem anônima nem entre clubes ====================
-- As URLs públicas (getPublicUrl) NÃO dependem de RLS: fotos do mural, perfil e emblemas seguem
-- abrindo para todos. O que sai é a LISTAGEM (revelava uuids de usuários/unidades de todos os clubes).
drop policy if exists "ler imagens publico" on storage.objects;
drop policy if exists "ler imagens dono ou lideranca" on storage.objects;
create policy "ler imagens dono ou lideranca" on storage.objects for select to authenticated
using (bucket_id = 'imagens' and (owner = auth.uid() or public.lideranca_gere_usuario(owner)));

-- ==================== E) só a DIRETORIA mexe em quem é liderança/financeiro ====================
create or replace function public.diretoria_gere_usuario(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.organizational_unit_id = public.clube_vinculo_do_usuario(p_user_id)
      and m.role = 'diretoria' and m.status = 'ativo'
      and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  );
$$;

create or replace function public.protege_campos_perfil() returns trigger
language plpgsql set search_path = '' as $$
declare v_lider constant text[] := array['diretoria', 'instrutor', 'tesoureiro'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- ninguém muda o PRÓPRIO papel/status (nem a liderança): evita auto-promoção
  if new.id = auth.uid() then
    new.papel := old.papel; new.status := old.status;
  end if;
  if not public.lideranca_gere_usuario(old.id) then
    -- fora da liderança do clube dessa pessoa, campos sensíveis não mudam
    new.papel := old.papel; new.cargo := old.cargo; new.status := old.status; new.unidade_id := old.unidade_id;
  elsif not public.diretoria_gere_usuario(old.id) then
    -- instrutor: opera os membros, mas só a DIRETORIA promove a diretoria/instrutor/tesoureiro e só
    -- ela desativa ou muda quem já tem um desses papéis (senão o instrutor assumiria o clube)
    if old.papel = any(v_lider) then new.papel := old.papel; new.status := old.status; end if;
    if new.papel = any(v_lider) then new.papel := old.papel; end if;
  end if;
  return new;
end;
$$;

-- senha de diretoria/instrutor/tesoureiro: só a diretoria (antes: só diretoria/instrutor, e o tesoureiro ficava de fora)
create or replace function public.resetar_senha_membro(alvo uuid, nova_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_club uuid := public.clube_vinculo_do_usuario(alvo); v_papel text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
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

-- ==================== F) pessoa, unidade e pontos sempre do MESMO clube ====================
-- unidade do perfil: vale também para quem está suspenso/encerrado (clube do vínculo mais recente)
create or replace function public.valida_unidade_do_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_unit_club uuid; v_user_club uuid;
begin
  if new.unidade_id is null then return new; end if;
  select club_id into v_unit_club from public.unidades where id = new.unidade_id;
  v_user_club := coalesce(nullif(current_setting('app.signup_club', true), '')::uuid, public.clube_vinculo_do_usuario(new.id));
  if v_user_club is not null and v_unit_club is distinct from v_user_club then
    raise exception 'A unidade escolhida pertence a outro clube.';
  end if;
  return new;
end;
$$;

-- duelo: as duas unidades têm que ser do clube do duelo (hoje: o legado)
create or replace function public.exigir_unidades_do_clube_legado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.unidades u
    where u.id in (new.unidade_a, new.unidade_b) and u.club_id is distinct from public.clube_legado_id()
  ) then
    raise exception 'Duelos só entre unidades do mesmo clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.exigir_unidades_do_clube_legado() from public, anon, authenticated;
drop trigger if exists trg_exigir_unidades_legado on public.duelos;
create trigger trg_exigir_unidades_legado before insert or update of unidade_a, unidade_b on public.duelos
for each row execute function public.exigir_unidades_do_clube_legado();

-- ponto: pessoa e unidade do mesmo clube; pessoa suspensa/encerrada continua no clube DELA (não cai no legado)
create or replace function public.definir_club_ponto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club_unidade uuid; v_club_pessoa uuid;
begin
  if new.unidade_id is not null then
    select club_id into v_club_unidade from public.unidades where id = new.unidade_id;
  end if;
  if new.usuario_id is not null then
    v_club_pessoa := public.clube_vinculo_do_usuario(new.usuario_id);
  end if;
  if v_club_unidade is not null and v_club_pessoa is not null and v_club_unidade <> v_club_pessoa then
    raise exception 'A pessoa e a unidade do ponto são de clubes diferentes.';
  end if;
  new.club_id := coalesce(v_club_unidade, v_club_pessoa, public.clube_legado_id());
  return new;
end;
$$;
revoke all on function public.definir_club_ponto() from public, anon, authenticated;

-- ==================== G) sem oráculo de existência de UUID ====================
create or replace function public.aprovar_entrega(p_entrega_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ent public.entregas;
  v_atv public.atividades;
  v_pts int;
begin
  -- permissão ANTES de qualquer distinção (id inexistente e id de outro clube respondem igual)
  if not exists (select 1 from public.entregas e where e.id = p_entrega_id and public.pode_gerir_no_clube(e.club_id)) then
    raise exception 'Sem permissão neste clube.';
  end if;
  select * into v_ent from public.entregas where id = p_entrega_id and status = 'pendente' for update;
  if v_ent.id is null then
    return json_build_object('ok', false, 'motivo', 'ja_avaliada');
  end if;

  update public.entregas
     set status = 'aprovada', avaliado_por = v_uid
   where id = v_ent.id;

  select * into v_atv from public.atividades where id = v_ent.atividade_id;
  v_pts := coalesce(v_atv.pontos, 0);
  update public.entregas set pontos_dados = v_pts where id = v_ent.id;
  insert into public.pontos (usuario_id, origem, pontos, motivo, lancado_por, entrega_id, club_id)
    values (v_ent.usuario_id, 'atividade', v_pts,
            'Atividade: ' || coalesce(v_atv.titulo, ''), v_uid, v_ent.id, v_ent.club_id);

  return json_build_object('ok', true, 'pontos', v_pts);
end;
$$;

create or replace function public.revogar_convite_responsavel(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_club uuid; v_usado timestamptz; v_revogado timestamptz;
begin
  select club_id into v_club from public.club_invites where id = p_id;
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Convite não encontrado ou sem permissão.';
  end if;
  select used_at, revoked_at into v_usado, v_revogado from public.club_invites where id = p_id for update;
  if v_usado is not null then raise exception 'Esse convite já foi usado.'; end if;
  if v_revogado is not null then raise exception 'Esse convite já foi revogado.'; end if;
  update public.club_invites set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.aprovar_vinculo(p_id uuid, p_desbravador_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status text; v_club uuid;
begin
  select club_id into v_club from public.responsaveis where id = p_id;
  if v_club is null or not exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_uid and m.organizational_unit_id = v_club and m.role = 'diretoria' and m.status = 'ativo'
  ) then
    raise exception 'Só a diretoria do clube aprova vínculos.';
  end if;
  select status into v_status from public.responsaveis where id = p_id for update;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_desbravador_id and p.papel <> 'pais' and public.clube_do_usuario(p.id) = v_club
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

-- ==================== B/C) chefão e atividade_jogos: só o clube legado ====================
-- (definições reais do banco; a única mudança é o filtro por clube legado nas leituras de pessoas/pontos)

CREATE OR REPLACE FUNCTION public.chefao_estado()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano_pontos int;
  v_dano_golpes int;
  v_dano int;
  v_por_unidade json;
  v_meu_ultimo timestamptz;
  v_no_evento boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then return json_build_object('ativo', false); end if;

  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then return json_build_object('ativo', false); end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days'; -- sáb 00:00 -> seg 00:00 (cobre sáb+dom)
  v_no_evento := now() >= v_ini and now() < v_fim;

  select coalesce(sum(p.pontos), 0) into v_dano_pontos
  from public.pontos p
  join public.profiles pr on pr.id = p.usuario_id
  where p.data >= v_ini and p.data < v_fim and p.pontos > 0
    and p.origem not in ('campeao', 'chefao')
    and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id();

  select coalesce(sum(g.dano), 0) into v_dano_golpes
  from public.chefao_golpes g
  where g.criado_em >= v_ini and g.criado_em < v_fim;

  v_dano := v_dano_pontos + v_dano_golpes;

  -- placar por unidade (pontos + golpes somados por unidade)
  with dano_uni as (
    select pr.unidade_id as uid, sum(p.pontos)::int as dano
    from public.pontos p join public.profiles pr on pr.id = p.usuario_id
    where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao', 'chefao')
      and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id()
      and pr.unidade_id is not null
    group by pr.unidade_id
    union all
    select pr.unidade_id as uid, sum(g.dano)::int as dano
    from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
    where g.criado_em >= v_ini and g.criado_em < v_fim and pr.unidade_id is not null
    group by pr.unidade_id
  )
  select coalesce(json_agg(json_build_object('unidade', u.nome, 'dano', t.dano) order by t.dano desc), '[]'::json)
    into v_por_unidade
  from (select uid, sum(dano)::int as dano from dano_uni group by uid) t
  join public.unidades u on u.id = t.uid;

  select max(criado_em) into v_meu_ultimo from public.chefao_golpes
  where usuario_id = v_uid and criado_em >= v_ini and criado_em < v_fim;

  return json_build_object(
    'ativo', true,
    'nome', coalesce((select valor from public.config_clube where chave = 'chefao_nome'), 'Chefão'),
    'emoji', coalesce((select valor from public.config_clube where chave = 'chefao_emoji'), '🗿'),
    'versiculo', (select valor from public.config_clube where chave = 'chefao_versiculo'),
    'inicio', v_inicio,
    'fase', case when now() < v_ini then 'antes' when now() < v_fim then 'rolando' else 'acabou' end,
    'vida_total', v_vida,
    'dano', v_dano,
    'vida_atual', greatest(0, v_vida - v_dano),
    'venceu', v_dano >= v_vida,
    'no_evento', v_no_evento,
    'por_unidade', v_por_unidade,
    'golpe_pronto', v_no_evento and v_dano < v_vida
      and (v_meu_ultimo is null or now() - v_meu_ultimo >= interval '1 hour'),
    'proximo_golpe_em', case when v_meu_ultimo is null then null else v_meu_ultimo + interval '1 hour' end,
    'ja_golpeei', v_meu_ultimo is not null
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.chefao_golpe()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_dano_golpe int := 25;
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_ini timestamptz;
  v_fim timestamptz;
  v_ultimo timestamptz;
  v_dano int;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then raise exception 'Só membros ativos entram na batalha.'; end if;

  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then raise exception 'Não tem chefão agora. 🙂'; end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';
  if now() < v_ini or now() >= v_fim then raise exception 'A batalha não está rolando agora. 🙂'; end if;

  -- trava anti-flood: 1 golpe por hora
  select max(criado_em) into v_ultimo from public.chefao_golpes
  where usuario_id = v_uid and criado_em >= v_ini and criado_em < v_fim;
  if v_ultimo is not null and now() - v_ultimo < interval '1 hour' then
    raise exception 'Seu golpe especial recarrega 1x por hora — volta já já! ⏳';
  end if;

  insert into public.chefao_golpes (usuario_id, dano) values (v_uid, v_dano_golpe);

  -- dano total atualizado pra devolver a barra na hora
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id()), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      where g.criado_em >= v_ini and g.criado_em < v_fim), 0)
  into v_dano;

  return json_build_object('ok', true, 'dano_golpe', v_dano_golpe,
    'vida_atual', greatest(0, v_vida - v_dano), 'venceu', v_dano >= v_vida);
end;
$function$;

CREATE OR REPLACE FUNCTION public.chefao_premiar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ativo boolean;
  v_inicio text;
  v_vida int;
  v_nome text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_dano numeric;   -- dano total do clube (pontos + golpes de membros ativos)
  v_premio int;
  r record;
begin
  v_ativo := coalesce((select valor from public.config_clube where chave = 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := (select valor from public.config_clube where chave = 'chefao_inicio');
  if not v_ativo or v_inicio is null then return; end if;
  if (select valor from public.config_clube where chave = 'chefao_pago') is not distinct from v_inicio then return; end if;

  v_vida := greatest(1, coalesce((select valor from public.config_clube where chave = 'chefao_vida'), '3000')::int);
  v_nome := coalesce((select valor from public.config_clube where chave = 'chefao_nome'), 'Chefão');
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';

  perform pg_advisory_xact_lock(hashtext('chefao:' || v_inicio));

  -- dano total (mesmos filtros do dano por pessoa abaixo → as proporções fecham)
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id()), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      join public.profiles pr on pr.id = g.usuario_id
      where g.criado_em >= v_ini and g.criado_em < v_fim
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id()), 0)
  into v_dano;

  if v_dano >= v_vida then
    -- VITÓRIA: reparte a vida (v_vida) proporcional ao dano de cada um
    for r in
      select uid, sum(dano)::numeric as dano_user from (
        select p.usuario_id as uid, sum(p.pontos)::numeric as dano
        from public.pontos p join public.profiles pr on pr.id = p.usuario_id
        where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
          and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id()
        group by p.usuario_id
        union all
        select g.usuario_id, sum(g.dano)::numeric
        from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
        where g.criado_em >= v_ini and g.criado_em < v_fim
          and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = public.clube_legado_id()
        group by g.usuario_id
      ) t
      group by uid
    loop
      v_premio := round(v_vida * r.dano_user / v_dano)::int;
      if v_premio > 0 then
        insert into public.pontos (usuario_id, origem, pontos, motivo)
        values (r.uid, 'chefao', v_premio,
          '⚔️ Derrotou o ' || v_nome || '! ' || round(r.dano_user)::int || ' de dano → +' || v_premio
          || ' (' || to_char(v_ini, 'DD/MM') || ')');
      end if;
    end loop;

    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('⚔️ Chefão derrotado!',
      'O clube uniu forças e derrotou o ' || v_nome || '! Cada um levou pontos proporcionais ao dano que causou. 🎉',
      'geral', '/chefao', 'todos');
  else
    -- fugiu (gentil, sem "vocês falharam"); ninguém perde os pontos já ganhos
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🌙 O ' || v_nome || ' recuou...',
      'O ' || v_nome || ' fugiu por pouco! Foi muita luta junto — semana que vem tem mais aventura. 💪',
      'geral', '/chefao', 'todos');
  end if;

  insert into public.config_clube (chave, valor) values ('chefao_pago', v_inicio)
  on conflict (chave) do update set valor = excluded.valor;
  update public.config_clube set valor = 'nao' where chave = 'chefao_ativo';
end;
$function$;

CREATE OR REPLACE FUNCTION public.atividade_jogos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
begin
  if not public.pode_gerir() then raise exception 'Sem permissão (apenas liderança).'; end if;
  return json_build_object(
    'hoje',   (select count(distinct usuario_id) from public.trilha_jogos where data = v_hoje),
    'semana', (select count(distinct usuario_id) from public.trilha_jogos where data >= v_seg),
    'total',  (select count(*) from public.profiles where status = 'ativo' and papel = 'desbravador' and coalesce(teste, false) = false and public.clube_do_usuario(id) = public.clube_legado_id()),
    'ausentes', coalesce((
      select json_agg(json_build_object('id', p.id, 'nome', p.nome, 'foto', p.foto, 'ultimo', u.ultimo)
                      order by u.ultimo nulls first, p.nome)
      from public.profiles p
      left join (select usuario_id, max(data) ultimo from public.trilha_jogos group by usuario_id) u on u.usuario_id = p.id
      where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false and public.clube_do_usuario(p.id) = public.clube_legado_id()
        and (u.ultimo is null or u.ultimo < v_hoje - 1)
    ), '[]'::json)
  );
end;
$function$;



-- ACL: nenhuma função nova ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-correcoes-da-revisao.sql')
on conflict (arquivo) do update set aplicada_em = now();
