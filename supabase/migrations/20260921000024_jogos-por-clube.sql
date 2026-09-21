-- =====================================================================
-- JOGOS POR CLUBE: trilha, partidas, recordes arcade, rodízio "Jogos do Dia", liberações, ajudas entre
-- amigos, chefão, catálogo (liga/desliga) e as rotinas de cron. Rodar DEPOIS da 20260921000023. Idempotente.
--
--  * jogos_trilha (catálogo com liga/desliga) vira POR CLUBE: PK (club_id, chave). Clube novo ganha o catálogo
--    (só o Jogo da Memória ligado); jogo NOVO entra em todos os clubes por catalogo_jogo_definir().
--  * trilha_jogos / partidas / recordes / chefao_golpes / ajudas / jogos_liberados carregam o clube do dono.
--  * Membro joga no PRÓPRIO clube; ranking, recordes, rodízio, chefão e ajuda só enxergam o clube dele;
--    a liderança gere só o clube dela. Cadastro pendente e responsável não jogam.
--  * Cron (melhores do dia, campeão da semana, rodada da semana, lembretes, chefão): uma rodada POR CLUBE,
--    com a config dele e prêmio/aviso no clube dele; um clube com problema não derruba os outros.
--  * Saem os gates do clube legado dessas tabelas. O Tenant 001 fica com o comportamento de antes.
-- =====================================================================

-- ==================== A) catálogo por clube ====================
alter table public.recordes drop constraint if exists recordes_jogo_fkey;
alter table public.jogos_liberados drop constraint if exists jogos_liberados_chave_fkey;

alter table public.jogos_trilha
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.jogos_trilha set club_id = public.clube_legado_id() where club_id is null;
alter table public.jogos_trilha alter column club_id set not null;
alter table public.jogos_trilha alter column club_id set default public.clube_atual_id();
do $mig$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.jogos_trilha'::regclass and conname = 'jogos_trilha_pkey'
               and pg_get_constraintdef(oid) not like '%club_id%') then
    alter table public.jogos_trilha drop constraint jogos_trilha_pkey;
    alter table public.jogos_trilha add constraint jogos_trilha_pkey primary key (club_id, chave);
  end if;
end $mig$;

alter table public.jogos_liberados
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.jogos_liberados set club_id = public.clube_legado_id() where club_id is null;
alter table public.jogos_liberados alter column club_id set not null;
do $mig$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.jogos_liberados'::regclass and conname = 'jogos_liberados_pkey'
               and pg_get_constraintdef(oid) not like '%club_id%') then
    alter table public.jogos_liberados drop constraint jogos_liberados_pkey;
    alter table public.jogos_liberados add constraint jogos_liberados_pkey primary key (club_id, chave, data);
  end if;
end $mig$;
alter table public.jogos_liberados drop constraint if exists jogos_liberados_jogo_fkey;
alter table public.jogos_liberados add constraint jogos_liberados_jogo_fkey
  foreign key (club_id, chave) references public.jogos_trilha (club_id, chave) on delete cascade;

-- ==================== B) tabelas por usuário: o registro nasce no clube do dono ====================
do $mig$
declare v_t text;
begin
  foreach v_t in array array['trilha_jogos', 'partidas', 'recordes', 'chefao_golpes'] loop
    execute format('alter table public.%I add column if not exists club_id uuid references public.organizational_units(id) on delete cascade', v_t);
    execute format('update public.%I x set club_id = coalesce(public.clube_vinculo_do_usuario(x.usuario_id), public.clube_legado_id()) where x.club_id is null', v_t);
    execute format('alter table public.%I alter column club_id set not null', v_t);
    execute format('drop trigger if exists trg_exigir_clube_legado on public.%I', v_t);
    execute format('drop trigger if exists trg_definir_club_por_usuario on public.%I', v_t);
    execute format('create trigger trg_definir_club_por_usuario before insert on public.%I for each row execute function public.definir_club_por_usuario(%L)', v_t, 'usuario_id');
  end loop;
end $mig$;
create index if not exists idx_trilha_jogos_club_data on public.trilha_jogos(club_id, data);
create index if not exists idx_partidas_club on public.partidas(club_id);
create index if not exists idx_recordes_club_semana on public.recordes(club_id, jogo, semana);
create index if not exists idx_chefao_golpes_club_tempo on public.chefao_golpes(club_id, criado_em desc);

alter table public.recordes drop constraint if exists recordes_jogo_fkey;
alter table public.recordes add constraint recordes_jogo_fkey
  foreign key (club_id, jogo) references public.jogos_trilha (club_id, chave);

-- ajuda entre amigos: quem pede e quem ajuda são do MESMO clube (o da pessoa que pede)
alter table public.ajudas
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.ajudas a set club_id = coalesce(public.clube_vinculo_do_usuario(a.de_id), public.clube_legado_id()) where a.club_id is null;
alter table public.ajudas alter column club_id set not null;
create index if not exists idx_ajudas_club on public.ajudas(club_id);
create or replace function public.definir_club_ajuda() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a uuid := public.clube_vinculo_do_usuario(new.de_id); v_b uuid := public.clube_vinculo_do_usuario(new.para_id);
begin
  if v_a is null or v_a is distinct from v_b then
    raise exception 'Ajuda só entre amigos do mesmo clube.';
  end if;
  new.club_id := v_a;
  return new;
end;
$$;
revoke all on function public.definir_club_ajuda() from public, anon, authenticated;
drop trigger if exists trg_exigir_clube_legado on public.ajudas;
drop trigger if exists trg_definir_club_ajuda on public.ajudas;
create trigger trg_definir_club_ajuda before insert on public.ajudas for each row execute function public.definir_club_ajuda();

