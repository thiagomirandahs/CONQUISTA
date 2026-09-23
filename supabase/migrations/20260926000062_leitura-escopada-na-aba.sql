-- =============================================================================
--  Fase 8.4 — a leitura passa a ser do CLUBE DA REQUISIÇÃO, não de "qualquer clube meu".
--
--  O ACHADO, e ele só aparece com uma pessoa que tem vínculo em mais de um clube:
--
--  As policies de leitura perguntavam `membro_ativo_no_clube(club_id)` — "você tem vínculo ativo
--  neste clube?". Para quem tem UM clube, isso é a mesma coisa que "este é o clube da aba". Para
--  quem tem três, não é: a pessoa passa a enxergar a UNIÃO dos três, em toda tela, em toda aba.
--
--  E o app não compensa isso: varrendo `src/services/`, **zero** consultas filtram por `club_id`.
--  Todas confiam na RLS. Medido no teste 55, com uma pessoa em A+B+C:
--
--    · `select sum(pontos) ... where usuario_id = eu` na aba de A devolvia 70 — os 10 de A mais
--      os 20 de B mais os 40 de C. O ranking, o extrato e a Home somavam três clubes;
--    · `select valor from config_clube where chave='pix'` na aba de B devolvia o PIX do clube A.
--      E como o app lê isso com `.maybeSingle()` (src/services/unidades.js:7), com dois clubes a
--      consulta nem devolve o valor errado: ela ERRA, e a tela quebra.
--
--  Não é vazamento — a pessoa tem direito de ver os três clubes. É CONTAMINAÇÃO DE CONTEXTO: a
--  aba diz "clube B" e o dado é A+B+C misturado. Num produto cujo contrato é "clube por
--  requisição" (fase 34), isso derruba a premissa inteira.
--
--  A CORREÇÃO é no lugar mais barato e mais confiável: a policy. Cada policy destas passa a
--  exigir, além do vínculo, que a linha seja do clube da requisição. São 58 policies em 45
--  tabelas, e o ajuste é mecânico e idêntico em todas — por isso é gerado a partir do catálogo,
--  não escrito 58 vezes à mão, onde uma divergir seria questão de tempo.
--
--  POR QUE ISSO É SEGURO:
--    · `clube_atual_id()` nunca é nulo para quem tem vínculo: sem header, cai no clube padrão da
--      pessoa. Uma requisição sem aba escolhida continua funcionando, no clube padrão dela.
--    · policies só valem para acesso DIRETO à tabela por `authenticated`. Funções
--      `security definer` (incluindo tudo que o cron chama) não passam por RLS e não mudam.
--    · o que atravessa contexto DE PROPÓSITO não está nesta lista: identidade global (`profiles`),
--      catálogo curricular, `curriculum_achievements` portáteis e verificação pública têm policies
--      próprias, que não citam `membro_ativo_no_clube(club_id)` e ficam intactas.
--
--  AS EXCEÇÕES, nomeadas e justificadas abaixo: superfícies COMERCIAIS e de OPERAÇÃO, onde ler
--  vários clubes de uma vez é justamente o trabalho.
-- =============================================================================

do $$
declare
  r record;
  v_roles text;
  v_using text;
  v_check text;
  v_n int := 0;
  -- Exceções: aqui ler mais de um clube ao mesmo tempo é o propósito da tela, não um acidente.
  v_excecoes constant text[] := array[
    'subscription_clubs',        -- o contato comercial vê TODOS os clubes cobertos pela assinatura
    'club_provisioning_status',  -- operação da plataforma: a fila de provisionamento é entre clubes
    'support_grants',            -- acesso assistido: a autorização é por clube, a lista é da operação
    'club_team_invites'          -- a pessoa precisa ver um convite de um clube em que ainda NÃO está
  ];
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.cmd, p.permissive, p.roles,
           p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('SELECT', 'ALL')
       and p.qual ~ 'membro_ativo_no_clube\(club_id\)|tem_vinculo_unidade\(club_id\)|pode_gerir_no_clube\(club_id\)'
       and p.qual !~ 'clube_atual_id'
       and p.tablename <> all (v_excecoes)
     order by p.tablename, p.policyname
  loop
    v_roles := array_to_string(r.roles, ', ');
    -- O predicado antigo INTEIRO é preservado e apenas restringido. Nada do que já era negado
    -- passa a ser permitido: a condição só fica mais estrita.
    v_using := format('(club_id = public.clube_atual_id()) and (%s)', r.qual);
    v_check := case when r.with_check is null then null
                    else format('(club_id = public.clube_atual_id()) and (%s)', r.with_check) end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I as %s for %s to %s using (%s)%s',
      r.policyname, r.tablename,
      case when r.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
      case when r.cmd = 'ALL' then 'all' else 'select' end,
      v_roles, v_using,
      case when v_check is null then '' else format(' with check (%s)', v_check) end);
    v_n := v_n + 1;
  end loop;
  raise notice '[8.4] % policies passaram a exigir o clube da requisição', v_n;
