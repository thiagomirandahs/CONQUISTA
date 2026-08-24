-- =====================================================================
--  Filhos da Conquista — Leilão de itens (2026-08-18, revisado)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run.
--  Idempotente. Nada é apagado.
--
--  Como funciona:
--   1) A liderança cria o leilão (título + data/hora de fechamento) com os
--      itens e o preço-base de cada um.
--   2) Qualquer desbravador/conselheiro dá lance PELA SUA unidade (o lance
--      usa os pontos que a unidade já tem na temporada). Pode CONVIDAR
--      outras unidades pro mesmo lance (lance conjunto) — nesse caso o
--      lance fica PENDENTE até alguém de CADA unidade convidada confirmar
--      (ninguém gasta ponto de unidade alheia sem alguém de lá aceitar).
--   3) Enquanto o leilão está aberto, os pontos usados num lance ATIVO
--      ficam "reservados" (contam como indisponíveis pra outros lances) e
--      voltam automaticamente se a unidade for superada — nada é
--      descontado ainda.
--   4) No horário marcado, o leilão fecha sozinho (pg_cron, roda a cada 5
--      minutos) — ou a liderança pode encerrar na hora. Cada item vai pra
--      quem estiver na frente; os pontos SÓ AÍ são descontados de verdade
--      (rateados entre as unidades participantes, proporcional ao total de
--      pontos de cada uma, sempre batendo exatamente com o valor do lance).
--
--  SEGURANÇA (o que este arquivo protege):
--   * Criar/dar lance/confirmar/recusar/encerrar/cancelar só por função
--     (security definer). Não há policy de INSERT/UPDATE — ninguém escreve
--     "na mão".
--   * Só dá lance PELA PRÓPRIA unidade direto; convidar outra unidade exige
--     que ALGUÉM DE LÁ confirme antes do lance valer de verdade.
--   * Dar lance, confirmar, recusar, encerrar/cancelar e o cron travam TODOS
--     a MESMA linha do leilão (select ... for update): um lance nunca fica
--     "solto" atravessando um fechamento (ou uma recusa) concorrente.
--   * O saldo disponível já desconta o que a unidade tem reservado em
--     OUTROS itens do mesmo leilão — não dá pra prometer o mesmo ponto 2x.
--   * O rateio final usa o método dos maiores restos (a soma bate exatamente
--     com o valor do lance QUANDO todo mundo tem saldo suficiente) e
--     recalcula o "quanto cada unidade tem de verdade" NA HORA DE FECHAR
--     (não no momento do lance) — protege contra a unidade ter perdido
--     pontos por outro motivo (ex: desconto manual) enquanto o leilão estava
--     aberto, e contra a mesma unidade vencer 2 itens sem ter saldo pros
--     dois. Nesse caso-limite (perdeu pontos no meio do caminho) a unidade
--     nunca é cobrada além do que tem — a parcela dela é reduzida em vez de
--     ficar negativa, e o item ainda assim vai pra ela (por menos pontos).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.leiloes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  fecha_em timestamptz not null,
  status text not null default 'aberto',
  criado_por uuid references public.profiles(id) on delete set null,
  encerrado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint leiloes_status_valido check (status in ('aberto', 'encerrado', 'cancelado'))
);
create index if not exists idx_leiloes_status on public.leiloes(status);
-- No máximo 1 leilão aberto por vez (evita confusão de "qual leilão é esse lance")
create unique index if not exists um_leilao_aberto on public.leiloes ((true)) where status = 'aberto';

create table if not exists public.leilao_itens (
  id uuid primary key default gen_random_uuid(),
  leilao_id uuid not null references public.leiloes(id) on delete cascade,
  nome text not null,
  emoji text,
  descricao text,
  preco_base int not null default 0,
  incremento_minimo int not null default 5,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  constraint leilao_itens_preco_valido check (preco_base >= 0),
  constraint leilao_itens_incremento_valido check (incremento_minimo > 0)
);
create index if not exists idx_leilao_itens_leilao on public.leilao_itens(leilao_id, ordem);

create table if not exists public.leilao_lances (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.leilao_itens(id) on delete cascade,
  criado_por uuid not null references public.profiles(id) on delete cascade,
  valor int not null,
  status text not null default 'ativo',
  created_at timestamptz not null default now(),
  constraint leilao_lances_valor_valido check (valor > 0),
  constraint leilao_lances_status_valido check (status in ('ativo', 'pendente', 'superado', 'vencedor'))
);
create index if not exists idx_lances_item_status on public.leilao_lances(item_id, status);

