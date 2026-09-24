-- =============================================================================
--  Fase 8.5, item 6 — a conquista atravessa; a EVIDÊNCIA do clube emissor, não.
--
--  O contrato da fase, nas palavras dela: "A portabilidade curricular permite consultar a conquista
--  RECONHECIDA; não concede acesso às EVIDÊNCIAS PRIVADAS do clube emissor."
--
--  As sete superfícies curriculares atravessam clube de propósito — é o que faz um desbravador
--  levar a classe dele ao mudar de cidade, e um pastor de fora conferir um certificado. Isso está
--  certo e não se toca. O que se descobriu é que, junto da conquista, atravessavam cinco coisas que
--  são do clube que avaliou, e de mais ninguém:
--
--    1. a FOTO que a criança enviou como evidência de um requisito;
--    2. o comentário que o avaliador escreveu ao aprovar, dentro do snapshot selado;
--    3. a observação do revisor institucional;
--    4. a observação da cerimônia de investidura;
--    5. o motivo escrito ao revogar uma conquista ou um snapshot.
--
--  Nenhuma delas é "a conquista reconhecida". Todas são o julgamento interno de um clube sobre uma
--  criança — o tipo de texto que se escreve supondo que fica em casa.
--
-- -----------------------------------------------------------------------------
--  1. A FOTO. O mais grave, e o mais silencioso.
-- -----------------------------------------------------------------------------
--
--  A evidência de arquivo vai para o bucket privado `comprovacoes`, no caminho
--  `<usuario_id>/requisitos/<timestamp>.jpg` (src/lib/upload.js). **Não há clube no caminho.**
--  A policy de leitura aceitava a pasta se `lideranca_gere_pasta(<usuario_id>)`, que por sua vez é
--
--      pode_gerir_no_clube(clube_atual_id())
--        and exists (select 1 from organization_memberships
--                     where user_id = p_user_id and organizational_unit_id = clube_atual_id())
--
--  Para quem tem um clube só, isso é "a liderança vê a evidência dos seus membros", que é o certo.
--  Para uma criança com vínculo em dois clubes, é outra coisa: como o caminho não tem clube, a
--  liderança do clube B enxerga a pasta INTEIRA dela — inclusive as fotos enviadas como evidência
--  de requisitos do clube A. E o `exists` não filtra `status`: bastava um vínculo **suspenso** ou
--  encerrado no clube B para a porta abrir.
--
--  A correção não muda o caminho dos arquivos (o que exigiria migrar objetos já enviados e mexer no
--  app). Ela pergunta ao BANCO de quem é aquela evidência: `evidencia_path` guarda exatamente o
--  nome do objeto, e a linha que o guarda tem `club_id`. Então a pergunta deixa de ser "esta pessoa
--  é do meu clube?" e passa a ser "esta EVIDÊNCIA é do meu clube?" — que é a pergunta certa, e que
--  o caminho do arquivo nunca teve como responder.
-- -----------------------------------------------------------------------------

-- De quem é AQUELE OBJETO. O bucket `comprovacoes` guarda a evidência de QUATRO fluxos, e cada um
-- registra o caminho numa tabela diferente — todas com `club_id`. A pergunta é sempre a mesma, e é
-- pelo dado, não pela pessoa: "esta evidência pertence ao clube em que estou operando?".
--
-- As quatro tabelas estão escritas uma a uma de propósito. Uma varredura automática por nome de
-- coluna acharia três delas e perderia `entregas`/`missoes_feitas`/`devocional`, que chamam a
-- coluna de `foto_url` — e foi exatamente esse tipo de silêncio que deixou o leilão passar pela
-- fase 8.4. Se um quinto fluxo passar a usar o bucket, ele precisa entrar aqui, e o teste 25
-- (imagens privadas) quebra se alguém esquecer.
create or replace function public.lideranca_ve_comprovacao(p_objeto text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.member_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.member_specialty_requirements x
        where x.evidencia_path = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.entregas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.missoes_feitas x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.devocional x
        where x.foto_url = p_objeto and x.club_id = public.clube_atual_id()
       union all
       select 1 from public.experience_submissions x
        where x.arquivo_path = p_objeto and x.club_id = public.clube_atual_id()
     );
$$;
revoke all on function public.lideranca_ve_comprovacao(text) from public, anon;
grant execute on function public.lideranca_ve_comprovacao(text) to authenticated;

drop policy if exists "comprovacao dono ou lideranca le" on storage.objects;
create policy "comprovacao dono ou lideranca le" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprovacoes'
    and (
      -- a própria pessoa, sempre: é a evidência dela
      (storage.foldername(name))[1] = auth.uid()::text
      -- ou a liderança do clube A QUE AQUELA EVIDÊNCIA PERTENCE, operando nele
      or public.lideranca_ve_comprovacao(name)
    )
  );

