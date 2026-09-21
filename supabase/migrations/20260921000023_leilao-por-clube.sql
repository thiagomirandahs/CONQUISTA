-- =====================================================================
-- Leilão POR CLUBE (recurso opcional: club_features 'leilao'). Rodar DEPOIS da 20260921000022. Idempotente.
--
--  * leiloes / leilao_itens / leilao_lances / leilao_lance_unidades ganham club_id (filhos herdam do pai);
--    o que existe hoje fica no Tenant 001.
--  * Cada clube pode ter o SEU leilão aberto (o índice "1 aberto" passa a ser por clube).
--  * Só clube com o recurso ligado cria leilão; a liderança do clube liga/desliga o dele (club_features).
--  * dar lance / confirmar / recusar / encerrar / cancelar só no PRÓPRIO clube (UUID de outro clube = "não
--    encontrado"); a unidade convidada num lance conjunto tem de ser do mesmo clube.
--  * O fechamento automático (cron) e "Encerrar agora" já derivam o clube do leilão (migration 15): cobram igual.
--  * "Leilão aberto" (push/sino) vai só para o clube do leilão; nova temporada só espera o leilão do PRÓPRIO clube.
-- =====================================================================

-- ==================== A) colunas e dados ====================
alter table public.leiloes
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.leiloes
   set club_id = coalesce(public.clube_vinculo_do_usuario(criado_por), public.clube_legado_id())
 where club_id is null;
alter table public.leiloes alter column club_id set not null;
alter table public.leiloes alter column club_id set default public.clube_atual_id();
create index if not exists idx_leiloes_club on public.leiloes(club_id, status);

alter table public.leilao_itens
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.leilao_itens i set club_id = l.club_id from public.leiloes l where l.id = i.leilao_id and i.club_id is null;
alter table public.leilao_itens alter column club_id set not null;
create index if not exists idx_leilao_itens_club on public.leilao_itens(club_id);

alter table public.leilao_lances
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.leilao_lances la set club_id = i.club_id from public.leilao_itens i where i.id = la.item_id and la.club_id is null;
alter table public.leilao_lances alter column club_id set not null;
create index if not exists idx_leilao_lances_club on public.leilao_lances(club_id);

alter table public.leilao_lance_unidades
  add column if not exists club_id uuid references public.organizational_units(id) on delete cascade;
update public.leilao_lance_unidades lu set club_id = la.club_id from public.leilao_lances la where la.id = lu.lance_id and lu.club_id is null;
alter table public.leilao_lance_unidades alter column club_id set not null;
create index if not exists idx_leilao_lance_unidades_club on public.leilao_lance_unidades(club_id);

-- um leilão aberto POR CLUBE (antes: um só no banco inteiro)
drop index if exists public.um_leilao_aberto;
create unique index if not exists um_leilao_aberto_por_clube on public.leiloes (club_id) where status = 'aberto';

-- ==================== B) recurso ligado por clube ====================
create or replace function public.leilao_habilitado(p_club_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.membro_ativo_no_clube(p_club_id) and public.recurso_habilitado_no_clube(p_club_id, 'leilao');
end;
$$;
-- o "leilão disponível" de quem chama (o clube dele)
create or replace function public.leilao_disponivel() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.leilao_habilitado(public.clube_atual_id());
end;
$$;
-- flag interna: quem chama não consulta o recurso de clube alheio (as policies usam leilao_habilitado)
revoke all on function public.recurso_habilitado_no_clube(uuid, text) from public, anon, authenticated;

-- ==================== C) gatilhos: o clube nasce do pai; recurso ligado; unidade do mesmo clube ====================
create or replace function public.definir_club_leilao() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_club uuid;
begin
  if tg_table_name = 'leiloes' then
    new.club_id := coalesce(new.club_id, public.clube_vinculo_do_usuario(new.criado_por));
    v_club := new.club_id;
  elsif tg_table_name = 'leilao_itens' then
    select club_id into v_club from public.leiloes where id = new.leilao_id;
    new.club_id := v_club;
  elsif tg_table_name = 'leilao_lances' then
    select club_id into v_club from public.leilao_itens where id = new.item_id;
    new.club_id := v_club;
  elsif tg_table_name = 'leilao_lance_unidades' then
    select club_id into v_club from public.leilao_lances where id = new.lance_id;
    new.club_id := v_club;
    if (select club_id from public.unidades where id = new.unidade_id) is distinct from v_club then
      raise exception 'Só unidades do clube do leilão podem participar.';
    end if;
  end if;
  if v_club is null then
    raise exception 'Leilão sem clube.';
  end if;
  if not public.recurso_habilitado_no_clube(v_club, 'leilao') then
    raise exception 'O leilão não está habilitado neste clube.';
  end if;
  return new;
end;
$$;
revoke all on function public.definir_club_leilao() from public, anon, authenticated;

