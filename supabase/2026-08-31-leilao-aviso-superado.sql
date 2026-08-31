-- =====================================================================
--  Filhos da Conquista — Leilão: avisar a unidade quando é SUPERADA (2026-08-31)
--
--  Pedido do dono: quando OUTRA unidade dá um lance maior, os membros da
--  unidade que estava na frente recebem uma notificação (sino + push) pra
--  reagir — e continua assim a cada vez que forem ultrapassados.
--
--  Redefine dar_lance (base 2026-08-18-leilao.sql) — MESMA lógica, só adiciona:
--  antes de marcar o lance líder como 'superado', guarda de qual unidade ele
--  era; depois de ativar o novo lance, avisa os membros (desbravador/conselheiro)
--  dessa unidade. Notificação 'pessoal' por membro (padrão do app).
--
--  ⚠️ NÃO re-rode o 2026-08-18-leilao.sql depois deste (voltaria sem o aviso).
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
-- =====================================================================

set lock_timeout = '10s';

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
  v_superadas uuid[];   -- unidades que estavam na frente (serão avisadas)
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
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
  from public.leilao_itens it where it.id = p_item_id;
  if v_leilao_id is null then raise exception 'Item não encontrado.'; end if;

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
$$;
grant execute on function public.dar_lance(uuid, int, uuid[]) to authenticated;
revoke execute on function public.dar_lance(uuid, int, uuid[]) from public, anon;

notify pgrst, 'reload schema';