create table if not exists public.leilao_lance_unidades (
  lance_id uuid not null references public.leilao_lances(id) on delete cascade,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  confirmado boolean not null default true,
  primary key (lance_id, unidade_id)
);
create index if not exists idx_lance_unidades_unidade on public.leilao_lance_unidades(unidade_id);
-- Re-rodada segura em bancos que já tenham a tabela de uma versão anterior:
alter table public.leilao_lance_unidades add column if not exists confirmado boolean not null default true;
alter table public.leilao_lances drop constraint if exists leilao_lances_status_valido;
alter table public.leilao_lances add constraint leilao_lances_status_valido
  check (status in ('ativo', 'pendente', 'superado', 'vencedor'));

-- Guarda qual lance venceu cada item (referência criada depois de leilao_lances existir)
alter table public.leilao_itens
  add column if not exists vencedor_lance_id uuid references public.leilao_lances(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2) RLS — todo mundo LÊ (é uma disputa pública do clube); escrita só via função
-- ---------------------------------------------------------------------
alter table public.leiloes enable row level security;
drop policy if exists "ler leiloes" on public.leiloes;
create policy "ler leiloes" on public.leiloes for select to authenticated using (true);

alter table public.leilao_itens enable row level security;
drop policy if exists "ler leilao_itens" on public.leilao_itens;
create policy "ler leilao_itens" on public.leilao_itens for select to authenticated using (true);

alter table public.leilao_lances enable row level security;
drop policy if exists "ler leilao_lances" on public.leilao_lances;
create policy "ler leilao_lances" on public.leilao_lances for select to authenticated using (true);

