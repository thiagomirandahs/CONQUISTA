-- =============================================================================
--  Fase 8.1 — as duas otimizações que a Fase 8 MEDIU, e só elas.
--
--  Nada aqui é palpite. As duas mudanças saíram de EXPLAIN (ANALYZE, BUFFERS) sobre um dataset
--  sintético de 100 clubes / 5.000 pessoas / 100.000 mensagens, documentado em
--  PRODUCTION-READINESS.md §4. Um terceiro índice candidato (chat_mensagens por conversa+data)
--  foi TESTADO e DESCARTADO na Fase 8 — ele não aparece aqui porque não deu ganho, e o motivo
--  ficou claro agora: `idx_chat_mensagens_conversa (conversa_id, created_at)` já existe desde
--  2026-08-24, e o btree é lido de trás para frente sem precisar de uma cópia "desc".
--
--  (A) MURAL — índice novo.
--      A consulta é sempre "as N fotos mais recentes DESTE clube", e não havia índice que
--      casasse o recorte com a ordenação: o planejador lia o heap inteiro do clube e ordenava.
--        antes:  912 buffers · 1,94 ms        depois:  94 buffers · 0,26 ms
--
--  (B) CHAT — a policy deixa de ser avaliada linha a linha.
--      `chat_pode_ver(conversa_id)` é STABLE, então o planejador a chamava UMA VEZ POR LINHA
--      candidata de chat_mensagens. Ler as 50 mensagens mais recentes de uma conversa custava
--      9.111 buffers, e o custo crescia com o HISTÓRICO da conversa — não com o que se pedia.
--      A PoC da Fase 8 isolou a conta: a função respondia por ~92% do custo (771 -> 64 buffers
--      ao trocar a chamada por um predicado que o planejador consegue casar com índice).
--
--      A troca: uma função set-returning `chat_conversas_visiveis()` calcula DE UMA VEZ o
--      conjunto de conversas que a pessoa alcança, e as policies viram `conversa_id in (...)`.
--      Postgres avalia um subplano hasheado uma única vez por consulta.
--
--      A regra que essa mudança teve de respeitar: a matriz de acesso não muda. O teste
--      45_chat_matriz_de_acesso.sql foi escrito ANTES, rodado contra a implementação antiga
--      (62 asserts, 7 conversas x 15 pessoas x 3 superfícies) e precisa passar igual depois.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (A) Mural: recorte (club_id) + ordenação (created_at desc) no mesmo índice.
-- ---------------------------------------------------------------------------
create index if not exists idx_fotos_club_recente on public.fotos (club_id, created_at desc);

-- ---------------------------------------------------------------------------
-- (B) Chat: o conjunto de conversas visíveis, calculado set-based.
-- ---------------------------------------------------------------------------
-- Os quatro ramos são exatamente os quatro caminhos da chat_pode_ver() antiga, na mesma ordem,
-- traduzidos de "responda sim/não para ESTA conversa" para "liste as conversas".
--
-- `meus` são os vínculos ativos de quem chama — uma ou duas linhas, mesmo para quem está em
-- vários clubes. É o que permite trocar N chamadas de função por um join.
--
-- Uma diferença deliberada em relação à versão antiga: o ramo da unidade usava um subselect
-- ESCALAR para descobrir "a minha unidade neste clube". Com duas linhas de vínculo elegíveis no
-- mesmo clube (dado inconsistente), aquilo levantava erro; aqui vira um join, que simplesmente
-- considera as duas. Continua impossível alcançar unidade de quem não se é: o join sai dos
-- vínculos da própria pessoa.
create or replace function public.chat_conversas_visiveis()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with meus as (
    select m.organizational_unit_id as club_id, m.role, m.unidade_id
      from public.organization_memberships m
     where m.user_id = auth.uid()
       and m.status = 'ativo'
       and m.starts_at <= now()
       and (m.ends_at is null or m.ends_at > now())
  )
  -- 1) gestão do clube (instrutor/diretoria) alcança TODAS as conversas dele, inclusive diretas:
  --    é o caminho da moderação. Espelha o `pode_gerir_no_clube()` do começo da função antiga.
  select c.id
    from public.chat_conversas c
    join meus x on x.club_id = c.club_id
   where x.role in ('instrutor', 'diretoria')
  union
  -- 2) qualquer vínculo ativo que NÃO seja 'pais' alcança a conversa geral do clube.
  --    O recorte `role <> 'pais'` é o mesmo de `membro_ativo_no_clube()`: responsável acompanha
  --    a criança, não entra no chat do clube dela.
  select c.id
    from public.chat_conversas c
    join meus x on x.club_id = c.club_id
   where c.tipo = 'geral'
     and x.role <> 'pais'
  union
  -- 3) desbravador/conselheiro alcança a conversa da unidade do PRÓPRIO vínculo naquele clube.
  --    (desbravador/conselheiro já implica role <> 'pais', então não há checagem redundante.)
  select c.id
    from public.chat_conversas c
    join meus x on x.club_id = c.club_id
   where c.tipo = 'unidade'
     and c.unidade_id is not null
     and x.role in ('desbravador', 'conselheiro')
     and x.unidade_id = c.unidade_id
  union
  -- 4) conversa direta: lista explícita de participantes, e só para quem tem vínculo ativo
  --    não-'pais' no clube da conversa. O `tipo not in ('geral','unidade')` reproduz o fato de
  --    que, na função antiga, este era o ramo FINAL — inalcançável para geral e unidade.
  select p.conversa_id
    from public.chat_participantes p
    join public.chat_conversas c on c.id = p.conversa_id
    join meus x on x.club_id = c.club_id
   where p.usuario_id = auth.uid()
     and c.tipo not in ('geral', 'unidade')
     and x.role <> 'pais'
$$;

revoke all on function public.chat_conversas_visiveis() from public;
grant execute on function public.chat_conversas_visiveis() to authenticated;

-- chat_pode_ver() continua existindo e respondendo exatamente o mesmo: é API concedida a
-- `authenticated` e o PREFLIGHT-PRODUCAO.sql confere a presença dela. Só a implementação mudou —
-- agora ela pergunta ao conjunto, em vez de refazer a conta sozinha. Uma única fonte de verdade.
create or replace function public.chat_pode_ver(p_conversa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_conversas_visiveis() v where v = p_conversa_id);
$$;

revoke all on function public.chat_pode_ver(uuid) from public;
grant execute on function public.chat_pode_ver(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- As três policies. `x in (select f())` sem correlação com a linha externa é avaliado uma vez
-- por consulta (subplano hasheado) — é exatamente isso que tira a função do laço por linha.
-- ---------------------------------------------------------------------------
drop policy if exists "ler minhas conversas" on public.chat_conversas;
create policy "ler minhas conversas" on public.chat_conversas
  for select to authenticated
  using (id in (select public.chat_conversas_visiveis()));

drop policy if exists "ler mensagens" on public.chat_mensagens;
create policy "ler mensagens" on public.chat_mensagens
  for select to authenticated
  using (conversa_id in (select public.chat_conversas_visiveis()));

drop policy if exists "ler participantes" on public.chat_participantes;
create policy "ler participantes" on public.chat_participantes
  for select to authenticated
  using (conversa_id in (select public.chat_conversas_visiveis()));
