-- =====================================================================
--  Filhos da Conquista — Lance conjunto: SALDO COLETIVO (2026-09-02)
--
--  Pedido do dono: duas (ou mais) unidades juntas devem poder alcançar um
--  lance que nenhuma banca sozinha — "somar forças".
--
--  ANTES: confirmar_lance_conjunto exigia que CADA unidade tivesse o VALOR
--  CHEIO do lance sozinha pra ativar. Isso barrava o caso mais comum de lance
--  conjunto (unidades pequenas dividindo) e contradizia a tela, que promete
--  "os pontos são rateados proporcional ao total de cada unidade".
--
--  AGORA: exige que a SOMA do saldo disponível das unidades do lance cubra o
--  valor. Soma de volta o que as próprias unidades já têm reservado NESTE item
--  (o lance ativo que será superado logo abaixo), pra conta não ficar estrita
--  demais. O rateio do fechamento (_leilao_fechar_core) NÃO muda: continua
--  dividindo proporcional ao total de cada unidade e limitando cada parcela à
--  carteira — ninguém é cobrado além do que tem, nem fica negativo.
--
--  Redefine só confirmar_lance_conjunto — MESMA lógica, troca só a checagem de
--  saldo (era um laço por-unidade, vira uma soma coletiva).
--  ⚠️ NÃO re-rode o 2026-08-18-leilao.sql depois deste (voltaria ao antigo).
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
-- =====================================================================

set lock_timeout = '10s';

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
  v_saldo int;
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
$$;
grant execute on function public.confirmar_lance_conjunto(uuid) to authenticated;

notify pgrst, 'reload schema';
