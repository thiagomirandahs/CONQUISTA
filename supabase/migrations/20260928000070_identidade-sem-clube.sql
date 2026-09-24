-- =============================================================================
--  Fase 8.6 — cadastrar-se deixa de significar "entrar no Tenant 001".
--
--  A ÚLTIMA SUPOSIÇÃO DE CLUBE ÚNICO, e ela estava em três linhas espalhadas:
--
--      handle_new_user, ramo else:      v_club := public.clube_legado_id();
--      sincronizar_vinculo_perfil:      coalesce(..., public.clube_legado_id())
--      definir_club_{ponto,foto,notificacao}:  coalesce(..., public.clube_legado_id())
--
--  Todas dizem a mesma coisa: "na dúvida, é do clube legado". Isso foi escrito quando havia um
--  clube só e era literalmente verdade. Hoje significa que qualquer pessoa que se cadastre pelo
--  formulário público entra como membro pendente de um clube de um cliente específico — e que
--  qualquer linha cujo clube o sistema não soube determinar vai parar lá dentro.
--
--  O EFEITO PRÁTICO, medido na fase 8.5: um clube novo não tinha caminho de autocadastro. A tela de
--  cadastro monta o seletor de unidade com as unidades do Tenant 001 (única coisa que `anon`
--  enxerga) e manda essa `unidade_id` para cá. Quem se cadastrasse para entrar no clube B entrava,
--  na verdade, na fila de aprovação do clube A.
--
--  A CORREÇÃO separa IDENTIDADE de VÍNCULO:
--
--    · cadastrar-se cria a CONTA. Só isso. Ninguém entra em clube nenhum por se cadastrar.
--    · o vínculo nasce por um caminho que diz QUAL clube: convite nominal, convite com token, ou
--      o código de entrada do clube (migration 71). Em todos, quem decide é o clube de destino.
--
--  O ramo 'fundador' já fazia exatamente isso desde a fase do onboarding — identidade sem vínculo,
--  com `app.signup_sem_clube`. Esta migration generaliza o que já estava lá, em vez de inventar.
--
--  COMPATIBILIDADE (item 10): nenhum vínculo existente é tocado. A mudança vale para cadastros
--  NOVOS. Quem já é do Tenant 001 continua sendo, com o mesmo papel, a mesma unidade e o mesmo
--  status — e o ramo 'pais' (convite de responsável) continua inteiro, porque ali o clube vem do
--  TOKEN, que é uma autoridade legítima e não um palpite.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tipo text := v_meta->>'tipo';
  v_token text := v_meta->>'convite_responsavel';
  v_inv public.club_invites;
  v_club uuid;