-- ==================== C) helpers internos (as rotinas de banco passam o clube) ====================
create or replace function public._jogos_do_clube(p_club_id uuid) returns setof public.jogos_trilha
language sql stable security definer set search_path = '' as $$
  select * from public.jogos_trilha where club_id = p_club_id;
$$;
create or replace function public._jogos_liberados_do_clube(p_club_id uuid) returns setof public.jogos_liberados
language sql stable security definer set search_path = '' as $$
  select * from public.jogos_liberados where club_id = p_club_id;
$$;

-- os 3 jogos do dia (rodízio) de um clube: só jogos LIGADOS no catálogo dele
create or replace function public._jogos_do_dia_clube(p_club_id uuid, p_data date default null)
returns table (chave text, nome text, emoji text)
language sql stable security definer set search_path = '' as $$
  with ativos as (
    select j.chave, j.nome, j.emoji,
           row_number() over (order by md5('rodizio|' || j.chave)) - 1 as pos,
           count(*) over () as n
    from public.jogos_trilha j
    where j.club_id = p_club_id and j.ativo and j.chave not in ('reflexo', 'corrida')
  ), base as (
    select (coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date)
            - date '2026-01-05')::int as d
  )
  select a.chave, a.nome, a.emoji
  from ativos a, base b
  where ((a.pos - (b.d * 3) % a.n) % a.n + a.n) % a.n < least(3, a.n)
  order by ((a.pos - (b.d * 3) % a.n) % a.n + a.n) % a.n;
$$;
-- o de quem chama (o clube dele)
create or replace function public.jogos_do_dia(p_data date default null)
returns table (chave text, nome text, emoji text)
language sql stable security definer set search_path = '' as $$
  select * from public._jogos_do_dia_clube(public.clube_atual_id(), p_data);
$$;

-- interruptores: SEM o "transitório" da migration 20 (o cron agora passa o clube)
create or replace function public.rodizio_ligado() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public._rodizio_ligado_clube(public.clube_atual_id());
end;
$$;
create or replace function public.reflexo_so_desbravador() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public._reflexo_so_desbravador_clube(public.clube_atual_id());
end;
$$;

-- jogo NOVO no catálogo: entra em TODOS os clubes (desligado; só o clube legado pode já nascer ligado).
-- Os SQLs de "jogo novo" passam a chamar isto em vez de "insert into jogos_trilha".
create or replace function public.catalogo_jogo_definir(p_chave text, p_nome text, p_emoji text, p_ordem integer,
                                                        p_requer_webgl boolean default false, p_ativo_legado boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jogos_trilha (club_id, chave, nome, emoji, ativo, ordem, requer_webgl)
  select u.id, p_chave, p_nome, p_emoji, (u.id = public.clube_legado_id() and p_ativo_legado), p_ordem, p_requer_webgl
  from public.organizational_units u where u.type = 'clube'
  on conflict (club_id, chave) do nothing;
end;
$$;

-- clube novo nasce com o catálogo do clube legado (só a memória ligada)
create or replace function public._prov_jogos(p_club_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jogos_trilha (club_id, chave, nome, emoji, ativo, ordem, requer_webgl)
  select p_club_id, j.chave, j.nome, j.emoji, (j.chave = 'memoria'), j.ordem, j.requer_webgl
  from public.jogos_trilha j where j.club_id = public.clube_legado_id()
  on conflict (club_id, chave) do nothing;
end;
$$;
revoke all on function public._jogos_do_clube(uuid) from public, anon, authenticated;
revoke all on function public._jogos_liberados_do_clube(uuid) from public, anon, authenticated;
revoke all on function public._jogos_do_dia_clube(uuid, date) from public, anon, authenticated;
revoke all on function public.catalogo_jogo_definir(text, text, text, integer, boolean, boolean) from public, anon, authenticated;
revoke all on function public._prov_jogos(uuid) from public, anon, authenticated;

select public.provisionar_clube(id) from public.organizational_units where type = 'clube';

-- ==================== D) policies ====================
drop policy if exists "ler jogos_trilha" on public.jogos_trilha;
drop policy if exists "gerir jogos_trilha" on public.jogos_trilha;
drop policy if exists "membro le o catalogo de jogos do proprio clube" on public.jogos_trilha;
drop policy if exists "lideranca gere o catalogo de jogos do proprio clube" on public.jogos_trilha;
create policy "membro le o catalogo de jogos do proprio clube" on public.jogos_trilha for select to authenticated
using (public.membro_ativo_no_clube(club_id));
create policy "lideranca gere o catalogo de jogos do proprio clube" on public.jogos_trilha for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id) and club_id = public.clube_atual_id());

drop policy if exists "ler liberacoes" on public.jogos_liberados;
drop policy if exists "membro le liberacoes do proprio clube" on public.jogos_liberados;
create policy "membro le liberacoes do proprio clube" on public.jogos_liberados for select to authenticated
using (public.membro_ativo_no_clube(club_id));

drop policy if exists "ler trilha_jogos" on public.trilha_jogos;
drop policy if exists "apagar trilha_jogos" on public.trilha_jogos;
drop policy if exists "membro le a propria trilha ou lideranca do clube" on public.trilha_jogos;
drop policy if exists "lideranca apaga trilha do proprio clube" on public.trilha_jogos;
create policy "membro le a propria trilha ou lideranca do clube" on public.trilha_jogos for select to authenticated
using ((usuario_id = auth.uid() and public.membro_ativo_no_clube(club_id)) or public.pode_gerir_no_clube(club_id));
create policy "lideranca apaga trilha do proprio clube" on public.trilha_jogos for delete to authenticated
using (public.pode_gerir_no_clube(club_id));

