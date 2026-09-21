-- =====================================================================
-- Correções das revisões independentes da RODADA 2 (segurança red-team + regressão Tenant 001).
-- Rodar DEPOIS da 20260921000027. Idempotente. Cada item foi reproduzido em teste (21 e 22) antes de corrigir.
--
--  1) ALTO  — um diretor de qualquer clube travava o cron de leilão de TODOS: ponto gigante estourava o int
--     do somatório e o laço do cron não isolava a falha de um leilão. Agora: teto de pontos, somas limitadas,
--     valores de leilão razoáveis e cada leilão fecha na sua própria subtransação.
--  2) Falha de cron por clube agora fica REGISTRADA (cron_falhas), em vez de só um WARNING.
--  3) Bucket público "imagens": só imagem, com teto de tamanho.
--  4) Push: o aparelho segue o usuário logado (push_registrar); endpoint só https (SSRF cego pela Edge Function).
--  5) authenticated/anon perdem TRUNCATE/TRIGGER/REFERENCES (TRUNCATE ignorava o RLS e atingia todos os clubes).
--  6) Instrutor tentando cargos de liderança: ERRO CLARO (antes: cargo revertido em silêncio, mas a unidade era apagada).
-- =====================================================================

-- ==================== 1) pontos: teto que impede estourar somatórios ====================
alter table public.pontos drop constraint if exists pontos_valor_razoavel;
alter table public.pontos add constraint pontos_valor_razoavel check (pontos between -1000000 and 1000000) not valid;
do $m$
begin
  begin
    alter table public.pontos validate constraint pontos_valor_razoavel;
  exception when others then
    raise warning 'pontos_valor_razoavel: já existem linhas fora do teto (a regra vale só para as novas): %', sqlerrm;
  end;
end $m$;

-- ==================== 2) registro das falhas de cron ====================
create table if not exists public.cron_falhas (
  id bigserial primary key,
  quando timestamptz not null default now(),
  rotina text not null,
  club_id uuid references public.organizational_units(id) on delete set null,
  erro text
);
do $m$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cron_falhas'::regclass and contype = 'f') then
    alter table public.cron_falhas
      add constraint cron_falhas_club_id_fkey foreign key (club_id) references public.organizational_units(id) on delete set null;
  end if;
end $m$;
alter table public.cron_falhas enable row level security;
revoke all on public.cron_falhas from public, anon, authenticated;
revoke all on sequence public.cron_falhas_id_seq from public, anon, authenticated;

create or replace function public._cron_registrar_falha(p_rotina text, p_club_id uuid, p_erro text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cron_falhas (rotina, club_id, erro) values (p_rotina, p_club_id, left(coalesce(p_erro, ''), 1000));
  delete from public.cron_falhas where quando < now() - interval '90 days';
end;
$$;
revoke all on function public._cron_registrar_falha(text, uuid, text) from public, anon, authenticated;

-- o fechamento automático do leilão: cada leilão na sua subtransação, do mais antigo ao mais novo
create or replace function public.fechar_leiloes_vencidos() returns void
language plpgsql security definer set search_path = '' as $$
declare v_leilao record;
begin
  for v_leilao in
    select id, club_id from public.leiloes where status = 'aberto' and fecha_em <= now()
    order by created_at, id for update skip locked
  loop
    begin
      perform public._leilao_fechar_core(v_leilao.id);
    exception when others then
      perform public._cron_registrar_falha('fechar_leiloes_vencidos', v_leilao.club_id, sqlerrm);
      raise warning 'fechar_leiloes_vencidos: o leilão % (clube %) falhou e foi pulado: %', v_leilao.id, v_leilao.club_id, sqlerrm;
    end;
  end loop;
end;
$$;

-- ==================== 3) bucket público de imagens ====================
update storage.buckets
   set file_size_limit = 15 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
 where id = 'imagens';

-- ==================== 4) push ====================
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_https;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_https
  check (endpoint ~ '^https://' and length(endpoint) <= 2048) not valid;
do $m$
begin
  begin
    alter table public.push_subscriptions validate constraint push_subscriptions_endpoint_https;
  exception when others then
    raise warning 'push_subscriptions_endpoint_https: já existem endpoints fora do padrão (a regra vale só para os novos): %', sqlerrm;
  end;
end $m$;