begin
  if v_tipo = 'pais' then
    -- RESPONSÁVEL: inalterado, e de propósito (item 4 da fase). Aqui o clube NÃO é um palpite —
    -- ele vem do token do convite, que a liderança emitiu para uma criança específica. Afrouxar
    -- isto seria deixar alguém se declarar responsável por uma criança de um clube qualquer.
    if coalesce(v_token, '') = '' then raise exception 'Cadastro de responsável exige convite do clube.'; end if;
    select * into v_inv from public.club_invites
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and used_at is null and revoked_at is null and expires_at > now()
     for update;
    if v_inv.id is null then raise exception 'Convite inválido, usado, revogado ou expirado.'; end if;
    v_club := v_inv.club_id;
    perform set_config('app.signup_club', v_club::text, true);
    insert into public.profiles (id, nome, papel, status) values (new.id, v_meta->>'nome', 'pais', 'ativo');
    insert into public.organization_memberships (user_id, organizational_unit_id, role, status, metadata)
    values (new.id, v_club, 'pais', 'ativo', '{"source":"cadastro"}'::jsonb);
    update public.club_invites set used_at = now(), used_by = new.id where id = v_inv.id;
    perform set_config('app.signup_club', '', true);
    return new;
  end if;

  -- TODO O RESTO: identidade, e nada além dela.
  --
  -- Antes, este caminho lia `unidade_id` do formulário para descobrir o clube, e caía no legado
  -- quando não vinha nenhuma. As duas coisas saem:
  --
  --   · a unidade não é mais escolhida no cadastro. Quem não tem clube não tem unidade — e
  --     mesmo depois de entrar, atribuir unidade é ato da liderança, que sabe quem é a pessoa
  --     e como as unidades dela estão organizadas. Pedir isso a um desconhecido no formulário
  --     público nunca foi uma escolha informada;
  --   · e não há fallback. "Não sei de que clube é" agora significa "não é de clube nenhum",
  --     que é um estado válido e tratado pelo app.
  --
  -- `status = 'ativo'` porque não há clube que o aprove: 'pendente' só faz sentido diante de uma
  -- liderança. A aprovação volta a existir quando a pessoa pedir entrada num clube, e ali ela é do
  -- VÍNCULO, não da conta.
  perform set_config('app.signup_sem_clube', '1', true);
  insert into public.profiles (id, nome, nascimento, cargo, papel, status)
  values (new.id, v_meta->>'nome', (nullif(v_meta->>'nascimento', ''))::date,
          v_meta->>'cargo', 'desbravador', 'ativo');
  perform set_config('app.signup_sem_clube', '', true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
--  O espelho de perfil → vínculo. Ele existe para o caso em que uma linha de `profiles` nasce por
--  outro caminho; o `coalesce` final caía no clube legado. Sem clube conhecido, não se inventa um:
--  não cria vínculo nenhum, e a pessoa fica com a conta — que é o estado normal agora.
-- ---------------------------------------------------------------------------
do $$
declare v_fonte text; v_novo text;
begin
  v_fonte := pg_get_functiondef('public.sincronizar_vinculo_perfil()'::regprocedure);
  v_novo := replace(v_fonte,
    $velho$    v_club := coalesce(v_signup::uuid, (select club_id from public.unidades where id = new.unidade_id), public.clube_legado_id());$velho$,
    $novo$    -- FASE 8.6: sem clube conhecido, NÃO se inventa um. Aqui havia um coalesce com o clube
    -- padrão no fim, e ele fazia toda conta sem origem clara virar membro do Tenant 001 —
    -- inclusive as que só queriam existir.
    v_club := coalesce(v_signup::uuid, (select club_id from public.unidades where id = new.unidade_id));
    if v_club is null then return new; end if;$novo$);
  -- O comentário do desvio do fundador também citava a função pelo nome. Some junto: a guarda no
  -- fim desta migration varre o TEXTO da definição, e um comentário explicando que o fallback saiu
  -- é, para uma varredura por texto, indistinguível do fallback continuar ali. (É a terceira vez
  -- nesta série de fases que isso acontece — vale como regra: descreva, não soletre.)
  v_novo := replace(v_novo,
    $velho$    -- o coalesce abaixo cairia em clube_legado_id() e o Tenant 001 ganharia um membro que não é dele.$velho$,
    $novo$    -- sem este desvio, o coalesce abaixo daria ao Tenant 001 um membro que não é dele.$novo$);
  if v_novo = v_fonte then
    raise exception 'sincronizar_vinculo_perfil mudou de forma: revise a troca antes de seguir';
  end if;
  execute v_novo;
end $$;

-- ---------------------------------------------------------------------------
--  Os carimbadores de clube (ponto, foto, notificação).
--
--  Cada um termina em `coalesce(..., clube_legado_id())`: "se eu não soube de que clube é, é do
--  legado". Enquanto uma conta SEM CLUBE era impossível, esse ramo era inalcançável na prática.
--  Agora conta sem clube é o estado normal de quem acabou de se cadastrar — e sem esta mudança,
--  um ponto lançado para essa pessoa iria silenciosamente parar dentro do clube de um cliente.
--
--  Vira recusa. Um dado que o sistema não sabe de que clube é não deve existir.
-- ---------------------------------------------------------------------------
do $$
declare r record; v_fonte text; v_novo text; v_n int := 0;
begin
  for r in
    select * from (values
      ('public.definir_club_ponto()',        'pontos'),
      ('public.definir_club_foto()',         'fotos'),
      ('public.definir_club_notificacao()',  'notificacoes')
    ) v(fn, tabela)
  loop
    v_fonte := pg_get_functiondef(r.fn::regprocedure);
    v_novo := replace(v_fonte, 'public.clube_legado_id()', 'null::uuid');
    if v_novo = v_fonte then
      raise exception 'esperava um fallback legado em % e não encontrei', r.fn;
    end if;
    -- depois do coalesce sem fallback, `new.club_id` pode ficar nulo: aí a linha é recusada em vez
    -- de nascer no clube errado. A coluna é `not null` em todas as três, então o banco já recusaria
    -- — mas com uma mensagem de constraint. Esta diz o que aconteceu.
    v_novo := replace(v_novo, '  return new;' || chr(10) || 'end;',
      '  if new.club_id is null then' || chr(10) ||
      '    perform public._recusar_linha(' || quote_literal(r.tabela) || ', ''Sem clube: esta pessoa não participa de nenhum clube.'');' || chr(10) ||
      '  end if;' || chr(10) ||
      '  return new;' || chr(10) || 'end;');
    execute v_novo;
    v_n := v_n + 1;
  end loop;
  raise notice '[8.6] % carimbadores deixaram de cair no clube legado', v_n;
end $$;

-- ---------------------------------------------------------------------------
--  A conferência, aqui e agora: nenhuma função de PRODUTO pode continuar caindo no clube legado.
--
--  As que sobram são as de PROVISIONAMENTO (`provisionar_clube`, `_prov_*`, `catalogo_jogo_definir`)
--  e elas são outra coisa: rodam quando um clube nasce, para copiar o catálogo base de jogos e
--  conteúdo, e o legado ali é a FONTE do que se copia — não o destino de quem não tem clube.
-- ---------------------------------------------------------------------------
do $$
declare v_sobrando text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_sobrando
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and pg_get_functiondef(p.oid) like '%clube_legado_id%'
     and p.proname not in ('clube_legado_id', 'provisionar_clube', '_prov_conteudo', '_prov_jogos',
                           'catalogo_jogo_definir');
  if v_sobrando is not null then
    raise exception 'ainda há fallback para o clube legado em: %', v_sobrando;
  end if;
end $$;
