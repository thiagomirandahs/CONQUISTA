-- =============================================================================
--  Fase 8.5 — a ESCRITA também passa a ser do clube da requisição.
--
--  O VÃO, e ele é da correção da fase 8.4:
--
--  A migration 62 escopou a leitura por aba varrendo `pg_policies` — e o filtro dela era
--
--      and p.cmd in ('SELECT', 'ALL')
--
--  Policies de `INSERT`, `UPDATE` e `DELETE` **separadas** nunca entraram. Em quase toda tabela
--  deste banco a leitura e a escrita são policies distintas, então o resultado foi um produto em
--  que ler ficou preso à aba e escrever não.
--
--  A fase 8.4 chegou a tratar "operação no clube errado": a migration 64 corrigiu cinco funções
--  `security definer`. Mas função é só um dos dois caminhos de escrita — o outro é o PostgREST
--  gravando direto na tabela, que é o caminho que o próprio app usa em vários lugares (a montagem
--  dos três clubes cria unidades com `sbB.from('unidades').insert(...)`). Esse segundo caminho
--  ficou inteiro de fora.
--
--  MEDIDO PELO GATE NOVO (teste 56), na primeira vez que ele rodou:
--
--      [dir_a_membro_b | aba no clube B | insert em pontos] gravou no clube A
--      [instrutor_2clubes | aba no clube B | insert em pontos] gravou no clube A
--      [dir_a_membro_b | aba INVÁLIDA    | insert em pontos] gravou no clube A
--
--  Quem é liderança em A e membro em B, operando na aba de B, lançava pontos no ranking de A. É a
--  definição literal do que a fase 8.4 chamou de BLOCKER — "operação executada no clube errado,
--  mesmo que ninguém consiga ler o resultado" — e ela sobreviveu àquela fase porque os testes
--  daquela fase mediram o RETORNO das chamadas e a LEITURA depois, nunca o efeito de uma escrita
--  direta na tabela.
--
--  E o caso do contexto INVÁLIDO é o mais revelador: sem clube em uso, a escrita ainda acontecia.
--
--  Junto vai `mensalidades`, cuja policy `ALL` tem o `with check` escopado desde antes e o `using`
--  não. Para uma policy `ALL`, o `using` governa o que se ENXERGA (e o que se pode atualizar ou
--  apagar): quem tem permissão financeira em A lia as mensalidades de A pela aba de B. Ela escapou
--  da migration 62 porque usa `pode_financeiro_no_clube`, que não estava no regex daquela varredura
--  — a terceira vez nesta fase em que uma varredura por texto silencia sobre quem não segue o
--  padrão que ela procura.
-- =============================================================================

do $$
declare
  r record;
  v_roles text;
  v_using text;
  v_check text;
  v_n int := 0;
  -- As mesmas exceções da migration 62, pelos mesmos motivos, mais as superfícies de OPERAÇÃO DA
  -- PLATAFORMA — que existem justamente para olhar vários clubes de uma vez.
  v_excecoes constant text[] := array[
    'subscription_clubs', 'club_provisioning_status', 'support_grants', 'club_team_invites',
    'alertas', 'app_erros', 'infra_falhas', 'push_eventos', 'push_destinatarios',
    'push_evento_destinatarios', 'push_tentativas', 'onboarding_sessions'
  ];
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.cmd, p.permissive, p.roles,
           p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
       and 'authenticated' = any (p.roles)
       and p.tablename <> all (v_excecoes)
       and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%clube_atual_id%'
       -- só tabelas que carregam clube: sem `club_id` não há o que escopar
       and exists (
         select 1 from pg_attribute a
           join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
          where c.relname = p.tablename and a.attname = 'club_id' and not a.attisdropped)
     order by p.tablename, p.cmd, p.policyname
  loop
    v_roles := array_to_string(r.roles, ', ');
    -- O predicado antigo INTEIRO é preservado e apenas restringido: nada que já era negado passa a
    -- ser permitido. `club_id` aqui é a linha que está sendo gravada/alterada/apagada — e para
    -- INSERT ele já vem carimbado pelos gatilhos BEFORE, que rodam antes do `with check`.
    v_using := case when r.qual is null then null
                    else format('(club_id = public.clube_atual_id()) and (%s)', r.qual) end;
    v_check := case when r.with_check is null then null
                    else format('(club_id = public.clube_atual_id()) and (%s)', r.with_check) end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
      r.policyname, r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      lower(r.cmd), v_roles,
      case when v_using is null then '' else format(' using (%s)', v_using) end,
      case when v_check is null then '' else format(' with check (%s)', v_check) end);
    v_n := v_n + 1;
  end loop;
  raise notice '[8.5] % policies de ESCRITA passaram a exigir o clube da requisição', v_n;
end $$;

-- ---------------------------------------------------------------------------
--  `mensalidades`: a policy ALL tinha o `with check` escopado e o `using` não.
--
--  Reescrita à mão porque o bloco acima só olha INSERT/UPDATE/DELETE, e esta é `ALL` — ela passou
--  pelos dois filtros: pela 62 porque o helper dela não estava no regex, e pelo bloco acima porque
--  o `coalesce(qual, with_check)` encontra o `clube_atual_id` que já existe no `with check`.
--  Duas varreduras, cada uma achando que a outra tinha coberto.
-- ---------------------------------------------------------------------------
drop policy if exists "financeiro gere mensalidades do proprio clube" on public.mensalidades;
create policy "financeiro gere mensalidades do proprio clube" on public.mensalidades
  as permissive for all to authenticated
  using (club_id = public.clube_atual_id() and public.pode_financeiro_no_clube(club_id))
  with check (club_id = public.clube_atual_id() and public.pode_financeiro_no_clube(club_id));

-- ---------------------------------------------------------------------------
--  A conferência, no próprio banco: depois desta migration, nenhuma policy de escrita de tabela
--  com `club_id` pode continuar sem citar a aba. Falhar aqui é melhor do que descobrir num gate.
-- ---------------------------------------------------------------------------
do $$
declare v_faltando text;
begin
  select string_agg(p.tablename || '.' || p.policyname || ' (' || p.cmd || ')', ', ' order by p.tablename)
    into v_faltando
    from pg_policies p
   where p.schemaname = 'public'
     and p.cmd in ('INSERT', 'UPDATE', 'DELETE')
     and 'authenticated' = any (p.roles)
     and p.tablename <> all (array[
       'subscription_clubs', 'club_provisioning_status', 'support_grants', 'club_team_invites',
       'alertas', 'app_erros', 'infra_falhas', 'push_eventos', 'push_destinatarios',
       'push_evento_destinatarios', 'push_tentativas', 'onboarding_sessions'])
     and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%clube_atual_id%'
     and exists (
       select 1 from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relname = p.tablename and a.attname = 'club_id' and not a.attisdropped);
  if v_faltando is not null then
    raise exception 'policies de escrita sem escopo de aba: %', v_faltando;
  end if;
end $$;