-- o aparelho passa a ser de quem está logado (o front chama ao entrar; ao sair, apaga a inscrição do usuário que saiu)
create or replace function public.push_registrar(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2048 then
    raise exception 'Endpoint de push inválido (precisa ser https).';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke all on function public.push_registrar(text, text, text) from public, anon;
grant execute on function public.push_registrar(text, text, text) to authenticated;

-- o mesmo para o app Android (token do FCM)
create or replace function public.push_token_registrar(p_token text, p_plataforma text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 4096 then
    raise exception 'Token de push inválido.';
  end if;
  insert into public.push_tokens (token, user_id, plataforma)
  values (p_token, v_uid, coalesce(nullif(p_plataforma, ''), 'android'))
  on conflict (token) do update set user_id = excluded.user_id, plataforma = excluded.plataforma;
end;
$$;
revoke all on function public.push_token_registrar(text, text) from public, anon;
grant execute on function public.push_token_registrar(text, text) to authenticated;

-- ==================== 5) privilégios de tabela ====================
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ==================== 6/1) funções (definição real do banco + as correções) e laços do cron com registro ====================
CREATE OR REPLACE FUNCTION public.criar_leilao(p_titulo text, p_fecha_em timestamp with time zone, p_itens jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_leilao_id uuid;
  v_item jsonb;
  v_ordem int := 0;
  v_nome text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode criar um leilão.'; end if;
  if not public.recurso_habilitado_no_clube(v_club, 'leilao') then raise exception 'O leilão não está habilitado neste clube.'; end if;
  if p_titulo is null or length(trim(p_titulo)) = 0 then raise exception 'Dê um título ao leilão.'; end if;
  if p_fecha_em is null or p_fecha_em <= now() then raise exception 'A data de encerramento precisa ser no futuro.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Cadastre ao menos 1 item.';
  end if;
  if exists (select 1 from public.leiloes where status = 'aberto' and club_id = v_club) then
    raise exception 'Já existe um leilão aberto. Encerre-o antes de criar outro.';
  end if;

  insert into public.leiloes (club_id, titulo, fecha_em, criado_por)
  values (v_club, trim(p_titulo), p_fecha_em, v_uid)
  returning id into v_leilao_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_nome := trim(coalesce(v_item->>'nome', ''));
    if length(v_nome) = 0 then raise exception 'Todo item precisa de um nome.'; end if;
    if coalesce((v_item->>'preco_base')::numeric, 0) > 1000000 or coalesce((v_item->>'incremento_minimo')::numeric, 0) > 1000000 then
      raise exception 'Valor do item alto demais (máx. 1.000.000 pontos).';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.leilao_itens (leilao_id, nome, emoji, descricao, preco_base, incremento_minimo, ordem)
    values (
      v_leilao_id, v_nome, v_item->>'emoji', v_item->>'descricao',
      greatest(0, coalesce((v_item->>'preco_base')::int, 0)),
      greatest(1, coalesce((v_item->>'incremento_minimo')::int, 5)),
      v_ordem
    );
  end loop;

  return json_build_object('id', v_leilao_id);
exception when unique_violation then
  raise exception 'Já existe um leilão aberto. Encerre-o antes de criar outro.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.dar_lance(p_item_id uuid, p_valor integer, p_unidades_extra uuid[] DEFAULT NULL::uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_leilao_id uuid; v_leilao_status text; v_fecha_em timestamptz;
  v_preco_base int; v_incremento int; v_nome_item text;
  v_maior_valor int;
  v_unidades uuid[];
  v_u uuid;
  v_saldo int;
  v_ja_reservado_aqui int;
  v_lance_id uuid;
  v_nome_unidade text;
  v_pendente boolean;
  v_meu_papel text;
  v_superadas uuid[];   -- unidades que estavam na frente (serão avisadas)
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  if p_valor is null or p_valor <= 0 or p_valor > 1000000 then raise exception 'Lance inválido.'; end if;

  select unidade_id, papel into v_minha_unidade, v_meu_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_minha_unidade is null then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra dar lance.';
  end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem dar lance no leilão.';
  end if;

  select array_agg(distinct u) into v_unidades
  from unnest(array[v_minha_unidade] || coalesce(p_unidades_extra, '{}'::uuid[])) as u;
  v_pendente := array_length(v_unidades, 1) > 1;

  select it.leilao_id, it.preco_base, it.incremento_minimo, it.nome
    into v_leilao_id, v_preco_base, v_incremento, v_nome_item
  from public.leilao_itens it where it.id = p_item_id and it.club_id = v_club;
  if v_leilao_id is null then raise exception 'Item não encontrado.'; end if;

  select status, fecha_em into v_leilao_status, v_fecha_em
  from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

  foreach v_u in array v_unidades loop
    if not exists (select 1 from public.unidades where id = v_u and club_id = v_club) then
      raise exception 'Uma das unidades convidadas não existe.';
    end if;
  end loop;

  select coalesce(max(valor), 0) into v_maior_valor
  from public.leilao_lances where item_id = p_item_id and status = 'ativo';

  if p_valor < v_preco_base then
    raise exception 'O lance mínimo desse item é % pontos.', v_preco_base;
  end if;
  if v_maior_valor > 0 and p_valor < v_maior_valor + v_incremento then
    raise exception 'Alguém já deu um lance maior. Dê pelo menos % pontos.', v_maior_valor + v_incremento;
  end if;

  if not v_pendente and exists (
    select 1 from public.leilao_lances l
    join public.leilao_lance_unidades lu on lu.lance_id = l.id
    where l.item_id = p_item_id and l.status = 'ativo' and lu.unidade_id = v_minha_unidade
  ) then
    raise exception 'Sua unidade já está na frente desse item.';
  end if;

  if v_pendente then
    insert into public.leilao_lances (item_id, criado_por, valor, status)
    values (p_item_id, v_uid, p_valor, 'pendente')
    returning id into v_lance_id;

    insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
    select v_lance_id, u, u = v_minha_unidade from unnest(v_unidades) as u;

    return json_build_object('id', v_lance_id, 'valor', p_valor, 'item', v_nome_item, 'pendente', true);
  end if;

  select public.leilao_saldo_unidade(v_minha_unidade) into v_saldo;
  select coalesce(sum(l.valor), 0) into v_ja_reservado_aqui
  from public.leilao_lances l
  join public.leilao_lance_unidades lu on lu.lance_id = l.id
  where l.item_id = p_item_id and l.status = 'ativo' and lu.unidade_id = v_minha_unidade;
  v_saldo := v_saldo + v_ja_reservado_aqui;
  if v_saldo < p_valor then
    select nome into v_nome_unidade from public.unidades where id = v_minha_unidade;
    raise exception 'Sua unidade (%) não tem % pontos disponíveis agora (tem %).',
      coalesce(v_nome_unidade, '?'), p_valor, v_saldo;
  end if;

  -- NOVO: guarda quais unidades estavam na frente (serão superadas agora)
  select array_agg(distinct lu.unidade_id) into v_superadas
  from public.leilao_lances l
  join public.leilao_lance_unidades lu on lu.lance_id = l.id
  where l.item_id = p_item_id and l.status = 'ativo' and lu.unidade_id <> v_minha_unidade;

  update public.leilao_lances set status = 'superado'
   where item_id = p_item_id and status = 'ativo';

  insert into public.leilao_lances (item_id, criado_por, valor, status)
  values (p_item_id, v_uid, p_valor, 'ativo')
  returning id into v_lance_id;

  insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
  values (v_lance_id, v_minha_unidade, true);

  -- NOVO: avisa os membros das unidades que acabaram de ser ultrapassadas
  if v_superadas is not null and array_length(v_superadas, 1) > 0 then
    select nome into v_nome_unidade from public.unidades where id = v_minha_unidade;
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    select '⚡ Passaram sua unidade no leilão!',
      coalesce(v_nome_unidade, 'Outra unidade') || ' deu um lance de ' || p_valor || ' no '
        || v_nome_item || '. Sua unidade caiu — dê um lance maior pra voltar à frente! 🏆',
      'geral', '/leilao', 'pessoal', p.id
    from public.profiles p
    where p.unidade_id = any(v_superadas) and p.unidade_id <> v_minha_unidade
      and p.status = 'ativo' and p.papel in ('desbravador', 'conselheiro');
  end if;

  return json_build_object('id', v_lance_id, 'valor', p_valor, 'item', v_nome_item, 'pendente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public._pontos_temporada_unidade_interno(p_unidade_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select coalesce((
             select least(coalesce(sum(p.pontos), 0), 1000000000)::int from public.pontos p
             join public.profiles pr on pr.id = p.usuario_id
             where p.club_id = u.club_id and pr.unidade_id = u.id and pr.status = 'ativo'
               and coalesce(p.data, '-infinity'::timestamptz) >= public.temporada_inicio_clube(u.club_id)
           ), 0)
         + coalesce((
             select least(coalesce(sum(p2.pontos), 0), 1000000000)::int from public.pontos p2
             where p2.club_id = u.club_id and p2.unidade_id = u.id and p2.usuario_id is null
               and coalesce(p2.data, '-infinity'::timestamptz) >= public.temporada_inicio_clube(u.club_id)
           ), 0)
    from public.unidades u where u.id = p_unidade_id
  ), 0);
