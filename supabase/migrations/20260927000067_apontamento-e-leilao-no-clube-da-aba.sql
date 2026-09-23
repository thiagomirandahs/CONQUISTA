-- =============================================================================
--  Fase 8.5 — o apontamento parava de ser do clube de quem aponta, e o leilão vazava entre abas.
--
--  Três achados, encontrados por um red-team automático que atacou as superfícies que a fase 8.4
--  declarou fechadas. O primeiro é o mais grave do projeto até aqui, e não é vazamento de leitura:
--  é DESTRUIÇÃO DE DADO de outro clube.
--
-- -----------------------------------------------------------------------------
--  1. `salvar_reuniao` apagava os pontos da pessoa em TODOS os clubes dela.
-- -----------------------------------------------------------------------------
--
--  É a tela de Apontamentos, a rotina mais banal que existe: o conselheiro lança os pontos da
--  reunião da semana. Ela fazia, por pessoa:
--
--      delete from public.pontos
--       where usuario_id = v_alvo and origem = 'apontamento' and motivo = p_motivo;
--      insert into public.pontos (usuario_id, origem, pontos, motivo, data, lancado_por, marca)
--           values (v_alvo, 'apontamento', v_pts, p_motivo, p_data, v_uid, v_item->'marca');
--
--  O `delete` não tem clube. O `insert` não tem `club_id` — quem carimba é o gatilho
--  `definir_club_ponto`, que, sem clube explícito, chama `clube_vinculo_do_usuario()`: o vínculo
--  MAIS RECENTE da pessoa, que nada tem a ver com quem está lançando.
--
--  Para quem tem um clube só, as duas coisas dão no mesmo e a função funciona há meses. Para uma
--  pessoa com vínculo em dois clubes, medido no banco:
--
--      antes:  apontamento "Reunião 12/03" = 30 no clube A, 45 no clube B
--      a diretoria do clube A (que não tem autoridade nenhuma em B) salva a reunião
--      depois: uma linha só, de 10 pontos, NO CLUBE B
--
--  Entraram duas linhas, sobrou uma, no clube errado, e o dado do clube de quem operou
--  desapareceu. O cabeçalho da própria função promete o contrário: "Se qualquer linha falhar,
--  NADA é alterado (sem perda)".
--
--  A correção tem de ser nos dois lados. Escopar só o `delete` deixaria o `insert` caindo no clube
--  errado; passar só o `club_id` deixaria o `delete` continuando a apagar o de outro clube.
--
-- -----------------------------------------------------------------------------
--  2. `pode_apontar` perguntava pelo clube do ALVO, não pelo da requisição.
-- -----------------------------------------------------------------------------
--
--  `pode_gerir_no_clube(clube_do_usuario(alvo))` — e `clube_do_usuario` devolve UM clube da pessoa,
--  escolhido por ordem de criação. É a mesma forma dos cinco RPCs corrigidos na migration 64: a
--  autoridade vem do alvo. Uma diretoria de A, com a aba em A, podia apontar alguém cujo
--  `clube_do_usuario` fosse B; e uma diretoria de B, com a aba em B, não conseguia apontar a mesma
--  pessoa se o `clube_do_usuario` dela tivesse calhado de ser A. Errado dos dois lados.
--
-- -----------------------------------------------------------------------------
--  3. As quatro tabelas de leilão liam a união dos clubes, em qualquer aba.
-- -----------------------------------------------------------------------------
--
--  `leiloes`, `leilao_itens`, `leilao_lances` e `leilao_lance_unidades` têm policy
--  `leilao_habilitado(club_id)`, que chama `membro_ativo_no_clube(club_id)` sem consultar a aba.
--  É exatamente a forma do chat antes da migration 62 — delegação a uma função, sem citar
--  `club_id` de um jeito que a varredura de catálogo enxergasse.
--
--  E a Fase 8.4 afirmou, no relatório e no comentário da migration 62, que o teste comportamental
--  mostrou "exatamente essas duas, e só essas duas" superfícies. Estava errado: eram seis. O teste
--  não pegou o leilão por um motivo que vale mais do que o achado — a varredura de leitura cruzada
--  roda na seção 1 do arquivo, e os leilões só nascem na seção 4. Quando a varredura passou, as
--  tabelas estavam VAZIAS. "Nada vazou" e "não havia nada para vazar" tinham a mesma cara.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. O apontamento acontece no clube da requisição, e só nele.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_reuniao(p_data date, p_motivo text, p_itens jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_club uuid := public.clube_atual_id();
  v_item jsonb;
  v_alvo uuid;
  v_pts  int;
  v_n    int := 0;
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  -- Sem clube em uso não se aponta nada. Desde a migration 63, um header que não vale devolve
  -- nulo aqui em vez de cair em outro clube — então esta linha também é o que impede a rotina de
  -- rodar num clube que a pessoa não pediu.
  if v_club is null then raise exception 'Sem clube em uso.'; end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_alvo := (v_item->>'usuario_id')::uuid;
    -- mesma regra do app: só quem pode apontar aquela pessoa, NESTE clube
    if not public.pode_apontar(v_alvo) then
      raise exception 'Sem permissão para apontar esta pessoa.';
    end if;
    -- E a pessoa tem de ser deste clube. `pode_apontar` já garante isso depois da correção abaixo;
    -- esta linha é a segunda trava, porque é ela que protege o `delete`.
    if not exists (
      select 1 from public.organization_memberships m
       where m.user_id = v_alvo and m.organizational_unit_id = v_club
    ) then
      raise exception 'Sem permissão para apontar esta pessoa.';
    end if;
    v_pts := greatest(0, least(100, coalesce((v_item->>'pontos')::int, 0)));

    -- `club_id = v_club` no DELETE: o apontamento desta semana, NESTE clube. Sem isto, salvar a
    -- reunião do clube A apagava o apontamento de mesmo motivo que a pessoa tinha no clube B.
    delete from public.pontos
      where usuario_id = v_alvo and origem = 'apontamento' and motivo = p_motivo
        and club_id = v_club;
    -- `club_id` EXPLÍCITO no INSERT: com ele, `definir_club_ponto` apenas CONFERE o vínculo em vez
    -- de adivinhar o clube pelo vínculo mais recente da pessoa.
    insert into public.pontos (usuario_id, origem, pontos, motivo, data, lancado_por, marca, club_id)
      values (v_alvo, 'apontamento', v_pts, p_motivo, p_data, v_uid, (v_item->'marca'), v_club);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke all on function public.salvar_reuniao(date, text, jsonb) from public, anon;
grant execute on function public.salvar_reuniao(date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quem pode apontar quem — no clube da requisição.
-- ---------------------------------------------------------------------------
create or replace function public.pode_apontar(alvo uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- O clube é o DA ABA, não o que `clube_do_usuario(alvo)` calhar de devolver. As duas condições
  -- passam a ser: (a) eu gerencio ESTE clube, e (b) o alvo tem vínculo ativo NESTE clube.
  select public.clube_atual_id() is not null
     and exists (
       select 1 from public.organization_memberships d
        where d.user_id = alvo
          and d.organizational_unit_id = public.clube_atual_id()
          and d.status = 'ativo'
          and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())
     )
     and (
       public.pode_gerir_no_clube(public.clube_atual_id())
       -- ou sou conselheiro da MESMA unidade do desbravador, neste mesmo clube
       or exists (
         select 1
           from public.organization_memberships eu
           join public.organization_memberships d
             on d.organizational_unit_id = eu.organizational_unit_id
            and d.unidade_id is not distinct from eu.unidade_id
            and d.unidade_id is not null
          where eu.user_id = auth.uid()
            and eu.organizational_unit_id = public.clube_atual_id()
            and eu.role = 'conselheiro' and eu.status = 'ativo'
            and eu.starts_at <= now() and (eu.ends_at is null or eu.ends_at > now())
            and d.user_id = alvo and d.role = 'desbravador' and d.status = 'ativo'
            and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- 3. O leilão é o da aba.
--
-- `leilao_habilitado` é usada nas policies das quatro tabelas e também por RPCs do módulo. Escopar
-- aqui cobre as quatro de uma vez — e as RPCs, que já consultam `clube_atual_id()` por conta
-- própria desde fases anteriores, continuam idênticas (a condição vira redundante, não conflitante).
-- ---------------------------------------------------------------------------
create or replace function public.leilao_habilitado(p_club_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return p_club_id = public.clube_atual_id()
     and public.membro_ativo_no_clube(p_club_id)
     and public.recurso_habilitado_no_clube(p_club_id, 'leilao');
end;
$$;
