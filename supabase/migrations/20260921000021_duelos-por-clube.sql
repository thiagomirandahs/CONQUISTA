-- =====================================================================
-- Duelos entre unidades POR CLUBE. Rodar DEPOIS da 20260921000020. Idempotente.
--
--  * desafios_unidade (catálogo) e duelos ganham club_id; o que existe hoje fica no Tenant 001.
--  * O duelo é SEMPRE entre unidades do mesmo clube e com desafio do mesmo clube (gatilho, vale até para o dono do banco).
--  * Membro lê/cria/acompanha duelos do próprio clube; a liderança do clube julga, cancela e apaga só os dele.
--  * Quem não é do clube recebe a mesma resposta de "não encontrado": ninguém descobre UUID de outro clube.
--  * O aviso "Novo duelo" (push/sino) vai só para o clube do duelo.
--  * Clube novo nasce com os 4 desafios padrão (registro _prov_duelos).
--  * Saem os gatilhos que fechavam os duelos ao clube legado.
-- =====================================================================

-- ==================== A) colunas e dados ====================
alter table public.desafios_unidade
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.desafios_unidade set club_id = public.clube_legado_id() where club_id is null;
alter table public.desafios_unidade alter column club_id set not null;
alter table public.desafios_unidade alter column club_id set default public.clube_atual_id();
create index if not exists idx_desafios_unidade_club on public.desafios_unidade(club_id);

alter table public.duelos
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.duelos d
   set club_id = coalesce((select u.club_id from public.unidades u where u.id = d.unidade_a), public.clube_legado_id())
 where d.club_id is null;
alter table public.duelos alter column club_id set not null;
create index if not exists idx_duelos_club on public.duelos(club_id, status, prazo);

-- ==================== B) gatilho: o duelo nasce no clube das unidades ====================
create or replace function public.definir_club_duelo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a uuid; v_b uuid; v_d uuid;
begin
  select club_id into v_a from public.unidades where id = new.unidade_a;
  select club_id into v_b from public.unidades where id = new.unidade_b;
  if v_a is null or v_a is distinct from v_b then
    raise exception 'As duas unidades do duelo precisam ser do mesmo clube.';
  end if;
  select club_id into v_d from public.desafios_unidade where id = new.desafio_id;
  if v_d is distinct from v_a then
    raise exception 'O desafio precisa ser do mesmo clube das unidades do duelo.';
  end if;
  new.club_id := v_a;
  return new;
end;
$$;
revoke all on function public.definir_club_duelo() from public, anon, authenticated;

drop trigger if exists trg_exigir_clube_legado on public.duelos;
drop trigger if exists trg_exigir_unidades_legado on public.duelos;
drop trigger if exists trg_definir_club_duelo on public.duelos;
create trigger trg_definir_club_duelo before insert or update of unidade_a, unidade_b, desafio_id on public.duelos
for each row execute function public.definir_club_duelo();

-- ==================== C) policies ====================
drop policy if exists "gerir desafios_unidade" on public.desafios_unidade;
drop policy if exists "ler desafios_unidade" on public.desafios_unidade;
drop policy if exists "membro le desafios do proprio clube" on public.desafios_unidade;
drop policy if exists "lideranca gere desafios do proprio clube" on public.desafios_unidade;
create policy "membro le desafios do proprio clube" on public.desafios_unidade for select to authenticated
using (public.membro_ativo_no_clube(club_id));
create policy "lideranca gere desafios do proprio clube" on public.desafios_unidade for all to authenticated
using (public.pode_gerir_no_clube(club_id))
with check (public.pode_gerir_no_clube(club_id) and club_id = public.clube_atual_id());

drop policy if exists "ler duelos" on public.duelos;
drop policy if exists "apagar duelo" on public.duelos;
drop policy if exists "membro le duelos do proprio clube" on public.duelos;
drop policy if exists "lideranca apaga duelos do proprio clube" on public.duelos;
create policy "membro le duelos do proprio clube" on public.duelos for select to authenticated
using (public.membro_ativo_no_clube(club_id));
create policy "lideranca apaga duelos do proprio clube" on public.duelos for delete to authenticated
using (public.pode_gerir_no_clube(club_id));

