-- =====================================================================
-- config_clube POR CLUBE + provisionamento de clube novo.
-- Rodar DEPOIS da 20260921000019. Idempotente.
--
--  * config_clube ganha club_id; a chave primária passa a ser (club_id, chave). As linhas que já
--    existem (PIX, popup, rodízio, chefão, lembretes...) ficam no Tenant 001 exatamente como estão.
--  * membro (e responsável, que paga a mensalidade pelo PIX) lê a config do PRÓPRIO clube; só a
--    liderança do clube grava, só no próprio clube.
--  * config_valor/config_definir: helpers INTERNOS (as rotinas de banco leem/gravam a config do
--    clube certo, também no cron, onde não há usuário logado).
--  * config_gravar(jsonb): a RPC que o front usa (o upsert "on conflict (chave)" deixou de existir,
--    porque a mesma chave existe em vários clubes).
--  * provisionar_clube(): clube novo nasce com as chaves padrão (o Tenant 001 mantém as que já tem).
--  * As funções de jogo que liam config_clube "sem clube" passam a ler a do clube legado (Tenant 001,
--    comportamento idêntico ao de antes). Elas viram por-clube de verdade na migration dos jogos.
-- =====================================================================

-- ==================== A) tabela: club_id + chave primária composta ====================
alter table public.config_clube
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;

update public.config_clube set club_id = public.clube_legado_id() where club_id is null;

alter table public.config_clube alter column club_id set not null;
alter table public.config_clube alter column club_id set default public.clube_atual_id();

do $mig$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.config_clube'::regclass and conname = 'config_clube_pkey'
                and pg_get_constraintdef(oid) not like '%club_id%') then
    alter table public.config_clube drop constraint config_clube_pkey;
    alter table public.config_clube add constraint config_clube_pkey primary key (club_id, chave);
  end if;
end $mig$;

-- ==================== B) policies: cada clube enxerga e gere as SUAS chaves ====================
drop policy if exists "gerir config" on public.config_clube;
drop policy if exists "ler config" on public.config_clube;
drop policy if exists "membro le config do proprio clube" on public.config_clube;
drop policy if exists "lideranca grava config do proprio clube" on public.config_clube;

-- qualquer vínculo ativo (inclui o responsável: ele precisa do PIX para pagar a mensalidade)
create policy "membro le config do proprio clube" on public.config_clube for select to authenticated
using (public.tem_vinculo_unidade(club_id));
-- gravar: liderança (instrutor/diretoria) do clube, só no próprio clube (nem forjando club_id)
create policy "lideranca grava config do proprio clube" on public.config_clube for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id) and club_id = public.clube_atual_id());

