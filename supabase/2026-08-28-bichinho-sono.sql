-- =====================================================================
--  Filhos da Conquista — Bichinho: 💤 Dormir / modo acampamento (2026-08-28)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--  Depende de 2026-08-26-bichinho.sql + 2026-08-27-bichinho-visual.sql rodados.
--
--  Pedido do dono: dar um jeito do bichinho NÃO morrer quando a criança vai
--  acampar/fica sem celular. Solução: colocar pra DORMIR = congela TUDO:
--   * as barrinhas param de cair (ficam como estavam na hora de dormir);
--   * o relógio da morte (72h) e da ofensiva (48h) PAUSAM;
--   * dormindo não dá pra cuidar nem pontuar (nada de farm — é pausa neutra:
--     nem perde, nem ganha).
--  Ao ACORDAR, os relógios são deslocados pelo tempo dormido — como se o
--  sono não tivesse existido. Deslocar pra FRENTE só ADIA o próximo ponto
--  (gate de 20h), nunca antecipa — sem brecha de farm. Cuidar com ele
--  dormindo acorda primeiro, automaticamente.
--
--  As funções abaixo são REBASEADAS nas versões EM VIGOR (26/08 + 27/08) —
--  só entra a lógica do sono; nada mais muda.
-- =====================================================================

-- 0) Quando começou o sono (null = acordado)
alter table public.bichinhos add column if not exists dormindo_desde timestamptz;

-- 1) 💤 Dormir: congela as barras no valor atual e marca o início do sono
create or replace function public.bichinho_dormir()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_h numeric;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into b from public.bichinhos where usuario_id = v_uid for update;
  if not found then raise exception 'Você ainda não tem um bichinho. Adote um! 🐾'; end if;

  -- morte pendente aplica antes (mesma regra do cuidar)
  if b.vivo and b.dormindo_desde is null and b.pontuado_em is not null
     and now() - b.ultimo_cuidado_em > interval '72 hours' then
    update public.bichinhos set vivo = false, morto_em = b.ultimo_cuidado_em + interval '72 hours'
      where usuario_id = v_uid;
    return json_build_object('morreu', true);
  end if;
  if not b.vivo then return json_build_object('morreu', true); end if;
  if b.dormindo_desde is not null then return json_build_object('ok', true, 'ja_dormia', true); end if;

  -- congela: aplica o decaimento até AGORA. A base guarda a FRAÇÃO que o
  -- floor descartou (senão dormir/acordar de 20 em 20min zeraria o resto e
  -- as barras nunca cairiam — apontado na revisão).
  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;
  update public.bichinhos set
    fome       = greatest(0, b.fome       - floor(3 * v_h))::int,
    higiene    = greatest(0, b.higiene    - floor(3 * v_h))::int,
    felicidade = greatest(0, b.felicidade - floor(3 * v_h))::int,
    atualizado_em = now() - (((3 * v_h) - floor(3 * v_h)) / 3.0) * interval '1 hour',
    dormindo_desde = now()
  where usuario_id = v_uid;

  return json_build_object('ok', true);
end;
$$;
grant execute on function public.bichinho_dormir() to authenticated;
revoke execute on function public.bichinho_dormir() from public, anon;

-- 2) ☀️ Acordar: desloca os relógios pelo tempo dormido (sono "não existiu")
create or replace function public.bichinho_acordar()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_sono interval;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into b from public.bichinhos where usuario_id = v_uid for update;
  if not found then raise exception 'Você ainda não tem um bichinho. Adote um! 🐾'; end if;
  if b.dormindo_desde is null then return json_build_object('ok', true, 'ja_acordado', true); end if;

  v_sono := greatest(interval '0', now() - b.dormindo_desde);
  -- todos os carimbos são <= dormindo_desde (dormindo não dá pra cuidar),
  -- então carimbo + sono <= now() — nunca vai pro futuro.
  update public.bichinhos set
    dormindo_desde = null,
    atualizado_em = b.atualizado_em + v_sono,
    ultimo_cuidado_em = b.ultimo_cuidado_em + v_sono,
    pontuado_em = case when b.pontuado_em is null then null else b.pontuado_em + v_sono end
  where usuario_id = v_uid;

  return json_build_object('ok', true);
end;
$$;
grant execute on function public.bichinho_acordar() to authenticated;
revoke execute on function public.bichinho_acordar() from public, anon;