alter table public.leilao_lance_unidades enable row level security;
drop policy if exists "ler leilao_lance_unidades" on public.leilao_lance_unidades;
create policy "ler leilao_lance_unidades" on public.leilao_lance_unidades for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 3) Pontos que a unidade tem NA TEMPORADA ATUAL (a "carteira" bruta, sem
--    descontar reservas de leilão) — mesma janela de tempo do ranking normal.
-- ---------------------------------------------------------------------
create or replace function public.pontos_temporada_unidade(p_unidade_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((
    select sum(p.pontos)::int from public.pontos p
    join public.profiles pr on pr.id = p.usuario_id
    where pr.unidade_id = p_unidade_id and pr.status = 'ativo'
      and coalesce(p.data, '-infinity'::timestamptz) >= public.temporada_inicio()
  ), 0)
  +
  coalesce((
    select sum(p2.pontos)::int from public.pontos p2
    where p2.unidade_id = p_unidade_id and p2.usuario_id is null
      and coalesce(p2.data, '-infinity'::timestamptz) >= public.temporada_inicio()
  ), 0);
$$;
grant execute on function public.pontos_temporada_unidade(uuid) to authenticated;

-- Saldo disponível pro leilão = carteira - o que já está reservado em lances
-- ATIVOS (vencendo agora) em QUALQUER item de um leilão ABERTO. Lances
-- PENDENTES (aguardando confirmação de outra unidade) não reservam nada.
create or replace function public.leilao_saldo_unidade(p_unidade_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select greatest(0,
    public.pontos_temporada_unidade(p_unidade_id)
    - coalesce((
      select sum(l.valor)::int
      from public.leilao_lances l
      join public.leilao_lance_unidades lu on lu.lance_id = l.id
      join public.leilao_itens it on it.id = l.item_id
      join public.leiloes le on le.id = it.leilao_id
      where lu.unidade_id = p_unidade_id and l.status = 'ativo' and le.status = 'aberto'
    ), 0)
  );
$$;
grant execute on function public.leilao_saldo_unidade(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) CRIAR leilão — só liderança (instrutor/diretoria)
--    p_itens: [{nome, emoji, descricao, preco_base, incremento_minimo}, ...]
-- ---------------------------------------------------------------------
create or replace function public.criar_leilao(p_titulo text, p_fecha_em timestamptz, p_itens jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_leilao_id uuid;
  v_item jsonb;
  v_ordem int := 0;
  v_nome text;
begin
  if not public.pode_gerir() then raise exception 'Só a liderança pode criar um leilão.'; end if;
  if p_titulo is null or length(trim(p_titulo)) = 0 then raise exception 'Dê um título ao leilão.'; end if;
  if p_fecha_em is null or p_fecha_em <= now() then raise exception 'A data de encerramento precisa ser no futuro.'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Cadastre ao menos 1 item.';
  end if;
  if exists (select 1 from public.leiloes where status = 'aberto') then
    raise exception 'Já existe um leilão aberto. Encerre-o antes de criar outro.';
  end if;

  insert into public.leiloes (titulo, fecha_em, criado_por)
  values (trim(p_titulo), p_fecha_em, v_uid)
  returning id into v_leilao_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_nome := trim(coalesce(v_item->>'nome', ''));
    if length(v_nome) = 0 then raise exception 'Todo item precisa de um nome.'; end if;
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
$$;
grant execute on function public.criar_leilao(text, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5) DAR LANCE — qualquer desbravador/conselheiro ativo, sempre pela
--    própria unidade. p_unidades_extra CONVIDA outras unidades pro mesmo
--    lance: nesse caso o lance nasce PENDENTE (não compete ainda, não
--    reserva ponto de ninguém) até cada unidade convidada confirmar
--    (função confirmar_lance_conjunto).
--
--    dar_lance e o fechamento (encerrar/cancelar/cron) travam a MESMA
--    linha da tabela leiloes (select ... for update) — por isso um lance
--    nunca fica "solto" atravessando um fechamento concorrente, e dois
--    lances no mesmo leilão nunca correm por cima um do outro.
-- ---------------------------------------------------------------------
create or replace function public.dar_lance(p_item_id uuid, p_valor int, p_unidades_extra uuid[] default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
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
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Lance inválido.'; end if;

  select unidade_id, papel into v_minha_unidade, v_meu_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_minha_unidade is null then
    raise exception 'Você precisa estar numa unidade (com cadastro aprovado) pra dar lance.';
  end if;
  -- Só quem de fato compete pela unidade (desbravador/conselheiro) dá lance —
  -- diretoria/instrutor/tesoureiro não jogam os jogos que geram os pontos.
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem dar lance no leilão.';
  end if;

  select array_agg(distinct u) into v_unidades
  from unnest(array[v_minha_unidade] || coalesce(p_unidades_extra, '{}'::uuid[])) as u;
  v_pendente := array_length(v_unidades, 1) > 1;

  select it.leilao_id, it.preco_base, it.incremento_minimo, it.nome
    into v_leilao_id, v_preco_base, v_incremento, v_nome_item
  from public.leilao_itens it where it.id = p_item_id;
  if v_leilao_id is null then raise exception 'Item não encontrado.'; end if;

  -- Trava a LINHA do leilão — a MESMA trava que encerrar/cancelar/cron usam.
  select status, fecha_em into v_leilao_status, v_fecha_em
  from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

  foreach v_u in array v_unidades loop
    if not exists (select 1 from public.unidades where id = v_u) then
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
    -- Lance conjunto: nasce PENDENTE. Não mexe no lance ativo atual, não
    -- reserva ponto de ninguém ainda — só confirma quando todo mundo aceitar.
    insert into public.leilao_lances (item_id, criado_por, valor, status)
    values (p_item_id, v_uid, p_valor, 'pendente')
    returning id into v_lance_id;

    insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
    select v_lance_id, u, u = v_minha_unidade from unnest(v_unidades) as u;

    return json_build_object('id', v_lance_id, 'valor', p_valor, 'item', v_nome_item, 'pendente', true);
  end if;

  -- Lance solo (só a própria unidade): confere saldo e ativa na hora.
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

  update public.leilao_lances set status = 'superado'
   where item_id = p_item_id and status = 'ativo';

  insert into public.leilao_lances (item_id, criado_por, valor, status)
  values (p_item_id, v_uid, p_valor, 'ativo')
  returning id into v_lance_id;

  insert into public.leilao_lance_unidades (lance_id, unidade_id, confirmado)
  values (v_lance_id, v_minha_unidade, true);

  return json_build_object('id', v_lance_id, 'valor', p_valor, 'item', v_nome_item, 'pendente', false);
end;
$$;
grant execute on function public.dar_lance(uuid, int, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 6) CONFIRMAR lance conjunto — alguém ativo da unidade CONVIDADA aceita.
--    Quando TODAS as unidades do lance já confirmaram, ele é validado de
--    novo (pode ter mudado desde a proposta) e ativado.
-- ---------------------------------------------------------------------
create or replace function public.confirmar_lance_conjunto(p_lance_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_minha_unidade uuid;
  v_item_id uuid; v_valor int; v_leilao_id uuid;
  v_leilao_status text; v_fecha_em timestamptz;
  v_preco_base int; v_incremento int;
  v_status_atual text;
  v_maior_valor int;
  v_faltam int;
  v_u uuid;
  v_saldo int;
  v_nome_unidade text;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select unidade_id, papel into v_minha_unidade, v_meu_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem confirmar lance no leilão.';
  end if;

  select l.item_id, l.valor, it.leilao_id, it.preco_base, it.incremento_minimo
    into v_item_id, v_valor, v_leilao_id, v_preco_base, v_incremento
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id;
  if v_item_id is null then raise exception 'Lance não encontrado.'; end if;

  if not exists (
    select 1 from public.leilao_lance_unidades
    where lance_id = p_lance_id and unidade_id = v_minha_unidade and confirmado = false
  ) then
    raise exception 'Sua unidade não precisa confirmar esse lance.';
  end if;

  -- Trava a linha do leilão — a MESMA trava usada por dar_lance, recusar,
  -- encerrar/cancelar e o cron. Ninguém mais consegue mexer nesse lance
  -- enquanto estivermos com a trava (fecha a corrida com um recusar/fechamento
  -- concorrente no mesmo lance).
  select status, fecha_em into v_leilao_status, v_fecha_em from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

  -- Já com a trava: confere de novo se o lance CONTINUA pendente (pode ter
  -- sido recusado por alguém, ou superado pelo fechamento, um instante atrás).
  select status into v_status_atual from public.leilao_lances where id = p_lance_id;
  if v_status_atual <> 'pendente' then
    raise exception 'Esse lance não está mais pendente (alguém recusou, ou o leilão fechou).';
  end if;

  update public.leilao_lance_unidades set confirmado = true
   where lance_id = p_lance_id and unidade_id = v_minha_unidade;

  select count(*) into v_faltam from public.leilao_lance_unidades
  where lance_id = p_lance_id and confirmado = false;
  if v_faltam > 0 then
    return json_build_object('ativado', false, 'faltam', v_faltam);
  end if;

  -- Todo mundo confirmou: valida de novo (o mundo pode ter mudado) e ativa.
  -- IMPORTANTE: aqui a gente NÃO usa "raise exception" quando invalida — uma
  -- exceção sem tratamento desfaz a transação INTEIRA (inclusive o "marca
  -- como superado" logo antes dela), deixando o lance "pendente" de novo pra
  -- sempre. Por isso devolve o motivo no JSON e deixa a transação commitar.
  select coalesce(max(valor), 0) into v_maior_valor
  from public.leilao_lances where item_id = v_item_id and status = 'ativo';
  if v_valor < v_preco_base or (v_maior_valor > 0 and v_valor < v_maior_valor + v_incremento) then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false,
      'motivo', 'Enquanto vocês combinavam, outra unidade deu um lance maior. Esse lance não vale mais.');
  end if;

  for v_u in select unidade_id from public.leilao_lance_unidades where lance_id = p_lance_id loop
    select public.leilao_saldo_unidade(v_u) into v_saldo;
    if v_saldo < v_valor then
      update public.leilao_lances set status = 'superado' where id = p_lance_id;
      select nome into v_nome_unidade from public.unidades where id = v_u;
      return json_build_object('ativado', false, 'motivo',
        'A unidade ' || coalesce(v_nome_unidade, '?') || ' não tem mais ' || v_valor || ' pontos disponíveis. Esse lance não vale mais.');
    end if;
  end loop;

  update public.leilao_lances set status = 'superado' where item_id = v_item_id and status = 'ativo';
  update public.leilao_lances set status = 'ativo' where id = p_lance_id and status = 'pendente';

  return json_build_object('ativado', true);
end;
$$;
grant execute on function public.confirmar_lance_conjunto(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6b) RECUSAR lance conjunto — alguém ativo de uma unidade CONVIDADA (que
--    ainda não confirmou) recusa. Sem aquela unidade o lance conjunto não
--    pode mais se completar (o valor foi combinado contando com ela), então
--    o lance inteiro vira 'superado' — não dá pra "tirar" só quem recusou
--    e manter o resto valendo.
-- ---------------------------------------------------------------------
create or replace function public.recusar_lance_conjunto(p_lance_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_minha_unidade uuid;
  v_leilao_id uuid;
  v_leilao_status text;
  v_status_atual text;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select unidade_id, papel into v_minha_unidade, v_meu_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem recusar lance no leilão.';
  end if;

  select it.leilao_id into v_leilao_id
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id;
  if v_leilao_id is null then raise exception 'Lance não encontrado.'; end if;

  if not exists (
    select 1 from public.leilao_lance_unidades
    where lance_id = p_lance_id and unidade_id = v_minha_unidade and confirmado = false
  ) then
    raise exception 'Sua unidade não precisa confirmar esse lance.';
  end if;

  -- Trava a MESMA linha do leilão que dar_lance/confirmar/encerrar/cron usam
  -- (não a linha do lance) — assim recusar nunca corre por cima de um
  -- confirmar_lance_conjunto ativando o mesmo lance ao mesmo tempo.
  select status into v_leilao_status from public.leiloes where id = v_leilao_id for update;

  select status into v_status_atual from public.leilao_lances where id = p_lance_id;
  if v_status_atual <> 'pendente' then raise exception 'Esse lance não está mais pendente.'; end if;

  update public.leilao_lances set status = 'superado' where id = p_lance_id and status = 'pendente';

  return json_build_object('ok', true);
end;
$$;
grant execute on function public.recusar_lance_conjunto(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7) FECHAR (núcleo, reaproveitado pelo botão da liderança e pelo cron)
--    Cada item com lance ativo -> vira 'vencedor'; desconta os pontos das
--    unidades participantes pelo método dos MAIORES RESTOS (a soma
--    distribuída bate exatamente com o valor do lance; nenhuma parcela
--    fica negativa). O "quanto cada unidade tem" é calculado UMA VEZ no
--    início (não item a item — senão o desconto de um item mudaria o peso
--    do próximo) e cada unidade nunca é cobrada além do que ela realmente
--    tem, mesmo se vencer vários itens no mesmo fechamento.
-- ---------------------------------------------------------------------
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
  select distinct lu.unidade_id, greatest(public.pontos_temporada_unidade(lu.unidade_id), 0)
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
-- Núcleo interno: ninguém chama direto (nem authenticated) — só as duas
-- funções abaixo, de dentro do banco (chamada função-a-função ignora o revoke).
revoke all on function public._leilao_fechar_core(uuid) from public, anon, authenticated, service_role;

-- Botão da liderança: encerra na hora (com o mesmo núcleo acima)
create or replace function public.encerrar_leilao(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.pode_gerir() then raise exception 'Só a liderança pode encerrar o leilão.'; end if;
  select status into v_status from public.leiloes where id = p_id for update;
  if not found then raise exception 'Leilão não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse leilão já foi encerrado.'; end if;
  return public._leilao_fechar_core(p_id);
end;
$$;
grant execute on function public.encerrar_leilao(uuid) to authenticated;

-- Cancelar (antes de fechar): marca 'cancelado', ninguém perde pontos.
create or replace function public.cancelar_leilao(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.pode_gerir() then raise exception 'Só a liderança pode cancelar o leilão.'; end if;
  select status into v_status from public.leiloes where id = p_id for update;
  if not found then raise exception 'Leilão não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse leilão já foi encerrado ou cancelado.'; end if;
  update public.leiloes set status = 'cancelado', encerrado_em = now() where id = p_id;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.cancelar_leilao(uuid) to authenticated;

-- Agendador: fecha sozinho quem passou do horário (roda a cada 5 min).
create or replace function public.fechar_leiloes_vencidos()
returns void language plpgsql security definer set search_path = '' as $$
declare v_leilao record;
begin
  for v_leilao in
    select id from public.leiloes where status = 'aberto' and fecha_em <= now() for update skip locked
  loop
    perform public._leilao_fechar_core(v_leilao.id);
  end loop;
end;
$$;
revoke all on function public.fechar_leiloes_vencidos() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'fechar-leiloes-vencidos') then
    perform cron.unschedule('fechar-leiloes-vencidos');
  end if;
  perform cron.schedule('fechar-leiloes-vencidos', '*/5 * * * *', 'select public.fechar_leiloes_vencidos()');
end $$;

-- ---------------------------------------------------------------------
-- 8) Aviso 🔔 quando abre um leilão novo
-- ---------------------------------------------------------------------
create or replace function public.notif_leilao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para)
  values ('🏛️ Leilão aberto!', 'Junte pontos com sua unidade e dê um lance: ' || coalesce(new.titulo, ''),
          'geral', '/leilao', 'todos');
  return new;
end;
$$;
drop trigger if exists trg_notif_leilao on public.leiloes;
create trigger trg_notif_leilao after insert on public.leiloes
  for each row execute function public.notif_leilao();

notify pgrst, 'reload schema';
