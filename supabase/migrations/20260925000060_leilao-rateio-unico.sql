-- =============================================================================
--  Fase 8.3 — o rateio do lance conjunto passa a ser UMA conta só.
--
--  O QUE ESTAVA ERRADO, e o que não estava:
--
--    · a COBRANÇA no fechamento sempre esteve certa — método dos maiores restos, ponderado pelos
--      pontos de cada unidade, somando exatamente o valor do lance, com teto por unidade;
--    · a RESERVA não. `leilao_saldo_unidade` descontava `sum(l.valor)` — o valor INTEIRO do lance
--      — de CADA unidade participante. Num lance conjunto de N unidades, o mesmo valor era
--      reservado N vezes.
--
--  O red-team da fase 8.2 chegou a 1.800.000 reservados de uma unidade com 27 pontos próprios,
--  usando só chamadas legítimas da API. E o dano não é cosmético: a confirmação decide por
--  `soma dos saldos >= valor`, e os saldos vêm dessa mesma conta inflada — então uma unidade que
--  entra em dois lances conjuntos fica com saldo zero e passa a BLOQUEAR lances legítimos.
--
--  A CORREÇÃO não é "dividir também na reserva". É tirar a conta de dentro do fechamento e
--  passar a ter UMA função que os dois lados chamam. Duas contas equivalentes hoje divergem no
--  primeiro ajuste que alguém fizer numa delas — e foi exatamente assim que este bug nasceu.
--
--  O QUE NÃO MUDA (regra econômica legítima, preservada e testada no arquivo 53):
--    · o peso continua sendo os pontos da unidade — quem tem mais, paga mais;
--    · o resto de 1 ponto continua indo para a MAIOR fração, com desempate pelo MENOR uuid;
--    · o teto por unidade no fechamento continua valendo (ninguém é cobrado além do que tem);
--    · lance solo continua reservando e cobrando o valor cheio — com uma unidade só, o rateio
--      devolve o valor inteiro, então não há caso especial.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A CONTA, num lugar só.
--
-- Método dos maiores restos: cada unidade fica com `floor(valor * peso / soma_dos_pesos)`, e as
-- sobras de 1 ponto vão para quem tem a maior fração descartada. A soma das parcelas é SEMPRE
-- exatamente o valor do lance — é a propriedade que distingue este método de um `round()` por
-- unidade, que pode somar a mais ou a menos.
--
-- O desempate é `(fração desc, unidade_id)`: determinístico e estável. Sem o `unidade_id`, duas
-- unidades de peso idêntico num valor ímpar teriam a sobra decidida pela ordem física das linhas
-- — que muda com um VACUUM. A reserva mudaria sozinha entre duas leituras.
--
-- `_pontos_temporada_unidade_interno` (e não a variante com gate) porque esta função roda também
-- no cron, sem sessão. É a mesma cicatriz que o fechamento já carregava.
-- ---------------------------------------------------------------------------
-- `p_pesos` e um retrato opcional {unidade_id: peso}. Sem ele, o peso e lido AO VIVO — que e o
-- que a RESERVA quer, porque o leilao esta aberto e ninguem foi cobrado ainda.
--
-- O FECHAMENTO passa o retrato, e precisa passar: ele cobra item a item, entao a partir do
-- segundo item os pontos ao vivo ja estao descontados e o rateio sairia diferente do que a
-- reserva calculou. Foi exatamente esse o defeito que o teste 53 pegou (A1 reservado 185,
-- cobrado 176) — e ele tambem significava que QUEM PAGA O QUE dependia da ordem dos itens.
create or replace function public._leilao_rateio(p_lance_id uuid, p_pesos jsonb default null)
returns table (unidade_id uuid, parcela int)
language sql
stable
security definer
set search_path = ''
as $$
  with lance as (
    select l.valor from public.leilao_lances l where l.id = p_lance_id
  ),
  pesos as (
    select lu.unidade_id,
           coalesce(
             (p_pesos ->> lu.unidade_id::text)::numeric,
             greatest(public._pontos_temporada_unidade_interno(lu.unidade_id), 0)
           ) as peso
      from public.leilao_lance_unidades lu
     where lu.lance_id = p_lance_id
  ),
  total as (select coalesce(sum(peso), 0) as soma, count(*) as n from pesos),
  bruto as (
    select p.unidade_id, p.peso,
           case
             -- todo mundo zerado: divide igual, senão a conta seria 0/0 e ninguém pagaria nada
             when t.soma = 0 and t.n > 0 then (select valor from lance)::numeric / t.n
             when t.soma > 0 then (select valor from lance)::numeric * p.peso / t.soma
             else 0
           end as fatia
      from pesos p cross join total t
  ),
  repartido as (
    select unidade_id, peso, floor(fatia)::int as base, fatia - floor(fatia) as frac from bruto
  ),
  sobra as (
    select greatest((select valor from lance) - coalesce((select sum(base) from repartido), 0), 0) as extra
  )
  select r.unidade_id,
         r.base + case when row_number() over (order by r.frac desc, r.unidade_id)
                            <= (select extra from sobra) then 1 else 0 end
    from repartido r;