drop trigger if exists trg_exigir_leilao_leiloes on public.leiloes;
drop trigger if exists trg_exigir_leilao_itens on public.leilao_itens;
drop trigger if exists trg_exigir_leilao_lances on public.leilao_lances;
drop trigger if exists trg_exigir_leilao_lance_unidades on public.leilao_lance_unidades;
drop function if exists public.exigir_leilao_habilitado();
drop trigger if exists trg_definir_club_leilao on public.leiloes;
drop trigger if exists trg_definir_club_leilao on public.leilao_itens;
drop trigger if exists trg_definir_club_leilao on public.leilao_lances;
drop trigger if exists trg_definir_club_leilao on public.leilao_lance_unidades;
create trigger trg_definir_club_leilao before insert on public.leiloes for each row execute function public.definir_club_leilao();
create trigger trg_definir_club_leilao before insert on public.leilao_itens for each row execute function public.definir_club_leilao();
create trigger trg_definir_club_leilao before insert on public.leilao_lances for each row execute function public.definir_club_leilao();
create trigger trg_definir_club_leilao before insert on public.leilao_lance_unidades for each row execute function public.definir_club_leilao();

-- ==================== D) policies: só o membro do clube com o recurso ligado lê; ninguém grava direto ====================
drop policy if exists "ler leiloes" on public.leiloes;
drop policy if exists "ler leilao_itens" on public.leilao_itens;
drop policy if exists "ler leilao_lances" on public.leilao_lances;
drop policy if exists "ler leilao_lance_unidades" on public.leilao_lance_unidades;
drop policy if exists "membro le leiloes do proprio clube" on public.leiloes;
drop policy if exists "membro le itens do leilao do proprio clube" on public.leilao_itens;
drop policy if exists "membro le lances do leilao do proprio clube" on public.leilao_lances;
drop policy if exists "membro le lance_unidades do proprio clube" on public.leilao_lance_unidades;
create policy "membro le leiloes do proprio clube" on public.leiloes for select to authenticated using (public.leilao_habilitado(club_id));
create policy "membro le itens do leilao do proprio clube" on public.leilao_itens for select to authenticated using (public.leilao_habilitado(club_id));
create policy "membro le lances do leilao do proprio clube" on public.leilao_lances for select to authenticated using (public.leilao_habilitado(club_id));
create policy "membro le lance_unidades do proprio clube" on public.leilao_lance_unidades for select to authenticated using (public.leilao_habilitado(club_id));

-- ==================== E) RPCs: o clube é o de quem chama; UUID de outro clube = "não encontrado" ====================
create or replace function public.criar_leilao(p_titulo text, p_fecha_em timestamp with time zone, p_itens jsonb)
returns json language plpgsql security definer set search_path = '' as $$
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

