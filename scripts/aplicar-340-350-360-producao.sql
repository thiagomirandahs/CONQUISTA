-- Aplica 340 -> 350 -> 360 em PRODUÇÃO numa única transação (colar inteiro no SQL Editor).
-- Aborta sem mudar nada se o ledger não estiver exatamente na 330 ou se o Tenant 001 sumir.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $g$ begin
  if (select max(version) from supabase_migrations.schema_migrations) <> '20260930000330' then
    raise exception 'ABORTADO: produção não está na 330 (está em %)', (select max(version) from supabase_migrations.schema_migrations);
  end if;
  if not exists (select 1 from public.organization_memberships m join public.organizational_units u on u.id=m.organizational_unit_id where u.slug='filhos-da-conquista' and m.status='ativo') then raise exception 'ABORTADO: Tenant 001 sem vínculos ativos'; end if;
end $g$;

-- ======================= 20260930000340_entrada-papel-pelo-tipo-de-cadastro =======================
-- =============================================================================
-- 340 — Entrada em clube: o papel do PEDIDO não lê mais profiles.papel
-- =============================================================================
-- Regressão achada pelo gate SQL 29 (28/09): entrada_solicitar_clube (migration 204) decidia se o
-- pedido pendente nascia 'pais' olhando profiles.papel. profiles.papel é só o ESPELHO do vínculo do
-- clube primário (gatilho vínculo -> perfil), então quem é 'pais' no clube A pedia o clube B e o
-- pedido herdava 'pais' do clube A — papel vindo de OUTRO clube. entrada_solicitar (migration 104)
-- tinha o mesmo desenho e estava só "declarado" como exceção no teste 29.
--
-- Correção: o que as duas funções queriam saber não é "qual o papel dele", e sim "esta conta foi
-- aberta como responsável?". Isso agora é um fato próprio, gravado UMA vez no cadastro:
--   profiles.tipo_cadastro  ('membro' | 'pais')
--   * escrito só pelo gatilho handle_new_user (security definer);
--   * authenticated não tem UPDATE nessa coluna e profiles não tem policy de INSERT;
--   * o espelho vínculo -> perfil NÃO toca nele (não depende de clube nenhum).
-- O resto do fluxo não muda: pedido sempre 'pendente', papel decidido no servidor (código do clube
-- ou 'desbravador'; 'pais' só para conta aberta como responsável), a diretoria aprova e pode ajustar
-- o papel em vinculo_gerir; vínculo com filho continua sendo o processo separado.
-- =============================================================================

alter table public.profiles
  add column if not exists tipo_cadastro text not null default 'membro'
  constraint profiles_tipo_cadastro_chk check (tipo_cadastro in ('membro', 'pais'));

comment on column public.profiles.tipo_cadastro is
  'Como a conta foi aberta (membro|pais). Gravado só no cadastro (handle_new_user); não é papel em clube nenhum.';

-- Backfill conservador: só é 'pais' quem se cadastrou como responsável (metadata do cadastro) E cujo
-- perfil ainda diz 'pais'. Na dúvida fica 'membro' — o pior caso é o pedido nascer 'desbravador' e a
-- diretoria ajustar na aprovação (nunca o contrário).
update public.profiles p
   set tipo_cadastro = 'pais'
  from auth.users u
 where u.id = p.id
   and u.raw_user_meta_data->>'tipo' = 'pais'
   and p.papel = 'pais'
   and p.tipo_cadastro <> 'pais';

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tipo text := v_meta->>'tipo';
  v_token text := v_meta->>'convite_responsavel';
  v_inv public.club_invites;
  v_club uuid;
begin
  if v_tipo = 'pais' and coalesce(v_token, '') <> '' then
    select * into v_inv from public.club_invites
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and revoked_at is null and expires_at > now()
     for update;
    if v_inv.id is null then raise exception 'Convite inválido, usado, revogado ou expirado.'; end if;
    v_club := v_inv.club_id;
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, papel, status, tipo_cadastro) values (new.id, v_meta->>'nome', 'pais', 'ativo', 'pais');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, 'pais', 'ativo', '{"source":"cadastro"}'::jsonb);
    update public.club_invites set used_at = now(), used_by = new.id where id = v_inv.id;
    perform set_config('app.signup_club', '', true);
    return new;
  end if;

  perform set_config('app.signup_sem_clube', '1', true);
  if v_tipo = 'pais' then
    insert into public.profiles (id, nome, papel, status, tipo_cadastro) values (new.id, v_meta->>'nome', 'pais', 'ativo', 'pais');
  else
    insert into public.profiles (id, nome, nascimento, cargo, papel, status, tipo_cadastro)
    values (new.id, v_meta->>'nome', (nullif(v_meta->>'nascimento', ''))::date,
            v_meta->>'cargo', 'desbravador', 'ativo', 'membro');
  end if;
  perform set_config('app.signup_sem_clube', '', true);
  return new;