$function$;

CREATE OR REPLACE FUNCTION public.ranking_totais()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ctx as (select public.clube_atual_id() as club, public.temporada_inicio() as ini)
  select case when public.membro_ativo_no_clube((select club from ctx)) then json_build_object(
    'pessoas', coalesce((
      select json_agg(json_build_object('id', usuario_id, 'total', total))
      from (select usuario_id, least(coalesce(sum(pontos), 0), 2147483647)::int as total from public.pontos
            where club_id = (select club from ctx)
              and usuario_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= (select ini from ctx)
            group by usuario_id) p), '[]'::json),
    'times', coalesce((
      select json_agg(json_build_object('id', unidade_id, 'total', total))
      from (select unidade_id, least(coalesce(sum(pontos), 0), 2147483647)::int as total from public.pontos
            where club_id = (select club from ctx)
              and usuario_id is null and unidade_id is not null
              and coalesce(data, '-infinity'::timestamptz) >= (select ini from ctx)
            group by unidade_id) t), '[]'::json)
  ) else json_build_object('pessoas', '[]'::json, 'times', '[]'::json) end;
$function$;

CREATE OR REPLACE FUNCTION public.meu_total_pontos()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ctx as (select public.clube_atual_id() as club, public.temporada_inicio() as ini)
  select least(coalesce(sum(pontos), 0), 2147483647)::int from public.pontos
  where usuario_id = auth.uid()
    and club_id = (select club from ctx)
    and coalesce(data, '-infinity'::timestamptz) >= (select ini from ctx);