-- 3) meu_bichinho: dormindo = tudo congelado (base 27/08 + sono)
create or replace function public.meu_bichinho()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_vivo boolean;
  v_morto_em timestamptz;
  v_h numeric;
  v_sem numeric;
  v_ref timestamptz;   -- "agora" do bichinho: se dorme, o tempo parou ali
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  select * into b from public.bichinhos where usuario_id = v_uid;
  if not found then return json_build_object('tem', false,
    'nivel', public.nivel_por_pontos(public.meu_total_pontos())); end if;

  v_vivo := b.vivo;
  v_morto_em := b.morto_em;
  v_ref := coalesce(b.dormindo_desde, now());
  v_sem := extract(epoch from (v_ref - b.ultimo_cuidado_em)) / 3600.0;
  -- morte por abandono só conta ACORDADO (dormindo congela o relógio)
  if v_vivo and b.dormindo_desde is null and b.pontuado_em is not null and v_sem > 72 then
    v_vivo := false;
    v_morto_em := b.ultimo_cuidado_em + interval '72 hours';
    update public.bichinhos set vivo = false, morto_em = v_morto_em where usuario_id = v_uid;
  end if;

  v_h := extract(epoch from (v_ref - b.atualizado_em)) / 3600.0;

  return json_build_object(
    'tem', true, 'especie', b.especie, 'nome', b.nome, 'vivo', v_vivo, 'item', b.item,
    'cenario', b.cenario, 'cor', b.cor, 'olhos', b.olhos,
    'dormindo', b.dormindo_desde is not null,
    'nivel', public.nivel_por_pontos(public.meu_total_pontos()),
    'fome',       case when v_vivo then greatest(0, b.fome       - floor(3 * v_h))::int else 0 end,
    'higiene',    case when v_vivo then greatest(0, b.higiene    - floor(3 * v_h))::int else 0 end,
    'felicidade', case when v_vivo then greatest(0, b.felicidade - floor(3 * v_h))::int else 0 end,
    'estagio', public._bichinho_estagio(b.dias_cuidados),
    'ofensiva', b.ofensiva, 'cuidados_total', b.cuidados_total, 'dias_cuidados', b.dias_cuidados,
    'pode_pontuar', v_vivo and b.dormindo_desde is null
      and (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours'),
    'horas_sem_cuidado', round(v_sem)::int,
    'em_perigo', v_vivo and b.dormindo_desde is null and b.pontuado_em is not null and v_sem >= 36,
    'nascido_em', b.nascido_em, 'morto_em', v_morto_em
  );
end;
$$;
grant execute on function public.meu_bichinho() to authenticated;

-- 4) bichinho_cuidar: cuidar dormindo ACORDA primeiro (base 26/08 + sono)
create or replace function public.bichinho_cuidar(p_acao text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  b record;
  v_h numeric;
  v_fome int; v_hig int; v_fel int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_conta boolean := false;
  v_ativo boolean;
  v_pontos int := 0;
  v_sono interval;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if p_acao not in ('alimentar', 'banho', 'brincar') then raise exception 'Ação inválida.'; end if;

  select * into b from public.bichinhos where usuario_id = v_uid for update;
  if not found then raise exception 'Você ainda não tem um bichinho. Adote um! 🐾'; end if;

  -- dormindo? acorda primeiro (desloca os relógios pelo tempo dormido)
  if b.dormindo_desde is not null then
    v_sono := greatest(interval '0', now() - b.dormindo_desde);
    update public.bichinhos set
      dormindo_desde = null,
      atualizado_em = b.atualizado_em + v_sono,
      ultimo_cuidado_em = b.ultimo_cuidado_em + v_sono,
      pontuado_em = case when b.pontuado_em is null then null else b.pontuado_em + v_sono end
    where usuario_id = v_uid
    returning * into b;
  end if;

  -- morte por abandono (72h) — só conta depois do 1º cuidado (pontuado_em)
  if b.vivo and b.pontuado_em is not null and now() - b.ultimo_cuidado_em > interval '72 hours' then
    update public.bichinhos set vivo = false, morto_em = b.ultimo_cuidado_em + interval '72 hours'
      where usuario_id = v_uid;
    return json_build_object('morreu', true);
  end if;
  if not b.vivo then return json_build_object('morreu', true); end if;

  v_h := extract(epoch from (now() - b.atualizado_em)) / 3600.0;
  v_fome := greatest(0, b.fome       - floor(3 * v_h))::int;
  v_hig  := greatest(0, b.higiene    - floor(3 * v_h))::int;
  v_fel  := greatest(0, b.felicidade - floor(3 * v_h))::int;
  if p_acao = 'alimentar' then v_fome := 100;
  elsif p_acao = 'banho' then v_hig := 100;
  else v_fel := 100; end if;

  v_conta := (b.pontuado_em is null or now() - b.pontuado_em >= interval '20 hours');
  v_ativo := exists (select 1 from public.profiles where id = v_uid and status = 'ativo');

  update public.bichinhos set
    fome = v_fome, higiene = v_hig, felicidade = v_fel,
    atualizado_em = now(), ultimo_cuidado_em = now(),
    cuidados_total = b.cuidados_total + 1,
    dias_cuidados = b.dias_cuidados + (case when v_conta then 1 else 0 end),
    ofensiva = case
      when not v_conta then b.ofensiva
      when b.pontuado_em is not null and now() - b.pontuado_em < interval '48 hours' then b.ofensiva + 1
      else 1 end,
    pontuado_em = case when v_conta then now() else b.pontuado_em end
  where usuario_id = v_uid;

  if v_conta and v_ativo and not public.eh_teste() then
    v_pontos := 2;
    insert into public.pontos (usuario_id, origem, pontos, motivo)
    values (v_uid, 'bichinho', 2, 'Cuidou do bichinho ' || to_char(v_hoje, 'DD/MM'));
  end if;

  return json_build_object('ok', true, 'pontos_ganhos', v_pontos, 'contou', v_conta,
    'fome', v_fome, 'higiene', v_hig, 'felicidade', v_fel);
end;
$$;
grant execute on function public.bichinho_cuidar(text) to authenticated;

-- 4b) bichinho_adotar (base 26/08 + sono, apontado na revisão): pet DORMINDO
--     conta como vivo e protegido (não dá pra "trocar" um pet que passou 72h
--     de relógio de parede dormindo), e a re-adoção zera dormindo_desde
--     (senão o pet novo nascia "dormindo" com carimbo velho e o acordar
--     jogaria os relógios pro futuro, inflando as barras).
create or replace function public.bichinho_adotar(p_nome text, p_especie text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_nome text := trim(coalesce(p_nome, ''));
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'ativo') then
    raise exception 'Seu cadastro precisa estar ativo pra adotar um bichinho.';
  end if;
  if p_especie not in ('cachorro', 'gato', 'coelho', 'passaro') then raise exception 'Espécie inválida.'; end if;
  if length(v_nome) < 1 then raise exception 'Dê um nome pro bichinho.'; end if;
  if length(v_nome) > 20 then raise exception 'Nome muito longo (máx. 20 letras).'; end if;

  perform pg_advisory_xact_lock(hashtext('bichinho:' || v_uid::text));

  if exists (select 1 from public.bichinhos b where b.usuario_id = v_uid and b.vivo
             and (b.dormindo_desde is not null or now() - b.ultimo_cuidado_em <= interval '72 hours')) then
    raise exception 'Você já tem um bichinho vivo! Cuide bem dele. 🐾';
  end if;

  insert into public.bichinhos
    (usuario_id, especie, nome, fome, higiene, felicidade, atualizado_em, ultimo_cuidado_em,
     pontuado_em, dias_cuidados, cuidados_total, ofensiva, vivo, morto_em, nascido_em, dormindo_desde)
  values (v_uid, p_especie, v_nome, 100, 100, 100, now(), now(), null, 0, 0, 0, true, null, now(), null)
  on conflict (usuario_id) do update set
    especie = excluded.especie, nome = excluded.nome, fome = 100, higiene = 100, felicidade = 100,
    atualizado_em = now(), ultimo_cuidado_em = now(), pontuado_em = null,
    dias_cuidados = 0, cuidados_total = 0, ofensiva = 0, vivo = true, morto_em = null, nascido_em = now(),
    dormindo_desde = null;

  return json_build_object('ok', true);