end $$;

-- ---------------------------------------------------------------------------
--  As duas que a varredura NÃO pegava — e é justamente por isso que elas importam.
--
--  A varredura acima procura `membro_ativo_no_clube(club_id)` no texto da policy. Chat e
--  experiências não escrevem isso: elas delegam a uma função (`chat_conversas_visiveis()`,
--  `_pode_ver_experiencia()`) e a policy nem menciona `club_id`. Ficaram de fora do filtro do
--  catálogo e continuaram somando os três clubes — o teste 55 mostrou exatamente essas duas,
--  e só essas duas, ainda vazando depois do bloco acima.
--
--  Fica registrado o método, porque ele vale para a próxima tabela que alguém criar: varredura de
--  catálogo por TEXTO encontra o que segue o padrão, e silencia justamente sobre quem não segue.
--  Quem prova a cobertura é o teste comportamental, não a consulta ao catálogo.
-- ---------------------------------------------------------------------------

-- O recorte entra no `meus`: uma vez restrito ao clube da requisição, os quatro ramos do UNION
-- (moderação, geral, unidade, direta) já ficam todos escopados de uma vez, porque todos partem dele.
create or replace function public.chat_conversas_visiveis()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with meus as (
    select m.organizational_unit_id as club_id, m.role, m.unidade_id
      from public.organization_memberships m
     where m.user_id = auth.uid()
       and m.status = 'ativo'
       and m.starts_at <= now()
       and (m.ends_at is null or m.ends_at > now())
       -- O CLUBE DA ABA. Sem esta linha, quem tem vínculo em três clubes carregava as conversas
       -- dos três em qualquer aba — e o chat é o pior lugar possível para isso acontecer.
       and m.organizational_unit_id = public.clube_atual_id()
  )
  -- 1) gestão do clube (instrutor/diretoria) alcança TODAS as conversas dele, inclusive diretas:
  --    é o caminho da moderação.
  select c.id
    from public.chat_conversas c
    join meus x on x.club_id = c.club_id
   where x.role in ('instrutor', 'diretoria')
  union
  -- 2) qualquer vínculo ativo que NÃO seja 'pais' alcança a conversa geral do clube.
  select c.id
    from public.chat_conversas c
    join meus x on x.club_id = c.club_id
   where c.tipo = 'geral'
     and x.role <> 'pais'
  union
  -- 3) desbravador/conselheiro alcança a conversa da unidade do PRÓPRIO vínculo naquele clube.
  select c.id
    from public.chat_conversas c
    join meus x on x.club_id = c.club_id
   where c.tipo = 'unidade'
     and c.unidade_id is not null
     and x.role in ('desbravador', 'conselheiro')
     and x.unidade_id = c.unidade_id
  union
  -- 4) conversa direta: lista explícita de participantes, e só para quem tem vínculo ativo
  --    não-'pais' no clube da conversa.
  select p.conversa_id
    from public.chat_participantes p
    join public.chat_conversas c on c.id = p.conversa_id
    join meus x on x.club_id = c.club_id
   where p.usuario_id = auth.uid()
     and c.tipo not in ('geral', 'unidade')
     and x.role <> 'pais'
$$;

-- `experience_stages`, `experience_participants` e companhia herdam a autorização daqui. Escopando
-- na raiz, a árvore inteira segue junto — não há uma policy por tabela filha para esquecer.
create or replace function public._pode_ver_experiencia(p_exp_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.experiences e
    where e.id = p_exp_id
      and e.club_id = public.clube_atual_id()
      and public.membro_ativo_no_clube(e.club_id)
      and (public.pode_gerir_no_clube(e.club_id)
        or (e.status in ('publicada', 'encerrada') and public._experiencia_no_publico(e.id, auth.uid())))
  );
$$;
