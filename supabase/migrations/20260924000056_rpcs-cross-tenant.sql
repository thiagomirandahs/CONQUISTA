-- =============================================================================
--  Fase 8.2 — os RPCs cross-tenant, fechados.
--
--  A Fase 8 listou seis funções `security definer` que aceitam UUID arbitrário e as classificou
--  como "vazamento cross-tenant de BAIXO VALOR + oráculo de existência". O red-team desta fase
--  atacou cada uma no banco, com SQL executado, e **refutou essa classificação em todas**.
--  A severidade real vai de média a alta, e apareceu uma SÉTIMA função que a lista não tinha.
--
--  O que cada uma entregava de fato, tudo reproduzido:
--
--  1) dependencias_pendentes ......................................... ALTA
--     Nomeia itens de currículo que a RLS de `classes`/`specialties` esconde (versão rascunho,
--     versão arquivada, item desativado). Provado com dado OFICIAL: o banco tem 6 classes hoje
--     invisíveis por RLS e a função nomeou três. E, por contraste entre duas chamadas, revela se
--     uma pessoa de OUTRO clube concluiu uma especialidade — o item some da lista de pendências.
--
--  2) especialidade_ja_concluida_pela_pessoa ......................... MÉDIA
--     Qualquer conta logada lê a conquista curricular de um menor de outro clube. Inclusive um
--     'pais' (o papel de menor privilégio) e inclusive alguém com ZERO vínculos.
--     O red-team implementou a correção que o laudo propunha ("aceitar só o próprio ou quem tem
--     vínculo no clube atual") e PROVOU que ela continua vazando. Por isso aqui a saída é outra.
--
--  3) unidade_ancestral .............................................. MÉDIA
--     Oráculo de existência E DE TIPO: a CTE é auto-inclusiva, então f(X,T) devolve X se e só se
--     X existe e é do tipo T. Com sete chamadas classifica-se qualquer UUID do sistema. E mapeia
--     a árvore organizacional de outro tenant, linha que a RLS nega.
--
--  4) _experiencia_no_publico ........................................ ALTA
--     Confirma nominalmente terceiros de outro clube (vínculo, unidade, papel). Ignora
--     `e.status`, então responde sobre experiências em RASCUNHO e AGENDADA — estados que a policy
--     exclui de propósito. E é oráculo de existência: o laudo dizia que não, mas o teste dele era
--     vacuoso (escolhia sempre um p_uid que não casava, dando false dos dois lados).
--
--  5) leilao_saldo_unidade ........................................... MÉDIA
--     Ignora `clube_atual_id()` por completo — com header do clube A, do clube B, sem header ou
--     com header forjado, devolve o mesmo. Fura o ENTITLEMENT: com o recurso 'leilao' desligado,
--     a RLS mostra zero linhas e a função devolve o saldo mesmo assim. E vaza por ERRO: a soma
--     roda fora de qualquer gate, então uma unidade real sobre-reservada levanta 22003 enquanto
--     um uuid aleatório devolve 0 — um oráculo pelo código de erro.
--
--  6) pontos_temporada_unidade ....................... NÃO ESTAVA NA LISTA DA FASE 8
--     Mesmo vazamento do item 5, mesma origem, e também chamada pelo app. Estava fora da lista
--     porque a Fase 8 partiu de uma varredura de assinaturas, e esta função "parece" segura: ela
--     TEM um gate (`membro_ativo_no_clube`). O gate só não é o gate certo — ele pergunta "você é
--     de algum clube?" e não "você é DESTE clube, nesta requisição?".
--
--  AS DUAS SAÍDAS:
--
--    · Quem não tem chamador no app sai da superfície da API. Conferido uma a uma: a única
--      menção a `dependencias_pendentes` em src/ é um CAMPO de resposta de outra RPC, não uma
--      chamada. Revogar não regride nada, e é a correção completa — as funções internas que as
--      usam são elas próprias `security definer` e continuam enxergando tudo.
--
--    · Quem tem chamador no app é fechada por CLUBE DA REQUISIÇÃO, não por "algum vínculo".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (A) As quatro que saem da API.
--
-- Nota operacional, encontrada pelo red-team: `revoke` numa migration nova pode ser DESFEITO se
-- alguém reaplicar o lote 20260921, que é onde os grants nasceram — e o teste 09 reaplica esse
-- lote. Por isso o teste 51 confere o ESTADO FINAL do ACL, não a existência desta migration:
-- é o estado que importa, e é ele que uma reaplicação futura teria de quebrar para passar.
-- ---------------------------------------------------------------------------
revoke execute on function public.dependencias_pendentes(text, uuid, uuid, uuid) from authenticated, anon, public;
revoke execute on function public.especialidade_ja_concluida_pela_pessoa(uuid, uuid) from authenticated, anon, public;
revoke execute on function public.unidade_ancestral(uuid, text) from authenticated, anon, public;
revoke execute on function public._experiencia_no_publico(uuid, uuid) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- (B) `pontos_temporada_unidade` — fechada pelo clube DA REQUISIÇÃO.
--
-- O gate antigo era `membro_ativo_no_clube(clube da unidade)`: "você tem vínculo ativo em algum
-- clube, e por acaso é o clube desta unidade?". Numa plataforma onde a mesma pessoa tem vínculo
-- em vários clubes, isso deixa um conselheiro do clube B ler as unidades do clube A durante uma
-- requisição que declarou estar no clube A — o header é ignorado.
--
-- O gate novo exige as três camadas que a fase 5 estabeleceu:
--   a unidade é do clube DA REQUISIÇÃO · a pessoa é membro ativo dele · o recurso está habilitado
--
-- E a resposta é a MESMA (0) para unidade de outro clube e para uuid inexistente. Nada de erro,
-- nada de null, nada distinguível — é o invariante de oráculo do projeto (teste 24).
-- ---------------------------------------------------------------------------
create or replace function public.pontos_temporada_unidade(p_unidade_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when exists (
      select 1 from public.unidades u
       where u.id = p_unidade_id
         and u.club_id = public.clube_atual_id()
         and public.membro_ativo_no_clube(u.club_id)
    )
    then public._pontos_temporada_unidade_interno(p_unidade_id)
    else 0 end;
$$;
revoke all on function public.pontos_temporada_unidade(uuid) from public, anon;
grant execute on function public.pontos_temporada_unidade(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (C) `leilao_saldo_unidade` — o mesmo gate, mais o entitlement, mais o fim do oráculo por erro.
--
-- O `case when ... then <conta> else 0 end` não é cosmético: em SQL o ramo não escolhido NÃO é
-- avaliado, então para unidade de outro clube a subconsulta da soma nem roda. Era ela que,
-- rodando fora de qualquer gate, levantava 22003 ("integer out of range") numa unidade real
-- sobre-reservada e devolvia 0 num uuid aleatório — distinguindo os dois pelo código de erro.
--
-- O `least(..., 2147483647)` fecha o que sobrava: mesmo dentro do próprio clube, uma soma acima
-- do limite do int passa a saturar em vez de levantar erro. Saldo saturado é um número errado
-- numa situação que não deveria existir; erro é um canal.
-- ---------------------------------------------------------------------------
create or replace function public.leilao_saldo_unidade(p_unidade_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when exists (
      select 1 from public.unidades u
       where u.id = p_unidade_id
         and u.club_id = public.clube_atual_id()
         and public.membro_ativo_no_clube(u.club_id)
         and public.recurso_habilitado_no_clube(u.club_id, 'leilao')
    )
    then least(greatest(0,
           public.pontos_temporada_unidade(p_unidade_id)::bigint
           - coalesce((
               select sum(l.valor)::bigint
                 from public.leilao_lances l
                 join public.leilao_lance_unidades lu on lu.lance_id = l.id
                 join public.leilao_itens it on it.id = l.item_id
                 join public.leiloes le on le.id = it.leilao_id
                where lu.unidade_id = p_unidade_id and l.status = 'ativo' and le.status = 'aberto'
             ), 0)), 2147483647)::int
    else 0 end;
$$;
revoke all on function public.leilao_saldo_unidade(uuid) from public, anon;
grant execute on function public.leilao_saldo_unidade(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (D) O que a varredura CORRIGIDA do teste 24 e o red-team encontraram depois.
--
-- A varredura de oráculos de UUID (teste 24) percorria `proargtypes::oid[]` a partir do índice 1.
-- Esse array vem de um `oidvector`, que é 0-BASED. Resultado medido no banco: ela sondava 19 das
-- 118 posições uuid existentes — 16% da superfície. Era a fresta por onde tudo passou.
--
-- `recurso_situacao` é a mais grave desta fase. O red-team provou, com SQL executado, que uma
-- conta recém-criada por cadastro público — ZERO vínculos, `clube_atual_id()` nulo — lê o estado
-- comercial de QUALQUER clube: quais recursos o plano dá, quais a diretoria ligou ou desligou, e
-- se a assinatura está suspensa (o vetor inteiro zera). Cruzando com `planos_disponiveis()`, que
-- devolve nome e PREÇO, o plano é identificado. E o uuid do clube nem é secreto: `clube_legado_id()`
-- tem grant para ANON.
--
-- Mas a saída aqui NÃO é revogar: perguntar "o recurso X está ligado no MEU clube?" é o caminho
-- legítimo das três camadas da fase 5, e o teste 43 o exercita. O que não pode é perguntar sobre
-- o clube dos outros. Então a função ganha o gate do clube DA REQUISIÇÃO e continua na API.
--
-- `recurso_disponivel_no_plano` sai da API, e isso é indispensável: o red-team implementou o
-- gate só em `recurso_situacao` e extraiu o MESMO vetor por ela. Ela continua servindo
-- `recurso_habilitado_no_clube` e os 17 gatilhos `trg_exigir_recurso`, que são `security definer`
-- e precisam consultar qualquer clube em contexto de servidor — por isso o gate não pode morar
-- dentro dela, e sim na porta.
-- ---------------------------------------------------------------------------
create or replace function public.recurso_situacao(p_club_id uuid, p_feature text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when p_club_id is not null and p_club_id = public.clube_atual_id()
    then jsonb_build_object(
      'recurso', p_feature,
      'no_plano', public.recurso_disponivel_no_plano(p_club_id, p_feature),
      'no_clube', coalesce(
        (select enabled from public.club_features where club_id = p_club_id and feature = p_feature),
        (select padrao from public.recursos_catalogo where chave = p_feature), false),
      'efetivo', public.recurso_habilitado_no_clube(p_club_id, p_feature))
    -- Clube que não é o da requisição responde a MESMA coisa que um uuid inexistente: nulo.
    -- Nem "false", que já distinguiria "existe e está desligado" de "não é seu".
    else null end;
$$;
revoke all on function public.recurso_situacao(uuid, text) from public, anon;
grant execute on function public.recurso_situacao(uuid, text) to authenticated, service_role;

revoke execute on function public.recurso_disponivel_no_plano(uuid, text) from authenticated, anon, public;

-- `dependencias_satisfeitas` é `dependencias_pendentes` com outro nome e resposta booleana —
-- fechar uma e deixar a outra seria teatro. As duas `explicar_*` leem `member_requirements` por
-- id, sem conferir nada, e devolvem as pendências de outra pessoa. Nenhuma das três tem chamador
-- no app (conferido em src/); o app usa `minha_classe()` e `especialidades_disponiveis()`.
revoke execute on function public.dependencias_satisfeitas(text, uuid, uuid, uuid) from authenticated, anon, public;
revoke execute on function public.explicar_requisito_classe(uuid) from authenticated, anon, public;
revoke execute on function public.explicar_requisito_especialidade(uuid) from authenticated, anon, public;

-- NÃO revogadas, e a razão: `comparar_versoes_curriculares`, `classe_esta_publicada` e
-- `especialidade_esta_publicada` respondem sobre o CATÁLOGO DA PLATAFORMA — currículo oficial
-- versionado, a mesma resposta para todo clube, sem nenhum dado de tenant. Uma primeira versão
-- desta migration as revogou "por precaução" e derrubou nove arquivos de teste: elas são API
-- documentada (testes 33, 34, 37, 38, 39). Precaução que remove capacidade sem fechar vazamento
-- não é precaução, é dano.

-- ---------------------------------------------------------------------------
-- (E) `explicar_requisito_*` — gate, não revoke.
--
-- Estas duas são capacidade real do produto: explicam à pessoa POR QUE um requisito está
-- bloqueado, nomeando a regra e a tabela que a produziu. Os testes 35 e 37 as exercitam como
-- `authenticated` em dezenas de asserts. Revogá-las (como uma primeira versão desta migration
-- fez) tirava transparência de quem tem direito a ela.
--
-- O furo era outro: elas recebem um `member_requirement_id` e leem a linha SEM conferir nada —
-- sendo `security definer`, por fora da RLS. Então devolviam as pendências curriculares de
-- qualquer criança, de qualquer clube, para qualquer conta logada.
--
-- O gate é a cópia literal da policy de `member_requirements`:
--    (é seu E você é membro ativo do clube)  OU  (você é gestão do clube)
-- Quem não passa recebe `null` — exatamente o que já recebia para um id inexistente, então a
-- resposta não distingue "não existe" de "não é seu".
--
-- A reescrita é feita em cima da definição ATUAL da função (pg_get_functiondef), injetando só o
-- gate. Copiar o corpo inteiro para dentro desta migration congelaria uma versão que a próxima
-- migration de currículo iria querer mudar — e aí passariam a existir duas verdades.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_alvo text;
  v_gate text;
begin
  foreach v_alvo in array array[
    'public.explicar_requisito_classe(uuid)',
    'public.explicar_requisito_especialidade(uuid)'
  ] loop
    v_fn := pg_get_functiondef(v_alvo::regprocedure);

    v_gate := '  if not ((v_mr.usuario_id = auth.uid() and public.membro_ativo_no_clube(v_mr.club_id))'
           || ' or public.pode_gerir_no_clube(v_mr.club_id)) then return null; end if;' || chr(10);

    -- injeta logo após a primeira checagem de existência, que é onde v_mr já está carregada
    if position('if not found then return null; end if;' in v_fn) = 0 then
      raise exception '[56] % mudou de forma; o gate precisa ser revisto à mão', v_alvo;
    end if;
    if position('membro_ativo_no_clube' in v_fn) > 0 then
      raise notice '[56] % já tem gate; nada a fazer', v_alvo;
      continue;
    end if;

    v_fn := replace(v_fn, 'if not found then return null; end if;',
                    'if not found then return null; end if;' || chr(10) || v_gate);
    execute v_fn;
  end loop;
end $$;

revoke all on function public.explicar_requisito_classe(uuid) from public, anon;
revoke all on function public.explicar_requisito_especialidade(uuid) from public, anon;
grant execute on function public.explicar_requisito_classe(uuid) to authenticated, service_role;
grant execute on function public.explicar_requisito_especialidade(uuid) to authenticated, service_role;