end $function$;

create or replace function public.entrada_solicitar(p_codigo text)
 returns json
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_row public.club_entry_codes; v_ja public.organization_memberships; v_achou boolean;
        v_papel text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;

  select * into v_row from public.club_entry_codes
   where codigo_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   for update;
  v_achou := found;
  perform public._entrada_registrar_tentativa(v_achou);
  if not v_achou then return json_build_object('encontrado', false); end if;

  select * into v_ja from public.organization_memberships
   where user_id = v_uid and organizational_unit_id = v_row.club_id
   for update;
  if found then
    return json_build_object('encontrado', true, 'ok', true, 'ja_era', true, 'situacao', v_ja.status);
  end if;

  -- o papel NÃO vem do cliente nem de outro clube: é o do código, exceto para conta aberta como responsável
  v_papel := case when (select p.tipo_cadastro from public.profiles p where p.id = v_uid) = 'pais' then 'pais' else v_row.papel end;

  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_row.club_id, v_papel, 'pendente',
          jsonb_build_object('source', 'codigo_de_entrada', 'codigo_id', v_row.id));

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', 'pendente', 'papel', v_papel);
end $function$;

create or replace function public.entrada_solicitar_clube(p_slug text)
 returns json
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_club public.organizational_units; v_show public.club_showcase; v_ja public.organization_memberships; v_papel text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if public._entrada_excedeu_limite() then
    raise exception 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  end if;
  select * into v_club from public.organizational_units
   where slug = lower(btrim(coalesce(p_slug, ''))) and type = 'clube' and status = 'ativo';
  select * into v_show from public.club_showcase where club_id = v_club.id;
  if v_club.id is null or not public._vitrine_clube_listavel(v_club, v_show) then
    perform public._entrada_registrar_tentativa(false);
    return json_build_object('encontrado', false);
  end if;
  perform public._entrada_registrar_tentativa(true);

  select * into v_ja from public.organization_memberships where user_id = v_uid and organizational_unit_id = v_club.id for update;
  if found then
    return json_build_object('encontrado', true, 'ok', true, 'ja_era', true, 'situacao', v_ja.status, 'clube', v_club.nome);
  end if;

  -- papel decidido no servidor; nunca herdado do papel em outro clube (o papel do perfil é só espelho)
  v_papel := case when (select p.tipo_cadastro from public.profiles p where p.id = v_uid) = 'pais' then 'pais' else 'desbravador' end;
  insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
  values (v_uid, v_club.id, v_papel, 'pendente', jsonb_build_object('source', 'cadastro_escolheu_clube'));

  return json_build_object('encontrado', true, 'ok', true, 'ja_era', false, 'situacao', 'pendente', 'papel', v_papel, 'clube', v_club.nome);
end $function$;

-- create or replace preserva os grants; reafirma o fechamento a anon
revoke execute on function public.entrada_solicitar(text), public.entrada_solicitar_clube(text) from public, anon;

;
insert into supabase_migrations.schema_migrations(version,name) values ('20260930000340','entrada-papel-pelo-tipo-de-cadastro');

