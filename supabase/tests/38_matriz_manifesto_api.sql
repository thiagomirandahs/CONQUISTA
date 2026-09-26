-- MATRIZ manifesto → API (fase 3.1), pras 6 Classes Regulares 2026 + as 6 Avançadas (2026.4): o que minha_classe() entrega a
-- quem está fazendo a classe tem que ser EXATAMENTE o manifesto — nenhuma seção/requisito a menos,
-- a mais, duplicado, fora de ordem ou com texto diferente; observações, OMDs, dinâmico e N-de-M
-- chegando como estrutura (não como texto). O elo API → UI é o Vitest src/pages/MinhaClasse.matriz.test.jsx
-- (mesmo manifesto, mesmo formato de payload). O elo manifesto → banco é o teste 36.
begin;
\ir _lib.sql
\ir _curriculo_regular_2026.sql
\ir _fixtures.sql

insert into public.club_features (club_id, feature, enabled) values (t.id('clube_a'), 'classes', true)
on conflict (club_id, feature) do update set enabled = true;
create function t.pacote() returns jsonb language sql stable as $$ select texto::jsonb from t.manifesto $$;
create function t.todas() returns jsonb language sql stable as $$ select (t.pacote() -> 'classes') || coalesce(t.pacote() -> 'classes_avancadas', '[]'::jsonb) $$;

-- lider_a não tem nascimento cadastrado → elegível às 12 (a elegibilidade só bloqueia com nascimento conhecido);
-- as avançadas depois das regulares (a avançada exige a regular pareada iniciada ou concluída)
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.permitido('lider_a inicia as 6 classes regulares oficiais no clube A',
  $q$select public.classe_iniciar(c.id) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.tipo_classe = 'regular'$q$, 6);
select t.permitido('...e as 6 avançadas pareadas',
  $q$select public.classe_iniciar(c.id) from public.classes c join public.curriculum_versions v on v.id = c.curriculum_version_id where v.origem = 'oficial' and v.status = 'publicado' and c.tipo_classe = 'avancada'$q$, 6);
reset role;
create table t.mc as
  select mc.id as member_class_id, c.manifesto_id as classe_id from public.member_classes mc join public.classes c on c.id = mc.class_id
  where mc.usuario_id = t.id('lider_a') and mc.club_id = t.id('clube_a') and c.manifesto_id is not null;
grant select on t.mc to public;
select t.eq('12 matrículas, uma por classe', (select count(*) from t.mc), 12);

-- ---------- API achatada: (classe, seção, requisito) na ORDEM em que a tela vai renderizar ----------
create table t.api (classe_id text, secao_pos bigint, secao_uuid text, secao_codigo text, secao_nome text, secao_ordem int, req_pos bigint, req_id text, codigo text,
  descricao text, status_fonte text, status text, dyn_chave text, n_minimo int, sem_repeticao boolean, pool text, opcoes jsonb, bloqueios jsonb);
grant all on t.api to public;
select t.como('lider_a'); select t.pedir_clube('clube_a');
insert into t.api
  select m.classe_id,
         s.ord as secao_pos, s.val ->> 'id' as secao_uuid, s.val ->> 'codigo' as secao_codigo, s.val ->> 'nome' as secao_nome, (s.val ->> 'ordem')::int as secao_ordem,
         r.ord as req_pos, r.val ->> 'manifesto_id' as req_id, r.val ->> 'codigo' as codigo, r.val ->> 'descricao' as descricao,
         r.val ->> 'status_fonte' as status_fonte, r.val ->> 'status' as status,
         (r.val -> 'conteudo_dinamico' ->> 'chave') as dyn_chave,
         (r.val -> 'escolha' ->> 'n_minimo')::int as n_minimo, (r.val -> 'escolha' ->> 'sem_repeticao')::boolean as sem_repeticao,
         (r.val -> 'escolha' ->> 'pool_sem_repeticao') as pool,
         (select jsonb_agg(o ->> 'rotulo') from jsonb_array_elements((r.val -> 'escolha' -> 'opcoes')::jsonb) o) as opcoes,
         (r.val -> 'bloqueios')::jsonb as bloqueios
  from t.mc m
  cross join lateral (select public.minha_classe(m.member_class_id)::jsonb as j) mc
  cross join lateral jsonb_array_elements(mc.j -> 'secoes') with ordinality as s(val, ord)
  cross join lateral jsonb_array_elements(s.val -> 'requisitos') with ordinality as r(val, ord);