-- ==================== D) RPCs: o clube é o de quem chama; tudo o mais é conferido contra ele ====================
create or replace function public.criar_duelo(p_desafio_id uuid, p_unidade_b uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_ua uuid;
  v_dias int; v_titulo text; v_pontos int;
  v_abertos int; v_recentes int;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  -- Só desafia PELA SUA unidade (não dá pra desafiar em nome de outra) e só quem
  -- já teve o cadastro aprovado (status ativo) — senão um cadastro pendente com
  -- unidade poderia lançar duelos e tocar o push do clube.
  select unidade_id into v_ua
  from public.profiles where id = v_uid and status = 'ativo';
  if v_ua is null or not public.membro_ativo_no_clube(v_club) then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra desafiar.';
  end if;
  if p_unidade_b is null or p_unidade_b = v_ua then
    raise exception 'Escolha OUTRA unidade pra desafiar.';
  end if;
  -- só unidade do MEU clube (unidade de outro clube = "não encontrada", sem revelar que existe)
  if not exists (select 1 from public.unidades where id = p_unidade_b and club_id = v_club) then
    raise exception 'Unidade não encontrada.';
  end if;

  -- O desafio precisa existir, ser do meu clube e estar ativo (e guardamos o snapshot dele)
  select dias, titulo, pontos into v_dias, v_titulo, v_pontos
  from public.desafios_unidade where id = p_desafio_id and ativo and club_id = v_club;
  if v_dias is null then
    raise exception 'Desafio inválido ou desativado.';
  end if;

  -- Trava 1 — na MINHA unidade: serializa os dois tetos abaixo (contar-e-inserir).
  -- Sem ela, várias chamadas paralelas contra adversários DIFERENTES pegariam
  -- travas diferentes, leriam a mesma contagem e furariam os limites (spam de push).
  perform pg_advisory_xact_lock(hashtext('duelo_uni:' || v_ua::text));

  -- Trava 2 — no PAR de unidades: impede a corrida espelhada (X desafia Y no mesmo
  -- instante em que Y desafia X), que criaria 2 duelos iguais e premiaria em dobro.
  -- Ordem unidade -> par é livre de deadlock (quem segura o par nunca espera unidade).
  perform pg_advisory_xact_lock(hashtext(
    'duelo:' || least(v_ua, p_unidade_b)::text || ':' || greatest(v_ua, p_unidade_b)::text
  ));

  -- Nada de duelo repetido do mesmo desafio entre as mesmas unidades
  if exists (
    select 1 from public.duelos
    where status = 'aberto' and desafio_id = p_desafio_id
      and ((unidade_a = v_ua and unidade_b = p_unidade_b)
        or (unidade_a = p_unidade_b and unidade_b = v_ua))
  ) then
    raise exception 'Já existe um duelo aberto desse desafio entre essas unidades.';
  end if;

  -- Teto 1: 3 duelos ABERTOS por unidade (pra não virar bagunça)
  select count(*) into v_abertos
  from public.duelos where status = 'aberto' and unidade_a = v_ua;
  if v_abertos >= 3 then
    raise exception 'Sua unidade já tem 3 duelos abertos. Espere julgarem algum. 🙂';
  end if;

  -- Teto 2 (anti-spam): 3 duelos CRIADOS por pessoa a cada 24h, seja qual for o
  -- status. Sem isso, criar+cancelar em loop tocaria o push do clube sem parar.
  select count(*) into v_recentes
  from public.duelos
  where criado_por = v_uid and created_at > now() - interval '24 hours';
  if v_recentes >= 3 then
    raise exception 'Você já lançou 3 duelos nas últimas 24h. Amanhã tem mais! 🙂';
  end if;

  insert into public.duelos (desafio_id, titulo, pontos, unidade_a, unidade_b, criado_por, prazo)
  values (p_desafio_id, v_titulo, v_pontos, v_ua, p_unidade_b, v_uid,
          ((now() at time zone 'America/Sao_Paulo')::date + v_dias))
  returning id into v_id;

  return json_build_object('id', v_id);
exception when unique_violation then
  -- Backstop do índice único (corrida espelhada): mensagem amigável em vez do erro cru
  raise exception 'Já existe um duelo aberto desse desafio entre essas unidades.';
end;
$$;

create or replace function public.julgar_duelo(p_id uuid, p_vencedor text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_status text; v_ua uuid; v_ub uuid;
  v_pontos int; v_titulo text;
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode julgar.'; end if;
  if p_vencedor is null or p_vencedor not in ('a', 'b', 'ambos', 'ninguem') then
    raise exception 'Resultado inválido.';
  end if;

  -- Trava a linha: dois julgamentos ao mesmo tempo não premiam em dobro
  select status, unidade_a, unidade_b, coalesce(pontos, 0), coalesce(titulo, 'desafio')
    into v_status, v_ua, v_ub, v_pontos, v_titulo
  from public.duelos where id = p_id and club_id = v_club for update;

  if not found then raise exception 'Duelo não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse duelo já foi encerrado.'; end if;

  if p_vencedor in ('a', 'ambos') and v_pontos > 0 then
    insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por)
    values (v_ua, 'unidade', v_pontos, 'Duelo vencido: ' || v_titulo, v_uid);
  end if;
  if p_vencedor in ('b', 'ambos') and v_pontos > 0 then
    insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por)
    values (v_ub, 'unidade', v_pontos, 'Duelo vencido: ' || v_titulo, v_uid);
  end if;

  update public.duelos
     set status = 'julgado', vencedor = p_vencedor, julgado_por = v_uid, julgado_em = now()
   where id = p_id;

  return json_build_object('ok', true,
    'pontos', case when p_vencedor = 'ninguem' then 0 else v_pontos end);
end;
$$;