-- ======================= 20260930000350_premio-semanal-trava-por-clube =======================
-- =============================================================================
-- 350 — Prêmio do recorde da semana: uma execução por clube de cada vez
-- =============================================================================
-- Investigação do gate 30 (28/09): o prêmio NÃO tinha bug de regra (o vermelho era o teste rodando
-- segunda de manhã — ver o comentário no teste 30). Mas a auditoria achou uma janela real:
-- _premiar_campeao_semana_clube faz "já premiei esta semana?" (SELECT) e depois INSERT, sem trava.
-- Duas execuções simultâneas (cron + uma chamada manual do service_role) podiam as duas passar no
-- SELECT e pagar +20 duas vezes. Correção mínima: trava transacional por clube no começo. A segunda
-- execução espera a primeira terminar, aí vê o prêmio já dado e pula. Clubes diferentes não se
-- bloqueiam (a chave da trava é o club_id). Corpo da regra: idêntico ao da migration 35.
-- =============================================================================
create or replace function public._premiar_campeao_semana_clube(p_club_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  rjogo record; r record;
  v_max int; v_nome_jogo text; v_marca text; v_nomes text;
begin
  -- uma execução por clube de cada vez (a chave é o club_id; clubes diferentes não se esperam)
  perform pg_advisory_xact_lock(hashtextextended('premiar_campeao_semana:' || p_club_id::text, 0));
  for rjogo in select distinct jogo from public.recordes
               where club_id = p_club_id and semana = v_seg and jogo in ('reflexo', 'corrida') loop
    v_marca := rjogo.jogo || ' ' || to_char(v_seg, 'DD/MM/YYYY');
    if exists (select 1 from public.pontos
               where club_id = p_club_id and origem = 'campeao' and motivo like '%(' || v_marca || ')%') then
      continue;
    end if;
    select nome into v_nome_jogo from public._jogos_do_clube(p_club_id) where chave = rjogo.jogo;
    select max(r2.pontos) into v_max
    from public.recordes r2
    join public.organization_memberships m on m.user_id = r2.usuario_id and m.organizational_unit_id = p_club_id
    join public.profiles p on p.id = r2.usuario_id
    where r2.club_id = p_club_id and r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos > 0
      and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
      and (not public._reflexo_so_desbravador_clube(p_club_id) or m.role = 'desbravador');
    if v_max is null or v_max <= 0 then continue; end if;
    v_nomes := null;
    for r in
      select r2.usuario_id, p.nome
      from public.recordes r2
      join public.organization_memberships m on m.user_id = r2.usuario_id and m.organizational_unit_id = p_club_id
      join public.profiles p on p.id = r2.usuario_id
      where r2.club_id = p_club_id and r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos = v_max
        and m.status = 'ativo' and m.role <> 'pais' and coalesce(p.teste, false) = false
        and (not public._reflexo_so_desbravador_clube(p_club_id) or m.role = 'desbravador')
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo, club_id)
      values (r.usuario_id, 'campeao', 20,
        '🏆 Recorde da semana no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' (' || v_marca || ')', p_club_id);
      v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
    end loop;
    if v_nomes is null then continue; end if;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🏆 Recorde da semana!',
      v_nomes || ' fez o maior recorde no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' e levou +20 pontos!',
      'geral', '/trilha', 'todos', p_club_id);
  end loop;
end;
$function$;


revoke execute on function public._premiar_campeao_semana_clube(uuid) from public, anon, authenticated;

;
insert into supabase_migrations.schema_migrations(version,name) values ('20260930000350','premio-semanal-trava-por-clube');

-- ======================= 20260930000360_lideranca-ve-foto-de-tentativa-anterior =======================
-- =============================================================================
-- 360 — Liderança do clube abre a foto de uma TENTATIVA ANTERIOR do requisito
-- =============================================================================
-- Achado do E2E do fluxo pedagógico (28/09): a migration 87 passou a guardar cada tentativa em
-- requirement_submissions (histórico por tentativa, append-only), e a 330 deu à COORDENAÇÃO leitura
-- dessas fotos (coordenacao_ve_comprovacao já olha requirement_submissions). Mas a regra da
-- liderança do PRÓPRIO clube (lideranca_ve_comprovacao) continuou olhando só a evidência ATUAL
-- (member_requirements.evidencia_path). Resultado: depois de um "pedir correção → reenviar", o
-- instrutor/diretoria via no histórico a tentativa 1 com um caminho de foto que o Storage recusava
-- ("Object not found"), enquanto o distrito conseguia abrir a mesma foto.
--
-- Correção: acrescenta requirement_submissions, com a MESMA trava das outras fontes — só gestão do
-- clube em uso (pode_gerir_no_clube) e só linha do clube em uso (club_id = clube_atual_id()).
-- Não abre nada para outro clube, para coordenação (tem regra própria) nem para o anônimo.
-- =============================================================================
create or replace function public.lideranca_ve_comprovacao(p_objeto text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.member_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.requirement_submissions x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_specialty_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.entregas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.missoes_feitas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.devocional x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.experience_submissions x
        where x.arquivo_path = p_objeto and x.club_id = public.clube_atual_id()
     );
$function$;

;
insert into supabase_migrations.schema_migrations(version,name) values ('20260930000360','lideranca-ve-foto-de-tentativa-anterior');

do $g$ begin
  if not exists (select 1 from public.organization_memberships m join public.organizational_units u on u.id=m.organizational_unit_id where u.slug='filhos-da-conquista' and m.status='ativo') then
    raise exception 'ABORTADO: Tenant 001 sem vínculos ativos';
  end if;
end $g$;

commit;
select 'OK' as resultado, max(version) as ledger, (select count(*) from public.organization_memberships m join public.organizational_units u on u.id=m.organizational_unit_id where u.slug='filhos-da-conquista' and m.status='ativo') as ativos_filhos_da_conquista from supabase_migrations.schema_migrations;