create or replace function public.cancelar_leilao(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_status text; v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode cancelar o leilão.'; end if;
  select status into v_status from public.leiloes where id = p_id and club_id = v_club for update;
  if not found then raise exception 'Leilão não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse leilão já foi encerrado ou cancelado.'; end if;
  update public.leiloes set status = 'cancelado', encerrado_em = now() where id = p_id;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.encerrar_leilao(p_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_status text; v_club uuid := public.clube_atual_id();
begin
  if v_club is null or not public.pode_gerir_no_clube(v_club) then raise exception 'Só a liderança pode encerrar o leilão.'; end if;
  select status into v_status from public.leiloes where id = p_id and club_id = v_club for update;
  if not found then raise exception 'Leilão não encontrado.'; end if;
  if v_status <> 'aberto' then raise exception 'Esse leilão já foi encerrado.'; end if;
  return public._leilao_fechar_core(p_id);
end;
$$;

-- ==================== F) funções longas (definição real do banco + conferência do clube) ====================
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
  if p_valor is null or p_valor <= 0 then raise exception 'Lance inválido.'; end if;

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

CREATE OR REPLACE FUNCTION public.confirmar_lance_conjunto(p_lance_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_item_id uuid; v_valor int; v_leilao_id uuid;
  v_leilao_status text; v_fecha_em timestamptz;
  v_preco_base int; v_incremento int;
  v_status_atual text;
  v_maior_valor int;
  v_faltam int;
  v_saldo int;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  select unidade_id, papel into v_minha_unidade, v_meu_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem confirmar lance no leilão.';
  end if;

  select l.item_id, l.valor, it.leilao_id, it.preco_base, it.incremento_minimo
    into v_item_id, v_valor, v_leilao_id, v_preco_base, v_incremento
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id and l.club_id = v_club;
  if v_item_id is null then raise exception 'Lance não encontrado.'; end if;

  if not exists (
    select 1 from public.leilao_lance_unidades
    where lance_id = p_lance_id and unidade_id = v_minha_unidade and confirmado = false
  ) then
    raise exception 'Sua unidade não precisa confirmar esse lance.';
  end if;

  -- Trava a linha do leilão (mesma trava de dar_lance/recusar/encerrar/cron).
  select status, fecha_em into v_leilao_status, v_fecha_em from public.leiloes where id = v_leilao_id for update;
  if v_leilao_status <> 'aberto' then raise exception 'Esse leilão já encerrou.'; end if;
  if now() >= v_fecha_em then raise exception 'O tempo desse leilão acabou.'; end if;

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
  -- Sem "raise exception" ao invalidar: devolve o motivo no JSON e commita o
  -- 'superado' (uma exceção desfaria a transação e o lance ficaria pendente).
  select coalesce(max(valor), 0) into v_maior_valor
  from public.leilao_lances where item_id = v_item_id and status = 'ativo';
  if v_valor < v_preco_base or (v_maior_valor > 0 and v_valor < v_maior_valor + v_incremento) then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false,
      'motivo', 'Enquanto vocês combinavam, outra unidade deu um lance maior. Esse lance não vale mais.');
  end if;

  -- NOVO — SALDO COLETIVO: as unidades podem SOMAR forças. Basta a soma do que
  -- cada uma tem disponível cobrir o valor. Soma de volta o que as próprias
  -- unidades do lance já têm reservado NESTE item (o lance ativo que será
  -- superado abaixo), senão a conta ficaria estrita demais.
  select coalesce(sum(public.leilao_saldo_unidade(lu.unidade_id)), 0) into v_saldo
  from public.leilao_lance_unidades lu
  where lu.lance_id = p_lance_id;

  select v_saldo + coalesce(sum(l.valor), 0) into v_saldo
  from public.leilao_lances l
  join public.leilao_lance_unidades lua on lua.lance_id = l.id
  where l.item_id = v_item_id and l.status = 'ativo'
    and lua.unidade_id in (select unidade_id from public.leilao_lance_unidades where lance_id = p_lance_id);

  if v_saldo < v_valor then
    update public.leilao_lances set status = 'superado' where id = p_lance_id;
    return json_build_object('ativado', false, 'motivo',
      'Juntas, as unidades não têm ' || v_valor || ' pontos disponíveis agora. Esse lance não vale mais.');
  end if;

  update public.leilao_lances set status = 'superado' where item_id = v_item_id and status = 'ativo';
  update public.leilao_lances set status = 'ativo' where id = p_lance_id and status = 'pendente';

  return json_build_object('ativado', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.recusar_lance_conjunto(p_lance_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_minha_unidade uuid;
  v_leilao_id uuid;
  v_leilao_status text;
  v_status_atual text;
  v_meu_papel text;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not public.leilao_habilitado(v_club) then raise exception 'O leilão não está habilitado para o seu clube.'; end if;
  select unidade_id, papel into v_minha_unidade, v_meu_papel from public.profiles where id = v_uid and status = 'ativo';
  if v_minha_unidade is null then raise exception 'Você precisa estar numa unidade ativa.'; end if;
  if v_meu_papel not in ('desbravador', 'conselheiro') then
    raise exception 'Só desbravadores e conselheiros podem recusar lance no leilão.';
  end if;

  select it.leilao_id into v_leilao_id
  from public.leilao_lances l join public.leilao_itens it on it.id = l.item_id
  where l.id = p_lance_id and l.club_id = v_club;
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
$function$;

CREATE OR REPLACE FUNCTION public.notif_leilao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.notificacoes (titulo, corpo, tipo, link, para, club_id)
  values ('🏛️ Leilão aberto!', 'Junte pontos com sua unidade e dê um lance: ' || coalesce(new.titulo, ''),
          'geral', '/leilao', 'todos', new.club_id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.nova_temporada(p_campeao_individual text, p_campeao_unidade text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club_id uuid := public.clube_atual_id();
  v_num int;
begin
  if v_club_id is null or not exists (
       select 1 from public.organization_memberships m
       where m.user_id = v_uid and m.organizational_unit_id = v_club_id
         and m.role = 'diretoria' and m.status = 'ativo'
         and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'Só a diretoria pode iniciar uma nova temporada neste clube.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nova_temporada:' || v_club_id::text));

  -- só o leilão aberto do PRÓPRIO clube segura a virada de temporada
  if exists (select 1 from public.leiloes where club_id = v_club_id and status = 'aberto') then
    raise exception 'Encerre ou cancele o leilão aberto antes de iniciar uma nova temporada.';
  end if;

  update public.temporadas
     set fim = now(), campeao_individual = p_campeao_individual, campeao_unidade = p_campeao_unidade
   where club_id = v_club_id and fim is null;

  select coalesce(max(numero), 0) + 1 into v_num
  from public.temporadas where club_id = v_club_id;
  insert into public.temporadas (club_id, numero, inicio, criado_por)
  values (v_club_id, v_num, now(), v_uid);

  return json_build_object('numero', v_num);
end;
$function$;



-- ACL: nada novo ficou executável por PUBLIC/anon (só a do cadastro público)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.clube_legado_id() to anon;

notify pgrst, 'reload schema';

insert into public.migracoes_aplicadas (arquivo)
values ('2026-09-21-leilao-por-clube.sql')
on conflict (arquivo) do update set aplicada_em = now();