drop policy if exists "ler recordes" on public.recordes;
drop policy if exists "apagar recordes" on public.recordes;
drop policy if exists "membro le recordes do proprio clube" on public.recordes;
drop policy if exists "lideranca apaga recordes do proprio clube" on public.recordes;
create policy "membro le recordes do proprio clube" on public.recordes for select to authenticated
using (public.membro_ativo_no_clube(club_id));
create policy "lideranca apaga recordes do proprio clube" on public.recordes for delete to authenticated
using (public.pode_gerir_no_clube(club_id));

drop policy if exists "auditoria partidas lideranca" on public.partidas;
drop policy if exists "auditoria de partidas da lideranca do clube" on public.partidas;
create policy "auditoria de partidas da lideranca do clube" on public.partidas for select to authenticated
using (public.pode_gerir_no_clube(club_id));

-- ==================== E) liberar / trancar jogo: só o catálogo e as liberações do PRÓPRIO clube ====================
create or replace function public.liberar_jogo(p_chave text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode liberar jogos.'; end if;
  -- só jogo ATIVO e do rodízio (arcade já vive aberto; inativo não aparece no app)
  if not exists (select 1 from public._jogos_do_clube(v_club)
                 where chave = p_chave and ativo and chave not in ('reflexo', 'corrida')) then
    raise exception 'Jogo inválido ou fora do rodízio.';
  end if;
  insert into public.jogos_liberados (club_id, chave, data, liberado_por)
  values (v_club, p_chave, v_hoje, auth.uid())
  on conflict (club_id, chave, data) do nothing;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.trancar_jogo(p_chave text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_club uuid := public.clube_atual_id();
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode trancar jogos.'; end if;
  delete from public.jogos_liberados where club_id = v_club and chave = p_chave and data = v_hoje;
  return json_build_object('ok', true);
end;
$$;

-- ==================== F) demais funções (definição real do banco + escopo do clube) e cron por clube ====================
CREATE OR REPLACE FUNCTION public.registrar_jogo(p_tipo text, p_estrelas integer, p_partida uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
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
  if not public.membro_ativo_no_clube(v_club) then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public._jogos_do_clube(v_club) where chave = v_tipo) then
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
       and not exists (select 1 from public._jogos_liberados_do_clube(v_club) l where l.chave = v_tipo and l.data = v_hoje)
       and not ((now() at time zone 'America/Sao_Paulo')::time < time '00:10'
                and (exists (select 1 from public.jogos_do_dia(v_hoje - 1) d where d.chave = v_tipo)
                     or exists (select 1 from public._jogos_liberados_do_clube(v_club) l where l.chave = v_tipo and l.data = v_hoje - 1))) then
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

CREATE OR REPLACE FUNCTION public.iniciar_jogo(p_tipo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_arcade boolean;
  v_validade timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    raise exception 'Apenas membros ativos do clube podem jogar.';
  end if;
  if not exists (select 1 from public._jogos_do_clube(v_club) where chave = p_tipo) then
    raise exception 'Jogo inválido.';
  end if;

  -- anti-flood: ninguém precisa de 60 aberturas de jogo num dia
  if (select count(*) from public.partidas
      where usuario_id = v_uid and iniciado_em > now() - interval '24 hours') >= 60 then
    raise exception 'Muitas partidas hoje — respira e volta daqui a pouco. 🙂';
  end if;

  v_arcade := p_tipo in ('reflexo', 'corrida');

  -- jogo comum precisa estar ABERTO agora (rodízio/liberação); a partida
  -- "congela" essa autorização — o fim da partida não re-checa (resolve a
  -- virada de meia-noite sem janela de trapaça, pois o início foi validado)
  if not v_arcade and public.rodizio_ligado()
     and not exists (select 1 from public.jogos_do_dia(v_hoje) d where d.chave = p_tipo)
     and not exists (select 1 from public._jogos_liberados_do_clube(v_club) l where l.chave = p_tipo and l.data = v_hoje) then
    raise exception 'Esse jogo abre outro dia! Feche e abra o app pra ver os 🥇 Jogos do Dia de hoje.';
  end if;

  -- arcade: janela pros replays, mas CURTA — 15 min não cabe o "esperar ocioso
  -- e cravar 500 forjado" (reflexo precisaria de ~16,5 min) e ainda sobra muito
  -- pra qualquer partida real (uma corrida dura segundos). Estrela: 45 min.
  v_validade := now() + case when v_arcade then interval '15 minutes' else interval '45 minutes' end;

  insert into public.partidas (usuario_id, jogo, validade_em)
  values (v_uid, p_tipo, v_validade)
  returning id into v_id;

  return json_build_object('id', v_id, 'jogo', p_tipo, 'validade_em', v_validade);
end;
$function$;

CREATE OR REPLACE FUNCTION public.status_jogos_do_dia()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public.rodizio_ligado();
  v_trio json; v_lib json; v_prox json; v_exig json;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  if not v_on then
    select coalesce(json_agg(j.chave), '[]'::json) into v_exig
    from public._jogos_do_clube(v_club) j
    where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
    return json_build_object('ativo', false, 'hoje', '[]'::json, 'liberados', '[]'::json,
      'proximos', '[]'::json, 'exigidos', v_exig, 'valor_bonus', 50);
  end if;

  select coalesce(json_agg(d.chave), '[]'::json) into v_trio
  from public.jogos_do_dia(v_hoje) d;

  select coalesce(json_agg(l.chave), '[]'::json) into v_lib
  from public._jogos_liberados_do_clube(v_club) l where l.data = v_hoje;

  select coalesce(json_agg(json_build_object('chave', s.chave, 'data', s.data)), '[]'::json)
  into v_prox
  from (
    select j.chave, min(v_hoje + i.i) as data
    from public._jogos_do_clube(v_club) j
    cross join generate_series(1, 21) i(i)
    where j.ativo and j.chave not in ('reflexo', 'corrida')
      and exists (select 1 from public.jogos_do_dia(v_hoje + i.i) x where x.chave = j.chave)
    group by j.chave
  ) s;

  select coalesce(json_agg(q.chave), '[]'::json) into v_exig
  from (
    select d.chave from public.jogos_do_dia(v_hoje) d
    union
    select l.chave from public._jogos_liberados_do_clube(v_club) l
    join public._jogos_do_clube(v_club) j on j.chave = l.chave
    where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
  ) q
  join public._jogos_do_clube(v_club) jt on jt.chave = q.chave
  where not jt.requer_webgl;

  return json_build_object('ativo', true, 'hoje', v_trio, 'liberados', v_lib, 'proximos', v_prox,
    'exigidos', v_exig, 'valor_bonus', 30);   -- <<< era 20
end;
$function$;

CREATE OR REPLACE FUNCTION public.bonus_todos_jogos()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_marca text := to_char(v_hoje, 'DD/MM/YYYY');
  v_on boolean := public.rodizio_ligado();
  v_valor int;
  v_total int;
  v_feitos int;
  v_ganhou int := 0;
  v_ja boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    return json_build_object('completo', false, 'total', 0, 'feitos', 0, 'ganhou', 0);
  end if;

  v_valor := case when v_on then 30 else 50 end;   -- <<< ligado era 20

  create temp table if not exists _abertos_hoje (chave text primary key) on commit drop;
  delete from _abertos_hoje;
  if v_on then
    insert into _abertos_hoje
      select q.chave from (
        select d.chave from public.jogos_do_dia(v_hoje) d
        union
        select l.chave from public._jogos_liberados_do_clube(v_club) l
        join public._jogos_do_clube(v_club) j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public._jogos_do_clube(v_club) jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_hoje
      select j.chave from public._jogos_do_clube(v_club) j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;

  select count(*) into v_total from _abertos_hoje;

  select count(distinct t.tipo) into v_feitos
  from public.trilha_jogos t
  where t.usuario_id = v_uid and t.data = v_hoje
    and t.tipo in (select chave from _abertos_hoje);

  if v_total = 0 or v_feitos < v_total then
    return json_build_object('completo', false, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0);
  end if;

  if coalesce((select teste from public.profiles where id = v_uid), false) then
    return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', 0, 'teste', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':bonus_dia:' || v_hoje::text));

  v_ja := exists (
    select 1 from public.pontos
    where usuario_id = v_uid and origem = 'bonus_dia'
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje
  );
  if not v_ja then
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'bonus_dia', v_valor, '🎮 Completou os jogos do dia (' || v_marca || ')');
    v_ganhou := v_valor;
  end if;

  return json_build_object('completo', true, 'total', v_total, 'feitos', v_feitos, 'ganhou', v_ganhou, 'ja', v_ja);
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_recorde(p_jogo text, p_pontos integer, p_partida uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
  v_pts int := greatest(0, least(coalesce(p_pontos, 0), 500));
  v_antigo int;
  p record;
  v_dur numeric;
  v_exigir boolean := coalesce(public.config_valor(public.clube_atual_id(), 'exigir_partida'), 'nao') = 'sim';
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then
    return json_build_object('recorde', v_pts, 'melhorou', false);
  end if;
  if public.eh_teste() then
    return json_build_object('recorde', v_pts, 'melhorou', false, 'teste', true);
  end if;
  if not exists (select 1 from public._jogos_do_clube(v_club) where chave = p_jogo) then
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

CREATE OR REPLACE FUNCTION public.pedir_ajuda(p_para uuid, p_jogo text, p_enunciado jsonb, p_resposta text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_id uuid;
  v_nome text;
  v_nomejogo text;
  v_ja_aberto boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Sem permissão.'; end if;
  if p_jogo not in ('anagrama', 'forca', 'termo') then raise exception 'Jogo inválido.'; end if;
  if p_para = v_uid then raise exception 'Escolha um amigo (não você mesmo).'; end if;
  if not exists (select 1 from public.profiles where id = p_para and status = 'ativo' and papel <> 'pais' and public.clube_vinculo_do_usuario(p_para) = v_club) then
    raise exception 'Amigo inválido.';
  end if;
  if coalesce(trim(p_resposta), '') = '' then raise exception 'Desafio sem resposta.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':pedir_ajuda'));

  -- ANTI-FLOOD: no máximo 5 pedidos a cada 5 minutos (não deixa spammar a caixa de um colega)
  if (select count(*) from public.ajudas where de_id = v_uid and criado_em > now() - interval '5 minutes') >= 5 then
    raise exception 'Você pediu ajuda demais agora. Espere um pouquinho 🙂';
  end if;

  -- já havia pedido ABERTO pra ESTE mesmo amigo? então NÃO re-notifica (evita flood dirigido)
  v_ja_aberto := exists (select 1 from public.ajudas where de_id = v_uid and para_id = p_para and status = 'aberto');

  -- só 1 pedido aberto por vez: cancela os anteriores e cria o novo (com o desafio atual)
  update public.ajudas set status = 'cancelado' where de_id = v_uid and status = 'aberto';
  insert into public.ajudas (de_id, para_id, jogo, enunciado, resposta)
  values (v_uid, p_para, p_jogo, p_enunciado, p_resposta)
  returning id into v_id;

  if not v_ja_aberto then
    select nome into v_nome from public.profiles where id = v_uid;
    select nome into v_nomejogo from public._jogos_do_clube(v_club) where chave = p_jogo;
    -- notificação direcionada ao amigo (feita aqui dentro pois o cliente não pode inserir notificação)
    insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
    values ('🆘 Pedido de ajuda!',
      coalesce(v_nome, 'Um amigo') || ' precisou da sua ajuda no ' || coalesce(v_nomejogo, p_jogo) || '! Abra os 🎮 Jogos e ajude.',
      'geral', '/trilha', 'pessoal', p_para, v_uid);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_ajuda(p_id uuid, p_tentativa text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_a public.ajudas%rowtype;
  v_nome text;
  v_nomejogo text;
  v_teste boolean;
  v_ja int;
  v_ganhou int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Sem permissão.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':resolver_ajuda:' || v_hoje::text));

  select * into v_a from public.ajudas where id = p_id and para_id = v_uid and status = 'aberto';
  if not found then return json_build_object('ok', false, 'erro', 'sumiu'); end if;

  if public.norm_txt(p_tentativa) <> public.norm_txt(v_a.resposta) then
    return json_build_object('ok', false);  -- errou; pode tentar de novo
  end if;

  update public.ajudas set status = 'resolvido', resolvido_por = v_uid, resolvido_em = now() where id = p_id;

  -- +5 pro ajudante, no máximo 3 ajudas premiadas por dia (conta teste não pontua)
  select coalesce(teste, false) into v_teste from public.profiles where id = v_uid;
  if not coalesce(v_teste, false) then
    select count(*) into v_ja from public.pontos
    where usuario_id = v_uid and origem = 'ajuda'
      and (data at time zone 'America/Sao_Paulo')::date = v_hoje;
    if v_ja < 3 then
      select nome into v_nome from public.profiles where id = v_a.de_id;
      select nome into v_nomejogo from public._jogos_do_clube(v_club) where chave = v_a.jogo;
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (v_uid, 'ajuda', 5, '🤝 Ajudou ' || coalesce(v_nome, 'um amigo') || ' no ' || coalesce(v_nomejogo, v_a.jogo));
      v_ganhou := 5;
    end if;
  end if;

  -- avisa quem pediu (com o nome do ajudante)
  select nome into v_nome from public.profiles where id = v_uid;
  insert into public.notificacoes (titulo, corpo, tipo, link, para, para_usuario, criado_por)
  values ('🎉 Você foi ajudado!',
    coalesce(v_nome, 'Um amigo') || ' resolveu seu desafio! Abra o jogo pra ver a resposta.',
    'geral', '/trilha', 'pessoal', v_a.de_id, v_uid);

  return json_build_object('ok', true, 'ganhou', v_ganhou);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ajudas_recebidas()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then coalesce((
    select json_agg(json_build_object(
      'id', a.id, 'jogo', a.jogo, 'enunciado', a.enunciado,
      'de_nome', p.nome, 'de_foto', p.foto, 'criado_em', a.criado_em
    ) order by a.criado_em)
    from public.ajudas a join public.profiles p on p.id = a.de_id
    where a.para_id = auth.uid() and a.status = 'aberto'
  ), '[]'::json) else '[]'::json end;
$function$;

CREATE OR REPLACE FUNCTION public.ranking_trilha()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then (
    with base as (
      select p.id, p.nome, p.foto,
             coalesce(nullif(j.tipo, ''), 'memoria') as tipo,
             coalesce(j.estrelas, 0)                 as estrelas
      from public.trilha_jogos j
      join public.profiles p on p.id = j.usuario_id
      where j.club_id = public.clube_atual_id() and p.status = 'ativo' and p.papel <> 'pais'
    ),
    agg as (
      select tipo, id, nome, foto, count(*)::int as passos, sum(estrelas)::int as estrelas
      from base group by tipo, id, nome, foto
      union all
      select 'geral' as tipo, id, nome, foto, count(*)::int as passos, sum(estrelas)::int as estrelas
      from base group by id, nome, foto
    )
    select coalesce(json_object_agg(tipo, linhas), '{}'::json)
    from (
      select tipo, json_agg(json_build_object('id', id, 'nome', nome, 'foto', foto,
             'passos', passos, 'estrelas', estrelas) order by estrelas desc, passos desc, nome) as linhas
      from agg group by tipo
    ) x
  ) else '{}'::json end;
$function$;

CREATE OR REPLACE FUNCTION public.recordes_semana(p_jogo text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when public.membro_ativo_no_clube(public.clube_atual_id()) then coalesce((
    select json_agg(json_build_object(
      'id', t.usuario_id, 'nome', t.nome, 'foto', t.foto, 'pontos', t.pontos
    ) order by t.pontos desc, t.atualizado_em)
    from (
      select r.usuario_id, p.nome, p.foto, r.pontos, r.atualizado_em
      from public.recordes r
      join public.profiles p on p.id = r.usuario_id
      where r.club_id = public.clube_atual_id() and r.jogo = p_jogo
        and r.semana = (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date
        and r.pontos > 0
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not public.reflexo_so_desbravador() or p.papel = 'desbravador')
      order by r.pontos desc, r.atualizado_em
      limit 20
    ) t
  ), '[]'::json) else '[]'::json end;
$function$;

CREATE OR REPLACE FUNCTION public.chefao_config(p_nome text, p_emoji text, p_vida integer, p_versiculo text, p_inicio date, p_ativo boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_antes boolean := coalesce(public.config_valor(public.clube_atual_id(), 'chefao_ativo'), 'nao') = 'sim';
begin
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança configura o chefão.'; end if;
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
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('⚔️ ' || coalesce(trim(p_nome), 'Um chefão') || ' apareceu!',
      'Um chefão surgiu pro fim de semana — o clube TODO precisa se unir pra derrotá-lo! Jogue, cumpra missões, leia a Bíblia e dê o golpe especial. 🗡️',
      'geral', '/chefao', 'todos', v_club);
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
  v_club uuid := public.clube_atual_id();
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
  if not public.membro_ativo_no_clube(v_club) then return json_build_object('ativo', false); end if;

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
    and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and p.club_id = v_club;

  select coalesce(sum(g.dano), 0) into v_dano_golpes
  from public.chefao_golpes g
  where g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim;

  v_dano := v_dano_pontos + v_dano_golpes;

  -- placar por unidade (pontos + golpes somados por unidade)
  with dano_uni as (
    select pr.unidade_id as uid, sum(p.pontos)::int as dano
    from public.pontos p join public.profiles pr on pr.id = p.usuario_id
    where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao', 'chefao')
      and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and p.club_id = v_club
      and pr.unidade_id is not null
    group by pr.unidade_id
    union all
    select pr.unidade_id as uid, sum(g.dano)::int as dano
    from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
    where g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim and pr.unidade_id is not null
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
  v_club uuid := public.clube_atual_id();
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
  if not public.membro_ativo_no_clube(v_club) then raise exception 'Só membros ativos entram na batalha.'; end if;

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
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and p.club_id = v_club), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      where g.club_id = v_club and g.criado_em >= v_ini and g.criado_em < v_fim), 0)
  into v_dano;

  return json_build_object('ok', true, 'dano_golpe', v_dano_golpe,
    'vida_atual', greatest(0, v_vida - v_dano), 'venceu', v_dano >= v_vida);
end;
$function$;

CREATE OR REPLACE FUNCTION public.atividade_jogos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club uuid := public.clube_atual_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seg date := (date_trunc('week', (now() at time zone 'America/Sao_Paulo')))::date;
begin
  if not public.pode_gerir_no_clube(v_club) then raise exception 'Sem permissão (apenas liderança).'; end if;
  return json_build_object(
    'hoje',   (select count(distinct usuario_id) from public.trilha_jogos where club_id = v_club and data = v_hoje),
    'semana', (select count(distinct usuario_id) from public.trilha_jogos where club_id = v_club and data >= v_seg),
    'total',  (select count(*) from public.profiles where status = 'ativo' and papel = 'desbravador' and coalesce(teste, false) = false and public.clube_do_usuario(id) = v_club),
    'ausentes', coalesce((
      select json_agg(json_build_object('id', p.id, 'nome', p.nome, 'foto', p.foto, 'ultimo', u.ultimo)
                      order by u.ultimo nulls first, p.nome)
      from public.profiles p
      left join (select usuario_id, max(data) ultimo from public.trilha_jogos where club_id = v_club group by usuario_id) u on u.usuario_id = p.id
      where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false and public.clube_do_usuario(p.id) = v_club
        and (u.ultimo is null or u.ultimo < v_hoje - 1)
    ), '[]'::json)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public._premiar_melhores_do_dia_clube(p_club_id uuid)
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
  v_so_desb boolean := coalesce((public.config_valor(p_club_id, 'reflexo_so_desbravador') = 'sim'), false);
begin
  -- interruptor desligado = sem trio, sem +10 (os jogos estavam todos abertos)
  if not public._rodizio_ligado_clube(p_club_id) then return; end if;

  perform pg_advisory_xact_lock(hashtext('melhores-do-dia:' || p_club_id::text || ':' || v_dia::text));

  insert into public.jogos_liberados (club_id, chave, data)
  select p_club_id, c.valor, (now() at time zone 'America/Sao_Paulo')::date
  from public.config_clube c
  join public._jogos_do_clube(p_club_id) j on j.chave = c.valor and j.ativo
  where c.club_id = p_club_id and c.chave = 'jogo_da_semana' and c.valor not in ('reflexo', 'corrida')
  on conflict (club_id, chave, data) do nothing;

  for rjogo in select d.chave, d.nome from public._jogos_do_dia_clube(p_club_id, v_dia) d loop
    v_marca := rjogo.chave || ' ' || to_char(v_dia, 'DD/MM/YYYY');

    if exists (
      select 1 from public.pontos
      where club_id = p_club_id and origem = 'melhor_dia' and motivo like '%(' || v_marca || ')%'
    ) then
      continue;
    end if;

    select t.usuario_id, p.nome, t.estrelas into r
    from public.trilha_jogos t
    join public.profiles p on p.id = t.usuario_id
    where t.club_id = p_club_id and t.data = v_dia and t.tipo = rjogo.chave
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
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🥇 Melhores do dia!',
      'Ontem: ' || v_nomes || ' — +10 pontos cada! Os Jogos do Dia de hoje já estão valendo. 🏃',
      'geral', '/trilha', 'todos', p_club_id);
  end if;
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
      raise warning 'premiar_melhores_do_dia: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public._premiar_melhores_do_dia_clube(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._premiar_campeao_semana_clube(p_club_id uuid)
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
    join public.profiles p on p.id = r2.usuario_id
    where r2.club_id = p_club_id and r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos > 0
      and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
      and (not public._reflexo_so_desbravador_clube(p_club_id) or p.papel = 'desbravador');
    if v_max is null or v_max <= 0 then continue; end if;
    v_nomes := null;
    for r in
      select r2.usuario_id, p.nome
      from public.recordes r2
      join public.profiles p on p.id = r2.usuario_id
      where r2.club_id = p_club_id and r2.jogo = rjogo.jogo and r2.semana = v_seg and r2.pontos = v_max
        and p.status = 'ativo' and p.papel <> 'pais' and coalesce(p.teste, false) = false
        and (not public._reflexo_so_desbravador_clube(p_club_id) or p.papel = 'desbravador')
    loop
      insert into public.pontos (usuario_id, origem, pontos, motivo)
      values (r.usuario_id, 'campeao', 20,
        '🏆 Recorde da semana no ' || coalesce(v_nome_jogo, rjogo.jogo) || ' (' || v_marca || ')');
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

create or replace function public.premiar_campeao_semana() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._premiar_campeao_semana_clube(r.id);
    exception when others then
      raise warning 'premiar_campeao_semana: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public._premiar_campeao_semana_clube(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._lembrar_ausentes_clube(p_club_id uuid)
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
  if coalesce(public.config_valor(p_club_id, 'lembrete_ausencia_dia'), '') = v_hoje::text then
    return;
  end if;
  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and public.clube_do_usuario(p.id) = p_club_id
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
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'lembrete_ausencia_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$function$;

create or replace function public.lembrar_ausentes() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._lembrar_ausentes_clube(r.id);
    exception when others then
      raise warning 'lembrar_ausentes: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public._lembrar_ausentes_clube(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._lembrar_jogos_do_dia_clube(p_club_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_on boolean := public._rodizio_ligado_clube(p_club_id);
  v_total int;
  r record;
begin
  if coalesce(public.config_valor(p_club_id, 'lembrete_jogos_dia'), '') = v_hoje::text then
    return;
  end if;
  create temp table if not exists _abertos_lembrete (chave text primary key) on commit drop;
  delete from _abertos_lembrete;
  if v_on then
    insert into _abertos_lembrete
      select q.chave from (
        select d.chave from public._jogos_do_dia_clube(p_club_id, v_hoje) d
        union
        select l.chave from public._jogos_liberados_do_clube(p_club_id) l
        join public._jogos_do_clube(p_club_id) j on j.chave = l.chave
        where l.data = v_hoje and j.ativo and l.chave not in ('reflexo', 'corrida')
      ) q
      join public._jogos_do_clube(p_club_id) jt on jt.chave = q.chave
      where not jt.requer_webgl;
  else
    insert into _abertos_lembrete
      select j.chave from public._jogos_do_clube(p_club_id) j
      where j.ativo and j.chave not in ('reflexo', 'corrida') and not j.requer_webgl;
  end if;
  select count(*) into v_total from _abertos_lembrete;
  if v_total = 0 then return; end if;
  for r in
    select p.id
    from public.profiles p
    where p.status = 'ativo' and p.papel = 'desbravador' and coalesce(p.teste, false) = false
      and public.clube_do_usuario(p.id) = p_club_id
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
  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'lembrete_jogos_dia', v_hoje::text)
  on conflict (club_id, chave) do update set valor = excluded.valor;
end;
$function$;

create or replace function public.lembrar_jogos_do_dia() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._lembrar_jogos_do_dia_clube(r.id);
    exception when others then
      raise warning 'lembrar_jogos_do_dia: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public._lembrar_jogos_do_dia_clube(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._premiar_rodada_semana_clube(p_club_id uuid)
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
    (public.config_valor(p_club_id, 'reflexo_so_desbravador') = 'sim'), false);
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
  perform pg_advisory_xact_lock(hashtext('rodada_semana:' || p_club_id::text));

  -- ===================================================================
  -- 🌟 CAMPEÃO DAS ESTRELAS DA SEMANA (+30)
  --    Idempotência: só paga se ainda não existe o lançamento desta semana.
  --    (exclui 'reflexo' da soma — ele pontua por recorde, não por estrela)
  -- ===================================================================
  if not exists (
    select 1 from public.pontos
    where club_id = p_club_id and origem = 'campeao'
      and motivo = '🌟 Campeão das estrelas da semana (' || v_marca || ')'
  ) then
    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.profiles p on p.id = t.usuario_id
      where t.club_id = p_club_id and t.data >= v_ini and t.data < v_fim and t.tipo not in ('reflexo', 'corrida')
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
        where t.club_id = p_club_id and t.data >= v_ini and t.data < v_fim and t.tipo not in ('reflexo', 'corrida')
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
        insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
        values ('🌟 Campeão das estrelas!',
          v_nomes || ' foi quem mais fez estrelas nos jogos essa semana e levou +30 pontos!',
          'geral', '/trilha', 'todos', p_club_id);
      end if;
    end if;
  end if;

  -- ===================================================================
  -- 🎲 JOGO DA SEMANA — o jogo que estava valendo (lido da config)
  -- ===================================================================
  v_jogo := public.config_valor(p_club_id, 'jogo_da_semana');

  -- (a) premia o melhor no jogo da semana (+20). Idempotência por SEMANA e
  --     baseada nos pontos já lançados: mesmo que o jogo já tenha rodado pra
  --     o próximo, isto não paga o jogo errado nem paga de novo.
  if v_jogo is not null and v_jogo <> ''
     and not exists (
       select 1 from public.pontos
       where club_id = p_club_id and origem = 'campeao'
         and motivo like '🎲 Campeão do jogo da semana:%(' || v_marca || ')'
     ) then
    select nome into v_nome_jogo from public._jogos_do_clube(p_club_id) where chave = v_jogo;

    select max(soma) into v_max from (
      select sum(t.estrelas) as soma
      from public.trilha_jogos t
      join public.profiles p on p.id = t.usuario_id
      where t.club_id = p_club_id and t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
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
        where t.club_id = p_club_id and t.tipo = v_jogo and t.data >= v_ini and t.data < v_fim
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
        insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
        values ('🎲 Campeão do jogo da semana!',
          v_nomes || ' foi o melhor no ' || coalesce(v_nome_jogo, v_jogo) || ' e levou +20 pontos!',
          'geral', '/trilha', 'todos', p_club_id);
      end if;
    end if;
  end if;

  -- (b) sorteia o jogo da PRÓXIMA semana (uma vez por semana). Se já rodou o
  --     sorteio desta semana, não mexe. Pior caso de re-sorteio só troca o jogo
  --     de novo — nunca mexe em pontos.
  if coalesce(public.config_valor(p_club_id, 'jogo_semana_rodada'), '') <> v_marca then
    -- de preferência um jogo ativo diferente do reflexo E do desta semana
    select chave into v_prox
    from public._jogos_do_clube(p_club_id)
    where ativo = true and chave not in ('reflexo', 'corrida') and chave <> coalesce(v_jogo, '')
    order by random() limit 1;

    -- se não sobrou opção diferente, aceita repetir (só não jogos de recorde)
    if v_prox is null then
      select chave into v_prox
      from public._jogos_do_clube(p_club_id)
      where ativo = true and chave not in ('reflexo', 'corrida')
      order by random() limit 1;
    end if;

    if v_prox is not null then
      insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'jogo_da_semana', v_prox)
      on conflict (club_id, chave) do update set valor = excluded.valor;

      select nome into v_nome_prox from public._jogos_do_clube(p_club_id) where chave = v_prox;
      insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
      values ('🎲 Novo jogo da semana!',
        'Essa semana o jogo que vale prêmio é o ' || coalesce(v_nome_prox, v_prox)
        || '! Quem fizer mais estrelas nele até domingo leva +20. 🏆',
        'geral', '/trilha', 'todos', p_club_id);
    end if;

    -- marca que o sorteio desta semana já foi feito
    insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'jogo_semana_rodada', v_marca)
    on conflict (club_id, chave) do update set valor = excluded.valor;
  end if;