$function$;

CREATE OR REPLACE FUNCTION public.protege_campos_perfil()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    if (new.papel is distinct from old.papel or new.status is distinct from old.status)
       and (old.papel = any(v_lider) or new.papel = any(v_lider)) then
      raise exception 'Só a diretoria promove a diretoria, instrutor ou tesoureiro, e só ela muda o cargo ou desativa quem já tem esses cargos.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.premiar_melhores_do_dia() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_dia date := ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')::date;
begin
  if v_dia >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cedo demais: esta função julga o dia que FECHOU — rode entre 00:00 e 11:59.';
  end if;
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._premiar_melhores_do_dia_clube(r.id);
    exception when others then
      perform public._cron_registrar_falha('premiar_melhores_do_dia', r.id, sqlerrm);
      raise warning 'premiar_melhores_do_dia: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.premiar_campeao_semana() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._premiar_campeao_semana_clube(r.id);
    exception when others then
      perform public._cron_registrar_falha('premiar_campeao_semana', r.id, sqlerrm);
      raise warning 'premiar_campeao_semana: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.lembrar_ausentes() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._lembrar_ausentes_clube(r.id);
    exception when others then
      perform public._cron_registrar_falha('lembrar_ausentes', r.id, sqlerrm);
      raise warning 'lembrar_ausentes: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.lembrar_jogos_do_dia() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._lembrar_jogos_do_dia_clube(r.id);
    exception when others then
      perform public._cron_registrar_falha('lembrar_jogos_do_dia', r.id, sqlerrm);
      raise warning 'lembrar_jogos_do_dia: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.premiar_rodada_semana() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._premiar_rodada_semana_clube(r.id);
    exception when others then
      perform public._cron_registrar_falha('premiar_rodada_semana', r.id, sqlerrm);
      raise warning 'premiar_rodada_semana: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.chefao_premiar() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._chefao_premiar_clube(r.id);
    exception when others then
      perform public._cron_registrar_falha('chefao_premiar', r.id, sqlerrm);
      raise warning 'chefao_premiar: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;



-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-correcoes-das-revisoes-da-rodada-2.sql')
on conflict (arquivo) do update set aplicada_em = now();
