-- =============================================================================
--  Fase 9 (ISOLAMENTO / integridade de contexto) — o "clube em uso" só pode ser um CLUBE.
--
--  A invariante estava escrita na migration 47:
--
--      "Um coordenador SEM vínculo de clube continua sem clube_atual_id() — ou seja, continua sem
--       acesso a absolutamente nada do app operacional. O portal é a única porta dele."
--
--  e o escopo institucional (`escopo_atual_id`) "só aceita unidade NÃO-clube: não se misturam".
--
--  O caminho SEM header respeitava isso (o padrão só procura vínculo de tipo 'clube'). O caminho COM
--  header, não: `clube_atual_id()` aceitava QUALQUER unidade em que a pessoa tivesse vínculo ativo.
--  Medido pelo gate de API da fase 9 no staging: um coordenador distrital mandando
--  `x-clube-atual: <id do distrito>` passava a ter um "clube em uso" que é um distrito, e com ele
--  `membro_ativo_no_clube()` verdadeiro — publicou foto no mural e adotou bichinho, as duas linhas
--  gravadas com `club_id` = o distrito. Nada vazou para os clubes (nenhuma linha deles tem aquele
--  club_id), mas o app operacional passou a ter um "clube" que não é clube, e a porta que a 47
--  garantia fechada estava aberta para qualquer um com vínculo institucional e um header na mão.
--
--  O app nunca oferece o distrito como aba (`meu_contexto` só lista clubes). Só um header forjado
--  chegava lá. A correção é a mesma checagem que o padrão já fazia, agora também no pedido.
-- =============================================================================
create or replace function public.clube_atual_id()
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_pedido uuid;
  v_pediu boolean := false;
  v uuid;
begin
  if v_uid is null then return null; end if;

  begin
    v_pedido := nullif(current_setting('request.headers', true)::jsonb ->> 'x-clube-atual', '')::uuid;
    -- "pediu" é ter mandado o header com algo dentro. Um uuid mal formado cai no except abaixo e
    -- conta como pedido também: alguém mandou uma escolha, e ela não vale.
    v_pediu := (nullif(current_setting('request.headers', true)::jsonb ->> 'x-clube-atual', '') is not null);
  exception when others then
    v_pedido := null;
    v_pediu := true;
  end;

  -- O pedido só vale se for um CLUBE em que a pessoa está ativa. Um distrito, uma região, uma
  -- igreja — qualquer unidade institucional — não é "clube em uso", mesmo com vínculo ativo nela.
  if v_pedido is not null and exists (
    select 1 from public.organization_memberships m
    join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
    where m.user_id = v_uid and m.organizational_unit_id = v_pedido
      and m.status = 'ativo' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  ) then
    return v_pedido;
  end if;

  -- Pediu e o pedido não vale: a requisição fica SEM clube. Nunca em outro.
  if v_pediu then return null; end if;

  -- Não pediu nada: o padrão da pessoa. É a primeira carga, antes de a aba ter escolhido.
  select m.organizational_unit_id into v
  from public.organization_memberships m
  join public.organizational_units u on u.id = m.organizational_unit_id and u.type = 'clube'
  where m.user_id = v_uid and m.status = 'ativo'
    and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
  order by m.starts_at, m.created_at, m.id
  limit 1;
  return v;
end;
$$;