$$;
revoke all on function public._leilao_rateio(uuid, jsonb) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- A RESERVA passa a usar a mesma conta.
--
-- Antes: `sum(l.valor)` — o valor inteiro, por unidade.
-- Agora: a PARCELA daquela unidade naquele lance.
--
-- Os gates da fase 8.2 (clube da requisição + membro ativo + entitlement) e o fim do oráculo por
-- erro (o `case when` que não avalia o ramo caro, e o `least` que satura em vez de estourar)
-- continuam exatamente como estavam. A única mudança é de onde sai o número reservado.
-- ---------------------------------------------------------------------------
create or replace function public.leilao_saldo_unidade(p_unidade_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when exists (
      select 1 from public.unidades u
       where u.id = p_unidade_id
         and u.club_id = public.clube_atual_id()
         and public.membro_ativo_no_clube(u.club_id)
         and public.recurso_habilitado_no_clube(u.club_id, 'leilao')
    )
    then least(greatest(0,
           public.pontos_temporada_unidade(p_unidade_id)::bigint
           - coalesce((
               select sum(r.parcela)::bigint
                 from public.leilao_lances l
                 join public.leilao_lance_unidades lu on lu.lance_id = l.id
                 join public.leilao_itens it on it.id = l.item_id
                 join public.leiloes le on le.id = it.leilao_id
                 cross join lateral public._leilao_rateio(l.id) r
                where lu.unidade_id = p_unidade_id
                  and r.unidade_id = p_unidade_id
                  and l.status = 'ativo' and le.status = 'aberto'
             ), 0)), 2147483647)::int
    else 0 end;
$$;
revoke all on function public.leilao_saldo_unidade(uuid) from public, anon;
grant execute on function public.leilao_saldo_unidade(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O FECHAMENTO passa a usar a mesma conta.
--
-- O corpo é o de antes, com uma diferença: o bloco que calculava o rateio inline saiu, e no lugar
-- entrou a chamada a `_leilao_rateio`. O TETO por unidade (`least(parcela, peso - já cobrado)`)
-- fica onde estava, porque ele é do fechamento e não da reserva: ele existe para o caso de uma
-- unidade vencer VÁRIOS itens do mesmo leilão e o total passar do que ela tem. O teto só REDUZ,
-- então a soma cobrada nunca passa do valor do lance.
--
-- Consequência que vale registrar: quando o teto morde, a cobrança fica ABAIXO da reserva. É a
-- direção segura — reservar a mais e cobrar a menos nunca deixa uma unidade no negativo.
-- ---------------------------------------------------------------------------
create or replace function public._leilao_fechar_core(p_id uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
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

  -- PASSADA 1 — decide TODAS as parcelas, antes de cobrar qualquer uma.
  --
  -- E o que faz a cobranca casar com a reserva: as duas passam a olhar o MESMO estado de pontos,
  -- o de antes do fechamento. E resolve, de quebra, algo que ja estava errado de um jeito mais
  -- sutil no codigo antigo: quem paga o que nao pode depender da ordem em que os itens sao
  -- processados.
  create temporary table if not exists tmp_leilao_parcelas (
    lance_id uuid not null, unidade_id uuid not null, parcela int not null,
    primary key (lance_id, unidade_id)
  ) on commit drop;
  delete from tmp_leilao_parcelas;

  insert into tmp_leilao_parcelas (lance_id, unidade_id, parcela)
  select l.id, r.unidade_id, r.parcela
    from public.leilao_lances l
    join public.leilao_itens it on it.id = l.item_id
    cross join lateral public._leilao_rateio(
      l.id,
      -- o retrato dos pesos, montado uma vez para o leilao inteiro
      (select jsonb_object_agg(tu.unidade_id::text, tu.peso) from tmp_leilao_unidades tu)
    ) r
   where it.leilao_id = p_id and l.status = 'ativo';

  -- PASSADA 2 — cobra, na ordem dos itens, aplicando o teto acumulado por unidade.
  for v_item in select * from public.leilao_itens where leilao_id = p_id order by ordem loop
    select l.* into v_lance from public.leilao_lances l
      where l.item_id = v_item.id and l.status = 'ativo' limit 1;

    if found then
      update public.leilao_lances set status = 'vencedor' where id = v_lance.id;
      update public.leilao_itens set vencedor_lance_id = v_lance.id where id = v_item.id;

      -- O TETO fica aqui, e e sequencial de proposito: ele existe para o caso de uma unidade
      -- vencer VARIOS itens do mesmo leilao e o total passar do que ela tem. So REDUZ.
      insert into public.pontos (unidade_id, origem, pontos, motivo, lancado_por)
      select p.unidade_id, 'leilao',
             -least(p.parcela, greatest(tu.peso::int - tu.cobrado, 0)),
             'Venceu "' || v_item.nome || '" no leilão', v_uid
        from tmp_leilao_parcelas p
        join tmp_leilao_unidades tu on tu.unidade_id = p.unidade_id
       where p.lance_id = v_lance.id
         and least(p.parcela, greatest(tu.peso::int - tu.cobrado, 0)) > 0;

      update tmp_leilao_unidades tu
         set cobrado = tu.cobrado + least(p.parcela, greatest(tu.peso::int - tu.cobrado, 0))
        from tmp_leilao_parcelas p
       where p.lance_id = v_lance.id and tu.unidade_id = p.unidade_id;

      v_itens_com_vencedor := v_itens_com_vencedor + 1;
    end if;
  end loop;

  -- Lances pendentes (convites de lance conjunto que ninguém confirmou a tempo) não valem mais
  -- depois do leilão encerrado.
  update public.leilao_lances set status = 'superado'
   where status = 'pendente' and item_id in (select id from public.leilao_itens where leilao_id = p_id);

  update public.leiloes set status = 'encerrado', encerrado_em = now() where id = p_id;

  return json_build_object('ok', true, 'itens_com_vencedor', v_itens_com_vencedor);
end;
$$;