end;
$$;
grant execute on function public.bichinho_adotar(text, text) to authenticated;

-- 5) pets_do_clube: mostra quem está dormindo (ganha 1 coluna → precisa DROP,
--    create or replace não muda o tipo de retorno; o grant abaixo restaura)
drop function if exists public.pets_do_clube();
create or replace function public.pets_do_clube()
returns table (
  dono_id uuid, dono_nome text, dono_avatar jsonb, dono_avatar_tipo text, dono_foto text,
  especie text, pet_nome text, estagio int, item text, cenario text, cor text, olhos text,
  vivo boolean, ofensiva int, dormindo boolean
) language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.avatar, p.avatar_tipo, p.foto,
    b.especie, b.nome, public._bichinho_estagio(b.dias_cuidados), b.item, b.cenario, b.cor, b.olhos,
    -- dormindo não morre de abandono (relógio pausado)
    (b.vivo and (b.pontuado_em is null or b.dormindo_desde is not null
                 or now() - b.ultimo_cuidado_em <= interval '72 hours')),
    b.ofensiva,
    (b.dormindo_desde is not null)
  from public.bichinhos b
  join public.profiles p on p.id = b.usuario_id
  where p.status = 'ativo' and p.papel <> 'pais'
    and exists (select 1 from public.profiles me
                where me.id = auth.uid() and me.status = 'ativo' and me.papel <> 'pais')
  order by b.ofensiva desc, public._bichinho_estagio(b.dias_cuidados) desc, p.nome;
$$;
grant execute on function public.pets_do_clube() to authenticated;

notify pgrst, 'reload schema';
