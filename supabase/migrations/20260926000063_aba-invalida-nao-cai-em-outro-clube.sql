-- =============================================================================
--  Fase 8.4 — pedir um clube que não é seu deixa de virar "então fica nesse outro aqui".
--
--  `clube_atual_id()` tinha, desde a migration 34, um comportamento deliberado e comentado: se o
--  header `x-clube-atual` pedisse um clube sem vínculo ativo — suspenso, encerrado, alheio ou
--  inexistente — a função NÃO reclamava; caía no clube padrão da pessoa. A justificativa escrita
--  era boa: "nunca cai em erro (não revela nada)".
--
--  Isso era inofensivo enquanto nada dependia do retorno para decidir o que mostrar. As policies
--  perguntavam "você é membro deste clube?", não "este é o clube da aba", então o valor devolvido
--  aqui quase não mudava o resultado de uma leitura.
--
--  Depois da migration 62 ele decide TUDO o que a pessoa lê. E aí o fallback muda de natureza:
--
--    a diretoria de B encerra meu vínculo. Minha aba de B continua aberta, com a marca de B na
--    tela, e segue mandando `x-clube-atual: B` a cada clique. O servidor deixa de honrar B —
--    e me devolve os dados do clube A. Eu leio A achando que leio B. Se eu clicar em algo que
--    grava, a gravação acontece em A.
--
--  É exatamente o caso que a Fase 8.4 chama de BLOCKER: "qualquer operação executada no clube
--  errado é BLOCKER, mesmo que ninguém consiga ler o resultado". O fallback não era um vazamento —
--  era pior, porque agia, e agia calado.
--
--  A CORREÇÃO separa dois casos que estavam juntos:
--
--    · header AUSENTE → clube padrão. Continua igual. É a primeira carga da sessão, é o cliente
--      que ainda não escolheu, é o chamador que não é um navegador. Ninguém foi contrariado.
--    · header PRESENTE e não honrável → NULO. A requisição não tem clube. As leituras escopadas
--      devolvem vazio, os RPCs que exigem clube recusam, e nada acontece no clube errado.
--
--  E continua sem revelar nada: clube inexistente, clube de outra pessoa e clube de onde eu saí
--  devolvem os três a MESMA resposta — nulo. A regra de oráculo do projeto segue valendo, e quem
--  pergunta já sabia de antemão em quais clubes está.
--
--  A tela não fica presa: `meu_contexto()` lista os vínculos INDEPENDENTEMENTE do clube em uso
--  (ela não filtra por `clube_atual_id()`), e o `ClubeProvider` reescolhe o clube a partir dessa
--  lista e reescreve o header. Um round-trip e a aba se conserta sozinha — agora mostrando o clube
--  certo, em vez de seguir rotulada com um clube que não é mais o dela.
-- =============================================================================

create or replace function public.clube_atual_id()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
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

  if v_pedido is not null and exists (
    select 1 from public.organization_memberships m
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
