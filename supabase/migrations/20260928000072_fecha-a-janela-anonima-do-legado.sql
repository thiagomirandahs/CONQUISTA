-- =============================================================================
--  Fase 8.6 — a última janela anônima para dentro do Tenant 001.
--
--  A policy
--
--      create policy "anon le unidades tenant legado" on public.unidades
--        for select to anon using (club_id = public.clube_legado_id());
--
--  existia por um motivo só, escrito na migration que a criou: "o cadastro legado continua exibindo
--  somente as unidades do Tenant 001". Ela alimentava o seletor de unidade da tela de cadastro, que
--  consultava `unidades` sem sessão — e era a metade visível do fallback que a migration 70 tirou.
--  As duas eram o mesmo defeito por dois lados: a policy dizia QUAIS unidades um desconhecido via,
--  e o `handle_new_user` transformava aquela escolha em vínculo naquele clube.
--
--  A fase 8.5 chegou a registrá-la, com assert próprio, como "a última peça do produto que ainda
--  supõe clube único", e deixou escrito que consertá-la era decidir como o cadastro descobre o
--  clube. A 8.6 decidiu: ele não descobre. Quem descobre é o código de entrada, depois do login.
--
--  Agora a policy é peso morto E uma janela: `src/pages/Cadastro.jsx` não consulta mais `unidades`,
--  e o que restava era qualquer visitante anônimo conseguindo listar os nomes das unidades de um
--  clube específico — de graça, sem conta, sem limite. Não é um segredo grave; é uma porta que não
--  serve mais para nada.
--
--  `clube_legado_id()` mantém o `grant` para `anon`: ele ainda é usado para identificar o tenant
--  legado em rotinas de migração e teste, e sem a policy acima não abre leitura de nada.
-- =============================================================================

drop policy if exists "anon le unidades tenant legado" on public.unidades;

do $$
declare v_sobrando text;
begin
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename)
    into v_sobrando
    from pg_policies p
   where p.schemaname = 'public'
     and 'anon' = any (p.roles)
     and exists (
       select 1 from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relname = p.tablename and a.attname = 'club_id' and not a.attisdropped);
  if v_sobrando is not null then
    raise exception 'ainda há superfície de clube legível por anônimo: %', v_sobrando;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  E a limpeza que o mapa desta fase revelou: `sincronizar_vinculo_perfil()` NÃO TEM GATILHO.
--
--  A migration 34 derrubou `trg_00_sync_vinculo_perfil` quando a direção do espelho inverteu (o
--  vínculo passou a ser a fonte, e o perfil o espelho — `sincronizar_perfil_do_vinculo`). A função
--  ficou no catálogo, órfã, e foi redefinida por migrations posteriores como se estivesse viva.
--
--  Isso merece uma correção de registro: a migration 70 desta fase tirou o `coalesce(…, legado)` de
--  dentro dela descrevendo aquilo como um fallback em uso. Não era — era um fallback em código que
--  não executa. A limpeza continua certa (uma função morta que ensina o padrão errado é pior do que
--  uma função morta), mas o efeito era nenhum, e dizer o contrário seria contar uma vitória que não
--  houve. Quem impedia o fundador de cair no Tenant 001 sempre foi o ramo dele em `handle_new_user`
--  não ter `insert into organization_memberships` — nunca o desvio dentro desta função.
--
--  Ela sai. Uma função `security definer` órfã é superfície de ataque sem dono, e enquanto existir
--  alguém vai continuar mantendo-a achando que ela faz alguma coisa.
-- ---------------------------------------------------------------------------
drop function if exists public.sincronizar_vinculo_perfil();