create or replace function public.cancelar_duelo(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_dono uuid; v_status text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  select criado_por, status into v_dono, v_status
  from public.duelos where id = p_id and club_id = v_club and public.membro_ativo_no_clube(v_club) for update;

  if not found then raise exception 'Duelo não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse duelo já foi encerrado.'; end if;
  if not (public.pode_gerir_no_clube(v_club) or v_dono = v_uid) then
    raise exception 'Só quem lançou o duelo (ou a liderança) pode cancelar.';
  end if;

  update public.duelos set status = 'cancelado' where id = p_id;
  return json_build_object('ok', true);
end;
$$;

-- o aviso do duelo vai só para o clube do duelo
create or replace function public.notif_duelo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a text; v_b text;
begin
  select nome into v_a from public.unidades where id = new.unidade_a;
  select nome into v_b from public.unidades where id = new.unidade_b;
  insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
  values ('⚔️ Novo duelo entre unidades!',
          coalesce(v_a, 'Uma unidade') || ' desafiou ' || coalesce(v_b, 'outra unidade')
            || ': ' || coalesce(new.titulo, 'um desafio'),
          'geral', '/desafios', 'todos', new.club_id);
  return new;
end;
$$;

create or replace function public.progresso_duelo(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_club uuid := public.clube_atual_id();
  v_tipo text; v_meta int; v_ua uuid; v_ub uuid; v_desde timestamptz;
begin
  if not public.membro_ativo_no_clube(v_club) then return json_build_object('tipo', 'manual'); end if;

  select coalesce(du.tipo, 'manual'), coalesce(du.meta, 1), d.unidade_a, d.unidade_b, d.created_at
    into v_tipo, v_meta, v_ua, v_ub, v_desde
  from public.duelos d
  join public.desafios_unidade du on du.id = d.desafio_id
  where d.id = p_id and d.club_id = v_club;

  if not found then raise exception 'Duelo não encontrado.'; end if;
  if v_tipo = 'manual' then return json_build_object('tipo', 'manual', 'meta', v_meta); end if;

  return json_build_object(
    'tipo', v_tipo, 'meta', v_meta,
    'a', public.progresso_lado(v_ua, v_tipo, v_meta, v_desde),
    'b', public.progresso_lado(v_ub, v_tipo, v_meta, v_desde)
  );
end;
$$;

-- interno (só progresso_duelo chama): só devolve gente de unidade do clube de quem chama
create or replace function public.progresso_lado(p_uni uuid, p_tipo text, p_meta integer, p_desde timestamp with time zone)
returns json language sql security definer set search_path = '' as $$
  select case when public.membro_ativo_no_clube(public.clube_atual_id())
               and exists (select 1 from public.unidades un where un.id = p_uni and un.club_id = public.clube_atual_id()) then (
    with membros as (
      select p.id, p.nome, p.foto
      from public.profiles p
      where p.unidade_id = p_uni and p.status = 'ativo'
        and p.papel in ('desbravador', 'conselheiro')
    ),
    conta as (
      select m.nome, m.foto,
        (select count(*) from public.pontos pt
          where pt.usuario_id = m.id and pt.data >= p_desde
            and case
                  when p_tipo = 'missoes'    then pt.origem = 'missao'
                  when p_tipo = 'jogos'      then pt.origem = 'trilha'
                  when p_tipo = 'devocional' then pt.origem = 'devocional'
                  when p_tipo = 'presenca'   then pt.origem = 'apontamento' and pt.marca->>'presenca' = 'presente'
                  else false
                end
        )::int as feito
      from membros m
    )
    select json_build_object(
      'membros', coalesce(json_agg(json_build_object(
          'nome', nome, 'foto', foto, 'feito', feito, 'cumpriu', feito >= p_meta
        ) order by feito desc, nome), '[]'::json),
      'cumpriram', (select count(*) from conta where feito >= p_meta),
      'total', (select count(*) from conta)
    ) from conta
  ) else json_build_object('membros', '[]'::json, 'cumpriram', 0, 'total', 0) end;
$$;
revoke all on function public.progresso_lado(uuid, text, integer, timestamp with time zone) from public, anon, authenticated;

-- ==================== E) clube novo nasce com os desafios padrão ====================
create or replace function public._prov_duelos(p_club_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.desafios_unidade (club_id, titulo, descricao, pontos, dias, ativo, tipo, meta)
  select p_club_id, v.titulo, v.descricao, v.pontos, v.dias, true, v.tipo, v.meta
  from (values
    ('Maratona de missões', 'Cada membro da unidade completa 5 missões na semana.', 60, 7, 'missoes', 5),
    ('Presença total', 'Todos os membros da unidade presentes na próxima reunião.', 50, 7, 'presenca', 1),
    ('Unidade solidária', 'A unidade arrecada 20 itens para doação.', 80, 14, 'manual', 1),
    ('Uniforme impecável', 'Todos de uniforme completo na próxima reunião.', 40, 7, 'manual', 1)
  ) v(titulo, descricao, pontos, dias, tipo, meta)
  where not exists (select 1 from public.desafios_unidade d where d.club_id = p_club_id and d.titulo = v.titulo);
end;
$$;
revoke all on function public._prov_duelos(uuid) from public, anon, authenticated;

select public.provisionar_clube(id) from public.organizational_units where type = 'clube';

-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-duelos-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
