-- =====================================================================
--  Filhos da Conquista — Duelo entre Unidades (2026-07-14)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Uma unidade DESAFIA a outra a cumprir um requisito pré-definido:
--   1) A liderança cadastra o CATÁLOGO de desafios (título, pontos, prazo).
--   2) QUALQUER desbravador escolhe um desafio e desafia OUTRA unidade (sempre
--      pela unidade dele). As duas unidades recebem aviso 🔔.
--   3) No fim do prazo, a LIDERANÇA julga (A, B, ambos, ninguém).
--   4) A(s) vencedora(s) leva(m) os pontos de time (entram no ranking).
--
--  SEGURANÇA (o que este arquivo protege):
--   * Criar/julgar/cancelar só por função (security definer). Não há policy de
--     INSERT/UPDATE em duelos — ninguém escreve "na mão" pela API.
--   * Só se desafia PELA PRÓPRIA unidade; nunca a si mesma.
--   * Teto de 3 duelos ABERTOS por unidade + no máximo 3 duelos CRIADOS por
--     pessoa a cada 24h. (Sem o 2º teto, dava pra criar/cancelar em loop e
--     tocar o push do clube inteiro sem parar.)
--   * Cancelar MARCA como 'cancelado' (não apaga): preserva o rastro e não
--     zera os contadores.
--   * Índice único impede 2 duelos abertos do mesmo desafio entre as mesmas
--     duas unidades — inclusive na corrida "espelhada" (X desafia Y no mesmo
--     instante em que Y desafia X), que premiaria em dobro.
--   * O duelo GUARDA o título/pontos do momento (snapshot): editar o catálogo
--     depois não reescreve o histórico já julgado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) CATÁLOGO: os requisitos pré-definidos que a liderança cadastra
-- ---------------------------------------------------------------------
create table if not exists public.desafios_unidade (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  pontos int not null default 50,   -- prêmio de time pra vencedora
  dias int not null default 7,      -- prazo (dias a partir de hoje)
  ativo boolean not null default true,
  created_at timestamptz default now()
);
alter table public.desafios_unidade enable row level security;

drop policy if exists "ler desafios_unidade" on public.desafios_unidade;
create policy "ler desafios_unidade" on public.desafios_unidade
  for select to authenticated using (true);

drop policy if exists "gerir desafios_unidade" on public.desafios_unidade;
create policy "gerir desafios_unidade" on public.desafios_unidade
  for all to authenticated using (public.pode_gerir()) with check (public.pode_gerir());

-- ---------------------------------------------------------------------
-- 2) DUELOS: unidade A desafia unidade B
-- ---------------------------------------------------------------------
create table if not exists public.duelos (
  id uuid primary key default gen_random_uuid(),
  desafio_id uuid not null references public.desafios_unidade(id) on delete restrict,
  titulo text,                      -- snapshot do catálogo (histórico não muda)
  pontos int not null default 0,    -- snapshot do prêmio
  unidade_a uuid not null references public.unidades(id) on delete cascade,  -- desafiante
  unidade_b uuid not null references public.unidades(id) on delete cascade,  -- desafiada
  criado_por uuid references public.profiles(id) on delete set null,
  prazo date not null,
  status text not null default 'aberto',   -- aberto | julgado | cancelado
  vencedor text,                           -- a | b | ambos | ninguem
  julgado_por uuid references public.profiles(id) on delete set null,
  julgado_em timestamptz,
  created_at timestamptz default now(),
  constraint duelos_unidades_diferentes check (unidade_a <> unidade_b),
  constraint duelos_status_valido check (status in ('aberto', 'julgado', 'cancelado')),
  constraint duelos_vencedor_valido check (vencedor is null or vencedor in ('a', 'b', 'ambos', 'ninguem'))
);
-- Re-rodada segura em bancos que já tenham a tabela de uma versão anterior:
alter table public.duelos add column if not exists titulo text;
alter table public.duelos add column if not exists pontos int not null default 0;
alter table public.duelos drop constraint if exists duelos_status_valido;
alter table public.duelos add constraint duelos_status_valido
  check (status in ('aberto', 'julgado', 'cancelado'));

create index if not exists idx_duelos_status on public.duelos(status, prazo);

-- Preenche o snapshot dos duelos que já existiam (versão anterior sem as colunas).
-- Sem isso, um duelo antigo seria julgado premiando ZERO ponto, em silêncio.
-- Em banco novo isto é no-op (não há linhas).
update public.duelos d
   set titulo = coalesce(d.titulo, c.titulo),
       pontos = case when coalesce(d.pontos, 0) = 0 then c.pontos else d.pontos end
  from public.desafios_unidade c
 where c.id = d.desafio_id
   and (d.titulo is null or coalesce(d.pontos, 0) = 0);

-- Se o banco JÁ tiver duelos duplicados (o bug que o índice abaixo vem impedir),
-- o create unique index falharia e daria ROLLBACK NO SCRIPT INTEIRO. Então
-- cancelamos as duplicatas antes, mantendo a mais antiga de cada par.
-- Em banco novo isto também é no-op.
with dup as (
  select id, row_number() over (
    partition by desafio_id, least(unidade_a, unidade_b), greatest(unidade_a, unidade_b)
    order by created_at
  ) as rn
  from public.duelos where status = 'aberto'
)
update public.duelos set status = 'cancelado'
 where id in (select id from dup where rn > 1);

