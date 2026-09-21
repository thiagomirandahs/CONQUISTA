-- =====================================================================
-- DesbravaClube — Correções multi-tenant 3/5: leilão (cron) e escopo do recurso opcional
--
-- BUG (regressão da 20260921000008): pontos_temporada_unidade() passou a depender de
-- clube_atual_id() -> auth.uid(). O fechamento AUTOMÁTICO do leilão roda no pg_cron, sem
-- sessão: o saldo de toda unidade virava 0 e o vencedor levava o item SEM PAGAR. O botão
-- "Encerrar agora" (com sessão) cobrava certo — daí o desencontro.
--
-- CORREÇÃO: o cálculo de pontos por unidade passa a derivar o clube da PRÓPRIA UNIDADE
-- (nunca da sessão) numa função interna; a versão pública só responde a membro do clube
-- da unidade. O núcleo do fechamento usa a interna: cron e manual cobram o mesmo.
--
-- Escopo: o leilão ainda é do Tenant 001 (itens/lances/rateio/cron não têm club_id).
-- O "recurso opcional" agora vale NO BANCO (antes era só interface): leitura, criação e
-- lances exigem clube legado + recurso ligado em club_features. Outro clube não vê nem
-- opera; a separação interna do leilão por clube segue como pendência.
-- =====================================================================

-- ---------- temporada por clube (sem sessão) ----------
create or replace function public.temporada_inicio_clube(p_club_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(max(inicio), '-infinity'::timestamptz)
  from public.temporadas where club_id = p_club_id and fim is null;
$$;
revoke all on function public.temporada_inicio_clube(uuid) from public, anon, authenticated;

create or replace function public.temporada_inicio() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select public.temporada_inicio_clube(public.clube_atual_id());
$$;

-- ---------- pontos da unidade na temporada: núcleo (sem sessão) + versão pública ----------
create or replace function public._pontos_temporada_unidade_interno(p_unidade_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select coalesce((
             select sum(p.pontos)::int from public.pontos p
             join public.profiles pr on pr.id = p.usuario_id
             where p.club_id = u.club_id and pr.unidade_id = u.id and pr.status = 'ativo'
               and coalesce(p.data, '-infinity'::timestamptz) >= public.temporada_inicio_clube(u.club_id)
           ), 0)
         + coalesce((
             select sum(p2.pontos)::int from public.pontos p2
             where p2.club_id = u.club_id and p2.unidade_id = u.id and p2.usuario_id is null
               and coalesce(p2.data, '-infinity'::timestamptz) >= public.temporada_inicio_clube(u.club_id)
           ), 0)
    from public.unidades u where u.id = p_unidade_id
  ), 0);
$$;
revoke all on function public._pontos_temporada_unidade_interno(uuid) from public, anon, authenticated;