reset role;

-- ---------- manifesto achatado, mesma forma ----------
create table t.man as
  select c ->> 'id' as classe_id,
         s.ord as secao_pos, s.val ->> 'id' as secao_id, s.val ->> 'codigo' as secao_codigo, s.val ->> 'nome' as secao_nome, (s.val ->> 'ordem')::int as secao_ordem,
         r.ord as req_pos, r.val ->> 'id' as req_id, r.val ->> 'codigo' as codigo, r.val ->> 'descricao_resumida' as descricao,
         coalesce(r.val ->> 'status', 'CONFIRMADO') as status_fonte, coalesce(r.val ->> 'tipo', 'simples') as tipo,
         case when r.val ->> 'tipo' = 'anual_dinamico' then 'curso_leitura_' || (c ->> 'id') end as dyn_chave,
         case when coalesce(r.val ->> 'tipo', '') like 'escolha%' then coalesce((r.val -> 'escolha' ->> 'n')::int, 1) end as n_minimo,
         case when coalesce(r.val ->> 'tipo', '') like 'escolha%' then r.val ->> 'tipo' = 'escolha_n_de_m_sem_repeticao' end as sem_repeticao,
         r.val ->> 'grupo_sem_repeticao' as pool,
         r.val -> 'escolha' -> 'opcoes' as opcoes
  from jsonb_array_elements(t.todas()) c
  cross join lateral jsonb_array_elements(c -> 'secoes') with ordinality as s(val, ord)
  cross join lateral jsonb_array_elements(s.val -> 'requisitos') with ordinality as r(val, ord);
grant select on t.man to public;

-- ---------- a matriz ----------
select t.eq('API: 212 requisitos no total das 12 classes (nenhum sumiu)', (select count(*) from t.api), (select count(*) from t.man));
select t.eq('API: nenhum requisito duplicado (manifesto_id único por classe)', (select count(*) from (select classe_id, req_id from t.api group by 1, 2 having count(*) > 1) d), 0);
select t.eq('API: seções — mesma quantidade, mesma ORDEM de exibição, mesmo código/nome/ordem que o manifesto',
  (select count(*) from (
     (select classe_id, secao_pos, secao_codigo, secao_nome, secao_ordem from t.man group by 1, 2, 3, 4, 5
      except select classe_id, secao_pos, secao_codigo, secao_nome, secao_ordem from t.api group by 1, 2, 3, 4, 5)
     union all
     (select classe_id, secao_pos, secao_codigo, secao_nome, secao_ordem from t.api group by 1, 2, 3, 4, 5
      except select classe_id, secao_pos, secao_codigo, secao_nome, secao_ordem from t.man group by 1, 2, 3, 4, 5)) d), 0);
select t.eq('API: requisitos — mesma POSIÇÃO (seção × posição), id, código e TEXTO EXATO do manifesto',
  (select count(*) from (
     (select classe_id, secao_pos, req_pos, req_id, codigo, descricao from t.man except select classe_id, secao_pos, req_pos, req_id, codigo, descricao from t.api)
     union all
     (select classe_id, secao_pos, req_pos, req_id, codigo, descricao from t.api except select classe_id, secao_pos, req_pos, req_id, codigo, descricao from t.man)) d), 0);
select t.eq('API: status_fonte (CONFIRMADO/ALTERADO_POR_OMD) chega igual ao manifesto em todos',
  (select count(*) from t.api a join t.man m on m.classe_id = a.classe_id and m.req_id = a.req_id where a.status_fonte is distinct from m.status_fonte), 0);