-- BACKSTOP contra duelo duplicado (inclusive corrida espelhada X->Y e Y->X):
-- o par de unidades é normalizado (menor, maior), então só cabe 1 duelo ABERTO
-- do mesmo desafio entre as mesmas duas unidades.
create unique index if not exists duelos_par_aberto_key
  on public.duelos (desafio_id, least(unidade_a, unidade_b), greatest(unidade_a, unidade_b))
  where status = 'aberto';

alter table public.duelos enable row level security;

-- Todos VEEM os duelos (é uma disputa pública do clube)
drop policy if exists "ler duelos" on public.duelos;
create policy "ler duelos" on public.duelos for select to authenticated using (true);

-- NÃO existe policy de insert/update: criar, julgar e cancelar só pelas funções.
-- Apagar de vez: só a liderança (o autor CANCELA, que marca sem apagar).
drop policy if exists "apagar duelo" on public.duelos;
create policy "apagar duelo" on public.duelos for delete to authenticated
  using (public.pode_gerir());

-- ---------------------------------------------------------------------
-- 3) Qual a MINHA unidade — security definer pra não esbarrar no RLS
-- ---------------------------------------------------------------------
create or replace function public.minha_unidade()
returns uuid language sql stable security definer set search_path = '' as $$
  select unidade_id from public.profiles where id = auth.uid()
$$;
grant execute on function public.minha_unidade() to authenticated;

-- ---------------------------------------------------------------------
-- 4) CRIAR duelo — qualquer desbravador, SEMPRE pela sua própria unidade
-- ---------------------------------------------------------------------
create or replace function public.criar_duelo(p_desafio_id uuid, p_unidade_b uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
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
  if v_ua is null then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra desafiar.';
  end if;
  if p_unidade_b is null or p_unidade_b = v_ua then
    raise exception 'Escolha OUTRA unidade pra desafiar.';
  end if;
  if not exists (select 1 from public.unidades where id = p_unidade_b) then
    raise exception 'Unidade não encontrada.';
  end if;

  -- O desafio precisa existir e estar ativo (e guardamos o snapshot dele)
  select dias, titulo, pontos into v_dias, v_titulo, v_pontos
  from public.desafios_unidade where id = p_desafio_id and ativo;
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
grant execute on function public.criar_duelo(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) CANCELAR duelo — o autor (enquanto aberto) ou a liderança.
--    MARCA como cancelado; não apaga (preserva rastro e contadores).
-- ---------------------------------------------------------------------
create or replace function public.cancelar_duelo(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_dono uuid; v_status text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;

  select criado_por, status into v_dono, v_status
  from public.duelos where id = p_id for update;

  if not found then raise exception 'Duelo não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse duelo já foi encerrado.'; end if;
  if not (public.pode_gerir() or v_dono = v_uid) then
    raise exception 'Só quem lançou o duelo (ou a liderança) pode cancelar.';
  end if;

  update public.duelos set status = 'cancelado' where id = p_id;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.cancelar_duelo(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) JULGAR duelo — só liderança. Premia a(s) vencedora(s) e fecha o duelo.
--    Usa o SNAPSHOT do duelo (não o catálogo atual).
-- ---------------------------------------------------------------------
create or replace function public.julgar_duelo(p_id uuid, p_vencedor text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status text; v_ua uuid; v_ub uuid;
  v_pontos int; v_titulo text;
begin
  if not public.pode_gerir() then raise exception 'Só a liderança pode julgar.'; end if;
  if p_vencedor is null or p_vencedor not in ('a', 'b', 'ambos', 'ninguem') then
    raise exception 'Resultado inválido.';
  end if;

  -- Trava a linha: dois julgamentos ao mesmo tempo não premiam em dobro
  select status, unidade_a, unidade_b, coalesce(pontos, 0), coalesce(titulo, 'desafio')
    into v_status, v_ua, v_ub, v_pontos, v_titulo
  from public.duelos where id = p_id for update;

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
grant execute on function public.julgar_duelo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Aviso 🔔 quando nasce um duelo (mesmo caminho do push já existente)
-- ---------------------------------------------------------------------
create or replace function public.notif_duelo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_a text; v_b text;
begin
  select nome into v_a from public.unidades where id = new.unidade_a;
  select nome into v_b from public.unidades where id = new.unidade_b;
  insert into public.notificacoes (titulo, corpo, tipo, link, para)
  values ('⚔️ Novo duelo entre unidades!',
          coalesce(v_a, 'Uma unidade') || ' desafiou ' || coalesce(v_b, 'outra unidade')
            || ': ' || coalesce(new.titulo, 'um desafio'),
          'geral', '/desafios', 'todos');
  return new;
end;
$$;
drop trigger if exists trg_notif_duelo on public.duelos;
create trigger trg_notif_duelo after insert on public.duelos
  for each row execute function public.notif_duelo();

-- ---------------------------------------------------------------------
-- 8) Alguns desafios pra começar (só se o catálogo estiver vazio)
-- ---------------------------------------------------------------------
insert into public.desafios_unidade (titulo, descricao, pontos, dias)
select v.titulo, v.descricao, v.pontos, v.dias
from (values
  ('Presença total',      'Todos os membros da unidade presentes na próxima reunião.', 50, 7),
  ('Maratona de missões', 'Cada membro da unidade completa 5 missões na semana.',       60, 7),
  ('Unidade solidária',   'A unidade arrecada 20 itens para doação.',                   80, 14),
  ('Uniforme impecável',  'Todos de uniforme completo na próxima reunião.',             40, 7)
) as v(titulo, descricao, pontos, dias)
where not exists (select 1 from public.desafios_unidade);

notify pgrst, 'reload schema';