end;
$function$;

create or replace function public.premiar_rodada_semana() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._premiar_rodada_semana_clube(r.id);
    exception when others then
      raise warning 'premiar_rodada_semana: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public._premiar_rodada_semana_clube(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._chefao_premiar_clube(p_club_id uuid)
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
  v_ativo := coalesce(public.config_valor(p_club_id, 'chefao_ativo'), 'nao') = 'sim';
  v_inicio := public.config_valor(p_club_id, 'chefao_inicio');
  if not v_ativo or v_inicio is null then return; end if;
  if public.config_valor(p_club_id, 'chefao_pago') is not distinct from v_inicio then return; end if;

  v_vida := greatest(1, coalesce(public.config_valor(p_club_id, 'chefao_vida'), '3000')::int);
  v_nome := coalesce(public.config_valor(p_club_id, 'chefao_nome'), 'Chefão');
  v_ini := (v_inicio || ' 00:00:00')::timestamp at time zone 'America/Sao_Paulo';
  v_fim := v_ini + interval '2 days';

  perform pg_advisory_xact_lock(hashtext('chefao:' || p_club_id::text || ':' || v_inicio));

  -- dano total (mesmos filtros do dano por pessoa abaixo → as proporções fecham)
  select coalesce((select sum(p.pontos) from public.pontos p
      join public.profiles pr on pr.id = p.usuario_id
      where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = p_club_id), 0)
    + coalesce((select sum(g.dano) from public.chefao_golpes g
      join public.profiles pr on pr.id = g.usuario_id
      where g.criado_em >= v_ini and g.criado_em < v_fim
        and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = p_club_id), 0)
  into v_dano;

  if v_dano >= v_vida then
    -- VITÓRIA: reparte a vida (v_vida) proporcional ao dano de cada um
    for r in
      select uid, sum(dano)::numeric as dano_user from (
        select p.usuario_id as uid, sum(p.pontos)::numeric as dano
        from public.pontos p join public.profiles pr on pr.id = p.usuario_id
        where p.data >= v_ini and p.data < v_fim and p.pontos > 0 and p.origem not in ('campeao','chefao')
          and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = p_club_id
        group by p.usuario_id
        union all
        select g.usuario_id, sum(g.dano)::numeric
        from public.chefao_golpes g join public.profiles pr on pr.id = g.usuario_id
        where g.criado_em >= v_ini and g.criado_em < v_fim
          and pr.status = 'ativo' and pr.papel <> 'pais' and coalesce(pr.teste, false) = false and public.clube_do_usuario(pr.id) = p_club_id
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

    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('⚔️ Chefão derrotado!',
      'O clube uniu forças e derrotou o ' || v_nome || '! Cada um levou pontos proporcionais ao dano que causou. 🎉',
      'geral', '/chefao', 'todos', p_club_id);
  else
    -- fugiu (gentil, sem "vocês falharam"); ninguém perde os pontos já ganhos
    insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
    values ('🌙 O ' || v_nome || ' recuou...',
      'O ' || v_nome || ' fugiu por pouco! Foi muita luta junto — semana que vem tem mais aventura. 💪',
      'geral', '/chefao', 'todos', p_club_id);
  end if;

  insert into public.config_clube (club_id, chave, valor) values (p_club_id, 'chefao_pago', v_inicio)
  on conflict (club_id, chave) do update set valor = excluded.valor;
  update public.config_clube set valor = 'nao' where club_id = p_club_id and chave = 'chefao_ativo';
end;
$function$;

create or replace function public.chefao_premiar() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.organizational_units where type = 'clube' order by created_at, id loop
    begin
      perform public._chefao_premiar_clube(r.id);
    exception when others then
      raise warning 'chefao_premiar: o clube % falhou e foi pulado: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function public._chefao_premiar_clube(uuid) from public, anon, authenticated;



-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-jogos-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