-- `lideranca_gere_usuario` governa reset de senha, exclusão de conta e a tela de Aprovações. O
-- `exists` dela não olhava `status` nenhum — bastava um vínculo ENCERRADO para a porta continuar
-- aberta sobre alguém que já saiu do clube.
--
-- A primeira tentativa aqui exigiu `status = 'ativo'`, e a suíte reagiu na hora: a tela de
-- Aprovações parou de enxergar cadastro PENDENTE, que é justamente quem a liderança precisa ver
-- para aprovar; e um vínculo SUSPENSO não poderia mais ser reativado. O recorte certo não é
-- "ativo": é "o vínculo ainda VALE" — pendente, ativo ou suspenso, e dentro do período.
create or replace function public.lideranca_gere_usuario(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.pode_gerir_no_clube(public.clube_atual_id())
     and exists (
       select 1 from public.organization_memberships m
        where m.user_id = p_user_id
          and m.organizational_unit_id = public.clube_atual_id()
          and m.status in ('pendente', 'ativo', 'suspenso')
          and (m.ends_at is null or m.ends_at > now())
     );
$$;

-- -----------------------------------------------------------------------------
--  2. O COMENTÁRIO DO AVALIADOR, dentro do snapshot selado.
--
--  `_classe_snapshot_conteudo` grava, em cada requisito:
--      'aprovacoes', [{ decisao, avaliado_por: {id, nome}, papel, club_id, comentario, em }]
--
--  O cabeçalho da própria migration que a criou (44:24-30) declara o contrato: "NÃO copia
--  evidências (texto/foto): guarda só referência/flag". O código cumpre isso para a evidência do
--  desbravador — grava `tem_texto`/`tem_arquivo`, não o conteúdo — e não cumpre para o texto do
--  AVALIADOR, que entra inteiro.
--
--  Sai o `comentario` e sai o `id` de quem avaliou. O que fica é o que um documento de conclusão
--  precisa provar: que houve aprovação, por quem (nome), em que papel, de que clube e quando.
--  O `id` é identificador interno de pessoa, e o projeto inteiro mantém o teste 24 contra oráculo
--  de UUID — não faz sentido distribuí-lo dentro de um objeto que viaja entre clubes.
-- -----------------------------------------------------------------------------
do $$
declare v_fonte text; v_novo text;
begin
  v_fonte := pg_get_functiondef('public._classe_snapshot_conteudo(uuid)'::regprocedure);
  v_novo := replace(
    v_fonte,
    $velho$'aprovacoes', (select coalesce(jsonb_agg(jsonb_build_object('decisao', a.decisao, 'avaliado_por', jsonb_build_object('id', a.avaliado_por, 'nome', p.nome),
                             'papel', a.avaliado_papel, 'club_id', a.club_id, 'comentario', a.comentario, 'em', a.created_at) order by a.created_at), '[]'::jsonb)$velho$,
    $novo$'aprovacoes', (select coalesce(jsonb_agg(jsonb_build_object('decisao', a.decisao, 'avaliado_por', jsonb_build_object('nome', p.nome),
                             'papel', a.avaliado_papel, 'club_id', a.club_id, 'em', a.created_at) order by a.created_at), '[]'::jsonb)$novo$);
  if v_novo = v_fonte then
    raise exception 'o bloco de aprovações do snapshot mudou de forma: revise a troca antes de seguir';
  end if;
  execute v_novo;
end $$;

-- Os snapshots JÁ SELADOS continuam com o comentário dentro. Eles são reescritos e RE-SELADOS.
--
-- Isso merece ser dito com todas as letras, porque mexer num documento selado é exatamente o que um
-- selo existe para impedir: o hash de um snapshot prova que o conteúdo não mudou desde a emissão, e
-- recalculá-lo destrói essa prova para quem tivesse guardado o hash antigo.
--
-- É aceitável AQUI, e só aqui, por um motivo verificável: o produto ainda não tem cliente pagante,
-- nenhum snapshot saiu deste ambiente, e nenhum hash foi publicado em documento nenhum. Depois do
-- primeiro clube em produção, o caminho para uma correção como esta deixa de ser reescrever e passa
-- a ser revogar e reemitir, com o histórico mostrando as duas versões.
do $$
declare r record; v_novo jsonb; v_n int := 0;
begin
  for r in select id, conteudo from public.class_completion_snapshots loop
    v_novo := r.conteudo;
    -- remove `comentario` e `avaliado_por.id` de toda aprovação, em qualquer profundidade
    v_novo := (
      select jsonb_agg_strip.v from (
        select regexp_replace(
                 regexp_replace(r.conteudo::text, '"comentario"\s*:\s*("(\\.|[^"\\])*"|null)\s*,?', '', 'g'),
                 '"id"\s*:\s*"[0-9a-f-]{36}"\s*,\s*("nome")', '\1', 'g')::jsonb as v
      ) jsonb_agg_strip);
    if v_novo is distinct from r.conteudo then
      update public.class_completion_snapshots
         set conteudo = v_novo, hash = public._snapshot_hash(v_novo)
       where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice '[8.5] % snapshot(s) reescritos sem o comentário do avaliador e re-selados', v_n;
end $$;

-- -----------------------------------------------------------------------------
--  3. A OBSERVAÇÃO DO REVISOR, via `workflow_historico()`.
--
--  A RPC devolvia `observacao` — o texto que o revisor do distrito/região escreveu sobre aquela
--  criança — para qualquer liderança que alcançasse a conquista portátil. E ela **não tem chamador
--  no app**: `src/services/` inteiro não a menciona. Era superfície só de PostgREST, que é o mesmo
--  argumento que a migration 56 usou para fechar quatro funções.
-- -----------------------------------------------------------------------------
-- A troca é cirúrgica sobre a definição REAL (`pg_get_functiondef` + `replace`), e não uma
-- reescrita à mão: esta função monta um JSON aninhado grande, e recriá-la de memória seria a
-- maneira mais fácil de mudar, sem perceber, algo que ninguém pediu para mudar.
--
-- Saem: `observacao` (o texto do revisor) e os IDS de pessoa e de escopo. Os ids importam porque o
-- projeto mantém o teste 24 inteiro contra oráculo de UUID — distribuir o uuid do perfil de um
-- revisor de outro clube, e o da unidade organizacional dele, dentro de um objeto que atravessa
-- clube, é abrir pela porta da frente o que aquele teste guarda pela de trás. Ficam o nome de quem
-- decidiu, o papel, a decisão e a data: é o que uma conquista precisa provar.
do $$
declare v_fonte text; v_novo text; v_trocas int := 0;
begin
  v_fonte := pg_get_functiondef('public.workflow_historico(uuid)'::regprocedure);
  v_novo := v_fonte;

  v_novo := replace(v_novo,
    $x$'decisao', (select json_build_object('id', d.id, 'decisao', d.decisao, 'metodo', d.metodo, 'observacao', d.observacao,$x$,
    $x$'decisao', (select json_build_object('decisao', d.decisao, 'metodo', d.metodo,$x$);
  v_novo := replace(v_novo,
    $x$'decisor', (select json_build_object('id', p.id, 'nome', p.nome) from public.profiles p where p.id = d.decisor_id),$x$,
    $x$'decisor', (select json_build_object('nome', p.nome) from public.profiles p where p.id = d.decisor_id),$x$);
  v_novo := replace(v_novo,
    $x$'escopo', (select json_build_object('id', o.id, 'nome', o.nome, 'tipo', o.type) from public.organizational_units o where o.id = d.escopo_organizational_unit_id))$x$,
    $x$'escopo', (select json_build_object('nome', o.nome, 'tipo', o.type) from public.organizational_units o where o.id = d.escopo_organizational_unit_id))$x$);

  if v_novo like '%d.observacao%' or v_novo like '%''id'', p.id%' or v_novo like '%''id'', o.id%' then
    raise exception 'workflow_historico mudou de forma: revise as trocas antes de seguir';
  end if;
  if v_novo = v_fonte then
    raise exception 'nenhuma troca aplicada em workflow_historico — a definição não é a esperada';
  end if;
  execute v_novo;
end $$;

-- -----------------------------------------------------------------------------
--  4 e 5. As colunas de TEXTO LIVRE nas tabelas portáteis.
--
--  `class_investitures.observacao`, `workflow_stage_decisions.observacao`,
--  `curriculum_achievements.revogada_motivo` e `class_completion_snapshots.revogado_motivo` são
--  julgamento escrito por gente do clube emissor. As tabelas são portáteis; estas colunas não.
--
--  A ferramenta certa para isso no Postgres é permissão POR COLUNA: a linha continua visível — a
--  conquista atravessa —, e a coluna de texto some do `select *`. Nenhuma tela lê esses campos
--  hoje (varrido em `src/`): eles são escritos e nunca relidos, então a revogação não tira nada de
--  ninguém. Quem precisar lê-los no futuro ganha uma função que confira "dono ou clube emissor",
--  em vez de um `grant` largo.
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('class_investitures', 'observacao'),
      ('workflow_stage_decisions', 'observacao'),
      ('curriculum_achievements', 'revogada_motivo'),
      ('class_completion_snapshots', 'revogado_motivo')
    ) v(tabela, coluna)
  loop
    -- Um `revoke` de coluna só vale se o grant for por coluna: com `grant select` na TABELA inteira
    -- o Postgres ignora o revoke de uma coluna. Então: tira o grant amplo e devolve coluna a coluna,
    -- menos a que sai. Assim o `select *` do PostgREST passa a não incluí-la.
    execute format('revoke select on public.%I from authenticated', r.tabela);
    execute (
      select format('grant select (%s) on public.%I to authenticated',
                    string_agg(quote_ident(a.attname), ', ' order by a.attnum), r.tabela)
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relname = r.tabela and a.attnum > 0 and not a.attisdropped
         and a.attname <> r.coluna);
  end loop;
end $$;