create or replace function public.pontos_temporada_unidade(p_unidade_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when public.membro_ativo_no_clube((select club_id from public.unidades where id = p_unidade_id))
    then public._pontos_temporada_unidade_interno(p_unidade_id)
    else 0 end;
$$;

-- ---------- núcleo do fechamento: idêntico ao anterior, só troca a fonte do saldo ----------
create or replace function public._leilao_fechar_core(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item record;
  v_lance record;
  v_itens_com_vencedor int := 0;
begin
  create temporary table if not exists tmp_leilao_unidades (
    unidade_id uuid primary key, peso numeric not null, cobrado int not null default 0
  ) on commit drop;
  delete from tmp_leilao_unidades;

  insert into tmp_leilao_unidades (unidade_id, peso)
  select distinct lu.unidade_id, greatest(public._pontos_temporada_unidade_interno(lu.unidade_id), 0)
  from public.leilao_lance_unidades lu
  join public.leilao_lances l on l.id = lu.lance_id
  join public.leilao_itens it on it.id = l.item_id
  where it.leilao_id = p_id and l.status = 'ativo';

  for v_item in select * from public.leilao_itens where leilao_id = p_id order by ordem loop
    select l.* into v_lance from public.leilao_lances l
      where l.item_id = v_item.id and l.status = 'ativo' limit 1;

    if found then
      update public.leilao_lances set status = 'vencedor' where id = v_lance.id;
      update public.leilao_itens set vencedor_lance_id = v_lance.id where id = v_item.id;

      -- Rateio (método dos maiores restos), materializado UMA VEZ numa tabela
      -- temporária e reaproveitado pros dois escritos abaixo — evitar calcular
      -- a mesma conta duas vezes (e correr o risco de ela divergir).
      create temporary table if not exists tmp_leilao_parcelas (
        unidade_id uuid primary key, parcela int not null
      ) on commit drop;
      delete from tmp_leilao_parcelas;

      insert into tmp_leilao_parcelas (unidade_id, parcela)
      with pesos as (
        select tu.unidade_id, tu.peso, tu.cobrado as ja_cobrado
        from public.leilao_lance_unidades lu
        join tmp_leilao_unidades tu on tu.unidade_id = lu.unidade_id
        where lu.lance_id = v_lance.id
      ),
      total as (select coalesce(sum(peso), 0) as soma, count(*) as n from pesos),
      bruto as (
        select p.unidade_id, p.ja_cobrado, p.peso,
          case when t.soma > 0 then v_lance.valor::numeric * p.peso / t.soma
               else v_lance.valor::numeric / t.n end as fatia
        from pesos p cross join total t
      ),
      repartido as (
        select unidade_id, ja_cobrado, peso, floor(fatia)::int as base, fatia - floor(fatia) as frac
        from bruto
      ),
      sobra as (
        select greatest(v_lance.valor - coalesce((select sum(base) from repartido), 0), 0) as extra
      )
      select r.unidade_id,
        least(
          r.base + case when row_number() over (order by r.frac desc, r.unidade_id) <= (select extra from sobra) then 1 else 0 end,
          greatest(r.peso::int - r.ja_cobrado, 0)
        ) as parcela
      from repartido r;

      insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por)
      select unidade_id, 'leilao', -parcela, 'Venceu "' || v_item.nome || '" no leilão', v_uid
      from tmp_leilao_parcelas where parcela > 0;

      update tmp_leilao_unidades tu set cobrado = tu.cobrado + p.parcela
      from tmp_leilao_parcelas p where tu.unidade_id = p.unidade_id and p.parcela > 0;

      v_itens_com_vencedor := v_itens_com_vencedor + 1;
    end if;
  end loop;

  -- Lances pendentes (convites de lance conjunto que ninguém confirmou a
  -- tempo) não valem mais depois do leilão encerrado.
  update public.leilao_lances set status = 'superado'
   where status = 'pendente' and item_id in (select id from public.leilao_itens where leilao_id = p_id);

  update public.leiloes set status = 'encerrado', encerrado_em = now() where id = p_id;

  return json_build_object('ok', true, 'itens_com_vencedor', v_itens_com_vencedor);
end;
$$;
revoke all on function public._leilao_fechar_core(uuid) from public, anon, authenticated, service_role;
revoke all on function public.fechar_leiloes_vencidos() from public, anon, authenticated, service_role;

-- ---------- recurso opcional NO BANCO ----------
create or replace function public.leilao_disponivel() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.membro_ativo_no_clube(public.clube_legado_id())
     and public.recurso_habilitado_no_clube(public.clube_legado_id(), 'leilao');
$$;
grant execute on function public.leilao_disponivel() to authenticated;

drop policy if exists "ler leiloes" on public.leiloes;
create policy "ler leiloes" on public.leiloes for select to authenticated using (public.leilao_disponivel());
drop policy if exists "ler leilao_itens" on public.leilao_itens;
create policy "ler leilao_itens" on public.leilao_itens for select to authenticated using (public.leilao_disponivel());
drop policy if exists "ler leilao_lances" on public.leilao_lances;
create policy "ler leilao_lances" on public.leilao_lances for select to authenticated using (public.leilao_disponivel());
drop policy if exists "ler leilao_lance_unidades" on public.leilao_lance_unidades;
create policy "ler leilao_lance_unidades" on public.leilao_lance_unidades for select to authenticated using (public.leilao_disponivel());

-- Integridade nos dados (vale para qualquer RPC): só quem é do clube do leilão, com o
-- recurso ligado, cria leilão/lance; só unidade desse clube entra num lance conjunto.
create or replace function public.exigir_leilao_habilitado() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pessoa uuid; v_unidade uuid;
begin
  if tg_table_name in ('leiloes', 'leilao_lances') then v_pessoa := new.criado_por; end if;
  if tg_table_name = 'leilao_lance_unidades' then v_unidade := new.unidade_id; end if;

  if v_pessoa is not null and public.clube_do_usuario(v_pessoa) is distinct from public.clube_legado_id() then
    raise exception 'O leilão não está habilitado para o seu clube.';
  end if;
  if v_unidade is not null
     and (select club_id from public.unidades where id = v_unidade) is distinct from public.clube_legado_id() then
    raise exception 'Só unidades do clube do leilão podem participar.';
  end if;
  if not public.recurso_habilitado_no_clube(public.clube_legado_id(), 'leilao') then
    raise exception 'O leilão não está habilitado neste clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.exigir_leilao_habilitado() from public, anon, authenticated;

drop trigger if exists trg_exigir_leilao_leiloes on public.leiloes;
create trigger trg_exigir_leilao_leiloes before insert on public.leiloes
for each row execute function public.exigir_leilao_habilitado();
drop trigger if exists trg_exigir_leilao_lances on public.leilao_lances;
create trigger trg_exigir_leilao_lances before insert on public.leilao_lances
for each row execute function public.exigir_leilao_habilitado();
drop trigger if exists trg_exigir_leilao_lance_unidades on public.leilao_lance_unidades;
create trigger trg_exigir_leilao_lance_unidades before insert on public.leilao_lance_unidades
for each row execute function public.exigir_leilao_habilitado();

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-leilao-cron-e-escopo.sql')
on conflict (arquivo) do update set aplicada_em = now();