-- ==================== C) helpers internos (rotinas de banco, inclusive cron) ====================
create or replace function public.config_valor(p_club_id uuid, p_chave text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select valor into v from public.config_clube where club_id = p_club_id and chave = p_chave;
  return v;
end;
$$;

create or replace function public.config_definir(p_club_id uuid, p_chave text, p_valor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, p_chave, p_valor)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$$;

revoke all on function public.config_valor(uuid, text) from public, anon, authenticated;
revoke all on function public.config_definir(uuid, text, text) from public, anon, authenticated;

-- ==================== D) RPC do front: gravar várias chaves de uma vez, no clube de quem chama ====================
create or replace function public.config_gravar(p_linhas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_l jsonb;
  v_chave text;
  v_valor text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then
    raise exception 'Sem permissão (apenas a liderança do clube).';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: envie uma lista de {chave, valor}.';
  end if;
  if jsonb_array_length(p_linhas) > 50 then
    raise exception 'Linhas demais numa chamada (máx. 50).';
  end if;
  for v_l in select * from jsonb_array_elements(p_linhas) loop
    v_chave := v_l->>'chave';
    v_valor := coalesce(v_l->>'valor', '');
    if v_chave is null or v_chave !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception 'Chave de configuração inválida.';
    end if;
    if length(v_valor) > 5000 then
      raise exception 'Valor grande demais (máx. 5000 caracteres).';
    end if;
    perform public.config_definir(v_club, v_chave, v_valor);
  end loop;
end;
$$;
revoke all on function public.config_gravar(jsonb) from public, anon;
grant execute on function public.config_gravar(jsonb) to authenticated;

-- ==================== E) provisionamento de clube novo ====================
-- O clube legado (Tenant 001) NÃO é tocado: mantém exatamente o que já tem (ausente = padrão do código).
-- REGISTRO: provisionar_clube() executa, em ordem de nome, toda função "_prov_<módulo>(uuid)" — cada módulo
-- (config, duelos, jogos, chat...) cria a sua e o clube novo nasce completo sem editar esta função.
create or replace function public._prov_config(p_club_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- mesmos valores que os SQLs legados semeavam no clube atual
  insert into public.config_clube (club_id, chave, valor) values
    (p_club_id, 'pix', ''),
    (p_club_id, 'reflexo_so_desbravador', 'sim'),
    (p_club_id, 'jogo_da_semana', 'memoria'),
    (p_club_id, 'rodizio_jogos', 'nao'),
    (p_club_id, 'exigir_partida', 'nao'),
    (p_club_id, 'chefao_ativo', 'nao')
  on conflict (club_id, chave) do nothing;
end;
$$;

create or replace function public.provisionar_clube(p_club_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if p_club_id is null or p_club_id = public.clube_legado_id() then
    return;
  end if;
  for r in select p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like '\_prov\_%'
              and pg_get_function_identity_arguments(p.oid) = 'p_club_id uuid'
            order by p.proname loop
    execute format('select public.%I($1)', r.proname) using p_club_id;
  end loop;
end;
$$;
revoke all on function public._prov_config(uuid) from public, anon, authenticated;
revoke all on function public.provisionar_clube(uuid) from public, anon, authenticated;

create or replace function public.trg_provisionar_clube() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.provisionar_clube(new.id);
  return new;
end;
$$;
revoke all on function public.trg_provisionar_clube() from public, anon, authenticated;

drop trigger if exists trg_provisionar_clube on public.organizational_units;
create trigger trg_provisionar_clube after insert on public.organizational_units
for each row when (new.type = 'clube') execute function public.trg_provisionar_clube();

select public.provisionar_clube(id) from public.organizational_units where type = 'clube';

-- ==================== F) interruptores lidos por rotinas (cron e usuário) ====================
-- _x_clube(p_club): interno (cron passa o clube). x(): o clube de quem chama (transitório: sem sessão = clube legado,
-- porque as rotinas de cron ainda são do Tenant 001 — a migration dos jogos passa o clube explicitamente).
drop function if exists public.rodizio_ligado();
create or replace function public._rodizio_ligado_clube(p_club_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce(public.config_valor(p_club_id, 'rodizio_jogos'), 'sim') = 'sim';
end;
$$;
create or replace function public.rodizio_ligado() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public._rodizio_ligado_clube(coalesce(public.clube_atual_id(), public.clube_legado_id()));
end;
$$;

drop function if exists public.reflexo_so_desbravador();
create or replace function public._reflexo_so_desbravador_clube(p_club_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce(public.config_valor(p_club_id, 'reflexo_so_desbravador') = 'sim', false);
end;
$$;
create or replace function public.reflexo_so_desbravador() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public._reflexo_so_desbravador_clube(coalesce(public.clube_atual_id(), public.clube_legado_id()));
end;
$$;
revoke all on function public._rodizio_ligado_clube(uuid) from public, anon, authenticated;
revoke all on function public._reflexo_so_desbravador_clube(uuid) from public, anon, authenticated;

-- ==================== G) funções de jogo/chefão: leem a config do clube LEGADO (Tenant 001) ====================
CREATE OR REPLACE FUNCTION public.chefao_config(p_nome text, p_emoji text, p_vida integer, p_versiculo text, p_inicio date, p_ativo boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_antes boolean := coalesce(public.config_valor(public.clube_atual_id(), 'chefao_ativo'), 'nao') = 'sim';
begin
  if not public.pode_gerir() then raise exception 'Só a liderança configura o chefão.'; end if;
  if p_ativo then
    if coalesce(trim(p_nome), '') = '' then raise exception 'Dê um nome ao chefão.'; end if;
    if p_inicio is null then raise exception 'Escolha a data de início (o sábado).'; end if;
    if coalesce(p_vida, 0) < 100 or coalesce(p_vida, 0) > 500000 then
      raise exception 'A vida do chefão deve ficar entre 100 e 500000.';
    end if;
  end if;

  insert into public.config_clube (club_id, chave, valor) values
    (public.clube_atual_id(), 'chefao_nome', coalesce(trim(p_nome), 'Chefão')),
    (public.clube_atual_id(), 'chefao_emoji', coalesce(nullif(trim(p_emoji), ''), '🗿')),
    (public.clube_atual_id(), 'chefao_vida', coalesce(p_vida, 3000)::text),
    (public.clube_atual_id(), 'chefao_versiculo', nullif(trim(coalesce(p_versiculo, '')), '')),
    (public.clube_atual_id(), 'chefao_inicio', case when p_inicio is null then null else p_inicio::text end),
    (public.clube_atual_id(), 'chefao_ativo', case when p_ativo then 'sim' else 'nao' end)
  on conflict (club_id, chave) do update set valor = excluded.valor;

  -- ligar de novo pra uma NOVA data limpa o "já pago" da rodada anterior
  if p_ativo then
    delete from public.config_clube where club_id = public.clube_atual_id() and chave = 'chefao_pago'
      and valor is distinct from p_inicio::text;
  end if;

  -- avisa o clube (push/sino) SÓ quando LIGA (não a cada edição)
  if p_ativo and not v_antes then
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('⚔️ ' || coalesce(trim(p_nome), 'Um chefão') || ' apareceu!',
      'Um chefão surgiu pro fim de semana — o clube TODO precisa se unir pra derrotá-lo! Jogue, cumpra missões, leia a Bíblia e dê o golpe especial. 🗡️',
      'geral', '/chefao', 'todos');
  end if;

  return json_build_object('ok', true, 'ativo', p_ativo);
end;
$function$;

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

  v_ativo := coalesce(public.config_valor(public.clube_atual_id(), 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(public.clube_atual_id(), 'chefao_inicio');
  if not v_ativo or v_inicio is null then return json_build_object('ativo', false); end if;

  v_vida := greatest(1, coalesce(public.config_valor(public.clube_atual_id(), 'chefao_vida'), '3000')::int);
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
    'nome', coalesce(public.config_valor(public.clube_atual_id(), 'chefao_nome'), 'Chefão'),
    'emoji', coalesce(public.config_valor(public.clube_atual_id(), 'chefao_emoji'), '🗿'),
    'versiculo', public.config_valor(public.clube_atual_id(), 'chefao_versiculo'),
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

  v_ativo := coalesce(public.config_valor(public.clube_atual_id(), 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(public.clube_atual_id(), 'chefao_inicio');
  if not v_ativo or v_inicio is null then raise exception 'Não tem chefão agora. 🙂'; end if;

  v_vida := greatest(1, coalesce(public.config_valor(public.clube_atual_id(), 'chefao_vida'), '3000')::int);
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

CREATE OR REPLACE FUNCTION public.registrar_jogo(p_tipo text, p_estrelas integer, p_partida uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_estrelas int := greatest(1, least(3, coalesce(p_estrelas, 1)));
  v_tipo text := coalesce(nullif(p_tipo, ''), 'memoria');
  v_ja int;
  v_pontos int;
  v_passos int;
  v_ini timestamptz;
  v_seg numeric;
  v_exigir boolean := coalesce(public.config_valor(public.clube_atual_id(), 'exigir_partida'), 'nao') = 'sim';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public.jogos_trilha where chave = v_tipo) then
    raise exception 'Jogo inválido.';
  end if;
  if v_tipo in ('reflexo', 'corrida') then
    raise exception 'Esse jogo é de recorde — jogue pelo ⚡/🏕️!';
  end if;
  if public.eh_teste() then
    return json_build_object('pontos', 0, 'estrelas', v_estrelas, 'passos', 0, 'extra', false, 'teste', true);
  end if;

  if exists (select 1 from public.trilha_jogos
             where usuario_id = v_uid and data = v_hoje and tipo = v_tipo) then
    raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
  end if;

  if p_partida is not null then
    update public.partidas
       set consumida_em = now(), resultado = v_estrelas
     where id = p_partida and usuario_id = v_uid and jogo = v_tipo
       and consumida_em is null and now() <= validade_em
     returning iniciado_em into v_ini;
    if not found then
      raise exception 'Partida inválida ou expirada — abra o jogo de novo. 🙂';
    end if;
    v_seg := extract(epoch from (now() - v_ini));
    if v_estrelas >= 2 and v_seg < public._min_segundos_jogo(v_tipo) then
      raise exception 'Rápido demais — jogue de verdade! 🙂';
    end if;
  else
    if v_exigir then
      raise exception 'Feche e abra o app pra atualizar, aí é só jogar de novo. 🙂';
    end if;
    if public.rodizio_ligado()
       and not exists (select 1 from public.jogos_do_dia(v_hoje) d where d.chave = v_tipo)
       and not exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje)
       and not ((now() at time zone 'America/Sao_Paulo')::time < time '00:10'
                and (exists (select 1 from public.jogos_do_dia(v_hoje - 1) d where d.chave = v_tipo)
                     or exists (select 1 from public.jogos_liberados l where l.chave = v_tipo and l.data = v_hoje - 1))) then
      raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_hoje::text));

  select count(*) into v_ja
  from public.trilha_jogos where usuario_id = v_uid and data = v_hoje;

  v_pontos := v_estrelas * 10;   -- <<< era * 5 (agora 1⭐=10, 2⭐=20, 3⭐=30)

  insert into public.trilha_jogos (usuario_id, data, tipo, estrelas)
  values (v_uid, v_hoje, v_tipo, v_estrelas);

  insert into public.pontos (usuario_id, origem, pontos, motivo)
  values (v_uid, 'trilha', v_pontos,
          'Jogo ' || v_tipo || ' ' || to_char(v_hoje, 'DD/MM') || ' (' || v_estrelas || '⭐)');

  select count(*) into v_passos from public.trilha_jogos where usuario_id = v_uid;

  return json_build_object(
    'pontos', v_pontos, 'estrelas', v_estrelas, 'passos', v_passos, 'extra', (v_ja > 0)
  );
exception when unique_violation then
  raise exception 'Você já jogou esse jogo hoje! Escolha outro 🙂';
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_recorde(p_jogo text, p_pontos integer, p_partida uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
  v_pts int := greatest(0, least(coalesce(p_pontos, 0), 500));
  v_antigo int;
  p record;
  v_dur numeric;
  v_exigir boolean := coalesce(public.config_valor(public.clube_atual_id(), 'exigir_partida'), 'nao') = 'sim';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.eh_membro_ativo() then
    return json_build_object('recorde', v_pts, 'melhorou', false);
  end if;
  if public.eh_teste() then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'teste', true);
  end if;
  if not exists (select 1 from public.jogos_trilha where chave = p_jogo) then
    raise exception 'Jogo inválido.';
  end if;
  -- SÓ arcade tem recorde. Sem isto, dava pra semear um recorde mínimo em cada
  -- jogo NÃO-arcade e o prêmio de domingo (premiar_campeao_semana) pagaria +20
  -- por jogo (~+440/semana). A UI só cria recorde de reflexo/corrida, então
  -- isto não muda nada pro jogador legítimo.
  if p_jogo not in ('reflexo', 'corrida') then
    raise exception 'Esse jogo não é de recorde.';
  end if;

  if p_partida is not null then
    select * into p from public.partidas
     where id = p_partida and usuario_id = v_uid and jogo = p_jogo
       and now() <= validade_em
     for update;
    if not found then
      raise exception 'Partida inválida ou expirada — abra o jogo de novo. 🙂';
    end if;
    -- duração DESTA corrida = desde o envio anterior (ou desde o início).
    -- (raise desfaz a transação, então não gravamos 'suspeita' — seria rollback.)
    v_dur := extract(epoch from (now() - coalesce(p.ultima_submissao_em, p.iniciado_em)));
    if v_dur < 3 then
      raise exception 'Rápido demais — jogue de verdade! 🙂';
    end if;
    if v_pts > public._max_pontos_arcade(p_jogo, v_dur) then
      raise exception 'Esse resultado não bate com o tempo de jogo. 🙂';
    end if;
    update public.partidas
       set ultima_submissao_em = now(),
           resultado = greatest(coalesce(resultado, 0), v_pts)
     where id = p_partida;
  elsif v_exigir then
    raise exception 'Feche e abra o app pra atualizar, aí é só jogar de novo. 🙂';
  end if;

  -- Liderança barrada: joga normal, mas o recorde não entra na competição
  if public.reflexo_so_desbravador()
     and not exists (select 1 from public.profiles where id = v_uid and papel = 'desbravador') then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'fora', true);
  end if;

  select pontos into v_antigo from public.recordes
  where usuario_id = v_uid and jogo = p_jogo and semana = v_seg;

  insert into public.recordes (usuario_id, jogo, semana, pontos)
  values (v_uid, p_jogo, v_seg, v_pts)
  on conflict (usuario_id, jogo, semana)
  do update set pontos = greatest(public.recordes.pontos, excluded.pontos),
                atualizado_em = now();

  return json_build_object(
    'recorde', greatest(coalesce(v_antigo, 0), v_pts),
    'melhorou', v_pts > coalesce(v_antigo, 0)
  );
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
  v_ativo := coalesce(public.config_valor(public.clube_legado_id(), 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(public.clube_legado_id(), 'chefao_inicio');
  if not v_ativo or v_inicio is null then return; end if;
  if public.config_valor(public.clube_legado_id(), 'chefao_pago') is not distinct from v_inicio then return; end if;

  v_vida := greatest(1, coalesce(public.config_valor(public.clube_legado_id(), 'chefao_vida'), '3000')::int);
  v_nome := coalesce(public.config_valor(public.clube_legado_id(), 'chefao_nome'), 'Chefão');
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

  insert into public.config_clube (club_id, chave, valor) values (public.clube_legado_id(), 'chefao_pago', v_inicio)
  on conflict (club_id, chave) do update set valor = excluded.valor;
  update public.config_clube set valor = 'nao' where club_id = public.clube_legado_id() and chave = 'chefao_ativo';
end;
$function$;

CREATE OR REPLACE FUNCTION public.lembrar_ausentes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  -- idempotência: no máximo 1x por dia
  if coalesce(public.config_valor(public.clube_legado_id(), 'lembrete_ausencia_dia'), '') = v_hoje::text then
    return;
  end if;
  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and public.clube_do_usuario(p.id) = public.clube_legado_id()
      -- 2+ dias sem jogar: nada ontem nem hoje
      and not exists (select 1 from public.trilha_jogos t where t.usuario_id = p.id and t.data >= v_hoje - 1)
      -- não repetir: não lembrado nos últimos 2 dias
      and not exists (
        select 1 from public.notificacoes n
        where n.para_usuario = p.id and n.titulo = '🎮 Sentimos sua falta!'
          and (n.created_at at time zone 'America/Sao_Paulo')::date >= v_hoje - 1
      )
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Sentimos sua falta!',
      'Já faz uns dias que você não joga! Vem ganhar pontos — tem jogo novo te esperando. 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;
  insert into public.config_clube (club_id, chave, valor) values (public.clube_legado_id(), 'lembrete_ausencia_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lembrar_jogos_do_dia()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public.rodizio_ligado();
  v_total int;
  r record;
begin
  if coalesce(public.config_valor(public.clube_legado_id(), 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;
  create temp table if not exists _abertos_lembrete (chave text primary key) on commit drop;
  delete from _abertos_lembrete;
  if v_on then
    insert into _abertos_lembrete
      select q.chave from (
        select d.chave from public.jogos_do_dia(v_hoje) d
        union
        select l.chave from public.jogos_liberados l
        join public.jogos_trilha j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public.jogos_trilha jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_lembrete
      select j.chave from public.jogos_trilha j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;
  select count(*) into v_total from _abertos_lembrete;
  if v_total = 0 then return; end if;
  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and public.clube_do_usuario(p.id) = public.clube_legado_id()
      and (
        select count(distinct t.tipo) from public.trilha_jogos t
        where t.usuario_id = p.id and t.data = v_hoje
          and t.tipo in (select chave from _abertos_lembrete)
      ) < v_total
  loop
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario)
    values ('🎮 Ainda dá tempo de jogar!',
      'Complete os jogos de hoje e ganhe o bônus do dia! 🎁',
      'geral', '/trilha', 'pessoal', r.id);
  end loop;
  insert into public.config_clube (club_id, chave, valor) values (public.clube_legado_id(), 'lembrete_jogos_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$function$;

CREATE OR REPLACE FUNCTION public.premiar_melhores_do_dia()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dia date := ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')::date;
  rjogo record;
  r record;
  v_marca text;
  v_nomes text := null;
  v_premiados uuid[] := array[]::uuid[];
  v_so_desb boolean := coalesce((public.config_valor(public.clube_legado_id(), 'reflexo_so_desbravador') = 'sim'), false);
begin
  -- interruptor desligado = sem trio, sem +10 (os jogos estavam todos abertos)
  if not public.rodizio_ligado() then return; end if;

  if v_dia >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Cedo demais: esta função julga o dia que FECHOU — rode entre 00:00 e 11:59.';
  end if;

  perform pg_advisory_xact_lock(hashtext('melhores-do-dia:' || v_dia::text));

  insert into public.jogos_liberados (chave, data)
  select c.valor, (now() at time zone 'America/Sao_Paulo')::date
  from public.config_clube c
  join public.jogos_trilha j on j.chave = c.valor and j.ativo
  where c.club_id = public.clube_legado_id() and c.chave = 'jogo_da_semana' and c.valor not in ('reflexo', 'corrida')
  on conflict (chave, data) do nothing;

  for rjogo in select d.chave, d.nome from public.jogos_do_dia(v_dia) d loop
    v_marca := rjogo.chave || ' ' || to_char(v_dia, 'DD/MM/YYYY');

    if exists (
      select 1 from public.pontos
      where origem = 'melhor_dia' and motivo like '%(' || v_marca || ')%'
    ) then
      continue;
    end if;

    select t.usuario_id, p.nome, t.estrelas into r
    from public.trilha_jogos t
    join public.profiles p on p.id = t.usuario_id
    where t.data = v_dia and t.tipo = rjogo.chave
      and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
      and (not v_so_desb or p.papel = 'desbravador')
      and not (t.usuario_id = any(v_premiados))
    order by t.estrelas desc, t.created_at asc nulls last, t.usuario_id
    limit 1;
    if not found then continue; end if;

    v_premiados := v_premiados || r.usuario_id;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (r.usuario_id, 'melhor_dia', 10,
      '🥇 Melhor do dia no ' || rjogo.nome || ' — ' || r.estrelas || '★ (' || v_marca || ')');
    v_nomes := coalesce(v_nomes || ' · ', '') || coalesce(r.nome, 'Alguém') || ' no ' || rjogo.nome;
  end loop;

  if v_nomes is not null then
    insert into public.notificacoes (titulo, corpo, tipo, link, para)
    values ('🥇 Melhores do dia!',
      'Ontem: ' || v_nomes || ' — +10 pontos cada! Os Jogos do Dia de hoje já estão valendo. 🏃',
      'geral', '/trilha', 'todos');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.premiar_rodada_semana()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- segunda-feira da semana que FECHOU (âncora -12h: vale rodando dom 23:55 ou
  -- seg de manhã, sempre julga a semana passada)
  v_seg date := (date_trunc('week', ((now() at time zone 'America/Sao_Paulo') - interval '12 hours')))::date;
  v_ini date := v_seg;         -- início (segunda, inclusivo)
  v_fim date := v_seg + 7;     -- fim (segunda seguinte, exclusivo)
  v_marca text := to_char(v_seg, 'DD/MM/YYYY');
  -- mesmo interruptor do reflexo (lido direto da config, sem depender da função)
  v_so_desb boolean := coalesce(
    (public.config_valor(public.clube_legado_id(), 'reflexo_so_desbravador') = 'sim'), false);
  v_max int;
  v_nomes text;
  v_jogo text;
  v_nome_jogo text;
  v_prox text;
  v_nome_prox text;
  r record;
begin
  -- TRAVA DE CONCORRÊNCIA: se duas execuções acontecerem juntas (cron + rodar
  -- à mão, ou o cron disparar 2x), a 2ª espera a 1ª terminar e só então segue —
  -- aí já enxerga o que foi pago e não repete. (Mesmo truque do registrar_jogo.)
  perform pg_advisory_xact_lock(hashtext('rodada_semana'));

  -- ===================================================================
  -- 🌟 CAMPEÃO DAS ESTRELAS DA SEMANA (+30)
  --    Idempotência: só paga se ainda não existe o lançamento desta semana.
  --    (exclui 'reflexo' da soma — ele pontua por recorde, não por estrela)
  -- ===================================================================
  if not exists (
    select 1 from public.pontos
    where origem = 'campeao'
      and motivo = '🌟 Campeão das estrelas da semana (' || v_marca || ')'
  ) then
    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.profiles p on p.id = t.usuario_id
      where t.data >= v_ini and t.data < v_fim and t.tipo not in ('reflexo', 'corrida')
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not v_so_desb or p.papel = 'desbravador')
      group by t.usuario_id
    ) q;

    if v_max is not null and v_max > 0 then
      v_nomes := null;
      for r in
        select t.usuario_id, min(p.nome) as nome
        from public.trilha_jogos t
        join public.profiles p on p.id = t.usuario_id
        where t.data >= v_ini and t.data < v_fim and t.tipo not in ('reflexo', 'corrida')
          and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
          and (not v_so_desb or p.papel = 'desbravador')
        group by t.usuario_id
        having sum(t.estrelas) = v_max
      loop
        insert into public.pontos (usuario_id, origem, pontos, motivo)
        values (r.usuario_id, 'campeao', 30,
          '🌟 Campeão das estrelas da semana (' || v_marca || ')');
        v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
      end loop;

      if v_nomes is not null then
        insert into public.notificacoes (titulo, corpo, tipo, link, para)
        values ('🌟 Campeão das estrelas!',
          v_nomes || ' foi quem mais fez estrelas nos jogos essa semana e levou +30 pontos!',
          'geral', '/trilha', 'todos');
      end if;
    end if;
  end if;

  -- ===================================================================
  -- 🎲 JOGO DA SEMANA — o jogo que estava valendo (lido da config)
  -- ===================================================================
  v_jogo := public.config_valor(public.clube_legado_id(), 'jogo_da_semana');

  -- (a) premia o melhor no jogo da semana (+20). Idempotência por SEMANA e
  --     baseada nos pontos já lançados: mesmo que o jogo já tenha rodado pra
  --     o próximo, isto não paga o jogo errado nem paga de novo.
  if v_jogo is not null and v_jogo <> ''
     and not exists (
       select 1 from public.pontos
       where origem = 'campeao'
         and motivo like '🎲 Campeão do jogo da semana:%(' || v_marca || ')'
     ) then
    select nome into v_nome_jogo from public.jogos_trilha where chave = v_jogo;

    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.profiles p on p.id = t.usuario_id
      where t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not v_so_desb or p.papel = 'desbravador')
      group by t.usuario_id
    ) q;

    if v_max is not null and v_max > 0 then
      v_nomes := null;
      for r in
        select t.usuario_id, min(p.nome) as nome
        from public.trilha_jogos t
        join public.profiles p on p.id = t.usuario_id
        where t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
          and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
          and (not v_so_desb or p.papel = 'desbravador')
        group by t.usuario_id
        having sum(t.estrelas) = v_max
      loop
        insert into public.pontos (usuario_id, origem, pontos, motivo)
        values (r.usuario_id, 'campeao', 20,
          '🎲 Campeão do jogo da semana: ' || coalesce(v_nome_jogo, v_jogo) || ' (' || v_marca || ')');
        v_nomes := coalesce(v_nomes || ', ', '') || coalesce(r.nome, 'Alguém');
      end loop;

      if v_nomes is not null then
        insert into public.notificacoes (titulo, corpo, tipo, link, para)
        values ('🎲 Campeão do jogo da semana!',
          v_nomes || ' foi o melhor no ' || coalesce(v_nome_jogo, v_jogo) || ' e levou +20 pontos!',
          'geral', '/trilha', 'todos');
      end if;
    end if;
  end if;

  -- (b) sorteia o jogo da PRÓXIMA semana (uma vez por semana). Se já rodou o
  --     sorteio desta semana, não mexe. Pior caso de re-sorteio só troca o jogo
  --     de novo — nunca mexe em pontos.
  if coalesce(public.config_valor(public.clube_legado_id(), 'jogo_semana_rodada'), '') <> v_marca then
    -- de preferência um jogo ativo diferente do reflexo E do desta semana
    select chave into v_prox
    from public.jogos_trilha
    where ativo = true and chave not in ('reflexo', 'corrida') and chave <> coalesce(v_jogo, '')
    order by random() limit 1;

    -- se não sobrou opção diferente, aceita repetir (só não jogos de recorde)
    if v_prox is null then
      select chave into v_prox
      from public.jogos_trilha
      where ativo = true and chave not in ('reflexo', 'corrida')
      order by random() limit 1;
    end if;

    if v_prox is not null then
      insert into public.config_clube (club_id, chave, valor) values (public.clube_legado_id(), 'jogo_da_semana', v_prox)
      on conflict (club_id, chave) do update set valor = excluded.valor;

      select nome into v_nome_prox from public.jogos_trilha where chave = v_prox;
      insert into public.notificacoes (titulo, corpo, tipo, link, para)
      values ('🎲 Novo jogo da semana!',
        'Essa semana o jogo que vale prêmio é o ' || coalesce(v_nome_prox, v_prox)
        || '! Quem fizer mais estrelas nele até domingo leva +20. 🏆',
        'geral', '/trilha', 'todos');
    end if;

    -- marca que o sorteio desta semana já foi feito
    insert into public.config_clube (club_id, chave, valor) values (public.clube_legado_id(), 'jogo_semana_rodada', v_marca)
    on conflict (club_id, chave) do update set valor = excluded.valor;
  end if;
end;
$function$;



-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-config-por-clube-e-provisionamento.sql')
on conflict (arquivo) do update set aplicada_em = now();