select t.eq('API: os ALTERADO_POR_OMD vêm marcados (7 das Regulares + 5 das Avançadas)',
  (select count(*) from t.api where status_fonte = 'ALTERADO_POR_OMD'), (select count(*) from t.man where status_fonte = 'ALTERADO_POR_OMD'));
select t.eq('...e são 12', (select count(*) from t.man where status_fonte = 'ALTERADO_POR_OMD'), 12);
select t.eq('API: dinâmico — os 6 requisitos anuais chegam com conteudo_dinamico.chave = curso_leitura_<classe>, e só eles',
  (select count(*) from t.api a join t.man m on m.classe_id = a.classe_id and m.req_id = a.req_id where a.dyn_chave is distinct from m.dyn_chave), 0);
select t.eq('API: N-de-M — os grupos chegam como estrutura (n_minimo, sem_repeticao, pool, opções na ordem), iguais ao manifesto; requisitos simples sem escolha',
  (select count(*) from t.api a join t.man m on m.classe_id = a.classe_id and m.req_id = a.req_id
    where a.n_minimo is distinct from m.n_minimo or a.sem_repeticao is distinct from m.sem_repeticao or a.pool is distinct from m.pool
       or (coalesce(jsonb_array_length(a.opcoes), 0) > 0 or coalesce(jsonb_array_length(m.opcoes), 0) > 0) and a.opcoes is distinct from m.opcoes), 0);
select t.eq('API: 44 requisitos com escolha (26 das Regulares 2026.3 + 18 das Avançadas 2026.4)', (select count(*) from t.api where n_minimo is not null), 44);
select t.eq('API: estado inicial — todos nao_iniciado', (select count(*) from t.api where status <> 'nao_iniciado'), 0);
select t.eq('API: bloqueios iniciais — SÓ os 44 de escolha (sem escolha registrada) vêm bloqueados; os outros 168 livres (migration 108: os 6 do Curso de Leitura ficam ABERTOS mesmo sem o livro do ano)',
  (select count(*) from t.api where jsonb_array_length(bloqueios) > 0) * 1000 + (select count(*) from t.api where jsonb_array_length(bloqueios) = 0), 44168);
select t.eq('API: o dinâmico sem conteúdo do ano NÃO tem bloqueio (108); o de escolha diz quantas faltam',
  (select count(*) from t.api where dyn_chave is not null and jsonb_array_length(bloqueios) > 0)
  + (select count(*) from t.api where n_minimo is not null and bloqueios::text not like '%Escolha pelo menos%'), 0);
select t.eq('API: nenhum requisito ativo aparece fora das seções (o total por classe bate com o manifesto classe a classe)',
  (select count(*) from (select classe_id, count(*) n from t.api group by 1 except select classe_id, count(*) from t.man group by 1) d), 0);

-- ---------- observações e OMDs ficam acessíveis pela "Origem do requisito" (não no card) ----------
select t.como('lider_a'); select t.pedir_clube('clube_a');
select t.eq('Origem: toda observação do manifesto chega em requisito_origem().observacao_fonte, igual',
  t.n($q$select count(*) from t.man m join public.class_requirements r on r.manifesto_id = m.req_id
        join jsonb_array_elements(t.todas()) c on c ->> 'id' = m.classe_id
        join jsonb_array_elements(c -> 'secoes') s on true join jsonb_array_elements(s -> 'requisitos') q on q ->> 'id' = m.req_id
        where q ? 'observacao' and (public.requisito_origem(r.id) -> 'requisito' ->> 'observacao_fonte') is distinct from (q ->> 'observacao')$q$), 0);
select t.eq('Origem: todo ALTERADO_POR_OMD resolve a OMD com URL', t.n($q$select count(*) from t.api a join public.class_requirements r on r.manifesto_id = a.req_id where a.status_fonte = 'ALTERADO_POR_OMD' and (public.requisito_origem(r.id) -> 'requisito' -> 'alterado_por_omd' ->> 'url') is null$q$), 0);
reset role;

select t.fim();
rollback;
